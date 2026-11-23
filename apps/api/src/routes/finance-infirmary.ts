import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  FINANCE_INFIRMARY_CONSENT_READ_ROLES,
  FINANCE_INFIRMARY_GUARDIAN_ROLES,
  FINANCE_INFIRMARY_ROLES,
  FINANCE_INFIRMARY_STATUS_ROLES,
  infirmaryDischargeSchema,
  infirmaryVisitInputSchema,
  infirmaryVisitUpdateSchema,
  medicationAdministrationSchema,
  medicationConsentInputSchema,
  medicationConsentRejectSchema,
} from '@kampus/school-core/lib/finance-infirmary.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Role } from '../auth.ts'
import { fieldCipherFromConfig } from '../lib/field-crypto.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  createConsentCommand,
  createVisitCommand,
  dischargeVisitCommand,
  getConsentFor,
  getMedicationScheduleFor,
  getVisitFor,
  listConsentsFor,
  listGuardianVisitsFor,
  listInfirmaryStaffFor,
  listVisitsFor,
  listVisitStatesFor,
  recordAdministrationCommand,
  transitionConsentCommand,
  updateVisitCommand,
  type InfirmaryDeps,
} from '../services/finance-infirmary.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { healthAccessReasonOf, requireHealthAccessReason } from './finance-health-access.ts'
import { healthAccessHeadersSchema } from './finance-health-access.schemas.ts'
import {
  consentListQuery,
  consentListResponse,
  consentParams,
  consentResponse,
  dayQuery,
  guardianVisitListResponse,
  guardianVisitQuery,
  infirmaryStaffListResponse,
  infirmaryStaffQuery,
  scheduleResponse,
  visitListQuery,
  visitListResponse,
  visitParams,
  visitResponse,
  visitStateListResponse,
} from './finance-infirmary.schemas.ts'

/**
 * Revir ve ilaç onayı uçları (docs/domain/finans.md DOM-FIN-151; ON-101; IST-102; K-508…K-510).
 * Modül `finance`. Revir görevlisi rolü olmadığından revir işini yönetici ve ön büro yürütür. Sınıf
 * öğretmeni yalnız sınıfının "revirde / döndü" durumunu görür. Veli kendi çocuğu için ilaç talebi
 * açar, geri çeker ve çocuğunun ziyaret özetini, taleplerini ve uygulamalarını okur. Sağlık ayrıntısı
 * dönen her okuma denetimdedir; okulun okuması gerekçe ister (DOM-FIN-156). Ziyaret, talep ve uygulama açma `Idempotency-Key`; düzeltme, kapatma,
 * onay, ret ve geri çekme `If-Match` ister. Veliye ya da öğretmene bildirim gönderilmez.
 */

const SCHOOL =
  'Rol: `yonetici` ve `onburo` (revir görevlisi rolü yok). Öğretmen, veli ve öğrenci 403. Modül `finance`.'
const GUARDIAN = 'Rol: yalnız `veli` (kapsamındaki çocuklar; başkası 404). Modül `finance`.'
const READERS =
  'Rol: `yonetici` ve `onburo` (bütün talepler), `veli` (kapsamındaki çocuklar; başkası 404). Öğretmen ve öğrenci 403. Modül `finance`.'
