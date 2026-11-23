import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  approveSupplyRequestSchema,
  cancelSupplyRequestSchema,
  convertSupplyRequestSchema,
  fulfillSupplyRequestSchema,
  rejectSupplyRequestSchema,
  SUPPLY_REQUEST_DECISION_ROLES,
  SUPPLY_REQUEST_MANAGE_ROLES,
  SUPPLY_REQUEST_ROLES,
  supplyRequestSchema,
} from '@kampus/school-core/lib/finance-supply-requests.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  convertSupplyRequestCommand,
  createSupplyRequestCommand,
  fulfillSupplyRequestCommand,
  getSupplyRequestFor,
  listSupplyRequestsFor,
  listSupplyStockCardsFor,
  transitionSupplyRequestCommand,
} from '../services/finance-supply-requests.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  supplyRequestListQuery,
  supplyRequestListResponse,
  supplyRequestParams,
  supplyRequestResponse,
  supplyStockCardQuery,
  supplyStockCardResponse,
} from './finance-supply-requests.schemas.ts'

/**
 * Sarf malzeme talebi uçları (docs/domain/finans.md DOM-FIN-091; ON-233). Modül `finance`. Talebi
 * yönetici, ön büro ve öğretmen kendi adına açar ve onaydan önce iptal eder; öğretmen yalnız kendi
 * talebini görür, başkasınınki 404 (K-244). Onay ve ret yönetici; karşılama ve satın almaya
 * dönüştürme yönetici ve ön büro (depo sorumlusu). Sıra: 401 → 403 modül → 403 rol → `If-Match` →
 * 400 → işlem.
 */

const STAFF =
  'Roller: `yonetici`, `onburo`, `ogretmen`; öğretmen yalnız kendi talebini görür, başkasınınki 404 (K-244). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-244). Modül `finance`.'
const KEEPER = 'Roller: `yonetici`, `onburo` (depo sorumlusu, K-244). Modül `finance`.'
const IF_MATCH = '`If-Match` zorunlu; sürüm tutmazsa 409 `version_conflict`.'
const BASE = '/api/v1/finance/supply-requests'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

const TRANSITIONS = {
  approve: {
    operationId: 'approveSupplyRequest',
    summary: 'Sarf talebini onayla',
    description:
      'Onay bekleyen talebi onaylar; isteğe bağlı not. Onay bekleyen değilse 422 `supply_request_not_submitted`.',
    roles: SUPPLY_REQUEST_DECISION_ROLES,
    body: approveSupplyRequestSchema.nullish(),
    who: MANAGER,
  },
  reject: {
    operationId: 'rejectSupplyRequest',
    summary: 'Sarf talebini reddet',
    description:
      'Onay bekleyen talebi gerekçeyle (5–500 karakter) reddeder. Onay bekleyen değilse 422 `supply_request_not_submitted`.',
    roles: SUPPLY_REQUEST_DECISION_ROLES,
    body: rejectSupplyRequestSchema,
    who: MANAGER,
  },
  cancel: {
    operationId: 'cancelSupplyRequest',
    summary: 'Sarf talebini iptal et',
    description:
      'Talebi açan kişi onaydan önce gerekçeyle iptal eder. Başkasının talebi 403 `supply_request_not_owner` (yönetici reddeder), onaylanmış ya da sonuçlanmış talep 422 `supply_request_not_cancellable`.',
    roles: SUPPLY_REQUEST_ROLES,
    body: cancelSupplyRequestSchema,
    who: STAFF,
  },
} as const

export function registerFinanceSupplyRequestRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]
  const tags = ['finance-procurement']

  typed.get(
    BASE,
    {
      preValidation: guarded(SUPPLY_REQUEST_ROLES),
      schema: {
        operationId: 'listSupplyRequests',
        tags,
        summary: 'Sarf taleplerini listele',
        description: `Yeni açılan önce; durum ve stok kartıyla süzülür, \`q\` numarada, gerekçede, talep edenin adında ya da kalemlerin kod ve adında arar. Yönetici ve ön büro kurumun bütün taleplerini (\`mine=true\` ile yalnız kendininkileri), öğretmen yalnız kendi taleplerini görür (K-244). ${STAFF}`,
        querystring: supplyRequestListQuery,
        response: { 200: supplyRequestListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listSupplyRequestsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${BASE}/stock-items`,
    {
      preValidation: guarded(SUPPLY_REQUEST_ROLES),
      schema: {
        operationId: 'listSupplyStockItems',
        tags,
        summary: 'Sarf talebi formunun stok kartları',
        description: `Kurumun etkin stok kartları, koda göre; yalnız kod, ad, kategori ve birim (miktar ve fiyat yok). \`q\` kod ya da adda arar. Öğretmen stok uçlarını okumaz; talep formu kartı buradan seçer. ${STAFF}`,
        querystring: supplyStockCardQuery,
        response: { 200: supplyStockCardResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listSupplyStockCardsFor(contextOf(request), {
        page,
        pageSize,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    BASE,
    {
      preValidation: [...guarded(SUPPLY_REQUEST_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createSupplyRequest',
        tags,
        summary: 'Sarf talebi aç',
        description: `Talebi açan kişi adına, onay bekler durumda açar: istenen gün (bugünden önce 422 \`supply_request_needed_date_past\`, bir yıldan sonra 422 \`supply_request_needed_date_too_far\`), gerekçe (5–1000 karakter) ve 1–30 kalem (kurumun stok kartı ve kartın biriminde 1–10.000 miktar; bir kart bir kez). Bilinmeyen ya da başka kurumun kartı 400 (\`items.<n>.stockItemId\`), pasif kart 422 \`supply_request_stock_item_inactive\`. \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: supplyRequestSchema,
        response: { 201: supplyRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createSupplyRequestCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = supplyRequestResponse.parse(sendBody(reply, result))
      reply.header('location', `${BASE}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${BASE}/:requestId`,
    {
      preValidation: guarded(SUPPLY_REQUEST_ROLES),
      schema: {
        operationId: 'getSupplyRequest',
        tags,
        summary: 'Sarf talebi ayrıntısı',
        description: `Kalemler (istenen, karşılanan, kalan; yönetici ve ön büroya depo miktarları ve son alış fiyatı), karşılama geçmişi, karar, karşılama ve iptal izi, bağlı satın alma talebi ve kullanıcının yapabileceği işlemler. Olmayan, başka kurumun ya da (öğretmen için) başkasının talebi 404. ${STAFF}`,
        params: supplyRequestParams,
        response: { 200: supplyRequestResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getSupplyRequestFor(contextOf(request), request.params.requestId),
    }),
  )

  for (const [verb, spec] of Object.entries(TRANSITIONS) as [
    keyof typeof TRANSITIONS,
    (typeof TRANSITIONS)[keyof typeof TRANSITIONS],
  ][]) {
    typed.post(
      `${BASE}/:requestId/${verb}`,
      {
        preValidation: [...guarded(spec.roles), requireIfMatch(), captureInput()],
        schema: {
          operationId: spec.operationId,
          tags,
          summary: spec.summary,
          description: `${spec.description} ${IF_MATCH} ${spec.who}`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: supplyRequestParams,
          body: spec.body,
          response: { 200: supplyRequestResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await transitionSupplyRequestCommand(
          contextOf(request),
          request.params.requestId,
          verb,
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return supplyRequestResponse.parse(sendBody(reply, result))
      },
    )
  }

  typed.post(
    `${BASE}/:requestId/fulfill`,
    {
      preValidation: [...guarded(SUPPLY_REQUEST_MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'fulfillSupplyRequest',
        tags,
        summary: 'Sarf talebini depodan karşıla',
        description: `Onaylı talebin kalemleri için seçilen depodan çıkış gününde \`supply\` türünde stok çıkışı yazar (DOM-FIN-078; tek işlemde, talebe bağlı). \`lines\` verilmezse her kalem için kalan ile o gün ve sonrasında depoda çıkılabilecek miktarın küçüğü çıkar (stok yetmezse karşılanabilen miktar; K-245); verilirse kalanı aşan miktar 422 \`supply_request_quantity_exceeds_remaining\`, depodaki miktarı aşan 422 \`stock_insufficient\` (K-181). Hiçbir şey çıkmıyorsa 422 \`supply_request_nothing_available\`. Kalan sıfırlanınca talep karşılanır; \`close: true\` kalanı olan talebi kısmi karşılanmış olarak kapatır ve \`closeNote\` ister (422 \`supply_request_close_note_required\`). Onaylı değilse 422 \`supply_request_not_approved\`. \`Idempotency-Key\` zorunlu; ${IF_MATCH} ${KEEPER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: supplyRequestParams,
        body: fulfillSupplyRequestSchema,
        response: { 200: supplyRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await fulfillSupplyRequestCommand(
        contextOf(request),
        request.params.requestId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return supplyRequestResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${BASE}/:requestId/convert`,
    {
      preValidation: [...guarded(SUPPLY_REQUEST_MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'convertSupplyRequest',
        tags,
        summary: 'Sarf talebini satın alma talebine dönüştür',
        description: `Onaylı talebin kalanı olan kalemlerinden taslak satın alma talebi açar (DOM-FIN-071; K-246): kalem adı "ad (kod)", miktar kalan, birim kartın birimi, stok kartı bağı (ON-339), gerekçe "Sarf talebi SM-…: …". Gövde talep eden birim, bütçe dönemi, gider kalemi, isteğe bağlı tedarikçi ve kalanı olan her kalemin tahmini birim fiyatı (\`prices[].itemId\`; eksikse 400 \`prices\`). Satın alma talebi kuralları aynen işler (ör. 422 \`purchase_request_period_closed\`). Açık (taslak, gönderilmiş, onaylı) bağ varsa 409 \`supply_request_already_converted\`; kalan yoksa 422 \`supply_request_nothing_remaining\`. İki talep birbirine bağlanır; satın alma ayrıntısında \`supplyRequest\` görünür. \`Idempotency-Key\` zorunlu; ${IF_MATCH} ${KEEPER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: supplyRequestParams,
        body: convertSupplyRequestSchema,
        response: { 200: supplyRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await convertSupplyRequestCommand(
        contextOf(request),
        request.params.requestId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return supplyRequestResponse.parse(sendBody(reply, result))
    },
  )
}
