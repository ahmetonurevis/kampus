import { z } from 'zod'

import type { InstitutionType } from '../modules/collection-modules.ts'
import { ACADEMIC_YEAR_MAX, ACADEMIC_YEAR_MIN, defaultAcademicYearDates } from './academic-years.ts'
import { daySchema } from './domain.ts'
import {
  enrollmentFunnel,
  funnelRate,
  type FunnelProspect,
  type FunnelStepCount,
} from './enrollment-funnel.ts'
import {
  enrollmentEvents,
  type EnrollmentRenewal,
  type EnrollmentStudent,
} from './enrollment-status.ts'
import { DomainError } from './errors.ts'
import {
  assertFinancePeriod,
  invoicePaidCents,
  paymentLines,
  type ExportPayment,
  type FinancePeriod,
} from './finance-export.ts'
import {
  packageHourReport,
  type PackageReportSale,
  type PackageReportTotals,
} from './finance-package-report.ts'
import {
  financeReconciliation,
  type ReconciliationAmounts,
  type ReconciliationWithdrawal,
} from './finance-reconciliation.ts'
import { dayKey } from './format.ts'
import { PAYMENT_METHODS, type PaymentMethod } from './payments.ts'
import { WITHDRAWAL_REASONS, type WithdrawalReason } from './withdrawals.ts'

/**
 * Yönetim kurulu raporu (docs/domain/finans.md DOM-FIN-064; ON-251). Seçilen dönemin finans ve kayıt
 * özeti; kişi adı ve kimliği taşımaz. Hiçbir şey saklanmaz, hesap ikinci kez yazılmaz:
 *
 * - Tahakkuk, tahsilat, iptal, iade, burs, indirim, açılış ve kapanış `financeReconciliation`
 *   (DOM-FIN-056) toplamıdır; rapor dönemi mutabakat dönemi olarak verilir.
 * - Yöntem kırılımı `paymentLines` (DOM-FIN-033 gün kuralı), yaşlandırma `invoicePaidCents`
 *   (`/finance/totals` gecikmiş tutarı), paket gelir toplamı `packageHourReport` (DOM-FIN-058),
 *   aday hunisi `enrollmentFunnel` (DOM-KAY-040), kayıt olayları `enrollmentEvents` (DOM-KAY-026).
 * - Kişiyi belli edebilecek küçük kırılım hücreleri bastırılır (K-77, `suppressSmallGroups`).
 *
 * Bütçe–gerçekleşen, maliyet merkezi ve gelir/nakit tahmini (K24 diğer görevleri) bu rapora girmez;
 * o modüller birleşince ayrı bölüm olarak eklenir.
 */

/** Kırılım hücresinde bundan az kişi varsa hücre gizlenir (K-77; OG-766 gelince ona bağlanır). */
export const BOARD_REPORT_MIN_GROUP = 5

/** Yaşlandırma dilimleri, gecikme günüyle (vade gününden sonraki ilk gün 1; DOM-FIN-034). */
export const BOARD_REPORT_AGING_BUCKETS = [
  { key: 'days_1_30', label: '1–30 gün', minDays: 1, maxDays: 30 },
  { key: 'days_31_60', label: '31–60 gün', minDays: 31, maxDays: 60 },
  { key: 'days_61_90', label: '61–90 gün', minDays: 61, maxDays: 90 },
  { key: 'days_91_plus', label: '90 günden fazla', minDays: 91, maxDays: null },
] as const
export type BoardReportAgingBucket = (typeof BOARD_REPORT_AGING_BUCKETS)[number]['key']

export const BOARD_REPORT_PERIOD_KINDS = ['year', 'term', 'custom'] as const
export type BoardReportPeriodKind = (typeof BOARD_REPORT_PERIOD_KINDS)[number]

