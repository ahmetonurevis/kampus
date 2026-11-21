import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  FINANCE_INCIDENT_GUARDIAN_ROLES,
  FINANCE_INCIDENT_MANAGE_ROLES,
  FINANCE_INCIDENT_WRITE_ROLES,
  incidentAddendumSchema,
  incidentNotificationSchema,
  incidentReportInputSchema,
  incidentReportUpdateSchema,
} from '@kampus/school-core/lib/finance-incidents.ts'

import type { Role } from '../auth.ts'
import { fieldCipherFromConfig } from '../lib/field-crypto.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  addIncidentAddendumCommand,
  createIncidentCommand,
  finalizeIncidentCommand,
  getIncidentFor,
  listGuardianIncidentsFor,
  listIncidentsFor,
  listIncidentStaffFor,
  recordIncidentNotificationCommand,
  updateIncidentCommand,
  type IncidentDeps,
} from '../services/finance-incidents.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  guardianIncidentListResponse,
  guardianIncidentQuery,
  incidentListQuery,
  incidentListResponse,
  incidentParams,
  incidentResponse,
  incidentStaffListResponse,
  incidentStaffQuery,
} from './finance-incidents.schemas.ts'

/**
 * Kaza ve yaralanma tutanağı uçları (docs/domain/finans.md DOM-FIN-146; ON-162; K-493…K-495).
 * Modül `finance`. Tutanağı yönetici, öğretmen ve ön büro açar; yönetici bütün tutanakları, diğerleri
 * yalnız açtıklarını görür (başkasınınki 404). Sağlık grubu açana yalnız taslakta döner; ek not
 * yalnız yöneticide. Veli kendi çocuğunun kesinleşmiş tutanak özetini ayrı uçtan okur. Ayrıntı ve
 * özet okumaları denetimdedir. Açma, bildirim ve ek not `Idempotency-Key`; düzeltme ve
 * kesinleştirme `If-Match` ister.
 */

const STAFF =
  'Rol: `yonetici` (bütün tutanaklar), `ogretmen` ve `onburo` (yalnız açtıkları; başkasınınki 404). Veli ve öğrenci 403. Modül `finance`.'
