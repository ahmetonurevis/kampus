import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { addDays, daysBetween } from './finance-opening-watch.ts'
import { dateLabel } from './format.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Personel sağlık raporu (docs/domain/finans.md DOM-FIN-110; ON-185). Yönetici bir personel
 * üyeliğine (yönetici, öğretmen, ön büro) istirahat raporunun **yalnız tarih aralığını ve türünü**
 * yazar. Sağlık verisi özel nitelikli kişisel veridir (KVKK md. 6): tanı, hastalık adı, ICD kodu
 * ve serbest not tutulmaz (K-363). Veren kurum türü ve rapor dosyası (PDF) isteğe bağlıdır.
 *
 * Aralık başlangıç ve bitiş dahil takvim günüdür; aynı personelin iptal edilmemiş raporları bir
 * gün bile çakışmaz (K-364). Rapor düzeltilmez: tarih ya da tür yanlışsa gerekçeyle iptal edilip
 * yeniden yazılır; yalnız "işverene bildirildi" ve "SGK sisteminde onaylandı" işaretleri ile dosya
 * değişir (K-365). SGK bildirimi ve geçici iş göremezlik ödeneği Kampüs'te hesaplanmaz; dönem
 * özeti bordro girdisidir. Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Sağlık raporu yalnız yöneticide (K-363); muhasebe rolü açılsa da ayrı İK yetkisi gerekir. */
export const FINANCE_MEDICAL_REPORT_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** Rapor türü (K-363): SGK geçici iş göremezlik halleri. Tanı değil, sigorta türüdür. */
export const MEDICAL_REPORT_TYPES = [
  'sickness',
  'work_accident',
  'occupational_disease',
  'maternity',
] as const
export type MedicalReportType = (typeof MEDICAL_REPORT_TYPES)[number]
export const MEDICAL_REPORT_TYPE_LABELS = {
  sickness: 'İstirahat (hastalık)',
  work_accident: 'İş kazası',
  occupational_disease: 'Meslek hastalığı',
  maternity: 'Analık (doğum)',
} as const satisfies Record<MedicalReportType, string>

/** Raporu veren kurum türü (isteğe bağlı). */
export const MEDICAL_REPORT_ISSUERS = ['public', 'private', 'family_physician'] as const
export type MedicalReportIssuer = (typeof MEDICAL_REPORT_ISSUERS)[number]
export const MEDICAL_REPORT_ISSUER_LABELS = {
  public: 'Devlet (kamu) sağlık kuruluşu',
  private: 'Özel sağlık kuruluşu',
  family_physician: 'Aile hekimi',
} as const satisfies Record<MedicalReportIssuer, string>

/** Tek raporun en uzun süresi, takvim günü (K-364); daha uzun istirahat art arda raporla girilir. */
export const MEDICAL_REPORT_MAX_DAYS = 366
/** Başlangıç bugünden en çok bu kadar gün ileride olabilir (K-364; ör. doğum öncesi analık). */
export const MEDICAL_REPORT_MAX_LEAD_DAYS = 180
/** Dönem özeti ve gün okumasında aralığın en uzun hâli, takvim günü. */
export const MEDICAL_REPORT_PERIOD_MAX_DAYS = 366
export const MEDICAL_REPORT_CANCEL_REASON_MIN = 5
export const MEDICAL_REPORT_CANCEL_REASON_MAX = 500

/**
 * Ekranda bilgi notu (K-365): Kampüs hesaplamaz, yalnız hatırlatır. Ödeme ve bildirim kuralları
 * mali müşavirle doğrulanmalıdır (M-67, H-71).
 */
export const MEDICAL_REPORT_NOTES = [
  'Kampüs SGK bildirimi yapmaz ve geçici iş göremezlik ödeneğini (rapor parası) hesaplamaz.',
  'e-Rapor onayı (çalışmadığına dair bildirim) işverence SGK sisteminde yapılır; burada yalnız işaretlenir.',
  'Hastalık raporunda SGK ödeneği üçüncü günden başlar; ilk iki günün ücretini işverenin ödeyip ödemeyeceği iş sözleşmesine bağlıdır. İş kazası, meslek hastalığı ve analıkta ödenek ilk günden başlar.',
  'Tanı, hastalık adı ya da ICD kodu yazılmaz; iptal gerekçesine de yazmayın.',
] as const

// --- Şemalar -------------------------------------------------------------------------------------

const membershipSchema = z
  .string('Personel seçin.')
  .trim()
  .min(1, 'Personel seçin.')
  .max(100, 'Personel geçersiz.')
