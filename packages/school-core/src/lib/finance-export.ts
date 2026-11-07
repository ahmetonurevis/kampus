import { z } from 'zod'

import type { State } from '../data/seed.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { FEE_ITEM_KIND_LABELS } from './fee-tariffs.ts'
import { receiptNumberLabel } from './finance-receipt.ts'
import { dayKey } from './format.ts'
import { isOpeningImport, OPENING_IMPORT_METHOD } from './payments.ts'

/**
 * Muhasebe dışa aktarımı (IST-111; docs/domain/finans.md DOM-FIN-030, -033, -041). Kampüs fatura
 * düzenlemez; tahsilat, iade ve taksit satırları dönem bazında aktarılır. Toplam ile dosya aynı
 * satırlardan üretilir: aktarım toplamı dönem toplamına eşittir. Gün, Europe/Istanbul günüdür.
 */

export const FINANCE_EXPORT_KINDS = ['payments', 'refunds', 'invoices'] as const
export type FinanceExportKind = (typeof FINANCE_EXPORT_KINDS)[number]

/** Aynı satırların iki biçimi (ON-094): CSV varsayılan kalır, mevcut istemci değişmez. */
export const FINANCE_EXPORT_FORMATS = ['csv', 'xlsx'] as const
export type FinanceExportFormat = (typeof FINANCE_EXPORT_FORMATS)[number]

/** Tek dosyanın en geniş dönemi; dönem bazlı aktarımın bir yılı aşması gerekmez. */
export const FINANCE_EXPORT_MAX_DAYS = 366

export const financePeriodSchema = z.strictObject({ from: daySchema, to: daySchema })
export type FinancePeriod = z.output<typeof financePeriodSchema>

export const financeExportQuerySchema = z.strictObject({
  from: daySchema,
  to: daySchema,
  kind: z.enum(FINANCE_EXPORT_KINDS, 'Aktarım türünü seçin.'),
  format: z.enum(FINANCE_EXPORT_FORMATS, 'Dosya biçimini seçin.').default('csv'),
})

/** Finans özeti sorgusu: dönem verilmezse son altı takvim ayıdır; yalnız bir uç verilemez. */
export const financeOverviewQuerySchema = z
  .strictObject({ from: daySchema.optional(), to: daySchema.optional() })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: 'Dönemin başlangıcını ve bitişini birlikte seçin.',
    path: ['from'],
  })
export type FinanceOverviewQuery = z.output<typeof financeOverviewQuerySchema>

export function assertFinancePeriod({ from, to }: FinancePeriod): void {
  if (from > to)
    throw new DomainError('export_period_invalid', 'Dönem başlangıcı bitişinden sonra olamaz.', {
      path: ['from'],
    })
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  if (days >= FINANCE_EXPORT_MAX_DAYS)
    throw new DomainError('export_period_too_long', 'Dönem en çok bir yıl olabilir.', {
      path: ['to'],
    })
}

export interface ExportPayment {
  studentId: string
  amountCents: number
  method: string
  reference: string | null
  paidAt: string
  receiptYear: number
  receiptNumber: number
  reversedAt: string | null
}

export interface ExportRefund {
  studentId: string
  withdrawalDate: string
  refundCents: number
  refundPaidDate: string | null
  maskedIban: string | null
  accountHolder: string | null
}

type Student = { id: string; name: string; number?: unknown }
export type StudentDirectory = ReadonlyMap<string, Student>

export function studentDirectory(students: readonly Student[]): StudentDirectory {
  return new Map(students.map((student) => [student.id, student]))
}

const inPeriod = (day: string, { from, to }: FinancePeriod) => day >= from && day <= to
const studentCells = (students: StudentDirectory, id: string) => {
  const student = students.get(id)
  return {
    studentName: student?.name ?? '',
    studentNumber: student?.number === undefined ? '' : String(student.number),
  }
}

