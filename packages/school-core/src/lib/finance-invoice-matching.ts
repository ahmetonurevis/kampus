import { z } from 'zod'

import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { DomainError } from './errors.ts'
import {
  PURCHASE_ITEM_NAME_MAX,
  PURCHASE_QUANTITY_MAX,
  PURCHASE_UNIT_LABELS,
  PURCHASE_UNIT_PRICE_MAX_CENTS,
  type PurchaseUnit,
} from './finance-purchase-requests.ts'
import { money } from './format.ts'

/**
 * Tedarikçi faturası üçlü eşleştirmesi (docs/domain/finans.md DOM-FIN-095; ON-277). Siparişe bağlı
 * faturanın (`DOM-FIN-076`) kalemleri siparişin kalemlerine (`DOM-FIN-073`) bağlanır; her kalemde
 * sipariş miktarı ve KDV hariç birim fiyatı, mal kabulde (`DOM-FIN-074`) kabul edilen miktar ve
 * faturalanan miktar ve fiyat karşılaştırılır. Sonuç saklanmaz, her okumada kabul ve faturalardan
 * hesaplanır (kabul sonradan gelirse fatura kendiliğinden eşleşir). Eşleşmeyen faturanın ödemesi
 * yöneticinin gerekçeli fark onayını ister (K-280…K-283). e-Fatura otomatik alımı kapsam dışıdır:
 * kalemler elle girilir. Fonksiyonlar saftır; tutarlar kuruştur.
 */

export const INVOICE_MATCH_STATUSES = [
  'matched',
  'quantity_mismatch',
  'price_mismatch',
  'unmatched',
] as const
export type InvoiceMatchStatus = (typeof INVOICE_MATCH_STATUSES)[number]
/** Onaylanabilen sapmalar: eşleşme dışındaki durumlar. */
export const INVOICE_MISMATCH_STATUSES = [
  'quantity_mismatch',
  'price_mismatch',
  'unmatched',
] as const satisfies readonly InvoiceMatchStatus[]
export type InvoiceMismatchStatus = (typeof INVOICE_MISMATCH_STATUSES)[number]

export const INVOICE_MATCH_STATUS_LABELS = {
  matched: 'Eşleşti',
  quantity_mismatch: 'Miktar farkı',
  price_mismatch: 'Fiyat farkı',
  unmatched: 'Siparişte yok',
} as const satisfies Record<InvoiceMatchStatus, string>

/**
 * Fiyat toleransı (K-281): kalemde birim fiyat farkının kalem tutarına etkisi en çok 1 TL ise kalem
 * eşleşmiş sayılır (kuruş yuvarlaması). Kurum ayarı bugün yoktur; ayar gelirse bu değer varsayılan
 * olur.
 */
export const INVOICE_MATCH_PRICE_TOLERANCE_CENTS = 100
/** Kalemlerin KDV hariç toplamı ile faturanın KDV hariç tutarı arasındaki en büyük fark (K-280). */
export const INVOICE_LINES_TOTAL_TOLERANCE_CENTS = 100
export const INVOICE_LINES_MAX = 100
export const INVOICE_LINE_DESCRIPTION_MIN = 2
export const INVOICE_LINE_DESCRIPTION_MAX = PURCHASE_ITEM_NAME_MAX
export const INVOICE_MATCH_REASON_MIN = 5
export const INVOICE_MATCH_REASON_MAX = 500

/** Ödemede eşleşmeyen faturanın uyarısı (409; K-282). */
export const INVOICE_MISMATCH_PAYMENT_WARNING = 'supplier_payment_invoice_mismatch_warning'

// --- Şemalar -------------------------------------------------------------------------------------

/**
 * Fatura kalemi (K-280): sipariş kalemine bağlı (`orderItemId`) ya da siparişte olmayan kalem
 * (`orderItemId: null`, ad zorunlu). Miktar tam sayıdır (sipariş birimiyle), birim fiyat KDV
 * hariçtir. Sipariş kalemine bağlı satırda ad sipariş kaleminden gelir; gövdedeki ad yok sayılır.
 */