const fileIdSchema = z.uuid('Rapor dosyası geçersiz.')

/** Takvim günü sayısı, başlangıç ve bitiş dahil (K-364). */
export function medicalReportDayCount(startDate: string, endDate: string): number {
  return daysBetween(startDate, endDate) + 1
}

/** Yeni rapor (DOM-FIN-110): personel, tür, aralık; veren kurum türü ve dosya isteğe bağlı. */
export const medicalReportInputSchema = z
  .strictObject({
    // kvkk: K (personel üyeliği)
    membershipId: membershipSchema.describe('Raporun ait olduğu personelin kurum üyeliği'),
    // kvkk: Ö (sağlık; yalnız sigorta türü, tanı değil)
    reportType: z
      .enum(MEDICAL_REPORT_TYPES, 'Rapor türünü seçin.')
      .describe(
        '`sickness` istirahat (hastalık), `work_accident` iş kazası, `occupational_disease` meslek hastalığı, `maternity` analık',
      ),
    startDate: daySchema.describe('Rapor başlangıcı (gün, dahil)'),
    endDate: daySchema.describe('Rapor bitişi (gün, dahil); başlangıçtan önce olamaz'),
    issuerType: z
      .enum(MEDICAL_REPORT_ISSUERS, 'Raporu veren kurum türünü seçin.')
      .nullable()
      .default(null)
      .describe(
        'İsteğe bağlı: `public` devlet, `private` özel sağlık kuruluşu, `family_physician` aile hekimi',
      ),
    fileId: fileIdSchema
      .nullable()
      .default(null)
      .describe('İsteğe bağlı rapor dosyası (`POST /files`, `purpose: document`, PDF)'),
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıç gününden önce olamaz.',
      })
      return
    }
    if (medicalReportDayCount(value.startDate, value.endDate) > MEDICAL_REPORT_MAX_DAYS)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: `Bir rapor en çok ${String(MEDICAL_REPORT_MAX_DAYS)} gün olabilir; daha uzun istirahati art arda raporla girin.`,
      })
  })
export type MedicalReportInput = z.input<typeof medicalReportInputSchema>
export type MedicalReportFields = z.output<typeof medicalReportInputSchema>

/** İşaret ve dosya değişikliği (K-365): verilen alanlar değişir; tarih ve tür değişmez. */
export const medicalReportUpdateSchema = z
  .strictObject({
    employerNotified: z
      .boolean('İşverene bildirim işaretini seçin.')
      .optional()
      .describe('Rapor işverene bildirildi (personel raporu verdi)'),
    sgkApproved: z
      .boolean('SGK onay işaretini seçin.')
      .optional()
      .describe('İşveren raporu SGK sisteminde onayladı (çalışmadığına dair bildirim)'),
    fileId: fileIdSchema
      .nullable()
      .optional()
      .describe('Rapor dosyası; `null` eki kaldırır, yeni kimlik eskisinin yerine bağlanır'),
  })
  .refine(
    (value) =>
      value.employerNotified !== undefined ||
      value.sgkApproved !== undefined ||
      value.fileId !== undefined,
    'Değiştirilecek bir alan seçin.',
  )
export type MedicalReportUpdateFields = z.output<typeof medicalReportUpdateSchema>

/** İptal (K-364): gerekçe 5–500 karakter; tanı yazılmaz. */
export const medicalReportCancelSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(MEDICAL_REPORT_CANCEL_REASON_MIN, 'İptal gerekçesini en az 5 karakterle yazın.')
    .max(
      MEDICAL_REPORT_CANCEL_REASON_MAX,
      `En fazla ${String(MEDICAL_REPORT_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
    )
    .describe('İptal gerekçesi (tanı yazılmaz); denetim kaydına yazılmaz'),
})
export type MedicalReportCancelFields = z.output<typeof medicalReportCancelSchema>

// --- Aralık ve gün -------------------------------------------------------------------------------

export interface MedicalReportPeriod {
  startDate: string
  endDate: string
}

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** İki aralık en az bir günde kesişiyor mu (uçlar dahil). */
export const periodsOverlap = (a: MedicalReportPeriod, b: MedicalReportPeriod) =>
  a.startDate <= b.endDate && b.startDate <= a.endDate

/** Ayın ilk ve son günü (`day` gününün ayı); dönem özeti varsayılanı. */
export function monthPeriod(day: string): { from: string; to: string } {
  const from = `${day.slice(0, 7)}-01`
  const next = new Date(`${from}T00:00:00.000Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) }
}

