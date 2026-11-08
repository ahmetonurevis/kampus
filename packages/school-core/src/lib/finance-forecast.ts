import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { ACADEMIC_YEAR_MAX, ACADEMIC_YEAR_MIN, addDays } from './academic-years.ts'
import { isContractInForce } from './contract-status.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import {
  FUNNEL_STEPS,
  funnelReach,
  funnelStepLabel,
  funnelSteps,
  type FunnelProspect,
  type FunnelStep,
} from './enrollment-funnel.ts'
import type { FeeItem } from './fee-tariffs.ts'
import { dayKey } from './format.ts'
import { OPEN_PROSPECT_STAGES } from './prospects.ts'

/**
 * Gelir ve nakit akışı tahmini (docs/domain/finans.md DOM-FIN-063; IST-104, IST-105, IST-117; ON-246,
 * ON-247). Saf hesap: servis kurumun taksit, sözleşme, yenileme, aday, tarife ve iade satırlarını
 * yükler; sonuç kişi adı, aday kimliği ya da iletişim bilgisi taşımaz. Oranlar on binde birdir
 * (`%12,5` → 1250), tutarlar kuruş tamsayı; her çarpım kaleminde kuruşa yuvarlanır. Varsayımlar
 * yanıtta döner, ekran metni istemcidedir.
 */

/**
 * Raporu okuyan roller. Muhasebe rolü platformda açılınca (`DOM-FIN-057`, OG-110) bu diziye eklenir.
 */
export const FINANCE_FORECAST_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** Huni örneklemi ve sayılan açık adaylar: son 24 ayda açılmış adaylar (K-65). */
export const FORECAST_HISTORY_MONTHS = 24
/** Tahsil oranı örneklemi: son 12 ayda vadesi gelmiş taksitler (K-67). */
export const COLLECTION_HISTORY_MONTHS = 12
/** Vadeden sonra bu kadar gün içinde tam ödenen taksit vadesinde tahsil edilmiş sayılır. */
export const COLLECTION_GRACE_DAYS = 30
export const CASH_FLOW_DEFAULT_MONTHS = 12
export const CASH_FLOW_MAX_MONTHS = 24
/** Elle girilen aylık gider tahmininin üst sınırı (100.000.000 ₺). */
export const MONTHLY_EXPENSE_MAX_CENTS = 10_000_000_000

const BASIS = 10_000

const forecastYearSchema = z.coerce
  .number('Eğitim yılını seçin.')
  .int('Eğitim yılını seçin.')
  .min(ACADEMIC_YEAR_MIN, 'Eğitim yılı geçersiz.')
  .max(ACADEMIC_YEAR_MAX, 'Eğitim yılı geçersiz.')

export const revenueForecastQuerySchema = z.strictObject({
  /** Verilmezse kurumun kayıt yılı (kesin kaydın yazıldığı eğitim yılı). */
  year: forecastYearSchema.optional(),
})
export type RevenueForecastQuery = z.output<typeof revenueForecastQuerySchema>

export const cashFlowForecastQuerySchema = z.strictObject({
  months: z.coerce
    .number('Ay sayısını girin.')
    .int('Ay sayısı tam sayı olmalıdır.')
    .min(1, 'En az 1 ay seçin.')
    .max(CASH_FLOW_MAX_MONTHS, `En fazla ${String(CASH_FLOW_MAX_MONTHS)} ay seçebilirsiniz.`)
    .default(CASH_FLOW_DEFAULT_MONTHS),
  /** Aylık gider tahmini, kuruş; verilmezse gider boştur ("gider verisi yok"). */
  monthlyExpenseCents: z.coerce
    .number('Aylık gideri girin.')
    .int('Gider kuruş cinsinden tam sayı olmalıdır.')
    .min(0, 'Gider eksi olamaz.')
    .max(MONTHLY_EXPENSE_MAX_CENTS, 'Gider en fazla 100.000.000 ₺ olabilir.')
    .optional(),
})
export type CashFlowForecastQuery = z.output<typeof cashFlowForecastQuerySchema>

