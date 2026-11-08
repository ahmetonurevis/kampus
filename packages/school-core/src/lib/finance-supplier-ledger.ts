import { z } from 'zod'

import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { assertPaymentDayOpen, assertReversalDayOpen } from './finance-day-closings.ts'
import { dayKey, money } from './format.ts'
import type { PurchaseOrderStatus } from './finance-purchase-orders.ts'

/**
 * Tedarikçi carisi ve ödeme planı (docs/domain/finans.md DOM-FIN-076; ON-143, K2). Kurum tedarikçi
 * faturasını (`DOM-FIN-070` tedarikçisine, isteğe bağlı `DOM-FIN-073` siparişine bağlı) kaydeder,
 * faturanın ödeme planını (taksitler, toplamı fatura tutarı) tutar ve ödemeleri taksite yazar.
 * Cari; fatura, ödeme, bakiye ve vadesi geçmiş tutardır. Seçilen havale ve EFT ödemeleri için bankaya
 * genel CSV talimat dosyası üretilir. Kampüs muhasebe defteri tutmaz (IST-142): cari yönetim
 * takibidir, resmi kayıt muhasebe programındadır. Fonksiyonlar saftır; tutarlar kuruştur.
 */

/** Tedarikçi carisini yöneten rol (K-160); muhasebe rolü (OG-110) açılınca listeye girer. */
export const SUPPLIER_LEDGER_ROLES = ['yonetici'] as const

export const SUPPLIER_PAYMENT_METHODS = ['transfer', 'eft', 'cash', 'cheque'] as const
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number]
export const SUPPLIER_PAYMENT_METHOD_LABELS = {
  transfer: 'Havale',
  eft: 'EFT',
  cash: 'Nakit',
  cheque: 'Çek',
} as const satisfies Record<SupplierPaymentMethod, string>
/** Talimat dosyasına giren yöntemler: bankanın alıcı IBAN'ına yaptığı ödemeler (K-164). */
export const INSTRUCTION_PAYMENT_METHODS = [
  'transfer',
  'eft',
] as const satisfies readonly SupplierPaymentMethod[]

export const SUPPLIER_INVOICE_STATUSES = [
  'open',
  'partially_paid',
  'overdue',
  'paid',
  'cancelled',
] as const
export type SupplierInvoiceStatus = (typeof SUPPLIER_INVOICE_STATUSES)[number]
export const SUPPLIER_INVOICE_STATUS_LABELS = {
  open: 'Ödenmedi',
  partially_paid: 'Kısmen ödendi',
  overdue: 'Vadesi geçti',
  paid: 'Ödendi',
  cancelled: 'İptal edildi',
} as const satisfies Record<SupplierInvoiceStatus, string>

export const SUPPLIER_INVOICE_NUMBER_MAX = 50
/** Tek fatura ya da ödeme en çok 1 milyar TL (kuruş). */
export const SUPPLIER_AMOUNT_MAX_CENTS = 100_000_000_000
export const SUPPLIER_INSTALLMENTS_MAX = 24
export const SUPPLIER_INVOICE_NOTE_MAX = 500
export const SUPPLIER_REASON_MIN = 5
export const SUPPLIER_REASON_MAX = 500
/** Banka açıklama alanı kısa tutulur (K-164). */
export const SUPPLIER_PAYMENT_DESCRIPTION_MAX = 140
export const INSTRUCTION_PAYMENTS_MAX = 200

/** Fatura numarası boşluksuz ve büyük harfle saklanır; tekillik bu biçim üzerindendir (K-161). */
export const normalizeInvoiceNumber = (value: string) => value.replace(/\s+/g, '').toUpperCase()

// --- Şemalar -------------------------------------------------------------------------------------

const centsSchema = (message: string) =>
  z
    .number(message)
    .int('Tutarı kuruş cinsinden tam sayı girin.')
    .min(1, 'Tutar sıfırdan büyük olmalıdır.')
    .max(SUPPLIER_AMOUNT_MAX_CENTS, 'Tutar en çok 1.000.000.000,00 ₺ olabilir.')

const reasonSchema = (message: string) =>
  z
    .string(message)
    .trim()
    .min(SUPPLIER_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(SUPPLIER_REASON_MAX, `En fazla ${String(SUPPLIER_REASON_MAX)} karakter girebilirsiniz.`)

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value))