/** Dönem denetimi: bitiş başlangıçtan önce olamaz, dönem en çok 366 gün. */
export function assertMedicalReportPeriod(from: string, to: string): void {
  if (to < from)
    throw new DomainError(
      'medical_report_period_invalid',
      'Dönem sonu dönem başından önce olamaz.',
      { kind: 'rule', path: ['to'] },
    )
  if (medicalReportDayCount(from, to) > MEDICAL_REPORT_PERIOD_MAX_DAYS)
    throw new DomainError(
      'medical_report_period_too_long',
      `Dönem en çok ${String(MEDICAL_REPORT_PERIOD_MAX_DAYS)} gün olabilir.`,
      { kind: 'rule', path: ['to'] },
    )
}

/** Raporun `from`–`to` dönemine düşen gün sayısı (kesişim; yoksa 0). */
export function medicalReportDaysInPeriod(
  report: MedicalReportPeriod,
  from: string,
  to: string,
): number {
  const start = report.startDate > from ? report.startDate : from
  const end = report.endDate < to ? report.endDate : to
  return end < start ? 0 : medicalReportDayCount(start, end)
}

/** Bir personelin dönemdeki rapor günleri: türe göre sayılar ve gün listesi (ON-181 okur). */
export interface MedicalReportDays {
  /** Dönemdeki rapor günü sayısı (takvim günü; raporlar çakışmadığından tekrar sayılmaz). */
  totalDays: number
  byType: Record<MedicalReportType, number>
  /** Dönemdeki rapor günleri, artan (`YYYY-MM-DD`). */
  days: string[]
}

const emptyByType = (): Record<MedicalReportType, number> => ({
  sickness: 0,
  work_accident: 0,
  occupational_disease: 0,
  maternity: 0,
})

/**
 * "Tarih aralığındaki rapor günleri" (DOM-FIN-110): iptal edilmemiş raporların dönemle kesişen
 * günleri. Raporlar çakışmasa da gün listesi tekilleştirilir; toplam listedeki gün sayısıdır.
 * İzin hak edişi (ON-181) ve bordro aktarımı (ON-202) bu sonucu okur.
 */