export const supplierInvoiceLineSchema = z
  .strictObject({
    orderItemId: z.uuid('Sipariş kalemi geçersiz.').nullable().default(null),
    description: z
      .string('Kalem adını yazın.')
      .trim()
      .max(
        INVOICE_LINE_DESCRIPTION_MAX,
        `En fazla ${String(INVOICE_LINE_DESCRIPTION_MAX)} karakter girebilirsiniz.`,
      )
      .nullable()
      .default(null)
      .transform((value) => (value === '' ? null : value)),
    quantity: z
      .number('Faturalanan miktarı girin.')
      .int('Miktar tam sayı olmalıdır.')
      .min(1, 'Miktar en az 1 olmalıdır.')
      .max(PURCHASE_QUANTITY_MAX, 'Miktar çok büyük.'),
    unitPriceCents: z
      .number('KDV hariç birim fiyatı girin.')
      .int('Tutarı kuruş cinsinden tam sayı girin.')
      .min(1, 'Birim fiyat sıfırdan büyük olmalıdır.')
      .max(PURCHASE_UNIT_PRICE_MAX_CENTS, 'Birim fiyat çok büyük.'),
  })
  .superRefine((line, context) => {
    if (line.orderItemId !== null) return
    if (line.description === null || line.description.length < INVOICE_LINE_DESCRIPTION_MIN)
      context.addIssue({
        code: 'custom',
        path: ['description'],
        message: 'Siparişte olmayan kalemin adını en az 2 karakterle yazın.',
      })
  })
  .transform((line) => ({
    ...line,
    description: line.orderItemId === null ? line.description : null,
  }))
export type SupplierInvoiceLineInput = z.input<typeof supplierInvoiceLineSchema>
export type SupplierInvoiceLine = z.output<typeof supplierInvoiceLineSchema>

export const supplierInvoiceLinesSchema = z
  .array(supplierInvoiceLineSchema, 'Fatura kalemlerini girin.')
  .min(1, 'Siparişe bağlı faturada en az bir kalem girin.')
  .max(INVOICE_LINES_MAX, `En fazla ${String(INVOICE_LINES_MAX)} kalem girilebilir.`)
  .superRefine((lines, context) => {
    const seen = new Set<string>()
    lines.forEach((line, index) => {
      if (line.orderItemId === null) return
      if (seen.has(line.orderItemId))
        context.addIssue({
          code: 'custom',
          path: [index, 'orderItemId'],
          message: 'Bir sipariş kalemi faturada bir kez yazılır.',
        })
      seen.add(line.orderItemId)
    })
  })

/** Fark onayı (K-282): gerekçe 5–500 karakter. */
export const approveInvoiceMatchSchema = z.strictObject({
  reason: z
    .string('Onay gerekçesini yazın.')
    .trim()
    .min(INVOICE_MATCH_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      INVOICE_MATCH_REASON_MAX,
      `En fazla ${String(INVOICE_MATCH_REASON_MAX)} karakter girebilirsiniz.`,
    ),
})
export type ApproveInvoiceMatchInput = z.input<typeof approveInvoiceMatchSchema>

/** Eşleşmeyen faturalar listesi süzgeci; `mismatched` eşleşme dışındaki bütün durumlardır. */
export const INVOICE_MATCH_FILTERS = ['mismatched', ...INVOICE_MATCH_STATUSES] as const
export type InvoiceMatchFilter = (typeof INVOICE_MATCH_FILTERS)[number]
export const INVOICE_MATCH_APPROVAL_FILTERS = ['pending', 'approved'] as const
export type InvoiceMatchApprovalFilter = (typeof INVOICE_MATCH_APPROVAL_FILTERS)[number]

// --- Giriş denetimi ------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string[]) =>
  new DomainError(code, message, { kind: 'rule', ...(path ? { path } : {}) })

/** Kalemlerin KDV hariç toplamı: miktar × birim fiyat. */
export const invoiceLinesNetCents = (
  lines: readonly Pick<SupplierInvoiceLine, 'quantity' | 'unitPriceCents'>[],
) => lines.reduce((total, line) => total + line.quantity * line.unitPriceCents, 0)

