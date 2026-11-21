import { z } from 'zod'

import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { BUDGET_ROLES } from './finance-budget.ts'
import {
  purchaseOrderAmounts,
  type OrderLineInput,
  type PurchaseOrderStatus,
} from './finance-purchase-orders.ts'
import type { AmountTotals } from './finance-purchase-quotes.ts'
import {
  SUPPLIER_CATEGORIES,
  SUPPLIER_CATEGORY_LABELS,
  SUPPLIER_TYPE_LABELS,
  type SupplierCategory,
  type SupplierType,
} from './finance-suppliers.ts'
import { dayKey } from './format.ts'

/**
 * Satın alma raporu (docs/domain/finans.md DOM-FIN-075; ON-227, K23). Seçilen tarih aralığında ya
 * da bütçe döneminde açılan siparişlerin (DOM-FIN-073) tutarı tedarikçi kategorisi, tedarikçi,
 * maliyet merkezi ve gider kalemi bazında toplanır; iptal edilen sipariş tutara girmez, ayrıca
 * sayılır. Talepten siparişe ortalama süre ve en çok harcama yapılan tedarikçiler verilir. Salt okur
 * hesaptır, hiçbir şey saklanmaz; tutarlar kuruş, paylar on binde birdir. Her kırılımda siparişin
 * teslim alınan (mal kabul, KDV hariç), faturalanan (KDV dahil), ödenen ve açık tutarı da verilir;
 * siparişe bağlı olmayan faturalar ayrı satırdadır (ON-336, K-195…K-199). Fonksiyonlar saftır.
 */

/** Raporu okuyan roller: bütçeyi gören rol (K-155; bugün yalnız yönetici, muhasebe açılınca o da). */
export const PURCHASE_REPORT_ROLES = BUDGET_ROLES

/** Tarih aralığı en çok bir bütçe dönemi kadardır (DOM-FIN-062; K-156). */
export const PURCHASE_REPORT_RANGE_MAX_DAYS = 366
/** "En çok harcama yapılan tedarikçiler" listesinin uzunluğu (K-158). */
export const PURCHASE_REPORT_TOP = 5

const DAY_MS = 86_400_000
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS

export interface PurchaseReportRangeIssue {
  path: 'from' | 'to'
  message: string
}

/** Tarih aralığının kuralı; ekran istek atmadan aynı iletiyi gösterir. */
export function purchaseReportRangeIssue(
  from: string,
  to: string,
): PurchaseReportRangeIssue | null {
  if (from > to) return { path: 'from', message: 'Başlangıç günü bitiş gününden sonra olamaz.' }
  if (dayNumber(to) - dayNumber(from) + 1 > PURCHASE_REPORT_RANGE_MAX_DAYS)
    return {
      path: 'to',
      message: `Tarih aralığı en çok ${String(PURCHASE_REPORT_RANGE_MAX_DAYS)} gün olabilir.`,
    }
  return null
}

/**
 * Sorgu: ya bütçe dönemi (`periodId`) ya da başlangıç ve bitiş günü (`from`, `to`; Europe/Istanbul
 * günleri, ikisi de dahil). İkisi birlikte verilemez (K-156).
 */
export const purchaseReportQuerySchema = z
  .strictObject({
    periodId: z.uuid('Bütçe dönemini seçin.').optional(),
    from: daySchema.optional(),
    to: daySchema.optional(),
  })
  .superRefine((query, ctx) => {
    if (query.periodId !== undefined) {
      if (query.from !== undefined || query.to !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['periodId'],
          message: 'Bütçe dönemi ya da tarih aralığından yalnız birini seçin.',
        })
      return
    }
    if (query.from === undefined || query.to === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [query.from === undefined ? 'from' : 'to'],
        message: 'Bütçe dönemini ya da başlangıç ve bitiş gününü seçin.',
      })
      return
    }
    const issue = purchaseReportRangeIssue(query.from, query.to)
    if (issue !== null) ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
  })
export type PurchaseReportQuery = z.output<typeof purchaseReportQuerySchema>

export type PurchaseReportScope =
  { kind: 'period'; periodId: string } | { kind: 'range'; from: string; to: string }

