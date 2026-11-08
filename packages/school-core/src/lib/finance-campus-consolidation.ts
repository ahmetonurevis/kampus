import type { State } from '../data/seed.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import {
  assertFinancePeriod,
  financeSummary,
  invoiceLines,
  paymentLines,
  refundLines,
  type ExportPayment,
  type ExportRefund,
  type FinancePeriod,
} from './finance-export.ts'
import {
  COST_REPORT_MIN_GROUP,
  type CostPerStudentReport,
  type PlacedStudent,
} from './finance-cost-per-student.ts'

/**
 * Çok kampüslü konsolide rapor (docs/domain/finans.md DOM-FIN-065; ON-250, K24). Kurumun kampüsleri
 * için seçilen bütçe döneminin gelir hareketleri, öğrenci sayısı ve bütçe gideri yan yana; satırların
 * toplamı kampüsler toplamıdır. Gelir kalemleri muhasebe aktarımıyla aynı satırlardan ve gün
 * kurallarıyla hesaplanır (`finance-export.ts`): tahakkuk taksitin vade gününde, tahsilat ödeme
 * gününde, iptal iptal gününde, iade ödeme gününde. Bu yüzden kampüsler toplamı aynı dönemin
 * `/finance/summary` toplamına eşittir. Öğrencinin kampüsü güncel sınıfının kampüsüdür (K-101);
 * sınıfı ya da sınıfının kampüsü olmayan öğrencinin hareketi "Kampüse bağlı olmayan" satırına düşer.
 * Bütçe gideri öğrenci başı maliyet raporundaki kampüs merkezinin toplam maliyetidir (ortak giderden
 * pay dahil); kampüs merkezine bağlanmamış gider aynı satıra yazılır. Salt okurdur, kişi verisi
 * taşımaz.
 */

export interface ConsolidationCampus {
  id: string
  name: string
  isActive: boolean
}

export interface CampusConsolidationRow {
  /** Kampüs bağı olmayan satırda `null`. */
  campusId: string | null
  name: string
  isActive: boolean
  /** Kampüse bağlı etkin ya da tutarlı maliyet merkezi var mı. */
  hasCostCenter: boolean
  studentCount: number
  accruedCents: number
  collectedCents: number
  reversedCents: number
  refundedCents: number
  /** Tahsilat − iptal − iade. */
  netCollectedCents: number
  budgetExpenseCents: number
  /** Bütçe giderinin ortak giderden gelen kısmı. */
  budgetSharedCents: number
  /** Kampüsler toplamındaki pay, on binde bir; toplam sıfırsa `null`. */
  studentShareBasisPoints: number | null
  accruedShareBasisPoints: number | null
  netCollectedShareBasisPoints: number | null
  budgetExpenseShareBasisPoints: number | null
  /** Öğrenci başı tahakkuk ve bütçe gideri; öğrencisi yoksa ya da küçük grupsa `null`. */
  accruedPerStudentCents: number | null
  budgetExpensePerStudentCents: number | null
  suppressed: boolean
}

export type CampusConsolidationTotals = Omit<
  CampusConsolidationRow,
  | 'campusId'
  | 'name'
  | 'isActive'
  | 'hasCostCenter'
  | 'studentShareBasisPoints'
  | 'accruedShareBasisPoints'
  | 'netCollectedShareBasisPoints'
  | 'budgetExpenseShareBasisPoints'
>

export interface CampusConsolidation {
  from: string
  to: string
  minGroupSize: number
  campuses: CampusConsolidationRow[]
  totals: CampusConsolidationTotals
}

const UNASSIGNED_NAME = 'Kampüse bağlı olmayan'

const share = (part: number, total: number) =>
  total === 0 ? null : Math.round((part * 10_000) / total)

function perStudent(students: number, ...amounts: number[]) {
  if (students === 0) return { values: amounts.map(() => null), suppressed: false }
  if (students < COST_REPORT_MIN_GROUP) return { values: amounts.map(() => null), suppressed: true }
  return { values: amounts.map((amount) => Math.round(amount / students)), suppressed: false }
}

interface Money {
  accruedCents: number
  collectedCents: number
  reversedCents: number
  refundedCents: number
}

const EMPTY_MONEY: Money = {
  accruedCents: 0,
  collectedCents: 0,
  reversedCents: 0,
  refundedCents: 0,
}
const NO_STUDENTS = new Map<string, never>()