/**
 * Kalem girişi (K-280): sipariş kalemine bağlı satır o siparişin kalemi olmalı; kalemlerin KDV
 * hariç toplamı faturanın KDV hariç tutarından en çok 1 TL sapar. Sapma (miktar, fiyat, siparişte
 * olmayan kalem) girişte reddedilmez; eşleştirmede görünür ve ödemede onay ister.
 */
export function checkSupplierInvoiceLines(
  lines: readonly SupplierInvoiceLine[],
  context: { orderItemIds: readonly string[]; netCents: number },
): SupplierInvoiceLine[] {
  const known = new Set(context.orderItemIds)
  const foreign = lines.findIndex(
    (line) => line.orderItemId !== null && !known.has(line.orderItemId),
  )
  if (foreign >= 0)
    throw ruleError(
      'supplier_invoice_line_item_not_in_order',
      'Kalem bu siparişin kalemi değil; siparişin kalemlerinden birini seçin.',
      ['lines', String(foreign), 'orderItemId'],
    )
  const total = invoiceLinesNetCents(lines)
  if (Math.abs(total - context.netCents) > INVOICE_LINES_TOTAL_TOLERANCE_CENTS)
    throw ruleError(
      'supplier_invoice_lines_total_mismatch',
      `Kalemlerin KDV hariç toplamı (${money(total)}) faturanın KDV hariç tutarına (${money(context.netCents)}) eşit olmalıdır.`,
      ['lines'],
    )
  return [...lines]
}

// --- Eşleştirme ----------------------------------------------------------------------------------

export interface MatchOrderItem {
  id: string
  name: string
  unit: PurchaseUnit
  quantity: number
  /** Siparişteki KDV hariç birim fiyat, kuruş. */
  unitPriceCents: number
}

export interface MatchInvoiceLine {
  orderItemId: string | null
  description: string | null
  quantity: number
  unitPriceCents: number
}

export interface MatchInvoice {
  id: string
  invoiceDate: string
  /** Giriş anı (ISO UTC); aynı gündeki faturaların sırası. */
  createdAt: string
  cancelled: boolean
  lines: readonly MatchInvoiceLine[]
  /** Onaylanmış sapma; yoksa `null`. */
  approvedStatus: InvoiceMismatchStatus | null
}

export interface InvoiceMatchLine {
  orderItemId: string | null
  name: string
  unit: PurchaseUnit | null
  orderedQuantity: number | null
  orderUnitPriceCents: number | null
  /** İptal edilmemiş kabullerde kabul edilen toplam. */
  acceptedQuantity: number | null
  /** Bu faturadan önceki etkin faturalarda aynı kaleme faturalanan miktar. */
  previouslyInvoicedQuantity: number | null
  invoicedQuantity: number
  invoiceUnitPriceCents: number
  /** Önceki ve bu faturada faturalanan toplamın kabul edileni aştığı miktar (yoksa 0). */
  quantityExcess: number
  /** Birim fiyat farkı (fatura − sipariş), kuruş; siparişte olmayan kalemde 0. */
  unitPriceDifferenceCents: number
  /** Fiyat farkının kalem tutarına etkisi (fark × faturalanan miktar), kuruş. */
  lineDifferenceCents: number
  status: InvoiceMatchStatus
}

export interface InvoiceMatch {
  status: InvoiceMatchStatus
  lines: InvoiceMatchLine[]
  /** Bugünkü sapma gerekçeyle onaylanmış mı (onaylanan durum bugünküyle aynı). */
  approved: boolean
  /** Ödeme fark onayı istiyor mu: sapma var ve onaylanmamış (K-282). */
  approvalRequired: boolean
}

export interface OrderMatchInput {
  items: readonly MatchOrderItem[]
  /** Sipariş kalemi başına iptal edilmemiş kabullerde kabul edilen miktar. */
  accepted: ReadonlyMap<string, number>
  /** Siparişe bağlı faturalar (iptal edilenler dahil). */
  invoices: readonly MatchInvoice[]
}