/** Sorgunun kapsamı; şema doğrulamasından geçmiş sorgu ister. */
export function purchaseReportScope(query: PurchaseReportQuery): PurchaseReportScope {
  if (query.periodId !== undefined) return { kind: 'period', periodId: query.periodId }
  if (query.from === undefined || query.to === undefined)
    throw new DomainError(
      'purchase_report_scope_required',
      'Bütçe dönemini ya da başlangıç ve bitiş gününü seçin.',
      { kind: 'rule', path: ['from'] },
    )
  return { kind: 'range', from: query.from, to: query.to }
}

// --- Girdi ---------------------------------------------------------------------------------------

/** Siparişin rapora giren alanları; talep alanları siparişin talebinden okunur. */
export interface PurchaseReportOrder {
  id: string
  status: PurchaseOrderStatus
  /** Açılış anı (ISO UTC). */
  createdAt: string
  supplierId: string
  /** Talebin bütçe dönemi, maliyet merkezi ve gider kalemi (DOM-FIN-071). */
  periodId: string
  costCenterId: string
  budgetItemId: string
  /** Talebin gönderim anı; gönderilmemişse açılış anı kullanılır. */
  requestSubmittedAt: string | null
  requestCreatedAt: string
  lines: readonly OrderLineInput[]
}

/** Tedarikçinin güncel kaydı; vergi numarası rapora girmez (K-155). */
export interface PurchaseReportSupplier {
  id: string
  name: string
  type: SupplierType
  categories: readonly SupplierCategory[]
  isActive: boolean
}

export interface PurchaseReportRef {
  id: string
  code: string
  name: string
  isActive: boolean
}

/**
 * Mal kabul kalemi (DOM-FIN-074): kabul edilen miktar × siparişin KDV hariç birim fiyatı teslim
 * alınan tutardır (K-151 gerçekleşen tanımı); iptal edilen kabul sayılmaz.
 */
export interface PurchaseReportReceiptLine {
  orderId: string
  /** Kabulün iptal anı; iptal edilmişse boş değildir. */
  cancelledAt: string | null
  acceptedQuantity: number
  unitPriceCents: number
}

/** Tedarikçi faturası (DOM-FIN-076); tutar KDV dahildir. */
export interface PurchaseReportInvoice {
  id: string
  supplierId: string
  /** Bağlı sipariş; siparişsiz faturada boş. */
  purchaseOrderId: string | null
  invoiceDate: string
  grossCents: number
  cancelledAt: string | null
}

/** Tedarikçi ödemesi (DOM-FIN-076); iptal edilen ödeme sayılmaz. */
export interface PurchaseReportPayment {
  invoiceId: string
  amountCents: number
  cancelledAt: string | null
}

export interface PurchaseReportInput {
  scope: PurchaseReportScope
  orders: readonly PurchaseReportOrder[]
  suppliers: readonly PurchaseReportSupplier[]
  costCenters: readonly PurchaseReportRef[]
  budgetItems: readonly PurchaseReportRef[]
  /** Kapsamdaki siparişlerin kabul kalemleri; kabul günü süzülmez (K-196). */
  receiptLines: readonly PurchaseReportReceiptLine[]
  /** Kapsamdaki siparişlere bağlı faturalar ve siparişsiz faturalar (K-196, K-197). */
  invoices: readonly PurchaseReportInvoice[]
  /** Bu faturaların ödemeleri; ödeme günü süzülmez (K-196). */
  payments: readonly PurchaseReportPayment[]
  /**
   * Siparişsiz faturanın fatura tarihi bu günler arasında olmalıdır: aralıkta seçilen günler,
   * bütçe döneminde dönemin başlangıç ve bitiş günü (K-197).
   */
  invoiceDays: { from: string; to: string }
}

// --- Çıktı ---------------------------------------------------------------------------------------

/**
 * Siparişin teslim, fatura ve ödeme durumu (K-195). Teslim alınan KDV hariçtir (mal kabuldeki
 * gerçekleşen); faturalanan, ödenen ve açık KDV dahildir. Açık = faturalanan − ödenen.
 */
export interface PurchaseSettlement {
  receivedNetCents: number
  invoicedGrossCents: number
  paidCents: number
  openCents: number
}

export interface PurchaseAmounts extends AmountTotals, PurchaseSettlement {
  orderCount: number
}

