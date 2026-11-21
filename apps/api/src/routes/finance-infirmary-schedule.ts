import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { FINANCE_INFIRMARY_GUARDIAN_ROLES } from '@kampus/school-core/lib/finance-infirmary.ts'
import {
  administrationCorrectionSchema,
  FINANCE_MEDICATION_CHART_ROLES,
  FINANCE_MEDICATION_CORRECTION_ROLES,
  medicationDoseSkipSchema,
  medicationSettingsSchema,
  skipCorrectionSchema,
} from '@kampus/school-core/lib/finance-infirmary-schedule.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Role } from '../auth.ts'
import { fieldCipherFromConfig } from '../lib/field-crypto.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { InfirmaryDeps } from '../services/finance-infirmary.ts'
import {
  correctAdministrationCommand,
  correctSkipCommand,
  getMedicationChartFor,
  listGuardianDosesFor,
  medicationSettingsFor,
  recordDoseSkipCommand,
  setMedicationSettingsCommand,
} from '../services/finance-infirmary-schedule.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { healthAccessReasonOf, requireHealthAccessReason } from './finance-health-access.ts'
import { healthAccessHeadersSchema } from './finance-health-access.schemas.ts'
import { consentParams } from './finance-infirmary.schemas.ts'
import {
  administrationParams,
  chartQuery,
  doseRecordResponse,
  guardianDoseListResponse,
  guardianDoseQuery,
  medicationChartResponse,
  medicationSettingsResponse,
  skipParams,
} from './finance-infirmary-schedule.schemas.ts'

/**
 * Günlük ilaç çizelgesi, atlama, düzeltme ve velinin doz geçmişi uçları (docs/domain/finans.md
 * DOM-FIN-152; ON-161; IST-102 genişlemesi; K-511…K-513). Modül `finance`. Çizelge ve atlama
 * yönetici ve ön büroda (revir görevlisi rolü yok); düzeltme/iptal ve gecikme payı yalnız
 * yöneticide; veli yalnız kendi çocuğunun uygulanan ve atlanan dozlarını okur. Sağlık ayrıntısı dönen
 * her okuma denetimdedir. Atlama ve düzeltme `Idempotency-Key`, ayar `If-Match` ister. Bildirim
 * gönderilmez.
 */

const SCHOOL =
  'Rol: `yonetici` ve `onburo` (revir görevlisi rolü yok). Öğretmen, veli ve öğrenci 403. Modül `finance`.'