/** Bir öğrenci grubunun dönem hareketleri; muhasebe aktarımının satır üreticileriyle. */
function moneyOf(
  period: FinancePeriod,
  payments: readonly ExportPayment[],
  refunds: readonly ExportRefund[],
  invoices: State['invoices'],
  allocated: ReadonlyMap<string, number>,
): Money {
  const paymentRows = paymentLines(payments, NO_STUDENTS, period)
  const summary = financeSummary(
    paymentRows,
    refundLines(refunds, NO_STUDENTS, period),
    invoiceLines(invoices, allocated, NO_STUDENTS, period),
  )
  let collectedCents = 0
  let reversedCents = 0
  for (const row of paymentRows)
    if (row.amountCents >= 0) collectedCents += row.amountCents
    else reversedCents -= row.amountCents
  return {
    accruedCents: summary.invoices.totalCents,
    collectedCents,
    reversedCents,
    refundedCents: summary.refunds.totalCents,
  }
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const list = groups.get(key)
    if (list) list.push(item)
    else groups.set(key, [item])
  }
  return groups
}

const UNASSIGNED = ''

/**
 * Konsolide rapor. `studentCampus` kurumun bütün öğrencilerinin kampüsüdür (hareketleri dönemde
 * olmayan ayrılmış öğrenci dahil); `students` dönemde sayılan öğrencilerdir (`periodStudents`).
 */
export function campusConsolidation(input: {
  period: FinancePeriod
  campuses: readonly ConsolidationCampus[]
  studentCampus: ReadonlyMap<string, string | null>
  students: readonly PlacedStudent[]
  payments: readonly ExportPayment[]
  refunds: readonly ExportRefund[]
  invoices: State['invoices']
  allocated: ReadonlyMap<string, number>
  costs: CostPerStudentReport
}): CampusConsolidation {
  assertFinancePeriod(input.period)
  const known = new Set(input.campuses.map((campus) => campus.id))
  const campusKey = (studentId: string) => {
    const campus = input.studentCampus.get(studentId) ?? null
    return campus !== null && known.has(campus) ? campus : UNASSIGNED
  }
  const payments = groupBy(input.payments, (item) => campusKey(item.studentId))
  const refunds = groupBy(input.refunds, (item) => campusKey(item.studentId))
  const invoices = groupBy(input.invoices, (item) => campusKey(item.studentId))
  const students = groupBy(input.students, (item) =>
    item.campusId !== null && known.has(item.campusId) ? item.campusId : UNASSIGNED,
  )
  const campusCenters = new Map(
    input.costs.centers
      .filter((row) => row.type === 'campus' && row.campusId !== null)
      .map((row) => [row.campusId ?? '', row]),
  )

  const draft = [
    ...input.campuses.map((campus) => ({
      campusId: campus.id as string | null,
      name: campus.name,
      isActive: campus.isActive,
      key: campus.id,
    })),
    { campusId: null, name: UNASSIGNED_NAME, isActive: true, key: UNASSIGNED },
  ].map((campus) => {
    const money =
      payments.has(campus.key) || refunds.has(campus.key) || invoices.has(campus.key)
        ? moneyOf(
            input.period,
            payments.get(campus.key) ?? [],
            refunds.get(campus.key) ?? [],
            invoices.get(campus.key) ?? [],
            input.allocated,
          )
        : EMPTY_MONEY
    const center = campus.campusId === null ? undefined : campusCenters.get(campus.campusId)
    return {
      ...campus,
      ...money,
      hasCostCenter: center !== undefined,
      studentCount: students.get(campus.key)?.length ?? 0,
      budgetExpenseCents: center?.totalCents ?? 0,
      budgetSharedCents: center?.sharedInCents ?? 0,
    }
  })
  // Kampüs merkezine bağlanmamış gider (kurum düzeyi programlar, paylaştırılamayan ortak gider).
  const campusExpense = draft.reduce((sum, row) => sum + row.budgetExpenseCents, 0)
  const unassigned = draft.at(-1)
  if (unassigned) unassigned.budgetExpenseCents = input.costs.totals.expenseCents - campusExpense

  const sum = (pick: (row: (typeof draft)[number]) => number) =>
    draft.reduce((total, row) => total + pick(row), 0)
  const totalsBase = {
    studentCount: sum((row) => row.studentCount),
    accruedCents: sum((row) => row.accruedCents),
    collectedCents: sum((row) => row.collectedCents),
    reversedCents: sum((row) => row.reversedCents),
    refundedCents: sum((row) => row.refundedCents),
    budgetExpenseCents: sum((row) => row.budgetExpenseCents),
    budgetSharedCents: sum((row) => row.budgetSharedCents),
  }
  const net = (row: Money) => row.collectedCents - row.reversedCents - row.refundedCents
  const totalNet = net(totalsBase)

  const rows: CampusConsolidationRow[] = draft
    .filter((row) =>
      row.campusId !== null
        ? row.isActive ||
          row.studentCount > 0 ||
          row.accruedCents + row.collectedCents + row.reversedCents + row.refundedCents > 0 ||
          row.budgetExpenseCents !== 0
        : row.studentCount > 0 ||
          row.accruedCents + row.collectedCents + row.reversedCents + row.refundedCents > 0 ||
          row.budgetExpenseCents !== 0,
    )
    .map((row) => {
      const ratios = perStudent(row.studentCount, row.accruedCents, row.budgetExpenseCents)
      return {
        campusId: row.campusId,
        name: row.name,
        isActive: row.isActive,
        hasCostCenter: row.hasCostCenter,
        studentCount: row.studentCount,
        accruedCents: row.accruedCents,
        collectedCents: row.collectedCents,
        reversedCents: row.reversedCents,
        refundedCents: row.refundedCents,
        netCollectedCents: net(row),
        budgetExpenseCents: row.budgetExpenseCents,
        budgetSharedCents: row.budgetSharedCents,
        studentShareBasisPoints: share(row.studentCount, totalsBase.studentCount),
        accruedShareBasisPoints: share(row.accruedCents, totalsBase.accruedCents),
        netCollectedShareBasisPoints: share(net(row), totalNet),
        budgetExpenseShareBasisPoints: share(row.budgetExpenseCents, totalsBase.budgetExpenseCents),
        accruedPerStudentCents: ratios.values[0] ?? null,
        budgetExpensePerStudentCents: ratios.values[1] ?? null,
        suppressed: ratios.suppressed,
      }
    })
  const totalRatios = perStudent(
    totalsBase.studentCount,
    totalsBase.accruedCents,
    totalsBase.budgetExpenseCents,
  )
  return {
    from: input.period.from,
    to: input.period.to,
    minGroupSize: COST_REPORT_MIN_GROUP,
    campuses: rows,
    totals: {
      ...totalsBase,
      netCollectedCents: totalNet,
      accruedPerStudentCents: totalRatios.values[0] ?? null,
      budgetExpensePerStudentCents: totalRatios.values[1] ?? null,
      suppressed: totalRatios.suppressed,
    },
  }
}

