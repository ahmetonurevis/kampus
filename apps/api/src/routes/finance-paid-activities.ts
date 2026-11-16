import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  cancelPaidActivitySchema,
  joinPaidActivitySchema,
  PAID_ACTIVITY_JOIN_ROLES,
  PAID_ACTIVITY_MANAGE_ROLES,
  PAID_ACTIVITY_READ_ROLES,
  paidActivitySchema,
  updatePaidActivitySchema,
} from '@kampus/school-core/lib/finance-paid-activities.ts'
import { payRefundSchema } from '@kampus/school-core/lib/withdrawals.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelPaidActivityCommand,
  cancelParticipationCommand,
  createPaidActivityCommand,
  getPaidActivityFor,
  joinPaidActivityCommand,
  listPaidActivitiesFor,
  listParticipantsFor,
  payParticipationRefundCommand,
  updatePaidActivityCommand,
} from '../services/finance-paid-activities.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  paidActivityListResponse,
  paidActivityParams,
  paidActivityQuery,
  paidActivityResponse,
  participantListResponse,
  participantParams,
  participantQuery,
  participantResponse,
} from './finance-paid-activities.schemas.ts'

/**
 * Gezi ve etkinlik ücreti uçları (docs/domain/finans.md DOM-FIN-098; ON-142; K-300…K-303). Modül
 * `finance`. Okuma, katılım ve katılım iptali yönetici ve ön büro; etkinlik tanımı, düzeltmesi,
 * iptali ve iade ödemesi yalnız yönetici. Katılım taksit açtığı, iptaller taksit kapatıp iade
 * kaydı yazdığı, iade ödemesi para çıkışı olduğu için bu uçlarda `Idempotency-Key` zorunludur;
 * iade ödemesi taze oturum ister.
 */

