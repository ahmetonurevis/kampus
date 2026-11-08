// Tedarikçi ve satın alma talebi formları (DOM-FIN-070, DOM-FIN-071; ON-221, ON-222). Alan
// kuralları core şemalarındandır; boş bırakılabilen alan formda boş metin, gövdede `null` olur.
// Tutar formda `1.234,56` metnidir, gövdede kuruş.
import { z } from 'zod'
import type {
  CreatePurchaseRequestBody,
  CreateSupplierBody,
  PurchaseRequestDetail,
  SupplierDetail,
} from '@kampus/react-shared/use-finance-procurement.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import {
  BUDGET_LINE_MISSING_WARNING,
  PURCHASE_BUDGET_WARNING_CODES,
  PURCHASE_ITEMS_MAX,
  PURCHASE_REQUEST_STATUS_LABELS,
  PURCHASE_UNIT_PRICE_MAX_CENTS,
  PURCHASE_UNITS,
  purchaseRequestItemSchema,
  purchaseRequestSchema,
  type PurchaseRequestStatus,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'
import {
  SUPPLIER_CATEGORIES,
  SUPPLIER_DOCUMENT_NAME_MAX,
  SUPPLIER_DOCUMENT_NOTE_MAX,
  SUPPLIER_DOCUMENTS_MAX,
  SUPPLIER_TYPES,
  isValidSupplierTaxNumber,
  supplierSchema,
  type SupplierDocumentStatus,
} from '@kampus/school-core/lib/finance-suppliers.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

const fieldOf =
  <T extends string>(fields: readonly T[]) =>
  (name: string) =>
    fields.find((field) => field === name)

/** Boşsa geçerli, doluysa core alan şemasıyla denetlenen isteğe bağlı metin. */
const optionalText = (schema: z.ZodType) =>
  z.string().superRefine((value, context) => {
    const text = value.trim()
    if (text === '') return
    const parsed = schema.safeParse(text)
    if (!parsed.success)
      context.addIssue({
        code: 'custom',
        message: parsed.error.issues[0]?.message ?? 'Geçerli bir değer girin.',
      })
  })
const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

// --- Tedarikçi -----------------------------------------------------------------------------------

const shape = supplierSchema.shape

export const supplierFormSchema = z
  .object({
    name: shape.name,
    type: z.enum(SUPPLIER_TYPES, 'Tedarikçi türünü seçin.'),
    taxNumber: z.string().trim().min(1, 'Vergi numarasını yazın.'),
    taxOffice: shape.taxOffice,
    categories: z.array(z.enum(SUPPLIER_CATEGORIES)).min(1, 'En az bir kategori seçin.'),
    contactName: optionalText(shape.contactName),
    contactPhone: optionalText(shape.contactPhone),
    contactEmail: optionalText(shape.contactEmail),
    address: optionalText(shape.address),
    iban: optionalText(shape.iban),
    documents: z
      .array(
        z.object({
          name: z
            .string()
            .trim()
            .min(2, 'Belge adını en az 2 karakterle yazın.')
            .max(SUPPLIER_DOCUMENT_NAME_MAX),
          expiryDate: z.union([z.literal(''), daySchema]),
          note: z.string().max(SUPPLIER_DOCUMENT_NOTE_MAX),
        }),
      )
      .max(SUPPLIER_DOCUMENTS_MAX, `En fazla ${String(SUPPLIER_DOCUMENTS_MAX)} belge eklenebilir.`),
  })
  .superRefine((value, context) => {
    const digits = value.taxNumber.trim()
    if (!isValidSupplierTaxNumber(value.type, digits))
      context.addIssue({
        code: 'custom',
        path: ['taxNumber'],
        message:
          value.type === 'company'
            ? 'Şirkette 10 haneli geçerli bir VKN girin.'
            : 'Şahısta 11 haneli geçerli bir T.C. kimlik numarası girin.',
      })
  })
export type SupplierFormValues = z.input<typeof supplierFormSchema>

export const supplierFormField = fieldOf(
  Object.keys(supplierFormSchema.shape) as (keyof SupplierFormValues)[],
)

