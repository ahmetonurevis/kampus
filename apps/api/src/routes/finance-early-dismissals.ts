import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  EARLY_DISMISSAL_EFFECT_ROLES,
  EARLY_DISMISSAL_REQUEST_ROLES,
  EARLY_DISMISSAL_STAFF_ROLES,
  earlyDismissalApproveSchema,
  earlyDismissalCancelSchema,
  earlyDismissalCreateSchema,
  earlyDismissalRejectSchema,
  earlyDismissalReleaseSchema,
} from '@kampus/school-core/lib/finance-early-dismissals.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelEarlyDismissalCommand,
  createEarlyDismissalCommand,
  decideEarlyDismissalCommand,
  earlyDismissalSummaryFor,
  getEarlyDismissalFor,
  listAttendanceEffectsFor,
  listEarlyDismissalsFor,
  listGuardianEarlyDismissalsFor,
  listPickupOptionsFor,
  releaseEarlyDismissalCommand,
} from '../services/finance-early-dismissals.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  attendanceEffectsQuery,
  attendanceEffectsResponse,
  earlyDismissalListQuery,
  earlyDismissalListResponse,
  earlyDismissalParams,
  earlyDismissalResponse,
  earlyDismissalSummaryQuery,
  earlyDismissalSummaryResponse,
  guardianEarlyDismissalListResponse,
  guardianEarlyDismissalQuery,
  guardianEarlyDismissalResponse,
  pickupOptionsQuery,
  pickupOptionsResponse,
} from './finance-early-dismissals.schemas.ts'

/**
 * Erken çıkış uçları (docs/domain/finans.md DOM-FIN-161; ON-168; K-538…K-540). Modül `finance`.
 * Liste, ayrıntı, onay, ret ve teslim yönetici ve ön büro; talep açma ve iptal okul ve veli (veli
 * yalnız velayetli olduğu çocuğu); yoklamaya yansıma okul ve öğretmen (kendi sınıfları). Sıra:
 * 401 → 403 modül → 403 rol → başlıklar → 400 → işlem.
 */

const STAFF = 'Rol: `yonetici` ve `onburo`. Modül `finance`.'
const REQUEST =
  'Rol: `yonetici`, `onburo` ve `veli` (yalnız velayetli ve iletişim kısıtı olmayan çocuğu). Modül `finance`.'
const BASE = '/api/v1/finance/early-dismissals'
const ITEM = `${BASE}/:dismissalId`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function versionOf(request: Parameters<typeof options>[0]) {
  const opts = options(request, 'optional')
  if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
  return { expectedVersion: opts.expectedVersion, idempotency: opts.idempotency }
}

export function registerFinanceEarlyDismissalRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const staff = guarded(EARLY_DISMISSAL_STAFF_ROLES)
  const requester = guarded(EARLY_DISMISSAL_REQUEST_ROLES)
  const guardian = guarded(['veli'])
  const effects = guarded(EARLY_DISMISSAL_EFFECT_ROLES)
  const tags = ['finance-early-dismissals']
  const versioned = {
    headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
    params: earlyDismissalParams,
  }

  typed.get(
    BASE,
    {
      preValidation: staff,
      schema: {
        operationId: 'listEarlyDismissals',
        tags,
        summary: 'Erken çıkışlar',
        description: `Gün süzgecinde planlanan saat sırasıyla, gün yoksa en yeni gün önce. Süzgeç gün, durum ve sınıf. Satır neden açıklaması ve kimlik son dört hanesi taşımaz (ayrıntıda). ${STAFF}`,
        querystring: earlyDismissalListQuery,
        response: { 200: earlyDismissalListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, date, status, classId } = request.query
      const { items, total } = await listEarlyDismissalsFor(contextOf(request), {
        page,
        pageSize,
        date,
        status,
        classId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    BASE,
    {
      preValidation: [...requester, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createEarlyDismissal',
        tags,
        summary: 'Erken çıkış talebi',
        description: `Öğrenci, gün (bugün ya da 30 gün içinde), saat (SS:DD), neden (\`other\` açıklama ister, 400) ve teslim alacak kişi: \`self\` (yalnız veli), \`guardian\` (öğrencinin teslim yetkilisi bağı) ya da \`other\` (kayıtlı olmayan kişi: ad, kimliğin yalnız son dört hanesi, yakınlık; tam numara 400). Velinin talebi onay bekler (\`pending\`), okulun açtığı acil kayıt onaylı doğar (\`approved\`). Öğrenci yok ya da velinin kapsamı dışında 404; velayetsiz ya da iletişim kısıtlı veli 403 \`early_dismissal_custody_required\`; kaydı kapalı öğrenci 422 \`early_dismissal_student_inactive\`; geçmiş gün 422 \`early_dismissal_date_past\`, 30 günden ileri \`early_dismissal_date_too_far\`, bugün 30 dakikadan eski saat \`early_dismissal_time_past\`; yetkisiz bağ 422 \`early_dismissal_pickup_not_authorized\`; okulun \`self\` seçmesi 422 \`early_dismissal_pickup_self_school\`; aynı gün açık talep 409 \`early_dismissal_exists\` (K-538). Denetim \`finance.early_dismissal.create\` (alan adları). \`Idempotency-Key\` zorunlu. ${REQUEST}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: earlyDismissalCreateSchema,
        response: { 201: guardianEarlyDismissalResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createEarlyDismissalCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = guardianEarlyDismissalResponse.parse(sendBody(reply, result))
      reply.header('location', `${BASE}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/finance/early-dismissal-summary',
    {
      preValidation: staff,
      schema: {
        operationId: 'getEarlyDismissalSummary',
        tags,
        summary: 'Erken çıkış gün özeti',
        description: `Günün (varsayılan bugün) durum sayıları. ${STAFF}`,
        querystring: earlyDismissalSummaryQuery,
        response: { 200: earlyDismissalSummaryResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await earlyDismissalSummaryFor(contextOf(request), request.query.date),
    }),
  )

  typed.get(
    '/api/v1/finance/early-dismissal-pickup-options',
    {
      preValidation: requester,
      schema: {
        operationId: 'listEarlyDismissalPickupOptions',
        tags,
        summary: 'Teslim alabilecek kişiler',
        description: `Öğrencinin teslim yetkilileri: velayetli ve iletişim kısıtı olmayan veliler ile teslim alma yetkisi işaretli bağlar (K-538). Velide yalnız velayetli olduğu çocuk ve kendi bağı \`isSelf\`; kapsam dışı, kaydı kapalı ya da başka kurumun öğrencisi 404. ${REQUEST}`,
        querystring: pickupOptionsQuery,
        response: { 200: pickupOptionsResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await listPickupOptionsFor(contextOf(request), request.query.studentId),
    }),
  )

  typed.get(
    '/api/v1/finance/early-dismissal-attendance-effects',
    {
      preValidation: effects,
      schema: {
        operationId: 'listEarlyDismissalAttendanceEffects',
        tags,
        summary: 'Erken çıkışın yoklamaya yansıması',
        description: `Günün (varsayılan bugün) teslim edilmiş (gerçek çıkış anı, \`basis=released\`) ve onaylı (planlanan saat, \`basis=planned\`) erken çıkışları ve etkilenen ders saatleri: \`fromPeriod\` ilk etkilenen dersin sırası, ders sırasında çıkışta ders \`partial\`. Yoklama kaydı değişmez; yoklama modülü bunu mazeretli devamsızlık olarak okur (K-540). Öğretmen yalnız sınıf öğretmeni olduğu ve derse girdiği sınıfları görür. Rol: \`yonetici\`, \`onburo\`, \`ogretmen\`. Modül \`finance\`.`,
        querystring: attendanceEffectsQuery,
        response: { 200: attendanceEffectsResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await listAttendanceEffectsFor(contextOf(request), request.query),
    }),
  )

  typed.get(
    '/api/v1/finance/my-early-dismissals',
    {
      preValidation: guardian,
      schema: {
        operationId: 'listMyEarlyDismissals',
        tags,
        summary: 'Velinin erken çıkış talepleri',
        description:
          'Velinin velayetli ve iletişim kısıtı olmayan çocuklarının son 30 günden bu yana ve ilerideki talepleri; karar, ret gerekçesi ve teslim (teslim alanın adı, gerçek çıkış). İletişim kısıtlı veli boş liste alır. Rol: `veli`. Modül `finance`.',
        querystring: guardianEarlyDismissalQuery,
        response: { 200: guardianEarlyDismissalListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, studentId } = request.query
      const { items, total } = await listGuardianEarlyDismissalsFor(contextOf(request), {
        page,
        pageSize,
        studentId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    ITEM,
    {
      preValidation: staff,
      schema: {
        operationId: 'getEarlyDismissal',
        tags,
        summary: 'Erken çıkış ayrıntısı',
        description: `Neden açıklaması, kayıtlı olmayan kişinin kimlik son dört hanesi, öğrencinin şu anki teslim yetkilileri ve etkilenen dersler. Okuma aynı transaction'da \`finance.early_dismissal.read\` denetimine düşer. Başka kurumun kaydı 404. ${STAFF}`,
        params: earlyDismissalParams,
        response: { 200: earlyDismissalResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getEarlyDismissalFor(contextOf(request), request.params.dismissalId),
    }),
  )

  for (const decision of ['approve', 'reject'] as const)
    typed.post(
      `${ITEM}/${decision}`,
      {
        preValidation: [...staff, requireIfMatch(), captureInput()],
        schema: {
          operationId: decision === 'approve' ? 'approveEarlyDismissal' : 'rejectEarlyDismissal',
          tags,
          summary: decision === 'approve' ? 'Erken çıkışı onayla' : 'Erken çıkışı reddet',
          description:
            decision === 'approve'
              ? `Bekleyen talebi onaylar; kayıtlı olmayan teslim alan da böylece onaylanır. Onaylı talep 422 \`early_dismissal_not_pending\`, günü geçmiş 422 \`early_dismissal_expired\`, kapanmış 422 \`early_dismissal_closed\`, teslim edilmiş 422 \`early_dismissal_already_released\` (K-538). Veli talebinde veliye \`early_dismissal_decided\` bildirimi. \`If-Match\` zorunlu. Denetim \`finance.early_dismissal.approve\`. ${STAFF}`
              : `Bekleyen talebi gerekçeyle (5–300, veliye görünür) reddeder. Onaylı talep 422 \`early_dismissal_not_pending\` (iptal edilir), kapanmış 422 \`early_dismissal_closed\` (K-538). Veli talebinde veliye \`early_dismissal_decided\` bildirimi. \`If-Match\` zorunlu. Denetim \`finance.early_dismissal.reject\` (gerekçe yazılmaz). ${STAFF}`,
          ...versioned,
          body: decision === 'approve' ? earlyDismissalApproveSchema : earlyDismissalRejectSchema,
          response: { 200: earlyDismissalResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const { expectedVersion, idempotency } = versionOf(request)
        const result = await decideEarlyDismissalCommand(
          contextOf(request),
          request.params.dismissalId,
          decision,
          request.commandInput,
          expectedVersion,
          idempotency,
        )
        return earlyDismissalResponse.parse(sendBody(reply, result))
      },
    )

  typed.post(
    `${ITEM}/cancel`,
    {
      preValidation: [...requester, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelEarlyDismissal',
        tags,
        summary: 'Erken çıkışı iptal et',
        description: `Bekleyen ya da onaylı, teslim edilmemiş talebi isteğe bağlı gerekçeyle iptal eder. Veli yalnız velayetli olduğu çocuğun talebini (başkası 404). Teslim edilmiş 422 \`early_dismissal_already_released\`, kapanmış 422 \`early_dismissal_closed\`. \`If-Match\` zorunlu. Denetim \`finance.early_dismissal.cancel\`. ${REQUEST}`,
        ...versioned,
        body: earlyDismissalCancelSchema,
        response: { 200: guardianEarlyDismissalResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await cancelEarlyDismissalCommand(
        contextOf(request),
        request.params.dismissalId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return guardianEarlyDismissalResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ITEM}/release`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'releaseEarlyDismissal',
        tags,
        summary: 'Öğrenciyi teslim et',
        description: `Teslim alan kişi listeden seçilir: \`guardian\` (öğrencinin şu anki teslim yetkilisi bağı) ya da \`other\` (talepte onaylanan kayıtlı olmayan kişi; görülen kimliğin son dört hanesi). Kimlik görüldü (\`identityVerified: true\`) zorunlu, değilse 400; gerçek çıkış anı boşsa şimdi. Yetkisiz kişi 422 \`early_dismissal_pickup_not_authorized\`, son dört hane eşleşmiyor 422 \`early_dismissal_pickup_mismatch\`, onaysız 422 \`early_dismissal_not_approved\`, çıkış günü değil 422 \`early_dismissal_not_today\`, gelecek 422 \`early_dismissal_release_future\`, başka gün 422 \`early_dismissal_release_other_day\`, ikinci teslim 422 \`early_dismissal_already_released\` (K-539). Veliye \`early_dismissal_released\` bildirimi. \`If-Match\` zorunlu. Denetim \`finance.early_dismissal.release\`. ${STAFF}`,
        ...versioned,
        body: earlyDismissalReleaseSchema,
        response: { 200: earlyDismissalResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await releaseEarlyDismissalCommand(
        contextOf(request),
        request.params.dismissalId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return earlyDismissalResponse.parse(sendBody(reply, result))
    },
  )
}
