import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { previousDay, type PayRateComponent } from './finance-pay-rates.ts'
import type { PayrollDeductionSummary } from './finance-staff-deductions.ts'
import {
  PAYROLL_PLATFORM_DEFAULTS,
  effectivePayrollParameters,
  payrollParameterTimeline,
  type PayrollInstitutionSet,
  type PayrollPlatformSet,
} from './finance-payroll-parameters.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Bordro onayı ve dönem kilidi (docs/domain/finans.md DOM-FIN-108; ON-200). Dönem (takvim ayı)
 * onayı bordro **girdilerini** (ücret tanımları DOM-FIN-099, kurum bordro parametreleri
 * DOM-FIN-100) ve Kampüs'ün kayıtlı bordro hesabını (DOM-FIN-115; ADR 0011) dondurur: kilitli
 * ayda hesap yeniden kaydedilmez.
 *
 * - Durum: kaydı olmayan ay açıktır; onaylanan ay kilitlidir; yeniden açılan ay yeniden açıktır ve
 *   tekrar onaylanabilir (K-356). Onay anında girdi özeti (personel ve tanım sayısı, aylık brüt
 *   toplamı, aya aktarılan düzeltmeler, geçerli parametre seti) ve girdilerin özet damgası saklanır.
 * - Kilit (K-357): kilitli aya düşen gün aralığını değiştiren yazma 409 `payroll_period_locked`
 *   olur. Kural genel bir "gün aralığı kilitli aya değiyor mu" denetimidir
 *   (`assertPayrollDaysUnlocked`); ücret tanımı ve parametre seti yazmaları kendi etki aralığını
 *   (`payRate*Range`, `payrollParameterRange`) verir. İleri tarihli yeni tanım serbesttir.
 * - Düzeltme (K-358): kilitli ay değişmez; fark, ayın ardından gelen ilk açık aya aktarılacak
 *   düzeltme kaydı olarak yazılır (personel, kalem, işaretli fark tutarı, gerekçe).
 *
 * Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Bordro dönemi yalnız yöneticide (ücret verisiyle aynı, K-306, K-359). */
export const PAYROLL_PERIOD_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const PAYROLL_PERIOD_STATES = ['open', 'approved', 'reopened'] as const
export type PayrollPeriodState = (typeof PAYROLL_PERIOD_STATES)[number]
export const PAYROLL_PERIOD_STATE_LABELS = {
  open: 'Açık',
  approved: 'Onaylandı (kilitli)',
  reopened: 'Yeniden açıldı',
} as const satisfies Record<PayrollPeriodState, string>
/** Saklanan durumlar: açık ayın kaydı yoktur. */
export const STORED_PAYROLL_PERIOD_STATUSES = ['approved', 'reopened'] as const
export type StoredPayrollPeriodStatus = (typeof STORED_PAYROLL_PERIOD_STATUSES)[number]

export const PAYROLL_ADJUSTMENT_ITEMS = ['wage', 'lesson', 'benefit', 'deduction', 'other'] as const
export type PayrollAdjustmentItem = (typeof PAYROLL_ADJUSTMENT_ITEMS)[number]
export const PAYROLL_ADJUSTMENT_ITEM_LABELS = {
  wage: 'Ana ücret',
  lesson: 'Ek ders',
  benefit: 'Yan hak',
  deduction: 'Kesinti',
  other: 'Diğer',
} as const satisfies Record<PayrollAdjustmentItem, string>

export const PAYROLL_MIN_MONTH = '2020-01'
export const PAYROLL_MAX_MONTH = '2099-12'
export const PAYROLL_ADJUSTMENT_MAX_CENTS = 1_000_000_000
export const PAYROLL_REASON_MIN = 5
export const PAYROLL_REASON_MAX = 500
/** Girdi özeti damgası: SHA-256, onaltılık. */
export const PAYROLL_INPUTS_HASH_PATTERN = /^[0-9a-f]{64}$/

// --- Ay -----------------------------------------------------------------------------------------

const MONTH_PATTERN = /^20[2-9]\d-(0[1-9]|1[0-2])$/
const MONTH_NAMES = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
] as const

