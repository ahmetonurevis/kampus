import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { FEE_ITEM_KIND_LABELS, FEE_ITEM_KINDS, type FeeItemKind } from './fee-tariffs.ts'
import {
  BUDGET_ITEM_KIND_LABELS,
  periodMonths,
  type BudgetItemKind,
  type BudgetItemNode,
  type BudgetPeriodNode,
} from './finance-budget.ts'
import { costCenterPath, type CostCenterNode } from './finance-cost-centers.ts'
import {
  withdrawalSettledCredit,
  type ReconciliationPayment,
  type ReconciliationWithdrawal,
} from './finance-reconciliation.ts'
import { dayKey } from './format.ts'
import { isOpeningImport } from './payments.ts'

/**
 * Bütçe–gerçekleşen karşılaştırması (docs/domain/finans.md DOM-FIN-066; ON-244, K24). Seçilen bütçe
 * döneminin planı (DOM-FIN-062) kalem × maliyet merkezi × ay bazında gerçekleşenle karşılaştırılır.
 * Salt okur rapordur; hiçbir şey saklanmaz, her okumada satırlardan hesaplanır.
 *
 * Gelir gerçekleşeni taksit ve tahsilattan gelir; hareketler yıl sonu mutabakatıyla
 * (`financeReconciliation`, DOM-FIN-056) aynı gün kurallarıyla sayılır:
 *
 * - **Tahakkuk esası** (varsayılan, K-85): taksit vade gününde tahakkuk eder; ayrılışta iptal
 *   edilen taksit listede yoktur, hak edilmeyen tahakkuk (ayrılış düzeltmesi) ayrılış gününde düşülür.
 *   Dönemin tahakkuku mutabakattaki `tahakkuk − ayrılış düzeltmesi`ne eşittir.
 * - **Tahsilat esası:** tahsilat ödeme gününde girer, iptal edilen tahsilat iptal gününde, ödenen
 *   iade ödeme gününde düşülür; dosyadan aktarılan geçmiş ödeme (DOM-FIN-014) ödeme gününde
 *   tahsilat sayılır ve ayrıca gösterilir (K-87).
 *
 * Hareketin kalemi taksitin ücret türüdür (`fee_kind`; boşsa öğrenim); gelir kalemi ücret türüne
 * eşlenir (K-72). Ayrılış düzeltmesi ve iade öğrenime yazılır (K-87). Tahsilatın taksite
 * dağıtılmamış kısmı ve ücret türü hiçbir kaleme eşlenmemiş hareket "eşlenmemiş gelir"dir.
 *
 * Merkez, öğrencinin kampüs ve program bağından bulunur (K-86): sözleşmenin sınıfı (yoksa öğrencinin
 * bugünkü sınıfı) kampüsü ve sınıf düzeyini, dil okulunda paket satışının kuru (yoksa öğrencinin tek
 * kuru) kuru verir. En özel etkin merkez seçilir; gerçekleşen o kalem için bütçe satırı olan en yakın
 * merkeze (kendisi ya da üst merkezi) yazılır. Merkez bulunamazsa "dağıtılmamış" satırıdır.
 *
 * Gider gerçekleşeni bugün yoktur (satın alma modülü K23 kurulmadı): `expenses: null` verilir ve gider
 * satırları "gerçekleşen verisi yok" döner. Satın alma ve elle gider kaydı `BudgetExpenseActual`
 * biçiminde satır verdiğinde aynı hesap gideri de karşılaştırır.
 */

export const BUDGET_ACTUAL_BASES = ['accrual', 'cash'] as const
export type BudgetActualBasis = (typeof BUDGET_ACTUAL_BASES)[number]
export const BUDGET_ACTUAL_BASIS_LABELS = {
  accrual: 'Tahakkuk esası',
  cash: 'Tahsilat esası',
} as const satisfies Record<BudgetActualBasis, string>

