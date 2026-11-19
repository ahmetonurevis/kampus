import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  LESSON_OBSERVATION_MANAGE_ROLES,
  LESSON_OBSERVATION_READ_ROLES,
  lessonObservationCreateSchema,
  lessonObservationEmptySchema,
  lessonObservationTemplateInputSchema,
  lessonObservationTemplateUpdateSchema,
  lessonObservationUpdateSchema,
} from '@kampus/school-core/lib/finance-lesson-observations.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveObservationTemplateCommand,
  completeLessonObservationCommand,
  createLessonObservationCommand,
  createObservationTemplateCommand,
  createObservationTemplateVersionCommand,
  getLessonObservationFor,
  listLessonObservationsFor,
  listObservationTemplatesFor,
  updateLessonObservationCommand,
  updateObservationTemplateCommand,
} from '../services/finance-lesson-observations.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  observationDetailResponse,
  observationListQuery,
  observationListResponse,
  observationParams,
  observationResponse,
  templateListQuery,
  templateListResponse,
  templateParams,
  templateResponse,
} from './finance-lesson-observations.schemas.ts'

/**
 * Ders gözlem formu uçları (docs/domain/finans.md DOM-FIN-130; ON-206). Modül `finance`. Form
 * şablonu ve gözlem yazımı yalnız yönetici; gözlem okuması yönetici ve öğretmen (öğretmen yalnız
 * gözlemcisi olduğu ve gözlendiği tamamlanmış kayıtlar; K-447). Açma uçları `Idempotency-Key`,
 * düzeltme, yeni sürüm, arşiv ve tamamlama `If-Match` ister. Gözlem okuması denetime düşer.
 */

const MANAGER = 'Rol: yalnız `yonetici`. Modül `finance`.'
const READERS =
  'Rol: `yonetici` hepsini; `ogretmen` yalnız gözlemcisi olduğu ve gözlendiği tamamlanmış gözlemleri görür (K-447). Modül `finance`.'