export const boardReportQuerySchema = z
  .strictObject({
    year: z.coerce
      .number('Eğitim yılını seçin.')
      .int('Eğitim yılını seçin.')
      .min(ACADEMIC_YEAR_MIN, 'Eğitim yılı geçersiz.')
      .max(ACADEMIC_YEAR_MAX, 'Eğitim yılı geçersiz.')
      .describe('Eğitim yılının başlangıç yılı (2026 → 2026–2027)'),
    termId: z
      .string()
      .trim()
      .min(1, 'Dönemi seçin.')
      .max(200)
      .optional()
      .describe('Dil okulunda yılın dönemi; dönem aralığı rapor dönemi olur'),
    from: daySchema.optional().describe('Elle dönem başlangıcı (YYYY-MM-DD)'),
    to: daySchema.optional().describe('Elle dönem bitişi (YYYY-MM-DD)'),
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: 'Dönemin başlangıcını ve bitişini birlikte seçin.',
    path: ['to'],
  })
  .refine((query) => query.termId === undefined || query.from === undefined, {
    message: 'Dönem ya da tarih aralığından yalnız birini seçin.',
    path: ['termId'],
  })
export type BoardReportQuery = z.output<typeof boardReportQuerySchema>

export interface BoardReportTerm {
  id: string
  name: string
  startDate: string
  endDate: string
}

export interface BoardReportPeriod {
  kind: BoardReportPeriodKind
  /** Eğitim yılı; burs, indirim ve yenileme oranı bu yıla göredir. */
  year: number
  from: string
  /** Rapor bitişi: seçilen bitiş, süren dönemde bugün. */
  to: string
  /** Seçilen bitiş günü (bugünden sonra olabilir). */
  endDate: string
  /** Seçilen bitiş geçtiyse `true`; süren dönemde rakamlar bugüne kadardır. */
  complete: boolean
  termId: string | null
  termName: string | null
}

/**
 * Rapor dönemi (K-75): elle aralık önceliklidir, sonra dönem, yoksa eğitim yılı aralığı (kayıt yoksa
 * 1 Eylül – 31 Ağustos). Dönem en çok bir yıldır; ters dönem 422 `export_period_invalid`, uzun dönem
 * 422 `export_period_too_long`, yılda olmayan dönem 422 `board_report_term_not_found`, başlamamış
 * dönem 422 `board_report_period_not_started`. Süren dönemin bitişi bugündür.
 */
export function boardReportPeriod(input: {
  year: number
  yearRange: { startDate: string; endDate: string } | null
  terms: readonly BoardReportTerm[]
  query: Pick<BoardReportQuery, 'termId' | 'from' | 'to'>
  today: string
}): BoardReportPeriod {
  const { query, today, year } = input
  let kind: BoardReportPeriodKind = 'year'
  let termId: string | null = null
  let termName: string | null = null
  let from: string
  let endDate: string
  if (query.from !== undefined && query.to !== undefined) {
    kind = 'custom'
    from = query.from
    endDate = query.to
  } else if (query.termId !== undefined) {
    const term = input.terms.find((item) => item.id === query.termId)
    if (term === undefined)
      throw new DomainError('board_report_term_not_found', 'Seçilen dönem bu eğitim yılında yok.', {
        path: ['termId'],
      })
    kind = 'term'
    termId = term.id
    termName = term.name
    from = term.startDate
    endDate = term.endDate
  } else {
    const range = input.yearRange ?? defaultAcademicYearDates(year)
    from = range.startDate
    endDate = range.endDate
  }
  assertFinancePeriod({ from, to: endDate })
  if (from > today)
    throw new DomainError('board_report_period_not_started', 'Seçilen dönem henüz başlamadı.', {
      path: [kind === 'custom' ? 'from' : kind === 'term' ? 'termId' : 'year'],
    })
  return {
    kind,
    year,
    from,
    to: endDate < today ? endDate : today,
    endDate,
    complete: endDate < today,
    termId,
    termName,
  }
}

// --- Küçük grup bastırma ----------------------------------------------------------------------

export type Suppressed<T> = T & { suppressed: boolean }