export const budgetActualsQuerySchema = z.strictObject({
  basis: z.enum(BUDGET_ACTUAL_BASES, 'Esas tahakkuk ya da tahsilat olmalıdır.').default('accrual'),
})
export type BudgetActualsQuery = z.input<typeof budgetActualsQuerySchema>

// --- Gider kaynağı (açık arabirim) -------------------------------------------------------------

export const BUDGET_EXPENSE_SOURCES = ['purchase', 'manual'] as const
export type BudgetExpenseSource = (typeof BUDGET_EXPENSE_SOURCES)[number]

/**
 * Gider gerçekleşeni satırı (DOM-FIN-066). Bugün üreten yoktur; satın alma (K23) faturası ve elle gider
 * kaydı bu biçimde verir. Kalem gider kalemidir; merkez kaydın kendi merkezidir (`null`:
 * dağıtılmamış). Tahakkuk esasında belge günü, tahsilat (nakit) esasında ödeme günü sayılır; ödenmemiş
 * gider nakit esasına girmez. Tutar kuruş, iade ya da iptal eksi tutarla verilir.
 */
export interface BudgetExpenseActual {
  itemId: string
  costCenterId: string | null
  /** Belge (fatura) günü, Europe/Istanbul `YYYY-MM-DD`. */
  accrualDate: string
  /** Ödeme günü; ödenmemişse `null`. */
  paidDate: string | null
  amountCents: number
  source: BudgetExpenseSource
}

// --- Girdi ---------------------------------------------------------------------------------------

type Invoice = Pick<
  State['invoices'][number],
  'id' | 'studentId' | 'amount' | 'paidAt' | 'dueDate' | 'installment' | 'method'
> & { feeKind?: string | undefined; contractId?: string | undefined }
type Contract = State['contracts'][number]

export interface BudgetActualsLine {
  costCenterId: string
  itemId: string
  amountCents: number
  monthlyCents: readonly number[] | null
}

export interface BudgetActualsInput {
  period: Pick<BudgetPeriodNode, 'id' | 'name' | 'startDate' | 'endDate' | 'status'>
  basis: BudgetActualBasis
  /** Bugün (Europe/Istanbul); gelecek günlerin hareketi sayılmaz. */
  today: string
  institutionType: InstitutionType
  /** Kurumun bütün merkezleri (pasifler dahil; ad ve yol için). Atama yalnız etkinlerle yapılır. */
  centers: readonly (CostCenterNode & { name: string })[]
  items: readonly (BudgetItemNode & { name: string })[]
  /** Dönemin arşivlenmemiş satırları. */
  lines: readonly BudgetActualsLine[]
  invoices: readonly Invoice[]
  contracts: readonly Contract[]
  students: readonly { id: string; classId?: string | undefined }[]
  classes: readonly { id: string; branchId?: string | undefined; grade?: number | undefined }[]
  /** Dil okulunda sözleşme → paket satışının kuru. */
  contractCourseIds: ReadonlyMap<string, string>
  /** Dil okulunda öğrenci → etkin grup üyeliklerinin kurları. */
  studentCourseIds: ReadonlyMap<string, readonly string[]>
  /** Tahsilat esasında gerekir; tahakkukta okunmaz. */
  payments: readonly ReconciliationPayment[]
  withdrawals: readonly ReconciliationWithdrawal[]
  /** Gider gerçekleşeni kaynağı; `null`: kaynak yok, gider "gerçekleşen verisi yok" döner. */
  expenses: readonly BudgetExpenseActual[] | null
}

// --- Çıktı ---------------------------------------------------------------------------------------

/**
 * Satırın gerçekleşen durumu: `mapped` hesaplandı; `unmapped_item` gelir kalemi ücret türüne
 * eşlenmemiş; `no_expense_data` gider kaynağı yok; `not_started` dönem henüz başlamadı.
 */