export interface PaymentLine {
  date: string
  type: 'Tahsilat' | 'Tahsilat iptali'
  receipt: string
  studentName: string
  studentNumber: string
  method: string
  reference: string
  amountCents: number
}

/**
 * Tahsilat ödeme gününde artı, iptal gününde eksi satırdır. Böylece önceki dönemde aktarılmış
 * tahsilatın iptali sonraki dönemin toplamını düzeltir (DOM-FIN-033).
 */
export function paymentLines(
  payments: readonly ExportPayment[],
  students: StudentDirectory,
  period: FinancePeriod,
): PaymentLine[] {
  const lines: PaymentLine[] = []
  for (const payment of payments) {
    const shared = {
      receipt: receiptNumberLabel(payment),
      ...studentCells(students, payment.studentId),
      method: payment.method,
      reference: payment.reference ?? '',
    }
    const paidDay = dayKey(payment.paidAt)
    if (inPeriod(paidDay, period))
      lines.push({
        date: paidDay,
        type: 'Tahsilat',
        ...shared,
        amountCents: payment.amountCents,
      })
    if (payment.reversedAt !== null && inPeriod(dayKey(payment.reversedAt), period))
      lines.push({
        date: dayKey(payment.reversedAt),
        type: 'Tahsilat iptali',
        ...shared,
        amountCents: -payment.amountCents,
      })
  }
  return lines.sort((a, b) => a.date.localeCompare(b.date) || a.receipt.localeCompare(b.receipt))
}

export interface RefundLine {
  date: string
  withdrawalDate: string
  studentName: string
  studentNumber: string
  accountHolder: string
  maskedIban: string
  amountCents: number
}

/** Yalnız ödenmiş iade muhasebeye geçer (DOM-FIN-041). */
export function refundLines(
  refunds: readonly ExportRefund[],
  students: StudentDirectory,
  period: FinancePeriod,
): RefundLine[] {
  return refunds
    .flatMap((refund): RefundLine[] =>
      refund.refundPaidDate !== null && inPeriod(refund.refundPaidDate, period)
        ? [
            {
              date: refund.refundPaidDate,
              withdrawalDate: refund.withdrawalDate,
              ...studentCells(students, refund.studentId),
              accountHolder: refund.accountHolder ?? '',
              maskedIban: refund.maskedIban ?? '',
              amountCents: refund.refundCents,
            },
          ]
        : [],
    )
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface InvoiceLine {
  date: string
  studentName: string
  studentNumber: string
  installment: number
  feeKind: string
  status: 'Ödendi' | 'Kısmi' | 'Açık'
  amountCents: number
  paidCents: number
  /** Dosyadan aktarılan geçmiş ödeme etiketi; öteki satırlarda boş (DOM-FIN-014). */
  note: typeof OPENING_IMPORT_METHOD | ''
}

/**
 * Taksitler vade gününe göre aktarılır; ödenen tutar dağılımlardan hesaplanır (DOM-FIN-030). Dosyadan
 * aktarılan geçmiş ödeme "Ödendi" yazar ve etiketini taşır; tahsilat dosyasına hiç girmez.
 */
export function invoiceLines(
  invoices: State['invoices'],
  allocated: ReadonlyMap<string, number>,
  students: StudentDirectory,
  period: FinancePeriod,
): InvoiceLine[] {
  return invoices
    .flatMap((invoice): InvoiceLine[] => {
      const date = dayKey(invoice.dueDate)
      if (!inPeriod(date, period)) return []
      const paidCents = invoice.paidAt ? invoice.amount : (allocated.get(invoice.id) ?? 0)
      return [
        {
          date,
          ...studentCells(students, invoice.studentId),
          installment: invoice.installment,
          feeKind:
            (FEE_ITEM_KIND_LABELS as Readonly<Record<string, string>>)[
              invoice.feeKind ?? 'tuition'
            ] ?? '',
          status: invoice.paidAt ? 'Ödendi' : paidCents > 0 ? 'Kısmi' : 'Açık',
          amountCents: invoice.amount,
          paidCents,
          note: isOpeningImport(invoice) ? OPENING_IMPORT_METHOD : '',
        },
      ]
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.installment - b.installment)
}

export interface FinanceSummary {
  payments: { count: number; totalCents: number }
  refunds: { count: number; totalCents: number }
  invoices: {
    count: number
    totalCents: number
    paidCents: number
    /** `paidCents`'in dosyadan aktarılan, tahsilat olmayan kısmı (DOM-FIN-014). */
    openingImportCents: number
  }
}

const sum = (lines: readonly { amountCents: number }[]) =>
  lines.reduce((total, line) => total + line.amountCents, 0)

export function financeSummary(
  payments: readonly PaymentLine[],
  refunds: readonly RefundLine[],
  invoices: readonly InvoiceLine[],
): FinanceSummary {
  return {
    payments: { count: payments.length, totalCents: sum(payments) },
    refunds: { count: refunds.length, totalCents: sum(refunds) },
    invoices: {
      count: invoices.length,
      totalCents: sum(invoices),
      paidCents: invoices.reduce((total, line) => total + line.paidCents, 0),
      openingImportCents: invoices.reduce(
        (total, line) => total + (line.note === '' ? 0 : line.paidCents),
        0,
      ),
    },
  }
}

function csv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header.map(csvCell), ...rows].map((row) => row.join(CSV_SEPARATOR)).join('\r\n')
}

