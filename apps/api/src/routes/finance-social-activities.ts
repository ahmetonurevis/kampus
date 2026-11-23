import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  SOCIAL_ACTIVITY_DECLARE_ROLES,
  SOCIAL_ACTIVITY_FAMILY_ROLES,
  SOCIAL_ACTIVITY_SETTINGS_ROLES,
  SOCIAL_ACTIVITY_STAFF_ROLES,
  socialAcademicYearOf,
  socialActivityCreateSchema,
  socialActivitySettingsSchema,
  socialActivityUpdateSchema,
  socialHourDeclarationSchema,
  socialHourEntrySchema,
  socialHourRejectSchema,
  socialHourReverseSchema,
} from '@kampus/school-core/lib/finance-social-activities.ts'

import type { Role } from '../auth.ts'
import { NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveSocialActivityCommand,
  createSocialActivityCommand,
  createSocialHoursCommand,
  declareSocialHourCommand,
  decideSocialHourCommand,
  getSocialActivityFor,
  getSocialActivitySettingsFor,
  getSocialClassFor,
  getSocialStudentFor,
  listDeclarableActivitiesFor,
  listMySocialHoursFor,
  listSocialActivitiesFor,
  listSocialClassesFor,
  listSocialHoursFor,
  reverseSocialHourCommand,
  saveSocialActivitySettingsCommand,
  socialCertificateFor,
  updateSocialActivityCommand,
} from '../services/finance-social-activities.ts'
import { getInstitutionModules } from '../services/modules.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  declarableActivityListResponse,
  declarableActivityQuery,
  mySocialHoursResponse,
  socialActivityArchivedResponse,
  socialActivityListQuery,
  socialActivityListResponse,
  socialActivityParams,
  socialActivityResponse,
  socialCertificateResponse,
  socialClassListResponse,
  socialClassParams,
  socialClassQuery,
  socialClassResponse,
  socialHourListQuery,
  socialHourListResponse,
  socialHourParams,
  socialHourResponse,
  socialHoursResponse,
  socialSettingsResponse,
  socialStudentParams,
  socialStudentResponse,
  socialYearQuery,
} from './finance-social-activities.schemas.ts'

/**
 * Sosyal etkinlik ve gönüllülük saati uçları (docs/domain/finans.md DOM-FIN-160; ON-170;
 * DOM-AKD-021; K-535…K-537; H-115). Modül `finance`. Yalnız okul (`school`) kurumunda: dil
 * okulunda her uç her rol için 404, rol denetiminden önce (DOM-YTK-012). Sıra: 401 → 403 modül →
 * 404 tür → 403 rol → `If-Match` → 400 → işlem. Etkinlik ve saat yönetici ve öğretmende (öğretmen
 * yalnız sorumlu olduğu etkinlik; başkası 404); öğrenci beyan eder, veli ve öğrenci kendi
 * (çocuğunun) saatlerini okur. Oluşturma, giriş ve beyan `Idempotency-Key`; düzenleme, arşiv,
 * onay, ret ve ters kayıt `If-Match` ister.
 */

const SCHOOL_ONLY =
  'Yalnız okul (`school`) kurumunda; dil okulunda her rol için 404, rol denetiminden önce. Modül `finance`.'
const STAFF = `Rol: \`yonetici\` bütün etkinlikler, \`ogretmen\` yalnız sorumlu olduğu etkinlik (başkası 404); ön büro, veli ve öğrenci 403. ${SCHOOL_ONLY}`
const SUMMARY = `Rol: \`yonetici\` bütün sınıflar, \`ogretmen\` sınıf öğretmeni olduğu ve derse girdiği sınıflar (başkası 404); diğer roller 403. ${SCHOOL_ONLY}`
const BASE = '/api/v1/finance/social-activities'
const ACTIVITY = `${BASE}/:activityId`
const HOURS = `${BASE}/hours`
const HOUR = `${HOURS}/:entryId`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function versionOf(request: FastifyRequest) {
  const opts = options(request, 'optional')
  if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
  return { expectedVersion: opts.expectedVersion, idempotency: opts.idempotency }
}