const MANAGER = 'Rol: yalnız `yonetici` (öğretmen ve ön büro 404/403). Modül `finance`.'
const INCIDENTS = '/api/v1/finance/incidents'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceIncidentRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Anahtar uygulama kurulurken bir kez türetilir (`config.ts` doğrulamıştır).
  const deps: IncidentDeps = { cipher: fieldCipherFromConfig(app.config) }
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const staff = guarded(FINANCE_INCIDENT_WRITE_ROLES)
  const managers = guarded(FINANCE_INCIDENT_MANAGE_ROLES)
  const guardians = guarded(FINANCE_INCIDENT_GUARDIAN_ROLES)
  const tags = ['finance-incidents']

  typed.get(
    INCIDENTS,
    {
      preValidation: staff,
      schema: {
        operationId: 'listIncidentReports',
        tags,
        summary: 'Kaza ve yaralanma tutanakları',
        description: `En yeni olay önce. Süzgeç durum (\`draft\`, \`finalized\`), yaralanan türü, öğrenci ve olay günü aralığı (Europe/Istanbul). Satırda açıklama ve sağlık grubu yoktur; bildirim sayısı vardır. ${STAFF}`,
        querystring: incidentListQuery,
        response: { 200: incidentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status, injuredKind, studentId, from, to } = request.query
      const { items, total } = await listIncidentsFor(contextOf(request), {
        page,
        pageSize,
        status,
        injuredKind,
        studentId,
        from,
        to,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    INCIDENTS,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createIncidentReport',
        tags,
        summary: 'Kaza tutanağı aç (taslak)',
        description: `Yaralanan (öğrenci kaydı ya da personel üyeliği), olay anı (gelecekte 422 \`incident_occurred_in_future\`, 30 günden eski 422 \`incident_occurred_too_old\`), yer (2–200), tür, açıklama (10–4000), yaralanma bölgeleri (1–6), şiddet, isteğe bağlı yaralanma notu, ilk müdahale (yapan personel ya da boş, ne yapıldı), sevk, tanıklar (0–20) ve sorumlu. Öğrenci yok 422 \`incident_student_not_found\`; yaralanan personel yok ya da personel değil 422 \`incident_injured_not_found\`, \`incident_injured_not_staff\`; sorumlu, tanık ve müdahaleyi yapan kurumun etkin personeli olmalı (422 \`incident_<responsible|witness|first_aid_by>_not_found|not_staff|inactive\`); yaralanan tanık olamaz 422 \`incident_witness_is_injured\`. Açıklama ve sağlık grubu şifreli saklanır; sağlık profili kopyalanmaz. Denetim \`finance.incident.create\` (alan adları). \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: incidentReportInputSchema,
        response: { 201: incidentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createIncidentCommand(
        contextOf(request),
        deps,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = incidentResponse.parse(sendBody(reply, result))
      reply.header('location', `${INCIDENTS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${INCIDENTS}/:incidentId`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getIncidentReport',
        tags,
        summary: 'Kaza tutanağı ayrıntısı',
        description: `Açıklama, tanıklar, veli bildirimleri; sağlık grubu (\`health\`) yöneticiye her zaman, açana yalnız taslakta; ek notlar (\`addenda\`) yalnız yöneticiye (K-494). Okuma aynı transaction'da \`finance.incident.read\` denetimine düşer (dönen alanların adları; değer yok). Olmayan, başka kurumun ya da başkasının açtığı tutanak 404. ${STAFF}`,
        params: incidentParams,
        response: { 200: incidentResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getIncidentFor(contextOf(request), deps, request.params.incidentId),
    }),
  )

  typed.patch(
    `${INCIDENTS}/:incidentId`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateIncidentReport',
        tags,
        summary: 'Taslak tutanağı düzelt',
        description: `Kısmi: verilmeyen alan değişmez; tanıklar bütün olarak yazılır; yaralanan değişmez. Birleşik değer açılış kurallarından geçer; olay anı değiştiyse kayıtlı ilk bildirimden sonra olamaz (422 \`incident_occurred_after_notification\`). Değişiklik yoksa 422 \`incident_report_unchanged\`. Kesinleşmiş tutanak 409 \`incident_report_finalized\` (düzeltme ek nottur). Denetime değişen alanların adları. \`If-Match\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: incidentParams,
        body: incidentReportUpdateSchema,
        response: { 200: incidentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateIncidentCommand(
        contextOf(request),
        deps,
        request.params.incidentId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return incidentResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${INCIDENTS}/:incidentId/finalize`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'finalizeIncidentReport',
        tags,
        summary: 'Tutanağı kesinleştir',
        description: `Taslak kesinleşir; sonra tutanak ve tanıklar değişmez (409 \`incident_report_finalized\`; veritabanında tetikleyici). Ağır yaralanan öğrencinin tutanağı veli bildirimi kaydı olmadan kesinleşmez (422 \`incident_notification_required\`, K-493). Gövde boş nesne. Denetim \`finance.incident.finalize\`. \`If-Match\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: incidentParams,
        body: z.strictObject({}),
        response: { 200: incidentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await finalizeIncidentCommand(
        contextOf(request),
        deps,
        request.params.incidentId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return incidentResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${INCIDENTS}/:incidentId/notifications`,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'recordIncidentNotification',
        tags,
        summary: 'Veli bildirimini kaydet',
        description: `Veliye ne zaman (boşsa şimdi; olaydan önce 422 \`incident_notification_before_incident\`, gelecekte 422 \`incident_notification_in_future\`), hangi kanaldan (telefon, yüz yüze, mesaj) ve kimin bildirdiği (boşsa kaydeden; kurumun etkin personeli, 422 \`incident_notified_by_not_found|not_staff|inactive\`). **Yalnız kayıttır; veliye ileti gönderilmez.** Yalnız öğrencinin tutanağında (422 \`incident_notification_not_student\`); taslakta da kesinleşmişte de yazılır, en çok 10 (422 \`incident_notification_limit\`). Kayıt değişmez. Denetim \`finance.incident.notify\`. \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: incidentParams,
        body: incidentNotificationSchema,
        response: { 201: incidentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await recordIncidentNotificationCommand(
        contextOf(request),
        deps,
        request.params.incidentId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return incidentResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${INCIDENTS}/:incidentId/addenda`,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'addIncidentAddendum',
        tags,
        summary: 'Kesinleşmiş tutanağa ek not',
        description: `Düzeltme ya da ek bilgi (5–2000; şifreli); tutanağın eski hâli korunur, not değişmez. Taslakta 422 \`incident_addendum_draft\` (taslak doğrudan düzeltilir), en çok 50 (422 \`incident_addendum_limit\`). Denetim \`finance.incident.addendum\` (not yazılmaz). \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: incidentParams,
        body: incidentAddendumSchema,
        response: { 201: incidentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await addIncidentAddendumCommand(
        contextOf(request),
        deps,
        request.params.incidentId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return incidentResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/incident-staff',
    {
      preValidation: staff,
      schema: {
        operationId: 'listIncidentStaff',
        tags,
        summary: 'Tutanak için personel',
        description: `Sorumlu, tanık, ilk müdahale ve bildiren seçimi: kurumun etkin yönetici, öğretmen ve ön büro üyelikleri, ada göre. ${STAFF}`,
        querystring: incidentStaffQuery,
        response: { 200: incidentStaffListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listIncidentStaffFor(contextOf(request), {
        page,
        pageSize,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/incident-summaries',
    {
      preValidation: guardians,
      schema: {
        operationId: 'listGuardianIncidentSummaries',
        tags,
        summary: 'Çocuğumun kaza tutanakları (özet)',
        description: `Velinin kapsamındaki çocukların (velayetli ve kısıtsız bağ) **kesinleşmiş** tutanaklarının özeti (K-495): olay anı, yer, tür, yaralanma bölgesi, şiddet, yapılan ilk müdahale, sevk ve bildirimler (an, kanal). Açıklama, tanıklar, sorumlu, yaralanma notu ve ek notlar dönmez; taslak ve personel tutanağı görünmez. Her dönen tutanak \`finance.incident.guardian_read\` denetimine düşer. Rol: yalnız \`veli\`. Modül \`finance\`.`,
        querystring: guardianIncidentQuery,
        response: { 200: guardianIncidentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, studentId } = request.query
      const { items, total } = await listGuardianIncidentsFor(contextOf(request), deps, {
        page,
        pageSize,
        studentId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )
}