/** Bordro ayı (`YYYY-AA`, 2020-01…2099-12). */
export const payrollMonthSchema = z
  .string('Ay seçin.')
  .regex(MONTH_PATTERN, 'Ay YYYY-AA biçiminde olmalıdır (2020–2099).')

const parts = (month: string) => [Number(month.slice(0, 4)), Number(month.slice(5, 7))] as const
const monthText = (year: number, month: number) =>
  `${String(year)}-${String(month).padStart(2, '0')}`

/** Günün ayı. */
export const monthOfDay = (day: string) => day.slice(0, 7)
/** Ayın ilk günü. */
export const monthStart = (month: string) => `${month}-01`
/** Ayın son günü. */
export function monthEnd(month: string): string {
  const [year, index] = parts(month)
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10)
}
/** Sonraki ay. */
export function nextMonth(month: string): string {
  const [year, index] = parts(month)
  return index === 12 ? monthText(year + 1, 1) : monthText(year, index + 1)
}
/** "Ekim 2026". */
export function payrollMonthLabel(month: string): string {
  const [year, index] = parts(month)
  return `${MONTH_NAMES[index - 1] ?? month} ${String(year)}`
}
/** Yılın 12 ayı, ocaktan aralığa. */
export const payrollYearMonths = (year: number) =>
  Array.from({ length: 12 }, (_, index) => monthText(year, index + 1))

const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)

// --- Kilit ---------------------------------------------------------------------------------------

/** Gün aralığı (iki uç dahil); `to: null` süresizdir. */
export interface DayRange {
  from: string
  to: string | null
}

/** Ay onaylanmış (kilitli) mi. Bordroya girdi yazan her modül bu denetimi kullanır (K-357). */
export const isPayrollMonthLocked = (lockedMonths: readonly string[], month: string) =>
  lockedMonths.includes(month)

/** Aralığın değdiği kilitli aylar, artan. */
export function lockedMonthsIn(lockedMonths: readonly string[], range: DayRange): string[] {
  const first = monthOfDay(range.from)
  const last = range.to === null ? null : monthOfDay(range.to)
  return lockedMonths
    .filter((month) => month >= first && (last === null || month <= last))
    .sort((a, b) => a.localeCompare(b))
}

function lockedError(months: readonly string[], path: string) {
  const names = months.slice(0, 3).map(payrollMonthLabel).join(', ')
  const more = months.length > 3 ? ` ve ${String(months.length - 3)} ay daha` : ''
  return new DomainError(
    'payroll_period_locked',
    `Bu değişiklik onaylanmış bordro dönemine düşüyor (${names}${more}). Kilitli ay değiştirilemez; düzeltme kaydı girin ya da dönemi yeniden açın.`,
    { kind: 'conflict', path: [path] },
  )
}

/**
 * Genel kilit denetimi (K-357): aralıklardan biri kilitli bir aya değiyorsa 409
 * `payroll_period_locked`. Aralığı boş (`null`) olan yazma bir şey değiştirmez.
 */
export function assertPayrollDaysUnlocked(
  lockedMonths: readonly string[],
  ranges: readonly (DayRange | null)[],
  path = 'startDate',
): void {
  const touched = new Set<string>()
  for (const range of ranges)
    if (range !== null) for (const month of lockedMonthsIn(lockedMonths, range)) touched.add(month)
  if (touched.size > 0) throw lockedError([...touched].sort(), path)
}

const later = (a: string | null, b: string | null) =>
  a === null || b === null ? null : a > b ? a : b

/**
 * Yeni ücret tanımının etkisi: yeni tanımın aralığı ve kendiliğinden kapanan önceki tanımın
 * kaybettiği günler (yeni başlangıçtan eski bitişine). Geçmişe başlayan tanım kilitli aya düşer.
 */
export function payRateCreateRange(
  rate: { startDate: string; endDate: string | null },
  closedPreviousEnd: string | null | undefined,
): DayRange {
  return {
    from: rate.startDate,
    to: closedPreviousEnd === undefined ? rate.endDate : later(rate.endDate, closedPreviousEnd),
  }
}