export const supplierInstallmentInputSchema = z.strictObject({
  dueDate: daySchema.describe('Taksitin vade günü `YYYY-MM-DD`'),
  amountCents: centsSchema('Taksit tutarını girin.'),
})
export type SupplierInstallmentInput = z.output<typeof supplierInstallmentInputSchema>

const installmentsSchema = z
  .array(supplierInstallmentInputSchema, 'Ödeme planını girin.')
  .min(1, 'En az bir taksit girin.')
  .max(
    SUPPLIER_INSTALLMENTS_MAX,
    `En fazla ${String(SUPPLIER_INSTALLMENTS_MAX)} taksit girilebilir.`,
  )

const invoiceNumberSchema = z
  .string('Fatura numarasını yazın.')
  .transform(normalizeInvoiceNumber)
  .pipe(
    z
      .string()
      .min(1, 'Fatura numarasını yazın.')
      .max(
        SUPPLIER_INVOICE_NUMBER_MAX,
        `En fazla ${String(SUPPLIER_INVOICE_NUMBER_MAX)} karakter girebilirsiniz.`,
      )
      .regex(
        /^[A-Z0-9][A-Z0-9./-]*$/,
        'Fatura numarası harf, rakam, nokta, tire ve eğik çizgiden oluşur.',
      ),
  )

/**
 * Yeni tedarikçi faturası (DOM-FIN-076). Tutar KDV dahil ya da hariç girilir, KDV ayrıca yazılır;
 * net, KDV ve KDV dahil toplam saklanır. Vade tek gün (`dueDate`, tek taksit) ya da ödeme planıdır
 * (`installments`); ikisinden biri verilir. `confirmOverOrder` sipariş tutarını aşan faturanın açık
 * onayıdır (K-162).
 */
export const supplierInvoiceSchema = z
  .strictObject({
    supplierId: z.uuid('Tedarikçiyi seçin.'),
    invoiceNumber: invoiceNumberSchema,
    invoiceDate: daySchema.describe('Fatura tarihi `YYYY-MM-DD`'),
    dueDate: daySchema.optional().describe('Tek vadeli faturanın vade günü'),
    installments: installmentsSchema.optional().describe('Ödeme planı; toplamı fatura tutarıdır'),
    amountCents: centsSchema('Fatura tutarını girin.'),
    amountIncludesVat: z.boolean('Tutarın KDV dahil olup olmadığını seçin.'),
    vatCents: z
      .number('KDV tutarını girin.')
      .int('KDV tutarını kuruş cinsinden tam sayı girin.')
      .min(0, 'KDV eksi olamaz.')
      .max(SUPPLIER_AMOUNT_MAX_CENTS, 'KDV en çok 1.000.000.000,00 ₺ olabilir.'),
    purchaseOrderId: z.uuid('Sipariş geçersiz.').nullable().default(null),
    note: optionalText(SUPPLIER_INVOICE_NOTE_MAX),
    confirmOverOrder: z.boolean('Sipariş aşımı onayı geçersiz.').optional(),
  })
  .superRefine((value, context) => {
    if ((value.dueDate === undefined) === (value.installments === undefined))
      context.addIssue({
        code: 'custom',
        path: ['dueDate'],
        message: 'Vade gününü ya da ödeme planını girin (ikisinden biri).',
      })
    if (value.amountIncludesVat && value.vatCents >= value.amountCents)
      context.addIssue({
        code: 'custom',
        path: ['vatCents'],
        message: 'KDV, KDV dahil tutardan küçük olmalıdır.',
      })
    if (!value.amountIncludesVat && value.amountCents + value.vatCents > SUPPLIER_AMOUNT_MAX_CENTS)
      context.addIssue({
        code: 'custom',
        path: ['amountCents'],
        message: 'KDV dahil toplam en çok 1.000.000.000,00 ₺ olabilir.',
      })
  })
export type SupplierInvoiceInput = z.input<typeof supplierInvoiceSchema>
export type SupplierInvoiceFields = z.output<typeof supplierInvoiceSchema>

