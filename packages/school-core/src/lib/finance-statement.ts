import { studentBalance, type StudentBalance } from './finance-export.ts'
import { receiptNumberLabel } from './finance-receipt.ts'
import { dayKey, money } from './format.ts'
import { isOpeningImport } from './payments.ts'

/**
 * Öğrencinin cari ekstresi (IST-107): taksitler borç, tahsilatlar alacak olarak tarih sırasıyla
 * yürüyen bakiyeyle yazılır. Bakiye `studentBalance` ile aynı kuraldadır; ekstre toplamı taksit
 * ve tahsilat kayıtlarıyla bu yüzden tutarlı kalır. İptal edilen tahsilat silinmez, iptal gününe
 * ters kayıt olarak düşer (DOM-FIN-033). Dosyadan aktarılan geçmiş ödeme borcu kapatır ama tahsilat
 * değildir: `opening_import` satırıdır, dekont ve tahsilat yöntemi taşımaz (DOM-FIN-014).
 *
 * Ayrılış (DOM-FIN-040, -041) açık taksitleri listeden kaldırır; onlara alınan tutar ve o gün
 * dağıtılmamış tahsilat ayrılış hesabına girer, artık iade alacağı değildir. Bu tutarlar tahsilat
 * satırında alacak yazılır, ayrılış gününe hesabı kapatan `withdrawal_settlement` satırı düşer:
 * `mahsup edilen − iade`, artıysa hak edilen ücret (borç), eksiyse iade alacağıdır. Ödenen iade
 * `refund_payment` borç satırıdır. Ödenmemiş iade bakiyeyi açık tutarın altına indirir
 * (`refundDueCents`); yıl sonu mutabakatı aynı ayrılış düzeltmesini sayar (DOM-FIN-056).
 */

export type StatementInvoice = {
  id: string
  installment: number
  amount: number
  paidAt: string | null
  dueDate: string
  method?: string | null
}

export type StatementPayment = {
  id: string
  amountCents: number
  method: string
  reference: string | null
  paidAt: string
  receiptYear: number
  receiptNumber: number
  reversedAt: string | null
  allocations: readonly { invoiceId: string; amountCents: number }[]
}

/** Öğrencinin ayrılış kaydından ekstreye giren kısım; döküm gerekçesi ve hesap bilgisi girmez. */
export type StatementWithdrawal = {
  id: string
  /** Ayrılış günü (YYYY-MM-DD). */
  withdrawalDate: string
  refundCents: number
  /** İadenin ödendiği gün; ödenmediyse boş. */
  refundPaidDate: string | null
  /** Ayrılışta mahsup edilen dağıtılmamış tahsilat (dökümdeki `creditCents`). */
  creditCents: number
}

export type StatementLineKind =
  /** Taksit borcu; vade gününe yazılır. */
  | 'installment'
  /** Tahsilat kaydı; yalnız taksite dağıtılan kısım alacak yazar. */
  | 'payment'
  /** İptal edilen tahsilatın ters kaydı. */
  | 'payment_reversal'
  /** Tahsilat kaydı olmadan ödenmiş eski taksit. */
  | 'legacy_payment'
  /** Dosyadan aktarılan geçmiş ödeme; tahsilat değildir, borcu kapatır (DOM-FIN-014). */
  | 'opening_import'
  /** Ayrılış hesabı: mahsup edilen tutar ile iade arasındaki fark (DOM-FIN-040). */
  | 'withdrawal_settlement'
  /** Ayrılış iadesinin ödenmesi. */
  | 'refund_payment'

export type StatementLine = {
  kind: StatementLineKind
  date: string
  debitCents: number
  creditCents: number
  /** Bu satırdan sonraki bakiye: artı değer öğrencinin borcudur. */
  balanceCents: number
  invoiceId: string | null
  installment: number | null
  /** Taksitin bugün açık kalan kısmı. */
  openCents: number | null
  isOverdue: boolean
  paymentId: string | null
  method: string | null
  reference: string | null
  receiptYear: number | null
  receiptNumber: number | null
  /** Tahsilatın taksite dağıtılmayan kısmı. */
  unappliedCents: number
}

export type StudentStatement = StudentBalance & {
  debitTotalCents: number
  creditTotalCents: number
  /** Geçerli tahsilatlardan taksite dağıtılmayan tutar: iade alacağıdır, bakiyeyi düşürmez. */
  unappliedCents: number
  /** Ödenmemiş ayrılış iadesi: kurumun öğrenciye borcu; son bakiye `openCents − refundDueCents`. */
  refundDueCents: number
  lines: StatementLine[]
}

type DraftLine = Omit<StatementLine, 'balanceCents'>

