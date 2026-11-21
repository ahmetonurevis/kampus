import { z } from 'zod'

import type { State } from '../data/seed.ts'
import {
  ACADEMIC_YEAR_MAX,
  ACADEMIC_YEAR_MIN,
  addDays,
  defaultAcademicYearDates,
} from './academic-years.ts'
import { isContractInForce } from './contract-status.ts'
import { DomainError } from './errors.ts'
import { assertFinancePeriod, type FinancePeriod, type StudentDirectory } from './finance-export.ts'
import { dayKey } from './format.ts'
import { isOpeningImport } from './payments.ts'
import type { WithdrawalBreakdown, WithdrawalContractLine } from './withdrawals.ts'

/**
 * Yıl sonu mutabakatı (ON-085, IST-111; docs/domain/finans.md DOM-FIN-056). Yalnız raporlamadır: yıl
 * kapatmaz, kilit koymaz. Hareketler mevcut aktarımla aynı gün kurallarıyla sayılır, bu yüzden
 * toplamlar `/finance/summary` ile aynı döner: taksit vade gününde, tahsilat ödeme gününde, iptal
 * iptal gününde, iade ödeme gününde.
 *
 * Denetim iki yanı karşılaştırır. Kapanış, taksitin durumu ve dağılımlardan (stok); beklenen kapanış
 * açılışa hareketlerin eklenmesinden bulunur:
 *
 *   açılış + tahakkuk − ayrılış düzeltmesi − tahsilat − açılış aktarımı + iptal + iade = kapanış
 *
 * Alacak tahsilat toplamından çıkarılarak bulunmaz, kaynaklarından tek tek toplanır (dağıtılmayan
 * kısım, avans, iptal edilen taksite alınan para). Bu yüzden iki yan yalnız kayıtlar birbiriyle
 * tutarlıysa eşitlenir: tahsilat kaydı olmadan ödenmiş taksit, başka öğrencinin taksitine yazılmış
 * dağılım ya da tahsilatı aşan dağılım farka düşer.
 *
 * Açılış aktarımı (DOM-FIN-014) dosyadan gelen geçmiş ödemedir: borcu ödeme gününde kapatır, tahsilat
 * satırı yoktur, kasaya ve tahsilat kalemine girmez. Formülde kendi kalemi olduğu için tutmayan
 * sayılmaz; tahakkuktan düşülmez, çünkü tahakkuk aktarım dosyasının taksit toplamına eşit kalmalıdır.
 * Vadesinden önce aktarılan ödeme, tahsilat gibi vade gününe kadar alacaktır.
 *
 * Ödenen iade para çıkışıdır, borcu düşürmez: öğrenciye geri ödenen tutar kurumun iade borcunu
 * kapatır, bakiyeyi sıfıra doğru artırır. Borcu düşüren, ayrılışta hak edilmeyen tahakkuktur; ayrılış
 * düzeltmesi budur. Burs ve indirim formüle girmez: taksitler zaten netten açılır, sütunlar bilgi
 * içindir ve sözleşmenin eğitim yılından okunur.
 */

const reconciliationYearSchema = z.coerce
  .number('Eğitim yılını seçin.')
  .int('Eğitim yılını seçin.')
  .min(ACADEMIC_YEAR_MIN, 'Eğitim yılı geçersiz.')
  .max(ACADEMIC_YEAR_MAX, 'Eğitim yılı geçersiz.')

export const financeReconciliationExportQuerySchema = z.strictObject({
  year: reconciliationYearSchema,
})

export const FINANCE_RECONCILIATION_STATUSES = ['all', 'mismatch'] as const
export type FinanceReconciliationStatus = (typeof FINANCE_RECONCILIATION_STATUSES)[number]

export const financeReconciliationQuerySchema = financeReconciliationExportQuerySchema.extend({
  status: z.enum(FINANCE_RECONCILIATION_STATUSES, 'Durum geçersiz.').default('all'),
})

/**
 * Dönem kurumun eğitim yılı aralığıdır; kayıt yoksa 1 Eylül – 31 Ağustos. Süren yılda bitiş bugündür:
 * gelecek vadeler henüz borç değildir. Başlamamış yılın mutabakatı olmaz.
 */
