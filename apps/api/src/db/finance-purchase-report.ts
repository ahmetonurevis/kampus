import { and, between, eq, gte, inArray, isNull, lt, or, type SQL } from 'drizzle-orm'

import type {
  PurchaseReportInvoice,
  PurchaseReportOrder,
  PurchaseReportPayment,
  PurchaseReportReceiptLine,
  PurchaseReportSupplier,
} from '@kampus/school-core/lib/finance-purchase-report.ts'

import type { Database } from './client.ts'
import { loadOrderItems } from './finance-purchase-orders.ts'
import { purchaseOrderItems, purchaseOrders } from './schema/finance-purchase-orders.ts'
import { purchaseReceiptItems, purchaseReceipts } from './schema/finance-purchase-receipts.ts'
import { purchaseRequests } from './schema/finance-purchase-requests.ts'
import { supplierInvoices, supplierPayments } from './schema/finance-supplier-ledger.ts'
import { suppliers } from './schema/finance-suppliers.ts'

/**
 * Satın alma raporu deposu (DOM-FIN-075; ON-227). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Siparişler talebin dönem, merkez ve kalem alanlarıyla birlikte okunur; kesin gün süzmesi ve
 * iptal ayrımı core'dadır (`purchaseReport`). Kabul, fatura ve ödeme iptal edilenlerle birlikte
 * okunur; iptal süzmesi de core'dadır (K-195…K-198). Tedarikçinin vergi numarası ve iletişim
 * bilgisi okunmaz (K-155).
 */

const at = (value: Date | null) => (value === null ? null : value.toISOString())

/** Bütçe dönemi ya da açılış anı penceresi (İstanbul gününün iki yanını kapsar). */
export type PurchaseReportWindow = { periodId: string } | { createdFrom: Date; createdBefore: Date }

export async function loadPurchaseReportOrders(
  db: Database,
  institutionId: string,
  window: PurchaseReportWindow,
): Promise<PurchaseReportOrder[]> {
  const filters: SQL[] = []
  if ('periodId' in window) filters.push(eq(purchaseRequests.periodId, window.periodId))
  else
    filters.push(
      gte(purchaseOrders.createdAt, window.createdFrom),
      lt(purchaseOrders.createdAt, window.createdBefore),
    )
  const rows = await db
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
      createdAt: purchaseOrders.createdAt,
      supplierId: purchaseOrders.supplierId,
      periodId: purchaseRequests.periodId,
      costCenterId: purchaseRequests.costCenterId,
      budgetItemId: purchaseRequests.budgetItemId,
      requestSubmittedAt: purchaseRequests.submittedAt,
      requestCreatedAt: purchaseRequests.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(
      purchaseRequests,
      and(
        eq(purchaseRequests.institutionId, purchaseOrders.institutionId),
        eq(purchaseRequests.id, purchaseOrders.requestId),
      ),
    )
    .where(
      and(
        eq(purchaseOrders.institutionId, institutionId),
        isNull(purchaseOrders.archivedAt),
        ...filters,
      ),
    )
  const items = await loadOrderItems(
    db,
    institutionId,
    rows.map((row) => row.id),
  )
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    requestSubmittedAt: at(row.requestSubmittedAt),
    requestCreatedAt: row.requestCreatedAt.toISOString(),
    lines: items.get(row.id) ?? [],
  }))
}

/** Raporda geçen tedarikçilerin adı, türü, kategorileri ve etkinliği. */
export async function loadPurchaseReportSuppliers(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<PurchaseReportSupplier[]> {
  if (ids.length === 0) return []
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      type: suppliers.type,
      categories: suppliers.categories,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.institutionId, institutionId),
        isNull(suppliers.archivedAt),
        inArray(suppliers.id, [...new Set(ids)]),
      ),
    )
}

/**
 * Siparişlerin kabul kalemleri (DOM-FIN-074): kabul edilen miktar ve siparişin KDV hariç birim
 * fiyatı. Kabul günü süzülmez (K-196); iptal edilen kabul de döner, core saymaz.
 */