/** Ödeme planının yeniden yazılması; taksitlerin toplamı faturanın KDV dahil tutarıdır. */
export const supplierInvoicePlanSchema = z.strictObject({ installments: installmentsSchema })
export type SupplierInvoicePlanInput = z.input<typeof supplierInvoicePlanSchema>

export const cancelSupplierInvoiceSchema = z.strictObject({
  reason: reasonSchema('İptal gerekçesini yazın.'),
})
export type CancelSupplierInvoiceInput = z.input<typeof cancelSupplierInvoiceSchema>

/**
 * Tedarikçi ödemesi (DOM-FIN-076): taksite yazılır, kısmi olabilir. Nakit dışı ödeme kurumun
 * bildirilmiş banka hesabından (`DOM-FIN-032`) çıkar; nakitte hesap seçilmez.
 */
export const supplierPaymentSchema = z
  .strictObject({
    installmentId: z.uuid('Taksiti seçin.'),
    paidDate: daySchema.describe('Ödeme günü `YYYY-MM-DD` (Europe/Istanbul)'),
    amountCents: centsSchema('Ödeme tutarını girin.'),
    method: z.enum(SUPPLIER_PAYMENT_METHODS, 'Ödeme yöntemini seçin.'),
    bankAccountId: z.uuid('Banka hesabı geçersiz.').nullable().default(null),
    description: optionalText(SUPPLIER_PAYMENT_DESCRIPTION_MAX).describe(
      'Banka açıklaması; boşsa `Fatura <no> ödemesi`',
    ),
  })
  .superRefine((value, context) => {
    if (value.method === 'cash' && value.bankAccountId !== null)
      context.addIssue({
        code: 'custom',
        path: ['bankAccountId'],
        message: 'Nakit ödemede banka hesabı seçilmez.',
      })
    if (value.method !== 'cash' && value.bankAccountId === null)
      context.addIssue({
        code: 'custom',
        path: ['bankAccountId'],
        message: 'Ödemenin çıktığı kurum banka hesabını seçin.',
      })
  })
export type SupplierPaymentInput = z.input<typeof supplierPaymentSchema>
export type SupplierPaymentFields = z.output<typeof supplierPaymentSchema>

export const cancelSupplierPaymentSchema = z.strictObject({
  reason: reasonSchema('İptal gerekçesini yazın.'),
})
export type CancelSupplierPaymentInput = z.input<typeof cancelSupplierPaymentSchema>

/** Talimat dosyası: seçilen havale ve EFT ödemeleri; dosyası alınmış ödeme açık onay ister (K-165). */
export const paymentInstructionSchema = z.strictObject({
  paymentIds: z
    .array(z.uuid('Ödeme geçersiz.'), 'Ödeme seçin.')
    .min(1, 'En az bir ödeme seçin.')
    .max(
      INSTRUCTION_PAYMENTS_MAX,
      `Bir dosyaya en fazla ${String(INSTRUCTION_PAYMENTS_MAX)} ödeme girer.`,
    )
    .transform((ids) => [...new Set(ids)]),
  confirmReexport: z.boolean('Yeniden dosya onayı geçersiz.').optional(),
})
export type PaymentInstructionInput = z.input<typeof paymentInstructionSchema>

// --- Hesap ---------------------------------------------------------------------------------------

export interface InvoiceAmounts {
  netCents: number
  vatCents: number
  grossCents: number
}

/** Girilen tutardan net, KDV ve KDV dahil toplam: dahilse net = tutar − KDV, değilse brüt = tutar + KDV. */
export function supplierInvoiceAmounts(
  input: Pick<SupplierInvoiceFields, 'amountCents' | 'amountIncludesVat' | 'vatCents'>,
): InvoiceAmounts {
  return input.amountIncludesVat
    ? {
        netCents: input.amountCents - input.vatCents,
        vatCents: input.vatCents,
        grossCents: input.amountCents,
      }
    : {
        netCents: input.amountCents,
        vatCents: input.vatCents,
        grossCents: input.amountCents + input.vatCents,
      }
}

export interface InstallmentFigures {
  dueDate: string
  amountCents: number
  /** Taksite yazılmış etkin (iptal edilmemiş) ödemelerin toplamı. */
  paidCents: number
}

export interface InstallmentState extends InstallmentFigures {
  remainingCents: number
  /** Vadesi geçmiş ve kalanı olan taksit; vade günü dahil vadesi gelmemiş sayılır. */
  overdue: boolean
}