/** Bitiş değişikliğinin etkisi: eski ve yeni bitiş arasındaki günler; aynı bitişte `null`. */
export function payRateEndRange(oldEnd: string | null, newEnd: string | null): DayRange | null {
  if (oldEnd === newEnd) return null
  const earlier =
    oldEnd === null ? newEnd : newEnd === null ? oldEnd : oldEnd < newEnd ? oldEnd : newEnd
  if (earlier === null) return null
  return { from: nextDay(earlier), to: later(oldEnd, newEnd) }
}

/**
 * İptalin etkisi: iptal edilen tanımın aralığı ve kapattığı önceki tanımın geri kazandığı günler
 * (iptal edilenin başlangıcından önceki tanımın eski bitişine).
 */
export function payRateCancelRange(
  rate: { startDate: string; endDate: string | null },
  reopenedPreviousEnd: string | null | undefined,
): DayRange {
  return payRateCreateRange(rate, reopenedPreviousEnd)
}

/**
 * Parametre setinin etki aralığı: yürürlük başlangıcından bir sonraki setin (platform ya da kurum,
 * değişen set hariç) başlangıcından bir gün öncesine. Oluşturma, düzeltme ve arşiv bu aralıkta
 * geçerli seti değiştirir; başlangıcı değişen düzeltmede eski ve yeni aralık birlikte denetlenir.
 */
export function payrollParameterRange(
  institutionSets: readonly PayrollInstitutionSet[],
  effectiveFrom: string,
  exceptId?: string,
  platform: readonly PayrollPlatformSet[] = PAYROLL_PLATFORM_DEFAULTS,
): DayRange {
  const timeline = payrollParameterTimeline(
    institutionSets.filter((set) => set.id !== exceptId),
    platform,
  )
  const next = timeline.find((set) => set.values.effectiveFrom > effectiveFrom)
  return {
    from: effectiveFrom,
    to: next === undefined ? null : previousDay(next.values.effectiveFrom),
  }
}

// --- Girdi özeti ----------------------------------------------------------------------------------

/** Özete giren ücret tanımı alanları (iptal edilmemiş). */
export interface PayrollSummaryRate {
  id: string
  membershipId: string
  component: PayRateComponent
  rateType: string
  amountCents: number
  startDate: string
  endDate: string | null
}

/** Aya aktarılan (hedef ayı bu ay olan, iptal edilmemiş) düzeltme. */
export interface PayrollSummaryAdjustment {
  id: string
  membershipId: string
  item: string
  amountCents: number
}

export interface PayrollInputSummary {
  /** Ayda en az bir günü yürürlükte tanımı olan personel sayısı. */
  staffCount: number
  /** Ayla kesişen tanım sayısı. */
  rateCount: number
  /** Personel başına ayda son başlayan aylık brüt ana ücretin toplamı, kuruş. */
  monthlyGrossTotalCents: number
  /** Bu aya aktarılan düzeltme sayısı ve işaretli toplamı. */
  adjustmentCount: number
  adjustmentTotalCents: number
  /** Ayın ilk günü geçerli parametre seti; tablodan önceki ayda `null`. */
  parameterSetId: string | null
  parameterEffectiveFrom: string | null
}

/**
 * Damgaya ek girdiler (K-426): ayın kesinti satırları (`payrollMonthDeductionSummary().digest`)
 * ve etkin kayıtlı bordro hesabının kimliği ile revizyonu. Boş olanlar damga kaynağına yazılmaz;
 * böylece kesintisi ve kayıtlı hesabı olmayan ayın damgası K-426 öncesiyle aynı kalır.
 */
export interface PayrollDigestExtras {
  deductions?: readonly (readonly (string | number | null)[])[]
  payrollRun?: { id: string; revision: number } | null
}

/**
 * Ayın girdi özeti ve damga kaynağı (K-356). Damga kaynağı ayla kesişen tanımların, aya aktarılan
 * düzeltmelerin ve geçerli parametre setinin değerlerini sıralı tutar; K-426 ile ayın kesinti
 * satırları ve kayıtlı bordro hesabının revizyonu da girer (`extras`). API bunu SHA-256 ile
 * damgalar. Onaydan sonra girdi değişirse damga değişir.
 */
