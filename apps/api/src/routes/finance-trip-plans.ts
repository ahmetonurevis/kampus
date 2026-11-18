import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import {
  TRIP_PLAN_APPROVER_ROLES,
  TRIP_PLAN_ROLES,
  tripPlanNoteSchema,
  tripPlanNoticeSchema,
  tripPlanReasonSchema,
  tripPlanSchema,
  updateTripPlanSchema,
} from '@kampus/school-core/lib/finance-trip-plans.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  approveTripPlanCommand,
  cancelTripPlanCommand,
  completeTripPlanCommand,
  createTripPlanCommand,
  getTripPlanFor,
  listTripPlansFor,
  noticeTripPlanCommand,
  rejectTripPlanCommand,
  submitTripPlanCommand,
  tripPlanOptionsFor,
  updateTripPlanCommand,
} from '../services/finance-trip-plans.ts'
import type { CommandResponse, IdempotencyRequest } from '../services/operation-runner.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  tripPlanListQuery,
  tripPlanListResponse,
  tripPlanOptionsResponse,
  tripPlanParams,
  tripPlanResponse,
} from './finance-trip-plans.schemas.ts'

/**
 * Gezi planı ve onay dosyası uçları (docs/domain/finans.md DOM-FIN-111; ON-155). Modül `finance`.
 * Okuma, taslak, düzeltme, onaya gönderme ve millî eğitim bildirimi işareti: yönetici ve ön büro;
 * onay, ret ve tamamlama yalnız yönetici; iptal ikisi (ön büro yalnız taslak ve reddedilmiş planı;
 * K-367). Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem. Plan açılışı
 * `Idempotency-Key` ister; düzeltme ve geçişler `If-Match` ister.
 */

const STAFF = 'Rol: `yonetici`, `onburo` (K-367). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-367). Modül `finance`.'
const URL = '/api/v1/finance/trip-plans'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

type Transition = (
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) => Promise<CommandResponse>