const EMPTY_LINE = {
  debitCents: 0,
  creditCents: 0,
  invoiceId: null,
  installment: null,
  openCents: null,
  isOverdue: false,
  paymentId: null,
  method: null,
  reference: null,
  receiptYear: null,
  receiptNumber: null,
  unappliedCents: 0,
} as const

/** Aynı gün önce borç, sonra tahsilat, en son ters kayıt yazılır; sıra kimlikle sabittir. */
const KIND_ORDER: Readonly<Record<StatementLineKind, number>> = {
  installment: 0,
  legacy_payment: 1,
  opening_import: 1,
  payment: 1,
  payment_reversal: 2,
  withdrawal_settlement: 3,
  refund_payment: 4,
}

/**
 * İptal edilmiş taksite alınan tutarın ayrılışı: tahsilat günü ve sonrasındaki ilk ayrılış, yoksa
 * sonuncusu (geriye tarihli ayrılış). Aynı öğrencinin birden çok ayrılışı istisnadır.
 */
function withdrawalIndexFor(withdrawals: readonly StatementWithdrawal[], paidDay: string): number {
  const index = withdrawals.findIndex((item) => item.withdrawalDate >= paidDay)
  return index === -1 ? withdrawals.length - 1 : index
}

export function studentStatement(
  studentId: string,
  invoices: readonly StatementInvoice[],
  payments: readonly StatementPayment[],
  today: string,
  withdrawalRecords: readonly StatementWithdrawal[] = [],
): StudentStatement {
  const amounts = new Map(invoices.map((invoice) => [invoice.id, invoice.amount]))
  const allocated = new Map<string, number>()
  const lines: DraftLine[] = []
  const withdrawals = [...withdrawalRecords].sort(
    (a, b) => a.withdrawalDate.localeCompare(b.withdrawalDate) || a.id.localeCompare(b.id),
  )
  /** Ayrılış başına hesaba giren (mahsup edilen) tutar. */
  const settled = withdrawals.map(() => 0)
  /** Geçerli tahsilat satırları; dağıtılmamış kısmı ayrılış mahsubunu karşılar. */
  const standing: DraftLine[] = []

  for (const payment of [...payments].sort((a, b) => a.paidAt.localeCompare(b.paidAt))) {
    const reversed = payment.reversedAt !== null
    let applied = 0
    for (const { invoiceId, amountCents } of payment.allocations) {
      // Ayrılış iptal edilen taksiti listeden kaldırır; tahsilat iptali ayrılıştan sonra yalnız borç
      // taksitinde mümkün olduğundan listede olmayan taksite geçerli dağılım ayrılış hesabındadır.
      // Ek protokol yalnız geçerli dağılımı olmayan taksiti kaldırır (onayda da denetlenir,
      // `contract_amendment_stale`); ona kalan dağılım iptal edilmiş tahsilatındır ve buraya girmez.
      if (!reversed && !amounts.has(invoiceId) && withdrawals.length > 0) {
        const index = withdrawalIndexFor(withdrawals, dayKey(payment.paidAt))
        settled[index] = (settled[index] ?? 0) + amountCents
        applied += amountCents
        continue
      }
      // Ayrılış kaydı yokken silinmiş taksite dağılan tutar ve taksiti aşan kısım borçtan düşülmez.
      const room = (amounts.get(invoiceId) ?? 0) - (reversed ? 0 : (allocated.get(invoiceId) ?? 0))
      const taken = Math.min(amountCents, Math.max(room, 0))
      applied += taken
      if (!reversed) allocated.set(invoiceId, (allocated.get(invoiceId) ?? 0) + taken)
    }
    const shared = {
      ...EMPTY_LINE,
      paymentId: payment.id,
      method: payment.method,
      reference: payment.reference,
      receiptYear: payment.receiptYear,
      receiptNumber: payment.receiptNumber,
    }
    const line: DraftLine = {
      ...shared,
      kind: 'payment',
      date: dayKey(payment.paidAt),
      creditCents: applied,
      unappliedCents: payment.amountCents - applied,
    }
    lines.push(line)
    if (payment.reversedAt !== null)
      lines.push({
        ...shared,
        kind: 'payment_reversal',
        date: dayKey(payment.reversedAt),
        debitCents: applied,
      })
    else standing.push(line)
  }

  // Ayrılışta mahsup edilen dağıtılmamış tutar en eski tahsilattan karşılanır: ayrılıştan sonraki
  // fazla ödeme daha yenidir ve iade alacağı olarak kalır.
  withdrawals.forEach((withdrawal, index) => {
    let remaining = withdrawal.creditCents
    for (const line of standing) {
      if (remaining === 0) break
      const taken = Math.min(remaining, line.unappliedCents)
      line.creditCents += taken
      line.unappliedCents -= taken
      settled[index] = (settled[index] ?? 0) + taken
      remaining -= taken
    }
  })
  const unappliedCents = standing.reduce((sum, line) => sum + line.unappliedCents, 0)

  let refundDueCents = 0
  withdrawals.forEach((withdrawal, index) => {
    const net = (settled[index] ?? 0) - withdrawal.refundCents
    if (net !== 0)
      lines.push({
        ...EMPTY_LINE,
        kind: 'withdrawal_settlement',
        date: withdrawal.withdrawalDate,
        debitCents: Math.max(net, 0),
        creditCents: Math.max(-net, 0),
      })
    if (withdrawal.refundPaidDate === null) refundDueCents += withdrawal.refundCents
    else if (withdrawal.refundCents > 0)
      lines.push({
        ...EMPTY_LINE,
        kind: 'refund_payment',
        date: withdrawal.refundPaidDate,
        debitCents: withdrawal.refundCents,
      })
  })

  for (const invoice of invoices) {
    const recorded = allocated.get(invoice.id) ?? 0
    const openCents = invoice.paidAt ? 0 : invoice.amount - recorded
    const dueDate = dayKey(invoice.dueDate)
    lines.push({
      ...EMPTY_LINE,
      kind: 'installment',
      date: dueDate,
      debitCents: invoice.amount,
      invoiceId: invoice.id,
      installment: invoice.installment,
      openCents,
      isOverdue: openCents > 0 && dueDate < today,
    })
    if (invoice.paidAt && invoice.amount > recorded)
      lines.push({
        ...EMPTY_LINE,
        kind: isOpeningImport(invoice) ? 'opening_import' : 'legacy_payment',
        date: dayKey(invoice.paidAt),
        creditCents: invoice.amount - recorded,
        invoiceId: invoice.id,
        installment: invoice.installment,
        method: invoice.method ?? null,
      })
  }

  lines.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.installment ?? 0) - (b.installment ?? 0) ||
      (a.paymentId ?? '').localeCompare(b.paymentId ?? ''),
  )
  let balanceCents = 0
  return {
    ...studentBalance(studentId, invoices, allocated, today),
    debitTotalCents: lines.reduce((sum, line) => sum + line.debitCents, 0),
    creditTotalCents: lines.reduce((sum, line) => sum + line.creditCents, 0),
    unappliedCents,
    refundDueCents,
    lines: lines.map((line) => {
      balanceCents += line.debitCents - line.creditCents
      return { ...line, balanceCents }
    }),
  }
}

