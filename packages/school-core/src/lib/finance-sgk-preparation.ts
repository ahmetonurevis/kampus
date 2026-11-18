import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dateLabel, money } from './format.ts'
import {
  payRatesOn,
  type BenefitForm,
  type PayRateComponent,
  type PayRateType,
  type WageType,
  WAGE_TYPE_LABELS,
} from './finance-pay-rates.ts'
import { payrollDerivedValues, type PayrollEffectiveSet } from './finance-payroll-parameters.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * SGK bildirge hazırlık listesi (docs/domain/finans.md DOM-FIN-107; ON-203). Kampüs bordro
 * hesaplamaz ve resmî sisteme (GİB Muhtasar ve Prim Hizmet Beyannamesi, SGK e-Bildirge) hiçbir şey
 * göndermez (IST-143): ay için mali müşavire ya da bordrocuya kontrol listesi üretir.
 *
 * - Kapsam (K-352): ayda ana ücret tanımı (DOM-FIN-099) yürürlükte olan ya da o ay için elle satır
 *   (eksik gün, giriş/çıkış günü) girilmiş personel. Giriş ve çıkış günü ana ücret tanımlarının
 *   kesintisiz zincirinden gelir (ücret değişikliği giriş/çıkış sayılmaz); elle girilen gün
 *   önceliklidir. Kimlik numarası Kampüs'te tutulmaz, sütunu boştur.
 * - Prim günü (K-353): ayın tamamında çalışan 30 gün (28, 29 ve 31 çeken aylarda da); ay içi giriş
 *   ya da çıkışta çalışılan takvim günü (en çok 30); elle girilen eksik gün düşülür, 0'ın altına
 *   inmez. Birden fazla neden kodu birleşik koda döner.
 * - SGK'ya esas kazanç tahmini (K-354): (aylık brüt ana ücret + nakdi yan haklar) × prim günü / 30;
 *   ayni yan hak ve ek ders girmez. Taban ve tavan ayın ilk günündeki bordro parametre setinden
 *   (DOM-FIN-100), prim günüyle orantılıdır: tabanın altı tabana yükseltilir, tavanın üstü kesilir.
 *
 * Fonksiyonlar saftır. Değerler ve kod listesi **doğrulanmalıdır** (M-62, M-63; H-65, H-66).
 */

/** Liste ücret taşır: yalnız yönetici (K-355; DOM-FIN-099 K-306 ile aynı). */
export const SGK_PREPARATION_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** Aylık ücretlide tam ay prim günü (5510 md. 80; ay kaç gün çekerse çeksin). */
export const SGK_FULL_MONTH_DAYS = 30
export const SGK_MONTH_MIN = '2020-01'
export const SGK_MONTH_MAX = '2099-12'
export const SGK_NOTE_MAX = 200

/**
 * Eksik gün nedeni kodları (Muhtasar ve Prim Hizmet Beyannamesi eksik gün nedenleri; M-63).
 * Okulda karşılığı olmayan kodlar (ev hizmetleri 17, 5434 ek 76 22, yabancı uyruklu kısmi istihdam
 * 26, pandemi ücretsiz izni 28 ve 29) listede yoktur. Birleşik kodlar (12, 24, 27) elle seçilmez,
 * ayın satırlarından hesaplanır (`sgkReasonCodeFor`).
 */