export interface PurchaseShareRow extends PurchaseAmounts {
  /** Brüt tutarın toplam brüte oranı, on binde bir; toplam sıfırsa boş. */
  shareBasisPoints: number | null
}

export interface PurchaseCategoryRow extends PurchaseShareRow {
  category: SupplierCategory
  supplierCount: number
}

export interface PurchaseSupplierRow extends PurchaseShareRow {
  rank: number
  supplierId: string
  name: string
  type: SupplierType
  categories: SupplierCategory[]
  isActive: boolean
  /** Bu tedarikçinin siparişlerinde talepten siparişe ortalama gün (bir ondalık). */
  averageLeadDays: number | null
}

export interface PurchaseRefRow extends PurchaseShareRow {
  id: string
  code: string
  name: string
  isActive: boolean
}

export interface PurchaseLeadTime {
  orderCount: number
  /** Ortalama takvim günü, bir ondalığa yuvarlanır; sipariş yoksa boş. */
  averageDays: number | null
  minDays: number | null
  maxDays: number | null
}

/** Siparişe bağlı olmayan etkin faturalar (K-197); toplamlara ve kırılımlara girmez. */
export interface PurchaseUnlinkedInvoices {
  invoiceCount: number
  invoicedGrossCents: number
  paidCents: number
  openCents: number
}

export interface PurchaseReport {
  totals: PurchaseAmounts & { supplierCount: number }
  /** İptal edilen siparişler; bağlı faturaları ve ödemeleri de burada, toplamlara girmez (K-198). */
  cancelled: {
    orderCount: number
    grossCents: number
    invoicedGrossCents: number
    paidCents: number
  }
  unlinkedInvoices: PurchaseUnlinkedInvoices
  leadTime: PurchaseLeadTime
  categories: PurchaseCategoryRow[]
  suppliers: PurchaseSupplierRow[]
  topSuppliers: PurchaseSupplierRow[]
  costCenters: PurchaseRefRow[]
  budgetItems: PurchaseRefRow[]
}

// --- Hesap ---------------------------------------------------------------------------------------

const emptySettlement = (): PurchaseSettlement => ({
  receivedNetCents: 0,
  invoicedGrossCents: 0,
  paidCents: 0,
  openCents: 0,
})

const emptyAmounts = (): PurchaseAmounts => ({
  orderCount: 0,
  netCents: 0,
  vatCents: 0,
  grossCents: 0,
  ...emptySettlement(),
})

function addTo(target: PurchaseAmounts, amounts: AmountTotals, settlement: PurchaseSettlement) {
  target.orderCount += 1
  target.netCents += amounts.netCents
  target.vatCents += amounts.vatCents
  target.grossCents += amounts.grossCents
  target.receivedNetCents += settlement.receivedNetCents
  target.invoicedGrossCents += settlement.invoicedGrossCents
  target.paidCents += settlement.paidCents
  target.openCents += settlement.openCents
}

const sumBy = <K>(map: Map<K, number>, key: K, cents: number) =>
  map.set(key, (map.get(key) ?? 0) + cents)

/**
 * Sipariş başına teslim, fatura ve ödeme (K-195, K-196): iptal edilmemiş kabullerin kabul edilen
 * miktarı × KDV hariç birim fiyat; iptal edilmemiş bağlı faturaların KDV dahil toplamı; o faturalara
 * yapılan iptal edilmemiş ödemeler. Siparişsiz faturalar ayrıca döner (K-197).
 */
