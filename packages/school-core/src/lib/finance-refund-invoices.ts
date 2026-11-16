import { z } from 'zod'

import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'

/**
 * İade faturası ve iptal isteği (docs/domain/finans.md DOM-FIN-096; ON-266; IST-110, IST-112).
 * Ödenmiş ayrılış iadesinin (DOM-FIN-041) tahsilatı faturalandıysa muhasebe iade için bir belge
 * hazırlar: asıl fatura iptal penceresindeyse ve iade faturanın tamamıysa **iptal isteği**, değilse
 * asıl faturaya numara ve tarihle bağlı **iade faturası** (K-292). Asıl fatura Kampüs dışında
 * (entegratör ya da muhasebe programı) kesildiği için numarası, tarihi, türü, KDV dahil tutarı ve
 * KDV oranı elle girilir; belge tutarı iade tutarını ve asıl fatura tutarını aşamaz, KDV oranı asıl
 * faturadandır (K-293). Durum taslak → gönderime hazır → gönderildi (iade faturası) ya da iptal
 * edildi (iptal isteği); entegratör bağlantısı (IST-112) olmadığı için belge "hazır"da kalır, CSV
 * ile dışa aktarılır ve sonuç elle işlenir (K-294). Fonksiyonlar saftır; gün `today` ile gelir.
 * Pencere ve belge türü **doğrulanmalı** (H-35, H-36, M-32, M-33).
 */

/** Belgeyi hazırlayan ve işleyen roller (K-295); muhasebe rolü (OG-110) açılınca listeye girer. */
export const REFUND_INVOICE_ROLES = ['yonetici'] as const

export const REFUND_DOCUMENT_KINDS = ['cancellation', 'return_invoice'] as const
export type RefundDocumentKind = (typeof REFUND_DOCUMENT_KINDS)[number]
export const REFUND_DOCUMENT_KIND_LABELS: Readonly<Record<RefundDocumentKind, string>> = {
  cancellation: 'İptal isteği',
  return_invoice: 'İade faturası',
}

/** `sent` yalnız iade faturasının, `cancelled` yalnız iptal isteğinin son durumudur (K-294). */
export const REFUND_DOCUMENT_STATUSES = ['draft', 'ready', 'sent', 'cancelled'] as const
export type RefundDocumentStatus = (typeof REFUND_DOCUMENT_STATUSES)[number]
export const REFUND_DOCUMENT_STATUS_LABELS: Readonly<Record<RefundDocumentStatus, string>> = {
  draft: 'Taslak',
  ready: 'Gönderime hazır',
  sent: 'Gönderildi',
  cancelled: 'İptal edildi',
}

export const ORIGINAL_INVOICE_TYPES = ['e_archive', 'e_invoice'] as const
export type OriginalInvoiceType = (typeof ORIGINAL_INVOICE_TYPES)[number]
export const ORIGINAL_INVOICE_TYPE_LABELS: Readonly<Record<OriginalInvoiceType, string>> = {
  e_archive: 'e-Arşiv fatura',
  e_invoice: 'e-Fatura',
}

/**
 * İptal penceresi, asıl fatura gününden sonraki takvim günü (K-292; **doğrulanmalı**, H-35, M-32):
 * e-Arşivde GİB portalındaki iptal süresi varsayımı 7 gün, e-Faturada alıcının itiraz (ret) süresi
 * TTK md. 21/2 varsayımıyla 8 gün. Son gün dahildir.
 */
export const REFUND_CANCEL_WINDOW_DAYS: Readonly<Record<OriginalInvoiceType, number>> = {
  e_archive: 7,
  e_invoice: 8,
}

/** KDV oranı on binde birlik (ücret tarifesiyle aynı birim; M-03): %0, %1, %10, %20. */
export const REFUND_VAT_RATES = [0, 100, 1000, 2000] as const
export type RefundVatRate = (typeof REFUND_VAT_RATES)[number]

/** Tek belgenin üst sınırı: 100 milyon TL (kuruş). */
export const REFUND_INVOICE_AMOUNT_MAX = 10_000_000_000
export const REFUND_INVOICE_NOTE_MAX = 500
export const REFUND_INVOICE_DISCARD_REASON_MIN = 5
export const REFUND_INVOICE_DISCARD_REASON_MAX = 500