const yearOf = (request: FastifyRequest, academicYear: number | undefined) =>
  academicYear ?? socialAcademicYearOf(dayKey(contextOf(request).now))

export function registerFinanceSocialActivityRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const schoolOnly: preValidationAsyncHookHandler = async (request) => {
    const ctx = contextOf(request)
    const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
    if (institution?.type !== 'school') throw new NotFoundError()
  }
  const guarded = (roles: readonly Role[]) => [
    app.authenticate,
    app.requireModule('finance'),
    schoolOnly,
    app.requireRole(roles),
  ]
  const staff = guarded(SOCIAL_ACTIVITY_STAFF_ROLES)
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const tags = ['finance-social-activities']

  // --- Öğrenci ve veli ---------------------------------------------------------------------------

  typed.get(
    `${BASE}/my`,
    {
      preValidation: guarded(SOCIAL_ACTIVITY_FAMILY_ROLES),
      schema: {
        operationId: 'listMySocialHours',
        tags,
        summary: 'Kendi (çocuğumun) sosyal etkinlik saatleri',
        description: `Öğrencinin kendi ya da velinin bağlı lise (9–12) çocuklarının yıl ve toplam onaylı saati, hedefe göre durumu ve bütün kayıtları (bekleyen, reddedilen gerekçesiyle, ters kayıt) (K-536, K-537). Kapsam sunucuda core kuralıyla daralır; lise dışı çocuk dönmez. Rol: \`ogrenci\`, \`veli\`; diğer roller 403. ${SCHOOL_ONLY}`,
        querystring: socialYearQuery,
        response: { 200: mySocialHoursResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await listMySocialHoursFor(
        contextOf(request),
        yearOf(request, request.query.academicYear),
      ),
    }),
  )

  typed.get(
    `${BASE}/my/activities`,
    {
      preValidation: guarded(SOCIAL_ACTIVITY_DECLARE_ROLES),
      schema: {
        operationId: 'listDeclarableSocialActivities',
        tags,
        summary: 'Beyan edilebilecek etkinlikler',
        description: `Başlamış ve arşivlenmemiş etkinlikler; öğrenci saat beyanında seçer. Rol: \`ogrenci\`; diğer roller 403. ${SCHOOL_ONLY}`,
        querystring: declarableActivityQuery,
        response: { 200: declarableActivityListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listDeclarableActivitiesFor(contextOf(request), {
        page,
        pageSize,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${BASE}/my/hours`,
    {
      preValidation: [...guarded(SOCIAL_ACTIVITY_DECLARE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'declareSocialHour',
        tags,
        summary: 'Sosyal etkinlik saati beyan et',
        description: `Öğrenci kendi saatini beyan eder; kayıt onay bekler (K-536). Gün bugünü geçmez (422 \`social_activity_date_future\`) ve etkinlik aralığındadır (422 \`social_activity_date_outside\`); saat 0,5–10, yarım saat adımlı. Lise dışı öğrenci 422 \`social_activity_student_not_high_school\`; aynı etkinlik ve günün etkin kaydı 409 \`social_activity_entry_exists\`. Arşivli ya da başka kurumun etkinliği 404. \`Idempotency-Key\` zorunlu. Rol: \`ogrenci\`; diğer roller 403. ${SCHOOL_ONLY}`,
        headers: createHeaders,
        body: socialHourDeclarationSchema,
        response: { 201: socialHourResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await declareSocialHourCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return socialHourResponse.parse(sendBody(reply, result))
    },
  )

  // --- Hedef ---------------------------------------------------------------------------------------

  typed.get(
    `${BASE}/settings`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getSocialActivitySettings',
        tags,
        summary: 'Sosyal etkinlik hedefleri',
        description: `Kurumun toplam ve yıllık hedefi; ayar yoksa mevzuat önerisi (40 ve 10 saat; \`isDefault\`) (K-537). Rol: \`yonetici\`, \`ogretmen\`; diğer roller 403. ${SCHOOL_ONLY}`,
        response: { 200: socialSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getSocialActivitySettingsFor(contextOf(request)) }),
  )

  typed.patch(
    `${BASE}/settings`,
    {
      preValidation: [...guarded(SOCIAL_ACTIVITY_SETTINGS_ROLES), captureInput()],
      schema: {
        operationId: 'updateSocialActivitySettings',
        tags,
        summary: 'Sosyal etkinlik hedeflerini değiştir',
        description: `Toplam hedef (1–200 tam saat) ve yıllık hedef (1–200 ya da \`null\`) (K-537). Ayar yokken \`If-Match\` gönderilmez; ayar varsa okunan sürümle zorunludur (yoksa ya da tutmazsa 409 \`version_conflict\`). Rol: yalnız \`yonetici\`. ${SCHOOL_ONLY}`,
        headers: commandHeadersSchema('optional'),
        body: socialActivitySettingsSchema,
        response: { 200: socialSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await saveSocialActivitySettingsCommand(
        contextOf(request),
        request.commandInput,
        opts.expectedVersion,
        opts.idempotency,
      )
      return socialSettingsResponse.parse(sendBody(reply, result))
    },
  )

  // --- Saat kuyruğu ------------------------------------------------------------------------------

  typed.get(
    HOURS,
    {
      preValidation: staff,
      schema: {
        operationId: 'listSocialHours',
        tags,
        summary: 'Sosyal etkinlik saat kayıtları',
        description: `Saat kayıtları, yeni gün önce; \`status=pending\` onay kuyruğudur. \`activityId\` ve \`studentId\` süzer; öğretmen yalnız sorumlu olduğu etkinliklerin kayıtlarını görür (başka etkinlik süzgeci 404). ${STAFF}`,
        querystring: socialHourListQuery,
        response: { 200: socialHourListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status, activityId, studentId } = request.query
      const { items, total } = await listSocialHoursFor(contextOf(request), {
        page,
        pageSize,
        status,
        activityId,
        studentId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  const decision = (verb: 'approve' | 'reject') =>
    typed.post(
      `${HOUR}/${verb}`,
      {
        preValidation: [...staff, requireIfMatch(), captureInput()],
        schema: {
          operationId: verb === 'approve' ? 'approveSocialHour' : 'rejectSocialHour',
          tags,
          summary: verb === 'approve' ? 'Beyanı onayla' : 'Beyanı reddet',
          description:
            verb === 'approve'
              ? `Bekleyen öğrenci beyanı onaylanır; sonra değişmez (K-536). Karar verilmiş kayıt 409 \`social_activity_entry_decided\`. \`If-Match\` kaydın sürümü. ${STAFF}`
              : `Bekleyen öğrenci beyanı gerekçeyle (5–500) reddedilir; öğrenci ve veli gerekçeyi görür, aynı gün yeniden beyan edilebilir (K-536). Karar verilmiş kayıt 409 \`social_activity_entry_decided\`. \`If-Match\` kaydın sürümü. ${STAFF}`,
          headers: versionHeaders,
          params: socialHourParams,
          ...(verb === 'reject' ? { body: socialHourRejectSchema } : {}),
          response: { 200: socialHourResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const { expectedVersion, idempotency } = versionOf(request)
        const result = await decideSocialHourCommand(
          contextOf(request),
          request.params.entryId,
          verb === 'approve' ? 'approved' : 'rejected',
          request.commandInput,
          expectedVersion,
          idempotency,
        )
        return socialHourResponse.parse(sendBody(reply, result))
      },
    )
  decision('approve')
  decision('reject')

  typed.post(
    `${HOUR}/reverse`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'reverseSocialHour',
        tags,
        summary: 'Onaylı saati ters kayıtla düzelt',
        description: `Onaylı saat değişmez: gerekçeli (5–500) ters kayıt eksi dakikayla yazılır, kayıt toplamdan ve belgeden düşer; aynı gün doğru saat yeniden girilebilir (K-536). Onaylı olmayan kayıt 409 \`social_activity_entry_not_reversible\`, düzeltilmiş kayıt 409 \`social_activity_entry_reversed\`. \`If-Match\` düzeltilen kaydın sürümü. ${STAFF}`,
        headers: versionHeaders,
        params: socialHourParams,
        body: socialHourReverseSchema,
        response: { 201: socialHourResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await reverseSocialHourCommand(
        contextOf(request),
        request.params.entryId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return socialHourResponse.parse(sendBody(reply, result))
    },
  )

  // --- Özet ve belge -----------------------------------------------------------------------------

  typed.get(
    `${BASE}/classes`,
    {
      preValidation: staff,
      schema: {
        operationId: 'listSocialActivityClasses',
        tags,
        summary: 'Sınıflara göre sosyal etkinlik durumu',
        description: `Lise (9–12) sınıfları: etkin öğrenci sayısı ve hedefe göre tamamlayan, yıllık hedefte ve eksik sayıları (K-537). ${SUMMARY}`,
        querystring: socialYearQuery,
        response: { 200: socialClassListResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await listSocialClassesFor(
        contextOf(request),
        yearOf(request, request.query.academicYear),
      ),
    }),
  )

  typed.get(
    `${BASE}/classes/:classId`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getSocialActivityClass',
        tags,
        summary: 'Sınıfın sosyal etkinlik özeti',
        description: `Sınıfın etkin öğrencileri: yıl ve toplam onaylı net dakika, eksik dakika, durum ve bekleyen beyan; \`status=behind\` eksik kalanlar (K-537). Lise dışı, görülemeyen ya da başka kurumun sınıfı 404. ${SUMMARY}`,
        params: socialClassParams,
        querystring: socialClassQuery,
        response: { 200: socialClassResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getSocialClassFor(contextOf(request), request.params.classId, {
        academicYear: yearOf(request, request.query.academicYear),
        status: request.query.status,
      }),
    }),
  )

  typed.get(
    `${BASE}/students/:studentId`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getSocialActivityStudent',
        tags,
        summary: 'Öğrencinin sosyal etkinlik saatleri',
        description: `Lise öğrencisinin hedefe göre durumu ve bütün kayıtları (K-537). Lise dışı, kapsam dışı ya da başka kurumun öğrencisi 404. ${SUMMARY}`,
        params: socialStudentParams,
        querystring: socialYearQuery,
        response: { 200: socialStudentResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getSocialStudentFor(
        contextOf(request),
        request.params.studentId,
        yearOf(request, request.query.academicYear),
      ),
    }),
  )

  typed.get(
    `${BASE}/students/:studentId/certificate`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getSocialActivityCertificate',
        tags,
        summary: 'Sosyal etkinlik ve gönüllülük belgesi verisi',
        description: `Belge PDF'inin verisi: yalnız onaylı ve ters kayıtla düzeltilmemiş saatler, gün sırasıyla; öğretim yılı toplamları ve toplam hedef (K-537). Her okuma denetime yazılır (\`finance.social_activity.certificate\`). Lise dışı, kapsam dışı ya da başka kurumun öğrencisi 404. ${SUMMARY}`,
        params: socialStudentParams,
        response: { 200: socialCertificateResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await socialCertificateFor(contextOf(request), request.params.studentId),
    }),
  )

  // --- Etkinlik ----------------------------------------------------------------------------------

  typed.get(
    BASE,
    {
      preValidation: staff,
      schema: {
        operationId: 'listSocialActivities',
        tags,
        summary: 'Sosyal etkinlikler',
        description: `Arşivlenmemiş etkinlikler, yeni başlangıç önce; onaylı net dakika ve bekleyen beyan sayısıyla. \`q\` ad ve kuruluşta arar, \`kind\` süzer. ${STAFF}`,
        querystring: socialActivityListQuery,
        response: { 200: socialActivityListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, kind } = request.query
      const { items, total } = await listSocialActivitiesFor(contextOf(request), {
        page,
        pageSize,
        q,
        kind,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    BASE,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createSocialActivity',
        tags,
        summary: 'Sosyal etkinlik aç',
        description: `Ad, tür (kulüp/topluluk ya da gönüllülük), başlangıç ve isteğe bağlı bitiş günü, yer, sorumlu (kurumun etkin öğretmeni ya da yöneticisi; 422 \`social_activity_teacher_not_found\`, \`social_activity_teacher_not_teacher\`, \`social_activity_teacher_inactive\`), kurum içi/dışı ve kuruluş adı (dışarıda zorunlu), kulüp çalışmasında isteğe bağlı kulüp (422 \`social_activity_club_not_found\`) (K-535). Öğretmen yalnız kendini sorumlu yazar (422 \`social_activity_teacher_not_self\`). \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: createHeaders,
        body: socialActivityCreateSchema,
        response: { 201: socialActivityResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createSocialActivityCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = socialActivityResponse.parse(sendBody(reply, result))
      reply.header('location', `${BASE}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    ACTIVITY,
    {
      preValidation: staff,
      schema: {
        operationId: 'getSocialActivity',
        tags,
        summary: 'Sosyal etkinlik ayrıntısı',
        description: `Etkinlik ve toplamları; kayıtlar \`GET …/hours?activityId=\` ile. Başka kurumun ya da arşivli etkinlik 404. ${STAFF}`,
        params: socialActivityParams,
        response: { 200: socialActivityResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getSocialActivityFor(contextOf(request), request.params.activityId),
    }),
  )

  typed.patch(
    ACTIVITY,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateSocialActivity',
        tags,
        summary: 'Sosyal etkinliği düzenle',
        description: `Gönderilen alanlar değişir. Kayıtlı günler yeni aralığın dışında kalamaz (422 \`social_activity_entries_outside_range\`); sorumluyu yalnız yönetici değiştirir; değişiklik yoksa 422 \`social_activity_unchanged\` (K-535). \`If-Match\` zorunlu. ${STAFF}`,
        headers: versionHeaders,
        params: socialActivityParams,
        body: socialActivityUpdateSchema,
        response: { 200: socialActivityResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateSocialActivityCommand(
        contextOf(request),
        request.params.activityId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return socialActivityResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    ACTIVITY,
    {
      preValidation: [...staff, requireIfMatch()],
      schema: {
        operationId: 'archiveSocialActivity',
        tags,
        summary: 'Sosyal etkinliği arşivle',
        description: `Onay bekleyen beyanı olan etkinlik arşivlenmez (422 \`social_activity_has_pending\`); onaylı saatler belgede kalır (K-535). \`If-Match\` zorunlu. ${STAFF}`,
        headers: versionHeaders,
        params: socialActivityParams,
        response: { 200: socialActivityArchivedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await archiveSocialActivityCommand(
        contextOf(request),
        request.params.activityId,
        expectedVersion,
        idempotency,
      )
      return socialActivityArchivedResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ACTIVITY}/hours`,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createSocialHours',
        tags,
        summary: 'Sosyal etkinlik saati gir',
        description: `Sorumlu öğretmen ya da yönetici seçilen öğrencilere (1–100) aynı gün ve saati onaylı yazar (K-536). Gün bugünü geçmez (422 \`social_activity_date_future\`) ve etkinlik aralığındadır (422 \`social_activity_date_outside\`); öğrenci kurumda yok 422 \`social_activity_student_not_found\`, etkin değil \`social_activity_student_inactive\`, lise dışı \`social_activity_student_not_high_school\`; aynı öğrenci, etkinlik ve günün etkin kaydı 409 \`social_activity_entry_exists\`. Bir satır reddedilirse hiçbiri yazılmaz. \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: createHeaders,
        params: socialActivityParams,
        body: socialHourEntrySchema,
        response: { 201: socialHoursResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createSocialHoursCommand(
        contextOf(request),
        request.params.activityId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return socialHoursResponse.parse(sendBody(reply, result))
    },
  )
}