/**
 * Küçük grup bastırma (K-77). 1–4 kişilik hücre gizlenir (birincil). Kırılımın toplamı raporda
 * yazdığı için gizli hücrelerin birleşimi toplamdan geri hesaplanabilir; bu birleşim de bir gruptur
 * ve eşikten az farklı kişi kapsıyorsa (tek gizli hücre, ya da aynı kişinin iki gizli hücrede
 * sayılması) en küçük görünür dolu hücre de gizlenir (ikincil; o hücre tek başına eşiği aşar).
 * Gizlenecek görünür dolu hücre yoksa kırılımın tamamı küçük bir gruptur: sıfır hücreler dahil bütün
 * hücreler gizlenir. Kurum geneli toplam (yöntem, yaşlandırma, ayrılış toplamı) yine yazar; ama
 * hangi yöntem, dilim ya da nedenin dolu olduğu görünmez. Toplamın kendisi gizlenmez: aynı toplam
 * raporun başka yerinden de çıkar (mutabakat tahsilatı; dönem başı + yeni − ayrılış − mezuniyet =
 * dönem sonu), yalnız onu gizlemek sızıntıyı kapatmaz. `membersOf` hücredeki kişi kimlikleridir;
 * kişi sayısı farklı kimliklerden sayılır.
 */
export function suppressSmallGroups<T>(
  cells: readonly T[],
  membersOf: (cell: T) => Iterable<string>,
  threshold: number = BOARD_REPORT_MIN_GROUP,
): Suppressed<T>[] {
  const members = cells.map((cell) => new Set(membersOf(cell)))
  const hidden = members.map((set) => set.size > 0 && set.size < threshold)
  const hiddenPeople = new Set(members.flatMap((set, index) => (hidden[index] ? [...set] : [])))
  if (hiddenPeople.size > 0 && hiddenPeople.size < threshold) {
    let pick = -1
    members.forEach((set, index) => {
      if (hidden[index] || set.size === 0) return
      const current = members[pick]
      if (current === undefined || set.size < current.size) pick = index
    })
    if (pick === -1) hidden.fill(true)
    else hidden[pick] = true
  }
  return cells.map((cell, index) => ({ ...cell, suppressed: hidden[index] === true }))
}

// --- Girdi ----------------------------------------------------------------------------------

type ReconciliationInput = Parameters<typeof financeReconciliation>[0]

export interface BoardReportWithdrawal extends ReconciliationWithdrawal {
  id: string
  reason: WithdrawalReason
}

export interface BoardReportInput {
  period: BoardReportPeriod
  /** Europe/Istanbul günü. */
  today: string
  institutionType: InstitutionType
  invoices: ReconciliationInput['invoices']
  contracts: ReconciliationInput['contracts']
  cancelledContractIds: ReadonlySet<string>
  /** Mutabakat tahsilatları (dağılımlarıyla), dönem sonundan öncekilerin tamamı. */
  payments: ReconciliationInput['payments']
  /** Yöntem kırılımı için ödeme ya da iptal anı döneme değen tahsilatlar. */
  methodPayments: readonly ExportPayment[]
  /** Taksit kimliği → bugün dağıtılmış tahsilat (kuruş; DOM-FIN-030). */
  allocated: ReadonlyMap<string, number>
  withdrawals: readonly BoardReportWithdrawal[]
  students: readonly EnrollmentStudent[]
  /** Yenileme modülü kapalıysa (dil okulunda hiç yoktur) `null`: oran hesaplanmaz. */
  renewals: readonly EnrollmentRenewal[] | null
  /** Dönemde açılan adaylar; `crm` kapalıysa `null`. */
  prospects: readonly FunnelProspect[] | null
  /** Paket satışları; yalnız dil okulunda verilir. */
  packageSales: readonly PackageReportSale[] | null
}

// --- Çıktı ----------------------------------------------------------------------------------

export interface BoardReportMethodRow {
  method: PaymentMethod
  /** Dönemde bu yöntemle tahsilatı ya da iptali olan kişi; gizli hücrede `null`. */
  studentCount: number | null
  collectedCents: number | null
  reversedCents: number | null
  netCents: number | null
  suppressed: boolean
}

export interface BoardReportAgingRow {
  bucket: BoardReportAgingBucket
  studentCount: number | null
  amountCents: number | null
  suppressed: boolean
}