export function medicalReportDays(
  reports: readonly (MedicalReportPeriod & { reportType: MedicalReportType })[],
  from: string,
  to: string,
): MedicalReportDays {
  const byType = emptyByType()
  const days = new Set<string>()
  for (const report of reports) {
    const count = medicalReportDaysInPeriod(report, from, to)
    if (count === 0) continue
    byType[report.reportType] += count
    let day = report.startDate > from ? report.startDate : from
    const end = report.endDate < to ? report.endDate : to
    while (day <= end) {
      days.add(day)
      day = addDays(day, 1)
    }
  }
  return { totalDays: days.size, byType, days: [...days].sort() }
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

/** Yeni raporun denetimi için servis kurum kilidi altında yükler. */
export interface MedicalReportChecks {
  /**
   * Üyelik: kurumda yoksa `null`. `leftOn` pasifleştirildiği gün (Europe/Istanbul); etkinse
   * `null`.
   */
  staff: { role: string; leftOn: string | null } | null
  /** Aynı personelin iptal edilmemiş raporları. */
  reports: readonly (MedicalReportPeriod & { id: string })[]
  /** Bugün (Europe/Istanbul günü). */
  today: string
}

/**
 * Yeni rapor (DOM-FIN-110, K-364). Personel kurumun yönetici, öğretmen ya da ön büro üyeliğidir;
 * pasifleştirilmiş personele ayrıldığı günden sonra başlayan rapor yazılmaz (öncesi yazılır: son
 * bordro dönemine düşebilir). Başlangıç bugünden en çok 180 gün ileride olabilir. Aynı personelin
 * iptal edilmemiş raporlarıyla bir gün bile kesişmez. Sonuç takvim günü sayısıdır.
 */
export function planMedicalReport(
  input: MedicalReportFields,
  checks: MedicalReportChecks,
): { dayCount: number } {
  if (checks.staff === null)
    throw ruleError('medical_report_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(checks.staff.role))
    throw ruleError(
      'medical_report_not_staff',
      'Sağlık raporu yalnız personele (yönetici, öğretmen, ön büro) girilir.',
      'membershipId',
    )
  if (checks.staff.leftOn !== null && input.startDate > checks.staff.leftOn)
    throw ruleError(
      'medical_report_after_leave',
      `Personel ${dayText(checks.staff.leftOn)} günü pasifleştirildi; sonrasında başlayan rapor girilmez.`,
      'startDate',
    )
  if (input.startDate > addDays(checks.today, MEDICAL_REPORT_MAX_LEAD_DAYS))
    throw ruleError(
      'medical_report_start_too_far',
      `Rapor başlangıcı bugünden en çok ${String(MEDICAL_REPORT_MAX_LEAD_DAYS)} gün ileride olabilir.`,
      'startDate',
    )
  const overlap = checks.reports.find((report) => periodsOverlap(report, input))
  if (overlap !== undefined)
    throw ruleError(
      'medical_report_overlap',
      `Bu personelin ${dayText(overlap.startDate)}–${dayText(overlap.endDate)} raporuyla çakışıyor. Yanlışsa önce o raporu iptal edin.`,
      'startDate',
    )
  return { dayCount: medicalReportDayCount(input.startDate, input.endDate) }
}

/** İşaret ve dosya için yüklenen rapor durumu. */
export interface MedicalReportState {
  cancelled: boolean
  employerNotified: boolean
  sgkApproved: boolean
  fileId: string | null
}

export interface MedicalReportUpdatePlan {
  employerNotified: boolean
  sgkApproved: boolean
  /** Dosya değişikliği: `undefined` değişmez; `detach` eski bağı kaldırır, `attach` yenisini bağlar. */
  file: { detach: string | null; attach: string | null } | undefined
  /** Değişen alan adları (denetim kaydına yalnız adlar yazılır). */
  fields: string[]
}

function requireOpen(current: MedicalReportState) {
  if (current.cancelled)
    throw ruleError('medical_report_cancelled', 'İptal edilmiş rapor değiştirilemez.', 'id')
}

/**
 * İşaret ve dosya (K-365). İptal edilmiş rapor değişmez. "SGK sisteminde onaylandı" işareti
 * "işverene bildirildi" işaretini ister (birleşik değerde); işaretler geri alınabilir.
 * Değişiklik yoksa reddedilir.
 */
export function planMedicalReportUpdate(
  current: MedicalReportState,
  input: MedicalReportUpdateFields,
): MedicalReportUpdatePlan {
  requireOpen(current)
  const employerNotified = input.employerNotified ?? current.employerNotified
  const sgkApproved = input.sgkApproved ?? current.sgkApproved
  if (sgkApproved && !employerNotified)
    throw ruleError(
      'medical_report_sgk_requires_notice',
      'SGK onayı işaretlenmeden önce raporun işverene bildirildiği işaretlenmeli.',
      input.sgkApproved === undefined ? 'employerNotified' : 'sgkApproved',
    )
  const fields: string[] = []
  if (employerNotified !== current.employerNotified) fields.push('employerNotified')
  if (sgkApproved !== current.sgkApproved) fields.push('sgkApproved')
  const fileChanged = input.fileId !== undefined && input.fileId !== current.fileId
  if (fileChanged) fields.push('fileId')
  if (fields.length === 0)
    throw ruleError('medical_report_unchanged', 'Raporda değişiklik yok.', 'id')
  return {
    employerNotified,
    sgkApproved,
    file: fileChanged ? { detach: current.fileId, attach: input.fileId ?? null } : undefined,
    fields,
  }
}

/** İptal (K-364): bir kez; iptal edilen raporun dosya bağı kalkar (K-363). */
export function planMedicalReportCancel(current: MedicalReportState): {
  detachFileId: string | null
} {
  requireOpen(current)
  return { detachFileId: current.fileId }
}

/** Bugüne göre durum (saklanmaz): ileri tarihli, sürüyor, bitti; iptal ayrı. */
export const MEDICAL_REPORT_STATES = ['scheduled', 'ongoing', 'ended', 'cancelled'] as const
export type MedicalReportStatus = (typeof MEDICAL_REPORT_STATES)[number]
export const MEDICAL_REPORT_STATE_LABELS = {
  scheduled: 'İleri tarihli',
  ongoing: 'Sürüyor',
  ended: 'Bitti',
  cancelled: 'İptal edildi',
} as const satisfies Record<MedicalReportStatus, string>

export function medicalReportState(
  report: MedicalReportPeriod & { cancelled: boolean },
  today: string,
): MedicalReportStatus {
  if (report.cancelled) return 'cancelled'
  if (report.startDate > today) return 'scheduled'
  return report.endDate < today ? 'ended' : 'ongoing'
}