export const BUDGET_ACTUAL_STATUSES = [
  'mapped',
  'unmapped_item',
  'no_expense_data',
  'not_started',
] as const
export type BudgetActualStatus = (typeof BUDGET_ACTUAL_STATUSES)[number]
export const BUDGET_ACTUAL_STATUS_LABELS = {
  mapped: 'Hesaplandı',
  unmapped_item: 'Kalem ücret türüne eşlenmemiş',
  no_expense_data: 'Gerçekleşen verisi yok',
  not_started: 'Dönem başlamadı',
} as const satisfies Record<BudgetActualStatus, string>

export interface BudgetActualMonth {
  month: string
  /** Aylık dağılım yoksa `null` (K-64: dağıtılmamış satır aylara bölünmez). */
  plannedCents: number | null
  /** Henüz gelmemiş ayda ya da gerçekleşen hesaplanmıyorsa `null`. */
  actualCents: number | null
  varianceCents: number | null
  realizationBasisPoints: number | null
}

export interface BudgetActualRow {
  key: string
  itemId: string
  itemCode: string
  itemName: string
  itemKind: BudgetItemKind
  feeKind: FeeItemKind | null
  /** `null`: dağıtılmamış (öğrencinin bağına uyan merkez yok). */
  costCenterId: string | null
  costCenterCode: string | null
  costCenterName: string | null
  costCenterPath: string | null
  hasLine: boolean
  plannedCents: number
  /** Bugüne kadarki ayların planı; dağılımsız satırda dönem bitmediyse `null`. */
  plannedToDateCents: number | null
  actualCents: number | null
  /** Gerçekleşen − plan. */
  varianceCents: number | null
  /** Gerçekleşen ÷ plan, on binde bir (`%12,5` → 1250); plan sıfırsa `null`. */
  realizationBasisPoints: number | null
  status: BudgetActualStatus
  months: BudgetActualMonth[]
}

export interface BudgetActualUnmatched {
  /** `null`: kalemi belirsiz tahsilat (taksite dağıtılmamış ya da iptal edilmiş taksite alınmış). */
  feeKind: FeeItemKind | null
  actualCents: number
  months: { month: string; actualCents: number | null }[]
}

export interface BudgetActualTotals {
  plannedCents: number
  actualCents: number | null
  varianceCents: number | null
  realizationBasisPoints: number | null
}

export interface BudgetActuals {
  periodId: string
  basis: BudgetActualBasis
  startDate: string
  endDate: string
  /** Hareketlerin sayıldığı son gün (bitiş ya da bugün); dönem başlamadıysa `null`. */
  asOfDate: string | null
  months: string[]
  expenseData: 'none' | 'available'
  rows: BudgetActualRow[]
  unmatched: BudgetActualUnmatched[]
  totals: {
    income: BudgetActualTotals & { unmatchedCents: number | null }
    expense: BudgetActualTotals
    /** Gelir − gider; gider verisi yoksa gerçekleşen net `null`. */
    net: { plannedCents: number; actualCents: number | null }
  }
  /** Tahsilat esasında dosyadan aktarılan geçmiş ödemenin dönemdeki tutarı; tahakkukta 0. */
  openingImportCents: number
}

// --- Hesap ---------------------------------------------------------------------------------------

const UNALLOCATED = 'none'
const BASIS = 10_000

const ratio = (actual: number | null, planned: number | null) =>
  actual === null || planned === null || planned === 0
    ? null
    : Math.round((actual * BASIS) / planned)
const diff = (actual: number | null, planned: number | null) =>
  actual === null || planned === null ? null : actual - planned
const isFeeKind = (value: string): value is FeeItemKind =>
  (FEE_ITEM_KINDS as readonly string[]).includes(value)

interface Link {
  campusId: string | null
  gradeLevel: number | null
  courseId: string | null
}

/** Hareket: öğrenci, sözleşme ve ücret türüyle bir günün tutarı (eksi: düşüş). */
interface Movement {
  studentId: string
  contractId: string | null
  feeKind: FeeItemKind | null
  day: string
  cents: number
}