export function installmentState(item: InstallmentFigures, today: string): InstallmentState {
  const remainingCents = Math.max(item.amountCents - item.paidCents, 0)
  return { ...item, remainingCents, overdue: remainingCents > 0 && item.dueDate < today }
}

export interface InvoiceBalance {
  paidCents: number
  remainingCents: number
  overdueCents: number
  /** Kalanı olan ilk taksitin vadesi; kalan yoksa `null`. */
  nextDueDate: string | null
  status: SupplierInvoiceStatus
}

/** Faturanın ödenen, kalan ve vadesi geçmiş tutarı ile durumu (K-163). */
export function supplierInvoiceBalance(
  invoice: { grossCents: number; cancelled: boolean },
  installments: readonly InstallmentFigures[],
  today: string,
): InvoiceBalance {
  const states = installments.map((item) => installmentState(item, today))
  const paidCents = states.reduce((total, item) => total + item.paidCents, 0)
  const overdueCents = states.reduce(
    (total, item) => total + (item.overdue ? item.remainingCents : 0),
    0,
  )
  const open = states.filter((item) => item.remainingCents > 0)
  const remainingCents = invoice.cancelled ? 0 : Math.max(invoice.grossCents - paidCents, 0)
  const nextDueDate = open.reduce<string | null>(
    (first, item) => (first === null || item.dueDate < first ? item.dueDate : first),
    null,
  )
  let status: SupplierInvoiceStatus
  if (invoice.cancelled) status = 'cancelled'
  else if (remainingCents === 0) status = 'paid'
  else if (overdueCents > 0) status = 'overdue'
  else status = paidCents > 0 ? 'partially_paid' : 'open'
  return { paidCents, remainingCents, overdueCents, nextDueDate, status }
}

/** Taksitler vade sırasıyla; aynı gündekiler girildiği sırada kalır. */
export const sortInstallments = <T extends { dueDate: string }>(items: readonly T[]): T[] =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.dueDate.localeCompare(b.item.dueDate) || a.index - b.index)
    .map(({ item }) => item)

export type StatementMovementKind = 'invoice' | 'invoice_cancel' | 'payment' | 'payment_cancel'

export const STATEMENT_MOVEMENT_LABELS = {
  invoice: 'Fatura',
  invoice_cancel: 'Fatura iptali',
  payment: 'Ödeme',
  payment_cancel: 'Ödeme iptali',
} as const satisfies Record<StatementMovementKind, string>

export interface StatementInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  grossCents: number
  createdAt: string
  cancelledAt: string | null
}

export interface StatementPayment {
  id: string
  invoiceId: string
  invoiceNumber: string
  paidDate: string
  amountCents: number
  method: SupplierPaymentMethod
  createdAt: string
  cancelledAt: string | null
}

export interface StatementMovement {
  kind: StatementMovementKind
  /** Hareketin günü: fatura tarihi, ödeme günü ya da iptalin Europe/Istanbul günü. */
  date: string
  invoiceId: string
  invoiceNumber: string
  paymentId: string | null
  method: SupplierPaymentMethod | null
  /** Kurumun tedarikçiye borcunu artıran tutar (fatura, ödeme iptali). */
  debitCents: number
  /** Borcu azaltan tutar (ödeme, fatura iptali). */
  creditCents: number
  /** Hareket sonrası bakiye: kurumun tedarikçiye borcu. */
  balanceCents: number
}

const KIND_ORDER: Record<StatementMovementKind, number> = {
  invoice: 0,
  payment: 1,
  payment_cancel: 2,
  invoice_cancel: 3,
}

/**
 * Tedarikçi ekstresi (K-163): fatura fatura tarihine, ödeme ödeme gününe, iptal iptal gününe yazılır;
 * iptal edilen kayıt ters hareketle kapanır, silinmez. Aynı günde fatura önce, iptaller sonra gelir.
 */
