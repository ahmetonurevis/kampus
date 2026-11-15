import {
  invoiceMatchCsv,
  matchesFilter,
  matchIssueCounts,
  matchOrderInvoices,
  orderMatchSummary,
  type InvoiceMatch,
  type InvoiceMatchApprovalFilter,
  type InvoiceMatchFilter,
  type InvoiceMatchRow,
  type MatchOrderItem,
  type OrderMatchInput,
} from '@kampus/school-core/lib/finance-invoice-matching.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  findInvoiceOrderId,
  loadAcceptedQuantities,
  loadInvoiceLines,
  loadInvoicePaidCents,
  loadMatchedOrderIds,
  loadOrderInvoices,
  type StoredMatchInvoice,
} from '../db/finance-invoice-matching.ts'
import { findPurchaseOrder, loadOrderItems } from '../db/finance-purchase-orders.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { foldSearch } from '../db/text-search.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'

/**
 * Tedarikçi faturası üçlü eşleştirmesi (DOM-FIN-095; ON-277). Kural core
 * `lib/finance-invoice-matching.ts`'tedir; servis sipariş kalemlerini, kabul edilen miktarları ve
 * siparişe bağlı faturaların kalemlerini kurum kapsamında okur. Sonuç saklanmaz. Fark onayı komutu
 * fatura ayrıntısını döndürdüğü için tedarikçi carisi servisindedir. Rol ve modül denetimi rotadadır.
 */

export interface OrderMatching {
  /** Core eşleştirmesinin girdisi: kalemler, kabul edilen miktarlar, faturalar ve kalemleri. */
  input: OrderMatchInput
  invoices: StoredMatchInvoice[]
  matches: Map<string, InvoiceMatch>
}

/** Siparişlerin kalemleri, kabulleri, faturaları ve eşleştirme sonucu (sipariş başına). */
export async function loadOrderMatchings(
  db: Database,
  institutionId: string,
  orderIds: readonly string[],
): Promise<Map<string, OrderMatching>> {
  if (orderIds.length === 0) return new Map()
  const [items, accepted, invoices] = await Promise.all([
    loadOrderItems(db, institutionId, orderIds),
    loadAcceptedQuantities(db, institutionId, orderIds),
    loadOrderInvoices(db, institutionId, orderIds),
  ])
  const lines = await loadInvoiceLines(
    db,
    institutionId,
    invoices.map((invoice) => invoice.id),
  )
  const result = new Map<string, OrderMatching>()
  for (const orderId of new Set(orderIds)) {
    const orderItems: MatchOrderItem[] = (items.get(orderId) ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    }))
    const orderAccepted = new Map(
      orderItems.map((item) => [item.id, accepted.get(item.id) ?? 0] as const),
    )
    const orderInvoices = invoices.filter((invoice) => invoice.purchaseOrderId === orderId)
    const input: OrderMatchInput = {
      items: orderItems,
      accepted: orderAccepted,
      invoices: orderInvoices.map((invoice) => ({
        id: invoice.id,
        invoiceDate: invoice.invoiceDate,
        createdAt: invoice.createdAt,
        cancelled: invoice.cancelledAt !== null,
        lines: lines.get(invoice.id) ?? [],
        approvedStatus: invoice.approvedStatus,
      })),
    }
    result.set(orderId, { input, invoices: orderInvoices, matches: matchOrderInvoices(input) })
  }
  return result
}

/** Faturanın eşleştirmesi; siparişsiz faturada `null`. */
export async function invoiceMatchFor(
  db: Database,
  institutionId: string,
  invoice: { id: string; purchaseOrderId: string | null },
): Promise<{ match: InvoiceMatch; stored: StoredMatchInvoice } | null> {
  if (invoice.purchaseOrderId === null) return null
  const matching = (await loadOrderMatchings(db, institutionId, [invoice.purchaseOrderId])).get(
    invoice.purchaseOrderId,
  )
  const match = matching?.matches.get(invoice.id)
  const stored = matching?.invoices.find((item) => item.id === invoice.id)
  return match === undefined || stored === undefined ? null : { match, stored }
}

/** Ödeme girişinde faturanın eşleştirmesi (K-282); siparişsiz faturada `null`. */
export async function paymentInvoiceMatch(
  db: Database,
  institutionId: string,
  invoiceId: string,
): Promise<InvoiceMatch | null> {
  const orderId = await findInvoiceOrderId(db, institutionId, invoiceId)
  return (
    (await invoiceMatchFor(db, institutionId, { id: invoiceId, purchaseOrderId: orderId }))
      ?.match ?? null
  )
}

// --- Sipariş özeti -------------------------------------------------------------------------------

/**
 * Siparişin fatura ve kabul özeti (sipariş ayrıntısı): kalem başına sipariş, kabul edilen ve etkin
 * faturalarda faturalanan miktar; siparişe bağlı faturalar eşleştirme durumuyla. Olmayan ya da
 * başka kurumun siparişi 404.
 */