const READERS = 'Roller: `yonetici`, `onburo` (K-300). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-300). Modül `finance`.'
const ACTIVITIES = '/api/v1/finance/paid-activities'
const PARTICIPANTS = '/api/v1/finance/paid-activity-participants'
const tags = ['finance-paid-activities']

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinancePaidActivityRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]

  typed.get(
    ACTIVITIES,
    {
      preValidation: guarded(PAID_ACTIVITY_READ_ROLES),
      schema: {
        operationId: 'listPaidActivities',
        tags,
        summary: 'Ücretli gezi ve etkinlikleri listele',
        description: `Yeni etkinlik günü önce; iptal edilenler dahil (\`status\` ile süzülür). Satırda iptal edilmemiş katılımcı ve ödenmemiş iade sayısı (DOM-FIN-098). ${READERS}`,
        querystring: paidActivityQuery,
        response: { 200: paidActivityListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status } = request.query
      const { items, total } = await listPaidActivitiesFor(contextOf(request), {
        page,
        pageSize,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    ACTIVITIES,
    {
      preValidation: [...guarded(PAID_ACTIVITY_MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPaidActivity',
        tags,
        summary: 'Ücretli gezi ya da etkinlik tanımla',
        description: `Ad, tür (\`trip\`, \`event\`), gün (geçmiş olamaz: 422 \`paid_activity_date_past\`), kişi başı ücret, son katılım ve son iptal günü (etkinlik gününden sonra olamaz), kontenjan ve geç iptalin kuralı: \`percent\` (\`lateRefundPercent\` 0–100 iade) ya da \`cost\` (\`lateCostCents\` kişi başı masraf düşülür, en çok ücret). İsteğe bağlı \`externalRef\` gezi planına bağlanacak alandır (K-300). Ücret, gün ve iade koşulları sonradan değişmez. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: paidActivitySchema,
        response: { 201: paidActivityResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPaidActivityCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = paidActivityResponse.parse(sendBody(reply, result))
      reply.header('location', `${ACTIVITIES}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${ACTIVITIES}/:activityId`,
    {
      preValidation: guarded(PAID_ACTIVITY_READ_ROLES),
      schema: {
        operationId: 'getPaidActivity',
        tags,
        summary: 'Etkinlik ayrıntısı',
        description: `Olmayan ya da başka kurumun etkinliği 404. ${READERS}`,
        params: paidActivityParams,
        response: { 200: paidActivityResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getPaidActivityFor(contextOf(request), request.params.activityId),
    }),
  )

  typed.patch(
    `${ACTIVITIES}/:activityId`,
    {
      preValidation: [...guarded(PAID_ACTIVITY_MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updatePaidActivity',
        tags,
        summary: 'Etkinliği düzelt',
        description: `Ad, kontenjan (katılımcı sayısının altına inemez: 422 \`paid_activity_capacity_below_participants\`), son katılım günü (etkinlik gününü geçemez: 422 \`paid_activity_join_after_date\`) ve dış referans. İptal edilmiş etkinlik 409 \`paid_activity_cancelled\`; değişiklik yoksa 422 \`paid_activity_unchanged\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: paidActivityParams,
        body: updatePaidActivitySchema,
        response: { 200: paidActivityResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updatePaidActivityCommand(
        contextOf(request),
        request.params.activityId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return paidActivityResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ACTIVITIES}/:activityId/cancel`,
    {
      preValidation: [...guarded(PAID_ACTIVITY_MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelPaidActivity',
        tags,
        summary: 'Etkinliği kurum adına iptal et',
        description: `Gerekçeyle (5–500 karakter). Bütün iptal edilmemiş katılımlar tam iadeyle kapanır: ödenmemiş taksit kapanır, alınan tutar iade kaydı olur (K-302). İptal edilmiş etkinlik 409 \`paid_activity_cancelled\`; okumadan sonra katılım eklendiyse 409. \`If-Match\` ve \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: paidActivityParams,
        body: cancelPaidActivitySchema,
        response: { 200: paidActivityResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await cancelPaidActivityCommand(
        contextOf(request),
        request.params.activityId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return paidActivityResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${ACTIVITIES}/:activityId/participants`,
    {
      preValidation: guarded(PAID_ACTIVITY_READ_ROLES),
      schema: {
        operationId: 'listPaidActivityParticipants',
        tags,
        summary: 'Katılımcılar ve ödeme durumu',
        description: `Önce iptal edilmemiş katılımlar, ada göre. Satırda taksit tutarı, alınan tutar ve ödeme durumu (taksit ve iptal edilmemiş tahsilattan türetilir, DOM-FIN-030), iptal edilmişte kesinti, iade ve iade durumu; IBAN yalnız son dört hane. Olmayan ya da başka kurumun etkinliği 404. ${READERS}`,
        params: paidActivityParams,
        querystring: participantQuery,
        response: { 200: participantListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listParticipantsFor(
        contextOf(request),
        request.params.activityId,
        { page, pageSize, ...filters },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${ACTIVITIES}/:activityId/participants`,
    {
      preValidation: [...guarded(PAID_ACTIVITY_JOIN_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'joinPaidActivity',
        tags,
        summary: 'Öğrenciyi etkinliğe yaz',
        description: `Öğrenciye kişi başı ücret kadar sözleşmesiz taksit açar (\`feeKind: activity\`, vade son katılım günü; K-301); veli ekranında borç olarak görünür. İptal edilmiş etkinlik 409 \`paid_activity_cancelled\`, son katılım günü geçtiyse 422 \`paid_activity_join_closed\`, olmayan ya da etkin olmayan öğrenci 422 \`paid_activity_student_not_found\`, iptal edilmemiş katılımı olan öğrenci 409 \`paid_activity_participant_exists\`, kontenjan doluysa 409 \`paid_activity_full\`. \`Idempotency-Key\` zorunlu. Olmayan ya da başka kurumun etkinliği 404. ${READERS}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: paidActivityParams,
        body: joinPaidActivitySchema,
        response: { 201: participantResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await joinPaidActivityCommand(
        contextOf(request),
        request.params.activityId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return participantResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${PARTICIPANTS}/:participantId/cancel`,
    {
      preValidation: [...guarded(PAID_ACTIVITY_JOIN_ROLES), requireIfMatch()],
      schema: {
        operationId: 'cancelPaidActivityParticipation',
        tags,
        summary: 'Katılımı iptal et',
        description: `Son iptal gününe kadar (dahil) tam iade; sonra etkinliğin kuralı: oran kadar iade ya da kişi başı masraf düşülür (K-302). Tam ödenmiş taksit kalır, ödenenin kesintiyi aşan kısmı iade kaydı olur; bütünüyle ödenmemiş taksit kapanır, alınan tutar kesintiyi aşarsa fark iade edilir, azsa kalan kesinti bugün vadeli yeni taksit olur. İptal edilmiş katılım 409 \`paid_activity_participation_cancelled\`. \`If-Match\` ve \`Idempotency-Key\` zorunlu. ${READERS}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: participantParams,
        response: { 200: participantResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await cancelParticipationCommand(
        contextOf(request),
        request.params.participantId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return participantResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${PARTICIPANTS}/:participantId/pay-refund`,
    {
      preValidation: [
        ...guarded(PAID_ACTIVITY_MANAGE_ROLES),
        app.requireFreshSession,
        requireIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'payPaidActivityRefund',
        tags,
        summary: 'Katılım iadesini ödenmiş işaretle',
        description: `Ayrılış iadesinin kurallarıyla (DOM-FIN-041, K-303): hesap sahibi öğrencinin kayıtlı velisi (velisi yoksa kendisi) değilse 422 \`refund_holder_mismatch\`, kurum hesabı geçersizse 422 \`refund_bank_account_invalid\`, ödeme günü kapatılmışsa 422 \`finance_day_closed\`, iptal gününden önce 422 \`paid_activity_refund_before_cancel\`, iade yoksa 409 \`paid_activity_refund_not_due\`, ödenmişse 409 \`refund_already_paid\`. İade ödeme gününün gün sonuna girer (M-13). Taze oturum; \`If-Match\` ve \`Idempotency-Key\` zorunlu; anahtar kaydı maskeli IBAN ve hesap sahibini saklamaz. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: participantParams,
        body: payRefundSchema,
        response: { 200: participantResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await payParticipationRefundCommand(
        contextOf(request),
        request.params.participantId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return participantResponse.parse(sendBody(reply, result))
    },
  )
}