export async function loadPurchaseReportReceiptLines(
  db: Database,
  institutionId: string,
  orderIds: readonly string[],
): Promise<PurchaseReportReceiptLine[]> {
  if (orderIds.length === 0) return []
  const rows = await db
    .select({
      orderId: purchaseReceipts.orderId,
      cancelledAt: purchaseReceipts.cancelledAt,
      acceptedQuantity: purchaseReceiptItems.acceptedQuantity,
      unitPriceCents: purchaseOrderItems.unitPriceCents,
    })
    .from(purchaseReceipts)
    .innerJoin(
      purchaseReceiptItems,
      and(
        eq(purchaseReceiptItems.institutionId, purchaseReceipts.institutionId),
        eq(purchaseReceiptItems.receiptId, purchaseReceipts.id),
        isNull(purchaseReceiptItems.archivedAt),
      ),
    )
    .innerJoin(
      purchaseOrderItems,
      and(
        eq(purchaseOrderItems.institutionId, purchaseReceiptItems.institutionId),
        eq(purchaseOrderItems.id, purchaseReceiptItems.orderItemId),
      ),
    )
    .where(
      and(
        eq(purchaseReceipts.institutionId, institutionId),
        isNull(purchaseReceipts.archivedAt),
        inArray(purchaseReceipts.orderId, [...new Set(orderIds)]),
      ),
    )
  return rows.map((row) => ({ ...row, cancelledAt: at(row.cancelledAt) }))
}

/**
 * Rapordaki faturalar (DOM-FIN-076): kapsamdaki siparişlere bağlı olanlar (fatura günü süzülmez,
 * K-196) ve fatura günü verilen günlerde olan siparişsiz faturalar (K-197). İptal edilenler de
 * döner; tutar KDV dahildir.
 */
export async function loadPurchaseReportInvoices(
  db: Database,
  institutionId: string,
  orderIds: readonly string[],
  invoiceDays: { from: string; to: string },
): Promise<PurchaseReportInvoice[]> {
  const unlinked = and(
    isNull(supplierInvoices.purchaseOrderId),
    between(supplierInvoices.invoiceDate, invoiceDays.from, invoiceDays.to),
  )
  const rows = await db
    .select({
      id: supplierInvoices.id,
      supplierId: supplierInvoices.supplierId,
      purchaseOrderId: supplierInvoices.purchaseOrderId,
      invoiceDate: supplierInvoices.invoiceDate,
      grossCents: supplierInvoices.grossCents,
      cancelledAt: supplierInvoices.cancelledAt,
    })
    .from(supplierInvoices)
    .where(
      and(
        eq(supplierInvoices.institutionId, institutionId),
        isNull(supplierInvoices.archivedAt),
        orderIds.length === 0
          ? unlinked
          : or(inArray(supplierInvoices.purchaseOrderId, [...new Set(orderIds)]), unlinked),
      ),
    )
  return rows.map((row) => ({ ...row, cancelledAt: at(row.cancelledAt) }))
}

/** Faturaların ödemeleri; ödeme günü süzülmez (K-196), iptal edilen ödeme de döner. */
export async function loadPurchaseReportPayments(
  db: Database,
  institutionId: string,
  invoiceIds: readonly string[],
): Promise<PurchaseReportPayment[]> {
  if (invoiceIds.length === 0) return []
  const rows = await db
    .select({
      invoiceId: supplierPayments.invoiceId,
      amountCents: supplierPayments.amountCents,
      cancelledAt: supplierPayments.cancelledAt,
    })
    .from(supplierPayments)
    .where(
      and(
        eq(supplierPayments.institutionId, institutionId),
        isNull(supplierPayments.archivedAt),
        inArray(supplierPayments.invoiceId, [...new Set(invoiceIds)]),
      ),
    )
  return rows.map((row) => ({ ...row, cancelledAt: at(row.cancelledAt) }))
}
