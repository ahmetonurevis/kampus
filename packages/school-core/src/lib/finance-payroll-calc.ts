import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { DomainError } from './errors.ts'
import {
  BENEFIT_TYPE_LABELS,
  LESSON_PAY_TYPE_LABELS,
  WAGE_TYPE_LABELS,
  type BenefitType,
  type LessonPayType,
  type WageType,
} from './finance-pay-rates.ts'
import {
  BASIS_POINTS_SCALE,
  PAYROLL_PLATFORM_DEFAULTS,
  STAMP_TAX_SCALE,
  effectivePayrollParameters,
  payrollDerivedValues,
  type IncomeTaxBracket,
  type PayrollEffectiveSet,
  type PayrollInstitutionSet,
  type PayrollParameterValues,
  type PayrollPlatformSet,
} from './finance-payroll-parameters.ts'
import {
  PAYROLL_ADJUSTMENT_ITEM_LABELS,
  type PayrollAdjustmentItem,
} from './finance-payroll-periods.ts'
import {
  SGK_FULL_MONTH_DAYS,
  daysBetween,
  sgkMonthRange,
  sgkProrate,
  sgkWorkDays,
  type SgkEmploymentDatesEntry,
  type SgkMissingDayEntry,
  type SgkMonthRange,
  type SgkPayRate,
  type SgkWarning,
} from './finance-sgk-preparation.ts'
import {
  monthlyDeductions,
  type MonthlyDeductionLine,
  type MonthlyDeductionSources,
} from './finance-staff-deductions.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Bordro ön hesabı (docs/domain/finans.md DOM-FIN-115; ON-198). Kampüs bordroyu kendisi hesaplar
 * (ON-193 kullanıcı kararı, ADR `docs/adr/0011-bordro-hesabi.md`): personel × ay için brütten nete,
 * kümülatif gelir vergisi matrahı, asgari ücret istisnaları, kesintiler (DOM-FIN-101) ve işveren
 * maliyeti. Hesap **doğrulanmalıdır** (mali müşavir; M-75, M-76, M-77).
 *
 * - Girdiler: ayın ilk günü geçerli bordro parametre seti (DOM-FIN-100), ücret tanımları
 *   (DOM-FIN-099), prim günü SGK hazırlık listesinin ortak fonksiyonuyla (`sgkWorkDays`,
 *   DOM-FIN-107), elle ek ders saatleri (DOM-FIN-105), aya aktarılan düzeltmeler (DOM-FIN-108),
 *   avans/icra/BES kayıtları (DOM-FIN-101), sağlık raporu günleri (DOM-FIN-110; yalnız uyarı).
 * - Kalemler (K-387): aylık brüt ana ücret gün oranlı; ek ders saat × ücret; nakdi yan hak SGK
 *   matrahına girer, vergiye tabi işaretliyse gelir ve damga vergisi matrahına da; ayni yan hak
 *   ödenmez, işveren maliyetine eklenir. Saatlik ve ders saati ana ücreti hesaplanmaz (satır eksik).
 * - Vergi (K-388): kümülatif matrah yıl başından önceki ayların **kayıtlı** hesabından ve elle
 *   devirden gelir; asgari ücret istisnası asgari ücretin yıl başından kümülatif matrahıyla.
 * - Net ücretli tanımda brüt ters hesapla bulunur (K-389); yuvarlama K-390.
 *
 * Fonksiyonlar saftır; girdiler servisin yüklediği satırlardır.
 */

/** Ücret verisi yalnız yöneticide (K-306, K-391). */
export const PAYROLL_CALC_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const PAYROLL_CARRYOVER_NOTE_MAX = 200
export const PAYROLL_CARRYOVER_MAX_CENTS = 100_000_000_000
const PAYROLL_CALC_MIN_YEAR = 2020
const PAYROLL_CALC_MAX_YEAR = 2099

/** Ekranda, CSV'de ve kayıtta görünen ilke notu. */
export const PAYROLL_CALC_NOTE =
  'Bordro ön hesabıdır; değerler mali müşavir doğrulaması bekliyor. Resmî beyanname ve bildirge Kampüs dışında verilir.'

// --- Ay ve şemalar ------------------------------------------------------------------------------

const MONTH_PATTERN = /^20[2-9]\d-(0[1-9]|1[0-2])$/

/** Bordro ayı (`YYYY-AA`, 2020–2099). */
export const payrollCalcMonthSchema = z
  .string('Ayı seçin.')
  .regex(MONTH_PATTERN, 'Ayı YYYY-AA biçiminde seçin (2020–2099).')
  .describe('Bordro ayı (YYYY-AA)')

/**
 * Hesabı kaydet ya da yeniden hesapla (K-391): kullanıcının gördüğü kayıtlı hesabın kimliği (kayıt
 * yoksa `null`). Bu arada başka biri kaydettiyse 409 `payroll_run_changed`.
 */
export const payrollRunSaveSchema = z.strictObject({
  previousRunId: z
    .uuid('Hesap kimliği geçersiz.')
    .nullable()
    .describe('Ekranda görülen kayıtlı hesabın kimliği; ilk kayıtta `null`'),
})
export type PayrollRunSaveFields = z.output<typeof payrollRunSaveSchema>

/**
 * Kümülatif gelir vergisi matrahı devri (K-388): yıl içinde başka işyerinden gelen personelin o yıl
 * önceki işverende oluşan kümülatif matrahı ya da Kampüs öncesi açılış bakiyesi. Personel × yıl
 * başına tek etkin kayıt; düzeltilmez, kaldırılıp yeniden girilir.
 */
export const payrollTaxCarryoverInputSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .describe('Personelin kurum üyeliği'),
  year: z
    .number('Yılı girin.')
    .int('Yıl tam sayı olmalıdır.')
    .min(PAYROLL_CALC_MIN_YEAR, 'Yıl 2020 ile 2099 arasında olmalıdır.')
    .max(PAYROLL_CALC_MAX_YEAR, 'Yıl 2020 ile 2099 arasında olmalıdır.')
    .describe('Devrin yılı'),
  // kvkk: K (ücret)
  incomeTaxBaseCents: z
    .number('Matrahı girin.')
    .int('Matrah kuruş cinsinden tam sayı olmalıdır.')
    .min(1, 'Matrah sıfırdan büyük olmalıdır.')
    .max(PAYROLL_CARRYOVER_MAX_CENTS, 'Matrah en fazla 1.000.000.000 ₺ olabilir.')
    .describe('Yıl başından devralınan kümülatif gelir vergisi matrahı, kuruş'),
  note: z
    .string()
    .trim()
    .max(PAYROLL_CARRYOVER_NOTE_MAX, 'En fazla 200 karakter girebilirsiniz.')
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)
    .describe('İsteğe bağlı kaynak notu (ör. önceki işyeri bordrosu), en çok 200 karakter'),
})
export type PayrollTaxCarryoverInput = z.input<typeof payrollTaxCarryoverInputSchema>
export type PayrollTaxCarryoverFields = z.output<typeof payrollTaxCarryoverInputSchema>

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