function settlements(input: PurchaseReportInput) {
  const received = new Map<string, number>()
  for (const line of input.receiptLines)
    if (line.cancelledAt === null)
      sumBy(received, line.orderId, line.acceptedQuantity * line.unitPriceCents)
  const paidByInvoice = new Map<string, number>()
  for (const payment of input.payments)
    if (payment.cancelledAt === null) sumBy(paidByInvoice, payment.invoiceId, payment.amountCents)
  const invoiced = new Map<string, number>()
  const paid = new Map<string, number>()
  const unlinked: PurchaseUnlinkedInvoices = {
    invoiceCount: 0,
    invoicedGrossCents: 0,
    paidCents: 0,
    openCents: 0,
  }
  for (const invoice of input.invoices) {
    if (invoice.cancelledAt !== null) continue
    const invoicePaid = paidByInvoice.get(invoice.id) ?? 0
    if (invoice.purchaseOrderId === null) {
      if (
        invoice.invoiceDate < input.invoiceDays.from ||
        invoice.invoiceDate > input.invoiceDays.to
      )
        continue
      unlinked.invoiceCount += 1
      unlinked.invoicedGrossCents += invoice.grossCents
      unlinked.paidCents += invoicePaid
      continue
    }
    sumBy(invoiced, invoice.purchaseOrderId, invoice.grossCents)
    sumBy(paid, invoice.purchaseOrderId, invoicePaid)
  }
  unlinked.openCents = unlinked.invoicedGrossCents - unlinked.paidCents
  const forOrder = (orderId: string): PurchaseSettlement => {
    const invoicedGrossCents = invoiced.get(orderId) ?? 0
    const paidCents = paid.get(orderId) ?? 0
    return {
      receivedNetCents: received.get(orderId) ?? 0,
      invoicedGrossCents,
      paidCents,
      openCents: invoicedGrossCents - paidCents,
    }
  }
  return { forOrder, unlinked }
}

/** Pay on binde birdir; yarım yukarı yuvarlanır. */
function shareOf(grossCents: number, totalGrossCents: number): number | null {
  if (totalGrossCents === 0) return null
  return Math.round((grossCents * 10_000) / totalGrossCents)
}

/** Ortalama gün bir ondalığa yuvarlanır (K-158). */
const averageTenths = (total: number, count: number) =>
  count === 0 ? null : Math.round((total * 10) / count) / 10

/** Talepten siparişe gün: Europe/Istanbul takvim günleri farkı (K-158). */
export function purchaseLeadDays(
  order: Pick<PurchaseReportOrder, 'createdAt' | 'requestSubmittedAt' | 'requestCreatedAt'>,
): number {
  const start = dayKey(order.requestSubmittedAt ?? order.requestCreatedAt)
  return Math.max(0, dayNumber(dayKey(order.createdAt)) - dayNumber(start))
}

/** Sipariş kapsamda mı: bütçe döneminde talebin dönemi, aralıkta açılış günü (K-156). */
export function inPurchaseReportScope(
  order: Pick<PurchaseReportOrder, 'createdAt' | 'periodId'>,
  scope: PurchaseReportScope,
): boolean {
  if (scope.kind === 'period') return order.periodId === scope.periodId
  const day = dayKey(order.createdAt)
  return day >= scope.from && day <= scope.to
}

const byGross =
  <T extends PurchaseAmounts>(tieBreak: (a: T, b: T) => number) =>
  (a: T, b: T) =>
    b.grossCents - a.grossCents || tieBreak(a, b)
const byText = (a: string, b: string) => a.localeCompare(b, 'tr')

function refRows(
  amounts: Map<string, PurchaseAmounts>,
  refs: readonly PurchaseReportRef[],
  missing: string,
  totalGross: number,
): PurchaseRefRow[] {
  const known = new Map(refs.map((ref) => [ref.id, ref]))
  return [...amounts]
    .map(([id, sum]): PurchaseRefRow => {
      const ref = known.get(id)
      return {
        id,
        code: ref?.code ?? '',
        name: ref?.name ?? missing,
        isActive: ref?.isActive ?? false,
        ...sum,
        shareBasisPoints: shareOf(sum.grossCents, totalGross),
      }
    })
    .sort(byGross((a, b) => byText(a.code, b.code) || byText(a.name, b.name)))
}

/**
 * Satın alma raporu (DOM-FIN-075). Kapsamdaki siparişlerden iptal edilmeyenler toplanır (taslak
 * dahil, K-156); sipariş tutarı kalemlerden `DOM-FIN-072` kuralıyla hesaplanır. Çok kategorili
 * tedarikçinin siparişi her kategorisinde sayılır: kategori satırlarının toplamı genel toplamı
 * aşabilir (K-157). Tedarikçi adı ve kategorileri tedarikçinin güncel kaydındandır. Teslim, fatura
 * ve ödeme kapsamdaki siparişlerindir; kabul, fatura ve ödeme günü ayrıca süzülmez (K-195, K-196).
 */
