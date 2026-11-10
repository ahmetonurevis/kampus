import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  cancelStockCountSchema,
  setStockCountLineSchema,
  startStockCountSchema,
  STOCK_COUNT_ENTRY_ROLES,
  STOCK_COUNT_MANAGE_ROLES,
  STOCK_COUNT_READ_ROLES,
  stockCountScanSchema,
} from '@kampus/school-core/lib/finance-stock-counts.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelStockCountCommand,
  completeStockCountCommand,
  getStockCountFor,
  listStockCountsFor,
  scanStockCountCommand,
  setStockCountLineCommand,
  startStockCountCommand,
} from '../services/finance-stock-counts.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  completeStockCountBody,
  stockCountLineResponse,
  stockCountListQuery,
  stockCountListResponse,
  stockCountParams,
  stockCountResponse,
} from './finance-stock-counts.schemas.ts'

/**
 * Stok sayımı uçları (docs/domain/finans.md DOM-FIN-081; ON-231). Modül `finance`. Okuma ve sayım
 * girişi (okutma, miktar) yönetici ve ön büro; başlatma, tamamlama ve iptal yalnız yönetici (K-228).
 * Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem. Sayım silinmez; açık sayım tamamlanır
 * ya da iptal edilir, sonra değişmez.
 */

const READERS = 'Roller: `yonetici`, `onburo` (K-228). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-228). Modül `finance`.'
const CLOSED =
  'Tamamlanan ya da iptal edilen sayım değişmez (422 `stock_count_closed`); olmayan ya da başka kurumun sayımı 404.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceStockCountRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]
  const tags = ['finance-inventory']
  const COUNTS = '/api/v1/finance/stock-counts'

  typed.get(
    COUNTS,
    {
      preValidation: guarded(STOCK_COUNT_READ_ROLES),
      schema: {
        operationId: 'listStockCounts',
        tags,
        summary: 'Stok sayımlarını listele',
        description: `En yeni başlangıç önce; durum ve depoyla süzülür. Satırda depo, kampüs, başlatan, sayılan satır ve düzeltme hareketi sayısı (DOM-FIN-081). ${READERS}`,
        querystring: stockCountListQuery,
        response: { 200: stockCountListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listStockCountsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    COUNTS,
    {
      preValidation: [...guarded(STOCK_COUNT_MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'startStockCount',
        tags,
        summary: 'Stok sayımı başlat',
        description: `Depo ve isteğe bağlı not. Depodaki miktarı sıfırdan farklı her kart, o anki sistem miktarıyla (anlık görüntü) sayım satırı olur. Depo etkin olmalı (422 \`stock_warehouse_inactive\`, \`stock_warehouse_not_found\`); aynı depoda süren sayım varsa 409 \`stock_count_open_exists\` (K-228). ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: startStockCountSchema,
        response: { 201: stockCountResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await startStockCountCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = stockCountResponse.parse(sendBody(reply, result))
      reply.header('location', `${COUNTS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${COUNTS}/:countId`,
    {
      preValidation: guarded(STOCK_COUNT_READ_ROLES),
      schema: {
        operationId: 'getStockCount',
        tags,
        summary: 'Stok sayımı ve fark raporu',
        description: `Sayım bilgileri ve fark raporu: sayılan kalemlerde sistem (anlık görüntü), sayım sırasındaki hareket, beklenen, sayılan, fark, birim maliyet (son alış fiyatı) ve fark tutarı; sayılmayan kalemler ayrı listede ve değişmez (K-230). Açık sayımda değerler o anki hareketlerden hesaplanır (K-231), tamamlanan sayımda saklanan değerlerdir. Olmayan ya da başka kurumun sayımı 404. ${READERS}`,
        params: stockCountParams,
        response: { 200: stockCountResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStockCountFor(contextOf(request), request.params.countId),
    }),
  )

  typed.post(
    `${COUNTS}/:countId/scans`,
    {
      preValidation: [...guarded(STOCK_COUNT_ENTRY_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'scanStockCount',
        tags,
        summary: 'Sayıma kart okut',
        description: `Kart kodu (barkod okuyucu kodu klavye gibi yazar; büyük harfe çevrilir) kartı bulur, sayılan miktara \`quantity\` (varsayılan 1) eklenir; anlık görüntüde olmayan kart için satır açılır (K-229). Kod bulunmazsa 422 \`stock_count_item_not_found\`; pasif kart 422 \`stock_item_inactive\`. ${CLOSED} \`Idempotency-Key\` zorunlu: aynı okutma iki kez sayılmaz. ${READERS}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: stockCountParams,
        body: stockCountScanSchema,
        response: { 200: stockCountLineResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await scanStockCountCommand(
        contextOf(request),
        request.params.countId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return stockCountLineResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${COUNTS}/:countId/quantities`,
    {
      preValidation: [...guarded(STOCK_COUNT_ENTRY_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'setStockCountQuantity',
        tags,
        summary: 'Sayılan miktarı yaz',
        description: `Kartın sayılan miktarını doğrudan yazar (0–1.000.000); \`null\` sayımı geri alır, kalem "sayılmadı" olur (K-229). Kart bu kurumda yoksa 422 \`stock_item_not_found\`; anlık görüntüde olmayan pasif kart sayılmaz. ${CLOSED} ${READERS}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: stockCountParams,
        body: setStockCountLineSchema,
        response: { 200: stockCountLineResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await setStockCountLineCommand(
        contextOf(request),
        request.params.countId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return stockCountLineResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${COUNTS}/:countId/complete`,
    {
      preValidation: [...guarded(STOCK_COUNT_MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'completeStockCount',
        tags,
        summary: 'Stok sayımını tamamla',
        description: `Fark raporu kurum kilidi altında yeniden hesaplanır; farkı olan her kart için tamamlama gününde tek işlemde düzeltme hareketi yazılır (fazla \`adjustment_in\`, eksik \`adjustment_out\`; iptal edilmez). Sayılmayan kalem değişmez (K-230). Hiç kalem sayılmadıysa 422 \`stock_count_empty\`; eksik düzeltmesi depodaki miktarı eksiye düşürecekse (kart sayıldıktan sonra çıkış yazılmış) 422 \`stock_count_negative\` (K-231); farkı olan kart pasifse 422 \`stock_item_inactive\`. ${CLOSED} \`If-Match\` sayımın sürümüdür. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: stockCountParams,
        body: completeStockCountBody,
        response: { 200: stockCountResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await completeStockCountCommand(
        contextOf(request),
        request.params.countId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return stockCountResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${COUNTS}/:countId/cancel`,
    {
      preValidation: [...guarded(STOCK_COUNT_MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelStockCount',
        tags,
        summary: 'Stok sayımını iptal et',
        description: `Gerekçeyle (5–500 karakter) iptal; stok hareketi yazılmaz, depoda yeni sayım başlatılabilir (K-230). ${CLOSED} \`If-Match\` sayımın sürümüdür. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: stockCountParams,
        body: cancelStockCountSchema,
        response: { 200: stockCountResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelStockCountCommand(
        contextOf(request),
        request.params.countId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return stockCountResponse.parse(sendBody(reply, result))
    },
  )
}