function ancestorsOf(byId: ReadonlyMap<string, CostCenterNode>, id: string): string[] {
  const chain: string[] = []
  let cursor: string | null = id
  while (cursor !== null && chain.length <= byId.size) {
    chain.push(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }
  return chain
}

/**
 * Bağa uyan en özel etkin merkez (K-86): öğrencinin kampüs merkezinin altındaki tek program merkezi;
 * yoksa hiçbir kampüs merkezinin altında olmayan tek program merkezi; yoksa kampüs merkezi; yoksa
 * `null`. Birden çok aday eşit derecede uyuyorsa program seçilmez.
 */
function matchCenter(
  link: Link,
  active: readonly CostCenterNode[],
  byId: ReadonlyMap<string, CostCenterNode>,
): string | null {
  const campus =
    link.campusId === null
      ? undefined
      : active.find((center) => center.type === 'campus' && center.campusId === link.campusId)
  const programs = active.filter(
    (center) =>
      center.type === 'program' &&
      ((link.gradeLevel !== null && center.gradeLevel === link.gradeLevel) ||
        (link.courseId !== null && center.courseId === link.courseId)),
  )
  const campusOf = (id: string) =>
    ancestorsOf(byId, id).find((ancestor) => byId.get(ancestor)?.type === 'campus') ?? null
  if (campus !== undefined) {
    const own = programs.filter((center) => campusOf(center.id) === campus.id)
    if (own.length === 1) return own[0]?.id ?? null
    if (own.length > 1) return campus.id
  }
  const neutral = programs.filter((center) => campusOf(center.id) === null)
  if (neutral.length === 1) return neutral[0]?.id ?? null
  return campus?.id ?? null
}

/** Hesabın girdisinden hareket listesi; dönem ve bugün süzmesi sonra yapılır. */
function movementsOf(input: BudgetActualsInput): {
  movements: Movement[]
  openingImport: Movement[]
} {
  const movements: Movement[] = []
  const openingImport: Movement[] = []
  const feeOf = (invoice: Invoice): FeeItemKind | null => {
    const kind = invoice.feeKind ?? 'tuition'
    return isFeeKind(kind) ? kind : null
  }
  const invoiceById = new Map(input.invoices.map((invoice) => [invoice.id, invoice]))
  if (input.basis === 'accrual') {
    for (const invoice of input.invoices)
      movements.push({
        studentId: invoice.studentId,
        contractId: invoice.contractId ?? null,
        feeKind: feeOf(invoice),
        day: dayKey(invoice.dueDate),
        cents: invoice.amount,
      })
    const invoicesOf = new Map<string, Invoice[]>()
    for (const invoice of input.invoices) {
      const list = invoicesOf.get(invoice.studentId)
      if (list) list.push(invoice)
      else invoicesOf.set(invoice.studentId, [invoice])
    }
    const contractById = new Map(input.contracts.map((contract) => [contract.id, contract]))
    for (const withdrawal of input.withdrawals) {
      const settled = withdrawalSettledCredit(
        withdrawal,
        invoicesOf.get(withdrawal.studentId) ?? [],
        (
          withdrawal.breakdown.contracts?.map((line) => line.contractId) ?? [withdrawal.contractId]
        ).map((id) => contractById.get(id)),
      )
      const adjustment = withdrawal.refundCents - settled
      if (adjustment !== 0)
        movements.push({
          studentId: withdrawal.studentId,
          contractId: withdrawal.contractId,
          feeKind: 'tuition',
          day: withdrawal.withdrawalDate,
          cents: -adjustment,
        })
    }
    return { movements, openingImport }
  }
  for (const payment of input.payments) {
    const parts: Omit<Movement, 'day'>[] = []
    let distributed = 0
    for (const allocation of payment.allocations) {
      distributed += allocation.amountCents
      const invoice = invoiceById.get(allocation.invoiceId)
      parts.push({
        studentId: payment.studentId,
        contractId: invoice?.contractId ?? null,
        feeKind: invoice === undefined ? null : feeOf(invoice),
        cents: allocation.amountCents,
      })
    }
    const rest = payment.amountCents - distributed
    if (rest > 0)
      parts.push({ studentId: payment.studentId, contractId: null, feeKind: null, cents: rest })
    const paidDay = dayKey(payment.paidAt)
    for (const part of parts) movements.push({ ...part, day: paidDay })
    if (payment.reversedAt !== null) {
      const reversedDay = dayKey(payment.reversedAt)
      for (const part of parts) movements.push({ ...part, day: reversedDay, cents: -part.cents })
    }
  }
  for (const withdrawal of input.withdrawals)
    if (withdrawal.refundPaidDate !== null && withdrawal.refundCents > 0)
      movements.push({
        studentId: withdrawal.studentId,
        contractId: withdrawal.contractId,
        feeKind: 'tuition',
        day: withdrawal.refundPaidDate,
        cents: -withdrawal.refundCents,
      })
  for (const invoice of input.invoices)
    if (invoice.paidAt && isOpeningImport(invoice)) {
      const movement = {
        studentId: invoice.studentId,
        contractId: invoice.contractId ?? null,
        feeKind: feeOf(invoice),
        day: dayKey(invoice.paidAt),
        cents: invoice.amount,
      }
      movements.push(movement)
      openingImport.push(movement)
    }
  return { movements, openingImport }
}

interface RowDraft {
  itemId: string
  centerId: string | null
  line: BudgetActualsLine | null
  actualByMonth: Map<string, number>
}

/** Bütçe–gerçekleşen raporu (DOM-FIN-066). Kurum kapsamı ve rol denetimi serviste yapılır. */
export function budgetActuals(input: BudgetActualsInput): BudgetActuals {
  const { period, today } = input
  const months = periodMonths(period)
  const started = period.startDate <= today
  const asOfDate = started ? (period.endDate < today ? period.endDate : today) : null
  const currentMonth = today.slice(0, 7)
  const monthOpen = (month: string) => started && month <= currentMonth

  const byId = new Map(input.centers.map((center) => [center.id, center]))
  const active = input.centers.filter((center) => center.isActive)
  const itemById = new Map(input.items.map((item) => [item.id, item]))

  // Kalemde satırı olan merkezler: gerçekleşen en yakın planlı merkeze çıkar.
  const lineCenters = new Map<string, Set<string>>()
  const drafts = new Map<string, RowDraft>()
  const rowKey = (itemId: string, centerId: string | null) => `${itemId}:${centerId ?? UNALLOCATED}`
  for (const line of input.lines) {
    if (!itemById.has(line.itemId)) continue
    const set = lineCenters.get(line.itemId) ?? new Set<string>()
    set.add(line.costCenterId)
    lineCenters.set(line.itemId, set)
    drafts.set(rowKey(line.itemId, line.costCenterId), {
      itemId: line.itemId,
      centerId: line.costCenterId,
      line,
      actualByMonth: new Map(),
    })
  }

  // Ücret türü → gelir kalemi: etkin kalem önce, yoksa dönemde satırı olan pasif kalem (kod sırası).
  const incomeItems = input.items
    .filter((item) => item.kind === 'income' && item.feeKind !== null)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.code.localeCompare(b.code))
  const itemForFee = new Map<FeeItemKind, string>()
  for (const item of incomeItems) {
    if (item.feeKind === null || itemForFee.has(item.feeKind)) continue
    if (item.isActive || lineCenters.has(item.id)) itemForFee.set(item.feeKind, item.id)
  }

  // Öğrenci bağı: sözleşmenin sınıfı, yoksa öğrencinin sınıfı; kur paket satışından ya da tek kurdan.
  const classById = new Map(input.classes.map((item) => [item.id, item]))
  const studentClass = new Map(input.students.map((student) => [student.id, student.classId]))
  const contractClass = new Map(input.contracts.map((contract) => [contract.id, contract.classId]))
  const centerCache = new Map<string, string | null>()
  const centerFor = (studentId: string, contractId: string | null): string | null => {
    const cacheKey = `${studentId}|${contractId ?? ''}`
    const cached = centerCache.get(cacheKey)
    if (cached !== undefined) return cached
    const classId =
      (contractId === null ? undefined : contractClass.get(contractId)) ??
      studentClass.get(studentId)
    const classroom = classId === undefined ? undefined : classById.get(classId)
    const ownCourses = input.studentCourseIds.get(studentId) ?? []
    const courseId =
      (contractId === null ? undefined : input.contractCourseIds.get(contractId)) ??
      (ownCourses.length === 1 ? ownCourses[0] : undefined)
    const link: Link = {
      campusId: classroom?.branchId ?? null,
      gradeLevel: input.institutionType === 'school' ? (classroom?.grade ?? null) : null,
      courseId: input.institutionType === 'language_school' ? (courseId ?? null) : null,
    }
    const matched = matchCenter(link, active, byId)
    centerCache.set(cacheKey, matched)
    return matched
  }
  const plannedCenter = (itemId: string, matched: string | null): string | null => {
    if (matched === null) return null
    const planned = lineCenters.get(itemId)
    if (planned === undefined) return matched
    return ancestorsOf(byId, matched).find((id) => planned.has(id)) ?? matched
  }
  const addActual = (itemId: string, centerId: string | null, month: string, cents: number) => {
    const key = rowKey(itemId, centerId)
    let draft = drafts.get(key)
    if (draft === undefined) {
      draft = { itemId, centerId, line: null, actualByMonth: new Map() }
      drafts.set(key, draft)
    }
    draft.actualByMonth.set(month, (draft.actualByMonth.get(month) ?? 0) + cents)
  }

  const inPeriod = (day: string) => asOfDate !== null && day >= period.startDate && day <= asOfDate
  const unmatchedByFee = new Map<FeeItemKind | null, Map<string, number>>()
  const { movements, openingImport } = movementsOf(input)
  for (const movement of movements) {
    if (!inPeriod(movement.day)) continue
    const month = movement.day.slice(0, 7)
    const itemId = movement.feeKind === null ? undefined : itemForFee.get(movement.feeKind)
    if (itemId === undefined) {
      const byMonth = unmatchedByFee.get(movement.feeKind) ?? new Map<string, number>()
      byMonth.set(month, (byMonth.get(month) ?? 0) + movement.cents)
      unmatchedByFee.set(movement.feeKind, byMonth)
      continue
    }
    addActual(
      itemId,
      plannedCenter(itemId, centerFor(movement.studentId, movement.contractId)),
      month,
      movement.cents,
    )
  }
  if (input.expenses !== null)
    for (const expense of input.expenses) {
      const item = itemById.get(expense.itemId)
      const day = input.basis === 'accrual' ? expense.accrualDate : expense.paidDate
      if (item?.kind !== 'expense' || day === null || !inPeriod(day)) continue
      const centerId =
        expense.costCenterId !== null && byId.has(expense.costCenterId)
          ? expense.costCenterId
          : null
      addActual(item.id, plannedCenter(item.id, centerId), day.slice(0, 7), expense.amountCents)
    }

  const rows: BudgetActualRow[] = []
  for (const [key, draft] of drafts) {
    const item = itemById.get(draft.itemId)
    if (item === undefined) continue
    const center = draft.centerId === null ? undefined : byId.get(draft.centerId)
    const status: BudgetActualStatus = !started
      ? 'not_started'
      : item.kind === 'expense'
        ? input.expenses === null
          ? 'no_expense_data'
          : 'mapped'
        : item.feeKind === null || itemForFee.get(item.feeKind) !== item.id
          ? 'unmapped_item'
          : 'mapped'
    const computed = status === 'mapped'
    const plannedCents = draft.line?.amountCents ?? 0
    const monthly = draft.line === null ? months.map(() => 0) : draft.line.monthlyCents
    const monthRows = months.map((month, index): BudgetActualMonth => {
      const plannedMonth = monthly === null ? null : (monthly[index] ?? 0)
      const actual = computed && monthOpen(month) ? (draft.actualByMonth.get(month) ?? 0) : null
      return {
        month,
        plannedCents: plannedMonth,
        actualCents: actual,
        varianceCents: diff(actual, plannedMonth),
        realizationBasisPoints: ratio(actual, plannedMonth),
      }
    })
    const actualCents = computed
      ? monthRows.reduce((sum, month) => sum + (month.actualCents ?? 0), 0)
      : null
    const ended = asOfDate !== null && asOfDate === period.endDate
    const plannedToDateCents = ended
      ? plannedCents
      : monthly === null
        ? null
        : monthRows.reduce(
            (sum, month, index) => sum + (monthOpen(month.month) ? (monthly[index] ?? 0) : 0),
            0,
          )
    rows.push({
      key,
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      itemKind: item.kind,
      feeKind: item.feeKind,
      costCenterId: center?.id ?? null,
      costCenterCode: center?.code ?? null,
      costCenterName: center?.name ?? null,
      costCenterPath: center === undefined ? null : costCenterPath(byId, center.id),
      hasLine: draft.line !== null,
      plannedCents,
      plannedToDateCents,
      actualCents,
      varianceCents: diff(actualCents, plannedCents),
      realizationBasisPoints: ratio(actualCents, plannedCents),
      status,
      months: monthRows,
    })
  }
  rows.sort(
    (a, b) =>
      (a.itemKind === b.itemKind ? 0 : a.itemKind === 'income' ? -1 : 1) ||
      a.itemCode.localeCompare(b.itemCode) ||
      (a.costCenterPath === null ? 1 : 0) - (b.costCenterPath === null ? 1 : 0) ||
      (a.costCenterPath ?? '').localeCompare(b.costCenterPath ?? ''),
  )

  const unmatched: BudgetActualUnmatched[] = started
    ? [...unmatchedByFee]
        .map(([feeKind, byMonth]) => {
          const monthRows = months.map((month) => ({
            month,
            actualCents: monthOpen(month) ? (byMonth.get(month) ?? 0) : null,
          }))
          return {
            feeKind,
            actualCents: monthRows.reduce((sum, month) => sum + (month.actualCents ?? 0), 0),
            months: monthRows,
          }
        })
        .filter((entry) => entry.actualCents !== 0 || entry.months.some((m) => m.actualCents))
        .sort((a, b) =>
          a.feeKind === null ? 1 : b.feeKind === null ? -1 : a.feeKind.localeCompare(b.feeKind),
        )
    : []

  const totalOf = (kind: BudgetItemKind, available: boolean): BudgetActualTotals => {
    const own = rows.filter((row) => row.itemKind === kind)
    const plannedCents = own.reduce((sum, row) => sum + row.plannedCents, 0)
    const actualCents = available ? own.reduce((sum, row) => sum + (row.actualCents ?? 0), 0) : null
    return {
      plannedCents,
      actualCents,
      varianceCents: diff(actualCents, plannedCents),
      realizationBasisPoints: ratio(actualCents, plannedCents),
    }
  }
  const income = totalOf('income', started)
  const expense = totalOf('expense', started && input.expenses !== null)
  return {
    periodId: period.id,
    basis: input.basis,
    startDate: period.startDate,
    endDate: period.endDate,
    asOfDate,
    months,
    expenseData: input.expenses === null ? 'none' : 'available',
    rows,
    unmatched,
    totals: {
      income: {
        ...income,
        unmatchedCents: started
          ? unmatched.reduce((sum, entry) => sum + entry.actualCents, 0)
          : null,
      },
      expense,
      net: {
        plannedCents: income.plannedCents - expense.plannedCents,
        actualCents:
          income.actualCents === null || expense.actualCents === null
            ? null
            : income.actualCents - expense.actualCents,
      },
    },
    openingImportCents:
      input.basis === 'cash'
        ? openingImport.filter((m) => inPeriod(m.day)).reduce((sum, m) => sum + m.cents, 0)
        : 0,
  }
}

