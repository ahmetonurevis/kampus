import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { addDays } from './finance-opening-watch.ts'
import { dayKey } from './format.ts'
import { STAFF_ROLES } from './staff-accounts.ts'

/**
 * Revir ve ilaç onayı (docs/domain/finans.md DOM-FIN-151; ON-101; IST-102; K-508…K-510).
 *
 * Revir ziyareti (K-508): öğrenci, geliş anı, isteğe bağlı gönderen personel, şikâyet, yapılanlar
 * (dinlenme, ilk yardım, ilaç verildi, veli çağrıldı, eve gönderildi, 112), isteğe bağlı not ve kaza
 * kaynaklıysa kaza tutanağına (DOM-FIN-146) bağ. Ziyaret açık ("revirde") başlar; dönüş anı ve
 * sonuçla (sınıfa döndü, eve gitti, sevk) kapanır ve sonra değişmez. Bir öğrencinin aynı anda tek açık
 * ziyareti olur.
 *
 * İlaç onayı (K-509): veli kendi çocuğu için ilaç adı, doz, doz saatleri, başlangıç–bitiş günü ve not
 * bildirir; okul (yönetici, ön büro) onaylar ya da gerekçeyle reddeder; veli bekleyen ya da onaylı
 * talebi geri çeker. Onaysız ilaç verilmez: uygulama yalnız onaylı talepte, onay dönemi içinde,
 * onaydaki saat ve dozla yazılır; aynı günün aynı doz saati ikinci kez yazılmaz.
 *
 * Erişim (K-510): revir görevlisi rolü olmadığından revir işini yönetici ve ön büro yürütür. Sınıf
 * öğretmeni yalnız kendi sınıfının öğrencisinin "revirde / döndü" durumunu görür, sağlık ayrıntısını
 * görmez. Veli kendi çocuğunun ziyaret özetini, ilaç taleplerini ve uygulamalarını görür. Şikâyet,
 * yapılanlar, not, ilaç adı, doz ve gerekçe özel nitelikli sağlık verisidir: şifreli saklanır, her
 * ayrıntı okuması denetime düşer, loga ve denetim değerine yazılmaz. Sağlık profili (IST-020) buraya
 * kopyalanmaz. Fonksiyonlar saftır; zaman `now` ile gelir.
 */

/** Revir işini yürüten roller (K-510; revir görevlisi rolü yok). */
export const FINANCE_INFIRMARY_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Revir durumunu ("revirde / döndü") okuyan roller; öğretmen yalnız kendi sınıfını görür. */
export const FINANCE_INFIRMARY_STATUS_ROLES = [
  'yonetici',
  'onburo',
  'ogretmen',
] as const satisfies readonly Role[]
/** Kendi çocuğu için ilaç talebi açan ve özet okuyan rol (K-509, K-510). */
export const FINANCE_INFIRMARY_GUARDIAN_ROLES = ['veli'] as const satisfies readonly Role[]
/** İlaç talebini okuyan roller (okul hepsini, veli kendi çocuklarınınkini). */
export const FINANCE_INFIRMARY_CONSENT_READ_ROLES = [
  'yonetici',
  'onburo',
  'veli',
] as const satisfies readonly Role[]

export const VISIT_STATUSES = ['open', 'closed'] as const
export type VisitStatus = (typeof VISIT_STATUSES)[number]
export const VISIT_STATUS_LABELS = {
  open: 'Revirde',
  closed: 'Ayrıldı',
} as const satisfies Record<VisitStatus, string>

export const VISIT_ACTIONS = [
  'rest',
  'first_aid',
  'medication',
  'guardian_called',
  'sent_home',
  'emergency_112',
] as const
export type VisitAction = (typeof VISIT_ACTIONS)[number]
export const VISIT_ACTION_LABELS = {
  rest: 'Dinlenme',
  first_aid: 'İlk yardım',
  medication: 'İlaç verildi',
  guardian_called: 'Veli çağrıldı',
  sent_home: 'Eve gönderildi',
  emergency_112: '112 arandı',
} as const satisfies Record<VisitAction, string>