export function supplierStatement(
  invoices: readonly StatementInvoice[],
  payments: readonly StatementPayment[],
): StatementMovement[] {
  type Entry = Omit<StatementMovement, 'balanceCents'> & { at: string; id: string }
  const entries: Entry[] = []
  for (const invoice of invoices) {
    const base = { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, paymentId: null }
    entries.push({
      ...base,
      kind: 'invoice',
      date: invoice.invoiceDate,
      method: null,
      debitCents: invoice.grossCents,
      creditCents: 0,
      at: invoice.createdAt,
      id: invoice.id,
    })
    if (invoice.cancelledAt !== null)
      entries.push({
        ...base,
        kind: 'invoice_cancel',
        date: dayKey(invoice.cancelledAt),
        method: null,
        debitCents: 0,
        creditCents: invoice.grossCents,
        at: invoice.cancelledAt,
        id: invoice.id,
      })
  }
  for (const payment of payments) {
    const base = {
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoiceNumber,
      paymentId: payment.id,
      method: payment.method,
    }
    entries.push({
      ...base,
      kind: 'payment',
      date: payment.paidDate,
      debitCents: 0,
      creditCents: payment.amountCents,
      at: payment.createdAt,
      id: payment.id,
    })
    if (payment.cancelledAt !== null)
      entries.push({
        ...base,
        kind: 'payment_cancel',
        date: dayKey(payment.cancelledAt),
        debitCents: payment.amountCents,
        creditCents: 0,
        at: payment.cancelledAt,
        id: payment.id,
      })
  }
  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.at.localeCompare(b.at) ||
      a.id.localeCompare(b.id),
  )
  let balance = 0
  return entries.map((entry) => {
    balance += entry.debitCents - entry.creditCents
    return {
      kind: entry.kind,
      date: entry.date,
      invoiceId: entry.invoiceId,
      invoiceNumber: entry.invoiceNumber,
      paymentId: entry.paymentId,
      method: entry.method,
      debitCents: entry.debitCents,
      creditCents: entry.creditCents,
      balanceCents: balance,
    }
  })
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path ? { path: [path] } : {}) })

export const SUPPLIER_INVOICE_ORDER_WARNING = 'supplier_invoice_exceeds_order_warning'
export const PAYMENT_INSTRUCTION_REEXPORT_WARNING = 'supplier_payment_instruction_exported_warning'

/** Faturanın bağlandığı sipariş (DOM-FIN-073); KDV dahil toplamı kalemlerden hesaplanır. */
export interface InvoiceOrderLink {
  supplierId: string
  status: PurchaseOrderStatus
  grossCents: number
  /** Siparişe bağlı öteki etkin faturaların KDV dahil toplamı. */
  invoicedCents: number
}

export interface SupplierInvoiceContext {
  supplier: { id: string } | null
  /** Aynı tedarikçide aynı numaralı etkin fatura var mı (K-161). */
  numberTaken: boolean
  /** Gövdede sipariş yoksa `undefined`; sipariş kurumda bulunmazsa `null`. */
  order?: InvoiceOrderLink | null | undefined
  /** Europe/Istanbul günü. */
  today: string
}

export interface PlannedSupplierInvoice extends InvoiceAmounts {
  fields: SupplierInvoiceFields
  installments: SupplierInstallmentInput[]
  /** Sipariş aşımı açık onayla geçildiyse `true` (denetim kaydına düşer). */
  orderOverrunConfirmed: boolean
}

/** Ödeme planı denetimi: taksitler fatura tarihinden önce değildir, toplamı KDV dahil tutardır. */
export function checkSupplierInstallments(
  installments: readonly SupplierInstallmentInput[],
  invoice: { grossCents: number; invoiceDate: string },
): SupplierInstallmentInput[] {
  const sorted = sortInstallments(installments)
  if (sorted.some((item) => item.dueDate < invoice.invoiceDate))
    throw ruleError(
      'supplier_invoice_installment_before_invoice',
      'Taksit vadesi fatura tarihinden önce olamaz.',
      'installments',
    )
  const total = sorted.reduce((sum, item) => sum + item.amountCents, 0)
  if (total !== invoice.grossCents)
    throw ruleError(
      'supplier_invoice_plan_total_mismatch',
      `Taksitlerin toplamı (${money(total)}) fatura tutarına (${money(invoice.grossCents)}) eşit olmalıdır.`,
      'installments',
    )
  return sorted
}

