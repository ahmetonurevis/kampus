import { z } from 'zod'

import { ACADEMIC_YEAR_MAX, ACADEMIC_YEAR_MIN } from './academic-years.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import {
  addMonthKey,
  applyBasisPoints,
  CASH_FLOW_MAX_MONTHS,
  type CashFlowForecast,
  type PipelineStatus,
  type RevenueForecast,
} from './finance-forecast.ts'

/**
 * Gelir senaryo analizi (docs/domain/finans.md DOM-FIN-067; K24, ON-248). Gelir tahmininin
 * (`revenueForecast`, DOM-FIN-063) üzerine öğrenci sayısı, fiyat ve indirim-burs oranı değişimi
 * uygular ve temel ile karşılaştırır. Saf hesap; senaryo saklanmaz (K-90). Oranlar on binde birdir,
 * tutarlar kuruş tamsayı; her segmentin her kalemi bir kez kuruşa yuvarlanır. Öğrenci sayısı huni
 * beklentisinden kesirli gelir, iki ondalıkla döner.
 */

const BASIS = 10_000

/** Bir istekteki en çok senaryo (temel ayrıca döner). */
export const FINANCE_SCENARIO_MAX = 4
/** Öğrenci sayısı yüzde değişimi: −%100 … +%200 (on binde bir). */
export const SCENARIO_STUDENT_PERCENT_MIN = -10_000
export const SCENARIO_STUDENT_PERCENT_MAX = 20_000
/** Öğrenci sayısı adet değişimi: ±10.000. */
export const SCENARIO_STUDENT_COUNT_LIMIT = 10_000
/** Fiyat değişimi: −%50 … +%200 (on binde bir). */
export const SCENARIO_PRICE_CHANGE_MIN = -5_000
export const SCENARIO_PRICE_CHANGE_MAX = 20_000
/** İndirim ve burs oranı değişimi: ±100 puan (on binde bir; 1 puan = 100). */
export const SCENARIO_DISCOUNT_CHANGE_LIMIT = 10_000

const studentChangeSchema = z.discriminatedUnion(
  'unit',
  [
    z.strictObject({
      unit: z.literal('percent'),
      value: z
        .number('Öğrenci değişimini girin.')
        .int('Yüzde değişim on binde bir tam sayı olmalıdır.')
        .min(SCENARIO_STUDENT_PERCENT_MIN, 'Öğrenci sayısı en çok %100 azalabilir.')
        .max(SCENARIO_STUDENT_PERCENT_MAX, 'Öğrenci sayısı en çok %200 artabilir.'),
    }),
    z.strictObject({
      unit: z.literal('count'),
      value: z
        .number('Öğrenci değişimini girin.')
        .int('Öğrenci değişimi tam sayı olmalıdır.')
        .min(-SCENARIO_STUDENT_COUNT_LIMIT, 'Öğrenci değişimi en çok 10.000 olabilir.')
        .max(SCENARIO_STUDENT_COUNT_LIMIT, 'Öğrenci değişimi en çok 10.000 olabilir.'),
    }),
  ],
  'Değişim birimi yüzde ya da öğrenci olmalıdır.',
)
export type StudentChange = z.output<typeof studentChangeSchema>

const NO_CHANGE: StudentChange = { unit: 'percent', value: 0 }

export const financeScenarioSchema = z.strictObject({
  /** Yeni kayıt (kesin yeni kayıt + huni beklentisi) öğrenci sayısı değişimi. */
  newStudents: studentChangeSchema.default(NO_CHANGE),
  /** Yenileme öğrenci sayısı değişimi. */
  renewalStudents: studentChangeSchema.default(NO_CHANGE),
  /** Tarife fiyatı değişimi, on binde bir (`%25` → 2500). */
  priceChangeBasisPoints: z
    .number('Fiyat değişimini girin.')
    .int('Fiyat değişimi on binde bir tam sayı olmalıdır.')
    .min(SCENARIO_PRICE_CHANGE_MIN, 'Fiyat en çok %50 düşebilir.')
    .max(SCENARIO_PRICE_CHANGE_MAX, 'Fiyat en çok %200 artabilir.')
    .default(0),
  /** İndirim ve burs oranı değişimi, on binde bir (2 puan → 200); sonuç oran %0–%100 arasına sıkışır. */
  discountChangeBasisPoints: z
    .number('İndirim ve burs değişimini girin.')
    .int('İndirim ve burs değişimi on binde bir tam sayı olmalıdır.')
    .min(-SCENARIO_DISCOUNT_CHANGE_LIMIT, 'İndirim ve burs oranı en çok 100 puan değişebilir.')
    .max(SCENARIO_DISCOUNT_CHANGE_LIMIT, 'İndirim ve burs oranı en çok 100 puan değişebilir.')
    .default(0),
  /**
   * `false` (varsayılan): fiyat ve indirim değişimi mevcut sözleşmeleri değiştirmez, yalnız
   * sözleşmesiz öğrenciye (huni ve eklenen öğrenci) uygulanır. `true`: bütün öğrenciye.
   */
  applyToExistingContracts: z
    .boolean('Mevcut sözleşme seçeneği evet ya da hayır olmalıdır.')
    .default(false),
})
export type FinanceScenario = z.output<typeof financeScenarioSchema>