// --- Yardımcılar ---------------------------------------------------------------------------------

/** Oran, on binde bir; payda 0 ise `null`. */
export function basisPoints(part: number, whole: number): number | null {
  if (whole <= 0) return null
  return Math.round((part * BASIS) / whole)
}

/** Tutara oran uygular, kuruşa yuvarlar. */
export const applyBasisPoints = (cents: number, points: number) =>
  Math.round((cents * points) / BASIS)

/** Takvim gününü ay kaydırır; hedef ayda olmayan gün ayın son gününe iner (31 Mart − 1 ay → 28/29 Şubat). */
export function shiftMonths(day: string, months: number): string {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7)) - 1 + months
  const target = new Date(Date.UTC(year, month, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(Number(day.slice(8, 10)), last))
  return target.toISOString().slice(0, 10)
}

/** Ay anahtarına (`YYYY-MM`) ay ekler. */
export function addMonthKey(month: string, count: number): string {
  return shiftMonths(`${month}-01`, count).slice(0, 7)
}

/** Kayıtlı aralığı olmayan günün eğitim yılı: 1 Eylül – 31 Ağustos. */
export const schoolYearOfDay = (day: string) =>
  Number(day.slice(5, 7)) >= 9 ? Number(day.slice(0, 4)) : Number(day.slice(0, 4)) - 1

const CEFR_LEVEL = /(?:^|[^A-Za-z])(PRE-A1|A1|A2\+?|B1\+?|B2\+?|C1|C2)(?![A-Za-z0-9+])/i
const GRADE_LEVEL = /(?:^|\D)(\d{1,2})(?!\d)/

/**
 * Düzey anahtarı: CEFR düzeyi (`B1+`), yoksa ilk sayı (`7. Sınıf` → `7`, `07` → `7`), yoksa metnin
 * kendisi. Tarife kalemi düzeyi ve adayın ilgi alanı aynı anahtara indirilir.
 */
export function levelKey(text: string | null | undefined): string | null {
  const value = text?.trim() ?? ''
  if (value === '') return null
  const cefr = CEFR_LEVEL.exec(value)
  if (cefr?.[1] !== undefined) return cefr[1].toUpperCase()
  const grade = GRADE_LEVEL.exec(value)
  if (grade?.[1] !== undefined) return String(Number(grade[1]))
  return value.toLocaleUpperCase('tr-TR')
}

const sumOf = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

// --- Gelir tahmini (ON-246) ----------------------------------------------------------------------

export type ForecastInvoice = Pick<
  State['invoices'][number],
  'id' | 'studentId' | 'amount' | 'dueDate' | 'paidAt'
> & { academicYear?: number | undefined; contractId?: string | undefined }

export type ForecastContract = Pick<
  State['contracts'][number],
  | 'id'
  | 'studentId'
  | 'amount'
  | 'date'
  | 'academicYear'
  | 'invoiceIds'
  | 'grossCents'
  | 'discounts'
  | 'extras'
  | 'scholarship'
  | 'approval'
  | 'signatory'
  | 'amendsContractId'
  | 'cancelledAt'
>

export type ForecastRenewal = { studentId: string; year: number; status: string }

export type ForecastProspect = FunnelProspect & {
  interest?: string | null | undefined
  createdAt?: string | null | undefined
}

export type ForecastTariff = {
  academicYear: number
  items: readonly Pick<FeeItem, 'kind' | 'level' | 'amountCents' | 'unit'>[]
}

