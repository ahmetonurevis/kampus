// Tedarikçi carisi formları (DOM-FIN-076; ON-143). Alan kuralları core şemalarındandır; tutar formda
// `1.234,56` metnidir, gövdede kuruş. Boş bırakılabilen alan formda boş metin, gövdede `null`.
import { z } from 'zod'
import type {
  CreateSupplierInvoiceBody,
  CreateSupplierPaymentBody,
  SupplierInvoiceDetail,
} from '@kampus/react-shared/use-finance-supplier-ledger.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import {
  SUPPLIER_AMOUNT_MAX_CENTS,
  SUPPLIER_INSTALLMENTS_MAX,
  SUPPLIER_INVOICE_NOTE_MAX,
  SUPPLIER_INVOICE_STATUS_LABELS,
  SUPPLIER_PAYMENT_DESCRIPTION_MAX,
  SUPPLIER_PAYMENT_METHODS,
  SUPPLIER_PAYMENT_METHOD_LABELS,
  supplierInvoiceSchema,
  type SupplierInvoiceStatus,
} from '@kampus/school-core/lib/finance-supplier-ledger.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

const AMOUNT_MESSAGE = 'Tutarı 1.234,56 biçiminde, sıfırdan büyük girin.'
export const parseLedgerAmount = (text: string, allowZero = false) =>
  parseAmountInput(text, { maxCents: SUPPLIER_AMOUNT_MAX_CENTS, allowZero })
const amountField = (allowZero = false) =>
  z.string().refine((value) => parseLedgerAmount(value, allowZero) !== null, {
    message: allowZero ? 'KDV tutarını 1.234,56 biçiminde girin (yoksa 0).' : AMOUNT_MESSAGE,
  })
const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())
const centsOf = (text: string) => parseLedgerAmount(text, true) ?? 0

export const PAYMENT_METHOD_OPTIONS = SUPPLIER_PAYMENT_METHODS.map((value) => ({
  value,
  label: SUPPLIER_PAYMENT_METHOD_LABELS[value],
}))

// --- Ödeme planı ---------------------------------------------------------------------------------

const installmentRow = z.object({
  dueDate: daySchema,
  amount: amountField(),
})
const installmentRows = z
  .array(installmentRow)
  .min(1, 'En az bir taksit girin.')
  .max(
    SUPPLIER_INSTALLMENTS_MAX,
    `En fazla ${String(SUPPLIER_INSTALLMENTS_MAX)} taksit girilebilir.`,
  )
export type InstallmentRow = z.input<typeof installmentRow>

/** Toplamı formda gösterir; sunucu eşitliği yeniden denetler (422 `supplier_invoice_plan_total_mismatch`). */
export const installmentsTotalCents = (rows: readonly Partial<InstallmentRow>[]) =>
  rows.reduce((total, row) => total + (parseLedgerAmount(row.amount ?? '') ?? 0), 0)

function shiftMonth(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date, last))
  return target.toISOString().slice(0, 10)
}

const amountText = (cents: number) =>
  `${String(Math.floor(cents / 100))},${String(cents % 100).padStart(2, '0')}`

/** Eşit aylık taksit önerisi: kuruş artığı son taksite eklenir; ay sonu kayması ayın son günüdür. */
export function evenInstallments(
  totalCents: number,
  count: number,
  firstDueDate: string,
): InstallmentRow[] {
  if (count < 1 || totalCents < count) return []
  const base = Math.floor(totalCents / count)
  return Array.from({ length: count }, (_, index) => ({
    dueDate: shiftMonth(firstDueDate, index),
    amount: amountText(index === count - 1 ? totalCents - base * (count - 1) : base),
  }))
}

export const planFormSchema = z.object({ installments: installmentRows })
export type PlanFormValues = z.input<typeof planFormSchema>

export const planBody = (values: PlanFormValues) => ({
  installments: values.installments.map((row) => ({
    dueDate: row.dueDate,
    amountCents: parseLedgerAmount(row.amount) ?? 0,
  })),
})

