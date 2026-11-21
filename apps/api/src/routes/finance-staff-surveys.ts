import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_STAFF_SURVEY_ROLES,
  STAFF_SURVEY_RESPONDENT_ROLES,
  staffSurveyCreateSchema,
  staffSurveyResponseSchema,
  staffSurveyUpdateSchema,
} from '@kampus/school-core/lib/finance-staff-surveys.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveStaffSurveyCommand,
  copyStaffSurveyCommand,
  createStaffSurveyCommand,
  getStaffSurveyFor,
  getStaffSurveyResultFor,
  listAssignedStaffSurveysFor,
  listStaffSurveysFor,
  publishStaffSurveyCommand,
  respondStaffSurveyCommand,
  updateStaffSurveyCommand,
} from '../services/finance-staff-surveys.ts'
import { requestFingerprint } from '../services/idempotency.ts'
import type { CommandResponse, IdempotencyRequest } from '../services/operation-runner.ts'
import { idempotencyOf } from './command-support.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  staffSurveyArchiveResponse,
  staffSurveyAssignedQuery,
  staffSurveyAssignedResponse,
  staffSurveyDetailResponse,
  staffSurveyListQuery,
  staffSurveyListResponse,
  staffSurveyRespondResponse,
  staffSurveyResponse,
  staffSurveyResultQuery,
  staffSurveyResultResponse,
  surveyParams,
} from './finance-staff-surveys.schemas.ts'

/**
 * Personel memnuniyet anketi uçları (docs/domain/finans.md DOM-FIN-143; ON-191). Modül
 * `finance`. Anketi yalnız yönetici hazırlar, yayımlar ve sonucunu okur; personel (yönetici,
 * öğretmen, ön büro) kendi anketlerini görür ve bir kez yanıtlar. Taslak, yeni sürüm ve yanıt
 * `Idempotency-Key`; düzeltme, yayım ve kaldırma `If-Match` ister. Tek yanıtı ya da yanıtlayanı
 * döndüren uç yoktur; sonucun okunuşu denetime düşer (K-485, K-486).
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-484). Modül `finance`.'
const STAFF =
  'Rol: personel (`yonetici`, `ogretmen`, `onburo`); yalnız kendi katılımcısı olduğu anket (K-485). Modül `finance`.'
const SURVEYS = '/api/v1/finance/staff-surveys'

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
 * Yanıtın istek özeti gövdesiz hesaplanır (K-485): özet kullanıcıya bağlı saklanır; kısa Likert
 * ve eNPS cevapları özetten denenerek bulunabilirdi. Aynı anahtar ilk yanıtı tekrarlar.
 */
function bodylessIdempotency(request: FastifyRequest): IdempotencyRequest {
  const idempotency = idempotencyOf(request, true)
  if (idempotency === null) throw new Error('Idempotency-Key guard did not run')
  return {
    key: idempotency.key,
    fingerprint: requestFingerprint(request.method, request.url, null),
  }
}

export function registerFinanceStaffSurveyRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_STAFF_SURVEY_ROLES),
  ]
  const staff: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(STAFF_SURVEY_RESPONDENT_ROLES),
  ]
  const tags = ['finance-staff-surveys']
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    SURVEYS,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listStaffSurveys',
        tags,
        summary: 'Personel anketleri',
        description: `Kurumun anketleri (kaldırılmış taslak hariç), en yeni açılış önce: aşama (\`draft\`, \`scheduled\`, \`open\`, \`closed\`; Europe/Istanbul gününden), tarihler, hedef kitle, eşik, soru sayısı ve yayımlanmışta katılım oranı (K-486). Aşama ve başlıkla süzülür. ${MANAGER}`,
        querystring: staffSurveyListQuery,
        response: { 200: staffSurveyListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, phase } = request.query
      const { items, total } = await listStaffSurveysFor(contextOf(request), {
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
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStaffSurvey',
        tags,
        summary: 'Anket taslağı aç',
        description: `Başlık (3–150), açılış ve kapanış günü (uçlar dahil, en çok 90 gün), isteğe bağlı eşik (3–10; verilmezse kurumun anonimlik eşiği), hedef kitle (rol ve birim süzgeci; bilinmeyen birim 422 \`staff_survey_unit_not_found\`) ve 1–30 soru (Likert 1–5, eNPS 0–10, açık uçlu) (K-484). \`Idempotency-Key\` zorunlu. Gövdedeki \`institutionId\` 400. ${MANAGER}`,
        headers: createHeaders,
        body: staffSurveyCreateSchema,
        response: { 201: staffSurveyResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStaffSurveyCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return staffSurveyResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${SURVEYS}/assigned`,
    {
      preValidation: staff,
      schema: {
        operationId: 'listAssignedStaffSurveys',
        tags,
        summary: 'Yanıtlayacağım anketler',
        description: `Oturumdaki personelin katılımcısı olduğu, kapanmamış yayımlanmış anketler, kapanışı yakın önce: sorular ve yanıtladınız mı (K-485). Başka personelin katılımı dönmez. ${STAFF}`,
        querystring: staffSurveyAssignedQuery,
        response: { 200: staffSurveyAssignedResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listAssignedStaffSurveysFor(contextOf(request), {
        page,
        pageSize,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${SURVEYS}/:surveyId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffSurvey',
        tags,
        summary: 'Anket ayrıntısı',
        description: `Sorular, hedef kitle birimlerinin adları, hedef kitle büyüklüğü (taslakta bugünkü personelle, yayımlanmışta donan liste) ve katılım oranı. Katılımcıların adı dönmez. Başka kurumun anketi 404. ${MANAGER}`,
        params: surveyParams,
        response: { 200: staffSurveyDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStaffSurveyFor(contextOf(request), request.params.surveyId),
    }),
  )

  typed.patch(
    `${SURVEYS}/:surveyId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateStaffSurvey',
        tags,
        summary: 'Taslağı düzelt',
        description: `Gönderilen alanlar değişir (en az bir alan). Yalnız taslak (409 \`staff_survey_not_draft\`); birleşen tarihler ters ya da 90 günden uzunsa 422 \`staff_survey_dates_invalid\`; bilinmeyen birim 422 \`staff_survey_unit_not_found\` (K-484). \`If-Match\` zorunlu; sürüm tutmazsa 409. Başka kurumun anketi 404. ${MANAGER}`,
        headers: versionHeaders,
        params: surveyParams,
        body: staffSurveyUpdateSchema,
        response: { 200: staffSurveyResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateStaffSurveyCommand(
        contextOf(request),
        request.params.surveyId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffSurveyResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${SURVEYS}/:surveyId`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'archiveStaffSurvey',
        tags,
        summary: 'Taslağı kaldır',
        description: `Taslak arşivlenir; yayımlanmış anket 409 \`staff_survey_not_draft\` (K-484). \`If-Match\` zorunlu. Başka kurumun anketi 404. ${MANAGER}`,
        headers: versionHeaders,
        params: surveyParams,
        response: { 200: staffSurveyArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveStaffSurveyCommand(
        contextOf(request),
        request.params.surveyId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffSurveyArchiveResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${SURVEYS}/:surveyId/publish`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'publishStaffSurvey',
        tags,
        summary: 'Anketi yayımla',
        description: `Bugün hedef kitleye uyan etkin personel katılımcı listesi olarak donar; sorular, tarihler, hedef kitle ve eşik artık değişmez (K-484). Yalnız taslak (409 \`staff_survey_not_draft\`); kapanış günü geçtiyse 422 \`staff_survey_closes_past\`; katılımcı eşikten azsa 422 \`staff_survey_audience_below_threshold\` (K-486). \`If-Match\` zorunlu. Başka kurumun anketi 404. ${MANAGER}`,
        headers: versionHeaders,
        params: surveyParams,
        response: { 200: staffSurveyResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await publishStaffSurveyCommand(
        contextOf(request),
        request.params.surveyId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffSurveyResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${SURVEYS}/:surveyId/copy`,
    {
      preValidation: [...guarded, rejectIfMatch()],
      schema: {
        operationId: 'copyStaffSurvey',
        tags,
        summary: 'Yeni sürüm aç',
        description: `Yayımlanmış anketin soruları, hedef kitlesi, tarihleri ve eşiğiyle yeni taslak açılır; sürüm numarası bir artar (K-484). Taslaktan 409 \`staff_survey_copy_draft\`; ankette etkin yeni sürüm varsa 409 \`staff_survey_copy_exists\`. \`Idempotency-Key\` zorunlu. Başka kurumun anketi 404. ${MANAGER}`,
        headers: createHeaders,
        params: surveyParams,
        response: { 201: staffSurveyResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await copyStaffSurveyCommand(
        contextOf(request),
        request.params.surveyId,
        options(request, 'required').idempotency,
      )
      return staffSurveyResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${SURVEYS}/:surveyId/results`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffSurveyResult',
        tags,
        summary: 'Anketin toplu sonucu',
        description: `Katılım oranı her zaman; sonuç yalnız anket kapandıktan sonra (\`hiddenReason: not_closed\`) ve en az eşik kadar yanıtla (\`below_threshold\`). Birim kırılımı (\`unit\`) eşik ve tamamlayıcı gizlemeyi geçmezse gösterilmez (\`unit_below_threshold\`); soru başına cevap da eşik altındaysa soru gizli. Puanlı soruda dağılım ve ortalama, eNPS sorusunda eNPS puanı; açık uçlu cevaplar karışık sırada, tarih/saat ve yanıtlayan olmadan (K-486). Okuma aynı transaction'da denetime yazılır (\`finance.staff_survey_result.read\`, alan adları). Başka kurumun anketi 404. ${MANAGER}`,
        params: surveyParams,
        querystring: staffSurveyResultQuery,
        response: { 200: staffSurveyResultResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStaffSurveyResultFor(
        contextOf(request),
        request.params.surveyId,
        request.query.unit ?? null,
      ),
    }),
  )

  typed.post(
    `${SURVEYS}/:surveyId/responses`,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'respondStaffSurvey',
        tags,
        summary: 'Anketi yanıtla',
        description: `Soru sırasıyla cevaplar (Likert 1–5, eNPS 0–10, açık uçlu metin ≤ 2000). Anket yanıta açık olmalı (açılmadıysa 422 \`staff_survey_not_open\`, kapandıysa 422 \`staff_survey_closed\`); kişi bir kez yanıtlar (409 \`staff_survey_already_responded\`); cevap sayısı, türü ya da ölçeği uymazsa 422 \`staff_survey_answers_mismatch\` / \`staff_survey_answer_kind\` / \`staff_survey_answer_range\`; zorunlu soru boşsa 422 \`staff_survey_incomplete\` (K-485). Yanıt kişiye bağlanmaz ve yanıt anı saklanmaz; denetime yalnız katılım yazılır, cevaplar yanıtta dönmez. \`Idempotency-Key\` zorunlu; özet gövdesiz hesaplanır, aynı anahtar ilk yanıtı tekrarlar. Katılımcısı olmadığı ya da başka kurumun anketi 404. ${STAFF}`,
        headers: createHeaders,
        params: surveyParams,
        body: staffSurveyResponseSchema,
        response: { 201: staffSurveyRespondResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await respondStaffSurveyCommand(
        contextOf(request),
        request.params.surveyId,
        request.commandInput,
        bodylessIdempotency(request),
      )
      return staffSurveyRespondResponse.parse(sendBody(reply, result))
    },
  )
}