export function reconciliationPeriod(
  year: number,
  range: { startDate: string; endDate: string } | null,
  today: string,
): FinancePeriod {
  const { startDate, endDate } = range ?? defaultAcademicYearDates(year)
  if (startDate > today)
    throw new DomainError('reconciliation_year_not_started', 'Bu eğitim yılı henüz başlamadı.', {
      path: ['year'],
    })
  const period = { from: startDate, to: endDate < today ? endDate : today }
  assertFinancePeriod(period)
  return period
}

export interface ReconciliationPayment {
  // kvkk: K — öğrenci kaydı
  studentId: string
  amountCents: number
  paidAt: string
  reversedAt: string | null
  allocations: readonly { invoiceId: string; amountCents: number }[]
}

export interface ReconciliationWithdrawal {
  // kvkk: K — öğrenci kaydı
  studentId: string
  contractId: string
  withdrawalDate: string
  refundCents: number
  debtCents: number
  refundPaidDate: string | null
  breakdown: Pick<WithdrawalBreakdown, 'paidCents' | 'creditCents' | 'extras' | 'debtInvoiceId'> & {
    /** Hesaba giren sözleşmeler (K-06); eski kayıtta yoktur, yalnız `contractId` sayılır. */
    contracts?: readonly Pick<WithdrawalContractLine, 'contractId'>[]
  }
}

export const RECONCILIATION_MISMATCH_REASONS = ['unrecorded_payment', 'other'] as const
export type ReconciliationMismatchReason = (typeof RECONCILIATION_MISMATCH_REASONS)[number]

export const RECONCILIATION_MISMATCH_LABELS: Readonly<
  Record<ReconciliationMismatchReason, string>
> = {
  unrecorded_payment: 'Tahsilat kaydı olmadan ödenmiş taksit',
  other: 'Kayıtlar incelenmeli',
}

/** Formüldeki ve bilgi amaçlı tutarlar; satır da toplam da aynı şekildedir. */
export interface ReconciliationAmounts {
  openingCents: number
  accruedCents: number
  /** Ayrılışta hak edilmeyen tahakkuk; iptal edilen taksite alınmış para varsa eksi olabilir. */
  withdrawalAdjustmentCents: number
  collectedCents: number
  /** Dosyadan aktarılan geçmiş ödeme; ödeme gününde borcu kapatır, tahsilat değildir. */
  openingImportCents: number
  reversedCents: number
  refundedCents: number
  scholarshipCents: number
  discountCents: number
  /** Stoktan: açık borç − alacak. Eksi değer kurumun öğrenciye borcudur. */
  closingCents: number
  /** Hareketlerden: açılış + tahakkuk − ayrılış düzeltmesi − tahsilat − aktarım + iptal + iade. */
  expectedClosingCents: number
  /** Kapanış − beklenen kapanış; sıfırdan farklıysa öğrenci tutmaz. */
  differenceCents: number
  openDebtCents: number
  /** Dağıtılmamış tahsilat, vadesi gelmemiş taksite alınan avans ya da aktarım, ödenmemiş iade. */
  creditCents: number
}

export interface ReconciliationRow extends ReconciliationAmounts {
  // kvkk: K — öğrenci kaydı
  studentId: string
  // kvkk: K
  studentName: string
  // kvkk: K
  studentNumber: string
  mismatchReason: ReconciliationMismatchReason | null
}

export interface FinanceReconciliation {
  year: number
  from: string
  to: string
  totals: ReconciliationAmounts
  studentCount: number
  mismatchCount: number
  rows: ReconciliationRow[]
}

type Invoice = Pick<
  State['invoices'][number],
  'id' | 'studentId' | 'amount' | 'paidAt' | 'dueDate' | 'installment' | 'method'
>
type Contract = State['contracts'][number]

type Movement = { paidDay: string; reversedDay: string | null; amountCents: number }
type PaymentMovement = Movement & {
  allocations: readonly { invoiceId: string; amountCents: number }[]
}

