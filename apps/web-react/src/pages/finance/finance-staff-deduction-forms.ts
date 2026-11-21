// Avans ve kesinti formları (DOM-FIN-101; ON-199). Form değerleri düz metindir: tutarlar
// `1.234,56`, oranlar yüzde (`25`, `2,5`), aylar `YYYY-MM`. Gövdeye çevrildikten sonra core
// şemasıyla denetlenir; mesajlar ve sınırlar tek kaynaktan gelir. Sunucu alan yolu forma
// `fieldOf` ile döner.
import type { z } from 'zod'
import {
  monthlyDeductionRequestSchema,
  STAFF_ADVANCE_MAX_CENTS,
  STAFF_ADVANCE_PAYMENT_METHOD_LABELS,
  STAFF_ADVANCE_PAYMENT_METHODS,
  STAFF_GARNISHMENT_CLOSE_REASON_LABELS,
  STAFF_GARNISHMENT_CLOSE_REASONS,
  STAFF_GARNISHMENT_MAX_CLAIM_CENTS,
  staffAdvanceCloseSchema,
  staffAdvanceSchema,
  staffDeductionCancelSchema,
  staffGarnishmentBalanceSchema,
  staffGarnishmentCloseSchema,
  staffGarnishmentSchema,
  staffPensionOptOutSchema,
  staffPensionPauseSchema,
  staffPensionSchema,
} from '@kampus/school-core/lib/finance-staff-deductions.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'

export type FormValues = Record<string, string>
export type FieldKind = 'text' | 'amount' | 'date' | 'month' | 'select' | 'number' | 'textarea'
export interface FieldSpec {
  name: string
  label: string
  kind: FieldKind
  options?: readonly { value: string; label: string }[]
  description?: string
}
export interface DeductionFormSpec {
  /** Formun erişilebilir adı ve gönder düğmesi. */
  title: string
  submitLabel: string
  fields: readonly FieldSpec[]
  schema: z.ZodType
  /** Metin değerlerinden gövde; çözülemeyen alanlar `errors`'ta. */
  toBody: (values: FormValues) => { body: Record<string, unknown>; errors: Record<string, string> }
}

const options = <T extends string>(values: readonly T[], labels: Readonly<Record<T, string>>) =>
  values.map((value) => ({ value, label: labels[value] }))
const METHOD_OPTIONS = options(STAFF_ADVANCE_PAYMENT_METHODS, STAFF_ADVANCE_PAYMENT_METHOD_LABELS)
const CLOSE_REASON_OPTIONS = options(
  STAFF_GARNISHMENT_CLOSE_REASONS,
  STAFF_GARNISHMENT_CLOSE_REASON_LABELS,
)
const YES_NO = [
  { value: 'false', label: 'Hayır' },
  { value: 'true', label: 'Evet' },
] as const

const AMOUNT_MESSAGE = 'Tutarı 1.234,56 biçiminde, sıfırdan büyük girin.'
const RATE_MESSAGE = 'Oranı yüzde olarak girin (ör. 25 ya da 2,5).'

/** Yüzde metni → onbinde (`25` → 2500, `2,5` → 250); geçersizse `null`. */
export function percentToBasisPoints(text: string): number | null {
  const value = text.trim().replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null
  return Math.round(Number(value) * 100)
}
/** Onbinde → form metni (2500 → `25`, 250 → `2,5`). */
export const basisPointsText = (basisPoints: number) => String(basisPoints / 100).replace('.', ',')

/** Gövde kurucu: tutar ve oran alanları çevrilir, kalanlar metin kalır. */
function builder(values: FormValues) {
  const body: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  return {
    body,
    errors,
    text(field: string, key = field) {
      body[key] = (values[field] ?? '').trim()
    },
    amount(field: string, key: string, maxCents: number, optional = false) {
      const text = (values[field] ?? '').trim()
      if (optional && text === '') {
        body[key] = null
        return
      }
      const cents = parseAmountInput(text, { allowZero: optional, maxCents })
      if (cents === null) errors[field] = AMOUNT_MESSAGE
      else body[key] = cents
    },
    rate(field: string, key: string) {
      const bps = percentToBasisPoints(values[field] ?? '')
      if (bps === null) errors[field] = RATE_MESSAGE
      else body[key] = bps
    },
  }
}