export const SGK_MISSING_DAY_REASONS = [
  { code: '01', label: 'İstirahat' },
  { code: '03', label: 'Disiplin cezası' },
  { code: '04', label: 'Gözaltına alınma' },
  { code: '05', label: 'Tutukluluk' },
  { code: '06', label: 'Kısmi istihdam' },
  { code: '07', label: 'Puantaj kayıtları' },
  { code: '08', label: 'Grev' },
  { code: '09', label: 'Lokavt' },
  { code: '10', label: 'Genel hayatı etkileyen olaylar' },
  { code: '11', label: 'Doğal afet' },
  { code: '12', label: 'Birden fazla neden' },
  { code: '13', label: 'Diğer' },
  { code: '15', label: 'Devamsızlık' },
  { code: '16', label: 'Fesih tarihinde çalışmamış' },
  { code: '18', label: 'Kısa çalışma ödeneği' },
  { code: '19', label: 'Ücretsiz doğum izni' },
  { code: '20', label: 'Ücretsiz yol izni' },
  { code: '21', label: 'Diğer ücretsiz izin' },
  { code: '23', label: 'Yarım çalışma ödeneği' },
  { code: '24', label: 'Yarım çalışma ödeneği ve diğer nedenler' },
  { code: '25', label: 'Diğer belge/kanun türlerinden gün tamamlama' },
  { code: '27', label: 'Kısa çalışma ödeneği ve diğer nedenler' },
] as const
export type SgkReasonCode = (typeof SGK_MISSING_DAY_REASONS)[number]['code']
export const SGK_REASON_CODES = SGK_MISSING_DAY_REASONS.map(({ code }) => code) as [
  SgkReasonCode,
  ...SgkReasonCode[],
]
export const SGK_REASON_LABELS = Object.fromEntries(
  SGK_MISSING_DAY_REASONS.map(({ code, label }) => [code, label]),
) as Readonly<Record<SgkReasonCode, string>>

/** Birleşik kodlar: elle seçilmez, ayda birden fazla neden olunca hesaplanır. */
export const SGK_COMBINED_REASON_CODES = ['12', '24', '27'] as const
export type SgkSelectableReasonCode = Exclude<
  SgkReasonCode,
  (typeof SGK_COMBINED_REASON_CODES)[number]
>
export const SGK_SELECTABLE_REASON_CODES = SGK_REASON_CODES.filter(
  (code) => !(SGK_COMBINED_REASON_CODES as readonly string[]).includes(code),
) as [SgkSelectableReasonCode, ...SgkSelectableReasonCode[]]

/** "01 · İstirahat". */
export const sgkReasonLabel = (code: SgkReasonCode) => `${code} · ${SGK_REASON_LABELS[code]}`

/**
 * Ayın neden kodu (K-353): neden yoksa `null`, tek neden kendisi; birden fazla farklı nedende kısa
 * çalışma ödeneği (18) varsa 27, yarım çalışma ödeneği (23) varsa 24, yoksa 12.
 */
export function sgkReasonCodeFor(codes: readonly (SgkReasonCode | null)[]): SgkReasonCode | null {
  const distinct = [...new Set(codes.filter((code): code is SgkReasonCode => code !== null))]
  if (distinct.length === 0) return null
  if (distinct.length === 1) return distinct[0] ?? null
  if (distinct.includes('18')) return '27'
  if (distinct.includes('23')) return '24'
  return '12'
}

// --- Ay ------------------------------------------------------------------------------------------

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** `YYYY-MM`; 2020-01 ile 2099-12 arası. */
export const sgkMonthSchema = z
  .string('Ayı seçin.')
  .regex(MONTH_PATTERN, 'Ayı YYYY-AA biçiminde seçin.')
  .refine(
    (month) => !MONTH_PATTERN.test(month) || (month >= SGK_MONTH_MIN && month <= SGK_MONTH_MAX),
    'Ay 2020 ile 2099 yılları arasında olmalıdır.',
  )

export interface SgkMonthRange {
  month: string
  firstDay: string
  lastDay: string
  daysInMonth: number
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Ayın ilk ve son günü ve gün sayısı (takvim; saat dilimi yok). */
export function sgkMonthRange(month: string): SgkMonthRange {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return {
    month,
    firstDay: `${month}-01`,
    lastDay: `${month}-${pad(daysInMonth)}`,
    daysInMonth,
  }
}

/** `YYYY-MM` ayından önceki ay. */
export function previousSgkMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  return monthNumber === 1 ? `${String(year - 1)}-12` : `${String(year)}-${pad(monthNumber - 1)}`
}

const DAY_MS = 86_400_000
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / DAY_MS
/** İki gün arasındaki takvim günü (ikisi dahil). */
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from) + 1
const nextDay = (day: string) => new Date((dayNumber(day) + 1) * DAY_MS).toISOString().slice(0, 10)

