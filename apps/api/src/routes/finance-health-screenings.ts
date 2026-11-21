import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  FINANCE_HEALTH_SCREENING_GUARDIAN_ROLES,
  FINANCE_HEALTH_SCREENING_ROLES,
  healthScreeningResultsInputSchema,
  healthScreeningSessionInputSchema,
  healthScreeningSessionUpdateSchema,
} from '@kampus/school-core/lib/finance-health-screenings.ts'

import type { Role } from '../auth.ts'
import { fieldCipherFromConfig } from '../lib/field-crypto.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  getHealthScreeningFor,
  listGuardianScreeningResultsFor,
} from '../services/finance-health-screening-reads.ts'
import {
  createHealthScreeningCommand,
  getHealthScreeningReportFor,
  listHealthScreeningClassesFor,
  listHealthScreeningsFor,
  listHealthScreeningStaffFor,
  publishHealthScreeningCommand,
  recordHealthScreeningResultsCommand,
  updateHealthScreeningCommand,
  type HealthScreeningDeps,
} from '../services/finance-health-screenings.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { healthAccessReasonOf, requireHealthAccessReason } from './finance-health-access.ts'
import { healthAccessHeadersSchema } from './finance-health-access.schemas.ts'
import {
  guardianScreeningResultListResponse,
  guardianScreeningResultQuery,
  healthScreeningClassListResponse,
  healthScreeningClassQuery,
  healthScreeningDetailResponse,
  healthScreeningListQuery,
  healthScreeningListResponse,
  healthScreeningParams,
  healthScreeningReportResponse,
  healthScreeningResponse,
  healthScreeningResultsResponse,
  healthScreeningStaffListResponse,
  healthScreeningStaffQuery,
} from './finance-health-screenings.schemas.ts'

/**
 * Okul sağlığı taraması uçları (docs/domain/finans.md DOM-FIN-153; ON-163; K-514…K-516; H-110).
 * Modül `finance`. Taramayı yönetici ve ön büro yürütür (sağlık personeli rolü yok); veli kendi
 * çocuğunun yayımlanmış sonucunu ayrı uçtan okur. Ölçüm ve not dönen okumalar denetimdedir. Oturum
 * ve sonuç girişi `Idempotency-Key`; düzeltme ve yayımlama `If-Match` ister.
 */

const STAFF =
  'Rol: `yonetici` ve `onburo`. Öğretmen, veli ve öğrenci 403. Modül `finance`. Başka kurumun taraması 404.'
