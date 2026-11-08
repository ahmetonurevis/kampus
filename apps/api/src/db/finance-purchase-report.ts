import { and, eq, gte, inArray, isNull, lt, type SQL } from 'drizzle-orm'

import type {
  PurchaseReportOrder,
  PurchaseReportSupplier,
} from '@kampus/school-core/lib/finance-purchase-report.ts'

import type { Database } from './client.ts'
import { loadOrderItems } from './finance-purchase-orders.ts'
import { purchaseOrders } from './schema/finance-purchase-orders.ts'
import { purchaseRequests } from './schema/finance-purchase-requests.ts'
import { suppliers } from './schema/finance-suppliers.ts'

/**
 * Satın alma raporu deposu (DOM-FIN-075; ON-227). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Siparişler talebin dönem, merkez ve kalem alanlarıyla birlikte okunur; kesin gün süzmesi ve
 * iptal ayrımı core'dadır (`purchaseReport`). Tedarikçinin vergi numarası ve iletişim bilgisi
 * okunmaz (K-155).
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
