import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  cancelPurchaseOrderSchema,
  createPurchaseOrderSchema,
  PURCHASE_ORDER_MANAGE_ROLES,
  PURCHASE_ORDER_ROLES,
} from '@kampus/school-core/lib/finance-purchase-orders.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  createPurchaseOrderCommand,
  getPurchaseOrderFor,
  listPurchaseOrdersFor,
  transitionPurchaseOrderCommand,
} from '../services/finance-purchase-orders.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  purchaseOrderListQuery,
  purchaseOrderListResponse,
  purchaseOrderParams,
  purchaseOrderResponse,
} from './finance-purchase-orders.schemas.ts'

/**
 * Satın alma siparişi uçları (docs/domain/finans.md DOM-FIN-073; ON-225). Modül `finance`. Okuma ve
 * gönderildi işareti yönetici ile ön büro; açma ve iptal yalnız yönetici (K-141). Tedarikçiye
 * e-posta gönderilmez (K-142). Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 */

const STAFF = 'Roller: `yonetici`, `onburo` (K-141). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-141). Modül `finance`.'
const IF_MATCH = '`If-Match` zorunlu; sürüm tutmazsa 409 `version_conflict`.'

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
  send: {
    operationId: 'sendPurchaseOrder',
    summary: 'Siparişi gönderildi işaretle',
    description:
      'Taslak siparişi gönderildi işaretler; PDF tedarikçiye kurum dışından iletilir, e-posta gönderilmez (K-142). Taslak olmayan sipariş 422 `purchase_order_not_draft`. Beklenen teslim günü gönderim gününden hesaplanır.',
    roles: PURCHASE_ORDER_ROLES,
    body: null,
    who: STAFF,
  },
  cancel: {
    operationId: 'cancelPurchaseOrder',
    summary: 'Siparişi iptal et',
    description:
      'Taslak ya da gönderilmiş siparişi gerekçeyle iptal eder; numara boşta kalır, talep yeniden teklif ve seçime açılır (K-140). Teslim alınmaya başlanan sipariş 422 `purchase_order_not_cancellable`.',
    roles: PURCHASE_ORDER_MANAGE_ROLES,
    body: cancelPurchaseOrderSchema,
    who: MANAGER,
  },
} as const

export function registerFinancePurchaseOrderRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]
  const tags = ['finance-procurement']

  typed.get(
    '/api/v1/finance/purchase-orders',
    {
      preValidation: guarded(PURCHASE_ORDER_ROLES),
      schema: {
        operationId: 'listPurchaseOrders',
        tags,
        summary: 'Satın alma siparişlerini listele',
        description: `Yeni numara önce; durum, tedarikçi ve taleple süzülür, \`q\` numarada ya da tedarikçi adında arar. Tutarlar kalemlerden hesaplanır (K-138). ${STAFF}`,
        querystring: purchaseOrderListQuery,
        response: { 200: purchaseOrderListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listPurchaseOrdersFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/purchase-orders',
    {
      preValidation: [...guarded(PURCHASE_ORDER_MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPurchaseOrder',
        tags,
        summary: 'Seçili tekliften sipariş aç',
        description: `Onaylı talebin seçili ve geçerliliği geçmemiş teklifinden taslak sipariş açar; tedarikçi ve kalemler bu anın kopyasıdır. Numara \`SA-<yıl>-<sıra>\`, yıl Europe/Istanbul (K-139). Talepte etkin sipariş varsa 409 \`purchase_order_exists\` (K-140); teklif yok 422 \`purchase_order_quote_not_found\`, seçili değil 422 \`purchase_order_quote_not_selected\`, süresi geçti 422 \`purchase_quote_expired\`, tedarikçi pasif 422 \`purchase_order_supplier_inactive\`. \`Idempotency-Key\` zorunlu; aynı anahtar ilk yanıtı tekrarlar. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: createPurchaseOrderSchema,
        response: { 201: purchaseOrderResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPurchaseOrderCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = purchaseOrderResponse.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/finance/purchase-orders/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/finance/purchase-orders/:orderId',
    {
      preValidation: guarded(PURCHASE_ORDER_ROLES),
      schema: {
        operationId: 'getPurchaseOrder',
        tags,
        summary: 'Satın alma siparişi ayrıntısı',
        description: `Tedarikçi kopyası (şahıs TCKN'si ön büroya maskeli), kalemler, KDV dökümü, toplam, beklenen teslim günü, iz ve kullanıcının yapabileceği işlemler; sipariş PDF'i bu yanıttan üretilir. Olmayan ya da başka kurumun siparişi 404. ${STAFF}`,
        params: purchaseOrderParams,
        response: { 200: purchaseOrderResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getPurchaseOrderFor(contextOf(request), request.params.orderId),
    }),
  )

  for (const [verb, spec] of Object.entries(TRANSITIONS) as [
    keyof typeof TRANSITIONS,
    (typeof TRANSITIONS)[keyof typeof TRANSITIONS],
  ][]) {
    typed.post(
      `/api/v1/finance/purchase-orders/:orderId/${verb}`,
      {
        preValidation: [
          ...guarded(spec.roles),
          requireIfMatch(),
          ...(spec.body === null ? [] : [captureInput()]),
        ],
        schema: {
          operationId: spec.operationId,
          tags,
          summary: spec.summary,
          description: `${spec.description} ${IF_MATCH} ${spec.who}`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: purchaseOrderParams,
          ...(spec.body === null ? {} : { body: spec.body }),
          response: { 200: purchaseOrderResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await transitionPurchaseOrderCommand(
          contextOf(request),
          request.params.orderId,
          verb,
          spec.body === null ? {} : request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return purchaseOrderResponse.parse(sendBody(reply, result))
      },
    )
  }
}