export function payrollInputSummary(
  month: string,
  rates: readonly PayrollSummaryRate[],
  adjustments: readonly PayrollSummaryAdjustment[],
  institutionSets: readonly PayrollInstitutionSet[],
  platform: readonly PayrollPlatformSet[] = PAYROLL_PLATFORM_DEFAULTS,
  extras: PayrollDigestExtras = {},
): { summary: PayrollInputSummary; digestSource: string } {
  const start = monthStart(month)
  const end = monthEnd(month)
  const inMonth = rates
    .filter((rate) => rate.startDate <= end && (rate.endDate === null || rate.endDate >= start))
    .sort((a, b) => a.id.localeCompare(b.id))
  const grossByMember = new Map<string, PayrollSummaryRate>()
  for (const rate of inMonth) {
    if (rate.component !== 'wage' || rate.rateType !== 'monthly_gross') continue
    const current = grossByMember.get(rate.membershipId)
    if (current === undefined || rate.startDate > current.startDate)
      grossByMember.set(rate.membershipId, rate)
  }
  const ordered = [...adjustments].sort((a, b) => a.id.localeCompare(b.id))
  const parameter = effectivePayrollParameters(start, institutionSets, platform)
  const summary: PayrollInputSummary = {
    staffCount: new Set(inMonth.map((rate) => rate.membershipId)).size,
    rateCount: inMonth.length,
    monthlyGrossTotalCents: [...grossByMember.values()].reduce(
      (total, rate) => total + rate.amountCents,
      0,
    ),
    adjustmentCount: ordered.length,
    adjustmentTotalCents: ordered.reduce((total, item) => total + item.amountCents, 0),
    parameterSetId: parameter?.id ?? null,
    parameterEffectiveFrom: parameter?.values.effectiveFrom ?? null,
  }
  const digestSource = JSON.stringify({
    month,
    rates: inMonth.map((rate) => [
      rate.id,
      rate.membershipId,
      rate.component,
      rate.rateType,
      rate.amountCents,
      rate.startDate,
      rate.endDate,
    ]),
    adjustments: ordered.map((item) => [item.id, item.membershipId, item.item, item.amountCents]),
    parameters: parameter === null ? null : { id: parameter.id, values: parameter.values },
    // K-426: kesinti ve kayıtlı hesap yalnız varsa girer; ikisi de yoksa damga eskisiyle aynıdır.
    ...(extras.deductions === undefined || extras.deductions.length === 0
      ? {}
      : { deductions: extras.deductions }),
    ...(extras.payrollRun == null
      ? {}
      : { payrollRun: [extras.payrollRun.id, extras.payrollRun.revision] }),
  })
  return { summary, digestSource }
}

// --- Onay öncesi durum (K-425) --------------------------------------------------------------------

/** Ek ders çizelgesinin dönem satırındaki durumu: saat kaydı olmayan ay `none`. */
export const PAYROLL_LESSON_SHEET_CHECKS = ['none', 'draft', 'teacher_review', 'approved'] as const
export type PayrollLessonSheetCheck = (typeof PAYROLL_LESSON_SHEET_CHECKS)[number]
export const PAYROLL_LESSON_SHEET_CHECK_LABELS = {
  none: 'Ek ders yok',
  draft: 'Taslak',
  teacher_review: 'Öğretmen kontrolünde',
  approved: 'Onaylı',
} as const satisfies Record<PayrollLessonSheetCheck, string>

/** Kayıtlı bordro hesabının durumu: yok, güncel ya da girdiler değiştiği için güncel değil. */
export const PAYROLL_RUN_CHECKS = ['none', 'current', 'stale'] as const
export type PayrollRunCheck = (typeof PAYROLL_RUN_CHECKS)[number]
export const PAYROLL_RUN_CHECK_LABELS = {
  none: 'Kayıtlı hesap yok',
  current: 'Güncel',
  stale: 'Güncel değil',
} as const satisfies Record<PayrollRunCheck, string>