export const planDefaults = (invoice: SupplierInvoiceDetail): PlanFormValues => ({
  installments: invoice.installments.map((item) => ({
    dueDate: item.dueDate,
    amount: amountText(item.amountCents),
  })),
})

// --- Fatura --------------------------------------------------------------------------------------

const invoiceShape = supplierInvoiceSchema.shape

export const invoiceFormSchema = z
  .object({
    supplierId: z.string().min(1, 'Tedarikçiyi seçin.'),
    invoiceNumber: invoiceShape.invoiceNumber,
    invoiceDate: daySchema,
    amount: amountField(),
    amountIncludesVat: z.enum(['true', 'false']),
    vat: amountField(true),
    purchaseOrderId: z.string(),
    note: z
      .string()
      .trim()
      .max(
        SUPPLIER_INVOICE_NOTE_MAX,
        `En fazla ${String(SUPPLIER_INVOICE_NOTE_MAX)} karakter girebilirsiniz.`,
      ),
    planMode: z.enum(['single', 'plan']),
    dueDate: z.string(),
    installments: z.array(installmentRow).max(SUPPLIER_INSTALLMENTS_MAX),
  })
  .superRefine((value, context) => {
    if (value.planMode === 'single' && !daySchema.safeParse(value.dueDate).success)
      context.addIssue({ code: 'custom', path: ['dueDate'], message: 'Vade gününü seçin.' })
    if (value.planMode === 'plan' && value.installments.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['installments', 'root'],
        message: 'En az bir taksit girin.',
      })
    const amount = parseLedgerAmount(value.amount)
    const vat = parseLedgerAmount(value.vat, true)
    if (amount !== null && vat !== null && value.amountIncludesVat === 'true' && vat >= amount)
      context.addIssue({
        code: 'custom',
        path: ['vat'],
        message: 'KDV, KDV dahil tutardan küçük olmalıdır.',
      })
  })
export type InvoiceFormValues = z.input<typeof invoiceFormSchema>

export const invoiceDefaults = (today: string): InvoiceFormValues => ({
  supplierId: '',
  invoiceNumber: '',
  invoiceDate: today,
  amount: '',
  amountIncludesVat: 'true',
  vat: '0',
  purchaseOrderId: '',
  note: '',
  planMode: 'single',
  dueDate: '',
  installments: [],
})

/** KDV dahil toplam: dahilse girilen tutar, değilse tutar + KDV. */
export function invoiceGrossCents(values: {
  amount?: string | undefined
  amountIncludesVat?: string | undefined
  vat?: string | undefined
}): number {
  const amount = parseLedgerAmount(values.amount ?? '') ?? 0
  return values.amountIncludesVat === 'false' ? amount + centsOf(values.vat ?? '') : amount
}

export function invoiceBody(
  values: InvoiceFormValues,
  confirmOverOrder = false,
): CreateSupplierInvoiceBody {
  return {
    supplierId: values.supplierId,
    invoiceNumber: values.invoiceNumber,
    invoiceDate: values.invoiceDate,
    amountCents: parseLedgerAmount(values.amount) ?? 0,
    amountIncludesVat: values.amountIncludesVat === 'true',
    vatCents: centsOf(values.vat),
    purchaseOrderId: blankToNull(values.purchaseOrderId),
    note: blankToNull(values.note),
    ...(values.planMode === 'single'
      ? { dueDate: values.dueDate }
      : { installments: planBody({ installments: values.installments }).installments }),
    ...(confirmOverOrder ? { confirmOverOrder: true } : {}),
  }
}

type InvoiceField =
  keyof InvoiceFormValues | `installments.${number}.${'dueDate' | 'amount'}` | 'root.installments'