const MANAGER = 'Rol: yalnız `yonetici` (ön büro 403). Modül `finance`.'
const GUARDIAN = 'Rol: yalnız `veli` (kapsamındaki çocuklar; başkası boş). Modül `finance`.'
const BASE = '/api/v1/finance/infirmary'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceInfirmaryScheduleRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Anahtar uygulama kurulurken bir kez türetilir (`config.ts` doğrulamıştır).
  const deps: InfirmaryDeps = { cipher: fieldCipherFromConfig(app.config) }
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const school = guarded(FINANCE_MEDICATION_CHART_ROLES)
  const manager = guarded(FINANCE_MEDICATION_CORRECTION_ROLES)
  const guardians = guarded(FINANCE_INFIRMARY_GUARDIAN_ROLES)
  const tags = ['finance-infirmary']

  typed.get(
    `${BASE}/medication-chart`,
    {
      preValidation: [...school, requireHealthAccessReason()],
      schema: {
        operationId: 'getMedicationChart',
        tags,
        summary: 'Günlük ilaç çizelgesi',
        description: `Günü (Europe/Istanbul; boşsa bugün) kapsayan onaylı taleplerin her doz saati: öğrenci, ilaç, onaydaki doz, doz anı ve durum (\`administered\` uygulandı, \`skipped\` atlandı; sonuç yoksa doz anı + kurumun gecikme payı geçtiyse \`overdue\`, değilse \`pending\`). Geciken dozlar üstte, sonra bekleyenler, sonra sonuçlananlar; grup içinde saat sırası. Satır doz saatinin bütün kayıtlarını (iptal edilenler ve düzeltmeler dahil) ve o günkü yoklamada yok/izinli işaretini (yoklama yalnız okunur; alınmadıysa ya da \`academic\` kapalıysa boş) taşır. Her talep \`finance.infirmary.chart_read\` denetimine düşer. Erişim gerekçesi zorunlu (\`X-Access-Reason\`; DOM-FIN-156, K-523): yoksa 400 \`health_access_reason_required\`; okuma gerekçesiyle sağlık erişim günlüğüne düşer. ${SCHOOL}`,
        headers: healthAccessHeadersSchema(true),
        querystring: chartQuery,
        response: { 200: medicationChartResponse, ...commandErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      return {
        data: await getMedicationChartFor(
          ctx,
          deps,
          request.query.date ?? dayKey(ctx.now),
          healthAccessReasonOf(request),
        ),
      }
    },
  )

  typed.post(
    `${BASE}/medication-consents/:consentId/skips`,
    {
      preValidation: [...school, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'recordMedicationDoseSkip',
        tags,
        summary: 'Dozu atlandı olarak kaydet',
        description: `Onaylı talep (422 \`infirmary_consent_not_approved\`), onaydaki doz saati (422 \`infirmary_dose_time_not_approved\`), doz günü (boşsa bugün; gelecek 422 \`infirmary_skip_in_future\`, dünden eski 422 \`infirmary_skip_too_old\`, dönem dışı 422 \`infirmary_skip_outside_period\`) ve gerekçe (\`other\`de en az 5 karakter açıklama, 400). Doz saatinin tek etkin sonucu olur: uygulama varsa 409 \`infirmary_dose_already_given\`, atlama varsa 409 \`infirmary_dose_already_skipped\`. Gerekçe ve açıklama şifreli; kayıt değişmez (düzeltme ayrı kayıttır). Denetim \`finance.infirmary.skip_create\`. \`Idempotency-Key\` zorunlu. ${SCHOOL}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: consentParams,
        body: medicationDoseSkipSchema,
        response: { 201: doseRecordResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await recordDoseSkipCommand(
        contextOf(request),
        deps,
        request.params.consentId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return doseRecordResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${BASE}/medication-administrations/:administrationId/corrections`,
    {
      preValidation: [...manager, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'correctMedicationAdministration',
        tags,
        summary: 'İlaç uygulamasını düzelt ya da iptal et',
        description: `Uygulama silinmez, değişmez; gerekçeli (5–500) düzeltme kaydı eklenir. \`void\` iptal: kayıt hiç olmamış sayılır, doz saatine yeniden uygulama ya da atlama yazılabilir; alan gönderilmez. \`amend\` düzeltme: an (gelecekte 422 \`infirmary_administration_in_future\`; kaydın doz günü dışında 422 \`infirmary_correction_day_mismatch\`), uygulayan (422 \`infirmary_administered_by_not_found|not_staff|inactive\`) ve not; değişiklik yoksa 422 \`infirmary_correction_unchanged\`. İptal edilmiş kayıt 409 \`infirmary_dose_record_voided\`. Gerekçe ve not şifreli. Denetim \`finance.infirmary.correction_create\` (alan adları). \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: administrationParams,
        body: administrationCorrectionSchema,
        response: { 201: doseRecordResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await correctAdministrationCommand(
        contextOf(request),
        deps,
        request.params.administrationId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return doseRecordResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${BASE}/medication-skips/:skipId/corrections`,
    {
      preValidation: [...manager, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'correctMedicationDoseSkip',
        tags,
        summary: 'Atlamayı düzelt ya da iptal et',
        description: `Atlama silinmez, değişmez; gerekçeli (5–500) düzeltme kaydı eklenir. \`void\` iptal: doz saati yeniden sonuçlanabilir; \`amend\` düzeltme: atlama gerekçesi ve açıklama (etkin gerekçe \`other\` iken açıklama zorunlu, 422 \`infirmary_skip_note_required\`; değişiklik yoksa 422 \`infirmary_correction_unchanged\`). İptal edilmiş kayıt 409 \`infirmary_dose_record_voided\`. Denetim \`finance.infirmary.correction_create\`. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: skipParams,
        body: skipCorrectionSchema,
        response: { 201: doseRecordResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await correctSkipCommand(
        contextOf(request),
        deps,
        request.params.skipId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return doseRecordResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${BASE}/my-medication-doses`,
    {
      preValidation: guardians,
      schema: {
        operationId: 'listGuardianMedicationDoses',
        tags,
        summary: 'Çocuğumun ilaç dozları',
        description: `Kapsamdaki (velayetli ve kısıtsız bağ) çocukların uygulanan ve atlanan dozları; gerekçe, açıklama ve düzeltilmiş değerlerle, iptal edilen kayıt yok. En yeni gün ve saat önce. Aralık boşsa son 30 gün; başlangıç bitişten sonra 422 \`infirmary_dose_range_invalid\`, 92 günden uzun 422 \`infirmary_dose_range_too_long\`. Her dönen talep \`finance.infirmary.guardian_dose_read\` denetimine düşer. Bildirim gönderilmez. ${GUARDIAN}`,
        querystring: guardianDoseQuery,
        response: { 200: guardianDoseListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, studentId, from, to } = request.query
      const { items, total } = await listGuardianDosesFor(contextOf(request), deps, {
        page,
        pageSize,
        studentId,
        from,
        to,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${BASE}/medication-settings`,
    {
      preValidation: school,
      schema: {
        operationId: 'getMedicationSettings',
        tags,
        summary: 'İlaç çizelgesi ayarı',
        description: `Gecikme payı (dk; varsayılan 30); hiç kaydedilmediyse varsayılan ve sürüm 1 (K-511). ${SCHOOL}`,
        response: { 200: medicationSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await medicationSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    `${BASE}/medication-settings`,
    {
      preValidation: [...manager, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'setMedicationSettings',
        tags,
        summary: 'İlaç çizelgesi ayarını kaydet',
        description: `Gecikme payı (5–180 dk, 400); değişiklik yoksa 422 \`infirmary_settings_unchanged\`. \`If-Match\` zorunlu (hiç kaydedilmediyse 1). Denetim \`finance.infirmary.settings_update\`. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: medicationSettingsSchema,
        response: { 200: medicationSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await setMedicationSettingsCommand(
        contextOf(request),
        request.commandInput,
        opts.expectedVersion,
        opts.idempotency,
      )
      return medicationSettingsResponse.parse(sendBody(reply, result))
    },
  )
}