export function purchaseReport(input: PurchaseReportInput): PurchaseReport {
  const suppliers = new Map(input.suppliers.map((supplier) => [supplier.id, supplier]))
  const totals = emptyAmounts()
  const cancelled = { orderCount: 0, grossCents: 0, invoicedGrossCents: 0, paidCents: 0 }
  const { forOrder, unlinked } = settlements(input)
  const bySupplier = new Map<string, PurchaseAmounts & { leadDays: number }>()
  const byCategory = new Map<SupplierCategory, PurchaseAmounts & { suppliers: Set<string> }>()
  const byCenter = new Map<string, PurchaseAmounts>()
  const byItem = new Map<string, PurchaseAmounts>()
  const leadDays: number[] = []

  for (const order of input.orders) {
    if (!inPurchaseReportScope(order, input.scope)) continue
    const { totals: amounts } = purchaseOrderAmounts(order.lines)
    const settlement = forOrder(order.id)
    if (order.status === 'cancelled') {
      cancelled.orderCount += 1
      cancelled.grossCents += amounts.grossCents
      cancelled.invoicedGrossCents += settlement.invoicedGrossCents
      cancelled.paidCents += settlement.paidCents
      continue
    }
    addTo(totals, amounts, settlement)
    const lead = purchaseLeadDays(order)
    leadDays.push(lead)

    const supplier = bySupplier.get(order.supplierId) ?? { ...emptyAmounts(), leadDays: 0 }
    addTo(supplier, amounts, settlement)
    supplier.leadDays += lead
    bySupplier.set(order.supplierId, supplier)

    for (const category of suppliers.get(order.supplierId)?.categories ?? []) {
      const row = byCategory.get(category) ?? { ...emptyAmounts(), suppliers: new Set<string>() }
      addTo(row, amounts, settlement)
      row.suppliers.add(order.supplierId)
      byCategory.set(category, row)
    }

    const center = byCenter.get(order.costCenterId) ?? emptyAmounts()
    addTo(center, amounts, settlement)
    byCenter.set(order.costCenterId, center)
    const item = byItem.get(order.budgetItemId) ?? emptyAmounts()
    addTo(item, amounts, settlement)
    byItem.set(order.budgetItemId, item)
  }

  const totalGross = totals.grossCents
  const supplierRows = [...bySupplier]
    .map(([supplierId, { leadDays: lead, ...sum }]) => {
      const supplier = suppliers.get(supplierId)
      return {
        rank: 0,
        supplierId,
        name: supplier?.name ?? 'Kaydı bulunamayan tedarikçi',
        type: supplier?.type ?? 'company',
        categories: [...(supplier?.categories ?? [])],
        isActive: supplier?.isActive ?? false,
        ...sum,
        shareBasisPoints: shareOf(sum.grossCents, totalGross),
        averageLeadDays: averageTenths(lead, sum.orderCount),
      } satisfies PurchaseSupplierRow
    })
    .sort(byGross((a, b) => byText(a.name, b.name) || byText(a.supplierId, b.supplierId)))
    .map((row, index) => ({ ...row, rank: index + 1 }))

  const categoryOrder = (category: SupplierCategory) => SUPPLIER_CATEGORIES.indexOf(category)
  const categoryRows = [...byCategory]
    .map(([category, { suppliers: ids, ...sum }]): PurchaseCategoryRow => ({
      category,
      supplierCount: ids.size,
      ...sum,
      shareBasisPoints: shareOf(sum.grossCents, totalGross),
    }))
    .sort(byGross((a, b) => categoryOrder(a.category) - categoryOrder(b.category)))

  const leadTotal = leadDays.reduce((sum, days) => sum + days, 0)
  return {
    totals: { ...totals, supplierCount: bySupplier.size },
    cancelled,
    unlinkedInvoices: unlinked,
    leadTime: {
      orderCount: leadDays.length,
      averageDays: averageTenths(leadTotal, leadDays.length),
      minDays: leadDays.length === 0 ? null : Math.min(...leadDays),
      maxDays: leadDays.length === 0 ? null : Math.max(...leadDays),
    },
    categories: categoryRows,
    suppliers: supplierRows,
    topSuppliers: supplierRows.slice(0, PURCHASE_REPORT_TOP),
    costCenters: refRows(byCenter, input.costCenters, 'Kaydı bulunamayan merkez', totalGross),
    budgetItems: refRows(byItem, input.budgetItems, 'Kaydı bulunamayan kalem', totalGross),
  }
}