/** Onayı durduran engel ve uyarı kodları; engel varken onay düğmesi kapalıdır. */
export const PAYROLL_CHECK_BLOCKERS = ['payroll_lesson_hours_pending'] as const
export type PayrollCheckBlocker = (typeof PAYROLL_CHECK_BLOCKERS)[number]
export const PAYROLL_CHECK_WARNINGS = ['payroll_run_missing', 'payroll_run_stale'] as const
export type PayrollCheckWarning = (typeof PAYROLL_CHECK_WARNINGS)[number]
export const PAYROLL_CHECK_MESSAGES = {
  payroll_lesson_hours_pending:
    'Ek ders çizelgesi müdür onayı bekliyor. Önce çizelgeyi onaylayın ya da ödenmeyecek saatleri silin.',
  payroll_run_missing: 'Bu ay için kayıtlı bordro hesabı yok; onay yalnız girdileri kilitler.',
  payroll_run_stale:
    'Kayıtlı bordro hesabı güncel girdilerle tutmuyor. Onaydan önce bordro hesabını yeniden kaydedin.',
} as const satisfies Record<PayrollCheckBlocker | PayrollCheckWarning, string>

export interface PayrollPeriodChecksInput {
  lessonSheet: {
    status: Exclude<PayrollLessonSheetCheck, 'none'>
    entryCount: number
    pendingCount: number
  }
  /** Etkin kayıtlı hesap; `current` canlı hesabın tamamlanan satırları kayıtla aynıysa doğru. */
  payrollRun: { revision: number; calculatedAt: string; current: boolean } | null
  deductions: PayrollDeductionSummary
}

export interface PayrollPeriodChecks {
  lessonSheet: { state: PayrollLessonSheetCheck; entryCount: number; pendingCount: number }
  payrollRun: { state: PayrollRunCheck; revision: number | null; calculatedAt: string | null }
  deductions: PayrollDeductionSummary
  blockers: PayrollCheckBlocker[]
  warnings: PayrollCheckWarning[]
}

/**
 * Onay öncesi durum (K-425): ek ders çizelgesi, kayıtlı bordro hesabı ve ayın kesinti özeti.
 * Onay bekleyen ek ders saati engeldir (onay 409 `payroll_lesson_hours_pending` verirdi, K-424);
 * kayıtlı hesabın olmaması ya da güncel olmaması uyarıdır, onayı durdurmaz.
 */
export function payrollPeriodChecks(input: PayrollPeriodChecksInput): PayrollPeriodChecks {
  const { lessonSheet, payrollRun } = input
  const blockers: PayrollCheckBlocker[] = []
  const warnings: PayrollCheckWarning[] = []
  if (lessonSheet.pendingCount > 0) blockers.push('payroll_lesson_hours_pending')
  if (payrollRun === null) warnings.push('payroll_run_missing')
  else if (!payrollRun.current) warnings.push('payroll_run_stale')
  return {
    lessonSheet: {
      state: lessonSheet.entryCount === 0 ? 'none' : lessonSheet.status,
      entryCount: lessonSheet.entryCount,
      pendingCount: lessonSheet.pendingCount,
    },
    payrollRun: {
      state: payrollRun === null ? 'none' : payrollRun.current ? 'current' : 'stale',
      revision: payrollRun?.revision ?? null,
      calculatedAt: payrollRun?.calculatedAt ?? null,
    },
    deductions: input.deductions,
    blockers,
    warnings,
  }
}

/** Kayıtlı hesabın satırları canlı hesabın tamamlanan satırlarıyla aynı mı (anahtar sırası önemsiz). */
export function payrollRunRowsMatch(saved: readonly unknown[], live: readonly unknown[]): boolean {
  if (saved.length !== live.length) return false
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value
  const text = (rows: readonly unknown[]) =>
    rows.map((row) => JSON.stringify(canonical(row))).sort((a, b) => a.localeCompare(b))
  const left = text(saved)
  const right = text(live)
  return left.every((row, index) => row === right[index])
}

