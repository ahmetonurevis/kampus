// Yönetici ve ön büro Finans & Tahsilat ekranının saf görünüm mantığı (ON-123; ADR 0006,
// DOM-FIN-030…033). Taksit satırı ve tahsilat gövdesi web ile ortaktır
// (`@kampus/react-shared/finance-model.ts`), ödeme kuralları core'dadır (`lib/payments.ts`); burada
// yeniden yazılmaz, yalnız telefona çevrilir. Yetki ve kesin karar sunucudadır.
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { CollectionQuery, CollectionSort } from '@kampus/react-shared/collections.ts'
import { keepsIdempotencyKey } from '@kampus/react-shared/commands.ts'
import {
  INVOICE_STATUS_OPTIONS,
  isInvoiceStatusKey,
  recordPaymentBody,
  type InvoiceRow,
} from '@kampus/react-shared/finance-model.ts'
import {
  ALREADY_PAID_MESSAGE,
  PAYMENT_CHANGED_MESSAGE,
  type RecordPaymentBody,
  type usePaymentList,
} from '@kampus/react-shared/use-payment-commands.ts'
import { dateLabel, INVOICE_STATUS_LABELS, money } from '@kampus/school-core/lib/format.ts'
import {
  amountInputValue,
  PAYMENT_METHODS,
  paymentFormSchema,
  reversePaymentSchema,
  type PaymentMethod,
} from '@kampus/school-core/lib/payments.ts'
import { navigation } from '@kampus/school-core/modules/full-navigation.ts'
import { commandFailure, type FieldErrors } from './command-failure.ts'
import { API_PAGE_SIZE, type ListState } from './list-state.ts'
import { isModuleOpen, type MemberRole, type MobileSession } from './session-state.ts'

const day = (value: string) => dateLabel(value, { year: 'numeric' })

/** Rolün menü yolu: yönetici Finans & Tahsilat, ön büro Tahsilat Takibi (web aynı sayfa). */
const STAFF_PATHS: Partial<Record<MemberRole, string>> = {
  yonetici: 'finans',
  onburo: 'tahsilat-takip',
}

/**
 * Ekran açık mı: yalnız yönetici ve ön büro, finans modülü açıkken. Öğrenci ödemeleri telefonda
 * gösterilmez; veli finansı ayrı ekrandır. Kapalı modülde sunucu da 403 `module_disabled` döner.
 */
export function canOpenFinanceStaff(session: Pick<MobileSession, 'role' | 'modules'>): boolean {
  const path = STAFF_PATHS[session.role]
  if (path === undefined) return false
  const page = navigation[session.role].find((item) => item.path === path)
  return page !== undefined && isModuleOpen(session.modules, page.module)
}

/** Tahsilatı yalnız yönetici iptal eder (`payment.reverse`); kesin karar sunucuda. */
export const canReversePayment = (role: MemberRole) => role === 'yonetici'

/** `GET /finance/totals` kartları (web `FinancePage` ile aynı metinler); kuruş girer. */
export function financeTotalRows(totals: {
  totalCents: number
  paidCents: number
  remainingCents: number
  overdueCents: number
}): readonly (readonly [string, string])[] {
  return [
    ['Toplam eğitim bedeli', money(totals.totalCents)],
    ['Tahsil edilen', money(totals.paidCents)],
    ['Kalan bakiye', money(totals.remainingCents)],
    ['Gecikmiş tutar', money(totals.overdueCents)],
  ]
}

/** Vadeye göre, eşitlikte kimlik: web varsayılanı, sayfalar arası kararlı sıra. */
const INVOICE_SORT: readonly CollectionSort[] = ['dueDate', 'id']
const MIN_SEARCH = 2

const searchOf = (text: string) => {
  const q = text.trim()
  return q.length >= MIN_SEARCH ? { q } : {}
}

export const INVOICE_FILTER_OPTIONS = INVOICE_STATUS_OPTIONS.map(({ key, label }) => ({
  value: key,
  label,
}))