export function registerFinanceTripPlanRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const staff: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(TRIP_PLAN_ROLES),
  ]
  const managers: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(TRIP_PLAN_APPROVER_ROLES),
  ]
  const tags = ['finance-trip-plans']

  typed.get(
    URL,
    {
      preValidation: staff,
      schema: {
        operationId: 'listTripPlans',
        tags,
        summary: 'Gezi planlarını listele',
        description: `Süren planlar önce, çıkışı yakın olan önce; tamamlanan ve iptal edilenler sonda, yeni çıkış önce (DOM-FIN-111). \`q\` adda ya da plan numarasında (\`GZ-0007\`) arar; \`status\` ve \`state\` (\`active\`/\`done\`) süzer. Satır sürücü ve acil iletişim bilgisi taşımaz. ${STAFF}`,
        querystring: tripPlanListQuery,
        response: { 200: tripPlanListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listTripPlansFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/trip-plan-options',
    {
      preValidation: staff,
      schema: {
        operationId: 'getTripPlanOptions',
        tags,
        summary: 'Gezi planı form seçenekleri',
        description: `Görevli olabilecek etkin öğretmen ve yöneticiler (ada göre, en çok 500) ve bağlanabilecek ücretli etkinlikler (iptal edilmemiş, günü bugün ya da sonra; bağlı plan kimliğiyle; DOM-FIN-098). ${STAFF}`,
        response: { 200: tripPlanOptionsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await tripPlanOptionsFor(contextOf(request)) }),
  )

  typed.get(
    `${URL}/:planId`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getTripPlan',
        tags,
        summary: 'Gezi planı ayrıntısı',
        description: `Planın bütün alanları, görevliler, ulaşım belgesi, öğrenci başına görevli oranı (K-366), onay ve bildirim bilgisi ve plan geçmişi; onay dosyası PDF'inin verisi. Olmayan ya da başka kurumun planı 404. ${STAFF}`,
        params: tripPlanParams,
        response: { 200: tripPlanResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getTripPlanFor(contextOf(request), request.params.planId) }),
  )

  typed.post(
    URL,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createTripPlan',
        tags,
        summary: 'Gezi planı taslağı aç',
        description: `Plan taslak olarak ve \`GZ-<sıra>\` numarasıyla açılır (K-366): ad, amaç ve kazanım, çıkış ve dönüş anı (çıkış geçmişte 422 \`trip_plan_departure_past\`, dönüş çıkıştan önce 422 \`trip_plan_return_before_departure\`, 30 günden uzun 422 \`trip_plan_too_long\`), beklenen öğrenci sayısı, güzergâh (1–30 durak), görevliler (kurumun etkin öğretmen ya da yönetici üyeliği; en az bir \`lead\`; olmayan 422 \`trip_plan_staff_not_found\`, öğretmen ya da yönetici olmayan 422 \`trip_plan_staff_not_teacher\`, pasif 422 \`trip_plan_staff_inactive\`), ulaşım (tür, firma, plaka, sürücü ve isteğe bağlı belge dosyası: \`POST /files\`, \`purpose: document\`; başkasının ya da başka kurumun dosyası 422 \`file_unavailable\`), risk değerlendirmesi ve acil iletişim (taslakta boş olabilir) ve isteğe bağlı ücretli etkinlik (olmayan 422 \`trip_plan_activity_not_found\`, iptal edilmiş 422 \`trip_plan_activity_cancelled\`, başka plana bağlı 409 \`trip_plan_activity_linked\`, günü gezi günleri dışında 422 \`trip_plan_activity_date_mismatch\`). Görevli oranı uyarıdır, kaydı engellemez. Gövdedeki \`institutionId\` 400. \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: tripPlanSchema,
        response: { 201: tripPlanResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createTripPlanCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = tripPlanResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    `${URL}/:planId`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateTripPlan',
        tags,
        summary: 'Gezi planını düzelt',
        description: `Verilen alanlar değişir; güzergâh, görevliler, ulaşım, riskler ve acil iletişim bütün olarak yazılır, birleşik plan yeni plan kurallarıyla denetlenir (çıkış yalnız değiştiyse geçmiş olamaz; değişmeyen görevli ve etkinlik yeniden denetlenmez). Onay bekleyen, onaylanmış ya da reddedilmiş plan düzeltilince taslağa döner: onay, ret ve bildirim işareti düşer, plan yeniden onaya gönderilmelidir (K-367). Tamamlanmış ya da iptal edilmiş plan 422 \`trip_plan_status_invalid\`; değişiklik yoksa 422 \`trip_plan_unchanged\`; sürüm tutmazsa 409. \`If-Match\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: tripPlanParams,
        body: updateTripPlanSchema,
        response: { 200: tripPlanResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateTripPlanCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return tripPlanResponse.parse(sendBody(reply, result))
    },
  )

  function transition(
    verb: string,
    operationId: string,
    summary: string,
    description: string,
    body: z.ZodType,
    guards: preValidationAsyncHookHandler[],
    run: Transition,
  ) {
    typed.post(
      `${URL}/:planId/${verb}`,
      {
        preValidation: [...guards, requireIfMatch(), captureInput()],
        schema: {
          operationId,
          tags,
          summary,
          description: `${description} Geçersiz geçiş 422 \`trip_plan_status_invalid\`; başka kurumun planı 404; \`If-Match\` zorunlu, sürüm tutmazsa 409.`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: tripPlanParams,
          body,
          response: { 200: tripPlanResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await run(
          contextOf(request),
          request.params.planId,
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return tripPlanResponse.parse(sendBody(reply, result))
      },
    )
  }

  transition(
    'submit',
    'submitTripPlan',
    'Gezi planını onaya gönder',
    `Taslak \`submitted\` olur (K-367). Çıkış geçmişse 422 \`trip_plan_departure_past\`; risk değerlendirmesi boşsa 422 \`trip_plan_risks_required\`; acil iletişim boşsa 422 \`trip_plan_emergency_contact_required\`; otobüs ve minibüste firma, plaka ya da sürücü eksikse 422 \`trip_plan_transport_incomplete\`. İsteğe bağlı not. ${STAFF}`,
    tripPlanNoteSchema,
    staff,
    submitTripPlanCommand,
  )
  transition(
    'approve',
    'approveTripPlan',
    'Gezi planını onayla',
    `Onay bekleyen plan \`approved\` olur; onaylayan ve an kaydedilir (K-367). Çıkış geçmişse 422 \`trip_plan_departure_past\`. İl/ilçe millî eğitim bildirimi otomatik yapılmaz (K-368). ${MANAGER}`,
    tripPlanNoteSchema,
    managers,
    approveTripPlanCommand,
  )
  transition(
    'reject',
    'rejectTripPlan',
    'Gezi planını reddet',
    `Onay bekleyen plan gerekçeyle \`rejected\` olur (K-367); düzeltilince taslağa döner. ${MANAGER}`,
    tripPlanReasonSchema,
    managers,
    rejectTripPlanCommand,
  )
  transition(
    'authority-notice',
    'recordTripPlanAuthorityNotice',
    'Millî eğitim bildirimini işaretle',
    `Onaylanmış planda il/ilçe millî eğitim bildiriminin yapıldığı gün ve isteğe bağlı evrak sayısı (K-368); yeniden işaretleme günü değiştirir, durum değişmez. Gün bugünden sonra 422 \`trip_plan_notice_date_future\`, onay gününden önce 422 \`trip_plan_notice_before_approval\`. ${STAFF}`,
    tripPlanNoticeSchema,
    staff,
    noticeTripPlanCommand,
  )
  transition(
    'complete',
    'completeTripPlan',
    'Gezi planını tamamla',
    `Onaylanmış plan dönüş anından sonra \`completed\` olur (önce 422 \`trip_plan_not_returned\`; K-367). İsteğe bağlı not. ${MANAGER}`,
    tripPlanNoteSchema,
    managers,
    completeTripPlanCommand,
  )
  transition(
    'cancel',
    'cancelTripPlan',
    'Gezi planını iptal et',
    `Gerekçeyle \`cancelled\` (K-367). Yönetici taslak, onay bekleyen, onaylanmış ve reddedilmiş planı iptal eder; ön büro yalnız taslak ve reddedilmiş planı (403 \`trip_plan_cancel_forbidden\`). Bağlı ücretli etkinlik iptal edilmez; iptal edilen planın etkinliği başka plana bağlanabilir. ${STAFF}`,
    tripPlanReasonSchema,
    staff,
    cancelTripPlanCommand,
  )
}