export const advanceForm: DeductionFormSpec = {
  title: 'Yeni avans',
  submitLabel: 'Avansı kaydet',
  fields: [
    { name: 'amount', label: 'Avans tutarı (₺)', kind: 'amount' },
    { name: 'givenDate', label: 'Veriliş günü', kind: 'date' },
    { name: 'paymentMethod', label: 'Ödeme yöntemi', kind: 'select', options: METHOD_OPTIONS },
    { name: 'installmentCount', label: 'Taksit sayısı', kind: 'number' },
    {
      name: 'firstMonth',
      label: 'Mahsubun ilk ayı',
      kind: 'month',
      description: 'Taksitler eşit kuruştur; yuvarlama farkı son taksite eklenir.',
    },
  ],
  schema: staffAdvanceSchema,
  toBody(values) {
    const b = builder(values)
    b.text('membershipId')
    b.amount('amount', 'amountCents', STAFF_ADVANCE_MAX_CENTS)
    b.text('givenDate')
    b.text('paymentMethod')
    b.body.installmentCount = Number(values.installmentCount ?? '')
    b.text('firstMonth')
    return b
  },
}

export const garnishmentForm: DeductionFormSpec = {
  title: 'Yeni icra kesintisi',
  submitLabel: 'İcrayı kaydet',
  fields: [
    { name: 'office', label: 'İcra dairesi', kind: 'text' },
    { name: 'fileNumber', label: 'Dosya numarası', kind: 'text' },
    { name: 'claim', label: 'Alacak tutarı (₺)', kind: 'amount' },
    {
      name: 'rate',
      label: 'Kesinti oranı (%)',
      kind: 'text',
      description: 'Müzekkerede yazmıyorsa net ücretin dörtte biri (%25).',
    },
    { name: 'isAlimony', label: 'Nafaka alacağı', kind: 'select', options: YES_NO },
    { name: 'receivedDate', label: 'Tebliğ günü', kind: 'date' },
  ],
  schema: staffGarnishmentSchema,
  toBody(values) {
    const b = builder(values)
    b.text('membershipId')
    b.text('office')
    b.text('fileNumber')
    b.amount('claim', 'claimCents', STAFF_GARNISHMENT_MAX_CLAIM_CENTS)
    b.rate('rate', 'rateBasisPoints')
    b.body.isAlimony = values.isAlimony === 'true'
    b.text('receivedDate')
    return b
  },
}

export const pensionForm: DeductionFormSpec = {
  title: 'BES otomatik katılımı',
  submitLabel: 'Katılımı kaydet',
  fields: [
    { name: 'rate', label: 'Katkı oranı (%)', kind: 'text', description: 'En az %3.' },
    { name: 'startDate', label: 'Başlangıç günü', kind: 'date' },
  ],
  schema: staffPensionSchema,
  toBody(values) {
    const b = builder(values)
    b.text('membershipId')
    b.rate('rate', 'rateBasisPoints')
    b.text('startDate')
    return b
  },
}

export const advanceCloseForm: DeductionFormSpec = {
  title: 'Avansı erken kapat',
  submitLabel: 'Erken kapat',
  fields: [
    { name: 'closedDate', label: 'Kapama günü', kind: 'date' },
    { name: 'fromMonth', label: 'Kesilmeyecek ilk ay', kind: 'month' },
    { name: 'method', label: 'Geri ödeme yöntemi', kind: 'select', options: METHOD_OPTIONS },
  ],
  schema: staffAdvanceCloseSchema,
  toBody(values) {
    const b = builder(values)
    b.text('closedDate')
    b.text('fromMonth')
    b.text('method')
    return b
  },
}

export const advanceCancelForm: DeductionFormSpec = {
  title: 'Avansı iptal et',
  submitLabel: 'İptal et',
  fields: [{ name: 'reason', label: 'İptal gerekçesi', kind: 'textarea' }],
  schema: staffDeductionCancelSchema,
  toBody(values) {
    const b = builder(values)
    b.text('reason')
    return b
  },
}

export const garnishmentBalanceForm: DeductionFormSpec = {
  title: 'Kalan alacağı güncelle',
  submitLabel: 'Kalanı kaydet',
  fields: [{ name: 'remaining', label: 'Kalan alacak (₺)', kind: 'amount' }],
  schema: staffGarnishmentBalanceSchema,
  toBody(values) {
    const b = builder(values)
    b.amount('remaining', 'remainingCents', STAFF_GARNISHMENT_MAX_CLAIM_CENTS, true)
    if (b.body.remainingCents === null) b.errors.remaining = AMOUNT_MESSAGE
    return b
  },
}

