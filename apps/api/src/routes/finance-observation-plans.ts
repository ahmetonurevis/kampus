import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  OBSERVATION_PLAN_MANAGE_ROLES,
  OBSERVATION_PLAN_READ_ROLES,
  OBSERVATION_PLANS_PER_PERIOD_MAX,
  observationPlanCancelSchema,
  observationPlanCreateSchema,
  observationPlanPostponeSchema,
  observationPlanStartSchema,
  observationPlanUpdateSchema,
} from '@kampus/school-core/lib/finance-observation-plans.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelObservationPlanCommand,
  createObservationPlanCommand,
  getObservationPlanFor,
  listObservationPlansFor,
  postponeObservationPlanCommand,
  startObservationPlanCommand,
  updateObservationPlanCommand,
} from '../services/finance-observation-plans.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  planDetailResponse,
  planListQuery,
  planListResponse,
  planParams,
  planResponse,
} from './finance-observation-plans.schemas.ts'

/**
 * Ders gözlem planı uçları (docs/domain/finans.md DOM-FIN-139; ON-207). Modül `finance`. Plan
 * yazımı yalnız yönetici; okuma yönetici (hepsi) ve öğretmen (gözlemcisi ya da gözleneni olduğu
 * planlar; K-474). Açma `Idempotency-Key`, düzeltme, erteleme, iptal ve başlatma `If-Match` ister.
 * Öğretmene bildirim "gönderilecek" kaydıdır, gönderim yapılmaz.
 */

const MANAGER = 'Rol: yalnız `yonetici`. Modül `finance`.'
const READERS =
  'Rol: `yonetici` hepsini; `ogretmen` yalnız gözlemcisi ya da gözleneni olduğu planları görür (K-474). Modül `finance`.'