export interface RevenueForecastInput {
  year: number
  /** Kesin kaydın yazıldığı eğitim yılı (kurum ayarı); huni bu yıl ve sonrası için hesaplanır. */
  enrollmentYear: number
  institutionType: InstitutionType
  today: string
  invoices: readonly ForecastInvoice[]
  contracts: readonly ForecastContract[]
  renewals: readonly ForecastRenewal[]
  /** `null`: `crm` modülü kapalı, adaylar okunmadı. */
  prospects: readonly ForecastProspect[] | null
  /** Yılın yayımlı tarifesi, yoksa bir önceki yılınki; ikisi de yoksa `null`. */
  tariff: ForecastTariff | null
}

export type ForecastPriceSource = 'tariffLevel' | 'tariffAverage' | 'contractAverage' | 'none'
export type PipelineStatus = 'included' | 'crm_disabled' | 'past_year'

/** Huni beklentisinin adımları: kesin kayıt adımı beklenti değil, sonuçtur. */
export type PipelineStep = Exclude<FunnelStep, 'enrolled'>
export const PIPELINE_STEPS = [
  'prospect',
  'meeting',
  'trial',
] as const satisfies readonly PipelineStep[]
const isPipelineStep = (step: FunnelStep): step is PipelineStep => step !== 'enrolled'

export interface PipelineStepForecast {
  step: PipelineStep
  /** Bu adımda bekleyen açık aday sayısı. */
  prospects: number
  /** Örneklemde bu adıma ulaşan kapanmış aday sayısı. */
  sampleSize: number
  /** Adımdan kesin kayda dönüşüm oranı, on binde bir; örneklem boşsa `null`. */
  rateBasisPoints: number | null
  grossCents: number
  discountCents: number
  netCents: number
}

export interface RevenueForecast {
  year: number
  enrollmentYear: number
  today: string
  committed: {
    totalCents: number
    newEnrollmentCents: number
    renewalCents: number
    students: number
    newStudents: number
    renewalStudents: number
  }
  /** Yılın yürürlükteki sözleşmeleri: liste fiyatı, indirim ve burs (bilgi; kesin gelir nettir). */
  contracts: {
    count: number
    listCents: number
    discountCents: number
    scholarshipCents: number
    netCents: number
  }
  pipeline: {
    prospects: number
    steps: PipelineStepForecast[]
    grossCents: number
    discountCents: number
    netCents: number
    /** Fiyatı bulunamadığı için beklentiye girmeyen aday sayısı. */
    unpricedProspects: number
    /** Adımının örneklemi boş olduğu için beklentiye girmeyen aday sayısı. */
    unratedProspects: number
    /**
     * Beklentiye giren adaylardan beklenen kesin kayıt sayısı (oranların toplamı; kesirli, dört
     * ondalık). Senaryo analizi (DOM-FIN-067) öğrenci başına huni netini bundan bulur.
     */
    expectedEnrollments: number
  } | null
  expectedTotalCents: number
  assumptions: {
    pipelineStatus: PipelineStatus
    historyFrom: string
    historyTo: string
    historyClosedProspects: number
    tariffYear: number | null
    tariffCarriedOver: boolean
    discountReferenceYear: number | null
    discountRateBasisPoints: number
    contractAverageCents: number | null
    priceSources: Record<ForecastPriceSource, number>
  }
}

type PricedContract = ForecastContract & { grossCents: number }

const hasTerms = (contract: ForecastContract): contract is PricedContract =>
  typeof contract.grossCents === 'number' && contract.grossCents > 0

function contractYear(contract: ForecastContract): number {
  return contract.academicYear ?? schoolYearOfDay(dayKey(contract.date))
}

function invoiceYearResolver(contracts: readonly ForecastContract[]) {
  const byId = new Map(contracts.map((contract) => [contract.id, contract]))
  const byInvoice = new Map<string, ForecastContract>()
  for (const contract of contracts)
    for (const invoiceId of contract.invoiceIds ?? []) byInvoice.set(invoiceId, contract)
  return (invoice: ForecastInvoice): number => {
    if (invoice.academicYear !== undefined) return invoice.academicYear
    const contract =
      (invoice.contractId === undefined ? undefined : byId.get(invoice.contractId)) ??
      byInvoice.get(invoice.id)
    return contract === undefined
      ? schoolYearOfDay(dayKey(invoice.dueDate))
      : contractYear(contract)
  }
}