export function paymentsCsv(lines: readonly PaymentLine[]): string {
  return csv(
    [
      'Tarih',
      'Hareket',
      'Dekont no',
      'Öğrenci',
      'Okul no',
      'Yöntem',
      'İşlem referansı',
      'Tutar (₺)',
    ],
    lines.map((line) => [
      csvCell(line.date),
      csvCell(line.type),
      csvCell(line.receipt),
      csvCell(line.studentName),
      csvCell(line.studentNumber),
      csvCell(line.method),
      csvCell(line.reference),
      csvAmount(line.amountCents),
    ]),
  )
}

export function refundsCsv(lines: readonly RefundLine[]): string {
  return csv(
    ['Ödeme tarihi', 'Ayrılış tarihi', 'Öğrenci', 'Okul no', 'Hesap sahibi', 'IBAN', 'Tutar (₺)'],
    lines.map((line) => [
      csvCell(line.date),
      csvCell(line.withdrawalDate),
      csvCell(line.studentName),
      csvCell(line.studentNumber),
      csvCell(line.accountHolder),
      csvCell(line.maskedIban),
      csvAmount(line.amountCents),
    ]),
  )
}

export function invoicesCsv(lines: readonly InvoiceLine[]): string {
  return csv(
    [
      'Vade',
      'Öğrenci',
      'Okul no',
      'Taksit',
      'Kalem',
      'Durum',
      'Tutar (₺)',
      'Ödenen (₺)',
      'Açıklama',
    ],
    lines.map((line) => [
      csvCell(line.date),
      csvCell(line.studentName),
      csvCell(line.studentNumber),
      csvCell(line.installment),
      csvCell(line.feeKind),
      csvCell(line.status),
      csvAmount(line.amountCents),
      csvAmount(line.paidCents),
      csvCell(line.note),
    ]),
  )
}

export interface FinanceTotals {
  totalCents: number
  /** Tam ödenen taksitler ve açık taksitlere dağıtılmış kısmi ödemeler (DOM-FIN-030). */
  paidCents: number
  /** `paidCents`'in dosyadan aktarılan, tahsilat olmayan kısmı (DOM-FIN-014). */
  openingImportCents: number
  remainingCents: number
  overdueCents: number
}

type TotalsInvoice = Pick<State['invoices'][number], 'id' | 'amount' | 'paidAt' | 'dueDate'> & {
  method?: string | null
}