export const garnishmentCloseForm: DeductionFormSpec = {
  title: 'İcrayı kapat',
  submitLabel: 'İcrayı kapat',
  fields: [
    { name: 'closedDate', label: 'Kapanış günü', kind: 'date' },
    { name: 'reason', label: 'Kapanış nedeni', kind: 'select', options: CLOSE_REASON_OPTIONS },
  ],
  schema: staffGarnishmentCloseSchema,
  toBody(values) {
    const b = builder(values)
    b.text('closedDate')
    b.text('reason')
    return b
  },
}

export const pensionPauseForm: DeductionFormSpec = {
  title: 'BES kesintisine ara ver',
  submitLabel: 'Ara ver',
  fields: [
    { name: 'fromMonth', label: 'İlk ay', kind: 'month' },
    { name: 'toMonth', label: 'Son ay', kind: 'month', description: 'En çok 12 ay.' },
  ],
  schema: staffPensionPauseSchema,
  toBody(values) {
    const b = builder(values)
    b.text('fromMonth')
    b.text('toMonth')
    return b
  },
}

export const pensionOptOutForm: DeductionFormSpec = {
  title: 'BES katılımından ayrıl',
  submitLabel: 'Ayrılışı kaydet',
  fields: [
    {
      name: 'optOutDate',
      label: 'Cayma ya da ayrılma günü',
      kind: 'date',
      description: 'Başlangıçtan iki ay içindeyse cayma sayılır, katkı iade edilir.',
    },
  ],
  schema: staffPensionOptOutSchema,
  toBody(values) {
    const b = builder(values)
    b.text('optOutDate')
    return b
  },
}

export const previewForm: DeductionFormSpec = {
  title: 'Ay için kesinti listesi',
  submitLabel: 'Kesintileri hesapla',
  fields: [
    { name: 'month', label: 'Ay', kind: 'month' },
    {
      name: 'net',
      label: 'Net ücret (₺, isteğe bağlı)',
      kind: 'amount',
      description: 'Boşsa yalnız sabit tutarlar (avans taksiti) hesaplanır.',
    },
    {
      name: 'pensionBase',
      label: 'BES matrahı (₺, isteğe bağlı)',
      kind: 'amount',
      description: 'SGK prime esas kazanç.',
    },
  ],
  schema: monthlyDeductionRequestSchema,
  toBody(values) {
    const b = builder(values)
    b.text('month')
    b.amount('net', 'netCents', STAFF_ADVANCE_MAX_CENTS, true)
    b.amount('pensionBase', 'pensionBaseCents', STAFF_ADVANCE_MAX_CENTS, true)
    return b
  },
}

/** Gövde alanı → form alanı (sunucu hatası ve core doğrulaması için). */
const BODY_TO_FORM: Readonly<Record<string, string>> = {
  amountCents: 'amount',
  claimCents: 'claim',
  rateBasisPoints: 'rate',
  remainingCents: 'remaining',
  netCents: 'net',
  pensionBaseCents: 'pensionBase',
}

/** Sunucu ya da core alan yolu → formda varsa alan adı. */
export function fieldOf(spec: DeductionFormSpec, path: string): string | null {
  const name = BODY_TO_FORM[path] ?? path
  return spec.fields.some((field) => field.name === name) ? name : null
}

/**
 * Formu doğrular: önce çeviri hataları, sonra core şeması. Gizli alanlar (personel) gövdede
 * vardır ama formda yoktur; onların hatası `root` olarak döner.
 */
export function validateDeductionForm(
  spec: DeductionFormSpec,
  values: FormValues,
): { body: Record<string, unknown>; errors: Record<string, string> } {
  const { body, errors } = spec.toBody(values)
  if (Object.keys(errors).length > 0) return { body, errors }
  const parsed = spec.schema.safeParse(body)
  if (parsed.success) return { body: parsed.data as Record<string, unknown>, errors }
  for (const issue of parsed.error.issues) {
    const field = fieldOf(spec, issue.path.join('.')) ?? 'root'
    errors[field] ??= issue.message
  }
  return { body, errors }
}