/** Sipariş tutarını aşan faturanın uyarı metni (K-162). */
export function supplierInvoiceOrderWarning(order: InvoiceOrderLink, grossCents: number): string {
  const overrun = order.invoicedCents + grossCents - order.grossCents
  return `Bu fatura siparişin tutarını ${money(overrun)} aşıyor (sipariş ${money(order.grossCents)}, önceki faturalar ${money(order.invoicedCents)}, bu fatura ${money(grossCents)}). Sürdürmek için aşımı açıkça onaylayın.`
}

/**
 * Yeni fatura (DOM-FIN-076): tedarikçi kurumda olmalı (pasif tedarikçinin geç gelen faturası
 * girilir, K-160), fatura tarihi bugünden sonra olamaz, numara tedarikçide tekildir (409). Siparişe
 * bağlıysa sipariş aynı tedarikçinin gönderilmiş siparişidir; etkin faturaların toplamı sipariş
 * tutarını aşarsa açık onay olmadan 409 `supplier_invoice_exceeds_order_warning` (K-162).
 */
export function planSupplierInvoice(
  input: unknown,
  context: SupplierInvoiceContext,
): PlannedSupplierInvoice {
  const fields = supplierInvoiceSchema.parse(input)
  if (context.supplier === null)
    throw ruleError('supplier_invoice_supplier_not_found', 'Tedarikçi bulunamadı.', 'supplierId')
  if (fields.invoiceDate > context.today)
    throw ruleError(
      'supplier_invoice_date_in_future',
      'Fatura tarihi bugünden sonra olamaz.',
      'invoiceDate',
    )
  const amounts = supplierInvoiceAmounts(fields)
  const installments = checkSupplierInstallments(
    fields.installments ?? [
      { dueDate: fields.dueDate ?? fields.invoiceDate, amountCents: amounts.grossCents },
    ],
    { grossCents: amounts.grossCents, invoiceDate: fields.invoiceDate },
  )
  let orderOverrunConfirmed = false
  if (fields.purchaseOrderId !== null) {
    const order = context.order ?? null
    if (order === null)
      throw ruleError('supplier_invoice_order_not_found', 'Sipariş bulunamadı.', 'purchaseOrderId')
    if (order.supplierId !== context.supplier.id)
      throw ruleError(
        'supplier_invoice_order_supplier_mismatch',
        'Sipariş bu tedarikçiye ait değil.',
        'purchaseOrderId',
      )
    if (order.status === 'draft' || order.status === 'cancelled')
      throw ruleError(
        'supplier_invoice_order_not_open',
        'Fatura yalnız gönderilmiş siparişe bağlanır.',
        'purchaseOrderId',
      )
    if (order.invoicedCents + amounts.grossCents > order.grossCents) {
      if (fields.confirmOverOrder !== true)
        throw new DomainError(
          SUPPLIER_INVOICE_ORDER_WARNING,
          supplierInvoiceOrderWarning(order, amounts.grossCents),
          { kind: 'conflict' },
        )
      orderOverrunConfirmed = true
    }
  }
  if (context.numberTaken)
    throw new DomainError(
      'supplier_invoice_number_exists',
      'Bu tedarikçide aynı numaralı bir fatura kayıtlı.',
      { kind: 'conflict', path: ['invoiceNumber'] },
    )
  return { fields, ...amounts, installments, orderOverrunConfirmed }
}

export interface SupplierInvoiceState {
  grossCents: number
  invoiceDate: string
  cancelled: boolean
  /** Faturaya yazılmış etkin ödeme var mı. */
  hasPayments: boolean
}

const assertInvoiceActive = (invoice: Pick<SupplierInvoiceState, 'cancelled'>) => {
  if (invoice.cancelled)
    throw ruleError('supplier_invoice_cancelled', 'Fatura iptal edilmiş; işlem yapılamaz.')
}

/** Ödeme planı yalnız ödemesi olmayan etkin faturada yeniden yazılır (K-163). */
export function planSupplierInvoicePlan(
  invoice: SupplierInvoiceState,
  input: unknown,
): SupplierInstallmentInput[] {
  const { installments } = supplierInvoicePlanSchema.parse(input)
  assertInvoiceActive(invoice)
  if (invoice.hasPayments)
    throw ruleError(
      'supplier_invoice_plan_locked',
      'Ödemesi olan faturanın planı değişmez; önce ödemeleri iptal edin.',
      'installments',
    )
  return checkSupplierInstallments(installments, invoice)
}

