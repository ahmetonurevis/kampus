import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  cancelStockMovementSchema,
  STOCK_ISSUE_ROLES,
  STOCK_MANAGE_ROLES,
  STOCK_READ_ROLES,
  stockEntrySchema,
  stockIssueSchema,
  stockItemSchema,
  stockTransferSchema,
  stockWarehouseSchema,
  updateStockItemSchema,
  updateStockWarehouseSchema,
} from '@kampus/school-core/lib/finance-inventory.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelStockMovementCommand,
  createStockItemCommand,
  createStockMovementCommand,
  createStockTransferCommand,
  createStockWarehouseCommand,
  getStockItemFor,
  listStockItemsFor,
  listStockMovementsFor,
  listStockWarehousesFor,
  updateStockItemCommand,
  updateStockWarehouseCommand,
} from '../services/finance-inventory.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  stockItemListQuery,
  stockItemListResponse,
  stockItemParams,
  stockItemResponse,
  stockMovementListQuery,
  stockMovementListResponse,
  stockMovementParams,
  stockMovementResponse,
  stockMovementsResponse,
  stockTransferResponse,
  stockWarehouseListQuery,
  stockWarehouseListResponse,
  stockWarehouseParams,
  stockWarehouseResponse,
} from './finance-inventory.schemas.ts'

/**
 * Stok uçları (docs/domain/finans.md DOM-FIN-077, DOM-FIN-078; ON-228, ON-229). Modül `finance`.
 * Okuma yönetici ve ön büro; kart, depo, elle giriş, transfer ve iptal yalnız yönetici; çıkış
 * yönetici ve ön büro (K-180). Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem. Kart ve
 * depo silinmez, `PATCH` ile pasifleşir; hareket silinmez, iptal edilir.
 */