/**
 * GİB fatura numarası: 3 karakter seri (büyük harf ya da rakam), 4 hane yıl, 9 hane sıra; toplam
 * 16 karakter. Yıl faturanın gününün yılıdır.
 */
const INVOICE_NUMBER = /^[A-Z0-9]{3}(\d{4})\d{9}$/

const yearOf = (day: string) => day.slice(0, 4)

const invoiceNumberSchema = z
  .string('Fatura numarasını girin.')
  .trim()
  .toUpperCase()
  .regex(
    INVOICE_NUMBER,
    'Fatura numarası 16 karakterdir: 3 karakter seri, 4 hane yıl ve 9 hane sıra (ör. ABC2026000000001).',
  )

const amountSchema = (message: string) =>
  z
    .number(message)
    .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
    .positive('Tutar sıfırdan büyük olmalıdır.')
    .max(REFUND_INVOICE_AMOUNT_MAX, 'Tutar çok büyük.')

const originalInvoiceSchema = z
  .object({
    number: invoiceNumberSchema,
    date: daySchema,
    type: z.enum(ORIGINAL_INVOICE_TYPES, 'Asıl faturanın türünü seçin.'),
    totalCents: amountSchema('Asıl faturanın KDV dahil tutarını girin.'),
    vatRateBasisPoints: z.literal(REFUND_VAT_RATES, {
      error: 'KDV oranı %0, %1, %10 ya da %20 olur.',
    }),
  })
  .superRefine((value, context) => {
    const match = INVOICE_NUMBER.exec(value.number)
    if (match !== null && match[1] !== yearOf(value.date))
      context.addIssue({
        code: 'custom',
        path: ['number'],
        message: 'Fatura numarasındaki yıl fatura tarihinin yılıyla aynı olmalıdır.',
      })
  })

const noteSchema = z
  .string()
  .trim()
  .max(REFUND_INVOICE_NOTE_MAX, `En fazla ${String(REFUND_INVOICE_NOTE_MAX)} karakter girin.`)
  .nullable()
  .optional()
  .transform((value) => (value === undefined || value === null || value === '' ? null : value))

/**
 * Taslak girdisi. `kind` verilmezse önerilen tür yazılır (`suggestRefundDocumentKind`); iade
 * faturası her zaman seçilebilir, iptal isteği yalnız pencerede ve tam iadede (K-292).
 */
export const createRefundInvoiceSchema = z.strictObject({
  withdrawalId: z.uuid('Ayrılış kaydı geçersiz.'),
  kind: z.enum(REFUND_DOCUMENT_KINDS, 'Belge türünü seçin.').optional(),
  originalInvoice: originalInvoiceSchema,
  amountCents: amountSchema('Belge tutarını (KDV dahil) girin.'),
  note: noteSchema,
})
export type CreateRefundInvoiceInput = z.input<typeof createRefundInvoiceSchema>

/** Sonucun işlenmesi: entegratör portalında yapılan işlemin günü; iade faturasında numarası. */
export const completeRefundInvoiceSchema = z.strictObject({
  completedDate: daySchema,
  documentNumber: invoiceNumberSchema.optional(),
})
export type CompleteRefundInvoiceInput = z.input<typeof completeRefundInvoiceSchema>

export const discardRefundInvoiceSchema = z.strictObject({
  reason: z
    .string('Vazgeçme gerekçesini girin.')
    .trim()
    .min(
      REFUND_INVOICE_DISCARD_REASON_MIN,
      `Gerekçe en az ${String(REFUND_INVOICE_DISCARD_REASON_MIN)} karakter olmalıdır.`,
    )
    .max(
      REFUND_INVOICE_DISCARD_REASON_MAX,
      `Gerekçe en fazla ${String(REFUND_INVOICE_DISCARD_REASON_MAX)} karakter olabilir.`,
    ),
})
export type DiscardRefundInvoiceInput = z.input<typeof discardRefundInvoiceSchema>

// --- Hesap -------------------------------------------------------------------------------------

