import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  CANDIDATE_INTERVIEW_EVALUATOR_ROLES,
  CANDIDATE_INTERVIEW_MANAGE_ROLES,
  candidateEvaluationInputSchema,
  candidateInterviewCreateSchema,
  candidateInterviewEmptySchema,
  candidateInterviewUpdateSchema,
  interviewTemplateInputSchema,
  interviewTemplateUpdateSchema,
} from '@kampus/school-core/lib/finance-candidate-interviews.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveInterviewTemplateCommand,
  cancelCandidateInterviewCommand,
  completeCandidateInterviewCommand,
  createCandidateInterviewCommand,
  createInterviewTemplateCommand,
  createInterviewTemplateVersionCommand,
  listApplicationInterviewsFor,
  listAssignedInterviewsFor,
  listInterviewTemplatesFor,
  submitCandidateEvaluationCommand,
  updateCandidateInterviewCommand,
  updateInterviewTemplateCommand,
} from '../services/finance-candidate-interviews.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  applicationInterviewsResponse,
  assignedInterviewListQuery,
  assignedInterviewListResponse,
  candidateInterviewResponse,
  interviewApplicationParams,
  interviewParams,
  interviewTemplateListQuery,
  interviewTemplateListResponse,
  interviewTemplateParams,
  interviewTemplateResponse,
} from './finance-candidate-interviews.schemas.ts'

/**
 * Aday değerlendirme ve mülakat uçları (docs/domain/finans.md DOM-FIN-138; ON-178; K-469…K-471).
 * Modül `finance`. Mülakat formu, planlama, durum ve başvurudaki mülakatlar yalnız yönetici;
 * değerlendirici (yönetici ya da öğretmen) kendi listesini okur ve formunu gönderir. Açma ve
 * gönderim `Idempotency-Key`, düzeltme, yeni sürüm, arşiv, yapıldı ve iptal `If-Match` ister.
 */

const MANAGER = 'Rol: yalnız `yonetici`. Modül `finance`.'
const EVALUATORS =
  'Rol: `yonetici` ve `ogretmen`; yalnız değerlendiricisi olunan mülakat (öğretmen için diğerleri 404). Modül `finance`.'
const TEMPLATES = '/api/v1/finance/interview-templates'
const INTERVIEWS = '/api/v1/finance/candidate-interviews'

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

export function registerFinanceCandidateInterviewRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const base: preValidationAsyncHookHandler[] = [app.authenticate, app.requireModule('finance')]
  const managers = [...base, app.requireRole(CANDIDATE_INTERVIEW_MANAGE_ROLES)]
  const evaluators = [...base, app.requireRole(CANDIDATE_INTERVIEW_EVALUATOR_ROLES)]
  const tags = ['finance-candidate-interviews']

  typed.get(
    TEMPLATES,
    {
      preValidation: managers,
      schema: {
        operationId: 'listInterviewTemplates',
        tags,
        summary: 'Mülakat formlarını listele',
        description: `Formlar son sürümleriyle, ada göre (DOM-FIN-138): ad, ölçek, ölçütler ve ağırlıklar, son sürümle planlanmış mülakat sayısı ve kullanıldı mı. Arşivli formlar \`includeArchived=true\` ile gelir. Örnek derste ders gözlem formu (\`/finance/lesson-observation-templates\`) kullanılır. ${MANAGER}`,
        querystring: interviewTemplateListQuery,
        response: { 200: interviewTemplateListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, includeArchived } = request.query
      const { items, total } = await listInterviewTemplatesFor(contextOf(request), {
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
        operationId: 'createInterviewTemplate',
        tags,
        summary: 'Mülakat formu oluştur',
        description: `Ad (2–120), ölçek (3–10, varsayılan 5; puanlar 1–ölçek) ve 1–10 ölçüt: ad (2–120, formda tekil), isteğe bağlı açıklama, ağırlık (1–10, varsayılan 1). Ölçüt kimliğini sunucu verir (k1, k2, …). Sürüm 1 olarak açılır (K-470). Denetim \`finance.interview_template.create\`. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: interviewTemplateInputSchema,
        response: { 201: interviewTemplateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createInterviewTemplateCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return interviewTemplateResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${TEMPLATES}/:templateId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateInterviewTemplate',
        tags,
        summary: 'Kullanılmamış mülakat formunu düzelt',
        description: `Son sürümün adı, ölçeği ve ölçütleri yerinde düzeltilir; yalnız sürüm henüz mülakatta kullanılmadıysa. Kullanılmış sürüm 409 \`interview_template_used\` (yeni sürüm açın), arşivli form 409 \`interview_template_archived\` (K-470). \`If-Match\` şablon sürümü. Başka kurumun formu 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: interviewTemplateParams,
        body: interviewTemplateUpdateSchema,
        response: { 200: interviewTemplateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateInterviewTemplateCommand(
        contextOf(request),
        request.params.templateId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return interviewTemplateResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${TEMPLATES}/:templateId/versions`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'createInterviewTemplateVersion',
        tags,
        summary: 'Mülakat formunun yeni sürümünü aç',
        description: `Tam gövde (ad, ölçek, ölçütler). Önceki sürümler ve onlarla yapılmış değerlendirmeler değişmez; yeni mülakat bu sürümü kullanır. Arşivli form 409 \`interview_template_archived\` (K-470). \`If-Match\` şablon sürümü. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: interviewTemplateParams,
        body: interviewTemplateInputSchema,
        response: { 201: interviewTemplateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await createInterviewTemplateVersionCommand(
        contextOf(request),
        request.params.templateId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return interviewTemplateResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${TEMPLATES}/:templateId/archive`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'archiveInterviewTemplate',
        tags,
        summary: 'Mülakat formunu arşivle',
        description: `Arşivli form yeni mülakatta seçilmez (422 \`candidate_interview_template_archived\`); eski mülakatlar sürümüyle okunur. Zaten arşivli 409 \`interview_template_archived\`. Gövde \`{}\`. \`If-Match\` şablon sürümü. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: interviewTemplateParams,
        body: candidateInterviewEmptySchema,
        response: { 200: interviewTemplateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await archiveInterviewTemplateCommand(
        contextOf(request),
        request.params.templateId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return interviewTemplateResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/job-applications/:applicationId/interviews',
    {
      preValidation: managers,
      schema: {
        operationId: 'listApplicationInterviews',
        tags,
        summary: 'Başvurunun mülakatları',
        description: `Mülakatlar ana göre: tür, an, yer ya da bağlantı, durum, form sürümü (ölçütler), değerlendiriciler ve gönderdikleri puan ve notlar (puan sunucuda hesaplanır), mülakat başına değerlendirici ortalaması ve başvurunun özeti (K-469, K-470). Başka kurumun başvurusu 404. ${MANAGER}`,
        params: interviewApplicationParams,
        response: { 200: applicationInterviewsResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await listApplicationInterviewsFor(contextOf(request), request.params.applicationId),
    }),
  )

  typed.post(
    '/api/v1/finance/job-applications/:applicationId/interviews',
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createCandidateInterview',
        tags,
        summary: 'Mülakat planla',
        description: `Başvuru "mülakat" aşamasında olmalı (422 \`candidate_interview_stage\`; anonim 422 \`candidate_interview_application_anonymized\`). Tür, an (ISO 8601; geçmiş olabilir), yer (yüz yüze ve örnek derste zorunlu, 400), bağlantı (çevrim içide zorunlu, https, 400), form (örnek derste ders gözlem formu, diğerlerinde mülakat formu; son sürüm; yok 422 \`candidate_interview_template_not_found\`, arşivli 422 \`candidate_interview_template_archived\`) ve 1–5 değerlendirici (kurumun etkin yönetici ya da öğretmeni; yok 422 \`candidate_interview_evaluator_not_found\`, başka rol ya da pasif 422 \`candidate_interview_evaluator_invalid\`). Durum \`planned\` (K-469). Denetim \`finance.candidate_interview.create\`. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: interviewApplicationParams,
        body: candidateInterviewCreateSchema,
        response: { 201: candidateInterviewResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createCandidateInterviewCommand(
        contextOf(request),
        request.params.applicationId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = candidateInterviewResponse.parse(sendBody(reply, result))
      reply.header('location', `${INTERVIEWS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${INTERVIEWS}/assigned`,
    {
      preValidation: evaluators,
      schema: {
        operationId: 'listAssignedCandidateInterviews',
        tags,
        summary: 'Değerlendiricisi olduğum mülakatlar',
        description: `İsteği yapanın değerlendiricisi olduğu, iptal edilmemiş ve başvurusu anonimleştirilmemiş mülakatlar, yakın an önce: aday adı, ilan, tür, an, yer ya da bağlantı, form ve yalnız kendi değerlendirmesi (K-470). \`pending=true\` yalnız gönderilmemişler. ${EVALUATORS}`,
        querystring: assignedInterviewListQuery,
        response: { 200: assignedInterviewListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, pending } = request.query
      const { items, total } = await listAssignedInterviewsFor(contextOf(request), {
        page,
        pageSize,
        pending: pending === true,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.patch(
    `${INTERVIEWS}/:interviewId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateCandidateInterview',
        tags,
        summary: 'Planlı mülakatı düzelt',
        description: `Gönderilen alanlar değişir: an, yer, bağlantı. Yalnız planlı mülakat (422 \`candidate_interview_not_planned\`); değişiklik yoksa 422 \`candidate_interview_unchanged\`; türün yeri ya da bağlantısı silinirse 422 \`candidate_interview_location_required\`, \`candidate_interview_link_required\` (K-469). \`If-Match\` mülakat sürümü. Denetim \`finance.candidate_interview.update\` (alan adları). ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: interviewParams,
        body: candidateInterviewUpdateSchema,
        response: { 200: candidateInterviewResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateCandidateInterviewCommand(
        contextOf(request),
        request.params.interviewId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return candidateInterviewResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${INTERVIEWS}/:interviewId/complete`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'completeCandidateInterview',
        tags,
        summary: 'Mülakatı "yapıldı" işaretle',
        description: `Yalnız planlı mülakat (422 \`candidate_interview_not_planned\`) ve mülakat anı geldiyse (422 \`candidate_interview_not_started\`). Değerlendiriciler formu bundan sonra gönderir; başvuru "teklif"e bundan sonra geçebilir (K-469). Gövde \`{}\`. \`If-Match\` mülakat sürümü. Denetim \`finance.candidate_interview.complete\`. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: interviewParams,
        body: candidateInterviewEmptySchema,
        response: { 200: candidateInterviewResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await completeCandidateInterviewCommand(
        contextOf(request),
        request.params.interviewId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return candidateInterviewResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${INTERVIEWS}/:interviewId/cancel`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelCandidateInterview',
        tags,
        summary: 'Mülakatı iptal et',
        description: `Yalnız planlı mülakat (422 \`candidate_interview_not_planned\`); satır silinmez, değerlendirme açılmaz (K-469). Gövde \`{}\`. \`If-Match\` mülakat sürümü. Denetim \`finance.candidate_interview.cancel\`. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: interviewParams,
        body: candidateInterviewEmptySchema,
        response: { 200: candidateInterviewResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await cancelCandidateInterviewCommand(
        contextOf(request),
        request.params.interviewId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return candidateInterviewResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${INTERVIEWS}/:interviewId/evaluation`,
    {
      preValidation: [...evaluators, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'submitCandidateEvaluation',
        tags,
        summary: 'Mülakat değerlendirmemi gönder',
        description: `Değerlendirici kendi formunu bir kez gönderir: formdaki her ölçüte bir puan (mülakat formunda 1–ölçek, örnek derste 0–5; 422 \`candidate_evaluation_score_range\`, \`candidate_evaluation_criterion_invalid\`, \`candidate_evaluation_unrated\`) ve not, genel değerlendirme (zorunlu, 400). Örnek derste hedefin altındaki (0–2) seviyeye not zorunlu (422 \`candidate_evaluation_note_required\`; gözlem kuralı, K-471). Mülakat yapılmış olmalı (422 \`candidate_interview_not_completed\`); gönderilmiş değerlendirme 409 \`candidate_evaluation_submitted\`; değerlendirici olmayan yönetici 422 \`candidate_interview_not_evaluator\`. Puan sunucuda hesaplanır (K-470). Denetim \`finance.candidate_interview.evaluate\` (alan adları; puan ve not yazılmaz). \`Idempotency-Key\` zorunlu. ${EVALUATORS}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: interviewParams,
        body: candidateEvaluationInputSchema,
        response: { 200: candidateInterviewResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await submitCandidateEvaluationCommand(
        contextOf(request),
        request.params.interviewId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return candidateInterviewResponse.parse(sendBody(reply, result))
    },
  )
}
