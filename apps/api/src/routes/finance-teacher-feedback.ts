import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_TEACHER_FEEDBACK_ROLES,
  TEACHER_FEEDBACK_RESPONDENT_ROLES,
  TEACHER_FEEDBACK_TEACHER_ROLES,
  teacherFeedbackCreateSchema,
  teacherFeedbackResponseSchema,
  teacherFeedbackUpdateSchema,
} from '@kampus/school-core/lib/finance-teacher-feedback.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveTeacherFeedbackCommand,
  closeTeacherFeedbackCommand,
  createTeacherFeedbackCommand,
  getTeacherFeedbackResultsFor,
  getTeacherFeedbackSurveyFor,
  getTeacherFeedbackTrendFor,
  listAssignedTeacherFeedbackFor,
  listMyTeacherFeedbackResultsFor,
  listTeacherFeedbackSurveysFor,
  publishTeacherFeedbackCommand,
  respondTeacherFeedbackCommand,
  updateTeacherFeedbackCommand,
} from '../services/finance-teacher-feedback.ts'
import { requestFingerprint } from '../services/idempotency.ts'
import type { CommandResponse, IdempotencyRequest } from '../services/operation-runner.ts'
import { idempotencyOf } from './command-support.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  teacherFeedbackArchiveResponse,
  teacherFeedbackAssignedResponse,
  teacherFeedbackDetailResponse,
  teacherFeedbackListQuery,
  teacherFeedbackListResponse,
  teacherFeedbackMineResponse,
  teacherFeedbackParams,
  teacherFeedbackRespondResponse,
  teacherFeedbackResultResponse,
  teacherFeedbackSurveyResponse,
  teacherFeedbackTrendQuery,
  teacherFeedbackTrendResponse,
} from './finance-teacher-feedback.schemas.ts'

/**
 * Öğretmen geri bildirim anketi uçları (docs/domain/finans.md DOM-FIN-159; ON-213; IST-069).
 * Modül `finance`. Anketi yalnız yönetici hazırlar, yayımlar, kapatır ve bütün sonuçları okur;
 * öğretmen yalnız kendi sonucunu ve eğilimini okur; öğrenci ve veli kendi (çocuğunun) sınıfının
 * öğretmenlerini her öğretmen için bir kez değerlendirir. Taslak ve yanıt `Idempotency-Key`;
 * düzeltme, yayım, kaldırma ve kapatma `If-Match` ister. Tek yanıtı ya da yanıtlayanı döndüren uç
 * yoktur; sonucun okunuşu denetime düşer (K-532, K-533).
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-532). Modül `finance`.'
const RESPONDENT =
  'Rol: `ogrenci` ve `veli`; yalnız hedef kitlesinde olduğu anket ve kendi (velide çocuğunun) sınıfının öğretmenleri (K-533). Modül `finance`.'
const TEACHER =
  'Rol: `ogretmen`; yalnız bağlı olduğu öğretmen kaydının sonucu (K-532). Modül `finance`.'
const SURVEYS = '/api/v1/finance/teacher-feedback-surveys'
const RESULTS = '/api/v1/finance/teacher-feedback-results'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

/**
 * Yanıtın istek özeti cevapsız hesaplanır (K-533): özet kullanıcıya bağlı saklanır; kısa ölçek
 * cevapları özetten denenerek bulunabilirdi. Özete yalnız değerlendirilen öğretmen girer (katılım
 * tablosunda zaten bulunur); aynı anahtar başka öğretmenle 422 `idempotency_key_reused`.
 */
function answerlessIdempotency(request: FastifyRequest, teacherId: string): IdempotencyRequest {
  const idempotency = idempotencyOf(request, true)
  if (idempotency === null) throw new Error('Idempotency-Key guard did not run')
  return {
    key: idempotency.key,
    fingerprint: requestFingerprint(request.method, request.url, { teacherId }),
  }
}

export function registerFinanceTeacherFeedbackRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guard = (roles: Parameters<typeof app.requireRole>[0]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const managed = guard(FINANCE_TEACHER_FEEDBACK_ROLES)
  const respondents = guard(TEACHER_FEEDBACK_RESPONDENT_ROLES)
  const teachers = guard(TEACHER_FEEDBACK_TEACHER_ROLES)
  const tags = ['finance-teacher-feedback']
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    SURVEYS,
    {
      preValidation: managed,
      schema: {
        operationId: 'listTeacherFeedbackSurveys',
        tags,
        summary: 'Öğretmen geri bildirim anketleri',
        description: `Kurumun anketleri (kaldırılmış taslak hariç), en yeni açılış önce: aşama, dönem, tarihler, hedef kitle, eşik, soru sayısı ve yayımlanmışta yanıt ve yanıtlayan sayısı. Aşama, başlık ve dönemle süzülür. ${MANAGER}`,
        querystring: teacherFeedbackListQuery,
        response: { 200: teacherFeedbackListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, phase } = request.query
      const { items, total } = await listTeacherFeedbackSurveysFor(contextOf(request), {
        page,
        pageSize,
        q,
        phase,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    SURVEYS,
    {
      preValidation: [...managed, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createTeacherFeedbackSurvey',
        tags,
        summary: 'Geri bildirim anketi taslağı aç',
        description: `Başlık (3–150), dönem (2–60), açılış ve kapanış günü (uçlar dahil, en çok 90 gün), isteğe bağlı eşik (5–20; verilmezse 5, kurum azaltamaz), hedef kitle (öğrenci, veli ya da ikisi; sınıf süzgeci, bilinmeyen sınıf 422 \`teacher_feedback_class_not_found\`) ve 1–20 soru (ölçek 1–5 ya da açık uçlu; en az bir ölçek sorusu) (K-532, K-533). \`Idempotency-Key\` zorunlu. Gövdedeki \`institutionId\` 400. ${MANAGER}`,
        headers: createHeaders,
        body: teacherFeedbackCreateSchema,
        response: { 201: teacherFeedbackSurveyResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createTeacherFeedbackCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return teacherFeedbackSurveyResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${SURVEYS}/assigned`,
    {
      preValidation: respondents,
      schema: {
        operationId: 'listAssignedTeacherFeedbackSurveys',
        tags,
        summary: 'Değerlendireceğim öğretmenler',
        description: `Oturumdaki öğrenci ya da velinin hedef kitlesinde olduğu, kapanmamış yayımlanmış anketler, kapanışı yakın önce: sorular ve değerlendirilebilecek öğretmenler (sınıf öğretmeni ve derse girenler; velide velayeti olan çocukların sınıfları) ile değerlendirdiniz mi. Öğretmeni olmayan anket dönmez. ${RESPONDENT}`,
        response: { 200: teacherFeedbackAssignedResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listAssignedTeacherFeedbackFor(contextOf(request)) }),
  )

  typed.get(
    `${SURVEYS}/:surveyId`,
    {
      preValidation: managed,
      schema: {
        operationId: 'getTeacherFeedbackSurvey',
        tags,
        summary: 'Geri bildirim anketi ayrıntısı',
        description: `Sorular, hedef kitle sınıflarının adları ve katılım sayıları. Yanıtlayanların adı dönmez. Başka kurumun anketi 404. ${MANAGER}`,
        params: teacherFeedbackParams,
        response: { 200: teacherFeedbackDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getTeacherFeedbackSurveyFor(contextOf(request), request.params.surveyId),
    }),
  )

  typed.patch(
    `${SURVEYS}/:surveyId`,
    {
      preValidation: [...managed, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateTeacherFeedbackSurvey',
        tags,
        summary: 'Geri bildirim taslağını düzelt',
        description: `Gönderilen alanlar değişir (en az bir alan). Yalnız taslak (409 \`teacher_feedback_not_draft\`); birleşen tarihler ters ya da 90 günden uzunsa 422 \`teacher_feedback_dates_invalid\`; bilinmeyen sınıf 422 \`teacher_feedback_class_not_found\`. \`If-Match\` zorunlu; sürüm tutmazsa 409. Başka kurumun anketi 404. ${MANAGER}`,
        headers: versionHeaders,
        params: teacherFeedbackParams,
        body: teacherFeedbackUpdateSchema,
        response: { 200: teacherFeedbackSurveyResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateTeacherFeedbackCommand(
        contextOf(request),
        request.params.surveyId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return teacherFeedbackSurveyResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${SURVEYS}/:surveyId`,
    {
      preValidation: [...managed, requireIfMatch()],
      schema: {
        operationId: 'archiveTeacherFeedbackSurvey',
        tags,
        summary: 'Geri bildirim taslağını kaldır',
        description: `Taslak arşivlenir; yayımlanmış anket 409 \`teacher_feedback_not_draft\`. \`If-Match\` zorunlu. Başka kurumun anketi 404. ${MANAGER}`,
        headers: versionHeaders,
        params: teacherFeedbackParams,
        response: { 200: teacherFeedbackArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveTeacherFeedbackCommand(
        contextOf(request),
        request.params.surveyId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return teacherFeedbackArchiveResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${SURVEYS}/:surveyId/publish`,
    {
      preValidation: [...managed, requireIfMatch()],
      schema: {
        operationId: 'publishTeacherFeedbackSurvey',
        tags,
        summary: 'Geri bildirim anketini yayımla',
        description: `Sorular, tarihler, hedef kitle ve eşik artık değişmez. Yalnız taslak (409 \`teacher_feedback_not_draft\`); kapanış günü geçtiyse 422 \`teacher_feedback_closes_past\`; süzgeçteki sınıf kaldırıldıysa 422 \`teacher_feedback_class_not_found\`. \`If-Match\` zorunlu. Başka kurumun anketi 404. ${MANAGER}`,
        headers: versionHeaders,
        params: teacherFeedbackParams,
        response: { 200: teacherFeedbackSurveyResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await publishTeacherFeedbackCommand(
        contextOf(request),
        request.params.surveyId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return teacherFeedbackSurveyResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${SURVEYS}/:surveyId/close`,
    {
      preValidation: [...managed, requireIfMatch()],
      schema: {
        operationId: 'closeTeacherFeedbackSurvey',
        tags,
        summary: 'Geri bildirim anketini kapat',
        description: `Yayımlanmış anket kapanış gününden önce kapatılır: yanıt alınmaz, sonuç açılır; geri alınmaz. Taslak 409 \`teacher_feedback_close_draft\`; kapanmış anket 409 \`teacher_feedback_already_closed\`. \`If-Match\` zorunlu. Başka kurumun anketi 404. ${MANAGER}`,
        headers: versionHeaders,
        params: teacherFeedbackParams,
        response: { 200: teacherFeedbackSurveyResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await closeTeacherFeedbackCommand(
        contextOf(request),
        request.params.surveyId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return teacherFeedbackSurveyResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${SURVEYS}/:surveyId/results`,
    {
      preValidation: managed,
      schema: {
        operationId: 'getTeacherFeedbackResults',
        tags,
        summary: 'Öğretmen başına sonuç',
        description: `Yanıt alan her öğretmen için yanıt sayısı; sonuç yalnız anket kapandıktan sonra (\`hiddenReason: not_closed\`) ve en az eşik kadar yanıtla (\`below_threshold\`). Soru başına cevap eşik altındaysa soru gizli; açık uçlu cevaplar eşik altında hiç dönmez, karışık sırada, sınıf, tarih ve yanıtlayan olmadan döner. Sınıf kırılımında eşik altındaki sınıflar "Diğer sınıflar" grubunda birleşir (K-532). Okuma aynı transaction'da denetime yazılır (\`finance.teacher_feedback_result.read\`). Başka kurumun anketi 404. ${MANAGER}`,
        params: teacherFeedbackParams,
        response: { 200: teacherFeedbackResultResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getTeacherFeedbackResultsFor(contextOf(request), request.params.surveyId),
    }),
  )

  typed.post(
    `${SURVEYS}/:surveyId/responses`,
    {
      preValidation: [...respondents, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'respondTeacherFeedbackSurvey',
        tags,
        summary: 'Öğretmeni değerlendir',
        description: `Bir öğretmen için soru sırasıyla cevaplar (ölçek 1–5, açık uçlu metin ≤ 1000). Anket yanıta açık olmalı (açılmadıysa 422 \`teacher_feedback_not_open\`, kapandıysa 422 \`teacher_feedback_closed\`); öğretmen yanıtlayanın sınıfının öğretmeni olmalı (422 \`teacher_feedback_teacher_not_eligible\`); her öğretmen bir kez (409 \`teacher_feedback_already_responded\`); cevap sayısı, türü ya da ölçeği uymazsa 422 \`teacher_feedback_answers_mismatch\` / \`teacher_feedback_answer_kind\` / \`teacher_feedback_answer_range\`; zorunlu soru boşsa 422 \`teacher_feedback_incomplete\` (K-533). Yanıt kişiye bağlanmaz, rol ve yanıt anı saklanmaz; denetime yalnız katılım yazılır, cevaplar yanıtta dönmez. \`Idempotency-Key\` zorunlu; özet cevapsız hesaplanır. Rolü hedef kitlede olmadığı ya da başka kurumun anketi 404. ${RESPONDENT}`,
        headers: createHeaders,
        params: teacherFeedbackParams,
        body: teacherFeedbackResponseSchema,
        response: { 201: teacherFeedbackRespondResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await respondTeacherFeedbackCommand(
        contextOf(request),
        request.params.surveyId,
        request.commandInput,
        answerlessIdempotency(request, request.body.teacherId),
      )
      return teacherFeedbackRespondResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${RESULTS}/mine`,
    {
      preValidation: teachers,
      schema: {
        operationId: 'listMyTeacherFeedbackResults',
        tags,
        summary: 'Geri bildirim sonuçlarım',
        description: `Oturumdaki öğretmenin bağlı olduğu öğretmen kaydının kapanan anketlerdeki sonucu (yeniden eskiye, en çok 12): ortalama, dağılım, eşik üstünde açık uçlu yorumlar ve sınıf kırılımı; dönemler arası eğilim (genel ortalama). Eşik altındaki dönem gizli. Bağlantısı olmayan öğretmene boş liste. Okuma denetime yazılır. ${TEACHER}`,
        response: { 200: teacherFeedbackMineResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listMyTeacherFeedbackResultsFor(contextOf(request)) }),
  )

  typed.get(
    `${RESULTS}/trend`,
    {
      preValidation: managed,
      schema: {
        operationId: 'getTeacherFeedbackTrend',
        tags,
        summary: 'Öğretmenin dönemler arası eğilimi',
        description: `Öğretmenin kapanan anketlerdeki genel ortalaması, eskiden yeniye, en çok 12 dönem; eşik altındaki dönem ortalama taşımaz (K-532). Bilinmeyen öğretmen 404. Okuma denetime yazılır. ${MANAGER}`,
        querystring: teacherFeedbackTrendQuery,
        response: { 200: teacherFeedbackTrendResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getTeacherFeedbackTrendFor(contextOf(request), request.query.teacherId),
    }),
  )
}