const PLANS = '/api/v1/finance/observation-plans'
const BUSY = `çakışma 422 \`observation_plan_observer_busy\`/\`observation_plan_teacher_busy\` (gözlemci ve gözlenen aynı saatte başka planda yer alamaz; ders programı denetlenmez)`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceObservationPlanRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const base: preValidationAsyncHookHandler[] = [app.authenticate, app.requireModule('finance')]
  const managers = [...base, app.requireRole(OBSERVATION_PLAN_MANAGE_ROLES)]
  const readers = [...base, app.requireRole(OBSERVATION_PLAN_READ_ROLES)]
  const tags = ['finance-observation-plans']

  typed.get(
    PLANS,
    {
      preValidation: readers,
      schema: {
        operationId: 'listObservationPlans',
        tags,
        summary: 'Gözlem planlarını listele',
        description: `Planlar gün ve saat sırasıyla (takvim): öğretmen, gözlemci, gün, saat ve süre, form sürümü, sınıf/ders, dönem, durum, bağlı gözlem, geciken mi ve öğretmene gönderilecek bildirim sayısı. \`from\`/\`to\` gün aralığı (takvim haftası ya da ayı), öğretmen, gözlemci, durum, dönem ve \`overdue=true\` (günü geçmiş açık planlar) ile süzülür. ${READERS}`,
        querystring: planListQuery,
        response: { 200: planListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listObservationPlansFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${PLANS}/:planId`,
    {
      preValidation: readers,
      schema: {
        operationId: 'getObservationPlan',
        tags,
        summary: 'Gözlem planını getir',
        description: `Plan ve öğretmene giden bildirimler (konu, gün, saat, durum; bugün hepsi "gönderilecek"). Görülemeyen ve başka kurumun planı 404. ${READERS}`,
        params: planParams,
        response: { 200: planDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getObservationPlanFor(contextOf(request), request.params.planId),
    }),
  )

  typed.post(
    PLANS,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createObservationPlan',
        tags,
        summary: 'Gözlem planı aç',
        description: `Plan açılır (K-472): form (son sürümü plana yazılır; yok 422 \`observation_template_not_found\`, arşivli 409 \`observation_template_archived\`), gözlenecek etkin öğretmen ve etkin yönetici ya da öğretmen gözlemci (ayrı kişi; DOM-FIN-130 kodları \`observation_teacher_*\`, \`observation_observer_*\`, \`observation_self\`), gün (bugünden önce değil, 422 \`observation_plan_date_past\`), saat SS:DD ve süre (10–240 dk, varsayılan 40; gece yarısını aşmaz), isteğe bağlı sınıf, ders, performans dönemi (kapanmamış, gün dönem içinde: 422 \`observation_period_closed\`, \`observation_plan_outside_period\`; öğretmen başına dönemde en çok ${String(OBSERVATION_PLANS_PER_PERIOD_MAX)} iptal edilmemiş plan, 422 \`observation_plan_limit\`) ve not; ${BUSY}. Öğretmene "planlandı" bildirimi gönderilecek olarak yazılır. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: observationPlanCreateSchema,
        response: { 201: planResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createObservationPlanCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return planResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${PLANS}/:planId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateObservationPlan',
        tags,
        summary: 'Gözlem planını düzelt',
        description: `Açık ve gözlemi başlamamış planın kısmi düzeltmesi (K-472): gözlemci, form (son sürüm), gün, saat, süre, sınıf, ders, dönem, not; öğretmen değişmez. Açılıştaki kurallar değişen alanlar için yeniden denetlenir; ${BUSY}. Gün, saat, süre ya da gözlemci değişince öğretmene "plan değişti" bildirimi. Gerçekleşen 409 \`observation_plan_done\`, iptal 409 \`observation_plan_cancelled\`, gözlemi başlamış 409 \`observation_plan_started\`. \`If-Match\` zorunlu. Başka kurumun planı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: planParams,
        body: observationPlanUpdateSchema,
        response: { 200: planResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateObservationPlanCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return planResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${PLANS}/:planId/postpone`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'postponeObservationPlan',
        tags,
        summary: 'Gözlem planını ertele',
        description: `Açık ve gözlemi başlamamış plan yeni gün ve saate alınır, gerekçe (3–500) yazılır, durum "ertelendi" olur (K-472). Yeni gün bugünden önce olamaz (422 \`observation_plan_date_past\`), aynı gün ve saat 422 \`observation_plan_same_slot\`, dönem bağlıysa gün dönem içinde; ${BUSY}. Öğretmene "ertelendi" bildirimi. \`If-Match\` zorunlu. Başka kurumun planı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: planParams,
        body: observationPlanPostponeSchema,
        response: { 200: planResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await postponeObservationPlanCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return planResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${PLANS}/:planId/cancel`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelObservationPlan',
        tags,
        summary: 'Gözlem planını iptal et',
        description: `Açık ve gözlemi başlamamış plan gerekçeyle (3–500) iptal edilir; dönem sınırında sayılmaz (K-472). Gözlemi başlamış plan 409 \`observation_plan_started\` (önce taslak arşivlenir), gerçekleşen 409 \`observation_plan_done\`. Öğretmene "iptal edildi" bildirimi. \`If-Match\` zorunlu. Başka kurumun planı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: planParams,
        body: observationPlanCancelSchema,
        response: { 200: planResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelObservationPlanCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return planResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${PLANS}/:planId/start`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'startObservationPlan',
        tags,
        summary: 'Plandan gözlemi başlat',
        description: `Plan günü geldiyse (bugün ya da geçmiş; değilse 422 \`observation_plan_not_due\`) planın form sürümüyle ders gözlemi taslağı açılır ve plana bağlanır (K-473); gözlem günü plan günüdür. Gözlem açma kuralları DOM-FIN-130'dakidir (arşivli form 409, ayrılmış öğretmen 422, kapanmış dönem 422). Gözlem tamamlanınca plan "gerçekleşti" olur; taslak arşivlenirse bağ kalkar. Zaten başlamış 409 \`observation_plan_started\`. Gövde boş nesne. \`If-Match\` zorunlu. Başka kurumun planı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: planParams,
        body: observationPlanStartSchema,
        response: { 200: planResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await startObservationPlanCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return planResponse.parse(sendBody(reply, result))
    },
  )
}