const isClosed = (prospect: ForecastProspect) =>
  prospect.stage === 'Kayıt oldu' ||
  prospect.stage === 'Vazgeçti' ||
  (typeof prospect.studentId === 'string' && prospect.studentId !== '')

const OPEN_STAGES: readonly string[] = OPEN_PROSPECT_STAGES

const isOpen = (prospect: ForecastProspect) =>
  typeof prospect.stage === 'string' && OPEN_STAGES.includes(prospect.stage) && !isClosed(prospect)

/**
 * Gelir tahmini (DOM-FIN-063): kesin gelir (yılın iptal edilmemiş taksitleri), indirim etkisi (yılın
 * yürürlükteki sözleşmeleri) ve huni beklentisi (açık adaylar × adım dönüşüm oranı × birim fiyat −
 * indirim oranı).
 */
export function revenueForecast(input: RevenueForecastInput): RevenueForecast {
  const { year, today } = input

  // Kesin gelir.
  const yearOf = invoiceYearResolver(input.contracts)
  const renewed = new Set(
    input.renewals
      .filter((renewal) => renewal.year === year && renewal.status !== 'İptal')
      .map((renewal) => renewal.studentId),
  )
  const committed = {
    totalCents: 0,
    newEnrollmentCents: 0,
    renewalCents: 0,
    students: 0,
    newStudents: 0,
    renewalStudents: 0,
  }
  const students = new Set<string>()
  for (const invoice of input.invoices) {
    if (yearOf(invoice) !== year) continue
    committed.totalCents += invoice.amount
    if (renewed.has(invoice.studentId)) committed.renewalCents += invoice.amount
    else committed.newEnrollmentCents += invoice.amount
    students.add(invoice.studentId)
  }
  committed.students = students.size
  committed.renewalStudents = [...students].filter((id) => renewed.has(id)).length
  committed.newStudents = committed.students - committed.renewalStudents

  // İndirim etkisi.
  const inForce = input.contracts.filter((contract) => isContractInForce(contract, input.contracts))
  const ofYear = inForce.filter((contract) => contractYear(contract) === year)
  const contracts = { count: ofYear.length, listCents: 0, discountCents: 0, scholarshipCents: 0 }
  for (const contract of ofYear) {
    const extras = sumOf((contract.extras ?? []).map((extra) => extra.amountCents))
    contracts.listCents += hasTerms(contract) ? contract.grossCents + extras : contract.amount
    contracts.discountCents += sumOf((contract.discounts ?? []).map((line) => line.amountCents))
    contracts.scholarshipCents += contract.scholarship?.amountCents ?? 0
  }
  const contractTotals = { ...contracts, netCents: sumOf(ofYear.map((item) => item.amount)) }

  // İndirim oranı ve sözleşme ortalaması: yılın tarifeli sözleşmeleri, yoksa önceki yılınkiler.
  const priced = (target: number) =>
    inForce.filter((contract) => contractYear(contract) === target).filter(hasTerms)
  const current = priced(year)
  const referenceYear = current.length > 0 ? year : priced(year - 1).length > 0 ? year - 1 : null
  const reference = referenceYear === null ? [] : priced(referenceYear)
  const referenceGross = sumOf(reference.map((contract) => contract.grossCents))
  const referenceReduction = sumOf(
    reference.map(
      (contract) =>
        sumOf((contract.discounts ?? []).map((line) => line.amountCents)) +
        (contract.scholarship?.amountCents ?? 0),
    ),
  )
  const discountRate = Math.min(BASIS, basisPoints(referenceReduction, referenceGross) ?? 0)
  const contractAverage =
    reference.length === 0 ? null : Math.round(referenceGross / reference.length)

  // Birim fiyat: düzeyi eşleşen yıllık öğrenim kalemi, yıllık kalemlerin ortalaması, sözleşme ortalaması.
  const yearly = (input.tariff?.items ?? []).filter(
    (item) => item.kind === 'tuition' && item.unit === 'year',
  )
  const byLevel = new Map<string, number>()
  for (const item of yearly) {
    const key = levelKey(item.level)
    if (key !== null && !byLevel.has(key)) byLevel.set(key, item.amountCents)
  }
  const yearlyAverage =
    yearly.length === 0
      ? null
      : Math.round(sumOf(yearly.map((item) => item.amountCents)) / yearly.length)
  function priceOf(prospect: ForecastProspect): {
    cents: number | null
    source: ForecastPriceSource
  } {
    const key = levelKey(prospect.interest)
    const level = key === null ? undefined : byLevel.get(key)
    if (level !== undefined) return { cents: level, source: 'tariffLevel' }
    if (yearlyAverage !== null) return { cents: yearlyAverage, source: 'tariffAverage' }
    if (contractAverage !== null) return { cents: contractAverage, source: 'contractAverage' }
    return { cents: null, source: 'none' }
  }

  const historyFrom = shiftMonths(today, -FORECAST_HISTORY_MONTHS)
  const priceSources: Record<ForecastPriceSource, number> = {
    tariffLevel: 0,
    tariffAverage: 0,
    contractAverage: 0,
    none: 0,
  }
  const pipelineStatus: PipelineStatus =
    input.prospects === null
      ? 'crm_disabled'
      : year < input.enrollmentYear
        ? 'past_year'
        : 'included'
  const inWindow = (prospect: ForecastProspect) => {
    if (typeof prospect.createdAt !== 'string' || prospect.createdAt === '') return false
    const day = dayKey(prospect.createdAt)
    return day >= historyFrom && day <= today
  }
  const windowed = (input.prospects ?? []).filter(inWindow)
  const closed = windowed.filter(isClosed)
  const stepIndex = (prospect: ForecastProspect) =>
    FUNNEL_STEPS.indexOf(funnelReach(prospect, input.institutionType))
  const enrolledIndex = FUNNEL_STEPS.indexOf('enrolled')

  let pipeline: RevenueForecast['pipeline'] = null
  if (pipelineStatus === 'included') {
    const open = windowed.filter(isOpen)
    let unpriced = 0
    let unrated = 0
    let expectedBasisPoints = 0
    const steps = funnelSteps(input.institutionType)
      .filter(isPipelineStep)
      .map((step): PipelineStepForecast => {
        const index = FUNNEL_STEPS.indexOf(step)
        const reached = closed.filter((prospect) => stepIndex(prospect) >= index)
        const enrolled = reached.filter((prospect) => stepIndex(prospect) === enrolledIndex)
        const rate = basisPoints(enrolled.length, reached.length)
        const waiting = open.filter(
          (prospect) => funnelReach(prospect, input.institutionType) === step,
        )
        let grossCents = 0
        let discountCents = 0
        for (const prospect of waiting) {
          const price = priceOf(prospect)
          priceSources[price.source] += 1
          if (price.cents === null) {
            unpriced += 1
            continue
          }
          if (rate === null) {
            unrated += 1
            continue
          }
          expectedBasisPoints += rate
          const gross = applyBasisPoints(price.cents, rate)
          grossCents += gross
          discountCents += applyBasisPoints(gross, discountRate)
        }
        return {
          step,
          prospects: waiting.length,
          sampleSize: reached.length,
          rateBasisPoints: rate,
          grossCents,
          discountCents,
          netCents: grossCents - discountCents,
        }
      })
    pipeline = {
      prospects: open.length,
      steps,
      grossCents: sumOf(steps.map((step) => step.grossCents)),
      discountCents: sumOf(steps.map((step) => step.discountCents)),
      netCents: sumOf(steps.map((step) => step.netCents)),
      unpricedProspects: unpriced,
      unratedProspects: unrated,
      expectedEnrollments: expectedBasisPoints / BASIS,
    }
  }

  return {
    year,
    enrollmentYear: input.enrollmentYear,
    today,
    committed,
    contracts: contractTotals,
    pipeline,
    expectedTotalCents: committed.totalCents + (pipeline?.netCents ?? 0),
    assumptions: {
      pipelineStatus,
      historyFrom,
      historyTo: today,
      historyClosedProspects: closed.length,
      tariffYear: input.tariff?.academicYear ?? null,
      tariffCarriedOver: input.tariff !== null && input.tariff.academicYear !== year,
      discountReferenceYear: referenceYear,
      discountRateBasisPoints: discountRate,
      contractAverageCents: contractAverage,
      priceSources,
    },
  }
}