export interface BoardReportReasonRow {
  reason: WithdrawalReason
  count: number | null
  suppressed: boolean
}

export type BoardReportPackages = Pick<
  PackageReportTotals,
  | 'saleCount'
  | 'soldHours'
  | 'usedHours'
  | 'refundedHours'
  | 'expiredHours'
  | 'soldCents'
  | 'recognizedCents'
  | 'returnedCents'
  | 'openingDeferredCents'
  | 'closingDeferredCents'
>

export interface BoardReport {
  period: BoardReportPeriod
  today: string
  institutionType: InstitutionType
  minGroupSize: number
  finance: {
    totals: ReconciliationAmounts
    /** Mutabakatta tutmayan kişi sayısı (DOM-FIN-056); ad yazılmaz. */
    mismatchCount: number
    methods: {
      rows: BoardReportMethodRow[]
      collectedCents: number
      reversedCents: number
      netCents: number
    }
    aging: {
      /** Yaşlandırmanın günü: raporun alındığı gün (K-76). */
      asOf: string
      overdueCents: number
      studentCount: number
      rows: BoardReportAgingRow[]
    }
    packages: BoardReportPackages | null
  }
  enrollment: {
    startCount: number
    endCount: number
    newCount: number
    withdrawnCount: number
    graduatedCount: number
    reasons: BoardReportReasonRow[]
    renewal: {
      targetYear: number
      eligibleCount: number
      renewedCount: number
      /** Yüzde, bir ondalık; payda 0 ise `null`. */
      rate: number | null
    } | null
  }
  funnel: {
    prospects: number
    steps: FunnelStepCount[]
    conversionRate: number | null
  } | null
}

// --- Hesap ----------------------------------------------------------------------------------

const DAY_MS = 86_400_000
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS)
const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)
/** Gün ya da ISO an → Europe/Istanbul günü. */
const istanbulDay = (value: string) => (value.length === 10 ? value : dayKey(value))

function push<K, V>(index: Map<K, V[]>, key: K, value: V) {
  const list = index.get(key)
  if (list) list.push(value)
  else index.set(key, [value])
}

/** Ödeme yöntemine göre tahsilat: `paymentLines` gün kuralı, iptal iptal gününde düşer. */
function methodBreakdown(payments: readonly ExportPayment[], period: FinancePeriod) {
  const tallies = new Map<
    string,
    { students: Set<string>; collectedCents: number; reversedCents: number }
  >()
  for (const payment of payments) {
    const lines = paymentLines([payment], new Map(), period)
    if (lines.length === 0) continue
    let tally = tallies.get(payment.method)
    if (tally === undefined) {
      tally = { students: new Set(), collectedCents: 0, reversedCents: 0 }
      tallies.set(payment.method, tally)
    }
    tally.students.add(payment.studentId)
    for (const line of lines)
      if (line.amountCents >= 0) tally.collectedCents += line.amountCents
      else tally.reversedCents -= line.amountCents
  }
  const cells = PAYMENT_METHODS.map((method) => {
    const tally = tallies.get(method)
    return {
      method,
      students: tally?.students ?? new Set<string>(),
      collectedCents: tally?.collectedCents ?? 0,
      reversedCents: tally?.reversedCents ?? 0,
    }
  })
  const collectedCents = cells.reduce((total, cell) => total + cell.collectedCents, 0)
  const reversedCents = cells.reduce((total, cell) => total + cell.reversedCents, 0)
  return {
    rows: suppressSmallGroups(cells, (cell) => cell.students).map((cell): BoardReportMethodRow =>
      cell.suppressed
        ? {
            method: cell.method,
            studentCount: null,
            collectedCents: null,
            reversedCents: null,
            netCents: null,
            suppressed: true,
          }
        : {
            method: cell.method,
            studentCount: cell.students.size,
            collectedCents: cell.collectedCents,
            reversedCents: cell.reversedCents,
            netCents: cell.collectedCents - cell.reversedCents,
            suppressed: false,
          },
    ),
    collectedCents,
    reversedCents,
    netCents: collectedCents - reversedCents,
  }
}