const DAY = 86_400_000
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00.000Z`) / DAY)

/** İki gün arasındaki takvim günü (`to - from`). */
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from)

/** İptal penceresinin son günü (dahil): asıl fatura günü + pencere (K-292). */
export function cancelWindowEndsOn(original: { date: string; type: OriginalInvoiceType }): string {
  const end = new Date((dayNumber(original.date) + REFUND_CANCEL_WINDOW_DAYS[original.type]) * DAY)
  return end.toISOString().slice(0, 10)
}

export const inCancelWindow = (
  original: { date: string; type: OriginalInvoiceType },
  day: string,
) => day <= cancelWindowEndsOn(original)

/**
 * Önerilen belge (K-292): iade asıl faturanın tamamıysa ve gün pencere içindeyse iptal isteği,
 * değilse iade faturası. Kısmi iade iptalle yapılamaz; fatura kısmen iptal edilmez.
 */
export function suggestRefundDocumentKind(input: {
  original: { date: string; type: OriginalInvoiceType; totalCents: number }
  amountCents: number
  today: string
}): RefundDocumentKind {
  return input.amountCents === input.original.totalCents &&
    inCancelWindow(input.original, input.today)
    ? 'cancellation'
    : 'return_invoice'
}

/**
 * KDV dahil tutarı KDV hariç tutar ve KDV'ye ayırır (K-293): net = tutar / (1 + oran), kuruşa en
 * yakın; KDV kalandır, toplam her zaman tutara eşittir.
 */
export function splitVat(
  totalCents: number,
  vatRateBasisPoints: number,
): { netCents: number; vatCents: number } {
  const netCents = Math.round((totalCents * 10_000) / (10_000 + vatRateBasisPoints))
  return { netCents, vatCents: totalCents - netCents }
}

// --- Kurallar ----------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string[]) =>
  new DomainError(code, message, path === undefined ? {} : { path })

/** Belgenin dayandığı iade (DOM-FIN-041). */
export interface RefundInvoiceWithdrawal {
  refundCents: number
  refundPaidDate: string | null
}

/** Saklanan belgenin kuralların okuduğu alanları. */
export interface RefundInvoiceRecord {
  kind: RefundDocumentKind
  status: RefundDocumentStatus
  originalInvoiceNumber: string
  originalInvoiceDate: string
  originalInvoiceType: OriginalInvoiceType
}

export interface RefundInvoicePlan {
  kind: RefundDocumentKind
  originalInvoice: {
    number: string
    date: string
    type: OriginalInvoiceType
    totalCents: number
    vatRateBasisPoints: RefundVatRate
  }
  amountCents: number
  netCents: number
  vatCents: number
  note: string | null
}

/**
 * Yeni taslak (K-292, K-293). İade ödenmiş olmalı; aynı iade için arşivlenmemiş ikinci belge
 * açılmaz (409 `refund_invoice_exists`; veritabanında kısmi tekil indeksle de korunur).
 */
export function planRefundInvoice(
  input: unknown,
  context: {
    withdrawal: RefundInvoiceWithdrawal
    /** İadenin arşivlenmemiş belgesi var mı. */
    hasActiveDocument: boolean
    today: string
  },
): RefundInvoicePlan {
  const data = createRefundInvoiceSchema.parse(input)
  const { withdrawal, today } = context
  if (withdrawal.refundCents === 0)
    throw ruleError('refund_invoice_no_refund', 'Bu ayrılışta iade yok; belge hazırlanmaz.')
  if (withdrawal.refundPaidDate === null)
    throw ruleError(
      'refund_invoice_refund_not_paid',
      'İade ödenmeden iade faturası ya da iptal isteği hazırlanmaz.',
    )
  if (context.hasActiveDocument)
    throw new DomainError(
      'refund_invoice_exists',
      'Bu iade için hazırlanmış bir belge var. Yeni belge için önce ondan vazgeçin.',
      { kind: 'conflict' },
    )
  const original = data.originalInvoice
  if (original.date > today)
    throw ruleError(
      'refund_invoice_original_date_future',
      'Asıl fatura tarihi bugünden sonra olamaz.',
      ['originalInvoice', 'date'],
    )
  if (original.date > withdrawal.refundPaidDate)
    throw ruleError(
      'refund_invoice_original_after_refund',
      'Asıl fatura iadenin ödendiği günden sonra kesilmiş olamaz.',
      ['originalInvoice', 'date'],
    )
  if (data.amountCents > withdrawal.refundCents)
    throw ruleError('refund_invoice_amount_exceeds_refund', 'Belge tutarı iade tutarını aşamaz.', [
      'amountCents',
    ])
  if (data.amountCents > original.totalCents)
    throw ruleError(
      'refund_invoice_amount_exceeds_invoice',
      'Belge tutarı asıl faturanın tutarını aşamaz.',
      ['amountCents'],
    )
  const kind =
    data.kind ?? suggestRefundDocumentKind({ original, amountCents: data.amountCents, today })
  if (kind === 'cancellation') assertCancellable(original, data.amountCents, today)
  return {
    kind,
    originalInvoice: original,
    amountCents: data.amountCents,
    ...splitVat(data.amountCents, original.vatRateBasisPoints),
    note: data.note,
  }
}

function assertCancellable(
  original: { date: string; type: OriginalInvoiceType; totalCents: number },
  amountCents: number,
  day: string,
) {
  if (amountCents !== original.totalCents)
    throw ruleError(
      'refund_invoice_cancel_partial',
      'Fatura kısmen iptal edilmez; kısmi iade için iade faturası hazırlayın.',
      ['kind'],
    )
  if (!inCancelWindow(original, day))
    throw ruleError(
      'refund_invoice_cancel_window_closed',
      'Asıl faturanın iptal süresi geçti; iade faturası hazırlayın.',
      ['kind'],
    )
}

const windowOf = (record: RefundInvoiceRecord) => ({
  date: record.originalInvoiceDate,
  type: record.originalInvoiceType,
})

/**
 * Taslağı gönderime hazır işaretler (K-294). İptal isteğinde pencere yeniden denetlenir: süre
 * geçtiyse belge hazırlanamaz, vazgeçilip iade faturası açılır.
 */
export function planRefundInvoiceReady(record: RefundInvoiceRecord, today: string): void {
  if (record.status !== 'draft')
    throw ruleError('refund_invoice_not_draft', 'Yalnız taslak belge gönderime hazır işaretlenir.')
  if (record.kind === 'cancellation' && !inCancelWindow(windowOf(record), today))
    throw ruleError(
      'refund_invoice_cancel_window_closed',
      'Asıl faturanın iptal süresi geçti; bu belgeden vazgeçip iade faturası hazırlayın.',
    )
}

/**
 * Entegratör portalındaki sonucun işlenmesi (K-294): iade faturası numarasıyla "gönderildi", iptal
 * isteği "iptal edildi" olur. Gün asıl faturadan önce ve bugünden sonra olamaz; iptal pencere
 * içinde yapılmış olmalıdır.
 */
export function planRefundInvoiceComplete(
  record: RefundInvoiceRecord,
  input: unknown,
  today: string,
): { status: 'sent' | 'cancelled'; completedDate: string; documentNumber: string | null } {
  const data = completeRefundInvoiceSchema.parse(input)
  if (record.status !== 'ready')
    throw ruleError('refund_invoice_not_ready', 'Yalnız gönderime hazır belgenin sonucu işlenir.')
  if (data.completedDate > today)
    throw ruleError('refund_invoice_completed_date_future', 'İşlem günü bugünden sonra olamaz.', [
      'completedDate',
    ])
  if (data.completedDate < record.originalInvoiceDate)
    throw ruleError(
      'refund_invoice_completed_before_original',
      'İşlem günü asıl fatura tarihinden önce olamaz.',
      ['completedDate'],
    )
  if (record.kind === 'cancellation') {
    if (data.documentNumber !== undefined)
      throw ruleError(
        'refund_invoice_number_not_applicable',
        'İptal isteğinde yeni fatura numarası girilmez.',
        ['documentNumber'],
      )
    if (!inCancelWindow(windowOf(record), data.completedDate))
      throw ruleError(
        'refund_invoice_cancel_window_closed',
        'İptal, asıl faturanın iptal süresi içinde yapılmış olmalıdır.',
        ['completedDate'],
      )
    return { status: 'cancelled', completedDate: data.completedDate, documentNumber: null }
  }
  if (data.documentNumber === undefined)
    throw ruleError('refund_invoice_number_required', 'İade faturasının numarasını girin.', [
      'documentNumber',
    ])
  if (data.documentNumber.slice(3, 7) !== yearOf(data.completedDate))
    throw ruleError(
      'refund_invoice_number_year_mismatch',
      'Fatura numarasındaki yıl işlem gününün yılıyla aynı olmalıdır.',
      ['documentNumber'],
    )
  if (data.documentNumber === record.originalInvoiceNumber)
    throw ruleError(
      'refund_invoice_number_same_as_original',
      'İade faturasının numarası asıl faturanınkiyle aynı olamaz.',
      ['documentNumber'],
    )
  return { status: 'sent', completedDate: data.completedDate, documentNumber: data.documentNumber }
}

/** Taslaktan ya da hazır belgeden gerekçeyle vazgeçilir; sonucu işlenmiş belge değişmez (K-294). */
export function planRefundInvoiceDiscard(
  record: Pick<RefundInvoiceRecord, 'status'>,
  input: unknown,
): { reason: string } {
  const { reason } = discardRefundInvoiceSchema.parse(input)
  if (record.status === 'sent' || record.status === 'cancelled')
    throw ruleError(
      'refund_invoice_completed',
      'Sonucu işlenmiş belgeden vazgeçilmez; gerekirse yeni belgeyi entegratörde düzenleyin.',
    )
  return { reason }
}

/** Oturumdaki kullanıcının belgede yapabilecekleri (K-295). */
export function refundInvoiceActions(
  record: Pick<RefundInvoiceRecord, 'status'>,
  actor: { role: string },
): { ready: boolean; complete: boolean; discard: boolean } {
  const allowed = (REFUND_INVOICE_ROLES as readonly string[]).includes(actor.role)
  return {
    ready: allowed && record.status === 'draft',
    complete: allowed && record.status === 'ready',
    discard: allowed && (record.status === 'draft' || record.status === 'ready'),
  }
}

// --- Dışa aktarım ------------------------------------------------------------------------------

/** CSV satırı: entegratör portalına elle girilecek alanlar (K-294). */
export interface RefundInvoiceCsvRow {
  kind: RefundDocumentKind
  status: RefundDocumentStatus
  studentName: string | null
  withdrawalDate: string
  refundPaidDate: string | null
  refundCents: number
  originalInvoice: {
    number: string
    date: string
    type: OriginalInvoiceType
    totalCents: number
    vatRateBasisPoints: number
  }
  amountCents: number
  netCents: number
  vatCents: number
  documentNumber: string | null
  completedDate: string | null
  note: string | null
}

const percent = (basisPoints: number) =>
  `${String(Math.floor(basisPoints / 100))}${basisPoints % 100 === 0 ? '' : `,${String(basisPoints % 100).padStart(2, '0')}`}`

const REFUND_INVOICE_CSV_HEADER = [
  'Belge türü',
  'Durum',
  'Öğrenci',
  'Ayrılış günü',
  'İade ödeme günü',
  'İade tutarı',
  'Asıl fatura türü',
  'Asıl fatura no',
  'Asıl fatura tarihi',
  'Asıl fatura tutarı (KDV dahil)',
  'KDV oranı (%)',
  'Belge tutarı (KDV dahil)',
  'KDV hariç',
  'KDV',
  'İade faturası no',
  'İşlem günü',
  'Not',
]

/**
 * Belge listesinin CSV'si (K-294): `;` ayırıcı, ondalık virgül, formül kaçışı (`csv.ts`). Alıcının
 * kimliği ve iletişimi yazılmaz; asıl fatura numarası entegratördeki alıcıyı bulmaya yeter (K-295).
 */
export function refundInvoicesCsv(rows: readonly RefundInvoiceCsvRow[]): string {
  const lines = [
    REFUND_INVOICE_CSV_HEADER.map(csvCell),
    ...rows.map((row) => [
      csvCell(REFUND_DOCUMENT_KIND_LABELS[row.kind]),
      csvCell(REFUND_DOCUMENT_STATUS_LABELS[row.status]),
      csvCell(row.studentName ?? ''),
      csvCell(row.withdrawalDate),
      csvCell(row.refundPaidDate ?? ''),
      csvAmount(row.refundCents),
      csvCell(ORIGINAL_INVOICE_TYPE_LABELS[row.originalInvoice.type]),
      csvCell(row.originalInvoice.number),
      csvCell(row.originalInvoice.date),
      csvAmount(row.originalInvoice.totalCents),
      percent(row.originalInvoice.vatRateBasisPoints),
      csvAmount(row.amountCents),
      csvAmount(row.netCents),
      csvAmount(row.vatCents),
      csvCell(row.documentNumber ?? ''),
      csvCell(row.completedDate ?? ''),
      csvCell(row.note ?? ''),
    ]),
  ]
  return lines.map((line) => line.join(CSV_SEPARATOR)).join('\r\n')
}