const receiptOf = ({ receiptYear, receiptNumber }: StatementLine) =>
  receiptYear === null || receiptNumber === null
    ? ''
    : ` · Dekont ${receiptNumberLabel({ receiptYear, receiptNumber })}`

/** Ekran ve PDF aynı açıklamayı yazar; ekstre ile dekont numarası bu metinden eşleşir. */
export function statementLineLabel(line: StatementLine): string {
  const method = line.method ? ` · ${line.method}` : ''
  switch (line.kind) {
    case 'installment':
      return `${String(line.installment)}. taksit${line.isOverdue ? ' · Gecikmiş' : ''}`
    case 'payment':
      return `Tahsilat${method}${receiptOf(line)}`
    case 'payment_reversal':
      return `Tahsilat iptali${receiptOf(line)}`
    case 'legacy_payment':
      return `${String(line.installment)}. taksit ödemesi${method}`
    case 'opening_import':
      return `Açılış aktarımı · ${String(line.installment)}. taksit`
    case 'withdrawal_settlement':
      return line.debitCents > 0
        ? 'Ayrılış hesabı · hak edilen ücret'
        : 'Ayrılış hesabı · iade alacağı'
    case 'refund_payment':
      return 'İade ödemesi'
    default:
      return line.kind satisfies never
  }
}

/**
 * Ekstrenin açıklama notları; web, PDF ve mobil aynı metni yazar. Ödenmemiş iade bakiyede alacak
 * olarak görünür, kalan tutara dahil değildir (DOM-FIN-040, DOM-FIN-054).
 */
export function statementNotes(
  statement: Pick<StudentStatement, 'unappliedCents' | 'openingImportCents' | 'refundDueCents'>,
): string[] {
  const notes: string[] = []
  if (statement.refundDueCents > 0)
    notes.push(
      `Ayrılış iadesi olarak ${money(statement.refundDueCents)} ödenecektir; bakiyede alacak olarak görünür.`,
    )
  if (statement.unappliedCents > 0)
    notes.push(
      `Taksitlere dağıtılmayan ${money(statement.unappliedCents)} iade alacağıdır; kalan tutardan düşülmemiştir.`,
    )
  if (statement.openingImportCents > 0)
    notes.push(
      `Ödenen tutarın ${money(statement.openingImportCents)} kısmı açılış aktarımıdır: önceki kayıtlardan aktarılmıştır, Kampüs tahsilatı ve dekontu yoktur.`,
    )
  return notes
}