// --- Nakit akışı tahmini (ON-247) ----------------------------------------------------------------

export type CashFlowInvoice = Pick<
  State['invoices'][number],
  'id' | 'amount' | 'dueDate' | 'paidAt'
>

export interface PendingRefund {
  refundCents: number
  /** İadenin son ödeme günü (`YYYY-MM-DD`). */
  refundDueDate: string
}

export interface CashFlowInput {
  today: string
  months: number
  /** Elle girilen aylık gider tahmini; `null` gider verisi yok. */
  monthlyExpenseCents: number | null
  invoices: readonly CashFlowInvoice[]
  /** Taksite dağıtılmış, iptal edilmemiş tahsilat toplamları. */
  allocated: ReadonlyMap<string, number>
  pendingRefunds: readonly PendingRefund[]
}

export interface CashFlowMonth {
  /** `YYYY-MM`, Europe/Istanbul. */
  month: string
  scheduledCents: number
  expectedCollectionCents: number
  atRiskCents: number
  overdueRecoveryCents: number
  refundCents: number
  expenseCents: number | null
  netCents: number
  cumulativeNetCents: number
}

export type CashFlowTotals = Omit<CashFlowMonth, 'month' | 'cumulativeNetCents'>

export interface CashFlowForecast {
  today: string
  from: string
  to: string
  months: CashFlowMonth[]
  totals: CashFlowTotals
  /** Bugün vadesi geçmiş açık tutar. */
  overdueOpenCents: number
  /** Ufuktan sonra vadesi gelen kalan tutar. */
  beyondHorizonCents: number
  /** Ödenmemiş bütün ayrılış iadeleri (ufuk dışındakiler dahil). */
  pendingRefundCents: number
  assumptions: {
    historyFrom: string
    historyTo: string
    historyInvoices: number
    historyAmountCents: number
    graceDays: number
    onTimeRateBasisPoints: number
    onTimeRateSource: 'history' | 'default'
    lateRecoveryRateBasisPoints: number
    lateRecoveryRateSource: 'history' | 'default'
    expenseSource: 'manual' | 'none'
  }
}

