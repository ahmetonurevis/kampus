import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  developmentGoalCreateSchema,
  developmentGoalFollowUpSchema,
  developmentGoalUpdateSchema,
  OBSERVATION_DEBRIEF_MANAGE_ROLES,
  OBSERVATION_DEBRIEF_READ_ROLES,
  observationDebriefCreateSchema,
  observationDebriefFinalizeSchema,
  observationDebriefUpdateSchema,
} from '@kampus/school-core/lib/finance-observation-debriefs.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  createDevelopmentGoalCommand,
  createObservationDebriefCommand,
  finalizeObservationDebriefCommand,
  followUpDevelopmentGoalCommand,
  getDevelopmentGoalFor,
  getObservationDebriefFor,
  listDevelopmentGoalsFor,
  updateDevelopmentGoalCommand,
  updateObservationDebriefCommand,
} from '../services/finance-observation-debriefs.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  debriefLookupResponse,
  debriefParams,
  debriefResponse,
  goalDetailResponse,
  goalListQuery,
  goalListResponse,
  goalParams,
  observationParams,
} from './finance-observation-debriefs.schemas.ts'

/**
 * Gözlem sonrası görüşme ve gelişim hedefi uçları (docs/domain/finans.md DOM-FIN-133; ON-209).
 * Modül `finance`. Yazma yalnız yönetici; okuma yönetici ve öğretmen (öğretmen yalnız gözlemcisi
 * ve öğretmeni olduğu kayıtlar; K-456). Açma uçları `Idempotency-Key`, düzeltme, kesinleştirme ve
 * takip notu `If-Match` ister. Okumalar denetime düşer.
 */

const MANAGER = 'Rol: yalnız `yonetici`. Modül `finance`.'
const DEBRIEF_READERS =
  'Rol: `yonetici` hepsini; `ogretmen` gözlemcisi olduğu gözlemin görüşmesini (taslak dahil) ve gözlendiği gözlemin kesinleşmiş görüşmesini görür (K-456). Modül `finance`.'
const GOAL_READERS =
  'Rol: `yonetici` hepsini; `ogretmen` kendi hedeflerini ve gözlemcisi olduğu gözlemin görüşmesinden doğan hedefleri görür (K-456). Modül `finance`.'