const STATUS_RANK: Record<InvoiceMatchStatus, number> = {
  matched: 0,
  price_mismatch: 1,
  quantity_mismatch: 2,
  unmatched: 3,
}

/** En ağır sapma: siparişte yok > miktar > fiyat > eşleşti. */
export const worstMatchStatus = (statuses: readonly InvoiceMatchStatus[]): InvoiceMatchStatus =>
  statuses.reduce<InvoiceMatchStatus>(
    (worst, status) => (STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst),
    'matched',
  )

/** Faturaların sırası: fatura tarihi, sonra giriş anı ve kimlik (K-281). */
const invoiceOrder = (a: MatchInvoice, b: MatchInvoice) =>
  a.invoiceDate.localeCompare(b.invoiceDate) ||
  a.createdAt.localeCompare(b.createdAt) ||
  a.id.localeCompare(b.id)

function matchLine(
  line: MatchInvoiceLine,
  item: MatchOrderItem | undefined,
  accepted: number,
  previous: number,
): InvoiceMatchLine {
  if (item === undefined)
    return {
      orderItemId: line.orderItemId,
      name: line.description ?? '',
      unit: null,
      orderedQuantity: null,
      orderUnitPriceCents: null,
      acceptedQuantity: null,
      previouslyInvoicedQuantity: null,
      invoicedQuantity: line.quantity,
      invoiceUnitPriceCents: line.unitPriceCents,
      quantityExcess: 0,
      unitPriceDifferenceCents: 0,
      lineDifferenceCents: 0,
      status: 'unmatched',
    }
  const quantityExcess = Math.max(previous + line.quantity - accepted, 0)
  const unitPriceDifferenceCents = line.unitPriceCents - item.unitPriceCents
  const lineDifferenceCents = unitPriceDifferenceCents * line.quantity
  const status: InvoiceMatchStatus =
    quantityExcess > 0
      ? 'quantity_mismatch'
      : Math.abs(lineDifferenceCents) > INVOICE_MATCH_PRICE_TOLERANCE_CENTS
        ? 'price_mismatch'
        : 'matched'
  return {
    orderItemId: item.id,
    name: item.name,
    unit: item.unit,
    orderedQuantity: item.quantity,
    orderUnitPriceCents: item.unitPriceCents,
    acceptedQuantity: accepted,
    previouslyInvoicedQuantity: previous,
    invoicedQuantity: line.quantity,
    invoiceUnitPriceCents: line.unitPriceCents,
    quantityExcess,
    unitPriceDifferenceCents,
    lineDifferenceCents,
    status,
  }
}

/**
 * Siparişin faturalarını eşleştirir (DOM-FIN-095, K-281). Kalemde faturalanan miktar, bu faturadan
 * önceki etkin faturaların aynı kaleme faturaladığıyla birlikte kabul edilen miktarı aşarsa
 * **miktar farkı**; miktar uygunsa birim fiyat farkının kalem tutarına etkisi 1 TL'yi aşarsa
 * **fiyat farkı**; siparişte olmayan kalem **siparişte yok**. Faturanın durumu en ağır kalem
 * durumudur; kalemsiz fatura (eşleştirmeden önce girilmiş) siparişte yok sayılır. İptal edilen
 * fatura sonraki faturaların miktarına girmez.
 */
export function matchOrderInvoices(input: OrderMatchInput): Map<string, InvoiceMatch> {
  const items = new Map(input.items.map((item) => [item.id, item]))
  const invoiced = new Map<string, number>()
  const result = new Map<string, InvoiceMatch>()
  for (const invoice of [...input.invoices].sort(invoiceOrder)) {
    const lines = invoice.lines.map((line) => {
      const item = line.orderItemId === null ? undefined : items.get(line.orderItemId)
      const key = item?.id ?? ''
      return matchLine(line, item, input.accepted.get(key) ?? 0, invoiced.get(key) ?? 0)
    })
    const status = lines.length === 0 ? 'unmatched' : worstMatchStatus(lines.map((l) => l.status))
    const approved = status !== 'matched' && invoice.approvedStatus === status
    result.set(invoice.id, {
      status,
      lines,
      approved,
      approvalRequired: !invoice.cancelled && status !== 'matched' && !approved,
    })
    if (invoice.cancelled) continue
    for (const line of invoice.lines)
      if (line.orderItemId !== null && items.has(line.orderItemId))
        invoiced.set(line.orderItemId, (invoiced.get(line.orderItemId) ?? 0) + line.quantity)
  }
  return result
}