const READERS = 'Roller: `yonetici`, `onburo` (K-180). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-180). Modül `finance`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceInventoryRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]
  const tags = ['finance-inventory']
  const ITEMS = '/api/v1/finance/stock-items'
  const WAREHOUSES = '/api/v1/finance/stock-warehouses'
  const MOVEMENTS = '/api/v1/finance/stock-movements'

  // --- Stok kartı --------------------------------------------------------------------------------

  typed.get(
    ITEMS,
    {
      preValidation: guarded(STOCK_READ_ROLES),
      schema: {
        operationId: 'listStockItems',
        tags,
        summary: 'Stok kartlarını listele',
        description: `Koda göre; pasifler dahil. Miktar iptal edilmemiş hareketlerden türetilir (DOM-FIN-077); \`warehouseId\` verilirse yalnız o depodaki miktar. \`critical=true\` kritik seviyedeki (miktar ≤ kritik seviye) etkin kartları verir. ${READERS}`,
        querystring: stockItemListQuery,
        response: { 200: stockItemListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, critical, ...filters } = request.query
      const { items, total } = await listStockItemsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
        critical: critical === 'true',
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    ITEMS,
    {
      preValidation: [...guarded(STOCK_MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStockItem',
        tags,
        summary: 'Stok kartı ekle',
        description: `Kod (büyük harfe çevrilir), ad, kategori (tedarikçi kategorileri), birim (\`piece\`, \`pack\`, \`box\`, \`kilogram\`, \`liter\`, \`meter\`; K-182) ve isteğe bağlı kritik seviye. Kod kurumda tekil: 409 \`stock_item_code_exists\` (DOM-FIN-077). ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: stockItemSchema,
        response: { 201: stockItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStockItemCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = stockItemResponse.parse(sendBody(reply, result))
      reply.header('location', `${ITEMS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${ITEMS}/:itemId`,
    {
      preValidation: guarded(STOCK_READ_ROLES),
      schema: {
        operationId: 'getStockItem',
        tags,
        summary: 'Stok kartı ayrıntısı',
        description: `Kart, toplam miktar ve depo başına miktar. Olmayan ya da başka kurumun kartı 404. ${READERS}`,
        params: stockItemParams,
        response: { 200: stockItemResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStockItemFor(contextOf(request), request.params.itemId),
    }),
  )

  typed.patch(
    `${ITEMS}/:itemId`,
    {
      preValidation: [...guarded(STOCK_MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateStockItem',
        tags,
        summary: 'Stok kartını düzelt ya da pasifleştir',
        description: `Kısmi düzeltme. Hareketi olan kartın birimi değişmez (422 \`stock_item_unit_locked\`); miktarı olan kart pasifleşmez (422 \`stock_item_has_stock\`); başka kartın kodu 409 \`stock_item_code_exists\`; sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: stockItemParams,
        body: updateStockItemSchema,
        response: { 200: stockItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateStockItemCommand(
        contextOf(request),
        request.params.itemId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return stockItemResponse.parse(sendBody(reply, result))
    },
  )

  // --- Depo --------------------------------------------------------------------------------------

  typed.get(
    WAREHOUSES,
    {
      preValidation: guarded(STOCK_READ_ROLES),
      schema: {
        operationId: 'listStockWarehouses',
        tags,
        summary: 'Depoları listele',
        description: `Ada göre; pasifler dahil, kampüs adı ve stoklu ürün çeşidi sayısıyla (DOM-FIN-077). ${READERS}`,
        querystring: stockWarehouseListQuery,
        response: { 200: stockWarehouseListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listStockWarehousesFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    WAREHOUSES,
    {
      preValidation: [...guarded(STOCK_MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStockWarehouse',
        tags,
        summary: 'Depo ekle',
        description: `Ad, kurumun etkin kampüsü ve isteğe bağlı not. Kampüs yoksa ya da pasifse 422 \`stock_warehouse_campus_not_found\`; ad kurumda tekil (Türkçe harf duyarsız): 409 \`stock_warehouse_name_exists\` (DOM-FIN-077, K-180). ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: stockWarehouseSchema,
        response: { 201: stockWarehouseResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStockWarehouseCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return stockWarehouseResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${WAREHOUSES}/:warehouseId`,
    {
      preValidation: [...guarded(STOCK_MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateStockWarehouse',
        tags,
        summary: 'Depoyu düzelt ya da pasifleştir',
        description: `Kısmi düzeltme. Stoku olan depo başka kampüse bağlanmaz ve pasifleşmez (422 \`stock_warehouse_has_stock\`); ad tekil (409 \`stock_warehouse_name_exists\`); sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: stockWarehouseParams,
        body: updateStockWarehouseSchema,
        response: { 200: stockWarehouseResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateStockWarehouseCommand(
        contextOf(request),
        request.params.warehouseId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return stockWarehouseResponse.parse(sendBody(reply, result))
    },
  )

  // --- Hareket -----------------------------------------------------------------------------------

  typed.get(
    MOVEMENTS,
    {
      preValidation: guarded(STOCK_READ_ROLES),
      schema: {
        operationId: 'listStockMovements',
        tags,
        summary: 'Stok hareketlerini listele',
        description: `En yeni gün önce; iptal edilenler dahil. Kart, depo, tür ve gün aralığıyla süzülür (DOM-FIN-078). ${READERS}`,
        querystring: stockMovementListQuery,
        response: { 200: stockMovementListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listStockMovementsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  const common =
    'Kart ve depo etkin olmalı (422 `stock_item_inactive`, `stock_warehouse_inactive`); gün bugünden sonra olamaz (422 `stock_movement_date_future`); "Diğer" nedeni açıklama ister. `Idempotency-Key` zorunlu; aynı anahtar ilk yanıtı tekrarlar.'

  typed.post(
    '/api/v1/finance/stock-entries',
    {
      preValidation: [...guarded(STOCK_MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStockEntry',
        tags,
        summary: 'Stok girişi yaz',
        description: `Elle giriş (açılış stoku, bağış, sayım fazlası, kullanımdan iade, diğer). Satın alınan ürün mal kabulle girer (K-184). ${common} ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: stockEntrySchema,
        response: { 201: stockMovementResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStockMovementCommand(
        contextOf(request),
        'entry',
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return stockMovementResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    '/api/v1/finance/stock-issues',
    {
      preValidation: [...guarded(STOCK_ISSUE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStockIssue',
        tags,
        summary: 'Stok çıkışı yaz',
        description: `Çıkış (kullanım, hasar ve fire, kayıp, sayım eksiği, diğer). Miktar o gün ve sonraki her gün depodaki miktarı aşamaz (422 \`stock_insufficient\`, mesajda çıkılabilecek en çok miktar; kurum kilidi altında denetlenir, K-181). ${common} Roller: \`yonetici\`, \`onburo\` (K-180). Modül \`finance\`.`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: stockIssueSchema,
        response: { 201: stockMovementResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStockMovementCommand(
        contextOf(request),
        'issue',
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return stockMovementResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    '/api/v1/finance/stock-transfers',
    {
      preValidation: [...guarded(STOCK_MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStockTransfer',
        tags,
        summary: 'Depolar arası transfer',
        description: `Tek işlemde iki hareket: çıkış deposundan transfer çıkışı, giriş deposuna transfer girişi; aynı \`transferId\`. Depolar farklı ve etkin; kampüsleri farklı olabilir. Çıkış deposunun miktarı aşılamaz (422 \`stock_insufficient\`). ${common} ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: stockTransferSchema,
        response: { 201: stockTransferResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStockTransferCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return stockTransferResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${MOVEMENTS}/:movementId/cancel`,
    {
      preValidation: [...guarded(STOCK_MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelStockMovement',
        tags,
        summary: 'Stok hareketini iptal et',
        description: `Gerekçeyle iptal; hareket silinmez. Transferin iki hareketi birlikte iptal edilir. Giriş iptali stoku herhangi bir gün eksiye düşürecekse 422 \`stock_cancel_negative\`; mal kabul girişi yalnız kabul iptaliyle (422 \`stock_movement_from_receipt\`), materyal seti teslimi çıkışı yalnız teslim iptaliyle (422 \`stock_movement_from_delivery\`, DOM-FIN-080) geri alınır; zaten iptal edilmiş 422 \`stock_movement_already_cancelled\` (K-183). \`If-Match\` hareketin sürümüdür. İptal edilen hareketler döner. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: stockMovementParams,
        body: cancelStockMovementSchema,
        response: { 200: stockMovementsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelStockMovementCommand(
        contextOf(request),
        request.params.movementId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return stockMovementsResponse.parse(sendBody(reply, result))
    },
  )
}
