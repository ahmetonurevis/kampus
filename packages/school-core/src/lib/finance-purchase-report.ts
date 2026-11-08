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
 * hesaptır, hiçbir şey saklanmaz; tutarlar kuruş, paylar on binde birdir. Kabul edilen (ON-226),
 * faturalanan ve ödenen (ON-143) tutar sütunları o kayıtlar gelince eklenir; sipariş tutarı aynı
 * kalır. Fonksiyonlar saftır.
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

export interface PurchaseReportInput {
  scope: PurchaseReportScope
  orders: readonly PurchaseReportOrder[]
  suppliers: readonly PurchaseReportSupplier[]
  costCenters: readonly PurchaseReportRef[]
  budgetItems: readonly PurchaseReportRef[]
}

// --- Çıktı ---------------------------------------------------------------------------------------

export interface PurchaseAmounts extends AmountTotals {
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

export interface PurchaseReport {
  totals: PurchaseAmounts & { supplierCount: number }
  cancelled: { orderCount: number; grossCents: number }
  leadTime: PurchaseLeadTime
  categories: PurchaseCategoryRow[]
  suppliers: PurchaseSupplierRow[]
  topSuppliers: PurchaseSupplierRow[]
  costCenters: PurchaseRefRow[]
  budgetItems: PurchaseRefRow[]
}

// --- Hesap ---------------------------------------------------------------------------------------

const emptyAmounts = (): PurchaseAmounts => ({
  orderCount: 0,
  netCents: 0,
  vatCents: 0,
  grossCents: 0,
})

function addTo(target: PurchaseAmounts, amounts: AmountTotals) {
  target.orderCount += 1
  target.netCents += amounts.netCents
  target.vatCents += amounts.vatCents
  target.grossCents += amounts.grossCents
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
 * aşabilir (K-157). Tedarikçi adı ve kategorileri tedarikçinin güncel kaydındandır.
 */
export function purchaseReport(input: PurchaseReportInput): PurchaseReport {
  const suppliers = new Map(input.suppliers.map((supplier) => [supplier.id, supplier]))
  const totals = emptyAmounts()
  const cancelled = { orderCount: 0, grossCents: 0 }
  const bySupplier = new Map<string, PurchaseAmounts & { leadDays: number }>()
  const byCategory = new Map<SupplierCategory, PurchaseAmounts & { suppliers: Set<string> }>()
  const byCenter = new Map<string, PurchaseAmounts>()
  const byItem = new Map<string, PurchaseAmounts>()
  const leadDays: number[] = []

  for (const order of input.orders) {
    if (!inPurchaseReportScope(order, input.scope)) continue
    const { totals: amounts } = purchaseOrderAmounts(order.lines)
    if (order.status === 'cancelled') {
      cancelled.orderCount += 1
      cancelled.grossCents += amounts.grossCents
      continue
    }
    addTo(totals, amounts)
    const lead = purchaseLeadDays(order)
    leadDays.push(lead)

    const supplier = bySupplier.get(order.supplierId) ?? { ...emptyAmounts(), leadDays: 0 }
    addTo(supplier, amounts)
    supplier.leadDays += lead
    bySupplier.set(order.supplierId, supplier)

    for (const category of suppliers.get(order.supplierId)?.categories ?? []) {
      const row = byCategory.get(category) ?? { ...emptyAmounts(), suppliers: new Set<string>() }
      addTo(row, amounts)
      row.suppliers.add(order.supplierId)
      byCategory.set(category, row)
    }

    const center = byCenter.get(order.costCenterId) ?? emptyAmounts()
    addTo(center, amounts)
    byCenter.set(order.costCenterId, center)
    const item = byItem.get(order.budgetItemId) ?? emptyAmounts()
    addTo(item, amounts)
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

const CSV_HEADER = [
  'Kırılım',
  'Ad',
  'Kod',
  'Tür',
  'Kategoriler',
  'Sipariş',
  'Net',
  'KDV',
  'Brüt',
  'Pay (%)',
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

/**
 * Raporun CSV dökümü (`;`, ondalık virgül, formül kaçışı): toplam, kategori, tedarikçi, maliyet
 * merkezi ve gider kalemi satırları tek tabloda, "Kırılım" sütunuyla ayrılır. Şahıs tedarikçinin adı
 * kişisel veridir; vergi numarası yazılmaz (K-155).
 */
export function purchaseReportCsv(
  report: Pick<
    PurchaseReport,
    'totals' | 'categories' | 'suppliers' | 'costCenters' | 'budgetItems'
  >,
): string {
  const blank = csvCell('')
  const rows: string[][] = [
    [csvCell('Toplam'), blank, blank, blank, blank, ...amountCells(report.totals), blank],
    ...report.categories.map((row) => [
      csvCell('Tedarikçi kategorisi'),
      csvCell(SUPPLIER_CATEGORY_LABELS[row.category]),
      blank,
      blank,
      blank,
      ...amountCells(row),
      percentCell(row.shareBasisPoints),
    ]),
    ...report.suppliers.map((row) => [
      csvCell('Tedarikçi'),
      csvCell(row.name),
      blank,
      csvCell(SUPPLIER_TYPE_LABELS[row.type]),
      csvCell(row.categories.map((category) => SUPPLIER_CATEGORY_LABELS[category]).join(', ')),
      ...amountCells(row),
      percentCell(row.shareBasisPoints),
    ]),
    ...report.costCenters.map((row) => [
      csvCell('Maliyet merkezi'),
      csvCell(row.name),
      csvCell(row.code),
      blank,
      blank,
      ...amountCells(row),
      percentCell(row.shareBasisPoints),
    ]),
    ...report.budgetItems.map((row) => [
      csvCell('Gider kalemi'),
      csvCell(row.name),
      csvCell(row.code),
      blank,
      blank,
      ...amountCells(row),
      percentCell(row.shareBasisPoints),
    ]),
  ]
  return [CSV_HEADER.map(csvCell), ...rows].map((row) => row.join(CSV_SEPARATOR)).join('\r\n')
}