export const financeScenarioRequestSchema = z.strictObject({
  /** Verilmezse kurumun kayıt yılı. */
  year: z
    .number('Eğitim yılını seçin.')
    .int('Eğitim yılını seçin.')
    .min(ACADEMIC_YEAR_MIN, 'Eğitim yılı geçersiz.')
    .max(ACADEMIC_YEAR_MAX, 'Eğitim yılı geçersiz.')
    .optional(),
  scenarios: z
    .array(financeScenarioSchema, 'Senaryo listesi gerekli.')
    .min(1, 'En az bir senaryo girin.')
    .max(
      FINANCE_SCENARIO_MAX,
      `En çok ${String(FINANCE_SCENARIO_MAX)} senaryo karşılaştırılabilir.`,
    ),
  /** Verilirse senaryoların nakit akışına etkisi bu kadar ay için hesaplanır. */
  cashFlowMonths: z
    .number('Ay sayısını girin.')
    .int('Ay sayısı tam sayı olmalıdır.')
    .min(1, 'En az 1 ay seçin.')
    .max(CASH_FLOW_MAX_MONTHS, `En fazla ${String(CASH_FLOW_MAX_MONTHS)} ay seçebilirsiniz.`)
    .optional(),
})
export type FinanceScenarioRequest = z.output<typeof financeScenarioRequestSchema>

export interface ScenarioSegment {
  /** Öğrenci sayısı (kesin + beklenen; iki ondalık). */
  students: number
  /** Bunlardan sözleşmesi olan (kesin gelirdeki) öğrenci. */
  contractedStudents: number
  netCents: number
  /** Birim fiyatı bulunamadığı için gelire girmeyen öğrenci (iki ondalık). */
  unpricedStudents: number
}

export interface ScenarioOutcome {
  newEnrollment: ScenarioSegment
  renewal: ScenarioSegment
  /** Sözleşmesiz öğrenciye uygulanan indirim ve burs oranı (on binde bir). */
  discountRateBasisPoints: number
  expectedTotalCents: number
  /** Senaryo eksi temel. */
  differenceCents: number
  /** Farkın temele oranı (on binde bir); temel sıfırsa `null`. */
  differenceBasisPoints: number | null
}

export interface ScenarioCashFlowMonth {
  month: string
  /** Senaryonun bu aya yazılan beklenen tahsilat farkı. */
  changeCents: number
  netCents: number
  cumulativeNetCents: number
}

export interface ScenarioCashFlow {
  from: string
  to: string
  /** Farkın yayıldığı aylar (eğitim yılının bu aydan sonraki ayları); yıl bittiyse `null`. */
  spreadFrom: string | null
  spreadTo: string | null
  spreadMonths: number
  onTimeRateBasisPoints: number
  baseline: { month: string; netCents: number; cumulativeNetCents: number }[]
  scenarios: {
    months: ScenarioCashFlowMonth[]
    totalChangeCents: number
    /** Seçilen dönemden sonraki aylara düşen fark (planlanan, oran uygulanmadan). */
    beyondHorizonChangeCents: number
  }[]
}

export interface FinanceScenarioComparison {
  year: number
  enrollmentYear: number
  today: string
  baseline: ScenarioOutcome
  scenarios: (ScenarioOutcome & { parameters: FinanceScenario })[]
  assumptions: {
    pipelineStatus: PipelineStatus
    /** Temel indirim ve burs oranı (gelir tahmininden). */
    discountRateBasisPoints: number
    /** Öğrencisi olmayan segmentte eklenen öğrencinin brüt birim fiyatı (sözleşme liste ortalaması). */
    fallbackGrossCents: number | null
    tariffYear: number | null
    tariffCarriedOver: boolean
  }
  cashFlow: ScenarioCashFlow | null
}