// --- Onay ve yeniden açma ------------------------------------------------------------------------

const reasonSchema = (label: string) =>
  z
    .string(`${label} yazın.`)
    .trim()
    .min(PAYROLL_REASON_MIN, `${label} en az ${String(PAYROLL_REASON_MIN)} karakterle yazın.`)
    .max(PAYROLL_REASON_MAX, `En fazla ${String(PAYROLL_REASON_MAX)} karakter girebilirsiniz.`)

/** Onay: kullanıcının gördüğü girdi özetinin damgası (gün sonu rapor damgası gibi). */
export const payrollApproveSchema = z.strictObject({
  inputsHash: z
    .string('Özeti yenileyip yeniden deneyin.')
    .regex(PAYROLL_INPUTS_HASH_PATTERN, 'Özeti yenileyip yeniden deneyin.')
    .describe('Ay listesinin `current.inputsHash` değeri; onaylanan girdiler bunlardır'),
})
export type PayrollApproveFields = z.output<typeof payrollApproveSchema>

/** Yeniden açma: gerekçe 5–500 karakter. */
export const payrollReopenSchema = z.strictObject({
  // kvkk: Ç
  reason: reasonSchema('Yeniden açma gerekçesini').describe(
    'Yeniden açma gerekçesi; dönem kaydında kalır, denetim kaydına yazılmaz',
  ),
})
export type PayrollReopenFields = z.output<typeof payrollReopenSchema>

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const conflictError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, {
    kind: 'conflict',
    ...(path === undefined ? {} : { path: [path] }),
  })

/** Dönemin saklanan durumu; açık ayın kaydı yoktur. */
export interface StoredPayrollPeriod {
  status: StoredPayrollPeriodStatus
}

export const payrollPeriodState = (stored: StoredPayrollPeriod | null): PayrollPeriodState =>
  stored?.status ?? 'open'

/**
 * Onay (K-356): başlamamış ay onaylanmaz (422 `payroll_period_in_future`); onaylı ay yeniden
 * onaylanmaz (409 `payroll_period_already_approved`); kullanıcının gördüğü damga güncel damgadan
 * farklıysa 409 `payroll_inputs_changed`.
 */
export function planPayrollApproval(
  month: string,
  today: string,
  stored: StoredPayrollPeriod | null,
  hashes: { expected: string; current: string },
): void {
  if (month > monthOfDay(today))
    throw ruleError('payroll_period_in_future', 'Henüz başlamamış ay onaylanamaz.', 'month')
  if (stored?.status === 'approved')
    throw conflictError('payroll_period_already_approved', 'Bu ay zaten onaylanmış.')
  if (hashes.expected !== hashes.current)
    throw conflictError(
      'payroll_inputs_changed',
      'Bordro girdileri siz bakarken değişti. Özeti yenileyip yeniden onaylayın.',
      'inputsHash',
    )
}

/**
 * Yeniden açma (K-356): yalnız onaylı ay (409 `payroll_period_not_approved`). Aydan çıkan
 * iptal edilmemiş düzeltme kaydı varsa açılmaz (422 `payroll_period_has_adjustments`): açılan ay
 * doğrudan düzeltilir, düzeltme kaydı farkı ikinci kez aktarırdı.
 */
export function planPayrollReopen<T extends StoredPayrollPeriod>(
  stored: T | null,
  adjustmentCount: number,
): T {
  if (stored === null || stored.status !== 'approved')
    throw conflictError('payroll_period_not_approved', 'Yalnız onaylanmış ay yeniden açılır.')
  if (adjustmentCount > 0)
    throw ruleError(
      'payroll_period_has_adjustments',
      'Bu aydan çıkan düzeltme kayıtları var. Dönemi açmadan önce düzeltme kayıtlarını iptal edin.',
    )
  return stored
}

// --- Düzeltme kaydı ------------------------------------------------------------------------------

const membershipSchema = z
  .string('Personel seçin.')
  .trim()
  .min(1, 'Personel seçin.')
  .max(100, 'Personel geçersiz.')