export const VISIT_OUTCOMES = ['returned_to_class', 'went_home', 'referred'] as const
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number]
export const VISIT_OUTCOME_LABELS = {
  returned_to_class: 'Sınıfa döndü',
  went_home: 'Eve gitti',
  referred: 'Sevk edildi',
} as const satisfies Record<VisitOutcome, string>

/** Öğretmenin gördüğü durum (K-510): sonuç (eve gitti, sevk) ona gitmez. */
export const VISIT_PRESENCE_STATES = ['in_infirmary', 'returned'] as const
export type VisitPresenceState = (typeof VISIT_PRESENCE_STATES)[number]
export const VISIT_PRESENCE_LABELS = {
  in_infirmary: 'Revirde',
  returned: 'Döndü',
} as const satisfies Record<VisitPresenceState, string>

export const CONSENT_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const
export type ConsentStatus = (typeof CONSENT_STATUSES)[number]
export const CONSENT_STATUS_LABELS = {
  pending: 'Onay bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  withdrawn: 'Geri çekildi',
} as const satisfies Record<ConsentStatus, string>

export const VISIT_COMPLAINT_MIN = 2
export const VISIT_COMPLAINT_MAX = 500
export const VISIT_NOTE_MAX = 1000
/** Unutulan ziyaret en çok bu kadar gün geriye yazılır (K-508). */
export const VISIT_BACKDATE_DAYS = 7
export const MEDICATION_NAME_MIN = 2
export const MEDICATION_NAME_MAX = 120
export const MEDICATION_DOSE_MAX = 60
export const MEDICATION_TIMES_MAX = 6
export const MEDICATION_NOTE_MAX = 500
/** Onay en çok bu kadar gün sürer (uçlar dahil; K-509). */
export const MEDICATION_PERIOD_MAX_DAYS = 90
/** Talep en çok bu kadar gün sonrası için açılır (K-509). */
export const MEDICATION_START_AHEAD_DAYS = 60
export const CONSENT_REASON_MIN = 5
export const CONSENT_REASON_MAX = 500
/** Unutulan uygulama en çok bu kadar saat geriye yazılır (K-509). */
export const ADMINISTRATION_BACKDATE_HOURS = 24
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

// --- Şemalar -------------------------------------------------------------------------------------