/** Fatura iptali gerekçeyle; ödemesi olan fatura önce ödemeleri iptal edilince iptal edilir. */
export function planSupplierInvoiceCancel(
  invoice: SupplierInvoiceState,
  input: unknown,
): { reason: string } {
  const data = cancelSupplierInvoiceSchema.parse(input)
  assertInvoiceActive(invoice)
  if (invoice.hasPayments)
    throw ruleError(
      'supplier_invoice_has_payments',
      'Ödemesi olan fatura iptal edilmez; önce ödemeleri iptal edin.',
    )
  return data
}

export interface SupplierPaymentContext {
  installment: {
    amountCents: number
    paidCents: number
    invoiceDate: string
    invoiceCancelled: boolean
  } | null
  /** Kurumun arşivlenmemiş banka hesapları (`DOM-FIN-032`). */
  bankAccountIds: readonly string[]
  /** Ödeme günü kapatılmış mı (`DOM-FIN-036`); yalnız nakitte bakılır (K-166). */
  dayClosed: boolean
  today: string
}

/**
 * Ödeme (DOM-FIN-076): taksitin kalanını aşamaz (kurum kilidi altında yeniden hesaplanır), gün
 * bugünden sonra ve fatura tarihinden önce olamaz; nakit dışı ödeme kurumun banka hesabından çıkar.
 * Kapatılmış güne nakit ödeme yazılmaz (K-166).
 */
export function planSupplierPayment(
  input: unknown,
  context: SupplierPaymentContext,
): SupplierPaymentFields {
  const data = supplierPaymentSchema.parse(input)
  const installment = context.installment
  if (installment === null)
    throw ruleError('supplier_payment_installment_not_found', 'Taksit bulunamadı.', 'installmentId')
  if (installment.invoiceCancelled) assertInvoiceActive({ cancelled: true })
  if (data.paidDate > context.today)
    throw ruleError(
      'supplier_payment_date_in_future',
      'Ödeme günü bugünden sonra olamaz.',
      'paidDate',
    )
  if (data.paidDate < installment.invoiceDate)
    throw ruleError(
      'supplier_payment_before_invoice',
      'Ödeme günü fatura tarihinden önce olamaz.',
      'paidDate',
    )
  if (data.bankAccountId !== null && !context.bankAccountIds.includes(data.bankAccountId))
    throw ruleError(
      'supplier_payment_bank_account_not_found',
      'Banka hesabı bulunamadı; kurumun tanımlı hesaplarından birini seçin.',
      'bankAccountId',
    )
  const remaining = Math.max(installment.amountCents - installment.paidCents, 0)
  if (data.amountCents > remaining)
    throw ruleError(
      'supplier_payment_exceeds_installment',
      remaining === 0
        ? 'Bu taksit ödenmiş; başka taksit seçin.'
        : `Ödeme taksitin kalanını (${money(remaining)}) aşamaz.`,
      'amountCents',
    )
  if (data.method === 'cash') assertPaymentDayOpen(context.dayClosed)
  return data
}

/**
 * Ödeme iptali gerekçeyle; silme yok. Nakit ödemenin iptali bugünün gün sonuna dokunur: bugün
 * kapalıysa reddedilir (`DOM-FIN-036`, K-166).
 */
export function planSupplierPaymentCancel(
  payment: { cancelled: boolean; method: SupplierPaymentMethod },
  input: unknown,
  todayClosed: boolean,
): { reason: string } {
  const data = cancelSupplierPaymentSchema.parse(input)
  if (payment.cancelled) throw ruleError('supplier_payment_cancelled', 'Ödeme zaten iptal edilmiş.')
  if (payment.method === 'cash') assertReversalDayOpen(todayClosed)
  return data
}

export interface InstructionPayment {
  id: string
  method: SupplierPaymentMethod
  cancelled: boolean
  exported: boolean
  supplierName: string
  /** Tedarikçinin IBAN'ı; tanımsızsa `null`. */
  iban: string | null
  amountCents: number
  paidDate: string
  description: string
  /** Ödemenin çıktığı kurum hesabının IBAN'ı. */
  sourceIban: string | null
}