/** Taksit listesi sorgusu: arama (öğrenci adı, numara, sınıf) ve durum sunucuda uygulanır. */
export function invoiceListQuery(state: ListState, search: string): CollectionQuery {
  return {
    page: state.index + 1,
    pageSize: API_PAGE_SIZE,
    sort: INVOICE_SORT,
    ...searchOf(search),
    ...(isInvoiceStatusKey(state.filter)
      ? { filters: { status: INVOICE_STATUS_LABELS[state.filter] } }
      : {}),
  }
}

export interface InvoiceListItem {
  title: string
  subtitle: string
  amount: string
  status: string
  label: string
}

export function invoiceListItem(row: InvoiceRow): InvoiceListItem {
  const installment = `${String(row.installment)}. taksit`
  return {
    title: row.studentName,
    subtitle: `${row.className} · ${installment} · Vade ${day(row.dueDate)}`,
    amount: money(row.amount),
    status: row.status,
    label: `${row.studentName}, ${installment}, ${money(row.amount)}, ${row.status}, ayrıntıyı aç`,
  }
}

/** Taksit ayrıntısı (web `InvoiceSummaryPanel` ile aynı satırlar). */
export function invoiceFacts(row: InvoiceRow): readonly (readonly [string, string])[] {
  return [
    ['Öğrenci', row.studentName],
    ['Sınıf', row.className],
    ['Okul numarası', row.studentNumber],
    ['Taksit', `${String(row.installment)}. taksit`],
    ['Taksit tutarı', money(row.amount)],
    ['Durum', row.status],
    ['Vade tarihi', day(row.dueDate)],
    ['Tahsilat tarihi', row.paidAt ? day(row.paidAt) : 'Henüz tahsil edilmedi'],
    ['Ödeme yöntemi', row.paidAt ? (row.method ?? '—') : '—'],
    ['Kayıt numarası', row.id.toUpperCase()],
  ]
}

export interface PaymentFormInput {
  amount: string
  method: PaymentMethod
  reference: string
  paidDate: string
  bankAccountId: string
}
export type PaymentFormErrors = Partial<Record<keyof PaymentFormInput, string>>

/** Nakit yalnız kurum ayarı açıksa sunulur (ADR 0006 karar 7). */
export const paymentMethodsFor = (cashEnabled: boolean): readonly PaymentMethod[] =>
  PAYMENT_METHODS.filter((method) => method !== 'Nakit' || cashEnabled)

/** Taksitin kalan tutarı; kuruş. */
export const openAmount = (row: Pick<InvoiceRow, 'amount'>, paidCents: number) =>
  Math.max(row.amount - paidCents, 0)

/** Başlangıç değerleri (web `PaymentPanel`): tutar kalan kadar, gün bugün, ilk yöntem ve hesap. */
export function paymentFormDefaults(
  row: Pick<InvoiceRow, 'amount'>,
  paidCents: number,
  cashEnabled: boolean,
  accounts: readonly { id: string }[],
  today: string,
): PaymentFormInput {
  return {
    amount: amountInputValue(openAmount(row, paidCents)),
    method: paymentMethodsFor(cashEnabled)[0] ?? 'Banka havalesi',
    reference: '',
    paidDate: today,
    bankAccountId: accounts[0]?.id ?? '',
  }
}

/** Şema ile aynı metin (`payment_date_in_future`); tarih seçici ileri günü engellemez. */
export const FUTURE_PAID_DATE_MESSAGE = 'Ödeme tarihi ileri bir gün olamaz.'

export type PaymentCheck =
  { ok: true; body: RecordPaymentBody } | { ok: false; errors: PaymentFormErrors }