// --- CSV -----------------------------------------------------------------------------------------

const UNALLOCATED_LABEL = 'Dağıtılmamış'
const UNKNOWN_FEE_LABEL = 'Kalemi belirsiz tahsilat'

/** Satırın merkez gösterimi; dağıtılmamış satırda sabit etiket. */
export const actualCenterLabel = (
  row: Pick<BudgetActualRow, 'costCenterPath' | 'costCenterName'>,
) =>
  row.costCenterPath === null
    ? UNALLOCATED_LABEL
    : `${row.costCenterPath} · ${row.costCenterName ?? ''}`

/** Eşlenmemiş gelirin gösterimi. */
export const unmatchedLabel = (feeKind: FeeItemKind | null) =>
  feeKind === null ? UNKNOWN_FEE_LABEL : `${FEE_ITEM_KIND_LABELS[feeKind]} (kaleme eşlenmemiş)`

const optionalAmount = (cents: number | null) => (cents === null ? csvCell('') : csvAmount(cents))

/**
 * Uzun biçim CSV: her satır için ay ay ve "Dönem" toplamı. Tutar ondalık virgüllü TL, oran yüzde.
 * Kişi verisi taşımaz; tarayıcıda yanıttan üretilir.
 */
export function budgetActualsCsv(report: BudgetActuals): string {
  const header = [
    'Kalem kodu',
    'Kalem',
    'Tür',
    'Maliyet merkezi',
    'Ay',
    'Plan (₺)',
    'Gerçekleşen (₺)',
    'Fark (₺)',
    'Gerçekleşme (%)',
    'Durum',
  ]
  const lines: string[][] = [header.map(csvCell)]
  for (const row of report.rows) {
    const head = [
      csvCell(row.itemCode),
      csvCell(row.itemName),
      csvCell(BUDGET_ITEM_KIND_LABELS[row.itemKind]),
      csvCell(actualCenterLabel(row)),
    ]
    const status = csvCell(BUDGET_ACTUAL_STATUS_LABELS[row.status])
    for (const month of row.months)
      lines.push([
        ...head,
        csvCell(month.month),
        optionalAmount(month.plannedCents),
        optionalAmount(month.actualCents),
        optionalAmount(month.varianceCents),
        optionalAmount(month.realizationBasisPoints),
        status,
      ])
    lines.push([
      ...head,
      csvCell('Dönem'),
      csvAmount(row.plannedCents),
      optionalAmount(row.actualCents),
      optionalAmount(row.varianceCents),
      optionalAmount(row.realizationBasisPoints),
      status,
    ])
  }
  for (const entry of report.unmatched) {
    const head = [
      csvCell(''),
      csvCell(unmatchedLabel(entry.feeKind)),
      csvCell(BUDGET_ITEM_KIND_LABELS.income),
      csvCell(''),
    ]
    const status = csvCell('Eşlenmemiş gelir')
    for (const month of entry.months)
      lines.push([
        ...head,
        csvCell(month.month),
        csvCell(''),
        optionalAmount(month.actualCents),
        csvCell(''),
        csvCell(''),
        status,
      ])
    lines.push([
      ...head,
      csvCell('Dönem'),
      csvCell(''),
      csvAmount(entry.actualCents),
      csvCell(''),
      csvCell(''),
      status,
    ])
  }
  return lines.map((line) => line.join(CSV_SEPARATOR)).join('\r\n')
}