export function supplierDefaults(supplier?: SupplierDetail): SupplierFormValues {
  return {
    name: supplier?.name ?? '',
    type: supplier?.type ?? 'company',
    taxNumber: supplier?.taxNumber ?? '',
    taxOffice: supplier?.taxOffice ?? '',
    categories: supplier?.categories ?? [],
    contactName: supplier?.contactName ?? '',
    contactPhone: supplier?.contactPhone ?? '',
    contactEmail: supplier?.contactEmail ?? '',
    address: supplier?.address ?? '',
    iban: supplier?.iban ?? '',
    documents: (supplier?.documents ?? []).map((document) => ({
      name: document.name,
      expiryDate: document.expiryDate ?? '',
      note: document.note ?? '',
    })),
  }
}

export function supplierBody(values: SupplierFormValues): CreateSupplierBody {
  return {
    name: values.name.trim(),
    type: values.type,
    taxNumber: values.taxNumber.trim(),
    taxOffice: values.taxOffice.trim(),
    categories: values.categories,
    contactName: blankToNull(values.contactName),
    contactPhone: blankToNull(values.contactPhone),
    contactEmail: blankToNull(values.contactEmail),
    address: blankToNull(values.address),
    iban: blankToNull(values.iban),
    documents: values.documents.map((document) => ({
      name: document.name.trim(),
      expiryDate: document.expiryDate === '' ? null : document.expiryDate,
      note: blankToNull(document.note),
    })),
  }
}

export const DOCUMENT_STATUS_VIEW: Readonly<
  Record<SupplierDocumentStatus, { label: string; tone: BadgeTone }>
> = {
  valid: { label: 'Geçerli', tone: 'green' },
  expiring: { label: 'Süresi yaklaşıyor', tone: 'amber' },
  expired: { label: 'Süresi geçti', tone: 'red' },
  'open-ended': { label: 'Süresiz', tone: 'gray' },
}

// --- Satın alma talebi ---------------------------------------------------------------------------

const PRICE_MESSAGE = 'Birim fiyatı 1.234,56 biçiminde, sıfırdan büyük girin.'
export const parseUnitPrice = (text: string) =>
  parseAmountInput(text, { maxCents: PURCHASE_UNIT_PRICE_MAX_CENTS })

const requestShape = purchaseRequestSchema.shape
const itemShape = purchaseRequestItemSchema.shape

export const requestFormSchema = z.object({
  costCenterId: z.string().min(1, 'Talep eden birimi seçin.'),
  periodId: z.string().min(1, 'Bütçe dönemini seçin.'),
  budgetItemId: z.string().min(1, 'Gider kalemini seçin.'),
  supplierId: z.string(),
  justification: requestShape.justification,
  items: z
    .array(
      z.object({
        name: itemShape.name,
        quantity: z
          .string()
          .regex(/^\d{1,7}$/, 'Miktarı tam sayı girin.')
          .refine((value) => Number(value) >= 1 && Number(value) <= 1_000_000, {
            message: 'Miktar 1 ile 1.000.000 arasında olmalıdır.',
          }),
        unit: z.enum(PURCHASE_UNITS, 'Birimi seçin.'),
        price: z.string().refine((value) => parseUnitPrice(value) !== null, {
          message: PRICE_MESSAGE,
        }),
      }),
    )
    .min(1, 'En az bir kalem ekleyin.')
    .max(PURCHASE_ITEMS_MAX, `En fazla ${String(PURCHASE_ITEMS_MAX)} kalem eklenebilir.`),
})
export type RequestFormValues = z.input<typeof requestFormSchema>
export type RequestFormItem = RequestFormValues['items'][number]

export const EMPTY_ITEM: RequestFormItem = { name: '', quantity: '1', unit: 'piece', price: '' }