/** Form core şemasıyla istek atmadan denetlenir; geçerliyse gövde web ile aynı kuruludur. */
export function checkPaymentForm(
  invoice: Pick<InvoiceRow, 'id' | 'studentId'>,
  values: PaymentFormInput,
  today: string,
): PaymentCheck {
  const parsed = paymentFormSchema.safeParse(values)
  if (!parsed.success) {
    const errors: PaymentFormErrors = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof PaymentFormInput | undefined
      if (field !== undefined && errors[field] === undefined) errors[field] = issue.message
    }
    return { ok: false, errors }
  }
  if (parsed.data.paidDate > today)
    return { ok: false, errors: { paidDate: FUTURE_PAID_DATE_MESSAGE } }
  const body = recordPaymentBody(invoice, parsed.data, today)
  if (body === null) return { ok: false, errors: { amount: 'Tutarı kontrol edin.' } }
  return { ok: true, body }
}

const SERVER_FIELDS: Readonly<Record<string, keyof PaymentFormInput>> = {
  amountCents: 'amount',
  reference: 'reference',
  paidDate: 'paidDate',
  method: 'method',
  bankAccountId: 'bankAccountId',
}

export interface PaymentFailure {
  errors: PaymentFormErrors
  /** Formun altında gösterilecek genel mesaj. */
  message: string | null
  /**
   * Sonuç belirsiz (ağ, 5xx, aynı anahtar işleniyor): tahsilat yazılmış olabilir. Form kilitlenir,
   * yalnız aynı gövde aynı `Idempotency-Key` ile yeniden gönderilir; böylece mükerrer tahsilat olmaz.
   */
  uncertain: boolean
  /** Taksit başkası tarafından ödendi: form geçersizdir, kapanır (liste kancada tazelenir). */
  alreadyPaid: boolean
}

export function paymentFailure(error: ApiError, collected: FieldErrors = {}): PaymentFailure {
  const failure = commandFailure(error, { invoice_already_paid: ALREADY_PAID_MESSAGE }, collected)
  const errors: PaymentFormErrors = {}
  const unknown: string[] = []
  for (const [name, message] of Object.entries(failure.fields)) {
    const field = SERVER_FIELDS[name]
    if (field) errors[field] = message
    else unknown.push(message)
  }
  return {
    errors,
    message: failure.message ?? unknown[0] ?? null,
    uncertain: keepsIdempotencyKey(error),
    alreadyPaid: error.code === 'invoice_already_paid',
  }
}

export type PaymentRecord = NonNullable<ReturnType<typeof usePaymentList>['data']>['data'][number]

export interface PaymentFilters {
  method: PaymentMethod | ''
  mebbisPending: boolean
  /** Ödeme günü aralığı (`YYYY-AA-GG`, Europe/Istanbul, uçlar dahil; ON-118). */
  from: string
  to: string
}
export const NO_PAYMENT_FILTERS: PaymentFilters = {
  method: '',
  mebbisPending: false,
  from: '',
  to: '',
}

const FILTER_SEPARATOR = '|'
const isPaymentMethod = (value: string | undefined): value is PaymentMethod =>
  (PAYMENT_METHODS as readonly (string | undefined)[]).includes(value)

/**
 * Liste belleğinde tek süzgeç metni vardır (`list-state.ts`); dört alan tek metne yazılır ki herhangi
 * biri değişince sayfa başa dönsün. Süzgeç yoksa boş metindir, "Filtreleri temizle" onu boşaltır.
 */
export function writePaymentFilters(filters: PaymentFilters): string {
  const text = [
    filters.method,
    filters.mebbisPending ? 'pending' : '',
    filters.from,
    filters.to,
  ].join(FILTER_SEPARATOR)
  return text.replaceAll(FILTER_SEPARATOR, '') === '' ? '' : text
}

export function readPaymentFilters(text: string): PaymentFilters {
  const [method, mebbis, from, to] = text.split(FILTER_SEPARATOR)
  return {
    method: isPaymentMethod(method) ? method : '',
    mebbisPending: mebbis === 'pending',
    from: from ?? '',
    to: to ?? '',
  }
}

export const REVERSED_RANGE_MESSAGE = 'Bitiş günü başlangıç gününden önce olamaz.'

export const isReversedRange = ({ from, to }: Pick<PaymentFilters, 'from' | 'to'>) =>
  from !== '' && to !== '' && to < from