/** Finans ekranı kartları: kurum geneli; gecikmiş tutar kalan kısımdır, taksitin tamamı değil. */
export function financeTotals(
  invoices: readonly TotalsInvoice[],
  allocated: ReadonlyMap<string, number>,
  today: string,
): FinanceTotals {
  let totalCents = 0
  let paidCents = 0
  let openingImportCents = 0
  let overdueCents = 0
  for (const invoice of invoices) {
    const paid = invoice.paidAt
      ? invoice.amount
      : Math.min(allocated.get(invoice.id) ?? 0, invoice.amount)
    totalCents += invoice.amount
    paidCents += paid
    if (isOpeningImport(invoice)) openingImportCents += paid
    if (dayKey(invoice.dueDate) < today) overdueCents += invoice.amount - paid
  }
  return {
    totalCents,
    paidCents,
    openingImportCents,
    remainingCents: totalCents - paidCents,
    overdueCents,
  }
}

/** Varsayılan özet dönemi: içinde bulunulan ay dahil son altı takvim ayı, bugüne kadar. */
export const FINANCE_OVERVIEW_DEFAULT_MONTHS = 6

export function defaultOverviewPeriod(today: string): FinancePeriod {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const start = new Date(Date.UTC(year, month - FINANCE_OVERVIEW_DEFAULT_MONTHS, 1))
  return { from: start.toISOString().slice(0, 10), to: today }
}

export interface FinanceOverviewMonth {
  /** Europe/Istanbul takvim ayı (`YYYY-MM`). */
  month: string
  /** Bu ayda alınan tahsilat; iptal, iptal edildiği ayda düşer (DOM-FIN-033). */
  collectedCents: number
  /** Vadesi bu ayda olan taksitlerin toplamı. */
  dueCents: number
  /** Vadesi bu ayda olan taksitlerin bugün kalan kısmı. */
  openCents: number
  /** Vadesi bu ayda olup bugün gecikmiş kalan kısım. */
  overdueCents: number
}

export interface OverdueStudent {
  // kvkk: K — öğrenci kaydı
  studentId: string
  overdueCents: number
  /** Ödenmemiş en eski gecikmiş vade günü. */
  oldestDueDate: string
}

export interface FinanceOverview {
  from: string
  to: string
  /** Hesabın yapıldığı Europe/Istanbul günü. */
  today: string
  /** Dönemde alınan net tahsilat. */
  collectedCents: number
  /** Kurum geneli bugün açık tutar (dönemden bağımsız; `/finance/totals` ile aynı). */
  openCents: number
  /** Kurum geneli bugün gecikmiş tutar (dönemden bağımsız; `/finance/totals` ile aynı). */
  overdueCents: number
  /** Dönemin bütün ayları, eskiden yeniye; hareketsiz ay sıfırla döner. */
  months: FinanceOverviewMonth[]
  /** Gecikmiş borcu olan öğrenciler, tutar büyükten küçüğe (erken uyarı, IST-121). */
  overdueStudents: OverdueStudent[]
}

