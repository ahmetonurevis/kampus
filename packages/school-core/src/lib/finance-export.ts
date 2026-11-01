import { z } from 'zod'

import type { State } from '../data/seed.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'

/**
 * Muhasebe dışa aktarımı (IST-111; docs/domain/finans.md DOM-FIN-030, -033, -041). Kampüs fatura
 * düzenlemez; tahsilat, iade ve taksit satırları dönem bazında aktarılır. Toplam ile dosya aynı
 * satırlardan üretilir: aktarım toplamı dönem toplamına eşittir. Gün, Europe/Istanbul günüdür.
 */

export const FINANCE_EXPORT_KINDS = ['payments', 'refunds', 'invoices'] as const
export type FinanceExportKind = (typeof FINANCE_EXPORT_KINDS)[number]

/** Tek dosyanın en geniş dönemi; dönem bazlı aktarımın bir yılı aşması gerekmez. */
export const FINANCE_EXPORT_MAX_DAYS = 366

export const financePeriodSchema = z.strictObject({ from: daySchema, to: daySchema })
export type FinancePeriod = z.output<typeof financePeriodSchema>

export const financeExportQuerySchema = z.strictObject({
  from: daySchema,
  to: daySchema,
  kind: z.enum(FINANCE_EXPORT_KINDS, 'Aktarım türünü seçin.'),
})

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
      receipt: `${String(payment.receiptYear)}-${String(payment.receiptNumber)}`,
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

const FEE_KIND_LABELS: Readonly<Record<string, string>> = {
  tuition: 'Öğrenim ücreti',
  breakfast: 'Kahvaltı',
  meal: 'Yemek',
  transport: 'Servis',
  dormitory: 'Pansiyon',
  stationery: 'Kitap ve kırtasiye',
  uniform: 'Kıyafet',
  tutoring: 'Etüt',
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
}

/** Taksitler vade gününe göre aktarılır; ödenen tutar dağılımlardan hesaplanır (DOM-FIN-030). */
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
          feeKind: FEE_KIND_LABELS[invoice.feeKind ?? 'tuition'] ?? '',
          status: invoice.paidAt ? 'Ödendi' : paidCents > 0 ? 'Kısmi' : 'Açık',
          amountCents: invoice.amount,
          paidCents,
        },
      ]
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.installment - b.installment)
}

export interface FinanceSummary {
  payments: { count: number; totalCents: number }
  refunds: { count: number; totalCents: number }
  invoices: { count: number; totalCents: number; paidCents: number }
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
    ['Vade', 'Öğrenci', 'Okul no', 'Taksit', 'Kalem', 'Durum', 'Tutar (₺)', 'Ödenen (₺)'],
    lines.map((line) => [
      csvCell(line.date),
      csvCell(line.studentName),
      csvCell(line.studentNumber),
      csvCell(line.installment),
      csvCell(line.feeKind),
      csvCell(line.status),
      csvAmount(line.amountCents),
      csvAmount(line.paidCents),
    ]),
  )
}