export interface OrderMatchItemSummary {
  orderItemId: string
  name: string
  unit: PurchaseUnit
  orderedQuantity: number
  acceptedQuantity: number
  /** Etkin faturalarda faturalanan toplam. */
  invoicedQuantity: number
  unitPriceCents: number
  /** Faturalanan − kabul edilen (eksi: faturası beklenen kabul). */
  differenceQuantity: number
}

/**
 * Siparişin kalem bazında sipariş, kabul ve fatura özeti (sipariş ayrıntısı). Siparişin durumu
 * etkin faturaların en ağır durumudur; etkin fatura yoksa `null`.
 */
export function orderMatchSummary(
  input: OrderMatchInput,
  matches: ReadonlyMap<string, InvoiceMatch>,
): { items: OrderMatchItemSummary[]; status: InvoiceMatchStatus | null } {
  const invoiced = new Map<string, number>()
  const active = input.invoices.filter((invoice) => !invoice.cancelled)
  for (const invoice of active)
    for (const line of invoice.lines)
      if (line.orderItemId !== null)
        invoiced.set(line.orderItemId, (invoiced.get(line.orderItemId) ?? 0) + line.quantity)
  const items = input.items.map((item) => {
    const acceptedQuantity = input.accepted.get(item.id) ?? 0
    const invoicedQuantity = invoiced.get(item.id) ?? 0
    return {
      orderItemId: item.id,
      name: item.name,
      unit: item.unit,
      orderedQuantity: item.quantity,
      acceptedQuantity,
      invoicedQuantity,
      unitPriceCents: item.unitPriceCents,
      differenceQuantity: invoicedQuantity - acceptedQuantity,
    }
  })
  const statuses = active
    .map((invoice) => matches.get(invoice.id)?.status)
    .filter((status): status is InvoiceMatchStatus => status !== undefined)
  return { items, status: statuses.length === 0 ? null : worstMatchStatus(statuses) }
}

/** Sapma sayıları: liste ve CSV'deki özet. */
export function matchIssueCounts(match: Pick<InvoiceMatch, 'lines'>) {
  const count = (status: InvoiceMatchStatus) =>
    match.lines.filter((line) => line.status === status).length
  return {
    quantityLines: count('quantity_mismatch'),
    priceLines: count('price_mismatch'),
    unmatchedLines: count('unmatched'),
    priceDifferenceCents: match.lines.reduce(
      (total, line) => total + (line.status === 'price_mismatch' ? line.lineDifferenceCents : 0),
      0,
    ),
  }
}

/** Eşleşmeyen faturalar süzgeci (liste ve CSV aynı kuralla). */
export function matchesFilter(
  match: Pick<InvoiceMatch, 'status' | 'approved'>,
  filter: { status: InvoiceMatchFilter; approval?: InvoiceMatchApprovalFilter | undefined },
): boolean {
  const statusOk =
    filter.status === 'mismatched' ? match.status !== 'matched' : match.status === filter.status
  if (!statusOk) return false
  if (filter.approval === undefined) return true
  if (match.status === 'matched') return false
  return filter.approval === 'approved' ? match.approved : !match.approved
}

// --- Kurallar ------------------------------------------------------------------------------------

/**
 * Ödeme kontrolü (K-282): siparişe bağlı faturada sapma varsa ve onaylanmamışsa ödeme 409
 * `supplier_payment_invoice_mismatch_warning` ile durur; yönetici faturada farkı gerekçeyle
 * onaylayınca ödeme girilir. Siparişsiz fatura (`null`) eşleştirilmez.
 */