/** Tahsilat listesi sorgusu (web `PaymentsSection`): en yeni önce, ters aralık gönderilmez. */
export function paymentListQuery(state: ListState, search: string) {
  const filters = readPaymentFilters(state.filter)
  const reversed = isReversedRange(filters)
  return {
    page: state.index + 1,
    pageSize: API_PAGE_SIZE,
    ...searchOf(search),
    ...(filters.mebbisPending ? { mebbis: 'pending' as const } : {}),
    ...(filters.method ? { method: filters.method } : {}),
    ...(filters.from && !reversed ? { dateFrom: filters.from } : {}),
    ...(filters.to && !reversed ? { dateTo: filters.to } : {}),
  }
}

export const paymentReceipt = (
  payment: Pick<PaymentRecord, 'receiptYear' | 'receiptNumber'>,
): string => `${String(payment.receiptYear)}-${String(payment.receiptNumber)}`

export const paymentStatus = (payment: Pick<PaymentRecord, 'reversedAt'>) =>
  payment.reversedAt === null ? 'Geçerli' : 'İptal edildi'

export function paymentListItem(payment: PaymentRecord): InvoiceListItem {
  const name = payment.studentName ?? '—'
  const status = paymentStatus(payment)
  return {
    title: name,
    subtitle: `${day(payment.paidAt)} · ${payment.method} · Dekont ${paymentReceipt(payment)}`,
    amount: money(payment.amountCents),
    status,
    label: `${name}, ${money(payment.amountCents)}, ${day(payment.paidAt)}, ${status}, ayrıntıyı aç`,
  }
}

/** Tahsilat ayrıntısı (web tablosunun sütunları); iptal edilende MEBBİS satırı anlamsızdır. */
export function paymentFacts(payment: PaymentRecord): readonly (readonly [string, string])[] {
  const reversed = payment.reversedAt !== null
  return [
    ['Öğrenci', payment.studentName ?? '—'],
    ['Tutar', money(payment.amountCents)],
    ...(payment.creditCents > 0 ? [['İade alacağı', money(payment.creditCents)] as const] : []),
    ['Ödeme tarihi', day(payment.paidAt)],
    ['Dekont no', paymentReceipt(payment)],
    ['Yöntem', payment.method],
    ['İşlem referansı', payment.reference ?? '—'],
    ['Banka hesabı', payment.bankAccountLabel ?? '—'],
    [
      'MEBBİS',
      reversed
        ? '—'
        : payment.mebbisRecordedAt === null
          ? 'İşlenmedi'
          : day(payment.mebbisRecordedAt),
    ],
    ['Durum', paymentStatus(payment)],
    ...(reversed && payment.reversedAt !== null
      ? [
          ['İptal tarihi', day(payment.reversedAt)] as const,
          ['İptal gerekçesi', payment.reversalReason ?? '—'] as const,
        ]
      : []),
  ]
}

export const mebbisActionLabel = (payment: Pick<PaymentRecord, 'mebbisRecordedAt'>) =>
  payment.mebbisRecordedAt === null ? 'MEBBİS’e işlendi' : 'İşareti kaldır'

/** İptal gerekçesi core şemasıyla denetlenir; hata metni boş dönerse geçerlidir. */
export function reverseReasonError(reason: string): string | null {
  const parsed = reversePaymentSchema.safeParse({ reason })
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Gerekçeyi kontrol edin.')
}

/** İptal ve MEBBİS komutunun form içi hata mesajı; sürüm çakışması ve belirsiz sonuç ayrı anlatılır. */
export function paymentCommandFailure(error: ApiError, collected: FieldErrors = {}) {
  const failure = commandFailure(error, { version_conflict: PAYMENT_CHANGED_MESSAGE }, collected)
  return {
    reason: failure.fields.reason,
    message: failure.message,
    uncertain: keepsIdempotencyKey(error),
    /** Çakışma: ekrandaki kayıt eskidi, kanca listeyi tazeledi; form kapanır. */
    conflict: error.status === 409 && !keepsIdempotencyKey(error),
  }
}