/** On binde bir → `12,50` (yüzde, ondalık virgül). */
export function basisPointsCsv(basisPoints: number | null): string {
  if (basisPoints === null) return csvCell('')
  const sign = basisPoints < 0 ? '-' : ''
  const absolute = Math.abs(basisPoints)
  return `${sign}${String(Math.floor(absolute / 100))},${String(absolute % 100).padStart(2, '0')}`
}
const percent = basisPointsCsv

const perStudentCell = (value: number | null, suppressed: boolean) =>
  suppressed ? csvCell('Küçük grup') : value === null ? csvCell('') : csvAmount(value)

/** Karşılaştırma tablosunun CSV dökümü; son satır kampüsler toplamıdır. */
export function campusConsolidationCsv(report: CampusConsolidation): string {
  const header = [
    'Kampüs',
    'Öğrenci',
    'Öğrenci payı (%)',
    'Tahakkuk',
    'Tahakkuk payı (%)',
    'Tahsilat',
    'Tahsilat iptali',
    'İade',
    'Net tahsilat',
    'Bütçe gideri',
    'Ortak giderden pay',
    'Gider payı (%)',
    'Öğrenci başı tahakkuk',
    'Öğrenci başı gider',
  ]
  const rows = report.campuses.map((row) => [
    csvCell(row.name),
    String(row.studentCount),
    percent(row.studentShareBasisPoints),
    csvAmount(row.accruedCents),
    percent(row.accruedShareBasisPoints),
    csvAmount(row.collectedCents),
    csvAmount(row.reversedCents),
    csvAmount(row.refundedCents),
    csvAmount(row.netCollectedCents),
    csvAmount(row.budgetExpenseCents),
    csvAmount(row.budgetSharedCents),
    percent(row.budgetExpenseShareBasisPoints),
    perStudentCell(row.accruedPerStudentCents, row.suppressed),
    perStudentCell(row.budgetExpensePerStudentCents, row.suppressed),
  ])
  const t = report.totals
  const total = [
    csvCell('Kampüsler toplamı'),
    String(t.studentCount),
    percent(t.studentCount === 0 ? null : 10_000),
    csvAmount(t.accruedCents),
    percent(t.accruedCents === 0 ? null : 10_000),
    csvAmount(t.collectedCents),
    csvAmount(t.reversedCents),
    csvAmount(t.refundedCents),
    csvAmount(t.netCollectedCents),
    csvAmount(t.budgetExpenseCents),
    csvAmount(t.budgetSharedCents),
    percent(t.budgetExpenseCents === 0 ? null : 10_000),
    perStudentCell(t.accruedPerStudentCents, t.suppressed),
    perStudentCell(t.budgetExpensePerStudentCents, t.suppressed),
  ]
  return [header.map(csvCell), ...rows, total].map((row) => row.join(CSV_SEPARATOR)).join('\r\n')
}