const standingOn = (movement: Movement, day: string) =>
  movement.paidDay <= day && (movement.reversedDay === null || movement.reversedDay > day)

const push = <K, V>(index: Map<K, V[]>, key: K, value: V) => {
  const list = index.get(key)
  if (list) list.push(value)
  else index.set(key, [value])
}

const sumOf = <T>(items: readonly T[], read: (item: T) => number) =>
  items.reduce((total, item) => total + read(item), 0)

/**
 * Ayrılışta mahsup edilen alacak: öğrencinin ödediği tutarın, listede kalan ödenmiş taksitlerin dışında
 * kalan kısmı (iptal edilen taksite alınan ve dağıtılmayan para). Ayrılış hesabı bunu iade ya da kalan
 * borçla netleştirir (`quoteWithdrawal`), bu yüzden ayrılıştan sonra alacak sayılmaz. Borç taksiti
 * ayrılıştan sonra ödense de sayılmaz; kimliği eski kayıtta yoktur, en büyük taksit numaralı olandır.
 * Hesaba giren bütün sözleşmelerin (K-06) ödenmiş taksitleri sayılır; ödenen tutar hepsini kapsar.
 */
export function withdrawalSettledCredit(
  withdrawal: ReconciliationWithdrawal,
  invoices: readonly Invoice[],
  contracts: readonly (Contract | undefined)[],
): number {
  const { breakdown } = withdrawal
  // Taksit listesi olmayan eski sözleşme öğrencinin bütün taksitlerini kapsar.
  const listed = contracts.every((contract) => contract?.invoiceIds)
    ? new Set(contracts.flatMap((contract) => contract?.invoiceIds ?? []))
    : null
  const ofContract = invoices.filter((invoice) => (listed ? listed.has(invoice.id) : true))
  const lastInstallment = ofContract.reduce<Invoice | undefined>(
    (last, invoice) =>
      last === undefined || invoice.installment > last.installment ? invoice : last,
    undefined,
  )
  const debtId =
    breakdown.debtInvoiceId ?? (withdrawal.debtCents > 0 ? lastInstallment?.id : undefined)
  const keptCents = sumOf(
    ofContract.filter((invoice) => invoice.paidAt && invoice.id !== debtId),
    (invoice) => invoice.amount,
  )
  const paidCents =
    breakdown.paidCents + breakdown.creditCents + sumOf(breakdown.extras, (line) => line.paidCents)
  return paidCents - keptCents
}

const EMPTY_AMOUNTS: ReconciliationAmounts = {
  openingCents: 0,
  accruedCents: 0,
  withdrawalAdjustmentCents: 0,
  collectedCents: 0,
  openingImportCents: 0,
  reversedCents: 0,
  refundedCents: 0,
  scholarshipCents: 0,
  discountCents: 0,
  closingCents: 0,
  expectedClosingCents: 0,
  differenceCents: 0,
  openDebtCents: 0,
  creditCents: 0,
}

const AMOUNT_KEYS = Object.keys(EMPTY_AMOUNTS) as (keyof ReconciliationAmounts)[]

/**
 * Öğrenci bazında mutabakat. Kapsam ve kurum burada denetlenmez; satırları servis kurumun
 * kayıtlarından yükler. Hiç hareketi ve bakiyesi olmayan öğrenci satır üretmez.
 */