function monthsOf({ from, to }: FinancePeriod): string[] {
  const months: string[] = []
  const last = to.slice(0, 7)
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  for (;;) {
    const key = `${String(year)}-${String(month).padStart(2, '0')}`
    months.push(key)
    if (key >= last) return months
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
}

/**
 * Finans özeti (IST-116, IST-121): tahsil edilen, açık ve gecikmiş tutar ile ay kırılımı. Tahsilat
 * `paymentLines`, açık ve gecikmiş tutar `financeTotals` kuralıyla hesaplanır; pano rakamı listelerin
 * toplamıyla aynı kalır. Kısmi ödemede yalnız kalan kısım açık ya da gecikmiş sayılır.
 */
export function financeOverview(input: {
  invoices: readonly Pick<
    State['invoices'][number],
    'id' | 'studentId' | 'amount' | 'paidAt' | 'dueDate'
  >[]
  allocated: ReadonlyMap<string, number>
  payments: readonly ExportPayment[]
  period: FinancePeriod
  today: string
}): FinanceOverview {
  const { invoices, allocated, payments, period, today } = input
  const totals = financeTotals(invoices, allocated, today)
  const months = new Map<string, FinanceOverviewMonth>(
    monthsOf(period).map((month) => [
      month,
      { month, collectedCents: 0, dueCents: 0, openCents: 0, overdueCents: 0 },
    ]),
  )
  const students = new Map<string, OverdueStudent>()
  for (const invoice of invoices) {
    const day = dayKey(invoice.dueDate)
    const paid = invoice.paidAt
      ? invoice.amount
      : Math.min(allocated.get(invoice.id) ?? 0, invoice.amount)
    const open = invoice.amount - paid
    const overdue = day < today ? open : 0
    if (inPeriod(day, period)) {
      const entry = months.get(day.slice(0, 7))
      if (entry) {
        entry.dueCents += invoice.amount
        entry.openCents += open
        entry.overdueCents += overdue
      }
    }
    if (overdue > 0) {
      const student = students.get(invoice.studentId)
      if (student) {
        student.overdueCents += overdue
        if (day < student.oldestDueDate) student.oldestDueDate = day
      } else
        students.set(invoice.studentId, {
          studentId: invoice.studentId,
          overdueCents: overdue,
          oldestDueDate: day,
        })
    }
  }
  let collectedCents = 0
  for (const line of paymentLines(payments, new Map(), period)) {
    collectedCents += line.amountCents
    const entry = months.get(line.date.slice(0, 7))
    if (entry) entry.collectedCents += line.amountCents
  }
  return {
    from: period.from,
    to: period.to,
    today,
    collectedCents,
    openCents: totals.remainingCents,
    overdueCents: totals.overdueCents,
    months: [...months.values()],
    overdueStudents: [...students.values()].sort(
      (a, b) => b.overdueCents - a.overdueCents || a.studentId.localeCompare(b.studentId),
    ),
  }
}

export interface StudentBalance {
  // kvkk: K — öğrenci kaydı
  studentId: string
  totalCents: number
  paidCents: number
  /** `paidCents`'in dosyadan aktarılan, tahsilat olmayan kısmı (DOM-FIN-014). */
  openingImportCents: number
  /** Bugün kalan borç; kısmi ödemede yalnız kalan kısım (`financeTotals` ile aynı kural). */
  openCents: number
  overdueCents: number
  /** Vadesi geçmiş ve kalanı olan taksit sayısı. */
  overdueCount: number
  /** Bugün ya da sonrasına düşen en yakın açık taksit; yoksa `null`. */
  nextDue: { date: string; amountCents: number } | null
}

/**
 * Tek öğrencinin bakiyesi (veli kartları, mobil veli ana ekranı). Tutarlar `financeTotals`
 * kuralıyla hesaplanır: kurum toplamı öğrenci bakiyelerinin toplamıyla aynı kalır. Kapsam
 * burada denetlenmez; servis öğrencinin okuyanın kapsamında olduğunu doğrular.
 */
export function studentBalance(
  studentId: string,
  invoices: readonly TotalsInvoice[],
  allocated: ReadonlyMap<string, number>,
  today: string,
): StudentBalance {
  const totals = financeTotals(invoices, allocated, today)
  let overdueCount = 0
  let nextDue: StudentBalance['nextDue'] = null
  for (const invoice of invoices) {
    const paid = invoice.paidAt
      ? invoice.amount
      : Math.min(allocated.get(invoice.id) ?? 0, invoice.amount)
    const open = invoice.amount - paid
    if (open <= 0) continue
    const day = dayKey(invoice.dueDate)
    if (day < today) overdueCount += 1
    else if (nextDue === null || day < nextDue.date) nextDue = { date: day, amountCents: open }
  }
  return {
    studentId,
    totalCents: totals.totalCents,
    paidCents: totals.paidCents,
    openingImportCents: totals.openingImportCents,
    openCents: totals.remainingCents,
    overdueCents: totals.overdueCents,
    overdueCount,
    nextDue,
  }
}
