import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_JOB_POSTING_MANAGE_ROLES,
  FINANCE_JOB_POSTING_ROLES,
  jobApplicationAnonymizationInputSchema,
  jobApplicationInputSchema,
  jobApplicationSettingsSchema,
  jobApplicationStageInputSchema,
  jobApplicationUpdateSchema,
  jobPostingInputSchema,
  jobPostingStatusInputSchema,
} from '@kampus/school-core/lib/finance-job-postings.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  anonymizeJobApplicationsCommand,
  changeJobApplicationStageCommand,
  changeJobPostingStatusCommand,
  createJobApplicationCommand,
  createJobPostingCommand,
  getJobApplicationFor,
  getJobPostingFor,
  jobApplicationSettingsFor,
  listJobApplicationsFor,
  listJobPostingsFor,
  listRetentionDueFor,
  setJobApplicationSettingsCommand,
  updateJobApplicationCommand,
  updateJobPostingCommand,
} from '../services/finance-job-postings.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  jobApplicationAnonymizationResponse,
  jobApplicationListQuery,
  jobApplicationListResponse,
  jobApplicationParams,
  jobApplicationResponse,
  jobApplicationRetentionQuery,
  jobApplicationRetentionResponse,
  jobApplicationSettingsResponse,
  jobPostingListQuery,
  jobPostingListResponse,
  jobPostingParams,
  jobPostingResponse,
} from './finance-job-postings.schemas.ts'

/**
 * İş ilanı ve başvuru havuzu uçları (docs/domain/finans.md DOM-FIN-128; ON-177; K-439…K-441).
 * Modül `finance`. İlan okuma ve başvuru girişi yönetici ve ön büro; ilan yazma, başvuru havuzu,
 * aşama, saklama ayarı ve anonimleştirme yalnız yönetici (K-440). Sıra: 401 → 403 modül → 403 rol
 * → başlıklar → 400 → işlem. Oturumsuz (kurum sitesine gömülü) form ucu yoktur.
 */

const STAFF = 'Rol: `yonetici` ve `onburo`. Modül `finance`.'
const MANAGER = 'Rol: yalnız `yonetici` (ön büro 403). Modül `finance`.'
const POSTINGS = '/api/v1/finance/job-postings'
const APPLICATIONS = '/api/v1/finance/job-applications'
const SETTINGS = '/api/v1/finance/job-application-settings'

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