const instant = (message: string) => z.iso.datetime({ offset: true, error: message })
const memberId = (message: string) => z.string(message).trim().min(1, message)
const optionalText = (label: string, max: number) =>
  z
    .string(`${label} metin olmalı.`)
    .trim()
    .max(max, `${label} en çok ${String(max)} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
export const doseTimeSchema = z
  .string('Doz saatini girin.')
  .regex(TIME_PATTERN, 'Saati SS:DD biçiminde girin (ör. 12:30).')
  .describe('Doz saati (SS:DD, Europe/Istanbul)')

// kvkk: Ö — sağlık; şifreli saklanır, denetime ve loga yazılmaz.
const complaintSchema = z
  .string('Şikâyeti yazın.')
  .trim()
  .min(VISIT_COMPLAINT_MIN, `Şikâyet en az ${String(VISIT_COMPLAINT_MIN)} karakter olmalı.`)
  .max(VISIT_COMPLAINT_MAX, `Şikâyet en çok ${String(VISIT_COMPLAINT_MAX)} karakter olabilir.`)
  .describe('Öğrencinin şikâyeti (2–500; şifreli)')

// kvkk: Ö — sağlık; şifreli saklanır.
const actionsSchema = z
  .array(z.enum(VISIT_ACTIONS, 'Yapılanı seçin.'), 'Yapılanları seçin.')
  .max(VISIT_ACTIONS.length, 'Yapılan en çok altı seçilir.')
  .refine((items) => new Set(items).size === items.length, 'Aynı işlem iki kez seçilmiş.')
  .describe(
    '`rest` dinlenme, `first_aid` ilk yardım, `medication` ilaç verildi, `guardian_called` veli çağrıldı, `sent_home` eve gönderildi, `emergency_112` 112 (şifreli)',
  )

// kvkk: Ö — sağlık; şifreli saklanır.
const visitNoteSchema = optionalText('Not', VISIT_NOTE_MAX).describe(
  'Revir notu (≤ 1000; şifreli, veliye gitmez)',
)

export const infirmaryVisitInputSchema = z.strictObject({
  studentId: memberId('Öğrenciyi seçin.').describe('Öğrenci kaydı'),
  arrivedAt: instant('Geliş anını girin.')
    .nullable()
    .default(null)
    .describe('Revire geliş anı (ISO 8601); boşsa şimdi. Gelecekte ve 7 günden eski olamaz'),
  referredByMembershipId: memberId('Göndereni seçin.')
    .nullable()
    .default(null)
    .describe('Öğrenciyi gönderen personel üyeliği; kendisi geldiyse boş'),
  complaint: complaintSchema,
  actions: actionsSchema.default([]),
  note: visitNoteSchema.default(null),
  incidentReportId: z
    .uuid('Kaza tutanağı geçersiz.')
    .nullable()
    .default(null)
    .describe('Kaza kaynaklıysa aynı öğrencinin kaza tutanağı (DOM-FIN-146)'),
})
export type InfirmaryVisitInput = z.input<typeof infirmaryVisitInputSchema>
export type InfirmaryVisitFields = z.output<typeof infirmaryVisitInputSchema>

/** Açık ziyaret düzeltmesi: verilmeyen alan değişmez; öğrenci değişmez. */
export const infirmaryVisitUpdateSchema = z
  .strictObject({
    arrivedAt: instant('Geliş anını girin.').optional(),
    referredByMembershipId: memberId('Göndereni seçin.').nullable().optional(),
    complaint: complaintSchema.optional(),
    actions: actionsSchema.optional(),
    note: visitNoteSchema.optional(),
    incidentReportId: z.uuid('Kaza tutanağı geçersiz.').nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((item) => item !== undefined),
    'En az bir alanı değiştirin.',
  )
export type InfirmaryVisitPatch = z.output<typeof infirmaryVisitUpdateSchema>

export const infirmaryDischargeSchema = z.strictObject({
  returnedAt: instant('Dönüş anını girin.')
    .nullable()
    .default(null)
    .describe('Revirden ayrılış anı (ISO 8601); boşsa şimdi. Gelişten önce ve gelecekte olamaz'),
  outcome: z
    .enum(VISIT_OUTCOMES, 'Sonucu seçin.')
    .describe('`returned_to_class` sınıfa döndü, `went_home` eve gitti, `referred` sevk'),
  actions: actionsSchema.optional().describe('Yapılanlar; verilmezse ziyaretteki liste kalır'),
  note: visitNoteSchema.optional(),
})
export type InfirmaryDischargeFields = z.output<typeof infirmaryDischargeSchema>

const timesSchema = z
  .array(doseTimeSchema, 'Doz saatlerini girin.')
  .min(1, 'En az bir doz saati girin.')
  .max(MEDICATION_TIMES_MAX, `En çok ${String(MEDICATION_TIMES_MAX)} doz saati girilir.`)
  .refine((items) => new Set(items).size === items.length, 'Aynı saat iki kez yazılmış.')
  .transform((items) => [...items].sort())

export const medicationConsentInputSchema = z.strictObject({
  studentId: memberId('Çocuğunuzu seçin.').describe('Velinin kapsamındaki çocuk'),
  // kvkk: Ö — sağlık; şifreli saklanır.
  medicationName: z
    .string('İlacın adını yazın.')
    .trim()
    .min(MEDICATION_NAME_MIN, `İlaç adı en az ${String(MEDICATION_NAME_MIN)} karakter olmalı.`)
    .max(MEDICATION_NAME_MAX, `İlaç adı en çok ${String(MEDICATION_NAME_MAX)} karakter olabilir.`)
    .describe('İlacın adı (2–120; şifreli)'),
  // kvkk: Ö — sağlık; şifreli saklanır.
  dose: z
    .string('Dozu yazın.')
    .trim()
    .min(1, 'Dozu yazın.')
    .max(MEDICATION_DOSE_MAX, `Doz en çok ${String(MEDICATION_DOSE_MAX)} karakter olabilir.`)
    .describe('Bir seferlik doz (ör. "5 ml", "1 tablet"; ≤ 60; şifreli)'),
  times: timesSchema.describe('Doz saatleri (1–6, SS:DD, Europe/Istanbul)'),
  startDate: daySchema.describe('İlk gün (YYYY-MM-DD); bugünden önce ve 60 günden sonra olamaz'),
  endDate: daySchema.describe('Son gün (dahil); başlangıçtan önce olamaz, en çok 90 gün'),
  // kvkk: Ö — sağlık; şifreli saklanır.
  note: optionalText('Not', MEDICATION_NOTE_MAX)
    .default(null)
    .describe('Veli notu (≤ 500; şifreli)'),
})
export type MedicationConsentInput = z.input<typeof medicationConsentInputSchema>
export type MedicationConsentFields = z.output<typeof medicationConsentInputSchema>

export const medicationConsentRejectSchema = z.strictObject({
  // kvkk: Ö — gerekçe sağlık bilgisi taşıyabilir; şifreli saklanır.
  reason: z
    .string('Ret gerekçesini yazın.')
    .trim()
    .min(CONSENT_REASON_MIN, `Gerekçe en az ${String(CONSENT_REASON_MIN)} karakter olmalı.`)
    .max(CONSENT_REASON_MAX, `Gerekçe en çok ${String(CONSENT_REASON_MAX)} karakter olabilir.`)
    .describe('Ret gerekçesi (5–500; şifreli, veliye döner)'),
})

export const medicationAdministrationSchema = z.strictObject({
  scheduledTime: doseTimeSchema.describe('Onaydaki doz saati (SS:DD)'),
  // kvkk: Ö — sağlık; şifreli saklanır.
  dose: z
    .string('Verilen dozu yazın.')
    .trim()
    .min(1, 'Verilen dozu yazın.')
    .max(MEDICATION_DOSE_MAX, `Doz en çok ${String(MEDICATION_DOSE_MAX)} karakter olabilir.`)
    .describe('Verilen doz; onaydaki dozla aynı olmalı (şifreli)'),
  administeredAt: instant('Uygulama anını girin.')
    .nullable()
    .default(null)
    .describe('Uygulama anı (ISO 8601); boşsa şimdi. Gelecekte ve 24 saatten eski olamaz'),
  administeredByMembershipId: memberId('Uygulayanı seçin.')
    .nullable()
    .default(null)
    .describe('İlacı veren personel üyeliği; boşsa kaydeden'),
  // kvkk: Ö — sağlık; şifreli saklanır.
  note: optionalText('Not', MEDICATION_NOTE_MAX).default(null).describe('Not (≤ 500; şifreli)'),
})
export type MedicationAdministrationFields = z.output<typeof medicationAdministrationSchema>

// --- Şifreli içerik ------------------------------------------------------------------------------

/** Ziyaretin şifreli sağlık grubu (K-510). */
export const visitHealthSchema = z.strictObject({
  complaint: z.string().max(VISIT_COMPLAINT_MAX),
  actions: z.array(z.enum(VISIT_ACTIONS)).max(VISIT_ACTIONS.length),
  note: z.string().max(VISIT_NOTE_MAX).nullable(),
})
export type VisitHealth = z.output<typeof visitHealthSchema>

/** İlaç talebinin şifreli sağlık grubu (K-510). */
export const consentHealthSchema = z.strictObject({
  medicationName: z.string().max(MEDICATION_NAME_MAX),
  dose: z.string().max(MEDICATION_DOSE_MAX),
  note: z.string().max(MEDICATION_NOTE_MAX).nullable(),
})
export type ConsentHealth = z.output<typeof consentHealthSchema>

/** Uygulamanın şifreli sağlık grubu (K-510). */
export const administrationHealthSchema = z.strictObject({
  dose: z.string().max(MEDICATION_DOSE_MAX),
  note: z.string().max(MEDICATION_NOTE_MAX).nullable(),
})
export type AdministrationHealth = z.output<typeof administrationHealthSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[]) =>
  new DomainError(code, message, { kind: 'rule', path })
const conflictError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'conflict', path })

export type InfirmaryStaffMember = { role: string; active: boolean } | null

/** Kişi kurumun etkin personeli mi; değilse ön ekli 422 (`infirmary_<önek>_not_found` …). */
function assertStaff(
  member: InfirmaryStaffMember | undefined,
  prefix: string,
  label: string,
  path: string[],
) {
  if (member === null || member === undefined)
    throw ruleError(`infirmary_${prefix}_not_found`, `${label} bulunamadı.`, path)
  if (!(STAFF_ROLES as readonly string[]).includes(member.role))
    throw ruleError(`infirmary_${prefix}_not_staff`, `${label} kurum personeli olmalı.`, path)
  if (!member.active)
    throw ruleError(`infirmary_${prefix}_inactive`, `${label} hesabı pasif.`, path)
}

function assertArrivedAt(arrivedAt: string, now: Date) {
  const at = Date.parse(arrivedAt)
  if (at > now.getTime())
    throw ruleError('infirmary_arrived_in_future', 'Geliş anı şimdiden sonra olamaz.', [
      'arrivedAt',
    ])
  if (now.getTime() - at > VISIT_BACKDATE_DAYS * DAY_MS)
    throw ruleError(
      'infirmary_arrived_too_old',
      `Revir ziyareti en çok ${String(VISIT_BACKDATE_DAYS)} gün geriye yazılır.`,
      ['arrivedAt'],
    )
}

/** Kaza tutanağı bağı (DOM-FIN-146): tutanak kurumda olmalı ve aynı öğrencinin olmalı. */
export type VisitIncidentLink = { studentId: string | null } | null

function assertIncident(incident: VisitIncidentLink | undefined, studentId: string) {
  if (incident === null || incident === undefined)
    throw ruleError('infirmary_incident_not_found', 'Kaza tutanağı bulunamadı.', [
      'incidentReportId',
    ])
  if (incident.studentId !== studentId)
    throw ruleError('infirmary_incident_other_student', 'Kaza tutanağı bu öğrenciye ait değil.', [
      'incidentReportId',
    ])
}

export interface VisitValues {
  arrivedAt: string
  referredByMembershipId: string | null
  incidentReportId: string | null
  health: VisitHealth
}

export interface VisitChecks {
  now: Date
  /** Öğrenci kurumda var mı (arşivlenmemiş kayıt). */
  studentExists: boolean
  /** Öğrencinin açık ziyareti var mı. */
  openVisitExists: boolean
  /** Göndereni personel üyeliği (verildiyse). */
  referredBy?: InfirmaryStaffMember | undefined
  /** Bağlanan kaza tutanağı (verildiyse). */
  incident?: VisitIncidentLink | undefined
}

/**
 * Ziyaret açma kuralı (K-508): öğrenci kurumda; geliş anı gelecekte ve 7 günden eski olamaz;
 * gönderen kurumun etkin personeli; kaza tutanağı aynı öğrencinin; öğrencinin açık ziyareti varsa
 * 409.
 */
export function planInfirmaryVisit(input: InfirmaryVisitFields, checks: VisitChecks): VisitValues {
  if (!checks.studentExists)
    throw ruleError('infirmary_student_not_found', 'Öğrenci bulunamadı.', ['studentId'])
  const arrivedAt = input.arrivedAt === null ? checks.now.toISOString() : input.arrivedAt
  assertArrivedAt(arrivedAt, checks.now)
  if (input.referredByMembershipId !== null)
    assertStaff(checks.referredBy, 'referred_by', 'Gönderen', ['referredByMembershipId'])
  if (input.incidentReportId !== null) assertIncident(checks.incident, input.studentId)
  if (checks.openVisitExists)
    throw conflictError(
      'infirmary_visit_already_open',
      'Öğrenci zaten revirde; önce açık ziyareti kapatın.',
      ['studentId'],
    )
  return {
    arrivedAt: new Date(arrivedAt).toISOString(),
    referredByMembershipId: input.referredByMembershipId,
    incidentReportId: input.incidentReportId,
    health: { complaint: input.complaint, actions: input.actions, note: input.note },
  }
}

/** Kapanmış ziyaret değişmez (409; veritabanında tetikleyici de korur). */
export function assertVisitOpen(status: VisitStatus) {
  if (status === 'closed')
    throw conflictError('infirmary_visit_closed', 'Kapanmış revir ziyareti değiştirilemez.')
}

/**
 * Açık ziyaret düzeltmesi (K-508): verilen alanlar birleşir; geliş anı ve gönderen ile tutanak bağı
 * yalnız değiştiyse yeniden denetlenir. Değişiklik yoksa 422. Değişen alan adları döner (denetim için).
 */
export function planInfirmaryVisitUpdate(
  current: VisitValues & { status: VisitStatus; studentId: string },
  patch: InfirmaryVisitPatch,
  checks: {
    now: Date
    referredBy?: InfirmaryStaffMember | undefined
    incident?: VisitIncidentLink | undefined
  },
): { values: VisitValues; changed: string[] } {
  assertVisitOpen(current.status)
  const values: VisitValues = {
    arrivedAt:
      patch.arrivedAt === undefined ? current.arrivedAt : new Date(patch.arrivedAt).toISOString(),
    referredByMembershipId:
      patch.referredByMembershipId === undefined
        ? current.referredByMembershipId
        : patch.referredByMembershipId,
    incidentReportId:
      patch.incidentReportId === undefined ? current.incidentReportId : patch.incidentReportId,
    health: {
      complaint: patch.complaint ?? current.health.complaint,
      actions: patch.actions ?? current.health.actions,
      note: patch.note === undefined ? current.health.note : patch.note,
    },
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const changed = [
    ...(values.arrivedAt === current.arrivedAt ? [] : ['arrivedAt']),
    ...(values.referredByMembershipId === current.referredByMembershipId
      ? []
      : ['referredByMembershipId']),
    ...(values.incidentReportId === current.incidentReportId ? [] : ['incidentReportId']),
    ...(values.health.complaint === current.health.complaint ? [] : ['complaint']),
    ...(same(values.health.actions, current.health.actions) ? [] : ['actions']),
    ...(values.health.note === current.health.note ? [] : ['note']),
  ]
  if (changed.length === 0)
    throw ruleError('infirmary_visit_unchanged', 'Revir ziyaretinde değişiklik yok.', [])
  if (changed.includes('arrivedAt')) assertArrivedAt(values.arrivedAt, checks.now)
  if (changed.includes('referredByMembershipId') && values.referredByMembershipId !== null)
    assertStaff(checks.referredBy, 'referred_by', 'Gönderen', ['referredByMembershipId'])
  if (changed.includes('incidentReportId') && values.incidentReportId !== null)
    assertIncident(checks.incident, current.studentId)
  return { values, changed }
}

/**
 * Ziyareti kapatma (K-508): açık olmalı; dönüş anı gelişten önce ve şimdiden sonra olamaz; en az bir
 * yapılan kayıtlı olmalı. Sonuç ve dönüş anı yazılınca ziyaret değişmez.
 */
export function planInfirmaryDischarge(
  current: { status: VisitStatus; arrivedAt: string; health: VisitHealth },
  input: InfirmaryDischargeFields,
  now: Date,
): { returnedAt: string; health: VisitHealth; changed: string[] } {
  assertVisitOpen(current.status)
  const returnedAt = input.returnedAt === null ? now : new Date(input.returnedAt)
  if (returnedAt.getTime() > now.getTime())
    throw ruleError('infirmary_returned_in_future', 'Dönüş anı şimdiden sonra olamaz.', [
      'returnedAt',
    ])
  if (returnedAt.getTime() < Date.parse(current.arrivedAt))
    throw ruleError('infirmary_returned_before_arrival', 'Dönüş anı gelişten önce olamaz.', [
      'returnedAt',
    ])
  const health: VisitHealth = {
    complaint: current.health.complaint,
    actions: input.actions ?? current.health.actions,
    note: input.note === undefined ? current.health.note : input.note,
  }
  if (health.actions.length === 0)
    throw ruleError('infirmary_actions_required', 'Revirde yapılanı en az bir seçin.', ['actions'])
  const changed = [
    'status',
    'returnedAt',
    'outcome',
    ...(JSON.stringify(health.actions) === JSON.stringify(current.health.actions)
      ? []
      : ['actions']),
    ...(health.note === current.health.note ? [] : ['note']),
  ]
  return { returnedAt: returnedAt.toISOString(), health, changed }
}

/** Öğretmenin gördüğü durum (K-510). */
export const visitPresence = (status: VisitStatus): VisitPresenceState =>
  status === 'open' ? 'in_infirmary' : 'returned'

/**
 * İlaç talebi (K-509): öğrenci velinin kapsamında (değilse 404); ilk gün bugünden (Europe/Istanbul)
 * önce ve 60 günden sonra olamaz; son gün ilk günden önce olamaz; dönem en çok 90 gün.
 */
export function planMedicationConsent(
  input: MedicationConsentFields,
  checks: { now: Date; studentInScope: boolean },
): { startDate: string; endDate: string; times: string[]; health: ConsentHealth } {
  if (!checks.studentInScope)
    throw new DomainError('infirmary_student_not_found', 'Öğrenci bulunamadı.', {
      kind: 'not_found',
      path: ['studentId'],
    })
  const today = dayKey(checks.now)
  if (input.startDate < today)
    throw ruleError('infirmary_consent_start_past', 'İlk gün bugünden önce olamaz.', ['startDate'])
  if (input.startDate > addDays(today, MEDICATION_START_AHEAD_DAYS))
    throw ruleError(
      'infirmary_consent_start_too_far',
      `İlk gün en çok ${String(MEDICATION_START_AHEAD_DAYS)} gün sonrası olabilir.`,
      ['startDate'],
    )
  if (input.endDate < input.startDate)
    throw ruleError('infirmary_consent_end_before_start', 'Son gün ilk günden önce olamaz.', [
      'endDate',
    ])
  if (input.endDate > addDays(input.startDate, MEDICATION_PERIOD_MAX_DAYS - 1))
    throw ruleError(
      'infirmary_consent_too_long',
      `İlaç onayı en çok ${String(MEDICATION_PERIOD_MAX_DAYS)} gün sürer.`,
      ['endDate'],
    )
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    times: input.times,
    health: { medicationName: input.medicationName, dose: input.dose, note: input.note },
  }
}

/** Onay ve ret yalnız bekleyen talepte (409); süresi geçmiş talep onaylanmaz (422). */
export function assertConsentDecision(
  consent: { status: ConsentStatus; endDate: string },
  decision: 'approve' | 'reject',
  now: Date,
) {
  if (consent.status !== 'pending')
    throw conflictError('infirmary_consent_not_pending', 'Bu ilaç talebi artık beklemede değil.')
  if (decision === 'approve' && consent.endDate < dayKey(now))
    throw ruleError(
      'infirmary_consent_expired',
      'Son günü geçmiş ilaç talebi onaylanamaz; veliden yeni talep isteyin.',
      [],
    )
}

/** Veli bekleyen ya da onaylı talebi geri çeker; kapanmış talep 409. */
export function assertConsentWithdrawable(status: ConsentStatus) {
  if (status !== 'pending' && status !== 'approved')
    throw conflictError('infirmary_consent_closed', 'Bu ilaç talebi zaten kapanmış.')
}

/** Dozu karşılaştırma biçimi: boşluklar teke iner, küçük harf, ondalık virgül noktaya. */
export const normalizeDose = (dose: string) =>
  dose.trim().replace(/\s+/g, ' ').replace(/,/g, '.').toLocaleLowerCase('tr-TR')

/**
 * İlaç uygulaması (K-509): talep onaylı olmalı; uygulama anı gelecekte ve 24 saatten eski olamaz;
 * anın Europe/Istanbul günü onay dönemi içinde; saat onaydaki saatlerden biri; doz onaydaki doz;
 * uygulayan kurumun etkin personeli. Aynı günün aynı doz saati ikinci kez yazılmaz (409).
 */
export function planMedicationAdministration(
  consent: { status: ConsentStatus; startDate: string; endDate: string; times: readonly string[] },
  approvedDose: string,
  input: MedicationAdministrationFields,
  checks: {
    now: Date
    administeredBy: InfirmaryStaffMember
    /** O gün o saat için yazılmış uygulama var mı. */
    alreadyGiven: (day: string, time: string) => boolean
  },
): { administeredAt: string; doseDay: string; health: AdministrationHealth } {
  if (consent.status !== 'approved')
    throw ruleError(
      'infirmary_consent_not_approved',
      'Onaylanmamış ilaç verilemez; önce veli talebini onaylayın.',
      [],
    )
  const at = input.administeredAt === null ? checks.now : new Date(input.administeredAt)
  if (at.getTime() > checks.now.getTime())
    throw ruleError('infirmary_administration_in_future', 'Uygulama anı şimdiden sonra olamaz.', [
      'administeredAt',
    ])
  if (checks.now.getTime() - at.getTime() > ADMINISTRATION_BACKDATE_HOURS * HOUR_MS)
    throw ruleError(
      'infirmary_administration_too_old',
      `Uygulama en çok ${String(ADMINISTRATION_BACKDATE_HOURS)} saat geriye yazılır.`,
      ['administeredAt'],
    )
  const doseDay = dayKey(at)
  if (doseDay < consent.startDate || doseDay > consent.endDate)
    throw ruleError(
      'infirmary_administration_outside_period',
      'Uygulama günü onaylı dönemin dışında.',
      ['administeredAt'],
    )
  if (!consent.times.includes(input.scheduledTime))
    throw ruleError('infirmary_dose_time_not_approved', 'Bu saat veli onayında yok.', [
      'scheduledTime',
    ])
  if (normalizeDose(input.dose) !== normalizeDose(approvedDose))
    throw ruleError('infirmary_dose_not_approved', 'Doz veli onayındaki dozla aynı değil.', [
      'dose',
    ])
  assertStaff(checks.administeredBy, 'administered_by', 'Uygulayan', ['administeredByMembershipId'])
  if (checks.alreadyGiven(doseDay, input.scheduledTime))
    throw conflictError(
      'infirmary_dose_already_given',
      'Bu doz saati için bugün uygulama zaten kayıtlı.',
      ['scheduledTime'],
    )
  return {
    administeredAt: at.toISOString(),
    doseDay,
    health: { dose: input.dose, note: input.note },
  }
}

/** Gün planı (K-509): onaylı ve o günü kapsayan talebin her doz saati bir satırdır. */
export function medicationScheduleSlots<
  C extends { id: string; startDate: string; endDate: string; times: readonly string[] },
>(consents: readonly C[], day: string): { consent: C; scheduledTime: string }[] {
  return consents
    .filter((consent) => consent.startDate <= day && day <= consent.endDate)
    .flatMap((consent) => consent.times.map((scheduledTime) => ({ consent, scheduledTime })))
    .sort(
      (a, b) =>
        a.scheduledTime.localeCompare(b.scheduledTime) || a.consent.id.localeCompare(b.consent.id),
    )
}
