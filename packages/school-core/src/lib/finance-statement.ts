import { studentBalance, type StudentBalance } from './finance-export.ts'
import { receiptNumberLabel } from './finance-receipt.ts'
import { dayKey } from './format.ts'
import { isOpeningImport } from './payments.ts'

/**
 * Öğrencinin cari ekstresi (IST-107): taksitler borç, tahsilatlar alacak olarak tarih sırasıyla
 * yürüyen bakiyeyle yazılır. Bakiye `studentBalance` ile aynı kuraldadır; ekstre toplamı taksit
 * ve tahsilat kayıtlarıyla bu yüzden tutarlı kalır. İptal edilen tahsilat silinmez, iptal gününe
 * ters kayıt olarak düşer (DOM-FIN-033). Dosyadan aktarılan geçmiş ödeme borcu kapatır ama tahsilat
 * değildir: `opening_import` satırıdır, dekont ve tahsilat yöntemi taşımaz (DOM-FIN-014).
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
}

export function studentStatement(
  studentId: string,
  invoices: readonly StatementInvoice[],
  payments: readonly StatementPayment[],
  today: string,
): StudentStatement {
  const amounts = new Map(invoices.map((invoice) => [invoice.id, invoice.amount]))
  const allocated = new Map<string, number>()
  const lines: DraftLine[] = []
  let unappliedCents = 0

  for (const payment of [...payments].sort((a, b) => a.paidAt.localeCompare(b.paidAt))) {
    const reversed = payment.reversedAt !== null
    let applied = 0
    for (const { invoiceId, amountCents } of payment.allocations) {
      // Ayrılışta silinen taksite dağılan tutar ve taksiti aşan kısım borçtan düşülmez.
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
    lines.push({
      ...shared,
      kind: 'payment',
      date: dayKey(payment.paidAt),
      creditCents: applied,
      unappliedCents: payment.amountCents - applied,
    })
    if (payment.reversedAt !== null)
      lines.push({
        ...shared,
        kind: 'payment_reversal',
        date: dayKey(payment.reversedAt),
        debitCents: applied,
      })
    else unappliedCents += payment.amountCents - applied
  }

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
    default:
      return line.kind satisfies never
  }
}