export function financeReconciliation(input: {
  year: number
  period: FinancePeriod
  invoices: readonly Invoice[]
  contracts: readonly Contract[]
  /** Planlanmış yenilemesi iptal edilen sözleşmeler; burs ve indirimi sayılmaz. */
  cancelledContractIds: ReadonlySet<string>
  payments: readonly ReconciliationPayment[]
  withdrawals: readonly ReconciliationWithdrawal[]
  students: StudentDirectory
}): FinanceReconciliation {
  const { year, period, students } = input
  const opening = addDays(period.from, -1)
  const inPeriod = (day: string) => day >= period.from && day <= period.to

  const invoicesOf = new Map<string, Invoice[]>()
  for (const invoice of input.invoices) push(invoicesOf, invoice.studentId, invoice)

  const invoiceById = new Map(input.invoices.map((invoice) => [invoice.id, invoice]))
  const dueDayOf = new Map(input.invoices.map((item) => [item.id, dayKey(item.dueDate)]))
  const importDayOf = new Map(
    input.invoices.flatMap((item) =>
      item.paidAt && isOpeningImport(item) ? [[item.id, dayKey(item.paidAt)] as const] : [],
    ),
  )

  const paymentsOf = new Map<string, PaymentMovement[]>()
  const allocationsOf = new Map<string, Movement[]>()
  for (const payment of input.payments) {
    const paidDay = dayKey(payment.paidAt)
    const reversedDay = payment.reversedAt === null ? null : dayKey(payment.reversedAt)
    push(paymentsOf, payment.studentId, {
      paidDay,
      reversedDay,
      amountCents: payment.amountCents,
      allocations: payment.allocations,
    })
    for (const { invoiceId, amountCents } of payment.allocations)
      push(allocationsOf, invoiceId, { paidDay, reversedDay, amountCents })
  }

  const contractById = new Map(input.contracts.map((contract) => [contract.id, contract]))
  const withdrawalsOf = new Map<string, (ReconciliationWithdrawal & { settled: number })[]>()
  for (const withdrawal of input.withdrawals)
    push(withdrawalsOf, withdrawal.studentId, {
      ...withdrawal,
      settled: withdrawalSettledCredit(
        withdrawal,
        invoicesOf.get(withdrawal.studentId) ?? [],
        (
          withdrawal.breakdown.contracts?.map((line) => line.contractId) ?? [withdrawal.contractId]
        ).map((id) => contractById.get(id)),
      ),
    })

  // Sürüm zinciri öğrenci içindedir; yürürlük denetimi kurumun bütün sözleşmelerini taramaz.
  const allContractsOf = new Map<string, Contract[]>()
  for (const contract of input.contracts) push(allContractsOf, contract.studentId, contract)
  const contractsOf = new Map<string, Contract[]>()
  for (const [studentId, contracts] of allContractsOf)
    for (const contract of contracts)
      if (
        contract.academicYear === year &&
        !input.cancelledContractIds.has(contract.id) &&
        isContractInForce(contract, contracts)
      )
        push(contractsOf, studentId, contract)

  /** Verilen günün sonundaki durum: dağılımlar o günde geçerli olan tahsilatlardan okunur. */
  const standing = (studentId: string, day: string) => {
    let openDebt = 0
    let unrecorded = 0
    let credit = 0
    for (const invoice of invoicesOf.get(studentId) ?? []) {
      const importDay = importDayOf.get(invoice.id)
      const imported = importDay !== undefined && importDay <= day
      if ((dueDayOf.get(invoice.id) ?? '') > day) {
        if (imported) credit += invoice.amount
        continue
      }
      const allocated = sumOf(
        (allocationsOf.get(invoice.id) ?? []).filter((item) => standingOn(item, day)),
        (item) => item.amountCents,
      )
      const applied = Math.min(allocated, invoice.amount)
      const settled = invoice.paidAt && dayKey(invoice.paidAt) <= day ? invoice.amount : applied
      openDebt += invoice.amount - settled
      if (!imported) unrecorded += settled - applied
      // Taksiti aşan dağılım borçtan düşülmez, alacak kalır (`financeTotals` ile aynı kural).
      credit += allocated - applied
    }
    for (const payment of paymentsOf.get(studentId) ?? []) {
      if (!standingOn(payment, day)) continue
      const distributed = sumOf(payment.allocations, (item) => item.amountCents)
      credit += Math.max(payment.amountCents - distributed, 0)
      for (const { invoiceId, amountCents } of payment.allocations) {
        const invoice = invoiceById.get(invoiceId)
        // Listede olmayan taksit ayrılışta iptal edilmiştir; başka öğrencinin taksiti alacak yazmaz.
        if (invoice === undefined) credit += amountCents
        else if (invoice.studentId === studentId && (dueDayOf.get(invoiceId) ?? '') > day)
          credit += amountCents
      }
    }
    for (const withdrawal of withdrawalsOf.get(studentId) ?? []) {
      if (withdrawal.withdrawalDate <= day) credit += withdrawal.refundCents - withdrawal.settled
      if (withdrawal.refundPaidDate !== null && withdrawal.refundPaidDate <= day)
        credit -= withdrawal.refundCents
    }
    return { openDebt, credit, balance: openDebt - credit, unrecorded }
  }

  const studentIds = new Set([
    ...invoicesOf.keys(),
    ...paymentsOf.keys(),
    ...withdrawalsOf.keys(),
    ...contractsOf.keys(),
  ])
  const rows: ReconciliationRow[] = []
  for (const studentId of studentIds) {
    const start = standing(studentId, opening)
    const end = standing(studentId, period.to)
    const movements = paymentsOf.get(studentId) ?? []
    const withdrawals = withdrawalsOf.get(studentId) ?? []
    const contracts = contractsOf.get(studentId) ?? []

    const openingCents = start.balance
    const accruedCents = sumOf(
      (invoicesOf.get(studentId) ?? []).filter((invoice) =>
        inPeriod(dueDayOf.get(invoice.id) ?? ''),
      ),
      (invoice) => invoice.amount,
    )
    const withdrawalAdjustmentCents = sumOf(
      withdrawals.filter((item) => inPeriod(item.withdrawalDate)),
      (item) => item.refundCents - item.settled,
    )
    const collectedCents = sumOf(
      movements.filter((item) => inPeriod(item.paidDay)),
      (item) => item.amountCents,
    )
    const openingImportCents = sumOf(
      (invoicesOf.get(studentId) ?? []).filter((invoice) =>
        inPeriod(importDayOf.get(invoice.id) ?? ''),
      ),
      (invoice) => invoice.amount,
    )
    const reversedCents = sumOf(
      movements.filter((item) => item.reversedDay !== null && inPeriod(item.reversedDay)),
      (item) => item.amountCents,
    )
    const refundedCents = sumOf(
      withdrawals.filter((item) => item.refundPaidDate !== null && inPeriod(item.refundPaidDate)),
      (item) => item.refundCents,
    )
    const scholarshipCents = sumOf(contracts, (item) => item.scholarship?.amountCents ?? 0)
    const discountCents = sumOf(contracts, (item) =>
      sumOf(item.discounts ?? [], (line) => line.amountCents),
    )
    const expectedClosingCents =
      openingCents +
      accruedCents -
      withdrawalAdjustmentCents -
      collectedCents -
      openingImportCents +
      reversedCents +
      refundedCents
    const closingCents = end.balance
    const differenceCents = closingCents - expectedClosingCents
    const amounts: ReconciliationAmounts = {
      openingCents,
      accruedCents,
      withdrawalAdjustmentCents,
      collectedCents,
      openingImportCents,
      reversedCents,
      refundedCents,
      scholarshipCents,
      discountCents,
      closingCents,
      expectedClosingCents,
      differenceCents,
      openDebtCents: end.openDebt,
      creditCents: end.credit,
    }
    if (AMOUNT_KEYS.every((key) => amounts[key] === 0)) continue
    const student = students.get(studentId)
    rows.push({
      studentId,
      studentName: student?.name ?? '',
      studentNumber: student?.number === undefined ? '' : String(student.number),
      ...amounts,
      mismatchReason:
        differenceCents === 0
          ? null
          : differenceCents === start.unrecorded - end.unrecorded
            ? 'unrecorded_payment'
            : 'other',
    })
  }
  rows.sort(
    (a, b) =>
      a.studentName.localeCompare(b.studentName, 'tr') || a.studentId.localeCompare(b.studentId),
  )
  const totals = { ...EMPTY_AMOUNTS }
  for (const row of rows) for (const key of AMOUNT_KEYS) totals[key] += row[key]
  return {
    year,
    from: period.from,
    to: period.to,
    totals,
    studentCount: rows.length,
    mismatchCount: rows.filter((row) => row.differenceCents !== 0).length,
    rows,
  }
}