const OBSERVATIONS = '/api/v1/finance/lesson-observations'
const DEBRIEFS = '/api/v1/finance/observation-debriefs'
const GOALS = '/api/v1/finance/development-goals'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceObservationDebriefRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const base: preValidationAsyncHookHandler[] = [app.authenticate, app.requireModule('finance')]
  const managers = [...base, app.requireRole(OBSERVATION_DEBRIEF_MANAGE_ROLES)]
  const readers = [...base, app.requireRole(OBSERVATION_DEBRIEF_READ_ROLES)]
  const tags = ['finance-observation-debriefs']

  typed.get(
    `${OBSERVATIONS}/:observationId/debrief`,
    {
      preValidation: readers,
      schema: {
        operationId: 'getObservationDebrief',
        tags,
        summary: 'Gözlem sonrası görüşmeyi getir',
        description: `Gözlemin görüşmesi (DOM-FIN-133): gün, katılanlar, güçlü yönler, gelişim alanları, öğretmenin görüşü ve durum. Görüşme yoksa ya da gözlenen öğretmen taslağı henüz göremiyorsa \`data\` boş. Görülemeyen, arşivli ya da başka kurumun gözlemi 404. Okuma aynı transaction'da denetime yazılır (\`finance.observation_debrief.read\`; alan adları ve kayıt sayısı). ${DEBRIEF_READERS}`,
        params: observationParams,
        response: { 200: debriefLookupResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getObservationDebriefFor(contextOf(request), request.params.observationId),
    }),
  )

  typed.post(
    `${OBSERVATIONS}/:observationId/debrief`,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createObservationDebrief',
        tags,
        summary: 'Gözlem sonrası görüşme aç',
        description: `Taslak açılır (K-454): görüşme günü (gözlem gününden önce değil, bugünden sonra değil), katılanlar (1–10 kurum yönetici ya da öğretmen üyeliği, etkin; gözlenen öğretmen dahil) ve isteğe bağlı güçlü yönler, gelişim alanları, öğretmenin görüşü. Ret: gözlem tamamlanmamış 422 \`debrief_observation_not_completed\`; gözlemin görüşmesi var 409 \`debrief_exists\` (gözlem başına bir görüşme); gün 422 \`debrief_date_before_observation\`/\`debrief_date_future\`; katılımcı 422 \`debrief_participant_not_found\`/\`debrief_participant_invalid\`/\`debrief_participant_inactive\`; öğretmen listede değil 422 \`debrief_teacher_missing\`. Metinler denetime yazılmaz. \`Idempotency-Key\` zorunlu. Başka kurumun gözlemi 404. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: observationParams,
        body: observationDebriefCreateSchema,
        response: { 201: debriefResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createObservationDebriefCommand(
        contextOf(request),
        request.params.observationId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return debriefResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${DEBRIEFS}/:debriefId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateObservationDebrief',
        tags,
        summary: 'Görüşme taslağını düzelt',
        description: `Kısmi düzeltme (K-454): gün, katılanlar (tam liste; listede zaten olan ayrılmış personel kalabilir), güçlü yönler, gelişim alanları, öğretmenin görüşü (boş metin siler). Kesinleşen görüşme 409 \`debrief_finalized\`, sürüm tutmazsa 409. \`If-Match\` zorunlu. Başka kurumun görüşmesi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: debriefParams,
        body: observationDebriefUpdateSchema,
        response: { 200: debriefResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateObservationDebriefCommand(
        contextOf(request),
        request.params.debriefId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return debriefResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${DEBRIEFS}/:debriefId/finalize`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'finalizeObservationDebrief',
        tags,
        summary: 'Görüşmeyi kesinleştir',
        description: `Kesinleştirme (K-454): güçlü yönler (422 \`debrief_strengths_required\`) ve gelişim alanları (422 \`debrief_development_areas_required\`) yazılmış olmalı; öğretmenin görüşü isteğe bağlı. Kesinleşen görüşme değişmez (veritabanı tetikleyicisi); yeniden kesinleştirme 409 \`debrief_finalized\`. Gövde boş nesne. \`If-Match\` zorunlu. Başka kurumun görüşmesi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: debriefParams,
        body: observationDebriefFinalizeSchema,
        response: { 200: debriefResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await finalizeObservationDebriefCommand(
        contextOf(request),
        request.params.debriefId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return debriefResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    GOALS,
    {
      preValidation: readers,
      schema: {
        operationId: 'listDevelopmentGoals',
        tags,
        summary: 'Gelişim hedeflerini listele',
        description: `Gelişim hedefleri, takip tarihi yakın önce (DOM-FIN-133): öğretmen, kaynak (gözlem görüşmesi ya da doğrudan), performans dönemi, hedef, ölçüt, takip tarihi, durum ve gecikme (İstanbul gününe göre takip tarihi geçmiş süren hedef; K-455). Öğretmen adında aranır; durum, öğretmen, performans dönemi ve kaynak görüşmeyle süzülür; \`overdue=true\` yalnız takip tarihi geçmiş açık ve süren hedefleri getirir. Okuma aynı transaction'da denetime yazılır (\`finance.development_goal.read\`). ${GOAL_READERS}`,
        querystring: goalListQuery,
        response: { 200: goalListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listDevelopmentGoalsFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${GOALS}/:goalId`,
    {
      preValidation: readers,
      schema: {
        operationId: 'getDevelopmentGoal',
        tags,
        summary: 'Gelişim hedefini getir',
        description: `Hedef ve takip geçmişi (not, durum değişikliği, sonraki takip tarihi; eskiden yeniye, değişmez). Okuma denetime yazılır. Görülemeyen ya da başka kurumun hedefi 404. ${GOAL_READERS}`,
        params: goalParams,
        response: { 200: goalDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getDevelopmentGoalFor(contextOf(request), request.params.goalId),
    }),
  )

  typed.post(
    GOALS,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createDevelopmentGoal',
        tags,
        summary: 'Gelişim hedefi aç',
        description: `Hedef "açık" başlar (K-455). Kaynak gözlem görüşmesiyse \`debriefId\` (öğretmen gözlemin öğretmenidir), doğrudansa \`teacherMembershipId\`; ikisinden yalnız biri (400). Hedef (2–500), ölçüt (2–1000), takip tarihi (bugünden önce değil) ve isteğe bağlı performans dönemi. Ret: görüşme yok 422 \`development_goal_debrief_not_found\`; öğretmen yok/öğretmen değil/ayrılmış 422 \`development_goal_teacher_not_found\`/\`development_goal_not_teacher\`/\`development_goal_teacher_inactive\`; dönem yok/kapalı 422 \`development_goal_period_not_found\`/\`development_goal_period_closed\`; takip tarihi 422 \`development_goal_follow_up_past\`. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: developmentGoalCreateSchema,
        response: { 201: goalDetailResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createDevelopmentGoalCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return goalDetailResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${GOALS}/:goalId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateDevelopmentGoal',
        tags,
        summary: 'Gelişim hedefini düzelt',
        description: `Süren (açık ya da sürüyor) hedefin hedef metni, ölçütü, takip tarihi (bugünden önce değil, 422 \`development_goal_follow_up_past\`) ve performans dönemi (\`null\` bağı kaldırır). Kapanan hedef 409 \`development_goal_closed\`, sürüm tutmazsa 409. \`If-Match\` zorunlu. Başka kurumun hedefi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: goalParams,
        body: developmentGoalUpdateSchema,
        response: { 200: goalDetailResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateDevelopmentGoalCommand(
        contextOf(request),
        request.params.goalId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return goalDetailResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${GOALS}/:goalId/follow-ups`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'followUpDevelopmentGoal',
        tags,
        summary: 'Gelişim hedefine takip notu yaz',
        description: `Takip notu (2–1000) geçmişe değişmez satır olarak eklenir (K-455); isteğe bağlı yeni durum ve sonraki takip tarihi. Durum yalnız ileri gider: açık → sürüyor → ulaşıldı ya da bırakıldı (açık doğrudan kapanabilir); geri ya da aynı durum 422 \`development_goal_status_invalid\`. Sonraki takip tarihi bugünden önce olamaz (422 \`development_goal_follow_up_past\`), kapanan hedefe verilmez (422 \`development_goal_follow_up_closed\`). Kapanan hedef 409 \`development_goal_closed\`. Not metni denetime yazılmaz. \`If-Match\` hedef sürümü. Başka kurumun hedefi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: goalParams,
        body: developmentGoalFollowUpSchema,
        response: { 200: goalDetailResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await followUpDevelopmentGoalCommand(
        contextOf(request),
        request.params.goalId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return goalDetailResponse.parse(sendBody(reply, result))
    },
  )
}