/** Sunucu alan yolu (`items.0.estimatedUnitPriceCents`) form alanına çevrilir. */
export function requestFormField(
  name: string,
):
  | `items.${number}.${'name' | 'quantity' | 'unit' | 'price'}`
  | keyof RequestFormValues
  | undefined {
  const item = /^items\.(\d+)\.(name|quantity|unit|estimatedUnitPriceCents)$/.exec(name)
  if (item) {
    const field = item[2] === 'estimatedUnitPriceCents' ? 'price' : item[2]
    return `items.${Number(item[1])}.${field as 'name' | 'quantity' | 'unit' | 'price'}`
  }
  return fieldOf([
    'costCenterId',
    'periodId',
    'budgetItemId',
    'supplierId',
    'justification',
    'items',
  ] as const)(name)
}

export function requestDefaults(request?: PurchaseRequestDetail): RequestFormValues {
  return {
    costCenterId: request?.costCenter.id ?? '',
    periodId: request?.period.id ?? '',
    budgetItemId: request?.budgetItem.id ?? '',
    supplierId: request?.supplier?.id ?? '',
    justification: request?.justification ?? '',
    items: request
      ? request.items.map((item) => ({
          name: item.name,
          quantity: String(item.quantity),
          unit: item.unit,
          price: amountInputValue(item.estimatedUnitPriceCents),
        }))
      : [{ ...EMPTY_ITEM }],
  }
}

export function requestBody(values: RequestFormValues): CreatePurchaseRequestBody {
  return {
    costCenterId: values.costCenterId,
    periodId: values.periodId,
    budgetItemId: values.budgetItemId,
    supplierId: values.supplierId === '' ? null : values.supplierId,
    justification: values.justification.trim(),
    items: values.items.map((item) => ({
      name: item.name.trim(),
      quantity: Number(item.quantity),
      unit: item.unit,
      estimatedUnitPriceCents: parseUnitPrice(item.price) ?? 0,
    })),
  }
}

/** Formdaki kalemlerin anlık tahmini toplamı (kuruş); geçersiz satır sayılmaz. */
export function formTotalCents(items: readonly Partial<RequestFormItem>[]): number {
  let total = 0
  for (const item of items) {
    const quantity = Number(item.quantity ?? '')
    const price = parseUnitPrice(item.price ?? '')
    if (Number.isInteger(quantity) && quantity > 0 && price !== null) total += quantity * price
  }
  return total
}

/**
 * Gönderim ve onayın bütçe uyarısı (ON-245, K-146): sunucunun mesajı ve uyarının verildiği talep
 * sürümü. Sürüm değişince uyarı kalkar; ikinci gönderim `confirmOverBudget` taşır.
 */
export type BudgetWarningState = { message: string; unplanned: boolean; key: string }

export const isBudgetWarning = (error: { code: string }) =>
  PURCHASE_BUDGET_WARNING_CODES.some((code) => code === error.code)

export function budgetWarningState(
  error: { code: string; message: string },
  key: string,
): BudgetWarningState {
  return { message: error.message, unplanned: error.code === BUDGET_LINE_MISSING_WARNING, key }
}

export const reasonFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(500, 'En fazla 500 karakter girebilirsiniz.'),
})
export type ReasonFormValues = z.input<typeof reasonFormSchema>
/** Onay notu isteğe bağlıdır; aynı alan adıyla (`reason`) aynı pencere kullanılır. */
export const noteFormSchema = z.object({
  reason: z.string().trim().max(500, 'En fazla 500 karakter girebilirsiniz.'),
})

export const REQUEST_STATUS_VIEW: Readonly<
  Record<PurchaseRequestStatus, { label: string; tone: BadgeTone }>
> = {
  draft: { label: PURCHASE_REQUEST_STATUS_LABELS.draft, tone: 'gray' },
  submitted: { label: PURCHASE_REQUEST_STATUS_LABELS.submitted, tone: 'amber' },
  approved: { label: PURCHASE_REQUEST_STATUS_LABELS.approved, tone: 'green' },
  rejected: { label: PURCHASE_REQUEST_STATUS_LABELS.rejected, tone: 'red' },
  cancelled: { label: PURCHASE_REQUEST_STATUS_LABELS.cancelled, tone: 'gray' },
}