/** "Kasım 2026". */
export const sgkMonthLabel = (month: string) =>
  dateLabel(`${month}-15T09:00:00.000Z`, { day: undefined, month: 'long', year: 'numeric' })
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

// --- Elle girilen satırlar -----------------------------------------------------------------------

const membershipSchema = z
  .string('Personel seçin.')
  .trim()
  .min(1, 'Personel seçin.')
  .max(100, 'Personel geçersiz.')
const noteSchema = z
  .string()
  .trim()
  .max(SGK_NOTE_MAX, `En fazla ${String(SGK_NOTE_MAX)} karakter girebilirsiniz.`)
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null)

/** Eksik gün satırı (K-353): gün 1–30, neden kodu isteğe bağlı (girilmezse uyarı). */
export const sgkMissingDayInputSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: membershipSchema.describe('Personelin kurum üyeliği'),
  month: sgkMonthSchema.describe('Ay (`YYYY-MM`)'),
  days: z
    .number('Eksik gün sayısını girin.')
    .int('Eksik gün tam sayı olmalıdır.')
    .min(1, 'Eksik gün en az 1 olmalıdır.')
    .max(SGK_FULL_MONTH_DAYS, 'Eksik gün en fazla 30 olabilir.')
    .describe('Eksik gün sayısı (1–30)'),
  // kvkk: K (eksik gün nedeni; 01 istirahat sağlık raporuna işaret eder, tanı yazılmaz)
  reasonCode: z
    .enum(SGK_SELECTABLE_REASON_CODES, 'Eksik gün nedenini listeden seçin.')
    .nullable()
    .default(null)
    .describe('Eksik gün nedeni kodu; boşsa listede "neden girilmemiş" uyarısı çıkar'),
  note: noteSchema.describe('İsteğe bağlı not, en çok 200 karakter; tanı yazılmaz'),
})
export type SgkMissingDayInput = z.input<typeof sgkMissingDayInputSchema>
export type SgkMissingDayFields = z.output<typeof sgkMissingDayInputSchema>

/** Elle giriş/çıkış günü (K-352): en az biri; ikisi de ayın içinde, çıkış girişten önce olamaz. */
export const sgkEmploymentDatesInputSchema = z
  .strictObject({
    // kvkk: K (personel üyeliği)
    membershipId: membershipSchema.describe('Personelin kurum üyeliği'),
    month: sgkMonthSchema.describe('Ay (`YYYY-MM`)'),
    entryDate: daySchema.nullable().default(null).describe('İşe giriş günü (ayın içinde)'),
    exitDate: daySchema.nullable().default(null).describe('İşten çıkış günü (ayın içinde)'),
    note: noteSchema.describe('İsteğe bağlı not, en çok 200 karakter'),
  })
  .superRefine((value, context) => {
    if (value.entryDate === null && value.exitDate === null) {
      context.addIssue({
        code: 'custom',
        path: ['entryDate'],
        message: 'Giriş ya da çıkış gününden en az birini girin.',
      })
      return
    }
    if (!MONTH_PATTERN.test(value.month)) return
    for (const key of ['entryDate', 'exitDate'] as const) {
      const day = value[key]
      if (day !== null && day.slice(0, 7) !== value.month)
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Gün seçilen ayın içinde olmalıdır.',
        })
    }
    if (value.entryDate !== null && value.exitDate !== null && value.exitDate < value.entryDate)
      context.addIssue({
        code: 'custom',
        path: ['exitDate'],
        message: 'Çıkış günü giriş gününden önce olamaz.',
      })
  })
export type SgkEmploymentDatesInput = z.input<typeof sgkEmploymentDatesInputSchema>
export type SgkEmploymentDatesFields = z.output<typeof sgkEmploymentDatesInputSchema>

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

