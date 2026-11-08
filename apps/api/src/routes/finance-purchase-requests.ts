import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  approvePurchaseRequestSchema,
  cancelPurchaseRequestSchema,
  PURCHASE_REQUEST_DECISION_ROLES,
  PURCHASE_REQUEST_ROLES,
  purchaseRequestSchema,
  rejectPurchaseRequestSchema,
  updatePurchaseRequestSchema,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  createPurchaseRequestCommand,
  getPurchaseRequestFor,
  listPurchaseRequestsFor,
  purchaseRequestOptionsFor,
  transitionPurchaseRequestCommand,
  updatePurchaseRequestCommand,
} from '../services/finance-purchase-requests.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  purchaseRequestListQuery,
  purchaseRequestListResponse,
  purchaseRequestOptionsResponse,
  purchaseRequestParams,
  purchaseRequestResponse,
} from './finance-purchase-requests.schemas.ts'

/**
 * Satın alma talebi uçları (docs/domain/finans.md DOM-FIN-071; ON-222). Modül `finance`. Açma,
 * düzeltme, gönderme ve iptal yönetici ile ön büro (ön büro yalnız kendi talebi, 403
 * `purchase_request_not_owner`; K-128); onay ve ret yalnız yönetici (K-129). Kademeli onay
 * ON-223'tedir. Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 */

const STAFF =
  'Roller: `yonetici`, `onburo`; ön büro yalnız kendi açtığı talebi değiştirir (K-128). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-129). Modül `finance`.'
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
  submit: {
    operationId: 'submitPurchaseRequest',
    summary: 'Satın alma talebini gönder',
    description:
      'Taslak talebi onaya gönderir. Bütçe dönemi açık olmalıdır: 422 `purchase_request_period_not_open`; merkez, kalem ya da tedarikçi pasifleşmişse 422. Yanıt bütçe kalanını bilgi olarak taşır, aşım engellenmez (K-131, ON-245).',
    roles: PURCHASE_REQUEST_ROLES,
    body: null,
    who: STAFF,
  },
  approve: {
    operationId: 'approvePurchaseRequest',
    summary: 'Satın alma talebini onayla',
    description:
      'Gönderilmiş talebi onaylar; isteğe bağlı not. Gönderilmemiş talep 422 `purchase_request_not_submitted`, dönem açık değilse 422 `purchase_request_period_not_open`. Onaylı talep bugün sipariş ya da gider gerçekleşeni üretmez.',
    roles: PURCHASE_REQUEST_DECISION_ROLES,
    body: approvePurchaseRequestSchema,
    who: MANAGER,
  },
  reject: {
    operationId: 'rejectPurchaseRequest',
    summary: 'Satın alma talebini reddet',
    description:
      'Gönderilmiş talebi gerekçeyle reddeder. Gönderilmemiş talep 422 `purchase_request_not_submitted`.',
    roles: PURCHASE_REQUEST_DECISION_ROLES,
    body: rejectPurchaseRequestSchema,
    who: MANAGER,
  },
  cancel: {
    operationId: 'cancelPurchaseRequest',
    summary: 'Satın alma talebini iptal et',
    description:
      'Taslak ya da gönderilmiş talebi gerekçeyle iptal eder; onaylanmış ya da reddedilmiş talep 422 `purchase_request_not_cancellable` (K-132).',
    roles: PURCHASE_REQUEST_ROLES,
    body: cancelPurchaseRequestSchema,
    who: STAFF,
  },
} as const

export function registerFinancePurchaseRequestRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]
  const tags = ['finance-procurement']

  typed.get(
    '/api/v1/finance/purchase-requests',
    {
      preValidation: guarded(PURCHASE_REQUEST_ROLES),
      schema: {
        operationId: 'listPurchaseRequests',
        tags,
        summary: 'Satın alma taleplerini listele',
        description: `Yeni açılan önce; durum, birim ve dönemle süzülür, \`q\` numarada, gerekçede ya da birim adında arar. Toplam kalemlerden hesaplanır (DOM-FIN-071). Ön büro kurumun bütün taleplerini görür. ${STAFF}`,
        querystring: purchaseRequestListQuery,
        response: { 200: purchaseRequestListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listPurchaseRequestsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/purchase-requests/options',
    {
      preValidation: guarded(PURCHASE_REQUEST_ROLES),
      schema: {
        operationId: 'getPurchaseRequestOptions',
        tags,
        summary: 'Satın alma talebi formu seçenekleri',
        description: `Etkin maliyet merkezleri, etkin gider kalemleri, kapalı olmayan bütçe dönemleri ve etkin tedarikçiler; yalnız kimlik, kod ve ad (bütçe planı yöneticidedir, K-60). ${STAFF}`,
        response: { 200: purchaseRequestOptionsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await purchaseRequestOptionsFor(contextOf(request)) }),
  )

  typed.post(
    '/api/v1/finance/purchase-requests',
    {
      preValidation: [...guarded(PURCHASE_REQUEST_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPurchaseRequest',
        tags,
        summary: 'Satın alma talebi aç',
        description: `Taslak açar: etkin maliyet merkezi, kapalı olmayan bütçe dönemi, etkin gider kalemi, gerekçe, isteğe bağlı etkin tedarikçi ve 1–50 kalem (ad, tam sayı miktar, birim, kuruş tahmini birim fiyat). Bağlı kayıt yok ya da uygun değilse 422 (\`purchase_request_period_closed\`, \`purchase_request_cost_center_inactive\`, \`purchase_request_budget_item_not_expense\`, \`purchase_request_supplier_inactive\` …). ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: purchaseRequestSchema,
        response: { 201: purchaseRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPurchaseRequestCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = purchaseRequestResponse.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/finance/purchase-requests/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/finance/purchase-requests/:requestId',
    {
      preValidation: guarded(PURCHASE_REQUEST_ROLES),
      schema: {
        operationId: 'getPurchaseRequest',
        tags,
        summary: 'Satın alma talebi ayrıntısı',
        description: `Kalemler, bütçe kalanı bilgisi (plan, onaylanmış ve bekleyen talepler, kalan; K-131), karar ve iptal izi, kullanıcının yapabileceği işlemler. Olmayan ya da başka kurumun talebi 404. ${STAFF}`,
        params: purchaseRequestParams,
        response: { 200: purchaseRequestResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getPurchaseRequestFor(contextOf(request), request.params.requestId),
    }),
  )

  typed.patch(
    '/api/v1/finance/purchase-requests/:requestId',
    {
      preValidation: [...guarded(PURCHASE_REQUEST_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updatePurchaseRequest',
        tags,
        summary: 'Taslak talebi düzelt',
        description: `Kısmi düzeltme; kalemler bütün olarak yazılır. Taslak olmayan talep 422 \`purchase_request_not_draft\`. ${IF_MATCH} ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: purchaseRequestParams,
        body: updatePurchaseRequestSchema,
        response: { 200: purchaseRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updatePurchaseRequestCommand(
        contextOf(request),
        request.params.requestId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return purchaseRequestResponse.parse(sendBody(reply, result))
    },
  )

  for (const [verb, spec] of Object.entries(TRANSITIONS) as [
    keyof typeof TRANSITIONS,
    (typeof TRANSITIONS)[keyof typeof TRANSITIONS],
  ][]) {
    typed.post(
      `/api/v1/finance/purchase-requests/:requestId/${verb}`,
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
          params: purchaseRequestParams,
          ...(spec.body === null ? {} : { body: spec.body }),
          response: { 200: purchaseRequestResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await transitionPurchaseRequestCommand(
          contextOf(request),
          request.params.requestId,
          verb,
          spec.body === null ? {} : request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return purchaseRequestResponse.parse(sendBody(reply, result))
      },
    )
  }
}
