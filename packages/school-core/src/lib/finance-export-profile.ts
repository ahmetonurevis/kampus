import { z } from 'zod'

import { csvAmount, csvCell } from './csv.ts'
import type { FinanceExportKind, InvoiceLine, PaymentLine, RefundLine } from './finance-export.ts'

/**
 * Muhasebe aktarım profili (ON-024, IST-111): kurum dosyanın sütun adını, sırasını, tarih ve tutar
 * biçimini ve sabit hesap kodlarını kendisi eşler; böylece hangi program bağlanırsa bağlansın
 * programın beklediği dosya çıkar. Satırlar ve tutarlar değişmez, profil yalnız biçimdir.
 */

type CellKind = 'text' | 'date' | 'amount'
type Source<L> = { label: string; kind: CellKind; read: (line: L) => string | number }

const PAYMENT_SOURCES = {
  date: { label: 'Tarih', kind: 'date', read: (line) => line.date },
  type: { label: 'Hareket', kind: 'text', read: (line) => line.type },
  receipt: { label: 'Dekont no', kind: 'text', read: (line) => line.receipt },
  studentName: { label: 'Öğrenci', kind: 'text', read: (line) => line.studentName },
  studentNumber: { label: 'Okul no', kind: 'text', read: (line) => line.studentNumber },
  method: { label: 'Yöntem', kind: 'text', read: (line) => line.method },
  reference: { label: 'İşlem referansı', kind: 'text', read: (line) => line.reference },
  amount: { label: 'Tutar (₺)', kind: 'amount', read: (line) => line.amountCents },
} as const satisfies Record<string, Source<PaymentLine>>

const REFUND_SOURCES = {
  date: { label: 'Ödeme tarihi', kind: 'date', read: (line) => line.date },
  withdrawalDate: { label: 'Ayrılış tarihi', kind: 'date', read: (line) => line.withdrawalDate },
  studentName: { label: 'Öğrenci', kind: 'text', read: (line) => line.studentName },
  studentNumber: { label: 'Okul no', kind: 'text', read: (line) => line.studentNumber },
  accountHolder: { label: 'Hesap sahibi', kind: 'text', read: (line) => line.accountHolder },
  maskedIban: { label: 'IBAN', kind: 'text', read: (line) => line.maskedIban },
  amount: { label: 'Tutar (₺)', kind: 'amount', read: (line) => line.amountCents },
} as const satisfies Record<string, Source<RefundLine>>

const INVOICE_SOURCES = {
  date: { label: 'Vade', kind: 'date', read: (line) => line.date },
  studentName: { label: 'Öğrenci', kind: 'text', read: (line) => line.studentName },
  studentNumber: { label: 'Okul no', kind: 'text', read: (line) => line.studentNumber },
  installment: { label: 'Taksit', kind: 'text', read: (line) => line.installment },
  feeKind: { label: 'Kalem', kind: 'text', read: (line) => line.feeKind },
  status: { label: 'Durum', kind: 'text', read: (line) => line.status },
  amount: { label: 'Tutar (₺)', kind: 'amount', read: (line) => line.amountCents },
  paid: { label: 'Ödenen (₺)', kind: 'amount', read: (line) => line.paidCents },
} as const satisfies Record<string, Source<InvoiceLine>>

export const FIXED_COLUMN_SOURCE = 'fixed'

/** Seçilebilir sütunlar; ekran bu listeyi gösterir, sıra varsayılan dosya sırasıdır. */
export const EXPORT_COLUMN_OPTIONS: Readonly<
  Record<FinanceExportKind, readonly { source: string; label: string }[]>
> = {
  payments: optionsOf(PAYMENT_SOURCES),
  refunds: optionsOf(REFUND_SOURCES),
  invoices: optionsOf(INVOICE_SOURCES),
}

function optionsOf(sources: Record<string, { label: string }>) {
  return Object.entries(sources).map(([source, { label }]) => ({ source, label }))
}

export const EXPORT_SEPARATORS = [';', ',', '\t'] as const
export const EXPORT_DATE_FORMATS = ['iso', 'tr'] as const
export const EXPORT_DECIMALS = [',', '.'] as const

const columnSchema = z.strictObject({
  source: z.string().min(1, 'Sütunu seçin.'),
  header: z
    .string()
    .trim()
    .min(1, 'Sütun başlığını girin.')
    .max(60, 'Sütun başlığı en fazla 60 karakter olabilir.'),
  // Sabit sütun hesap kodu gibi her satırda aynı kalan değerdir.
  value: z.string().trim().max(100, 'Sabit değer en fazla 100 karakter olabilir.').optional(),
})
export type ExportColumn = z.output<typeof columnSchema>