const BASE = '/api/v1/finance/infirmary'
const VISITS = `${BASE}/visits`
const CONSENTS = `${BASE}/medication-consents`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceInfirmaryRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Anahtar uygulama kurulurken bir kez türetilir (`config.ts` doğrulamıştır).
  const deps: InfirmaryDeps = { cipher: fieldCipherFromConfig(app.config) }
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const school = guarded(FINANCE_INFIRMARY_ROLES)
  const status = guarded(FINANCE_INFIRMARY_STATUS_ROLES)
  const guardians = guarded(FINANCE_INFIRMARY_GUARDIAN_ROLES)
  const readers = guarded(FINANCE_INFIRMARY_CONSENT_READ_ROLES)
  const tags = ['finance-infirmary']

  typed.get(
    VISITS,
    {
      preValidation: school,
      schema: {
        operationId: 'listInfirmaryVisits',
        tags,
        summary: 'Revir ziyaretleri',
        description: `En yeni geliş önce. Süzgeç durum (\`open\` revirde, \`closed\` ayrıldı), öğrenci ve geliş günü aralığı (Europe/Istanbul). Satırda şikâyet, yapılanlar ve not yoktur; okuma denetlenmez. ${SCHOOL}`,
        querystring: visitListQuery,
        response: { 200: visitListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status: state, studentId, from, to } = request.query
      const { items, total } = await listVisitsFor(contextOf(request), {
        page,
        pageSize,
        status: state,
        studentId,
        from,
        to,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    VISITS,
    {
      preValidation: [...school, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createInfirmaryVisit',
        tags,
        summary: 'Revir ziyareti aç',
        description: `Öğrenci (yok 422 \`infirmary_student_not_found\`), geliş anı (boşsa şimdi; gelecekte 422 \`infirmary_arrived_in_future\`, 7 günden eski 422 \`infirmary_arrived_too_old\`), isteğe bağlı gönderen (kurumun etkin personeli; 422 \`infirmary_referred_by_not_found|not_staff|inactive\`), şikâyet (2–500), yapılanlar, not ve kaza tutanağı (aynı öğrencinin; 422 \`infirmary_incident_not_found\`, \`infirmary_incident_other_student\`). Öğrencinin açık ziyareti varsa 409 \`infirmary_visit_already_open\`. Şikâyet, yapılanlar ve not şifreli saklanır; sağlık profili kopyalanmaz. Denetim \`finance.infirmary.visit_create\` (alan adları). \`Idempotency-Key\` zorunlu. ${SCHOOL}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: infirmaryVisitInputSchema,
        response: { 201: visitResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createVisitCommand(
        contextOf(request),
        deps,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = visitResponse.parse(sendBody(reply, result))
      reply.header('location', `${VISITS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${VISITS}/:visitId`,
    {
      preValidation: [...school, requireHealthAccessReason()],
      schema: {
        operationId: 'getInfirmaryVisit',
        tags,
        summary: 'Revir ziyareti ayrıntısı',
        description: `Şikâyet, yapılanlar ve not dahil. Okuma aynı transaction'da \`finance.infirmary.visit_read\` denetimine düşer (alan adları; değer yok). Erişim gerekçesi zorunlu (\`X-Access-Reason\`; DOM-FIN-156, K-523): yoksa 400 \`health_access_reason_required\`; okuma gerekçesiyle sağlık erişim günlüğüne düşer. Olmayan ya da başka kurumun ziyareti 404. ${SCHOOL}`,
        headers: healthAccessHeadersSchema(true),
        params: visitParams,
        response: { 200: visitResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getVisitFor(
        contextOf(request),
        deps,
        request.params.visitId,
        healthAccessReasonOf(request),
      ),
    }),
  )

  typed.patch(
    `${VISITS}/:visitId`,
    {
      preValidation: [...school, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateInfirmaryVisit',
        tags,
        summary: 'Açık revir ziyaretini düzelt',
        description: `Kısmi: verilmeyen alan değişmez, öğrenci değişmez. Değişiklik yoksa 422 \`infirmary_visit_unchanged\`; kapanmış ziyaret 409 \`infirmary_visit_closed\` (veritabanında tetikleyici). Denetime değişen alanların adları. \`If-Match\` zorunlu. ${SCHOOL}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: visitParams,
        body: infirmaryVisitUpdateSchema,
        response: { 200: visitResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateVisitCommand(
        contextOf(request),
        deps,
        request.params.visitId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return visitResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${VISITS}/:visitId/discharge`,
    {
      preValidation: [...school, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'dischargeInfirmaryVisit',
        tags,
        summary: 'Revir ziyaretini kapat',
        description: `Dönüş anı (boşsa şimdi; gelişten önce 422 \`infirmary_returned_before_arrival\`, gelecekte 422 \`infirmary_returned_in_future\`) ve sonuç; isteğe bağlı yapılanlar ve not. En az bir yapılan kayıtlı olmalı (422 \`infirmary_actions_required\`). Kapanan ziyaret değişmez (409 \`infirmary_visit_closed\`). Veliye bildirim gönderilmez. Denetim \`finance.infirmary.visit_discharge\`. \`If-Match\` zorunlu. ${SCHOOL}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: visitParams,
        body: infirmaryDischargeSchema,
        response: { 200: visitResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await dischargeVisitCommand(
        contextOf(request),
        deps,
        request.params.visitId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return visitResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${BASE}/visit-states`,
    {
      preValidation: status,
      schema: {
        operationId: 'listInfirmaryVisitStates',
        tags,
        summary: 'Revir durumu (revirde / döndü)',
        description:
          'Günün (Europe/Istanbul; boşsa bugün) ziyaretlerinden öğrenci, geliş ve ayrılış anı ile `in_infirmary` revirde ya da `returned` döndü. Şikâyet, yapılanlar ve sonuç (eve gitti, sevk) dönmez; okuma denetlenmez (K-510). Öğretmen yalnız sınıf öğretmeni olduğu sınıfların öğrencilerini görür. Rol: `yonetici`, `onburo`, `ogretmen`. Veli ve öğrenci 403. Modül `finance`.',
        querystring: dayQuery,
        response: { 200: visitStateListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      return { data: await listVisitStatesFor(ctx, request.query.date ?? dayKey(ctx.now)) }
    },
  )

  typed.get(
    `${BASE}/my-visits`,
    {
      preValidation: guardians,
      schema: {
        operationId: 'listGuardianInfirmaryVisits',
        tags,
        summary: 'Çocuğumun revir ziyaretleri (özet)',
        description: `Kapsamdaki (velayetli ve kısıtsız bağ) çocukların ziyaretleri: geliş ve ayrılış anı, durum, sonuç, şikâyet ve yapılanlar. Revir notu, gönderen ve kaza tutanağı bağı dönmez. Her dönen ziyaret \`finance.infirmary.guardian_read\` denetimine düşer. ${GUARDIAN}`,
        querystring: guardianVisitQuery,
        response: { 200: guardianVisitListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, studentId } = request.query
      const { items, total } = await listGuardianVisitsFor(contextOf(request), deps, {
        page,
        pageSize,
        studentId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    CONSENTS,
    {
      preValidation: [...readers, requireHealthAccessReason()],
      schema: {
        operationId: 'listMedicationConsents',
        tags,
        summary: 'İlaç onayı talepleri',
        description: `En yeni talep önce; süzgeç durum ve öğrenci. Satır ilaç adı ve doz taşıdığından her dönen talep \`finance.infirmary.consent_read\` denetimine düşer. Okulda erişim gerekçesi zorunlu (\`X-Access-Reason\`; DOM-FIN-156, K-523): yoksa 400 \`health_access_reason_required\`; okuma gerekçesiyle sağlık erişim günlüğüne düşer. Veliden gerekçe istenmez. ${READERS}`,
        headers: healthAccessHeadersSchema(false),
        querystring: consentListQuery,
        response: { 200: consentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status: state, studentId } = request.query
      const { items, total } = await listConsentsFor(
        contextOf(request),
        deps,
        { page, pageSize, status: state, studentId },
        healthAccessReasonOf(request),
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    CONSENTS,
    {
      preValidation: [...guardians, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createMedicationConsent',
        tags,
        summary: 'Çocuğum için ilaç onayı ver',
        description: `Veli kendi çocuğu (kapsam dışı 404, varlık ipucu yok) için ilaç adı, doz, doz saatleri (1–6), ilk ve son gün (ilk gün bugünden önce 422 \`infirmary_consent_start_past\`, 60 günden sonra 422 \`infirmary_consent_start_too_far\`; son gün ilk günden önce 422 \`infirmary_consent_end_before_start\`; en çok 90 gün 422 \`infirmary_consent_too_long\`) ve not yazar. Talep okul onayını bekler; onaysız ilaç verilmez. İlaç adı, doz ve not şifreli saklanır. Denetim \`finance.infirmary.consent_create\`. \`Idempotency-Key\` zorunlu. ${GUARDIAN}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: medicationConsentInputSchema,
        response: { 201: consentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createConsentCommand(
        contextOf(request),
        deps,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = consentResponse.parse(sendBody(reply, result))
      reply.header('location', `${CONSENTS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${CONSENTS}/:consentId`,
    {
      preValidation: [...readers, requireHealthAccessReason()],
      schema: {
        operationId: 'getMedicationConsent',
        tags,
        summary: 'İlaç onayı ve uygulamaları',
        description: `Talep ve ilaç uygulamaları (an, saat, doz, uygulayan). Okuma \`finance.infirmary.consent_read\` denetimine düşer. Okulda erişim gerekçesi zorunlu (\`X-Access-Reason\`; DOM-FIN-156, K-523): yoksa 400 \`health_access_reason_required\`; okuma gerekçesiyle sağlık erişim günlüğüne düşer. Veliden gerekçe istenmez. Olmayan, başka kurumun ya da velinin kapsamı dışındaki talep 404. ${READERS}`,
        headers: healthAccessHeadersSchema(false),
        params: consentParams,
        response: { 200: consentResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getConsentFor(
        contextOf(request),
        deps,
        request.params.consentId,
        healthAccessReasonOf(request),
      ),
    }),
  )

  const decision = (
    path: 'approve' | 'reject',
    operationId: string,
    summary: string,
    description: string,
    body: z.ZodType,
  ) =>
    typed.post(
      `${CONSENTS}/:consentId/${path}`,
      {
        preValidation: [...school, requireIfMatch(), captureInput()],
        schema: {
          operationId,
          tags,
          summary,
          description: `${description} Yalnız bekleyen talep (409 \`infirmary_consent_not_pending\`). Veliye bildirim gönderilmez. \`If-Match\` zorunlu. ${SCHOOL}`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: consentParams,
          body,
          response: { 200: consentResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await transitionConsentCommand(
          contextOf(request),
          deps,
          request.params.consentId,
          path,
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return consentResponse.parse(sendBody(reply, result))
      },
    )

  decision(
    'approve',
    'approveMedicationConsent',
    'İlaç talebini onayla',
    'Onaydan sonra ilaç onaydaki saat ve dozla verilebilir. Son günü geçmiş talep 422 `infirmary_consent_expired`. Gövde boş nesne. Denetim `finance.infirmary.consent_approve`.',
    z.strictObject({}),
  )
  decision(
    'reject',
    'rejectMedicationConsent',
    'İlaç talebini reddet',
    'Gerekçe (5–500) şifreli saklanır ve veliye döner. Denetim `finance.infirmary.consent_reject` (gerekçe yazılmaz).',
    medicationConsentRejectSchema,
  )

  typed.post(
    `${CONSENTS}/:consentId/withdraw`,
    {
      preValidation: [...guardians, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'withdrawMedicationConsent',
        tags,
        summary: 'İlaç onayını geri çek',
        description: `Veli bekleyen ya da onaylı talebi geri çeker; sonra ilaç verilmez (422 \`infirmary_consent_not_approved\`). Kapanmış talep 409 \`infirmary_consent_closed\`. Gövde boş nesne. Denetim \`finance.infirmary.consent_withdraw\`. \`If-Match\` zorunlu. ${GUARDIAN}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: consentParams,
        body: z.strictObject({}),
        response: { 200: consentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await transitionConsentCommand(
        contextOf(request),
        deps,
        request.params.consentId,
        'withdraw',
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return consentResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${CONSENTS}/:consentId/administrations`,
    {
      preValidation: [...school, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'recordMedicationAdministration',
        tags,
        summary: 'İlaç uygulamasını kaydet',
        description: `Onaylı talep (422 \`infirmary_consent_not_approved\`), onaydaki doz saati (422 \`infirmary_dose_time_not_approved\`) ve doz (422 \`infirmary_dose_not_approved\`; boşluk, büyük harf ve ondalık virgül farkı sayılmaz), uygulama anı (boşsa şimdi; gelecekte 422 \`infirmary_administration_in_future\`, 24 saatten eski 422 \`infirmary_administration_too_old\`; Europe/Istanbul günü dönem dışında 422 \`infirmary_administration_outside_period\`) ve uygulayan (boşsa kaydeden; 422 \`infirmary_administered_by_not_found|not_staff|inactive\`). Aynı günün aynı doz saati ikinci kez yazılmaz (409 \`infirmary_dose_already_given\`). Kayıt değişmez. Denetim \`finance.infirmary.administration_create\`. \`Idempotency-Key\` zorunlu. ${SCHOOL}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: consentParams,
        body: medicationAdministrationSchema,
        response: { 201: consentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await recordAdministrationCommand(
        contextOf(request),
        deps,
        request.params.consentId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return consentResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${BASE}/medication-schedule`,
    {
      preValidation: [...school, requireHealthAccessReason()],
      schema: {
        operationId: 'getMedicationSchedule',
        tags,
        summary: 'Günün ilaç uygulama listesi',
        description: `Günü (Europe/Istanbul; boşsa bugün) kapsayan onaylı taleplerin her doz saati, saat sırasıyla; o gün verildiyse uygulama. Her talep \`finance.infirmary.schedule_read\` denetimine düşer. Erişim gerekçesi zorunlu (\`X-Access-Reason\`; DOM-FIN-156, K-523): yoksa 400 \`health_access_reason_required\`; okuma gerekçesiyle sağlık erişim günlüğüne düşer. ${SCHOOL}`,
        headers: healthAccessHeadersSchema(true),
        querystring: dayQuery,
        response: { 200: scheduleResponse, ...commandErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      return {
        data: await getMedicationScheduleFor(
          ctx,
          deps,
          request.query.date ?? dayKey(ctx.now),
          healthAccessReasonOf(request),
        ),
      }
    },
  )

  typed.get(
    `${BASE}/staff`,
    {
      preValidation: school,
      schema: {
        operationId: 'listInfirmaryStaff',
        tags,
        summary: 'Revir için personel',
        description: `Gönderen ve uygulayan seçimi: kurumun etkin yönetici, öğretmen ve ön büro üyelikleri, ada göre. ${SCHOOL}`,
        querystring: infirmaryStaffQuery,
        response: { 200: infirmaryStaffListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listInfirmaryStaffFor(contextOf(request), {
        page,
        pageSize,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )
}