// --- Hesap ---------------------------------------------------------------------------------------

const twoDecimals = (value: number) => Math.round(value * 100) / 100

interface SegmentBase {
  contractedStudents: number
  contractedCents: number
  /** Sözleşmesiz beklenen öğrenci (huni) ve neti. */
  openStudents: number
  openCents: number
}

interface Pricing {
  baseRate: number
  nextRate: number
  /** Fiyat çarpanı, on binde bir (`%25` artış → 12.500). */
  priceFactor: number
  fallbackGrossCents: number | null
}

function targetStudents(base: number, change: StudentChange): number {
  const target =
    change.unit === 'percent' ? (base * (BASIS + change.value)) / BASIS : base + change.value
  return Math.max(0, target)
}

/**
 * Senaryodaki öğrenci başına net. Temel birim net temel indirim oranıyla hesaplanmıştır; yeni fiyat
 * ve oranla ölçeklenir. Birim bilinmiyorsa ya da temel oran %100 ise (brüt netten bulunamaz) yedek
 * brüt fiyat kullanılır; o da yoksa `null`.
 */
function repricedUnit(unitNet: number | null, pricing: Pricing): number | null {
  const { baseRate, nextRate, priceFactor } = pricing
  if (unitNet !== null && baseRate < BASIS)
    return (unitNet * priceFactor * (BASIS - nextRate)) / (BASIS * (BASIS - baseRate))
  if (pricing.fallbackGrossCents !== null)
    return (pricing.fallbackGrossCents * priceFactor * (BASIS - nextRate)) / (BASIS * BASIS)
  return null
}

function scenarioSegment(
  base: SegmentBase,
  change: StudentChange,
  applyToExisting: boolean,
  pricing: Pricing,
): ScenarioSegment {
  const contracted = base.contractedStudents
  const total = contracted + base.openStudents
  const target = targetStudents(total, change)
  const kept = Math.min(contracted, target)
  if (applyToExisting) {
    const unit = total > 0 ? (base.contractedCents + base.openCents) / total : null
    const repriced = target > 0 ? repricedUnit(unit, pricing) : 0
    return {
      students: twoDecimals(target),
      contractedStudents: twoDecimals(kept),
      netCents: repriced === null ? 0 : Math.round(target * repriced),
      unpricedStudents: repriced === null ? twoDecimals(target) : 0,
    }
  }
  // Mevcut sözleşmeler değişmez: önce huni (belirsiz) azalır, sonra sözleşmeli öğrenci.
  const keptCents =
    kept === contracted
      ? base.contractedCents
      : Math.round((base.contractedCents * kept) / contracted)
  const rest = target - kept
  const restUnit =
    base.openStudents > 0
      ? base.openCents / base.openStudents
      : contracted > 0
        ? base.contractedCents / contracted
        : null
  const repriced = rest > 0 ? repricedUnit(restUnit, pricing) : 0
  return {
    students: twoDecimals(target),
    contractedStudents: twoDecimals(kept),
    netCents: keptCents + (repriced === null ? 0 : Math.round(rest * repriced)),
    unpricedStudents: repriced === null ? twoDecimals(rest) : 0,
  }
}

const differenceRate = (difference: number, base: number) =>
  base > 0 ? Math.round((difference * BASIS) / base) : null

function segmentsOf(forecast: RevenueForecast): {
  newEnrollment: SegmentBase
  renewal: SegmentBase
} {
  return {
    newEnrollment: {
      contractedStudents: forecast.committed.newStudents,
      contractedCents: forecast.committed.newEnrollmentCents,
      openStudents: forecast.pipeline?.expectedEnrollments ?? 0,
      openCents: forecast.pipeline?.netCents ?? 0,
    },
    // Yenilemesi yapılmamış öğrencinin olasılıklı geliri tahminde yoktur (K-70).
    renewal: {
      contractedStudents: forecast.committed.renewalStudents,
      contractedCents: forecast.committed.renewalCents,
      openStudents: 0,
      openCents: 0,
    },
  }
}

const baselineSegment = (base: SegmentBase): ScenarioSegment => ({
  students: twoDecimals(base.contractedStudents + base.openStudents),
  contractedStudents: base.contractedStudents,
  netCents: base.contractedCents + base.openCents,
  unpricedStudents: 0,
})