/** Elle satırın personeli: kurumda olmalı ve personel (yönetici, öğretmen, ön büro) olmalı. */
export function assertSgkStaff(staff: { role: string } | null): void {
  if (staff === null) throw ruleError('sgk_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(staff.role))
    throw ruleError(
      'sgk_not_staff',
      'Bu liste yalnız personel (yönetici, öğretmen, ön büro) içindir.',
      'membershipId',
    )
}

/** Ayın eksik gün toplamı 30'u aşamaz (K-353). */
export function planSgkMissingDays(
  input: Pick<SgkMissingDayFields, 'days'>,
  checks: { staff: { role: string } | null; enteredDays: number },
): void {
  assertSgkStaff(checks.staff)
  if (checks.enteredDays + input.days > SGK_FULL_MONTH_DAYS)
    throw ruleError(
      'sgk_missing_days_exceed_month',
      `Bu ay için ${String(checks.enteredDays)} eksik gün girilmiş; ayın toplamı 30 günü aşamaz.`,
      'days',
    )
}

/** Personelin ayda tek etkin giriş/çıkış satırı olur; önce mevcut satır kaldırılır (409). */
export function planSgkEmploymentDates(checks: {
  staff: { role: string } | null
  exists: boolean
}): void {
  assertSgkStaff(checks.staff)
  if (checks.exists)
    throw new DomainError(
      'sgk_employment_dates_exist',
      'Bu personelin bu ay için giriş/çıkış günü zaten girilmiş; önce mevcut satırı kaldırın.',
      { kind: 'conflict', path: ['membershipId'] },
    )
}

// --- Liste ---------------------------------------------------------------------------------------

export const SGK_WARNINGS = [
  'below_floor',
  'above_ceiling',
  'missing_reason',
  'entry_in_month',
  'exit_in_month',
  'missing_days_exceed',
  'no_wage',
  'wage_not_monthly_gross',
  'wage_changed',
  'pay_rate_gap',
  'lesson_pay_excluded',
] as const
export type SgkWarning = (typeof SGK_WARNINGS)[number]
export const SGK_WARNING_LABELS = {
  below_floor: 'Tabanın altında ücret: SGK matrahı tabana yükseltildi',
  above_ceiling: 'Tavan aşımı: SGK matrahı tavanda kesildi',
  missing_reason: 'Eksik gün nedeni girilmemiş',
  entry_in_month: 'Ay içinde işe giriş',
  exit_in_month: 'Ay içinde işten çıkış',
  missing_days_exceed: 'Eksik gün çalışılan günü aşıyor',
  no_wage: 'Ayda ana ücret tanımı yok',
  wage_not_monthly_gross: 'Ana ücret aylık brüt değil: SGK matrahı tahmin edilmedi',
  wage_changed: 'Ay içinde ücret değişti: son çalışılan günün ücreti alındı',
  pay_rate_gap: 'Ay içinde ücret tanımı olmayan gün var',
  lesson_pay_excluded: 'Ek ders ücreti tanımlı: matraha eklenmedi (çizelge yok)',
} as const satisfies Record<SgkWarning, string>

/** Hesap girdisi: personel üyeliği (pasif dahil). */
export interface SgkMember {
  membershipId: string
  name: string
  role: string
  active: boolean
}

/** Ücret tanımının listede kullanılan alanları (DOM-FIN-099). */
export interface SgkPayRate {
  id: string
  membershipId: string
  component: PayRateComponent
  rateType: PayRateType
  amountCents: number
  benefitForm: BenefitForm | null
  startDate: string
  endDate: string | null
}

export interface SgkMissingDayEntry {
  id: string
  membershipId: string
  days: number
  reasonCode: SgkReasonCode | null
  note: string | null
  version: number
  createdAt: string
}

export interface SgkEmploymentDatesEntry {
  id: string
  membershipId: string
  entryDate: string | null
  exitDate: string | null
  note: string | null
  version: number
  createdAt: string
}

/** Ayın ilk günündeki bordro parametresinden türetilen aylık taban ve tavan (DOM-FIN-100). */
export interface SgkParameters {
  effectiveFrom: string
  origin: 'platform' | 'institution'
  stale: boolean
  unverified: boolean
  minimumWageGrossCents: number
  floorCents: number
  ceilingCents: number
}

export interface SgkPreparationRow {
  membershipId: string
  name: string
  role: string
  active: boolean
  /** Ay içindeyse işe giriş günü ve kaynağı. */
  entryDate: string | null
  entrySource: 'pay_rate' | 'manual' | null
  exitDate: string | null
  exitSource: 'pay_rate' | 'manual' | null
  /** Eksik gün düşülmeden önceki gün: tam ayda 30, ay içi giriş/çıkışta takvim günü (en çok 30). */
  baseDays: number
  missingDays: number
  primDays: number
  reasonCode: SgkReasonCode | null
  /** Son çalışılan günde yürürlükteki ana ücret. */
  wage: { rateType: WageType; amountCents: number; startDate: string } | null
  cashBenefitsCents: number
  /** Prim günüyle orantılı taban ve tavan. */
  floorCents: number
  ceilingCents: number
  /** Tabana yükseltilmiş, tavanda kesilmiş tahmin; aylık brüt ana ücret yoksa `null`. */
  sgkBaseCents: number | null
  warnings: SgkWarning[]
  missingDayEntries: SgkMissingDayEntry[]
  employmentDates: SgkEmploymentDatesEntry | null
}

export interface SgkPreparationTotals {
  staffCount: number
  primDays: number
  missingDays: number
  sgkBaseCents: number
  /** Matrahı tahmin edilemeyen satır sayısı (toplama girmez). */
  unestimatedCount: number
  warningRowCount: number
}

export interface SgkPreparationList extends SgkMonthRange {
  parameters: SgkParameters
  rows: SgkPreparationRow[]
  totals: SgkPreparationTotals
}

const isWage = (rate: SgkPayRate) => rate.component === 'wage'
const overlaps = (rate: { startDate: string; endDate: string | null }, from: string, to: string) =>
  rate.startDate <= to && (rate.endDate === null || rate.endDate >= from)

/**
 * Ana ücret tanımlarının kesintisiz aralıkları (bir tanımın bitişinin ertesi günü sonrakinin
 * başlangıcıysa birleşir). Yuvada aralıklar çakışmaz (K-304).
 */
export function wageSpans(rates: readonly SgkPayRate[]): { from: string; to: string | null }[] {
  const sorted = rates.filter(isWage).sort((a, b) => a.startDate.localeCompare(b.startDate))
  const spans: { from: string; to: string | null }[] = []
  for (const rate of sorted) {
    const last = spans.at(-1)
    if (last && last.to !== null && nextDay(last.to) === rate.startDate) last.to = rate.endDate
    else spans.push({ from: rate.startDate, to: rate.endDate })
  }
  return spans
}

/** Prim günü tabanı (K-353): ayın ilk ve son günü dahilse 30, değilse takvim günü (en çok 30). */
export function sgkBaseDays(range: SgkMonthRange, from: string, to: string): number {
  if (to < from) return 0
  if (from === range.firstDay && to === range.lastDay) return SGK_FULL_MONTH_DAYS
  return Math.min(SGK_FULL_MONTH_DAYS, daysBetween(from, to))
}

const prorate = (monthlyCents: number, days: number) =>
  Math.round((monthlyCents * days) / SGK_FULL_MONTH_DAYS)

interface RowInput {
  member: SgkMember
  rates: readonly SgkPayRate[]
  missing: readonly SgkMissingDayEntry[]
  dates: SgkEmploymentDatesEntry | null
}

function buildRow(
  range: SgkMonthRange,
  parameters: SgkParameters,
  input: RowInput,
): SgkPreparationRow {
  const { member, rates, missing, dates } = input
  const warnings = new Set<SgkWarning>()
  const spans = wageSpans(rates).filter((span) =>
    overlaps({ startDate: span.from, endDate: span.to }, range.firstDay, range.lastDay),
  )
  const first = spans[0]
  const last = spans.at(-1)
  // Ücret tanımı zinciri ayın içinde başlıyor ya da bitiyorsa giriş/çıkıştır.
  const derivedEntry = first && first.from > range.firstDay ? first.from : null
  const derivedExit = last && last.to !== null && last.to < range.lastDay ? last.to : null
  const entryDate = dates?.entryDate ?? derivedEntry
  const exitDate = dates?.exitDate ?? derivedExit
  const from = entryDate ?? range.firstDay
  const to = exitDate ?? range.lastDay
  if (spans.length === 0) warnings.add('no_wage')
  else {
    // Aralıkta tanımsız gün: zincirde boşluk ya da elle gün tanımın dışına taşıyor.
    let covered = 0
    for (const span of spans) {
      const start = span.from > from ? span.from : from
      const end = span.to === null || span.to > to ? to : span.to
      if (end >= start) covered += daysBetween(start, end)
    }
    if (to >= from && covered < daysBetween(from, to)) warnings.add('pay_rate_gap')
  }
  if (entryDate !== null) warnings.add('entry_in_month')
  if (exitDate !== null) warnings.add('exit_in_month')

  const baseDays = sgkBaseDays(range, from, to)
  const missingDays = missing.reduce((total, entry) => total + entry.days, 0)
  if (missingDays > baseDays) warnings.add('missing_days_exceed')
  if (missing.some((entry) => entry.reasonCode === null)) warnings.add('missing_reason')
  const primDays = Math.max(0, baseDays - missingDays)

  // Son çalışılan günün ücreti; o gün tanım yoksa aralıktaki en geç ana ücret ve onun son günü.
  const inRange = rates.filter((rate) => overlaps(rate, from, to))
  const wageRates = inRange.filter(isWage)
  const lastWorked = to >= from ? to : range.lastDay
  const wageOnLast = payRatesOn(rates, lastWorked).find(isWage) ?? null
  const wageRate =
    wageOnLast ??
    wageRates.reduce<SgkPayRate | null>(
      (latest, rate) => (latest === null || rate.startDate > latest.startDate ? rate : latest),
      null,
    )
  if (wageRates.length > 1) warnings.add('wage_changed')
  const rateDay =
    wageOnLast === null && wageRate !== null ? (wageRate.endDate ?? lastWorked) : lastWorked
  const cashBenefitsCents = payRatesOn(rates, rateDay)
    .filter((rate) => rate.component === 'benefit' && rate.benefitForm === 'cash')
    .reduce((total, rate) => total + rate.amountCents, 0)
  if (inRange.some((rate) => rate.component === 'lesson')) warnings.add('lesson_pay_excluded')

  const floorCents = prorate(parameters.floorCents, primDays)
  const ceilingCents = prorate(parameters.ceilingCents, primDays)
  let sgkBaseCents: number | null = null
  if (wageRate !== null && wageRate.rateType !== 'monthly_gross')
    warnings.add('wage_not_monthly_gross')
  else if (wageRate !== null) {
    const raw = prorate(wageRate.amountCents + cashBenefitsCents, primDays)
    if (primDays > 0 && raw < floorCents) warnings.add('below_floor')
    if (primDays > 0 && raw > ceilingCents) warnings.add('above_ceiling')
    sgkBaseCents = Math.min(Math.max(raw, floorCents), ceilingCents)
  }

  return {
    membershipId: member.membershipId,
    name: member.name,
    role: member.role,
    active: member.active,
    entryDate,
    entrySource: entryDate === null ? null : dates?.entryDate ? 'manual' : 'pay_rate',
    exitDate,
    exitSource: exitDate === null ? null : dates?.exitDate ? 'manual' : 'pay_rate',
    baseDays,
    missingDays,
    primDays,
    reasonCode: sgkReasonCodeFor(missing.map((entry) => entry.reasonCode)),
    wage:
      wageRate === null
        ? null
        : {
            rateType: wageRate.rateType as WageType,
            amountCents: wageRate.amountCents,
            startDate: wageRate.startDate,
          },
    cashBenefitsCents,
    floorCents,
    ceilingCents,
    sgkBaseCents,
    warnings: SGK_WARNINGS.filter((code) => warnings.has(code)),
    missingDayEntries: [...missing].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    employmentDates: dates,
  }
}

/**
 * Ayın listesi (DOM-FIN-107). Personel: ayda ana ücret tanımı olan ya da elle satırı bulunan
 * üyelikler; ada göre (Türkçe sıralama). `members` bu üyelikleri, `rates` onların iptal edilmemiş
 * bütün tanımlarını (ay dışı dahil; zincir için), `missing` ve `dates` ayın etkin elle satırlarını
 * taşır.
 */
export function sgkPreparationList(input: {
  month: string
  parameters: SgkParameters
  members: readonly SgkMember[]
  rates: readonly SgkPayRate[]
  missing: readonly SgkMissingDayEntry[]
  dates: readonly SgkEmploymentDatesEntry[]
}): SgkPreparationList {
  const range = sgkMonthRange(input.month)
  const group = <T extends { membershipId: string }>(items: readonly T[]) => {
    const map = new Map<string, T[]>()
    for (const item of items)
      map.set(item.membershipId, [...(map.get(item.membershipId) ?? []), item])
    return map
  }
  const ratesBy = group(input.rates)
  const missingBy = group(input.missing)
  const datesBy = new Map(input.dates.map((entry) => [entry.membershipId, entry]))
  const rows = input.members
    .filter((member) => {
      const own = ratesBy.get(member.membershipId) ?? []
      return (
        own.some((rate) => isWage(rate) && overlaps(rate, range.firstDay, range.lastDay)) ||
        missingBy.has(member.membershipId) ||
        datesBy.has(member.membershipId)
      )
    })
    .map((member) =>
      buildRow(range, input.parameters, {
        member,
        rates: ratesBy.get(member.membershipId) ?? [],
        missing: missingBy.get(member.membershipId) ?? [],
        dates: datesBy.get(member.membershipId) ?? null,
      }),
    )
    .sort(
      (a, b) => a.name.localeCompare(b.name, 'tr') || a.membershipId.localeCompare(b.membershipId),
    )
  return { ...range, parameters: input.parameters, rows, totals: sgkPreparationTotals(rows) }
}

export function sgkPreparationTotals(rows: readonly SgkPreparationRow[]): SgkPreparationTotals {
  return {
    staffCount: rows.length,
    primDays: rows.reduce((total, row) => total + row.primDays, 0),
    missingDays: rows.reduce((total, row) => total + row.missingDays, 0),
    sgkBaseCents: rows.reduce((total, row) => total + (row.sgkBaseCents ?? 0), 0),
    unestimatedCount: rows.filter((row) => row.sgkBaseCents === null).length,
    warningRowCount: rows.filter((row) => row.warnings.length > 0).length,
  }
}

// --- Gösterim ve dışa aktarım ---------------------------------------------------------------------

/** Ekranın, CSV'nin ve PDF'in altındaki ilke notu (IST-143). */
export const SGK_PREPARATION_NOTE =
  'Bu liste resmî bildirge değildir ve hiçbir resmî sisteme gönderilmez. Muhtasar ve Prim Hizmet Beyannamesi mali müşavir ya da bordrocu tarafından verilir; prim günü ve SGK matrahı tahminidir, bordroyla karşılaştırın.'

/** "3 Kas 2026 (ücret tanımı)" ya da boş. */
export function sgkDateText(day: string | null, source: 'pay_rate' | 'manual' | null): string {
  if (day === null) return ''
  return `${dayText(day)} (${source === 'manual' ? 'elle' : 'ücret tanımı'})`
}

/** Tanımlı ücret: "Aylık brüt 45.000,00 ₺" ya da "Tanım yok". */
export const sgkWageText = (wage: SgkPreparationRow['wage']) =>
  wage === null ? 'Tanım yok' : `${WAGE_TYPE_LABELS[wage.rateType]} ${money(wage.amountCents)}`

export const sgkBaseText = (row: Pick<SgkPreparationRow, 'sgkBaseCents'>) =>
  row.sgkBaseCents === null ? 'Tahmin yok' : money(row.sgkBaseCents)

export const sgkReasonText = (code: SgkReasonCode | null) =>
  code === null ? '' : sgkReasonLabel(code)

const CSV_HEADER = [
  'Ad soyad',
  'T.C. kimlik no',
  'Rol',
  'İşe giriş günü',
  'Giriş kaynağı',
  'İşten çıkış günü',
  'Çıkış kaynağı',
  'Prim günü',
  'Eksik gün',
  'Eksik gün nedeni kodu',
  'Eksik gün nedeni',
  'Ana ücret türü',
  'Tanımlı ücret',
  'Nakdi yan haklar (aylık)',
  'SGK taban (gün oranlı)',
  'SGK tavan (gün oranlı)',
  'SGK matrahı tahmini',
  'Uyarılar',
]
const SOURCE_LABELS = { pay_rate: 'Ücret tanımı', manual: 'Elle' } as const
const ROLE_LABELS: Readonly<Record<string, string>> = {
  yonetici: 'Yönetici',
  ogretmen: 'Öğretmen',
  onburo: 'Ön büro',
}
export const sgkRoleLabel = (role: string) => ROLE_LABELS[role] ?? role

/**
 * CSV (K-355): personel başına bir satır, `;` ayırıcı, ondalık virgül, formül kaçışı; kimlik
 * numarası sütunu boştur. Son satırlar toplam ve ilke notudur. BOM'u uç ekler.
 */
export function sgkPreparationCsv(list: Pick<SgkPreparationList, 'rows' | 'totals'>): string {
  const blank = csvCell('')
  const rows = list.rows.map((row) => [
    csvCell(row.name),
    blank,
    csvCell(sgkRoleLabel(row.role)),
    csvCell(row.entryDate ?? ''),
    csvCell(row.entrySource === null ? '' : SOURCE_LABELS[row.entrySource]),
    csvCell(row.exitDate ?? ''),
    csvCell(row.exitSource === null ? '' : SOURCE_LABELS[row.exitSource]),
    csvCell(row.primDays),
    csvCell(row.missingDays),
    csvCell(row.reasonCode ?? ''),
    csvCell(row.reasonCode === null ? '' : SGK_REASON_LABELS[row.reasonCode]),
    csvCell(row.wage === null ? '' : WAGE_TYPE_LABELS[row.wage.rateType]),
    row.wage === null ? blank : csvAmount(row.wage.amountCents),
    csvAmount(row.cashBenefitsCents),
    csvAmount(row.floorCents),
    csvAmount(row.ceilingCents),
    row.sgkBaseCents === null ? blank : csvAmount(row.sgkBaseCents),
    csvCell(row.warnings.map((code) => SGK_WARNING_LABELS[code]).join(' | ')),
  ])
  const filler = (count: number) => Array<string>(count).fill(blank)
  const total = [
    csvCell('Toplam'),
    blank,
    csvCell(`${String(list.totals.staffCount)} personel`),
    ...filler(4),
    csvCell(list.totals.primDays),
    csvCell(list.totals.missingDays),
    ...filler(7),
    csvAmount(list.totals.sgkBaseCents),
    csvCell(
      list.totals.unestimatedCount === 0
        ? ''
        : `${String(list.totals.unestimatedCount)} personelin matrahı tahmin edilmedi`,
    ),
  ]
  const note = [csvCell(SGK_PREPARATION_NOTE), ...filler(CSV_HEADER.length - 1)]
  return [CSV_HEADER.map(csvCell), ...rows, total, note]
    .map((row) => row.join(CSV_SEPARATOR))
    .join('\r\n')
}

export const sgkPreparationFilename = (month: string, extension: 'csv' | 'pdf') =>
  `sgk-hazirlik-listesi-${month}.${extension}`

/** Ayın ilk günündeki bordro parametre setinden aylık taban ve tavan (DOM-FIN-100, K-354). */
export function sgkParametersFrom(set: PayrollEffectiveSet): SgkParameters {
  const derived = payrollDerivedValues(set.values)
  return {
    effectiveFrom: set.values.effectiveFrom,
    origin: set.origin,
    stale: set.stale,
    unverified: set.unverifiedFields.some(
      (field) =>
        field === 'minimumWageGrossCents' ||
        field === 'sgkFloorMultiplierBasisPoints' ||
        field === 'sgkCeilingMultiplierBasisPoints',
    ),
    minimumWageGrossCents: set.values.minimumWageGrossCents,
    floorCents: derived.sgkFloorCents,
    ceilingCents: derived.sgkCeilingCents,
  }
}