/** Sunucu alan yolu (`amountCents`, `installments.0.amountCents`) form alanına çevrilir. */
export function invoiceFormField(name: string): InvoiceField | undefined {
  const row = /^installments\.(\d+)\.(dueDate|amountCents)$/.exec(name)
  if (row)
    return `installments.${Number(row[1])}.${row[2] === 'amountCents' ? 'amount' : 'dueDate'}`
  const map: Record<string, InvoiceField> = {
    supplierId: 'supplierId',
    invoiceNumber: 'invoiceNumber',
    invoiceDate: 'invoiceDate',
    dueDate: 'dueDate',
    amountCents: 'amount',
    vatCents: 'vat',
    purchaseOrderId: 'purchaseOrderId',
    note: 'note',
    installments: 'root.installments',
  }
  return map[name]
}

// --- Ödeme ---------------------------------------------------------------------------------------

export const paymentFormSchema = z
  .object({
    installmentId: z.string().min(1, 'Taksiti seçin.'),
    paidDate: daySchema,
    amount: amountField(),
    method: z.enum(SUPPLIER_PAYMENT_METHODS, 'Ödeme yöntemini seçin.'),
    bankAccountId: z.string(),
    description: z
      .string()
      .trim()
      .max(
        SUPPLIER_PAYMENT_DESCRIPTION_MAX,
        `En fazla ${String(SUPPLIER_PAYMENT_DESCRIPTION_MAX)} karakter girebilirsiniz.`,
      ),
  })
  .superRefine((value, context) => {
    if (value.method !== 'cash' && value.bankAccountId === '')
      context.addIssue({
        code: 'custom',
        path: ['bankAccountId'],
        message: 'Ödemenin çıktığı kurum banka hesabını seçin.',
      })
  })
export type PaymentFormValues = z.input<typeof paymentFormSchema>

export function paymentDefaults(
  installment: { id: string; remainingCents: number },
  today: string,
  bankAccountId: string,
): PaymentFormValues {
  return {
    installmentId: installment.id,
    paidDate: today,
    amount: amountText(installment.remainingCents),
    method: 'transfer',
    bankAccountId,
    description: '',
  }
}

export function paymentBody(values: PaymentFormValues): CreateSupplierPaymentBody {
  return {
    installmentId: values.installmentId,
    paidDate: values.paidDate,
    amountCents: parseLedgerAmount(values.amount) ?? 0,
    method: values.method,
    bankAccountId: values.method === 'cash' ? null : blankToNull(values.bankAccountId),
    description: blankToNull(values.description),
  }
}

export function paymentFormField(name: string): keyof PaymentFormValues | undefined {
  if (name === 'amountCents') return 'amount'
  const fields: readonly (keyof PaymentFormValues)[] = [
    'installmentId',
    'paidDate',
    'method',
    'bankAccountId',
    'description',
  ]
  return fields.find((field) => field === name)
}

/** `YYYY-MM-DD` gününün Türkçe gösterimi; boşsa tire. */
export const dayText = (day: string | null) =>
  day === null ? '—' : dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

// --- Görünüm -------------------------------------------------------------------------------------

export const INVOICE_STATUS_VIEW: Readonly<
  Record<SupplierInvoiceStatus, { label: string; tone: BadgeTone }>
> = {
  open: { label: SUPPLIER_INVOICE_STATUS_LABELS.open, tone: 'gray' },
  partially_paid: { label: SUPPLIER_INVOICE_STATUS_LABELS.partially_paid, tone: 'amber' },
  overdue: { label: SUPPLIER_INVOICE_STATUS_LABELS.overdue, tone: 'red' },
  paid: { label: SUPPLIER_INVOICE_STATUS_LABELS.paid, tone: 'green' },
  cancelled: { label: SUPPLIER_INVOICE_STATUS_LABELS.cancelled, tone: 'gray' },
}

/** Talimat dosyasına girebilen ödeme: etkin havale ya da EFT (K-164). */
export const instructionEligible = (payment: { method: string; cancelledAt: string | null }) =>
  payment.cancelledAt === null && (payment.method === 'transfer' || payment.method === 'eft')