/** Bir senaryonun sonucu; değişimsiz senaryo temeli verir. */
export function scenarioOutcome(
  forecast: RevenueForecast,
  scenario: FinanceScenario,
): ScenarioOutcome {
  const baseRate = forecast.assumptions.discountRateBasisPoints
  const pricing: Pricing = {
    baseRate,
    nextRate: Math.min(BASIS, Math.max(0, baseRate + scenario.discountChangeBasisPoints)),
    priceFactor: BASIS + scenario.priceChangeBasisPoints,
    fallbackGrossCents: forecast.assumptions.contractAverageCents,
  }
  const segments = segmentsOf(forecast)
  const newEnrollment = scenarioSegment(
    segments.newEnrollment,
    scenario.newStudents,
    scenario.applyToExistingContracts,
    pricing,
  )
  const renewal = scenarioSegment(
    segments.renewal,
    scenario.renewalStudents,
    scenario.applyToExistingContracts,
    pricing,
  )
  const expectedTotalCents = newEnrollment.netCents + renewal.netCents
  const differenceCents = expectedTotalCents - forecast.expectedTotalCents
  return {
    newEnrollment,
    renewal,
    discountRateBasisPoints: pricing.nextRate,
    expectedTotalCents,
    differenceCents,
    differenceBasisPoints: differenceRate(differenceCents, forecast.expectedTotalCents),
  }
}

/** Eğitim yılının (1 Eylül – 31 Ağustos) bu aydan sonraki ayları. */
function spreadMonthsOf(year: number, today: string): string[] {
  const current = today.slice(0, 7)
  const yearStart = `${String(year)}-09`
  const yearEnd = `${String(year + 1)}-08`
  const months: string[] = []
  let month = current > yearStart ? current : yearStart
  while (month <= yearEnd) {
    months.push(month)
    month = addMonthKey(month, 1)
  }
  return months
}

/** Tutarı aylara eşit böler; kalan kuruş son aya yazılır (toplam korunur). */
function spread(cents: number, count: number): number[] {
  if (count === 0) return []
  const share = Math.trunc(cents / count)
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? cents - share * (count - 1) : share,
  )
}

/**
 * Senaryoların nakit akışına etkisi: gelir farkı eğitim yılının kalan aylarına eşit yayılır, her
 * aydaki pay temel tahmindeki vadesinde tahsil oranıyla beklenen tahsilata çevrilir (DOM-FIN-063).
 */
export function scenarioCashFlow(
  base: CashFlowForecast,
  year: number,
  differences: readonly number[],
): ScenarioCashFlow {
  const months = spreadMonthsOf(year, base.today)
  const onTime = base.assumptions.onTimeRateBasisPoints
  let baseCumulative = 0
  const baseline = base.months.map((month) => {
    baseCumulative += month.netCents
    return { month: month.month, netCents: month.netCents, cumulativeNetCents: baseCumulative }
  })
  return {
    from: base.from,
    to: base.to,
    spreadFrom: months[0] ?? null,
    spreadTo: months[months.length - 1] ?? null,
    spreadMonths: months.length,
    onTimeRateBasisPoints: onTime,
    baseline,
    scenarios: differences.map((difference) => {
      const shares = new Map(
        spread(difference, months.length).map((share, index) => [months[index] ?? '', share]),
      )
      let cumulative = 0
      const rows = base.months.map((month): ScenarioCashFlowMonth => {
        const changeCents = applyBasisPoints(shares.get(month.month) ?? 0, onTime)
        const netCents = month.netCents + changeCents
        cumulative += netCents
        return { month: month.month, changeCents, netCents, cumulativeNetCents: cumulative }
      })
      let beyond = 0
      for (const [month, share] of shares) if (month > base.to) beyond += share
      return {
        months: rows,
        totalChangeCents: rows.reduce((total, row) => total + row.changeCents, 0),
        beyondHorizonChangeCents: beyond,
      }
    }),
  }
}

/**
 * Senaryo karşılaştırması (DOM-FIN-067): temel gelir tahmini ile her senaryonun sonucu; nakit akışı
 * tahmini verilirse senaryoların aylık tahsilat etkisi.
 */