/** Düzeltme kaydı (K-358): personel, kalem, işaretli fark tutarı, gerekçe. */
export const payrollAdjustmentInputSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: membershipSchema.describe('Düzeltmenin yapıldığı personelin kurum üyeliği'),
  item: z
    .enum(PAYROLL_ADJUSTMENT_ITEMS, 'Kalemi seçin.')
    .describe(
      '`wage` ana ücret, `lesson` ek ders, `benefit` yan hak, `deduction` kesinti, `other`',
    ),
  // kvkk: K (ücret farkı)
  amountCents: z
    .number('Fark tutarını girin.')
    .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
    .refine((value) => value !== 0, 'Fark tutarı sıfır olamaz.')
    .refine(
      (value) => Math.abs(value) <= PAYROLL_ADJUSTMENT_MAX_CENTS,
      'Fark tutarı en fazla 10.000.000 ₺ olabilir.',
    )
    .describe('İşaretli fark, kuruş: artı personele ek ödeme, eksi fazla ödenenin geri alınması'),
  // kvkk: Ç
  reason: reasonSchema('Düzeltme gerekçesini').describe(
    'Düzeltme gerekçesi; denetim kaydına yazılmaz',
  ),
})
export type PayrollAdjustmentInput = z.input<typeof payrollAdjustmentInputSchema>
export type PayrollAdjustmentFields = z.output<typeof payrollAdjustmentInputSchema>

export const payrollAdjustmentCancelSchema = z.strictObject({
  reason: reasonSchema('İptal gerekçesini').describe('İptal gerekçesi; denetim kaydına yazılmaz'),
})
export type PayrollAdjustmentCancelFields = z.output<typeof payrollAdjustmentCancelSchema>

/**
 * Düzeltmenin aktarılacağı ay (K-358): kaynak aydan sonraki ilk kilitsiz ay. 2099-12'den sonrası
 * yoktur (409 `payroll_period_locked`).
 */
export function payrollAdjustmentTargetMonth(
  month: string,
  lockedMonths: readonly string[],
): string {
  let target = nextMonth(month)
  while (isPayrollMonthLocked(lockedMonths, target)) {
    if (target >= PAYROLL_MAX_MONTH) throw lockedError([target], 'month')
    target = nextMonth(target)
  }
  return target
}

/**
 * Düzeltme kaydı (K-358): yalnız onaylı (kilitli) ayda (422 `payroll_period_not_locked`; açık ayda
 * tanım doğrudan düzeltilir). Personel kurumun yönetici, öğretmen ya da ön büro üyeliğidir;
 * ayrılmış personele de girilir (son ay farkı).
 */
export function planPayrollAdjustment<T extends StoredPayrollPeriod>(
  month: string,
  stored: T | null,
  staff: { role: string } | null,
  lockedMonths: readonly string[],
): { period: T; targetMonth: string } {
  if (stored === null || stored.status !== 'approved')
    throw ruleError(
      'payroll_period_not_locked',
      'Düzeltme kaydı yalnız onaylanmış (kilitli) aya girilir; açık ayda ücret tanımını doğrudan düzeltin.',
    )
  if (staff === null)
    throw ruleError('payroll_adjustment_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(staff.role))
    throw ruleError(
      'payroll_adjustment_not_staff',
      'Düzeltme kaydı yalnız personele (yönetici, öğretmen, ön büro) girilir.',
      'membershipId',
    )
  return { period: stored, targetMonth: payrollAdjustmentTargetMonth(month, lockedMonths) }
}

/** İptal (K-358): aktarılacağı ay onaylandıysa düzeltme o ayın girdisidir, iptal edilmez (409). */
export function planPayrollAdjustmentCancel(
  adjustment: { targetMonth: string },
  lockedMonths: readonly string[],
): void {
  if (isPayrollMonthLocked(lockedMonths, adjustment.targetMonth))
    throw lockedError([adjustment.targetMonth], 'reason')
}

/** Ekran: işaretli tutarın yönü. */
export const adjustmentDirectionLabel = (amountCents: number) =>
  amountCents > 0 ? 'Ek ödeme' : 'Geri alınacak'
