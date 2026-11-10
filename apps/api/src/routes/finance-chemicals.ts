import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  CHEMICAL_MANAGE_ROLES,
  chemicalProfileSchema,
  updateChemicalProfileSchema,
} from '@kampus/school-core/lib/finance-chemicals.ts'
import { STOCK_READ_ROLES } from '@kampus/school-core/lib/finance-inventory.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  chemicalInventoryCsvFor,
  chemicalInventoryFor,
  createChemicalProfileCommand,
  listChemicalLotsFor,
  updateChemicalProfileCommand,
} from '../services/finance-chemicals.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  chemicalInventoryQuery,
  chemicalInventoryResponse,
  chemicalLotListQuery,
  chemicalLotListResponse,
} from './finance-chemicals.schemas.ts'
import { stockItemParams, stockItemResponse } from './finance-inventory.schemas.ts'

/**
 * Laboratuvar kimyasal envanteri uçları (docs/domain/finans.md DOM-FIN-090; ON-234). Modül
 * `finance`. Kimyasal bilgisini yönetici yazar; partileri, uyarı listesini ve raporu stok okuyan
 * roller (yönetici, ön büro) okur (K-180, K-240). Sıra: 401 → 403 modül → 403 rol → `If-Match` →
 * 400 → işlem. Rapor CSV'si kişi verisi taşımaz: taze oturum ve denetim istemez (K-243).
 */

const READERS = 'Roller: `yonetici`, `onburo` (K-180). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-180, K-240). Modül `finance`.'
const CSV_PER_MINUTE = 10
const READS_PER_MINUTE = 300

const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceChemicalRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]
  const tags = ['finance-inventory']
  const PROFILE = '/api/v1/finance/stock-items/:itemId/chemical-profile'
  const profileFields =
    'GHS piktogramları (`GHS01`…`GHS09`, çoklu), sinyal kelimesi (`danger` Tehlike, `warning` Dikkat), CAS numarası (biçim ve sağlama basamağı), depolama sınıfı (≤ 80), uyumsuzluk notu (≤ 500), GBF bağlantısı (yalnız https), GBF belge numarası ve revizyon günü (bugünden sonra olamaz, 422 `chemical_sds_date_future`); hepsi isteğe bağlı. GBF dosyası saklanmaz (K-240).'

  typed.post(
    PROFILE,
    {
      preValidation: [...guarded(CHEMICAL_MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStockChemicalProfile',
        tags,
        summary: 'Stok kartını kimyasal olarak işaretle',
        description: `Karta kimyasal bilgisi ekler (DOM-FIN-090): ${profileFields} Kartın kimyasal bilgisi zaten varsa 409 \`stock_item_chemical_exists\`; olmayan ya da başka kurumun kartı 404. Kimyasal kartın girişi bundan sonra parti ve son kullanma günü ister (K-241). Yanıt kart ayrıntısıdır. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: stockItemParams,
        body: chemicalProfileSchema,
        response: { 201: stockItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createChemicalProfileCommand(
        contextOf(request),
        request.params.itemId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return stockItemResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    PROFILE,
    {
      preValidation: [...guarded(CHEMICAL_MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateStockChemicalProfile',
        tags,
        summary: 'Kimyasal bilgisini düzelt',
        description: `Kısmi düzeltme (DOM-FIN-090): ${profileFields} Kimyasal bilgisi yoksa ya da kart başka kurumunsa 404; sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` kimyasal bilgisinin sürümüdür (\`chemical.version\`). Kimyasal bilgisi kaldırılmaz. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: stockItemParams,
        body: updateChemicalProfileSchema,
        response: { 200: stockItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateChemicalProfileCommand(
        contextOf(request),
        request.params.itemId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return stockItemResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/chemical-lots',
    {
      preValidation: guarded(STOCK_READ_ROLES),
      schema: {
        operationId: 'listChemicalLots',
        tags,
        summary: 'Kimyasal partileri ve son kullanma uyarısı',
        description: `Stoktaki (miktarı sıfırdan büyük) kimyasal partiler, depo başına (DOM-FIN-090). Miktar saklanmaz: çıkış en yakın son kullanma tarihli partiden düşer (FEFO), transfer partileri taşır, mal kabul girişi "parti bilgisi yok" satırındadır (K-241, K-242). Sıra en yakın son kullanma önce, partisiz sonda. \`status=attention\` süresi geçen (son kullanma günü bugünden önce) ve 30 gün içinde dolan partileri verir (uyarı listesi, K-243). ${READERS}`,
        querystring: chemicalLotListQuery,
        response: { 200: chemicalLotListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listChemicalLotsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/chemical-inventory',
    {
      config: {
        rateLimit: {
          max: (request: FastifyRequest) => (wantsCsv(request) ? CSV_PER_MINUTE : READS_PER_MINUTE),
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            wantsCsv(request)
              ? `chemical-inventory-csv:${request.auth?.userId ?? request.ip}`
              : request.ip,
        },
      },
      preValidation: guarded(STOCK_READ_ROLES),
      schema: {
        operationId: 'getChemicalInventory',
        tags,
        summary: 'Kimyasal envanter raporu',
        description: `Depo × kimyasal, stokta olanlar (DOM-FIN-090): kod, ad, CAS, GHS piktogramları, sinyal kelimesi, depolama sınıfı, GBF durumu, miktar, en yakın son kullanma, süresi geçen ve yaklaşan miktar ve FEFO sırasıyla partiler. Depo adı ve kart koduna göre; depo ve metinle (kod, ad, CAS) süzülür. \`Accept: text/csv\` süzgeçle eşleşen bütün satırları parti başına bir satır olarak verir: \`;\` ayırıcı, UTF-8 BOM, formül kaçışı, piktogramlar kod olarak; kişi verisi yoktur, taze oturum ve denetim istemez, kullanıcı başına 10/dk (K-243). PDF web'de bu yanıttan üretilir. ${READERS}`,
        querystring: chemicalInventoryQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur, istemci tipi tek kalsın.
        response: { 200: chemicalInventoryResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { page, pageSize, ...filters } = request.query
      if (wantsCsv(request)) {
        const { csv, filename } = await chemicalInventoryCsvFor(ctx, filters)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      const { items, total } = await chemicalInventoryFor(ctx, { page, pageSize, ...filters })
      return { data: items, meta: { page, pageSize, total } }
    },
  )
}