const SCREENINGS = '/api/v1/finance/health-screenings'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceHealthScreeningRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Anahtar uygulama kurulurken bir kez türetilir (`config.ts` doğrulamıştır).
  const deps: HealthScreeningDeps = { cipher: fieldCipherFromConfig(app.config) }
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const staff = guarded(FINANCE_HEALTH_SCREENING_ROLES)
  const guardians = guarded(FINANCE_HEALTH_SCREENING_GUARDIAN_ROLES)
  const tags = ['finance-health-screenings']

  typed.get(
    SCREENINGS,
    {
      preValidation: staff,
      schema: {
        operationId: 'listHealthScreenings',
        tags,
        summary: 'Sağlık tarama oturumları',
        description: `En yeni tarama günü önce. Süzgeç durum (\`open\`, \`published\`), tür ve tarama günü aralığı. Satırda ölçüm ve not yoktur; sonuç ve "gönderilecek" bildirim sayısı vardır. ${STAFF}`,
        querystring: healthScreeningListQuery,
        response: { 200: healthScreeningListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status, kind, from, to } = request.query
      const { items, total } = await listHealthScreeningsFor(contextOf(request), {
        page,
        pageSize,
        status,
        kind,
        from,
        to,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    SCREENINGS,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createHealthScreening',
        tags,
        summary: 'Tarama oturumu aç',
        description: `Tür (\`growth\` boy-kilo, \`vision\` görme), tarama günü (180 günden eski 422 \`health_screening_date_too_old\`, 90 günden ileri 422 \`health_screening_date_too_far\`), hedef sınıflar (1–40; olmayan 422 \`health_screening_class_not_found\`), yapan (kurumun etkin personeli, 422 \`health_screening_performer_not_found|not_staff|inactive\`; ya da dış sağlık personelinin adı) ve kurumun eşikleri (boy-kiloda BKİ alt/üst, görmede keskinlik alt sınırı; boş eşik yok sayılır). **Persentil hesabı yapılmaz** (H-110). Denetim \`finance.health_screening.create\`. \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: healthScreeningSessionInputSchema,
        response: { 201: healthScreeningResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createHealthScreeningCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = healthScreeningResponse.parse(sendBody(reply, result))
      reply.header('location', `${SCREENINGS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${SCREENINGS}/:sessionId`,
    {
      preValidation: [...staff, requireHealthAccessReason()],
      schema: {
        operationId: 'getHealthScreening',
        tags,
        summary: 'Tarama ayrıntısı ve giriş tablosu',
        description: `Oturum ve hedef sınıfların bugünkü etkin öğrencileri (sınıf değiştirmiş ama sonucu olan öğrenci de) sonucuyla: durum, ölçüm (boy-kiloda BKİ sunucuda hesaplanır), ileri değerlendirme işareti, eşik aşımı, kısa not ve bildirim durumu. **Erişim gerekçesi zorunlu** (\`X-Access-Reason\`; DOM-FIN-156): okuma aynı transaction'da gerekçesiyle \`finance.health_screening.read\` denetimine ve sağlık erişim günlüğüne düşer (alan adları; değer yok). ${STAFF}`,
        headers: healthAccessHeadersSchema(true),
        params: healthScreeningParams,
        response: { 200: healthScreeningDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getHealthScreeningFor(
        contextOf(request),
        deps,
        request.params.sessionId,
        healthAccessReasonOf(request),
      ),
    }),
  )

  typed.patch(
    `${SCREENINGS}/:sessionId`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateHealthScreening',
        tags,
        summary: 'Açık taramayı düzelt',
        description: `Kısmi: gün, sınıflar, yapan, eşikler; tür değişmez. Sonuç girildiyse eşik değişmez (422 \`health_screening_thresholds_locked\`), sonucu olan sınıf çıkarılmaz (422 \`health_screening_class_has_results\`), gün bugünden sonraya alınmaz (422 \`health_screening_date_locked\`). Türe uymayan eşik 422 \`health_screening_thresholds_kind\`; değişiklik yoksa 422 \`health_screening_unchanged\`; yayımlanmış tarama 409 \`health_screening_published\`. Denetime değişen alanların adları. \`If-Match\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: healthScreeningParams,
        body: healthScreeningSessionUpdateSchema,
        response: { 200: healthScreeningResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateHealthScreeningCommand(
        contextOf(request),
        request.params.sessionId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return healthScreeningResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${SCREENINGS}/:sessionId/results`,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'recordHealthScreeningResults',
        tags,
        summary: 'Sonuçları gir (toplu)',
        description: `1–100 satır; **oturumda öğrenci başına tek sonuç**. Yeni sonuç yalnız hedef sınıfta okuyan etkin öğrenciye (422 \`health_screening_student_not_found\`, \`health_screening_student_not_in_classes\`); sonucu olan öğrenci \`expectedVersion\` ile düzeltilir (yoksa 409 \`health_screening_result_exists\`, tutmazsa 409 \`version_conflict\`; olmayan sonuca sürüm 409 \`health_screening_result_missing\`). Taranan öğrencide türün ölçümü zorunlu (422 \`health_screening_measurement_required\`, \`health_screening_measurement_kind\`); katılmayan ve reddedende ölçüm ve öneri yok (422 \`health_screening_measurement_not_allowed\`, \`health_screening_referral_not_screened\`). Boy cm ve kilo kg tek ondalık, görme 0,05–2,00. Kurumun eşiği aşılırsa "ileri değerlendirme önerilir" kendiliğinden konur. Tarama günü gelmeden 422 \`health_screening_not_started\`; yayımlanmış tarama 409 \`health_screening_published\`. Değişmeyen satır yazılmaz. Ölçüm ve not şifreli; yanıtta sağlık değeri yok. Denetim \`finance.health_screening.result_create|result_update\` (alan adları). \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: healthScreeningParams,
        body: healthScreeningResultsInputSchema,
        response: { 200: healthScreeningResultsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await recordHealthScreeningResultsCommand(
        contextOf(request),
        deps,
        request.params.sessionId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return healthScreeningResultsResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${SCREENINGS}/:sessionId/publish`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'publishHealthScreening',
        tags,
        summary: 'Taramayı veliye yayımla',
        description: `Sonuçlar veliye açılır; tarama ve sonuçları sonra değişmez (veritabanında tetikleyici). İleri değerlendirme önerilen her sonuç için **"gönderilecek" bildirim kaydı** yazılır; **veliye ileti gönderilmez** (K-515). Tarama günü gelmeden 422 \`health_screening_not_started\`, sonuç yoksa 422 \`health_screening_no_results\`, yayımlanmışsa 409 \`health_screening_published\`. Gövde boş nesne. Denetim \`finance.health_screening.publish\`. \`If-Match\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: healthScreeningParams,
        body: z.strictObject({}),
        response: { 200: healthScreeningResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await publishHealthScreeningCommand(
        contextOf(request),
        request.params.sessionId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return healthScreeningResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${SCREENINGS}/:sessionId/report`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getHealthScreeningReport',
        tags,
        summary: 'Sınıf bazında katılım ve öneri',
        description: `Hedef sınıf başına bugünkü öğrenci, taranan, katılmayan, reddeden ve sonucu girilmemiş sayısı ile ileri değerlendirme önerilen sayısı. **Küçük gruplar gizli** (K-516): taranan 5'ten azsa ya da önerilen veya önerilmeyen sayısı 1–4 ise öneri \`null\`; tek gizli sınıf toplamdan çıkarılamasın diye toplam da gizlenir. Ölçüm ve not okunmaz. ${STAFF}`,
        params: healthScreeningParams,
        response: { 200: healthScreeningReportResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getHealthScreeningReportFor(contextOf(request), request.params.sessionId),
    }),
  )

  typed.get(
    '/api/v1/finance/health-screening-staff',
    {
      preValidation: staff,
      schema: {
        operationId: 'listHealthScreeningStaff',
        tags,
        summary: 'Tarama için personel',
        description: `Taramayı yapan personel seçimi: kurumun etkin yönetici, öğretmen ve ön büro üyelikleri, ada göre. ${STAFF}`,
        querystring: healthScreeningStaffQuery,
        response: { 200: healthScreeningStaffListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listHealthScreeningStaffFor(contextOf(request), {
        page,
        pageSize,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/health-screening-classes',
    {
      preValidation: staff,
      schema: {
        operationId: 'listHealthScreeningClasses',
        tags,
        summary: 'Tarama için sınıflar',
        description: `Hedef sınıf seçimi: kurumun arşivlenmemiş sınıfları (ada göre) ve bugünkü etkin öğrenci sayısı. ${STAFF}`,
        querystring: healthScreeningClassQuery,
        response: { 200: healthScreeningClassListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listHealthScreeningClassesFor(contextOf(request), {
        page,
        pageSize,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/health-screening-results',
    {
      preValidation: guardians,
      schema: {
        operationId: 'listGuardianHealthScreeningResults',
        tags,
        summary: 'Çocuğumun sağlık tarama sonuçları',
        description: `Velinin kapsamındaki çocukların (velayetli ve kısıtsız bağ) **yayımlanmış** taramalarının sonuçları (K-515): tür, gün, yapan, durum, ölçüm (BKİ dahil), ileri değerlendirme işareti, kısa not ve bildirim durumu. Açık tarama, eşik ve sonucu yazan dönmez. Her dönen sonuç \`finance.health_screening.guardian_read\` denetimine düşer. Rol: yalnız \`veli\`. Modül \`finance\`.`,
        querystring: guardianScreeningResultQuery,
        response: { 200: guardianScreeningResultListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, studentId } = request.query
      const { items, total } = await listGuardianScreeningResultsFor(contextOf(request), deps, {
        page,
        pageSize,
        studentId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )
}