export function assertInvoicePayable(match: Pick<InvoiceMatch, 'status' | 'approved'> | null) {
  if (match === null || match.status === 'matched' || match.approved) return
  throw new DomainError(
    INVOICE_MISMATCH_PAYMENT_WARNING,
    `Fatura sipariş ve mal kabulle eşleşmiyor (${INVOICE_MATCH_STATUS_LABELS[match.status].toLocaleLowerCase('tr-TR')}). Ödemeden önce farkı gerekçeyle onaylayın.`,
    { kind: 'conflict' },
  )
}

/**
 * Fark onayı (K-282): yalnız siparişe bağlı, iptal edilmemiş ve bugün sapması olan faturada;
 * aynı sapma ikinci kez onaylanmaz. Sapma sonradan değişirse (ör. kabul iptal edildi) yeni durum
 * yeniden onay ister.
 */
export function planInvoiceMatchApproval(
  invoice: { cancelled: boolean; match: Pick<InvoiceMatch, 'status' | 'approved'> | null },
  input: unknown,
): { reason: string; status: InvoiceMismatchStatus } {
  const { reason } = approveInvoiceMatchSchema.parse(input)
  if (invoice.cancelled)
    throw ruleError('supplier_invoice_cancelled', 'Fatura iptal edilmiş; işlem yapılamaz.')
  const match = invoice.match
  if (match === null)
    throw ruleError(
      'supplier_invoice_match_not_applicable',
      'Siparişe bağlı olmayan fatura eşleştirilmez; onaylanacak fark yok.',
    )
  if (match.status === 'matched')
    throw ruleError(
      'supplier_invoice_match_already_matched',
      'Fatura sipariş ve mal kabulle eşleşiyor; onaylanacak fark yok.',
    )
  if (match.approved)
    throw ruleError('supplier_invoice_match_already_approved', 'Bu fark daha önce onaylandı.')
  return { reason, status: match.status }
}

// --- CSV -----------------------------------------------------------------------------------------

export interface InvoiceMatchRow {
  invoiceNumber: string
  invoiceDate: string
  supplierName: string
  orderNumber: string
  grossCents: number
  remainingCents: number
  status: InvoiceMatchStatus
  approved: boolean
  quantityLines: number
  priceLines: number
  unmatchedLines: number
  priceDifferenceCents: number
}

export const INVOICE_MATCH_CSV_HEADER = [
  'Fatura no',
  'Fatura tarihi',
  'Tedarikçi',
  'Sipariş no',
  'Tutar (KDV dahil)',
  'Kalan (KDV dahil)',
  'Eşleştirme',
  'Miktar farkı (kalem)',
  'Fiyat farkı (kalem)',
  'Siparişte olmayan (kalem)',
  'Fiyat farkı tutarı (KDV hariç)',
  'Fark onayı',
] as const

/** Eşleşmeyen faturalar CSV'si: `;` ayırıcı, ondalık virgül, metin formül kaçışlı. */
export function invoiceMatchCsv(rows: readonly InvoiceMatchRow[]): string {
  const lines = rows.map((row) =>
    [
      csvCell(row.invoiceNumber),
      csvCell(row.invoiceDate),
      csvCell(row.supplierName),
      csvCell(row.orderNumber),
      csvAmount(row.grossCents),
      csvAmount(row.remainingCents),
      csvCell(INVOICE_MATCH_STATUS_LABELS[row.status]),
      String(row.quantityLines),
      String(row.priceLines),
      String(row.unmatchedLines),
      csvAmount(row.priceDifferenceCents),
      csvCell(row.status === 'matched' ? '' : row.approved ? 'Onaylandı' : 'Bekliyor'),
    ].join(CSV_SEPARATOR),
  )
  return [INVOICE_MATCH_CSV_HEADER.map(csvCell).join(CSV_SEPARATOR), ...lines].join('\r\n')
}

/** Ekranda kalemin birimi ("adet", "kg"); siparişte olmayan kalemde boş. */
export const matchUnitLabel = (unit: PurchaseUnit | null) =>
  unit === null ? '' : PURCHASE_UNIT_LABELS[unit]