export function registerFinanceJobPostingRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const staff = guarded(FINANCE_JOB_POSTING_ROLES)
  const manager = guarded(FINANCE_JOB_POSTING_MANAGE_ROLES)
  const tags = ['finance-job-postings']

  typed.get(
    POSTINGS,
    {
      preValidation: staff,
      schema: {
        operationId: 'listJobPostings',
        tags,
        summary: 'İş ilanları',
        description: `İlanlar: taslak ve yayındakiler önce, son başvuru gününe göre. Satırda başvuru, süren başvuru ve işe alınan sayısı; yayındaki ilanın son başvuru günü geçtiyse \`deadlinePassed\` (K-439). Arama başlık ve pozisyonda. ${STAFF}`,
        querystring: jobPostingListQuery,
        response: { 200: jobPostingListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, employmentType } = request.query
      const { items, total } = await listJobPostingsFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        employmentType,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    POSTINGS,
    {
      preValidation: [...manager, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createJobPosting',
        tags,
        summary: 'İş ilanı aç',
        description: `Başlık (2–160), pozisyon/branş (2–120), çalışma türü, açıklama (10–4000), isteğe bağlı nitelikler (≤ 4000), yayın ve son başvuru günü (yayından önce olamaz, 400). İlan taslak açılır (K-439). Denetim \`finance.job_posting.create\`. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: jobPostingInputSchema,
        response: { 201: jobPostingResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createJobPostingCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = jobPostingResponse.parse(sendBody(reply, result))
      reply.header('location', `${POSTINGS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${POSTINGS}/:postingId`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getJobPosting',
        tags,
        summary: 'İş ilanı',
        description: `İlan ve başvuru sayıları. Başka kurumun ilanı 404. ${STAFF}`,
        params: jobPostingParams,
        response: { 200: jobPostingResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getJobPostingFor(contextOf(request), request.params.postingId),
    }),
  )

  typed.patch(
    `${POSTINGS}/:postingId`,
    {
      preValidation: [...manager, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateJobPosting',
        tags,
        summary: 'İş ilanını düzelt',
        description: `Tam gövde. Kapanan ilan 422 \`job_posting_closed\`; değişiklik yoksa 422 \`job_posting_unchanged\`; yayındaki ilanın yayın günü 422 \`job_posting_publish_locked\`; son başvuru günü alınmış başvuruların gününden önceye 422 \`job_posting_deadline_before_applications\` (K-439). \`If-Match\` zorunlu; sürüm tutmazsa 409. Denetim \`finance.job_posting.update\` (alan adları). ${MANAGER}`,
        params: jobPostingParams,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: jobPostingInputSchema,
        response: { 200: jobPostingResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateJobPostingCommand(
        contextOf(request),
        request.params.postingId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return jobPostingResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${POSTINGS}/:postingId/status`,
    {
      preValidation: [...manager, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'changeJobPostingStatus',
        tags,
        summary: 'İş ilanını yayımla ya da kapat',
        description: `Taslak → yayında → kapandı; taslak doğrudan kapanabilir, kapanan ilan yeniden açılmaz (422 \`job_posting_transition\`). Son başvuru günü geçmiş ilan yayımlanmaz (422 \`job_posting_deadline_passed\`). Kapanış günü bugündür; kapanan ilandaki işe alınmamış başvuruların saklama süresi bu günden başlar (K-441). \`If-Match\` zorunlu. Denetim \`finance.job_posting.status\`. ${MANAGER}`,
        params: jobPostingParams,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: jobPostingStatusInputSchema,
        response: { 200: jobPostingResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await changeJobPostingStatusCommand(
        contextOf(request),
        request.params.postingId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return jobPostingResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    APPLICATIONS,
    {
      preValidation: manager,
      schema: {
        operationId: 'listJobApplications',
        tags,
        summary: 'Başvuru havuzu',
        description: `Başvurular en yeni önce; satır iletişim ve not taşımaz (K-440). Süzgeç ilan, aşama, kanal ve \`open=true\` (süren başvurular); arama aday adı ve ilan başlığında. Satırda saklama süresinin dolduğu gün (K-441). ${MANAGER}`,
        querystring: jobApplicationListQuery,
        response: { 200: jobApplicationListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, jobPostingId, stage, channel, open } = request.query
      const { items, total } = await listJobApplicationsFor(contextOf(request), {
        page,
        pageSize,
        q,
        jobPostingId,
        stage,
        channel,
        open: open === 'true',
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    APPLICATIONS,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createJobApplication',
        tags,
        summary: 'Başvuru kaydet',
        description: `Personel başvuruyu girer (kurum sitesi, e-posta, elden, tavsiye): ilan, aday adı, e-posta ya da telefon (biri zorunlu, 400), kanal, başvuru günü, isteğe bağlı özgeçmiş (\`POST /files\` amaç \`document\`, PDF; yükleyenin, hazır ve bağsız), gösterilen aday aydınlatma metni sürümü ve günü (zorunlu), not. İlan yok 422 \`job_application_posting_not_found\`, taslak 422 \`job_application_posting_draft\`; başvuru günü yayından önce 422 \`job_application_before_publish\`, son başvurudan sonra 422 \`job_application_after_deadline\`, bugünden sonra 422 \`job_application_received_in_future\`; aydınlatma günü bugünden sonra 422 \`job_application_notice_in_future\`. Aynı ilana aynı e-posta ya da telefon 409 \`job_application_duplicate\` (K-440). Aşama \`new\`, geçmişe ilk satır yazılır. Denetim \`finance.job_application.create\` (alan adları; aday verisi yok). \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: jobApplicationInputSchema,
        response: { 201: jobApplicationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createJobApplicationCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = jobApplicationResponse.parse(sendBody(reply, result))
      reply.header('location', `${APPLICATIONS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${APPLICATIONS}/:applicationId`,
    {
      preValidation: manager,
      schema: {
        operationId: 'getJobApplication',
        tags,
        summary: 'Başvuru ayrıntısı',
        description: `İletişim, özgeçmiş, aydınlatma kaydı, not ve aşama geçmişi. Anonimleştirilmiş başvuruda kişisel alanlar boştur. Başka kurumun başvurusu 404. ${MANAGER}`,
        params: jobApplicationParams,
        response: { 200: jobApplicationResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getJobApplicationFor(contextOf(request), request.params.applicationId),
    }),
  )

  typed.patch(
    `${APPLICATIONS}/:applicationId`,
    {
      preValidation: [...manager, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateJobApplication',
        tags,
        summary: 'Başvuruyu düzelt',
        description: `Gönderilen alanlar değişir: ad, e-posta, telefon, not. Anonimleştirilmiş 422 \`job_application_anonymized\`; değişiklik yoksa 422 \`job_application_unchanged\`; iletişim kalmazsa 422 \`job_application_contact_required\`; aynı ilanda aynı iletişim 409 \`job_application_duplicate\`. \`If-Match\` zorunlu. Denetim \`finance.job_application.update\` (alan adları). ${MANAGER}`,
        params: jobApplicationParams,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: jobApplicationUpdateSchema,
        response: { 200: jobApplicationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateJobApplicationCommand(
        contextOf(request),
        request.params.applicationId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return jobApplicationResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${APPLICATIONS}/:applicationId/stage`,
    {
      preValidation: [...manager, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'changeJobApplicationStage',
        tags,
        summary: 'Başvurunun aşamasını değiştir',
        description: `Yalnız ileri (ara aşama atlanabilir) ya da açık her aşamadan \`rejected\`; geri 422 \`job_application_stage_transition\`, aynı aşama 422 \`job_application_stage_unchanged\`, işe alındı ve reddedildi sondur (422 \`job_application_closed\`). Gün bugünden sonra (422 \`job_application_stage_in_future\`) ve önceki aşama gününden önce (422 \`job_application_stage_before_previous\`) olamaz. Geçmişe satır yazılır (K-440). \`If-Match\` zorunlu. Denetim \`finance.job_application.stage\`. ${MANAGER}`,
        params: jobApplicationParams,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: jobApplicationStageInputSchema,
        response: { 200: jobApplicationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await changeJobApplicationStageCommand(
        contextOf(request),
        request.params.applicationId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return jobApplicationResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/job-application-retention',
    {
      preValidation: manager,
      schema: {
        operationId: 'listJobApplicationRetention',
        tags,
        summary: 'Saklama süresi dolan başvurular',
        description: `Anonimleştirilmemiş, işe alınmamış ve saklama süresi dolmuş başvurular, en eski süre sonu önce: reddedilende ret gününden, kapanan ilandaki süren başvuruda kapanış gününden itibaren kurum ayarlı süre (K-441). ${MANAGER}`,
        querystring: jobApplicationRetentionQuery,
        response: { 200: jobApplicationRetentionResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total, retentionMonths } = await listRetentionDueFor(contextOf(request), {
        page,
        pageSize,
      })
      return { data: items, meta: { page, pageSize, total, retentionMonths } }
    },
  )

  typed.post(
    '/api/v1/finance/job-application-anonymizations',
    {
      preValidation: [...manager, app.requireFreshSession, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'anonymizeJobApplications',
        tags,
        summary: 'Başvuruları anonimleştir',
        description: `1–100 başvuru tek işlemde; biri reddedilirse hiçbiri değişmez. Ad "Anonim aday" olur, e-posta, telefon, not ve özgeçmiş bağı silinir; özgeçmiş dosyasının saklama sonu şimdiye çekilir, nesneyi platformun saklama sonu imhası siler. İlan, kanal, günler, aşama geçmişi ve aydınlatma kaydı kalır (K-441). \`retention_expired\` yalnız süresi dolanlarda (422 \`job_application_retention_not_due\`); \`data_subject_request\` süre beklemez. Olmayan ya da başka kurumun 422 \`job_application_not_found\`, anonim 422 \`job_application_already_anonymized\`, işe alınan 422 \`job_application_hired\`. Başvuru başına \`finance.job_application.anonymize\` denetimi. Taze oturum (403 \`reauthentication_required\`) ve \`Idempotency-Key\` zorunlu. Geri alınamaz. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: jobApplicationAnonymizationInputSchema,
        response: { 200: jobApplicationAnonymizationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await anonymizeJobApplicationsCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return jobApplicationAnonymizationResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    SETTINGS,
    {
      preValidation: manager,
      schema: {
        operationId: 'getJobApplicationSettings',
        tags,
        summary: 'Başvuru havuzu ayarı',
        description: `Saklama süresi (ay; varsayılan 12) ve geçerli aday aydınlatma metni sürümü; hiç kaydedilmediyse varsayılan ve sürüm 1 (K-441). ${MANAGER}`,
        response: { 200: jobApplicationSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await jobApplicationSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    SETTINGS,
    {
      preValidation: [...manager, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'setJobApplicationSettings',
        tags,
        summary: 'Başvuru havuzu ayarını kaydet',
        description: `Saklama süresi (1–60 ay, 400) ve aydınlatma sürümü (≤ 40, boş bırakılabilir); gönderilmeyen alan korunur, değişiklik yoksa 422 \`job_application_settings_unchanged\`. Süre değişince süre sonları yeniden hesaplanır. \`If-Match\` zorunlu (hiç kaydedilmediyse 1). Denetim \`finance.job_application.settings\`. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: jobApplicationSettingsSchema,
        response: { 200: jobApplicationSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await setJobApplicationSettingsCommand(
        contextOf(request),
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return jobApplicationSettingsResponse.parse(sendBody(reply, result))
    },
  )
}