// --- CSV -----------------------------------------------------------------------------------------

/** Başlıklar KDV esasını açıkça yazar (K-199). */
const CSV_HEADER = [
  'Kırılım',
  'Ad',
  'Kod',
  'Tür',
  'Kategoriler',
  'Sipariş sayısı',
  'Sipariş tutarı (KDV hariç)',
  'Sipariş KDV',
  'Sipariş tutarı (KDV dahil)',
  'Pay (%)',
  'Teslim alınan (KDV hariç)',
  'Faturalanan (KDV dahil)',
  'Ödenen (KDV dahil)',
  'Açık (KDV dahil)',
]

/** On binde biri yüzde olarak yazar (`12,34`); boşsa boş hücre. */
function percentCell(basisPoints: number | null): string {
  if (basisPoints === null) return csvCell('')
  return `${String(Math.floor(basisPoints / 100))},${String(basisPoints % 100).padStart(2, '0')}`
}

const amountCells = (row: PurchaseAmounts) => [
  String(row.orderCount),
  csvAmount(row.netCents),
  csvAmount(row.vatCents),
  csvAmount(row.grossCents),
]

const settlementCells = (row: Omit<PurchaseSettlement, 'receivedNetCents'>, received: string) => [
  received,
  csvAmount(row.invoicedGrossCents),
  csvAmount(row.paidCents),
  csvAmount(row.openCents),
]

/**
 * Raporun CSV dökümü (`;`, ondalık virgül, formül kaçışı): toplam, kategori, tedarikçi, maliyet
 * merkezi ve gider kalemi satırları tek tabloda, "Kırılım" sütunuyla ayrılır; siparişsiz faturalar
 * toplamın altında ayrı satırdır, sipariş sütunları boştur (K-197, K-199). Şahıs tedarikçinin adı
 * kişisel veridir; vergi numarası yazılmaz (K-155).
 */
export function purchaseReportCsv(
  report: Pick<
    PurchaseReport,
    'totals' | 'unlinkedInvoices' | 'categories' | 'suppliers' | 'costCenters' | 'budgetItems'
  >,
): string {
  const blank = csvCell('')
  const line = (head: string[], row: PurchaseAmounts, share: string) => [
    ...head,
    ...amountCells(row),
    share,
    ...settlementCells(row, csvAmount(row.receivedNetCents)),
  ]
  const rows: string[][] = [
    line([csvCell('Toplam'), blank, blank, blank, blank], report.totals, blank),
    [
      csvCell('Siparişsiz fatura'),
      csvCell(`${String(report.unlinkedInvoices.invoiceCount)} fatura`),
      // Kod, tür, kategori, sipariş sayısı ve tutarları ile pay yoktur; teslim alınan da boştur.
      ...Array<string>(8).fill(blank),
      ...settlementCells(report.unlinkedInvoices, blank),
    ],
    ...report.categories.map((row) =>
      line(
        [
          csvCell('Tedarikçi kategorisi'),
          csvCell(SUPPLIER_CATEGORY_LABELS[row.category]),
          blank,
          blank,
          blank,
        ],
        row,
        percentCell(row.shareBasisPoints),
      ),
    ),
    ...report.suppliers.map((row) =>
      line(
        [
          csvCell('Tedarikçi'),
          csvCell(row.name),
          blank,
          csvCell(SUPPLIER_TYPE_LABELS[row.type]),
          csvCell(row.categories.map((category) => SUPPLIER_CATEGORY_LABELS[category]).join(', ')),
        ],
        row,
        percentCell(row.shareBasisPoints),
      ),
    ),
    ...report.costCenters.map((row) =>
      line(
        [csvCell('Maliyet merkezi'), csvCell(row.name), csvCell(row.code), blank, blank],
        row,
        percentCell(row.shareBasisPoints),
      ),
    ),
    ...report.budgetItems.map((row) =>
      line(
        [csvCell('Gider kalemi'), csvCell(row.name), csvCell(row.code), blank, blank],
        row,
        percentCell(row.shareBasisPoints),
      ),
    ),
  ]
  return [CSV_HEADER.map(csvCell), ...rows].map((row) => row.join(CSV_SEPARATOR)).join('\r\n')
}