/** Devir (K-388): personel kurumun yönetici, öğretmen ya da ön büro üyeliği; yılda tek kayıt (409). */
export function planPayrollTaxCarryover(checks: {
  staff: { role: string } | null
  exists: boolean
}): void {
  if (checks.staff === null)
    throw ruleError('payroll_carryover_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(checks.staff.role))
    throw ruleError(
      'payroll_carryover_not_staff',
      'Matrah devri yalnız personele (yönetici, öğretmen, ön büro) girilir.',
      'membershipId',
    )
  if (checks.exists)
    throw new DomainError(
      'payroll_carryover_exists',
      'Bu personelin bu yıl için matrah devri var; önce mevcut kaydı kaldırın.',
      { kind: 'conflict', path: ['year'] },
    )
}

/**
 * Kaydetme (K-391): kilitli ay `assertPayrollDaysUnlocked` ile 409 olur (servis); ekranda görülen
 * kayıtlı hesap güncel değilse 409 `payroll_run_changed`; hesaplanabilen satır yoksa 422.
 */
export function planPayrollRunSave(
  input: PayrollRunSaveFields,
  current: { id: string } | null,
  completeRows: number,
): void {
  if ((current?.id ?? null) !== input.previousRunId)
    throw new DomainError(
      'payroll_run_changed',
      'Bu ayın bordro hesabı siz bakarken yeniden kaydedildi. Sayfayı yenileyip tekrar deneyin.',
      { kind: 'conflict', path: ['previousRunId'] },
    )
  if (completeRows === 0)
    throw ruleError(
      'payroll_run_empty',
      'Bu ay hesaplanabilen personel yok; aylık ücret tanımlarını kontrol edin.',
      'month',
    )
}

// --- Vergi yardımcıları -------------------------------------------------------------------------

/**
 * Artan oranlı tarifede kümülatif matrahın vergisi, kuruş × on binde bir (tamsayı, yuvarlamasız).
 * Ay vergisi iki kümülatif arasındaki farktır ve tek kez yuvarlanır (K-390).
 */
export function incomeTaxUnits(brackets: readonly IncomeTaxBracket[], baseCents: number): number {
  let units = 0
  brackets.forEach((bracket, index) => {
    const upper = brackets[index + 1]?.lowerBoundCents ?? Number.POSITIVE_INFINITY
    const portion = Math.min(baseCents, upper) - bracket.lowerBoundCents
    if (portion > 0) units += portion * bracket.rateBasisPoints
  })
  return units
}

/** Ayın gelir vergisi: önceki kümülatiften bu ayın matrahı kadar ilerleyince oluşan vergi. */
export function monthlyIncomeTax(
  brackets: readonly IncomeTaxBracket[],
  cumulativeBeforeCents: number,
  baseCents: number,
): number {
  if (baseCents <= 0) return 0
  const units =
    incomeTaxUnits(brackets, cumulativeBeforeCents + baseCents) -
    incomeTaxUnits(brackets, cumulativeBeforeCents)
  return Math.round(units / BASIS_POINTS_SCALE)
}

const ofBasisPoints = (cents: number, basisPoints: number) =>
  Math.round((cents * basisPoints) / BASIS_POINTS_SCALE)
const stampTax = (cents: number, per100k: number) => Math.round((cents * per100k) / STAMP_TAX_SCALE)

/** Asgari ücretin aylık gelir vergisi matrahı: brüt − işçi SGK − işsizlik işçi payı. */
export function minimumWageIncomeTaxBase(values: PayrollParameterValues): number {
  const derived = payrollDerivedValues(values)
  return (
    values.minimumWageGrossCents -
    derived.minimumWageEmployeeSgkCents -
    derived.minimumWageEmployeeUnemploymentCents
  )
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Ayın ve yıl içinde önceki ayların parametreleri (her ay kendi ilk günündeki setle). */
export interface PayrollMonthParameters {
  set: PayrollEffectiveSet
  /** Asgari ücretin yıl başından bu aya kadarki (bu ay hariç) kümülatif GV matrahı (K-388). */
  minimumWageBaseBeforeCents: number
}

/**
 * Ayın geçerli seti ve asgari ücret kümülatif matrahı (K-388). Yıl ortası asgari ücret değişiminde
 * her ay kendi setinin asgari ücretiyle sayılır. Ayın ilk gününde set yoksa 422.
 */
export function payrollMonthParameters(
  month: string,
  institutionSets: readonly PayrollInstitutionSet[],
  platform: readonly PayrollPlatformSet[] = PAYROLL_PLATFORM_DEFAULTS,
): PayrollMonthParameters {
  const set = effectivePayrollParameters(`${month}-01`, institutionSets, platform)
  if (set === null)
    throw new DomainError(
      'payroll_parameters_missing',
      'Bu ay için bordro parametresi tanımlı değil.',
      { path: ['month'] },
    )
  const year = month.slice(0, 4)
  const index = Number(month.slice(5, 7))
  let before = 0
  for (let previous = 1; previous < index; previous += 1) {
    const found = effectivePayrollParameters(
      `${year}-${pad(previous)}-01`,
      institutionSets,
      platform,
    )
    if (found !== null) before += minimumWageIncomeTaxBase(found.values)
  }
  return { set, minimumWageBaseBeforeCents: before }
}

// --- Satır ---------------------------------------------------------------------------------------

export const PAYROLL_CALC_WARNINGS = [
  'no_wage',
  'pay_rate_gap',
  'entry_in_month',
  'exit_in_month',
  'missing_days_exceed',
  'missing_reason',
  'hourly_wage',
  'net_wage',
  'net_rounding',
  'mixed_wage',
  'lesson_rate_missing',
  'below_floor',
  'above_ceiling',
  'negative_gross',
  'medical_report_days',
  'previous_month_not_saved',
  'deduction_capped',
  'staff_inactive',
] as const
export type PayrollCalcWarning = (typeof PAYROLL_CALC_WARNINGS)[number]
export const PAYROLL_CALC_WARNING_LABELS = {
  no_wage: 'Ayda ana ücret tanımı yok',
  pay_rate_gap: 'Ay içinde ücret tanımı olmayan gün var; o günler ödenmedi',
  entry_in_month: 'Ay içinde işe giriş: gün oranlı',
  exit_in_month: 'Ay içinde işten çıkış: gün oranlı',
  missing_days_exceed: 'Eksik gün çalışılan günü aşıyor',
  missing_reason: 'Eksik gün nedeni girilmemiş',
  hourly_wage: 'Saatlik ya da ders saati ücreti: çalışılan saat yok, satır hesaplanmadı',
  net_wage: 'Net tanımlı ücret: brüt ters hesapla bulundu',
  net_rounding: 'Ters hesapta kuruş farkı kaldı',
  mixed_wage: 'Ay içinde net ve brüt tanımlı ücret birlikte',
  lesson_rate_missing: 'Ek ders saati var, ek ders ücreti tanımı yok; tutar eklenmedi',
  below_floor: 'SGK matrahı tabana yükseltildi',
  above_ceiling: 'SGK matrahı tavanda kesildi',
  negative_gross: 'Düzeltmeler brütü sıfırın altına indirdi; brüt sıfır alındı',
  medical_report_days: 'Sağlık raporu günü eksik günden fazla; eksik günü kontrol edin',
  previous_month_not_saved: 'Yıl içinde hesabı kaydedilmemiş önceki ay var; kümülatif matrah eksik',
  deduction_capped: 'Kesintilerden biri tavana takıldı ya da beklemede',
  staff_inactive: 'Personel pasif (ayrıldı)',
} as const satisfies Record<PayrollCalcWarning, string>

/** SGK hazırlık uyarısından bordro uyarısına (aynı anlam). */
const SGK_TO_CALC: Partial<Record<SgkWarning, PayrollCalcWarning>> = {
  no_wage: 'no_wage',
  pay_rate_gap: 'pay_rate_gap',
  entry_in_month: 'entry_in_month',
  exit_in_month: 'exit_in_month',
  missing_days_exceed: 'missing_days_exceed',
  missing_reason: 'missing_reason',
}

export const PAYROLL_EARNING_KINDS = ['wage', 'lesson', 'benefit', 'adjustment'] as const
export type PayrollEarningKind = (typeof PAYROLL_EARNING_KINDS)[number]

/** Brüt kalemi: hangi matraha girdiği ile. */
export interface PayrollEarning {
  kind: PayrollEarningKind
  /** Ücret türü, ek ders türü, yan hak türü ya da düzeltme kalemi. */
  code: string
  amountCents: number
  /** Ek derste saat; diğerlerinde `null`. */
  hours: number | null
  /** Ek derste birim ücret; diğerlerinde `null`. */
  rateCents: number | null
  /** SGK prime esas kazanca girer. */
  sgk: boolean
  /** Gelir ve damga vergisi matrahına girer. */
  taxable: boolean
}

export interface PayrollCalcRow {
  membershipId: string
  name: string
  role: string
  active: boolean
  /** Satır hesaplandı mı; saatlik ücret ya da ücret tanımı yoksa `false`, kayda girmez. */
  complete: boolean
  entryDate: string | null
  exitDate: string | null
  primDays: number
  missingDays: number
  medicalReportDays: number
  wageType: WageType | null
  /** Net tanımlı ücrette ayın hedef neti ve ters hesaptan kalan kuruş farkı. */
  netTargetCents: number | null
  netDifferenceCents: number | null
  earnings: PayrollEarning[]
  grossCents: number
  sgkFloorCents: number
  sgkCeilingCents: number
  sgkBaseCents: number
  sgkEmployeeCents: number
  unemploymentEmployeeCents: number
  incomeTaxBaseCents: number
  cumulativeIncomeTaxBaseBeforeCents: number
  incomeTaxCents: number
  incomeTaxExemptionCents: number
  incomeTaxPayableCents: number
  stampTaxBaseCents: number
  stampTaxCents: number
  stampTaxExemptionCents: number
  stampTaxPayableCents: number
  netCents: number
  /** Kesinti kalemli düzeltmelerin işaretli toplamı (net üzerine). */
  netAdjustmentCents: number
  deductions: MonthlyDeductionLine[]
  deductionCents: number
  payableCents: number
  sgkEmployerCents: number
  unemploymentEmployerCents: number
  inKindBenefitsCents: number
  employerCostCents: number
  warnings: PayrollCalcWarning[]
}

/** Hesap girdisi: üyelik ve ücret tanımı (iptal edilmemiş, ay dışı dahil; zincir için). */
export interface PayrollCalcMember {
  membershipId: string
  name: string
  role: string
  active: boolean
}
export interface PayrollCalcRate extends SgkPayRate {
  taxable: boolean | null
}
export interface PayrollCalcLessonHours {
  membershipId: string
  lessonType: LessonPayType
  hours: number
}
export interface PayrollCalcAdjustment {
  membershipId: string
  item: PayrollAdjustmentItem
  amountCents: number
}
/** Kayıtlı (etkin) hesaptaki bir ayın GV matrahı. */
export interface PayrollSavedBase {
  membershipId: string
  month: string
  incomeTaxBaseCents: number
}

export interface PayrollPersonInput {
  member: PayrollCalcMember
  rates: readonly PayrollCalcRate[]
  missing: readonly Pick<SgkMissingDayEntry, 'days' | 'reasonCode'>[]
  dates: Pick<SgkEmploymentDatesEntry, 'entryDate' | 'exitDate'> | null
  lessonHours: readonly Omit<PayrollCalcLessonHours, 'membershipId'>[]
  adjustments: readonly Omit<PayrollCalcAdjustment, 'membershipId'>[]
  /** Yıl başından önceki ayların kayıtlı GV matrahı + elle devir. */
  cumulativeIncomeTaxBaseBeforeCents: number
  /** Yıl içinde ücret tanımı olup hesabı kaydedilmemiş önceki aylar. */
  unsavedPreviousMonths: readonly string[]
  medicalReportDays: number
  deductionSources: MonthlyDeductionSources
}

const overlaps = (rate: { startDate: string; endDate: string | null }, from: string, to: string) =>
  rate.startDate <= to && (rate.endDate === null || rate.endDate >= from)

/** Tanımın aralıkla kesişen gün sayısı. */
function overlapDays(
  rate: { startDate: string; endDate: string | null },
  from: string,
  to: string,
) {
  const start = rate.startDate > from ? rate.startDate : from
  const end = rate.endDate === null || rate.endDate > to ? to : rate.endDate
  return end >= start ? daysBetween(start, end) : 0
}

/**
 * Aylık tutarların gün oranı (K-387): her tanım çalışılan aralıktaki günüyle ağırlıklanır, toplam
 * prim günü / 30 ile çarpılır ve bir kez yuvarlanır. Tam ayda tek tanım tutarın kendisidir.
 */
function proratedMonthly(
  rates: readonly { amountCents: number; startDate: string; endDate: string | null }[],
  from: string,
  to: string,
  primDays: number,
): number {
  const worked = to >= from ? daysBetween(from, to) : 0
  if (worked === 0 || primDays === 0) return 0
  let weighted = 0
  for (const rate of rates) weighted += rate.amountCents * overlapDays(rate, from, to)
  return Math.round((weighted * primDays) / (worked * SGK_FULL_MONTH_DAYS))
}

interface Amounts {
  sgkBaseCents: number
  sgkEmployeeCents: number
  unemploymentEmployeeCents: number
  incomeTaxBaseCents: number
  incomeTaxCents: number
  incomeTaxExemptionCents: number
  stampTaxBaseCents: number
  stampTaxCents: number
  stampTaxExemptionCents: number
  netCents: number
  sgkEmployerCents: number
  unemploymentEmployerCents: number
}

interface TaxContext {
  values: PayrollParameterValues
  primDays: number
  floorCents: number
  ceilingCents: number
  cumulativeBeforeCents: number
  /** Asgari ücret istisnalarının bu ayki üst sınırı (gün oranlı). */
  incomeTaxExemptionLimitCents: number
  stampTaxExemptionLimitCents: number
}

/** Brütten nete (K-388, K-390): SGK matrahına giren ve vergiye tabi brütten. */
function amountsFor(sgkGross: number, taxableGross: number, context: TaxContext): Amounts {
  const { values, primDays } = context
  const sgkBaseCents =
    primDays === 0 ? 0 : Math.min(Math.max(sgkGross, context.floorCents), context.ceilingCents)
  const sgkEmployeeCents = ofBasisPoints(sgkBaseCents, values.sgkEmployeeRateBasisPoints)
  const unemploymentEmployeeCents = ofBasisPoints(
    sgkBaseCents,
    values.unemploymentEmployeeRateBasisPoints,
  )
  // İşçi payları vergiye tabi kısmın oranı kadar düşülür; vergisiz nakdi yan hak matraha girmez.
  const incomeTaxBaseCents = Math.max(
    0,
    taxableGross - sgkEmployeeCents - unemploymentEmployeeCents,
  )
  const incomeTaxCents = monthlyIncomeTax(
    values.incomeTaxBrackets,
    context.cumulativeBeforeCents,
    incomeTaxBaseCents,
  )
  const incomeTaxExemptionCents = Math.min(incomeTaxCents, context.incomeTaxExemptionLimitCents)
  const stampTaxBaseCents = Math.max(0, taxableGross)
  const stampTaxCents = stampTax(stampTaxBaseCents, values.stampTaxRatePer100k)
  const stampTaxExemptionCents = Math.min(stampTaxCents, context.stampTaxExemptionLimitCents)
  const netCents =
    sgkGross -
    sgkEmployeeCents -
    unemploymentEmployeeCents -
    (incomeTaxCents - incomeTaxExemptionCents) -
    (stampTaxCents - stampTaxExemptionCents)
  const employerRate = values.sgkEmployerRateBasisPoints - values.sgkEmployerIncentiveBasisPoints
  return {
    sgkBaseCents,
    sgkEmployeeCents,
    unemploymentEmployeeCents,
    incomeTaxBaseCents,
    incomeTaxCents,
    incomeTaxExemptionCents,
    stampTaxBaseCents,
    stampTaxCents,
    stampTaxExemptionCents,
    netCents,
    sgkEmployerCents: ofBasisPoints(sgkBaseCents, employerRate),
    unemploymentEmployerCents: ofBasisPoints(
      sgkBaseCents,
      values.unemploymentEmployerRateBasisPoints,
    ),
  }
}

/** Ters hesabın arama sınırı: 2^40 kuruş, sınırlı adım. */
const REVERSE_LIMIT_CENTS = 2 ** 40

/**
 * Netten brüte (K-389): sabit brüte (`fixedGross`, ek kalemsiz) eklenecek en küçük kuruş brüt; ek
 * kalemsiz net, sabit brütün netinden `targetNet` kadar fazla (sabit brüt yoksa doğrudan
 * `targetNet`) olmalıdır. Net brütle azalmaz; ikili arama kuruş kesindir, kalan fark raporlanır.
 */
export function grossForNet(
  targetNetCents: number,
  fixedGrossCents: number,
  context: TaxContext,
): { grossCents: number; differenceCents: number } {
  if (targetNetCents <= 0) return { grossCents: 0, differenceCents: 0 }
  const netOf = (extra: number) =>
    amountsFor(fixedGrossCents + extra, fixedGrossCents + extra, context).netCents
  const goal = targetNetCents + (fixedGrossCents > 0 ? netOf(0) : 0)
  let low = 0
  let high = Math.max(1, targetNetCents)
  while (netOf(high) < goal && high < REVERSE_LIMIT_CENTS) high *= 2
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (netOf(middle) >= goal) high = middle
    else low = middle + 1
  }
  return { grossCents: low, differenceCents: netOf(low) - goal }
}

/** Ek ders birim ücreti (K-337 ile aynı): türün ayla kesişen en geç başlayan tanımı. */
function lessonRateFor(
  rates: readonly PayrollCalcRate[],
  lessonType: LessonPayType,
  range: SgkMonthRange,
): PayrollCalcRate | null {
  return rates
    .filter(
      (rate) =>
        rate.component === 'lesson' &&
        rate.rateType === lessonType &&
        overlaps(rate, range.firstDay, range.lastDay),
    )
    .reduce<PayrollCalcRate | null>(
      (latest, rate) => (latest === null || rate.startDate > latest.startDate ? rate : latest),
      null,
    )
}

/**
 * Bir personelin ay hesabı (DOM-FIN-115). Sıra: prim günü → brüt kalemleri → (net tanımlıysa ters
 * hesap) → SGK işçi ve işsizlik → GV matrahı, kümülatif vergi, asgari ücret istisnası → damga
 * vergisi ve istisnası → net → kesintiler (DOM-FIN-101 sırası, icra tavanı net ücretten) → ödenecek
 * → işveren payları ve maliyet.
 */
export function payrollCalcRow(
  month: string,
  parameters: PayrollMonthParameters,
  input: PayrollPersonInput,
): PayrollCalcRow {
  const values = parameters.set.values
  const range = sgkMonthRange(month)
  const work = sgkWorkDays(range, input.rates, input.missing, input.dates)
  const warnings = new Set<PayrollCalcWarning>()
  for (const code of work.warnings) {
    const mapped = SGK_TO_CALC[code]
    if (mapped) warnings.add(mapped)
  }
  if (!input.member.active) warnings.add('staff_inactive')
  const { from, to, primDays } = work
  const inRange = input.rates.filter((rate) => overlaps(rate, from, to))
  const wages = inRange.filter((rate) => rate.component === 'wage')
  const grossWages = wages.filter((rate) => rate.rateType === 'monthly_gross')
  const netWages = wages.filter((rate) => rate.rateType === 'monthly_net')
  const hourly = wages.some((rate) => rate.rateType === 'hourly' || rate.rateType === 'lesson_hour')
  if (hourly) warnings.add('hourly_wage')
  if (grossWages.length > 0 && netWages.length > 0) warnings.add('mixed_wage')
  const lastWage = wages.reduce<PayrollCalcRate | null>(
    (latest, rate) => (latest === null || rate.startDate > latest.startDate ? rate : latest),
    null,
  )

  const earnings: PayrollEarning[] = []
  const fixedWageGross = proratedMonthly(grossWages, from, to, primDays)
  const netTarget = netWages.length > 0 ? proratedMonthly(netWages, from, to, primDays) : null

  for (const entry of input.lessonHours) {
    const rate = lessonRateFor(input.rates, entry.lessonType, range)
    if (rate === null) {
      warnings.add('lesson_rate_missing')
      continue
    }
    earnings.push({
      kind: 'lesson',
      code: entry.lessonType,
      amountCents: rate.amountCents * entry.hours,
      hours: entry.hours,
      rateCents: rate.amountCents,
      sgk: true,
      taxable: true,
    })
  }
  const benefits = inRange.filter((rate) => rate.component === 'benefit')
  let inKindBenefitsCents = 0
  for (const benefit of benefits) {
    const amount = proratedMonthly([benefit], from, to, primDays)
    if (amount === 0) continue
    if (benefit.benefitForm === 'in_kind') {
      inKindBenefitsCents += amount
      continue
    }
    earnings.push({
      kind: 'benefit',
      code: benefit.rateType,
      amountCents: amount,
      hours: null,
      rateCents: null,
      sgk: true,
      taxable: benefit.taxable === true,
    })
  }
  let netAdjustmentCents = 0
  for (const adjustment of input.adjustments) {
    if (adjustment.item === 'deduction') {
      netAdjustmentCents += adjustment.amountCents
      continue
    }
    earnings.push({
      kind: 'adjustment',
      code: adjustment.item,
      amountCents: adjustment.amountCents,
      hours: null,
      rateCents: null,
      sgk: true,
      taxable: true,
    })
  }

  const context: TaxContext = {
    values,
    primDays,
    floorCents: sgkProrate(payrollDerivedValues(values).sgkFloorCents, primDays),
    ceilingCents: sgkProrate(payrollDerivedValues(values).sgkCeilingCents, primDays),
    cumulativeBeforeCents: input.cumulativeIncomeTaxBaseBeforeCents,
    incomeTaxExemptionLimitCents: values.minimumWageIncomeTaxExempt
      ? monthlyIncomeTax(
          values.incomeTaxBrackets,
          parameters.minimumWageBaseBeforeCents,
          sgkProrate(minimumWageIncomeTaxBase(values), primDays),
        )
      : 0,
    stampTaxExemptionLimitCents: values.minimumWageStampTaxExempt
      ? stampTax(sgkProrate(values.minimumWageGrossCents, primDays), values.stampTaxRatePer100k)
      : 0,
  }

  let wageGross = fixedWageGross
  let netDifferenceCents: number | null = null
  if (netTarget !== null) {
    warnings.add('net_wage')
    const reverse = grossForNet(netTarget, fixedWageGross, context)
    wageGross += reverse.grossCents
    netDifferenceCents = reverse.differenceCents
    if (reverse.differenceCents !== 0) warnings.add('net_rounding')
  }
  if (wageGross > 0 || (lastWage !== null && !hourly))
    earnings.unshift({
      kind: 'wage',
      code: netTarget !== null && grossWages.length === 0 ? 'monthly_net' : 'monthly_gross',
      amountCents: wageGross,
      hours: null,
      rateCents: null,
      sgk: true,
      taxable: true,
    })

  const sum = (pick: (earning: PayrollEarning) => boolean) =>
    earnings.filter(pick).reduce((total, earning) => total + earning.amountCents, 0)
  let sgkGross = sum((earning) => earning.sgk)
  let taxableGross = sum((earning) => earning.taxable)
  if (sgkGross < 0 || taxableGross < 0) {
    warnings.add('negative_gross')
    sgkGross = Math.max(0, sgkGross)
    taxableGross = Math.max(0, taxableGross)
  }
  const amounts = amountsFor(sgkGross, taxableGross, context)
  if (primDays > 0 && sgkGross < context.floorCents) warnings.add('below_floor')
  if (primDays > 0 && sgkGross > context.ceilingCents) warnings.add('above_ceiling')
  if (input.medicalReportDays > work.missingDays) warnings.add('medical_report_days')
  if (input.unsavedPreviousMonths.length > 0) warnings.add('previous_month_not_saved')

  const deductions = monthlyDeductions(
    { month, netCents: Math.max(0, amounts.netCents), pensionBaseCents: amounts.sgkBaseCents },
    input.deductionSources,
  )
  if (deductions.lines.some((line) => line.status !== 'applied')) warnings.add('deduction_capped')
  const complete = !hourly && wages.length > 0
  const employerCostCents =
    sgkGross + amounts.sgkEmployerCents + amounts.unemploymentEmployerCents + inKindBenefitsCents

  return {
    membershipId: input.member.membershipId,
    name: input.member.name,
    role: input.member.role,
    active: input.member.active,
    complete,
    entryDate: work.entryDate,
    exitDate: work.exitDate,
    primDays,
    missingDays: work.missingDays,
    medicalReportDays: input.medicalReportDays,
    wageType: (lastWage?.rateType as WageType | undefined) ?? null,
    netTargetCents: netTarget,
    netDifferenceCents,
    earnings,
    grossCents: sgkGross,
    sgkFloorCents: context.floorCents,
    sgkCeilingCents: context.ceilingCents,
    sgkBaseCents: amounts.sgkBaseCents,
    sgkEmployeeCents: amounts.sgkEmployeeCents,
    unemploymentEmployeeCents: amounts.unemploymentEmployeeCents,
    incomeTaxBaseCents: amounts.incomeTaxBaseCents,
    cumulativeIncomeTaxBaseBeforeCents: input.cumulativeIncomeTaxBaseBeforeCents,
    incomeTaxCents: amounts.incomeTaxCents,
    incomeTaxExemptionCents: amounts.incomeTaxExemptionCents,
    incomeTaxPayableCents: amounts.incomeTaxCents - amounts.incomeTaxExemptionCents,
    stampTaxBaseCents: amounts.stampTaxBaseCents,
    stampTaxCents: amounts.stampTaxCents,
    stampTaxExemptionCents: amounts.stampTaxExemptionCents,
    stampTaxPayableCents: amounts.stampTaxCents - amounts.stampTaxExemptionCents,
    netCents: amounts.netCents,
    netAdjustmentCents,
    deductions: deductions.lines,
    deductionCents: deductions.totalCents,
    payableCents: amounts.netCents + netAdjustmentCents - deductions.totalCents,
    sgkEmployerCents: amounts.sgkEmployerCents,
    unemploymentEmployerCents: amounts.unemploymentEmployerCents,
    inKindBenefitsCents,
    employerCostCents,
    warnings: PAYROLL_CALC_WARNINGS.filter((code) => warnings.has(code)),
  }
}

// --- Ay listesi ----------------------------------------------------------------------------------

/** Yıl içinde (bu ay hariç) ana ücret tanımı olan ama kayıtlı hesabı olmayan aylar (K-388). */
export function unsavedPreviousMonths(
  month: string,
  rates: readonly { component: string; startDate: string; endDate: string | null }[],
  savedMonths: ReadonlySet<string>,
): string[] {
  const year = month.slice(0, 4)
  const result: string[] = []
  for (let index = 1; index < Number(month.slice(5, 7)); index += 1) {
    const previous = `${year}-${pad(index)}`
    if (savedMonths.has(previous)) continue
    const range = sgkMonthRange(previous)
    if (
      rates.some(
        (rate) => rate.component === 'wage' && overlaps(rate, range.firstDay, range.lastDay),
      )
    )
      result.push(previous)
  }
  return result
}

export interface PayrollCalcTotals {
  staffCount: number
  completeCount: number
  incompleteCount: number
  grossCents: number
  sgkEmployeeCents: number
  unemploymentEmployeeCents: number
  incomeTaxPayableCents: number
  stampTaxPayableCents: number
  netCents: number
  deductionCents: number
  payableCents: number
  sgkEmployerCents: number
  unemploymentEmployerCents: number
  employerCostCents: number
}

/** Toplamlar yalnız hesaplanmış (eksik olmayan) satırlardandır. */
export function payrollCalcTotals(rows: readonly PayrollCalcRow[]): PayrollCalcTotals {
  const complete = rows.filter((row) => row.complete)
  const total = (pick: (row: PayrollCalcRow) => number) =>
    complete.reduce((sum, row) => sum + pick(row), 0)
  return {
    staffCount: rows.length,
    completeCount: complete.length,
    incompleteCount: rows.length - complete.length,
    grossCents: total((row) => row.grossCents),
    sgkEmployeeCents: total((row) => row.sgkEmployeeCents),
    unemploymentEmployeeCents: total((row) => row.unemploymentEmployeeCents),
    incomeTaxPayableCents: total((row) => row.incomeTaxPayableCents),
    stampTaxPayableCents: total((row) => row.stampTaxPayableCents),
    netCents: total((row) => row.netCents),
    deductionCents: total((row) => row.deductionCents),
    payableCents: total((row) => row.payableCents),
    sgkEmployerCents: total((row) => row.sgkEmployerCents),
    unemploymentEmployerCents: total((row) => row.unemploymentEmployerCents),
    employerCostCents: total((row) => row.employerCostCents),
  }
}

/** Hesabın dayandığı parametre seti (ekranda kaynak). */
export interface PayrollCalcParameters {
  setId: string
  origin: 'platform' | 'institution'
  effectiveFrom: string
  stale: boolean
  unverified: boolean
  minimumWageGrossCents: number
  minimumWageBaseBeforeCents: number
}

export interface PayrollCalculation {
  month: string
  parameters: PayrollCalcParameters
  rows: PayrollCalcRow[]
  totals: PayrollCalcTotals
}

export const payrollCalcParameters = (
  parameters: PayrollMonthParameters,
): PayrollCalcParameters => ({
  setId: parameters.set.id,
  origin: parameters.set.origin,
  effectiveFrom: parameters.set.values.effectiveFrom,
  stale: parameters.set.stale,
  unverified: parameters.set.unverifiedFields.length > 0,
  minimumWageGrossCents: parameters.set.values.minimumWageGrossCents,
  minimumWageBaseBeforeCents: parameters.minimumWageBaseBeforeCents,
})

const EMPTY_SOURCES: MonthlyDeductionSources = { advances: [], garnishments: [], pensions: [] }

/**
 * Ayın hesabı (DOM-FIN-115). Personel: ayda ana ücret tanımı yürürlükte olan, o ay ek ders saati,
 * aya aktarılan düzeltme ya da SGK elle satırı bulunan üyelikler; ada göre. `rates` bu üyeliklerin
 * iptal edilmemiş bütün tanımları, `savedBases` yılın kayıtlı (etkin) hesaplarının satırları,
 * `carryovers` yılın elle devirleridir.
 */
export function payrollCalculation(input: {
  month: string
  parameters: PayrollMonthParameters
  members: readonly PayrollCalcMember[]
  rates: readonly PayrollCalcRate[]
  missing: readonly (Pick<SgkMissingDayEntry, 'days' | 'reasonCode'> & { membershipId: string })[]
  dates: readonly (Pick<SgkEmploymentDatesEntry, 'entryDate' | 'exitDate'> & {
    membershipId: string
  })[]
  lessonHours: readonly PayrollCalcLessonHours[]
  adjustments: readonly PayrollCalcAdjustment[]
  savedBases: readonly PayrollSavedBase[]
  carryovers: readonly { membershipId: string; incomeTaxBaseCents: number }[]
  medicalReportDays: ReadonlyMap<string, number>
  deductionSources: ReadonlyMap<string, MonthlyDeductionSources>
}): PayrollCalculation {
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
  const lessonsBy = group(input.lessonHours)
  const adjustmentsBy = group(input.adjustments)
  const year = input.month.slice(0, 4)
  const savedBy = group(
    input.savedBases.filter(
      (saved) => saved.month.startsWith(`${year}-`) && saved.month < input.month,
    ),
  )
  const carryoverBy = new Map<string, number>()
  for (const carryover of input.carryovers)
    carryoverBy.set(
      carryover.membershipId,
      (carryoverBy.get(carryover.membershipId) ?? 0) + carryover.incomeTaxBaseCents,
    )

  const rows = input.members
    .filter((member) => {
      const id = member.membershipId
      return (
        (ratesBy.get(id) ?? []).some(
          (rate) => rate.component === 'wage' && overlaps(rate, range.firstDay, range.lastDay),
        ) ||
        lessonsBy.has(id) ||
        adjustmentsBy.has(id) ||
        missingBy.has(id) ||
        datesBy.has(id)
      )
    })
    .map((member) => {
      const id = member.membershipId
      const rates = ratesBy.get(id) ?? []
      const saved = savedBy.get(id) ?? []
      return payrollCalcRow(input.month, input.parameters, {
        member,
        rates,
        missing: missingBy.get(id) ?? [],
        dates: datesBy.get(id) ?? null,
        lessonHours: lessonsBy.get(id) ?? [],
        adjustments: adjustmentsBy.get(id) ?? [],
        cumulativeIncomeTaxBaseBeforeCents:
          (carryoverBy.get(id) ?? 0) +
          saved.reduce((total, item) => total + item.incomeTaxBaseCents, 0),
        unsavedPreviousMonths: unsavedPreviousMonths(
          input.month,
          rates,
          new Set(saved.map((item) => item.month)),
        ),
        medicalReportDays: input.medicalReportDays.get(id) ?? 0,
        deductionSources: input.deductionSources.get(id) ?? EMPTY_SOURCES,
      })
    })
    .sort(
      (a, b) => a.name.localeCompare(b.name, 'tr') || a.membershipId.localeCompare(b.membershipId),
    )
  return {
    month: input.month,
    parameters: payrollCalcParameters(input.parameters),
    rows,
    totals: payrollCalcTotals(rows),
  }
}

// --- Gösterim ve CSV -----------------------------------------------------------------------------

const EARNING_KIND_LABELS = {
  wage: 'Ana ücret',
  lesson: 'Ek ders',
  benefit: 'Yan hak',
  adjustment: 'Düzeltme',
} as const satisfies Record<PayrollEarningKind, string>

/** "Ek ders · Nöbet (6 saat)". */
export function payrollEarningLabel(earning: PayrollEarning): string {
  const kind = EARNING_KIND_LABELS[earning.kind]
  if (earning.kind === 'wage')
    return `${kind} · ${WAGE_TYPE_LABELS[earning.code as WageType] ?? earning.code}`
  if (earning.kind === 'lesson')
    return `${kind} · ${LESSON_PAY_TYPE_LABELS[earning.code as LessonPayType] ?? earning.code} (${String(earning.hours ?? 0)} saat)`
  if (earning.kind === 'benefit')
    return `${kind} · ${BENEFIT_TYPE_LABELS[earning.code as BenefitType] ?? earning.code}${earning.taxable ? '' : ' (vergisiz)'}`
  return `${kind} · ${PAYROLL_ADJUSTMENT_ITEM_LABELS[earning.code as PayrollAdjustmentItem] ?? earning.code}`
}

const CSV_HEADER = [
  'Ad soyad',
  'Hesaplandı',
  'Prim günü',
  'Brüt',
  'SGK matrahı',
  'SGK işçi payı',
  'İşsizlik işçi payı',
  'GV matrahı',
  'Önceki kümülatif GV matrahı',
  'Hesaplanan GV',
  'Asgari ücret GV istisnası',
  'Ödenecek GV',
  'Hesaplanan damga vergisi',
  'Asgari ücret DV istisnası',
  'Ödenecek damga vergisi',
  'Net ücret',
  'Net düzeltme',
  'Kesintiler',
  'Ödenecek net',
  'SGK işveren payı',
  'İşsizlik işveren payı',
  'Ayni yan haklar',
  'İşveren maliyeti',
  'Uyarılar',
]

/**
 * CSV (K-391): personel başına bir satır, `;` ayırıcı, ondalık virgül, formül kaçışı; son satırlar
 * toplam ve ilke notudur. BOM'u uç ekler.
 */
export function payrollCalculationCsv(
  calculation: Pick<PayrollCalculation, 'rows' | 'totals'>,
): string {
  const blank = csvCell('')
  const rows = calculation.rows.map((row) => [
    csvCell(row.name),
    csvCell(row.complete ? 'Evet' : 'Hayır'),
    csvCell(row.primDays),
    csvAmount(row.grossCents),
    csvAmount(row.sgkBaseCents),
    csvAmount(row.sgkEmployeeCents),
    csvAmount(row.unemploymentEmployeeCents),
    csvAmount(row.incomeTaxBaseCents),
    csvAmount(row.cumulativeIncomeTaxBaseBeforeCents),
    csvAmount(row.incomeTaxCents),
    csvAmount(row.incomeTaxExemptionCents),
    csvAmount(row.incomeTaxPayableCents),
    csvAmount(row.stampTaxCents),
    csvAmount(row.stampTaxExemptionCents),
    csvAmount(row.stampTaxPayableCents),
    csvAmount(row.netCents),
    csvAmount(row.netAdjustmentCents),
    csvAmount(row.deductionCents),
    csvAmount(row.payableCents),
    csvAmount(row.sgkEmployerCents),
    csvAmount(row.unemploymentEmployerCents),
    csvAmount(row.inKindBenefitsCents),
    csvAmount(row.employerCostCents),
    csvCell(row.warnings.map((code) => PAYROLL_CALC_WARNING_LABELS[code]).join(' | ')),
  ])
  const { totals } = calculation
  const total = [
    csvCell('Toplam (hesaplanan satırlar)'),
    csvCell(`${String(totals.completeCount)}/${String(totals.staffCount)}`),
    blank,
    csvAmount(totals.grossCents),
    blank,
    csvAmount(totals.sgkEmployeeCents),
    csvAmount(totals.unemploymentEmployeeCents),
    blank,
    blank,
    blank,
    blank,
    csvAmount(totals.incomeTaxPayableCents),
    blank,
    blank,
    csvAmount(totals.stampTaxPayableCents),
    csvAmount(totals.netCents),
    blank,
    csvAmount(totals.deductionCents),
    csvAmount(totals.payableCents),
    csvAmount(totals.sgkEmployerCents),
    csvAmount(totals.unemploymentEmployerCents),
    blank,
    csvAmount(totals.employerCostCents),
    blank,
  ]
  const note = [csvCell(PAYROLL_CALC_NOTE), ...Array<string>(CSV_HEADER.length - 1).fill(blank)]
  return [CSV_HEADER.map(csvCell), ...rows, total, note]
    .map((row) => row.join(CSV_SEPARATOR))
    .join('\r\n')
}

export const payrollCalculationFilename = (month: string, saved: boolean) =>
  `bordro-hesabi-${month}${saved ? '-kayitli' : ''}.csv`