const TEMPLATES = '/api/v1/finance/lesson-observation-templates'
const OBSERVATIONS = '/api/v1/finance/lesson-observations'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceLessonObservationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const base: preValidationAsyncHookHandler[] = [app.authenticate, app.requireModule('finance')]
  const managers = [...base, app.requireRole(LESSON_OBSERVATION_MANAGE_ROLES)]
  const readers = [...base, app.requireRole(LESSON_OBSERVATION_READ_ROLES)]
  const tags = ['finance-lesson-observations']

  typed.get(
    TEMPLATES,
    {
      preValidation: managers,
      schema: {
        operationId: 'listLessonObservationTemplates',
        tags,
        summary: 'Ders gözlem formlarını listele',
        description: `Formlar son sürümleriyle, ada göre (DOM-FIN-130): ad, ölçütler (seviye tanımları ve ağırlık), son sürümle açılmış gözlem sayısı ve kullanıldı mı. Arşivli formlar \`includeArchived=true\` ile gelir. ${MANAGER}`,
        querystring: templateListQuery,
        response: { 200: templateListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, includeArchived } = request.query
      const { items, total } = await listObservationTemplatesFor(contextOf(request), {
        page,
        pageSize,
        q,
        includeArchived,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    TEMPLATES,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createLessonObservationTemplate',
        tags,
        summary: 'Ders gözlem formu oluştur',
        description: `Ad (2–120) ve 1–10 ölçüt: ad (2–120, formda tekil), isteğe bağlı açıklama, ağırlık (1–10, varsayılan 1) ve 0–5 seviyelerinin altı tanımı (rubrik bantları). Ölçüt kimliğini sunucu verir (k1, k2, …). Sürüm 1 olarak açılır (K-445). \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: lessonObservationTemplateInputSchema,
        response: { 201: templateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createObservationTemplateCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return templateResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${TEMPLATES}/:templateId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateLessonObservationTemplate',
        tags,
        summary: 'Kullanılmamış gözlem formunu düzelt',
        description: `Son sürümün adı ve ölçütleri yerinde düzeltilir; yalnız sürüm henüz gözlemde kullanılmadıysa. Kullanılmış sürüm 409 \`observation_template_used\` (yeni sürüm açın), arşivli form 409 \`observation_template_archived\` (K-445). \`If-Match\` şablon sürümü. Başka kurumun formu 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: templateParams,
        body: lessonObservationTemplateUpdateSchema,
        response: { 200: templateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateObservationTemplateCommand(
        contextOf(request),
        request.params.templateId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return templateResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${TEMPLATES}/:templateId/versions`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'createLessonObservationTemplateVersion',
        tags,
        summary: 'Gözlem formunun yeni sürümünü aç',
        description: `Ad ve ölçütlerin tamamıyla yeni sürüm açılır; önceki sürümler ve onlarla yapılmış gözlemler değişmez, yeni gözlem yeni sürümü kullanır (K-445). Arşivli form 409 \`observation_template_archived\`. \`If-Match\` şablon sürümü. Başka kurumun formu 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: templateParams,
        body: lessonObservationTemplateInputSchema,
        response: { 201: templateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await createObservationTemplateVersionCommand(
        contextOf(request),
        request.params.templateId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return templateResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${TEMPLATES}/:templateId/archive`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'archiveLessonObservationTemplate',
        tags,
        summary: 'Gözlem formunu arşivle',
        description: `Arşivli form yeni gözlemde seçilmez ve değiştirilmez; eski gözlemler kendi sürümüyle okunur (K-445). Zaten arşivliyse 409 \`observation_template_archived\`. Gövde boş nesne. \`If-Match\` şablon sürümü. Başka kurumun formu 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: templateParams,
        body: lessonObservationEmptySchema,
        response: { 200: templateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveObservationTemplateCommand(
        contextOf(request),
        request.params.templateId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return templateResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    OBSERVATIONS,
    {
      preValidation: readers,
      schema: {
        operationId: 'listLessonObservations',
        tags,
        summary: 'Ders gözlemlerini listele',
        description: `Gözlemler, yeni gün önce: öğretmen, gözlemci, gün, sınıf/ders, form ve sürümü, durum, ölçüt seviyeleri ve sunucunun rubrik kuralıyla hesapladığı puan (ağırlıklı toplam, azami, 100'lük; seviyesi eksikse boş). Öğretmen adında aranır, durum ve performans dönemiyle süzülür. Okuma aynı transaction'da denetime yazılır (\`finance.lesson_observation.read\`; alan adları ve kayıt sayısı). ${READERS}`,
        querystring: observationListQuery,
        response: { 200: observationListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, performancePeriodId } = request.query
      const { items, total } = await listLessonObservationsFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        performancePeriodId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${OBSERVATIONS}/:observationId`,
    {
      preValidation: readers,
      schema: {
        operationId: 'getLessonObservation',
        tags,
        summary: 'Ders gözlemini getir',
        description: `Gözlem ve kullanılan form sürümünün ölçütleri (seviye tanımları, ağırlık). Okuma denetime yazılır. Görülemeyen (öğretmende başkasının gözlemi ya da taslak hâlindeki kendi gözlemi) ve başka kurumun gözlemi 404. ${READERS}`,
        params: observationParams,
        response: { 200: observationDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getLessonObservationFor(contextOf(request), request.params.observationId),
    }),
  )

  typed.post(
    OBSERVATIONS,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createLessonObservation',
        tags,
        summary: 'Ders gözlemi aç',
        description: `Taslak açılır (K-446): form (son sürümü kullanılır), gözlenen öğretmen (etkin öğretmen üyeliği), gözlemci (etkin yönetici ya da öğretmen; boşsa isteği yapan), gün (bugünden sonra değil) ve isteğe bağlı sınıf, ders ve performans dönemi. Ölçüt seviyeleri boş başlar. Ret: form yok 422 \`observation_template_not_found\`, arşivli 409 \`observation_template_archived\`; öğretmen yok/öğretmen değil/ayrılmış 422 \`observation_teacher_not_found\`/\`observation_not_teacher\`/\`observation_teacher_inactive\`; gözlemci yok/uygun değil 422 \`observation_observer_not_found\`/\`observation_observer_invalid\`, kendisi 422 \`observation_self\`; sınıf/ders yok 422 \`observation_class_not_found\`/\`observation_subject_not_found\`; gün 422 \`observation_date_future\`; dönem yok/kapalı/gün dışında 422 \`observation_period_not_found\`/\`observation_period_closed\`/\`observation_date_outside_period\`. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: lessonObservationCreateSchema,
        response: { 201: observationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createLessonObservationCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return observationResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${OBSERVATIONS}/:observationId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateLessonObservation',
        tags,
        summary: 'Gözlem taslağını düzelt',
        description: `Kısmi düzeltme (K-446): gün, sınıf, ders, performans dönemi, ölçüt seviyeleri (0–5, boş = verilmedi) ve notları, genel değerlendirme. Gönderilen ölçütler yazılır, diğerleri korunur; bilinmeyen ya da yinelenen ölçüt 422 \`observation_criterion_invalid\`. Puan gövdede alınmaz, sunucu hesaplar. Tamamlanan gözlem 409 \`observation_completed\`, sürüm tutmazsa 409. Not metinleri denetime yazılmaz. \`If-Match\` zorunlu. Başka kurumun gözlemi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: observationParams,
        body: lessonObservationUpdateSchema,
        response: { 200: observationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateLessonObservationCommand(
        contextOf(request),
        request.params.observationId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return observationResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${OBSERVATIONS}/:observationId/complete`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'completeLessonObservation',
        tags,
        summary: 'Ders gözlemini tamamla',
        description: `Tamamlama (K-446): her ölçüte seviye verilmiş (422 \`observation_unrated\`), hedefin altındaki (0–2) seviyeye not yazılmış (422 \`observation_note_required\`, rubrik kriter yorumu kuralı) ve genel değerlendirme yazılmış (422 \`observation_general_note_required\`) olmalı. Tamamlanan gözlem değişmez; yeniden tamamlama 409 \`observation_completed\`. Gövde boş nesne. \`If-Match\` zorunlu. Başka kurumun gözlemi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: observationParams,
        body: lessonObservationEmptySchema,
        response: { 200: observationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await completeLessonObservationCommand(
        contextOf(request),
        request.params.observationId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return observationResponse.parse(sendBody(reply, result))
    },
  )
}