const columnsSchema = (kind: FinanceExportKind) =>
  z
    .array(columnSchema)
    .min(1, 'En az bir sütun seçin.')
    .max(30, 'En fazla 30 sütun eklenebilir.')
    .superRefine((columns, context) => {
      const allowed = new Set(EXPORT_COLUMN_OPTIONS[kind].map((item) => item.source))
      const seen = new Set<string>()
      columns.forEach((column, index) => {
        if (column.source === FIXED_COLUMN_SOURCE) {
          if (!column.value)
            context.addIssue({
              code: 'custom',
              path: [index, 'value'],
              message: 'Sabit değeri girin.',
            })
        } else if (!allowed.has(column.source))
          context.addIssue({
            code: 'custom',
            path: [index, 'source'],
            message: 'Bu sütun dosyada bulunmuyor.',
          })
        const name = column.header.toLocaleLowerCase('tr')
        if (seen.has(name))
          context.addIssue({
            code: 'custom',
            path: [index, 'header'],
            message: 'Aynı başlık iki kez kullanılamaz.',
          })
        seen.add(name)
      })
    })

export const financeExportProfileSchema = z
  .strictObject({
    separator: z.enum(EXPORT_SEPARATORS, 'Ayırıcıyı seçin.'),
    dateFormat: z.enum(EXPORT_DATE_FORMATS, 'Tarih biçimini seçin.'),
    decimal: z.enum(EXPORT_DECIMALS, 'Ondalık işaretini seçin.'),
    columns: z.strictObject({
      payments: columnsSchema('payments'),
      refunds: columnsSchema('refunds'),
      invoices: columnsSchema('invoices'),
    }),
  })
  .refine((profile) => profile.separator !== profile.decimal, {
    path: ['decimal'],
    message: 'Ondalık işareti ayırıcıyla aynı olamaz.',
  })
export type FinanceExportProfile = z.output<typeof financeExportProfileSchema>

/** Gövde: `null` kurumu standart dosyaya döndürür. */
export const setFinanceExportProfileSchema = z.strictObject({
  profile: financeExportProfileSchema.nullable(),
})
export type SetFinanceExportProfileInput = z.input<typeof setFinanceExportProfileSchema>

/** Standart dosyanın profil karşılığı: düzenleme buradan başlar, çıktısı standart dosyayla aynıdır. */
export function defaultFinanceExportProfile(): FinanceExportProfile {
  const columnsOf = (kind: FinanceExportKind) =>
    EXPORT_COLUMN_OPTIONS[kind].map(({ source, label }) => ({ source, header: label }))
  return {
    separator: ';',
    dateFormat: 'iso',
    decimal: ',',
    columns: {
      payments: columnsOf('payments'),
      refunds: columnsOf('refunds'),
      invoices: columnsOf('invoices'),
    },
  }
}

function dateCell(value: string | number, format: FinanceExportProfile['dateFormat']): string {
  const text = String(value)
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  return csvCell(format === 'tr' && parts ? `${parts[3]}.${parts[2]}.${parts[1]}` : text)
}

function renderCsv<L>(
  sources: Record<string, Source<L>>,
  columns: readonly ExportColumn[],
  lines: readonly L[],
  profile: FinanceExportProfile,
): string {
  const cell = (column: ExportColumn, line: L): string => {
    const source = sources[column.source]
    if (!source) return csvCell(column.value ?? '')
    const value = source.read(line)
    if (source.kind === 'date') return dateCell(value, profile.dateFormat)
    if (source.kind === 'amount') return csvAmount(Number(value)).replace(',', profile.decimal)
    return csvCell(value)
  }
  return [
    columns.map((column) => csvCell(column.header)),
    ...lines.map((line) => columns.map((column) => cell(column, line))),
  ]
    .map((row) => row.join(profile.separator))
    .join('\r\n')
}

export function profiledPaymentsCsv(
  lines: readonly PaymentLine[],
  profile: FinanceExportProfile,
): string {
  return renderCsv<PaymentLine>(PAYMENT_SOURCES, profile.columns.payments, lines, profile)
}

export function profiledRefundsCsv(
  lines: readonly RefundLine[],
  profile: FinanceExportProfile,
): string {
  return renderCsv<RefundLine>(REFUND_SOURCES, profile.columns.refunds, lines, profile)
}

export function profiledInvoicesCsv(
  lines: readonly InvoiceLine[],
  profile: FinanceExportProfile,
): string {
  return renderCsv<InvoiceLine>(INVOICE_SOURCES, profile.columns.invoices, lines, profile)
}
