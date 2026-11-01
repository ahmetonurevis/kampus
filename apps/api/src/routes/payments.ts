import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  paymentSettingsSchema,
  recordPaymentSchema,
  reversePaymentSchema,
} from '@kampus/school-core/lib/payments.ts'

import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  getPaymentFor,
  getPaymentSettings,
  listPaymentsFor,
  recordPaymentCommand,
  reversePaymentCommand,
  setPaymentSettings,
} from '../services/payments.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  paymentListQuerySchema,
  paymentListResponseSchema,
  paymentParamsSchema,
  paymentResponseSchema,
  paymentSettingsResponseSchema,
} from './payments.schemas.ts'

/**
 * Tahsilat uçları (ADR 0006; docs/domain/finans.md DOM-FIN-030…033, DOM-FIN-052). Modül `finance`.
 * Kayıt yönetici ve ön büro, iptal ve nakit ayarı yalnız yönetici; veli ve öğrenci kapsamındaki
 * öğrencilerin tahsilatını okur, öğretmenin finans erişimi yoktur.
 *
 * TODO(payment-provider): velinin çevrim içi ödemesi (core `invoice.payOnline`) sağlayıcı seçilince
 * ayrı uçla bağlanır; o zamana kadar uç yoktur.
 */

const FINANCE_READERS = ['yonetici', 'onburo', 'veli', 'ogrenci'] as const

/** Bu uçların gövdesi `CommandResult` değildir; durum ve tekrar başlığı burada yazılır. */
function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerPaymentRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')

  function writeGuard(
    roles: Parameters<FastifyInstance['requireRole']>[0],
    ifMatch: 'reject' | 'required',
  ): preValidationAsyncHookHandler[] {
    return [
      app.authenticate,
      finance,
      app.requireRole(roles),
      ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
      captureInput(),
    ]
  }
  const readGuard = (roles: Parameters<FastifyInstance['requireRole']>[0]) => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]

  typed.get(
    '/api/v1/payments',
    {
      preValidation: readGuard([...FINANCE_READERS]),
      schema: {
        operationId: 'listPayments',
        tags: ['payments'],
        summary: 'Tahsilatları listele',
        description:
          'Tahsilatları dağılımlarıyla, en yeni ödeme önce listeler. Yönetici ve ön büro kurumun tamamını, veli ve öğrenci yalnız kapsamındaki öğrencileri görür; iptal gerekçesi yalnız personele döner (DOM-FIN-052). Sayfalıdır, `pageSize` en çok 100; bilinmeyen parametre 400.',
        querystring: paymentListQuerySchema,
        response: { 200: paymentListResponseSchema, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listPaymentsFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/payments/:paymentId',
    {
      preValidation: readGuard([...FINANCE_READERS]),
      schema: {
        operationId: 'getPayment',
        tags: ['payments'],
        summary: 'Tahsilat ayrıntısı',
        description:
          'Tek tahsilat ve dağılımı. Başka kurumun veya kapsam dışı öğrencinin tahsilatı 404.',
        params: paymentParamsSchema,
        response: { 200: paymentResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getPaymentFor(contextOf(request), request.params.paymentId),
    }),
  )

  typed.post(
    '/api/v1/payments',
    {
      preValidation: writeGuard(['yonetici', 'onburo'], 'reject'),
      schema: {
        operationId: 'recordPayment',
        tags: ['payments'],
        summary: 'Tahsilat kaydet',
        description:
          'Tahsilatı ayrı kayıt olarak yazar ve önce `invoiceId` ile seçilen taksite, sonra en eski vadeye dağıtır; kısmi ödeme kabul edilir, açık taksitleri aşan kısım `creditCents` olarak iade alacağıdır (DOM-FIN-030). Açık taksit yoksa 409 `no_open_installments`, ödenmiş taksit seçilirse 409 `invoice_already_paid`. Nakit dışı yöntemde `reference` zorunlu (422 `payment_reference_required`); kullanılmış referans 409 `payment_reference_used` (DOM-FIN-031). Nakit kurumda kapalıysa 422 `cash_payment_disabled` (DOM-FIN-032). İleri tarih 422 `payment_date_in_future`. Olmayan veya başka kurumun öğrencisi 404. Gövde katıdır. `Idempotency-Key` zorunludur: aynı anahtar ikinci tahsilat açmaz, ilk yanıtı döner. Başarı 201 ve `Location`. Roller: `yonetici`, `onburo`.',
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: recordPaymentSchema,
        response: { 201: paymentResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await recordPaymentCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required'),
      )
      const body = paymentResponseSchema.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/payments/${body.data.id}`)
      return body
    },
  )

  typed.post(
    '/api/v1/payments/:paymentId/reverse',
    {
      preValidation: writeGuard(['yonetici'], 'required'),
      schema: {
        operationId: 'reversePayment',
        tags: ['payments'],
        summary: 'Tahsilatı iptal et',
        description:
          'Tahsilat silinmez ve tutarı değişmez; gerekçeyle iptal edilir, dağıtıldığı taksitler yeniden açılır (DOM-FIN-033). İptal edilmiş tahsilat 409 `payment_already_reversed`; ayrılış kaydı olan öğrencinin tahsilatı 409 `payment_student_withdrawn` (iade hesabı bu tahsilata dayanır, DOM-FIN-041). `If-Match` zorunludur (tahsilatın sürümü): eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. `Idempotency-Key` zorunludur. Olmayan veya başka kurumun tahsilatı 404. Rol: `yonetici`.',
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: paymentParamsSchema,
        body: reversePaymentSchema,
        response: { 200: paymentResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { idempotency, expectedVersion } = options(request, 'required')
      if (expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await reversePaymentCommand(
        contextOf(request),
        request.params.paymentId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return paymentResponseSchema.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/payment-settings',
    {
      preValidation: readGuard(['yonetici', 'onburo']),
      schema: {
        operationId: 'getPaymentSettings',
        tags: ['payments'],
        summary: 'Tahsilat ayarları',
        description: 'Kurumda nakit tahsilatın açık olup olmadığı ve ayar sürümü.',
        response: { 200: paymentSettingsResponseSchema, ...commandErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      return { data: await getPaymentSettings(ctx.db, ctx.institutionId) }
    },
  )

  typed.patch(
    '/api/v1/payment-settings',
    {
      preValidation: writeGuard(['yonetici'], 'required'),
      schema: {
        operationId: 'setPaymentSettings',
        tags: ['payments'],
        summary: 'Nakit tahsilatı aç veya kapat',
        description:
          'Kurumda nakit tahsilatı açar veya kapatır; varsayılan kapalıdır (ADR 0006, DOM-FIN-032). Değişiklik denetim kaydına yazılır, geçmiş tahsilatlar değişmez. `If-Match` (`GET` yanıtındaki sürüm; ayar hiç değişmediyse 1) ve `Idempotency-Key` zorunludur. Rol: `yonetici`.',
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        body: paymentSettingsSchema,
        response: { 200: paymentSettingsResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { idempotency, expectedVersion } = options(request, 'required')
      if (expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await setPaymentSettings(
        contextOf(request),
        paymentSettingsSchema.parse(request.commandInput),
        expectedVersion,
        idempotency,
      )
      return paymentSettingsResponseSchema.parse(sendBody(reply, result))
    },
  )
}