export async function purchaseOrderMatchingFor(ctx: ServiceContext, orderId: string) {
  const order = await findPurchaseOrder(ctx.db, ctx.institutionId, orderId)
  if (order === null) throw new NotFoundError()
  const matching = (await loadOrderMatchings(ctx.db, ctx.institutionId, [orderId])).get(orderId)
  if (matching === undefined) throw new NotFoundError()
  const summary = orderMatchSummary(matching.input, matching.matches)
  return {
    order: { id: order.id, number: order.number, status: order.status },
    status: summary.status,
    items: summary.items,
    invoices: [...matching.invoices]
      .sort(
        (a, b) =>
          a.invoiceDate.localeCompare(b.invoiceDate) || a.createdAt.localeCompare(b.createdAt),
      )
      .map((invoice) => {
        const match = matching.matches.get(invoice.id)
        return {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          grossCents: invoice.grossCents,
          cancelled: invoice.cancelledAt !== null,
          status: match?.status ?? 'unmatched',
          approved: match?.approved ?? false,
          approvalRequired: match?.approvalRequired ?? false,
        }
      }),
  }
}

// --- Eşleşmeyen faturalar ------------------------------------------------------------------------

export interface InvoiceMatchQuery {
  page: number
  pageSize: number
  status: InvoiceMatchFilter
  approval?: InvoiceMatchApprovalFilter | undefined
  supplierId?: string | undefined
  q?: string | undefined
}

/**
 * Siparişe bağlı iptal edilmemiş faturalar eşleştirme durumuyla; süzgeç ve arama core kuralıyla,
 * yeni fatura tarihi önce. Fatura sayısı kurum başına küçüktür; eşleştirme bellekte hesaplanır.
 */
async function matchRows(ctx: ServiceContext, query: Omit<InvoiceMatchQuery, 'page' | 'pageSize'>) {
  const orderIds = await loadMatchedOrderIds(ctx.db, ctx.institutionId)
  const matchings = await loadOrderMatchings(ctx.db, ctx.institutionId, orderIds)
  const active = [...matchings.values()].flatMap((matching) =>
    matching.invoices
      .filter((invoice) => invoice.cancelledAt === null)
      .map((invoice) => ({ invoice, match: matching.matches.get(invoice.id) })),
  )
  const needle = query.q === undefined ? null : foldSearch(query.q.replace(/\s+/g, ''))
  const filtered = active.filter(
    (row): row is { invoice: StoredMatchInvoice; match: InvoiceMatch } =>
      row.match !== undefined &&
      matchesFilter(row.match, query) &&
      (query.supplierId === undefined || row.invoice.supplierId === query.supplierId) &&
      (needle === null ||
        [row.invoice.invoiceNumber, row.invoice.supplierName, row.invoice.orderNumber].some(
          (text) => foldSearch(text.replace(/\s+/g, '')).includes(needle),
        )),
  )
  const paid = await loadInvoicePaidCents(
    ctx.db,
    ctx.institutionId,
    filtered.map((row) => row.invoice.id),
  )
  return filtered
    .sort(
      (a, b) =>
        b.invoice.invoiceDate.localeCompare(a.invoice.invoiceDate) ||
        b.invoice.createdAt.localeCompare(a.invoice.createdAt) ||
        a.invoice.id.localeCompare(b.invoice.id),
    )
    .map(({ invoice, match }) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      supplier: { id: invoice.supplierId, name: invoice.supplierName },
      purchaseOrder: { id: invoice.purchaseOrderId, number: invoice.orderNumber },
      grossCents: invoice.grossCents,
      remainingCents: Math.max(invoice.grossCents - (paid.get(invoice.id) ?? 0), 0),
      status: match.status,
      approved: match.approved,
      approvalRequired: match.approvalRequired,
      approvedAt: match.approved ? invoice.approvedAt : null,
      ...matchIssueCounts(match),
    }))
}

export async function listInvoiceMatchesFor(ctx: ServiceContext, query: InvoiceMatchQuery) {
  const { page, pageSize, ...filters } = query
  const rows = await matchRows(ctx, filters)
  const start = (page - 1) * pageSize
  return { items: rows.slice(start, start + pageSize), total: rows.length }
}

/**
 * Eşleşmeyen faturalar CSV'si. Şahıs tedarikçinin adı kişisel veri olduğu için dosya denetime
 * yazılır (`finance.invoice_matching_export`); süzgeç listeyle aynıdır, sayfalama yoktur.
 */
export async function invoiceMatchCsvFor(
  ctx: ServiceContext,
  query: Omit<InvoiceMatchQuery, 'page' | 'pageSize'>,
): Promise<{ csv: string; filename: string }> {
  const rows = await matchRows(ctx, query)
  const csv = invoiceMatchCsv(
    rows.map((row): InvoiceMatchRow => ({
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      supplierName: row.supplier.name,
      orderNumber: row.purchaseOrder.number,
      grossCents: row.grossCents,
      remainingCents: row.remainingCents,
      status: row.status,
      approved: row.approved,
      quantityLines: row.quantityLines,
      priceLines: row.priceLines,
      unmatchedLines: row.unmatchedLines,
      priceDifferenceCents: row.priceDifferenceCents,
    })),
  )
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.invoice_matching_export',
    entityType: 'finance_export',
    entityId: `invoice-matching:${query.status}`,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return { csv, filename: `fatura-eslestirme-${dayKey(ctx.now)}.csv` }
}