export function financeScenarioComparison(input: {
  forecast: RevenueForecast
  scenarios: readonly FinanceScenario[]
  cashFlow: CashFlowForecast | null
}): FinanceScenarioComparison {
  const { forecast } = input
  const segments = segmentsOf(forecast)
  const scenarios = input.scenarios.map((parameters) => ({
    ...scenarioOutcome(forecast, parameters),
    parameters,
  }))
  return {
    year: forecast.year,
    enrollmentYear: forecast.enrollmentYear,
    today: forecast.today,
    baseline: {
      newEnrollment: baselineSegment(segments.newEnrollment),
      renewal: baselineSegment(segments.renewal),
      discountRateBasisPoints: forecast.assumptions.discountRateBasisPoints,
      expectedTotalCents: forecast.expectedTotalCents,
      differenceCents: 0,
      differenceBasisPoints: differenceRate(0, forecast.expectedTotalCents),
    },
    scenarios,
    assumptions: {
      pipelineStatus: forecast.assumptions.pipelineStatus,
      discountRateBasisPoints: forecast.assumptions.discountRateBasisPoints,
      fallbackGrossCents: forecast.assumptions.contractAverageCents,
      tariffYear: forecast.assumptions.tariffYear,
      tariffCarriedOver: forecast.assumptions.tariffCarriedOver,
    },
    cashFlow:
      input.cashFlow === null
        ? null
        : scenarioCashFlow(
            input.cashFlow,
            forecast.year,
            scenarios.map((scenario) => scenario.differenceCents),
          ),
  }
}

// --- CSV -----------------------------------------------------------------------------------------

const studentsCell = (value: number) => csvAmount(Math.round(value * 100))
const rateCell = (points: number | null) => (points === null ? csvCell('') : csvAmount(points))
const changeLabel = (change: StudentChange) =>
  change.unit === 'percent'
    ? `%${(change.value / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`
    : `${String(Math.abs(change.value))} öğrenci${change.value > 0 ? ' artış' : change.value < 0 ? ' azalış' : ''}`

/**
 * Karşılaştırma dökümü: satır ölçüt, sütun temel ve senaryolar (ad sırasıyla). Tutar iki ondalık,
 * oran yüzde; nakit akışı varsa ay başına net satırları eklenir.
 */
export function financeScenarioCsv(
  comparison: Pick<FinanceScenarioComparison, 'baseline' | 'scenarios' | 'cashFlow'>,
  names: readonly string[],
): string {
  const columns = [comparison.baseline, ...comparison.scenarios]
  const header = [
    'Ölçüt',
    'Temel',
    ...comparison.scenarios.map((_, i) => names[i] ?? `Senaryo ${String(i + 1)}`),
  ]
  const blank = csvCell('')
  const parameterRow = (label: string, cell: (parameters: FinanceScenario) => string): string[] => [
    csvCell(label),
    blank,
    ...comparison.scenarios.map((s) => cell(s.parameters)),
  ]
  const outcomeRow = (label: string, cell: (outcome: ScenarioOutcome) => string): string[] => [
    csvCell(label),
    ...columns.map(cell),
  ]
  const lines: string[][] = [
    header.map(csvCell),
    parameterRow('Yeni kayıt değişimi', (p) => csvCell(changeLabel(p.newStudents))),
    parameterRow('Yenileme değişimi', (p) => csvCell(changeLabel(p.renewalStudents))),
    parameterRow('Fiyat değişimi (%)', (p) => csvAmount(p.priceChangeBasisPoints)),
    parameterRow('İndirim ve burs değişimi (puan)', (p) => csvAmount(p.discountChangeBasisPoints)),
    parameterRow('Mevcut sözleşmelere uygulanır', (p) =>
      csvCell(p.applyToExistingContracts ? 'Evet' : 'Hayır'),
    ),
    outcomeRow('Yeni kayıt öğrenci', (o) => studentsCell(o.newEnrollment.students)),
    outcomeRow('Yenileme öğrenci', (o) => studentsCell(o.renewal.students)),
    outcomeRow('Yeni kayıt geliri', (o) => csvAmount(o.newEnrollment.netCents)),
    outcomeRow('Yenileme geliri', (o) => csvAmount(o.renewal.netCents)),
    outcomeRow('İndirim ve burs oranı (%)', (o) => rateCell(o.discountRateBasisPoints)),
    outcomeRow('Beklenen toplam', (o) => csvAmount(o.expectedTotalCents)),
    outcomeRow('Temele göre fark', (o) => csvAmount(o.differenceCents)),
    outcomeRow('Temele göre fark (%)', (o) => rateCell(o.differenceBasisPoints)),
  ]
  const cash = comparison.cashFlow
  if (cash !== null)
    cash.baseline.forEach((month, index) =>
      lines.push([
        csvCell(`Nakit akışı net · ${month.month}`),
        csvAmount(month.netCents),
        ...cash.scenarios.map((scenario) => csvAmount(scenario.months[index]?.netCents ?? 0)),
      ]),
    )
  return lines.map((line) => line.join(CSV_SEPARATOR)).join('\r\n')
}