/**
 * Gecikmiş alacak yaşlandırması (K-76): vadesi dönem sonuna kadar gelmiş ve bugün gecikmiş taksitlerin
 * bugün kalan kısmı. Ödenen kısım `/finance/totals` kuralıdır (`invoicePaidCents`); süren dönemde
 * toplam kurum geneli gecikmiş tutara eşittir.
 */
function overdueAging(input: BoardReportInput) {
  const { today, period, allocated } = input
  const buckets = new Map(
    BOARD_REPORT_AGING_BUCKETS.map((bucket) => [
      bucket.key,
      { students: new Set<string>(), amountCents: 0 },
    ]),
  )
  const students = new Set<string>()
  let overdueCents = 0
  for (const invoice of input.invoices) {
    const due = dayKey(invoice.dueDate)
    if (due >= today || due > period.to) continue
    const open = invoice.amount - invoicePaidCents(invoice, allocated)
    if (open <= 0) continue
    const days = daysBetween(due, today)
    const bucket = BOARD_REPORT_AGING_BUCKETS.find(
      (item) => days >= item.minDays && (item.maxDays === null || days <= item.maxDays),
    )
    const tally = bucket && buckets.get(bucket.key)
    if (!tally) continue
    tally.students.add(invoice.studentId)
    tally.amountCents += open
    students.add(invoice.studentId)
    overdueCents += open
  }
  const cells = BOARD_REPORT_AGING_BUCKETS.map((bucket) => ({
    bucket: bucket.key,
    students: buckets.get(bucket.key)?.students ?? new Set<string>(),
    amountCents: buckets.get(bucket.key)?.amountCents ?? 0,
  }))
  return {
    asOf: today,
    overdueCents,
    studentCount: students.size,
    rows: suppressSmallGroups(cells, (cell) => cell.students).map((cell): BoardReportAgingRow =>
      cell.suppressed
        ? { bucket: cell.bucket, studentCount: null, amountCents: null, suppressed: true }
        : {
            bucket: cell.bucket,
            studentCount: cell.students.size,
            amountCents: cell.amountCents,
            suppressed: false,
          },
    ),
  }
}

const RENEWABLE = new Set(['Planlandı', 'Tamamlandı'])

/**
 * Kayıt hareketi (DOM-KAY-026 olayları). Öğrenci kesin kayıt gününden ayrılış ya da mezuniyet
 * gününe kadar kayıtlıdır; o gün sayılmaz. Kesin kayıt günü olmayan eski kayıt dönemden önce
 * kayıtlıdır. Ayrılış kaydı olmayan pasif öğrenci (çevrimdışı State) yerleştirilemediği için hiç
 * sayılmaz. Dönem başı + yeni kayıt − ayrılış − mezuniyet = dönem sonu.
 */