/**
 * Nakit akışı tahmini (DOM-FIN-063): bu aydan başlayarak aylık planlanan tahsilat (vadesi bugün ya da
 * sonra olan kalan tutar), geçmiş tahsil oranıyla beklenen tahsilat, gecikmiş alacaktan ilk aya geç
 * tahsil beklentisi, ödenmemiş iade ve elle girilen gider.
 */
export function cashFlowForecast(input: CashFlowInput): CashFlowForecast {
  const { today } = input
  const remaining = (invoice: CashFlowInvoice) =>
    invoice.paidAt
      ? 0
      : Math.max(0, invoice.amount - Math.min(input.allocated.get(invoice.id) ?? 0, invoice.amount))

  // Tahsil oranı örneklemi.
  const historyFrom = shiftMonths(today, -COLLECTION_HISTORY_MONTHS)
  const historyTo = addDays(today, -COLLECTION_GRACE_DAYS)
  let historyInvoices = 0
  let historyAmount = 0
  let onTime = 0
  let late = 0
  let lateRecovered = 0
  for (const invoice of input.invoices) {
    const due = dayKey(invoice.dueDate)
    if (due < historyFrom || due > historyTo) continue
    historyInvoices += 1
    historyAmount += invoice.amount
    const paid = invoice.paidAt ? dayKey(invoice.paidAt) : null
    if (paid !== null && paid <= addDays(due, COLLECTION_GRACE_DAYS)) onTime += invoice.amount
    else {
      late += invoice.amount
      if (paid !== null) lateRecovered += invoice.amount
    }
  }
  const onTimeHistory = basisPoints(onTime, historyAmount)
  const lateHistory = basisPoints(lateRecovered, late)
  const onTimeRate = onTimeHistory ?? BASIS
  const lateRate = lateHistory ?? 0

  // Aylar.
  const first = today.slice(0, 7)
  const keys = Array.from({ length: input.months }, (_, index) => addMonthKey(first, index))
  const last = keys[keys.length - 1] ?? first
  const scheduled = new Map(keys.map((key) => [key, 0]))
  let overdueOpen = 0
  let beyond = 0
  for (const invoice of input.invoices) {
    const open = remaining(invoice)
    if (open === 0) continue
    const due = dayKey(invoice.dueDate)
    if (due < today) overdueOpen += open
    else if (due.slice(0, 7) > last) beyond += open
    else scheduled.set(due.slice(0, 7), (scheduled.get(due.slice(0, 7)) ?? 0) + open)
  }
  const refunds = new Map(keys.map((key) => [key, 0]))
  let pendingRefund = 0
  for (const refund of input.pendingRefunds) {
    if (refund.refundCents <= 0) continue
    pendingRefund += refund.refundCents
    const month =
      refund.refundDueDate.slice(0, 7) < first ? first : refund.refundDueDate.slice(0, 7)
    if (refunds.has(month)) refunds.set(month, (refunds.get(month) ?? 0) + refund.refundCents)
  }

  const expense = input.monthlyExpenseCents
  let cumulative = 0
  const months = keys.map((month, index): CashFlowMonth => {
    const planned = scheduled.get(month) ?? 0
    const expected = applyBasisPoints(planned, onTimeRate)
    const recovery = index === 0 ? applyBasisPoints(overdueOpen, lateRate) : 0
    const refund = refunds.get(month) ?? 0
    const net = expected + recovery - refund - (expense ?? 0)
    cumulative += net
    return {
      month,
      scheduledCents: planned,
      expectedCollectionCents: expected,
      atRiskCents: planned - expected,
      overdueRecoveryCents: recovery,
      refundCents: refund,
      expenseCents: expense,
      netCents: net,
      cumulativeNetCents: cumulative,
    }
  })
  const total = (
    key:
      | 'scheduledCents'
      | 'expectedCollectionCents'
      | 'atRiskCents'
      | 'overdueRecoveryCents'
      | 'refundCents'
      | 'netCents',
  ) => sumOf(months.map((month) => month[key]))
  return {
    today,
    from: first,
    to: last,
    months,
    totals: {
      scheduledCents: total('scheduledCents'),
      expectedCollectionCents: total('expectedCollectionCents'),
      atRiskCents: total('atRiskCents'),
      overdueRecoveryCents: total('overdueRecoveryCents'),
      refundCents: total('refundCents'),
      expenseCents: expense === null ? null : expense * months.length,
      netCents: total('netCents'),
    },
    overdueOpenCents: overdueOpen,
    beyondHorizonCents: beyond,
    pendingRefundCents: pendingRefund,
    assumptions: {
      historyFrom,
      historyTo,
      historyInvoices,
      historyAmountCents: historyAmount,
      graceDays: COLLECTION_GRACE_DAYS,
      onTimeRateBasisPoints: onTimeRate,
      onTimeRateSource: onTimeHistory === null ? 'default' : 'history',
      lateRecoveryRateBasisPoints: lateRate,
      lateRecoveryRateSource: lateHistory === null ? 'default' : 'history',
      expenseSource: expense === null ? 'none' : 'manual',
    },
  }
}