/**
 * Talimat dosyası denetimi (K-164, K-165): seçilen bütün ödemeler kurumda, etkin, havale ya da EFT ve
 * tedarikçisinin IBAN'ı tanımlıdır. Dosyası daha önce alınmış ödeme açık onay olmadan 409 alır:
 * aynı dosyanın bankaya iki kez yüklenmesi çift ödemedir.
 */
export function planPaymentInstruction(
  input: unknown,
  payments: readonly InstructionPayment[],
): { payments: InstructionPayment[]; reexported: boolean } {
  const data = paymentInstructionSchema.parse(input)
  const byId = new Map(payments.map((payment) => [payment.id, payment]))
  const selected = data.paymentIds.map((id) => byId.get(id))
  if (selected.some((payment) => payment === undefined))
    throw ruleError(
      'supplier_payment_not_found',
      'Seçilen ödemelerden biri bulunamadı; listeyi yenileyin.',
      'paymentIds',
    )
  const rows = selected.filter((payment): payment is InstructionPayment => payment !== undefined)
  if (rows.some((payment) => payment.cancelled))
    throw ruleError(
      'supplier_payment_cancelled',
      'İptal edilmiş ödeme talimat dosyasına girmez.',
      'paymentIds',
    )
  if (rows.some((payment) => !INSTRUCTION_PAYMENT_METHODS.some((m) => m === payment.method)))
    throw ruleError(
      'supplier_payment_instruction_method',
      'Talimat dosyasına yalnız havale ve EFT ödemeleri girer.',
      'paymentIds',
    )
  const missing = [
    ...new Set(rows.filter((row) => row.iban === null).map((row) => row.supplierName)),
  ]
  if (missing.length > 0)
    throw ruleError(
      'supplier_payment_instruction_iban_missing',
      `Tedarikçinin IBAN'ı tanımlı değil: ${missing.join(', ')}. Önce tedarikçi kaydına IBAN girin.`,
      'paymentIds',
    )
  const exported = rows.filter((row) => row.exported).length
  if (exported > 0 && data.confirmReexport !== true)
    throw new DomainError(
      PAYMENT_INSTRUCTION_REEXPORT_WARNING,
      `Seçilen ${String(exported)} ödemenin talimat dosyası daha önce alındı. Bankaya ikinci kez yüklenirse ödeme yinelenir; yeniden almak için açıkça onaylayın.`,
      { kind: 'conflict' },
    )
  return { payments: rows, reexported: exported > 0 }
}

export const PAYMENT_INSTRUCTION_HEADER = [
  'Alıcı unvanı',
  'Alıcı IBAN',
  'Tutar',
  'Para birimi',
  'Açıklama',
  'Ödeme günü',
  'Gönderen IBAN',
] as const

/** Boş açıklamanın yerine bankaya giden metin. */
export const defaultPaymentDescription = (invoiceNumber: string) =>
  `Fatura ${invoiceNumber} ödemesi`

/**
 * Genel ödeme talimatı CSV'si (K-164): `;` ayırıcı, ondalık virgül, metin formül kaçışlı. IBAN açık
 * yazılır (bankanın alıcıyı bulması gerekir). Belirli bir bankanın toplu ödeme biçimi değildir.
 */
export function paymentInstructionCsv(rows: readonly InstructionPayment[]): string {
  const lines = rows.map((row) =>
    [
      csvCell(row.supplierName),
      csvCell(row.iban ?? ''),
      csvAmount(row.amountCents),
      csvCell('TRY'),
      csvCell(row.description),
      csvCell(row.paidDate),
      csvCell(row.sourceIban ?? ''),
    ].join(CSV_SEPARATOR),
  )
  return [PAYMENT_INSTRUCTION_HEADER.map(csvCell).join(CSV_SEPARATOR), ...lines].join('\r\n')
}

/** Ekranda gösterilen işlemler (sunucu aynı kuralları yeniden denetler). */
export function supplierInvoiceActions(invoice: {
  cancelled: boolean
  hasPayments: boolean
  remainingCents: number
}) {
  const active = !invoice.cancelled
  return {
    pay: active && invoice.remainingCents > 0,
    replan: active && !invoice.hasPayments,
    cancel: active && !invoice.hasPayments,
  }
}
