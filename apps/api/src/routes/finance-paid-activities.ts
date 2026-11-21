import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
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
import {
  bulkJoinPaidActivitySchema,
  cancelWithdrawnLeftoversSchema,
  grantConsentSchema,
  withdrawConsentSchema,
} from '@kampus/school-core/lib/finance-paid-activity-participants.ts'
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
import {
  bulkJoinPaidActivityCommand,
  cancelWithdrawnLeftoversCommand,
  grantConsentCommand,
  listWithdrawnLeftoversFor,
  paidActivityRosterCsvFor,
  paidActivityRosterFor,
  syncConsentsCommand,
} from '../services/finance-paid-activity-participants.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  bulkJoinResponse,
  consentSyncResponse,
  paidActivityListResponse,
  paidActivityParams,
  paidActivityQuery,
  paidActivityResponse,
  participantListResponse,
  participantParams,
  participantQuery,
  participantResponse,
  rosterResponse,
  withdrawnLeftoverCancelResponse,
  withdrawnLeftoverListResponse,
  withdrawnLeftoverQuery,
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
const ROSTER_PER_MINUTE = 10
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
        description: `Ad, tür (\`trip\`, \`event\`), gün (geçmiş olamaz: 422 \`paid_activity_date_past\`), kişi başı ücret, son katılım ve son iptal günü (etkinlik gününden sonra olamaz), kontenjan ve geç iptalin kuralı: \`percent\` (\`lateRefundPercent\` 0–100 iade) ya da \`cost\` (\`lateCostCents\` kişi başı masraf düşülür, en çok ücret). İsteğe bağlı \`externalRef\` gezi planına bağlanacak alandır (K-300). \`requiresConsent\` katılımı veli iznine bağlar; \`permissionFormId\` iznin okunacağı dijital izin formudur (yalnız izin isteyen etkinlikte; iletişim modülü kapalı, form yok, iptal ya da arşivse 422 \`paid_activity_permission_form_not_found\`; K-370). Ücret, gün ve iade koşulları sonradan değişmez. ${MANAGER}`,
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
        description: `Ad, kontenjan (yer tutan katılım sayısının altına inemez: 422 \`paid_activity_capacity_below_participants\`; artarsa yedekler sırayla asile geçer, K-369), izin formu (\`permissionFormId\`; yalnız veli izni isteyen etkinlikte, değilse 422 \`paid_activity_consent_not_required\`; kullanılamıyorsa 422 \`paid_activity_permission_form_not_found\`), son katılım günü (etkinlik gününü geçemez: 422 \`paid_activity_join_after_date\`) ve dış referans. İptal edilmiş etkinlik 409 \`paid_activity_cancelled\`; değişiklik yoksa 422 \`paid_activity_unchanged\`. \`If-Match\` zorunlu. ${MANAGER}`,
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
        description: `Önce asiller (izin bekleyenler dahil) ada göre, sonra yedekler sıralarına göre, en son iptaller; \`status\` (\`active\`, \`awaiting_consent\`, \`waitlisted\`, \`cancelled\`), \`consentStatus\` ve \`refundStatus\` süzer (DOM-FIN-112). Satırda sınıf, yedek sırası, veli izni ve bağlı izin formundaki durum (\`permissionStatus\`). Satırda taksit tutarı, alınan tutar ve ödeme durumu (taksit ve iptal edilmemiş tahsilattan türetilir, DOM-FIN-030), iptal edilmişte kesinti, iade ve iade durumu; IBAN yalnız son dört hane. Olmayan ya da başka kurumun etkinliği 404. ${READERS}`,
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
        description: `Kontenjanda yer varsa asil: öğrenciye kişi başı ücret kadar sözleşmesiz taksit açar (\`feeKind: activity\`, vade son katılım günü; K-301), veli ekranında borç olarak görünür; etkinlik veli izni istiyorsa katılım \`awaiting_consent\` olur, taksit izinle açılır (K-370). Kontenjan doluysa sıra numarasıyla yedek (\`waitlisted\`, taksit yok; K-369); yedek listesi doluysa (500) 409 \`paid_activity_waitlist_full\`. İptal edilmiş etkinlik 409 \`paid_activity_cancelled\`, son katılım günü geçtiyse 422 \`paid_activity_join_closed\`, olmayan ya da etkin olmayan öğrenci 422 \`paid_activity_student_not_found\`, iptal edilmemiş katılımı olan öğrenci 409 \`paid_activity_participant_exists\`. \`Idempotency-Key\` zorunlu. Olmayan ya da başka kurumun etkinliği 404. ${READERS}`,
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
        description: `Yer boşalırsa en küçük sıra numaralı yedek aynı işlemde asile geçer, taksiti o anda açılır (K-369). Taksiti olmayan (yedek, izin bekleyen) katılım parasız kapanır. Son iptal gününe kadar (dahil) tam iade; sonra etkinliğin kuralı: oran kadar iade ya da kişi başı masraf düşülür (K-302). Tam ödenmiş taksit kalır, ödenenin kesintiyi aşan kısmı iade kaydı olur; bütünüyle ödenmemiş taksit kapanır, alınan tutar kesintiyi aşarsa fark iade edilir, azsa kalan kesinti bugün vadeli yeni taksit olur. İptal edilmiş katılım 409 \`paid_activity_participation_cancelled\`. \`If-Match\` ve \`Idempotency-Key\` zorunlu. ${READERS}`,
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

  typed.post(
    `${ACTIVITIES}/:activityId/participants/bulk`,
    {
      preValidation: [...guarded(PAID_ACTIVITY_JOIN_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'bulkJoinPaidActivity',
        tags,
        summary: 'Sınıf seçerek toplu katılım yaz',
        description: `Seçilen sınıfların (1–20) etkin öğrencileri ada göre yazılır: kontenjan dolana kadar asil (taksit açılır; veli izni isteyen etkinlikte izin bekliyor), aşan kısım sıra numarasıyla yedek; zaten katılımı olan atlanır (K-371, K-369). Sınıf yoksa 422 \`paid_activity_class_not_found\`, öğrenci yoksa 422 \`paid_activity_bulk_empty\`, 500'den fazlaysa 422 \`paid_activity_bulk_too_large\`, yedek listesi dolarsa hiçbiri yazılmaz (409 \`paid_activity_waitlist_full\`). \`Idempotency-Key\` zorunlu. Olmayan ya da başka kurumun etkinliği 404. ${READERS}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: paidActivityParams,
        body: bulkJoinPaidActivitySchema,
        response: { 201: bulkJoinResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await bulkJoinPaidActivityCommand(
        contextOf(request),
        request.params.activityId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return bulkJoinResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ACTIVITIES}/:activityId/consents/sync`,
    {
      preValidation: [...guarded(PAID_ACTIVITY_JOIN_ROLES), rejectIfMatch()],
      schema: {
        operationId: 'syncPaidActivityConsents',
        tags,
        summary: 'Veli izinlerini izin formundan eşitle',
        description: `Bağlı dijital izin formunda (IST-067) onaylananların izni alınır, izin bekleyen asilin taksiti açılır; formda reddedilenlerin (izin bekleyen ya da izni formdan gelmiş) katılımı K-302 kuralıyla iptal edilir, boşalan yere yedek geçer (K-370, K-369). Elle girilen izin formdaki retle düşmez. Etkin olmayan (ayrılmış ya da mezun) öğrencinin yedek ve izin bekleyen katılımı formdan bağımsız parasız iptal edilir, izni alınmaz, taksit açılmaz (\`inactiveCancelledCount\`; günü geçmiş etkinlikte yapılmaz; K-418). Form bağlı değilse 422 \`paid_activity_permission_form_missing\`, kullanılamıyorsa 422 \`paid_activity_permission_form_not_found\`. \`Idempotency-Key\` zorunlu. ${READERS}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: paidActivityParams,
        response: { 200: consentSyncResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await syncConsentsCommand(
        contextOf(request),
        request.params.activityId,
        options(request, 'required').idempotency,
      )
      return consentSyncResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${ACTIVITIES}/:activityId/roster`,
    {
      config: {
        rateLimit: {
          max: ROSTER_PER_MINUTE,
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            `paid-activity-roster:${request.auth?.userId ?? request.ip}`,
        },
      },
      preValidation: [...guarded(PAID_ACTIVITY_READ_ROLES), app.requireFreshSession],
      schema: {
        operationId: 'getPaidActivityRoster',
        tags,
        summary: 'Basılabilir katılım listesi',
        description: `İptal edilmemiş katılımlar: asiller ada göre, sonra yedekler sırasıyla; öğrenci, sınıf, veli telefonu (yalnız maskeli), katılım, veli izni ve ödeme (K-371). Web PDF'i bu veriden üretir. \`Accept: text/csv\` aynı listeyi CSV verir (\`;\` ayırıcı, UTF-8 BOM, formül kaçışı). Tam telefon, IBAN ve izni verenin adı dönmez. Öğrenci adı taşıdığı için taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk, denetim \`finance.paid_activity_roster_export\`. Olmayan ya da başka kurumun etkinliği 404. ${READERS}`,
        params: paidActivityParams,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur.
        response: { 200: rosterResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      if (wantsCsv(request)) {
        const { csv, filename } = await paidActivityRosterCsvFor(ctx, request.params.activityId)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      return { data: await paidActivityRosterFor(ctx, request.params.activityId) }
    },
  )

  typed.post(
    `${PARTICIPANTS}/:participantId/consent`,
    {
      preValidation: [...guarded(PAID_ACTIVITY_JOIN_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'grantPaidActivityConsent',
        tags,
        summary: 'Veli iznini kaydet',
        description: `Personelin aldığı izin: kanal (\`paper\`, \`phone\`, \`in_person\`) ve izni veren kişinin adı (2–120). İzin bekleyen asil asil olur ve taksiti açılır (vade son katılım günü, geçtiyse bugün); yedeğin izni kaydedilir (K-370). Etkinlik izin istemiyorsa 422 \`paid_activity_consent_not_required\`, etkinlik günü geçtiyse 422 \`paid_activity_consent_closed\`, izin zaten kayıtlıysa 409 \`paid_activity_consent_recorded\`, öğrenci etkin değilse (ayrılmış ya da mezun; taksit açılmaz) 422 \`paid_activity_student_inactive\` (K-418), katılım iptalse 409 \`paid_activity_participation_cancelled\`. \`If-Match\` ve \`Idempotency-Key\` zorunlu. ${READERS}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: participantParams,
        body: grantConsentSchema,
        response: { 200: participantResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await grantConsentCommand(
        contextOf(request),
        request.params.participantId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return participantResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${PARTICIPANTS}/:participantId/consent-withdraw`,
    {
      preValidation: [...guarded(PAID_ACTIVITY_JOIN_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'withdrawPaidActivityConsent',
        tags,
        summary: 'Veli izninin geri çekildiğini kaydet',
        description: `Kanal (\`paper\`, \`phone\`, \`in_person\`) ile. Katılım "izin geri çekildi" gerekçesiyle (\`cancelKind: consent\`) iptal edilir; iade katılımcı iptali gibi K-302 kuralıyladır, yer boşalırsa sıradaki yedek asile geçer (K-370, K-369). Etkinlik izin istemiyorsa 422 \`paid_activity_consent_not_required\`, iptal edilmiş katılım 409. \`If-Match\` ve \`Idempotency-Key\` zorunlu. ${READERS}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: participantParams,
        body: withdrawConsentSchema,
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
        { kind: 'consent', input: request.commandInput },
      )
      return participantResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${PARTICIPANTS}/withdrawn-leftovers`,
    {
      preValidation: guarded(PAID_ACTIVITY_MANAGE_ROLES),
      schema: {
        operationId: 'listWithdrawnPaidActivityLeftovers',
        tags,
        summary: 'Ayrılıştan kalan yedek ve izin bekleyen katılımlar',
        description: `Ayrılmış (bugün etkin olmayan) öğrencinin iptal edilmemiş etkinlikteki yedek ve izin bekleyen katılımları; etkinlik günü öğrencinin son ayrılış günü ya da sonra (K-419). Bu satırları bugünkü ayrılış kapatır (K-395, K-418); liste ON-346 öncesi ayrılışlardan kalanları gösterir. Etkinlik gününe, sonra öğrenci adına göre; yalnız kurumun kayıtları. ${MANAGER}`,
        querystring: withdrawnLeftoverQuery,
        response: { 200: withdrawnLeftoverListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listWithdrawnLeftoversFor(contextOf(request), {
        page,
        pageSize,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${PARTICIPANTS}/withdrawn-leftovers/cancel`,
    {
      preValidation: [...guarded(PAID_ACTIVITY_MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelWithdrawnPaidActivityLeftovers',
        tags,
        summary: 'Ayrılıştan kalan katılımları parasız iptal et',
        description: `Yöneticinin seçtiği (1–100) kalan katılımlar tek işlemde parasız iptal edilir: iptal türü katılımcı, iptal günü bugün, para ve taksit etkisi yok; denetim \`paid_activity.participant_cancel\` gerekçe kodu \`student_withdrawal\` (K-419). İzin bekleyenin boşalttığı yere sıradaki etkin yedek aynı işlemde geçer (K-369, K-396). Kurumda olmayan katılım 404 (hiçbiri iptal edilmez), iptal edilmiş katılım 409 \`paid_activity_participation_cancelled\`, kalan katılım ölçütüne uymayan 422 \`paid_activity_leftover_not_eligible\`. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: cancelWithdrawnLeftoversSchema,
        response: { 200: withdrawnLeftoverCancelResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await cancelWithdrawnLeftoversCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return withdrawnLeftoverCancelResponse.parse(sendBody(reply, result))
    },
  )
}