// --- CSV -----------------------------------------------------------------------------------------

const rows = (lines: readonly (readonly string[])[]) =>
  lines.map((line) => line.join(CSV_SEPARATOR)).join('\r\n')
const rate = (points: number | null) => (points === null ? csvCell('') : csvAmount(points))

/** Gelir tahmini dökümü: kesin gelir, huni adımları ve beklenen toplam (oran yüzde, iki ondalık). */
export function revenueForecastCsv(
  forecast: Pick<RevenueForecast, 'committed' | 'pipeline' | 'expectedTotalCents' | 'contracts'>,
  institutionType: InstitutionType,
): string {
  const header = [
    'Kalem',
    'Aday',
    'Örneklem',
    'Dönüşüm oranı (%)',
    'Brüt',
    'İndirim ve burs',
    'Net',
  ]
  const blank = csvCell('')
  const lines: string[][] = [
    header.map(csvCell),
    [
      csvCell('Kesin gelir · yeni kayıt'),
      blank,
      blank,
      blank,
      blank,
      blank,
      csvAmount(forecast.committed.newEnrollmentCents),
    ],
    [
      csvCell('Kesin gelir · yenileme'),
      blank,
      blank,
      blank,
      blank,
      blank,
      csvAmount(forecast.committed.renewalCents),
    ],
    [
      csvCell('Yılın sözleşmeleri · liste fiyatı ve indirim'),
      blank,
      blank,
      blank,
      csvAmount(forecast.contracts.listCents),
      csvAmount(forecast.contracts.discountCents + forecast.contracts.scholarshipCents),
      csvAmount(forecast.contracts.netCents),
    ],
  ]
  for (const step of forecast.pipeline?.steps ?? [])
    lines.push([
      csvCell(`Huni · ${funnelStepLabel(step.step, institutionType)}`),
      csvCell(step.prospects),
      csvCell(step.sampleSize),
      rate(step.rateBasisPoints),
      csvAmount(step.grossCents),
      csvAmount(step.discountCents),
      csvAmount(step.netCents),
    ])
  lines.push([
    csvCell('Beklenen toplam'),
    blank,
    blank,
    blank,
    blank,
    blank,
    csvAmount(forecast.expectedTotalCents),
  ])
  return rows(lines)
}

/** Nakit akışı dökümü: ay başına satır ve toplam; gider verisi yoksa gider hücresi boştur. */
export function cashFlowForecastCsv(forecast: Pick<CashFlowForecast, 'months' | 'totals'>): string {
  const header = [
    'Ay',
    'Planlanan tahsilat',
    'Beklenen tahsilat',
    'Tahsil riski',
    'Gecikmiş alacaktan beklenen',
    'Ödenecek iade',
    'Gider',
    'Net',
    'Kümülatif net',
  ]
  const amounts = (line: CashFlowTotals) => [
    csvAmount(line.scheduledCents),
    csvAmount(line.expectedCollectionCents),
    csvAmount(line.atRiskCents),
    csvAmount(line.overdueRecoveryCents),
    csvAmount(line.refundCents),
    line.expenseCents === null ? csvCell('') : csvAmount(line.expenseCents),
    csvAmount(line.netCents),
  ]
  return rows([
    header.map(csvCell),
    ...forecast.months.map((month) => [
      csvCell(month.month),
      ...amounts(month),
      csvAmount(month.cumulativeNetCents),
    ]),
    [csvCell('Toplam'), ...amounts(forecast.totals), csvCell('')],
  ])
}