function enrollmentSummary(input: BoardReportInput): BoardReport['enrollment'] {
  const { period } = input
  const renewalsOf = new Map<string, EnrollmentRenewal[]>()
  for (const renewal of input.renewals ?? []) push(renewalsOf, renewal.studentId, renewal)
  const withdrawalsOf = new Map<string, BoardReportWithdrawal[]>()
  for (const withdrawal of input.withdrawals) push(withdrawalsOf, withdrawal.studentId, withdrawal)
  const reasonOf = new Map(input.withdrawals.map((item) => [item.id, item.reason]))

  const before = addDays(period.from, -1)
  const inPeriod = (day: string) => day >= period.from && day <= period.to
  let startCount = 0
  let endCount = 0
  let newCount = 0
  let withdrawnCount = 0
  let graduatedCount = 0
  const reasons = new Map<WithdrawalReason, string[]>()
  const activeAtEnd: string[] = []
  for (const student of input.students) {
    const events = enrollmentEvents(student, {
      renewals: renewalsOf.get(student.id) ?? [],
      withdrawals: withdrawalsOf.get(student.id) ?? [],
    })
    const exit = events.find((event) => event.kind === 'withdrawn' || event.kind === 'graduated')
    if (exit !== undefined && exit.at === null) continue
    const enrolledAt = events[0]?.at ?? null
    const joined = enrolledAt === null ? null : istanbulDay(enrolledAt)
    const left = exit?.at ? istanbulDay(exit.at) : null
    const activeOn = (day: string) =>
      (joined === null || joined <= day) && (left === null || left > day)
    if (activeOn(before)) startCount += 1
    if (activeOn(period.to)) {
      endCount += 1
      activeAtEnd.push(student.id)
    }
    if (joined !== null && inPeriod(joined)) newCount += 1
    if (
      exit !== undefined &&
      left !== null &&
      inPeriod(left) &&
      (joined === null || joined <= left)
    )
      if (exit.kind === 'graduated') graduatedCount += 1
      else {
        withdrawnCount += 1
        const reason = exit.withdrawalId === null ? undefined : reasonOf.get(exit.withdrawalId)
        if (reason !== undefined) push(reasons, reason, student.id)
      }
  }

  let renewal: BoardReport['enrollment']['renewal'] = null
  if (input.renewals !== null) {
    const targetYear = period.year + 1
    let eligibleCount = 0
    let renewedCount = 0
    for (const studentId of activeAtEnd) {
      const own = renewalsOf.get(studentId) ?? []
      if (own.some((item) => item.mode === 'graduate' && item.status !== 'İptal')) continue
      eligibleCount += 1
      if (
        own.some(
          (item) => item.mode === 'renew' && item.year === targetYear && RENEWABLE.has(item.status),
        )
      )
        renewedCount += 1
    }
    renewal = {
      targetYear,
      eligibleCount,
      renewedCount,
      rate: funnelRate(renewedCount, eligibleCount),
    }
  }

  return {
    startCount,
    endCount,
    newCount,
    withdrawnCount,
    graduatedCount,
    reasons: suppressSmallGroups(
      WITHDRAWAL_REASONS.map((reason) => ({ reason, students: reasons.get(reason) ?? [] })),
      (cell) => cell.students,
    ).map((cell): BoardReportReasonRow => ({
      reason: cell.reason,
      count: cell.suppressed ? null : cell.students.length,
      suppressed: cell.suppressed,
    })),
    renewal,
  }
}

/** Yönetim kurulu raporu (DOM-FIN-064). Kapsam ve kurum burada denetlenmez; servis yükler. */
export function financeBoardReport(input: BoardReportInput): BoardReport {
  const { period, today, institutionType } = input
  const range: FinancePeriod = { from: period.from, to: period.to }
  const reconciliation = financeReconciliation({
    year: period.year,
    period: range,
    invoices: input.invoices,
    contracts: input.contracts,
    cancelledContractIds: input.cancelledContractIds,
    payments: input.payments,
    withdrawals: input.withdrawals,
    students: new Map(),
  })
  const packageTotals =
    input.packageSales === null ? null : packageHourReport(input.packageSales, range, today).totals
  const funnel =
    input.prospects === null ? null : enrollmentFunnel(input.prospects, institutionType).total
  return {
    period,
    today,
    institutionType,
    minGroupSize: BOARD_REPORT_MIN_GROUP,
    finance: {
      totals: reconciliation.totals,
      mismatchCount: reconciliation.mismatchCount,
      methods: methodBreakdown(input.methodPayments, range),
      aging: overdueAging(input),
      packages:
        packageTotals === null
          ? null
          : {
              saleCount: packageTotals.saleCount,
              soldHours: packageTotals.soldHours,
              usedHours: packageTotals.usedHours,
              refundedHours: packageTotals.refundedHours,
              expiredHours: packageTotals.expiredHours,
              soldCents: packageTotals.soldCents,
              recognizedCents: packageTotals.recognizedCents,
              returnedCents: packageTotals.returnedCents,
              openingDeferredCents: packageTotals.openingDeferredCents,
              closingDeferredCents: packageTotals.closingDeferredCents,
            },
    },
    enrollment: enrollmentSummary(input),
    funnel:
      funnel === null
        ? null
        : {
            prospects: funnel.prospects,
            steps: funnel.steps,
            conversionRate: funnel.conversionRate,
          },
  }
}
