import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

import type {
  InvoiceMismatchStatus,
  MatchInvoiceLine,
  SupplierInvoiceLine,
} from '@kampus/school-core/lib/finance-invoice-matching.ts'

import type { Database } from './client.ts'
import { purchaseOrders } from './schema/finance-purchase-orders.ts'
import { purchaseReceiptItems, purchaseReceipts } from './schema/finance-purchase-receipts.ts'
import {
  supplierInvoiceLines,
  supplierInvoices,
  supplierPayments,
} from './schema/finance-supplier-ledger.ts'
import { suppliers } from './schema/finance-suppliers.ts'

/**
 * Tedarikçi faturası üçlü eşleştirme deposu (DOM-FIN-095; ON-277). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Eşleştirme sonucu saklanmaz; kalemler, kabul edilen miktarlar ve fark onayı
 * okunur, kural core `lib/finance-invoice-matching.ts`'tedir.
 */

const at = (value: Date | null) => (value === null ? null : value.toISOString())
const unique = (ids: readonly string[]) => [...new Set(ids)]

/** Fatura kalemlerini giriş sırasıyla yazar (fatura girişiyle aynı işlemde). */
export async function insertInvoiceLines(
  tx: Database,
  institutionId: string,
  invoiceId: string,
  lines: readonly SupplierInvoiceLine[],
  now: Date,
): Promise<void> {
  if (lines.length === 0) return
  await tx.insert(supplierInvoiceLines).values(
    lines.map((line, position) => ({
      institutionId,
      id: randomUUID(),
      invoiceId,
      position,
      orderItemId: line.orderItemId,
      description: line.description,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/** Faturaların kalemleri, sırayla. */
export async function loadInvoiceLines(
  db: Database,
  institutionId: string,
  invoiceIds: readonly string[],
): Promise<Map<string, MatchInvoiceLine[]>> {
  if (invoiceIds.length === 0) return new Map()
  const rows = await db
    .select({
      invoiceId: supplierInvoiceLines.invoiceId,
      orderItemId: supplierInvoiceLines.orderItemId,
      description: supplierInvoiceLines.description,
      quantity: supplierInvoiceLines.quantity,
      unitPriceCents: supplierInvoiceLines.unitPriceCents,
    })
    .from(supplierInvoiceLines)
    .where(
      and(
        eq(supplierInvoiceLines.institutionId, institutionId),
        isNull(supplierInvoiceLines.archivedAt),
        inArray(supplierInvoiceLines.invoiceId, unique(invoiceIds)),
      ),
    )
    .orderBy(asc(supplierInvoiceLines.position))
  const byInvoice = new Map<string, MatchInvoiceLine[]>()
  for (const { invoiceId, ...line } of rows) {
    const list = byInvoice.get(invoiceId) ?? []
    list.push(line)
    byInvoice.set(invoiceId, list)
  }
  return byInvoice
}

export interface StoredMatchInvoice {
  id: string
  purchaseOrderId: string
  orderNumber: string
  invoiceNumber: string
  invoiceDate: string
  supplierId: string
  supplierName: string
  grossCents: number
  createdAt: string
  cancelledAt: string | null
  approvedStatus: InvoiceMismatchStatus | null
  approvedAt: string | null
  approvedByUserId: string | null
  approvalReason: string | null
  version: number
}

/** Siparişlere bağlı faturalar (iptal edilenler dahil); eşleştirme sırası core'dadır. */
export async function loadOrderInvoices(
  db: Database,
  institutionId: string,
  orderIds: readonly string[],
): Promise<StoredMatchInvoice[]> {
  if (orderIds.length === 0) return []
  const rows = await db
    .select({
      id: supplierInvoices.id,
      purchaseOrderId: supplierInvoices.purchaseOrderId,
      orderNumber: purchaseOrders.number,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      supplierId: supplierInvoices.supplierId,
      supplierName: suppliers.name,
      grossCents: supplierInvoices.grossCents,
      createdAt: supplierInvoices.createdAt,
      cancelledAt: supplierInvoices.cancelledAt,
      approvedStatus: supplierInvoices.matchApprovedStatus,
      approvedAt: supplierInvoices.matchApprovedAt,
      approvedByUserId: supplierInvoices.matchApprovedByUserId,
      approvalReason: supplierInvoices.matchApprovalReason,
      version: supplierInvoices.version,
    })
    .from(supplierInvoices)
    .innerJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.institutionId, supplierInvoices.institutionId),
        eq(purchaseOrders.id, supplierInvoices.purchaseOrderId),
      ),
    )
    .innerJoin(
      suppliers,
      and(
        eq(suppliers.institutionId, supplierInvoices.institutionId),
        eq(suppliers.id, supplierInvoices.supplierId),
      ),
    )
    .where(
      and(
        eq(supplierInvoices.institutionId, institutionId),
        isNull(supplierInvoices.archivedAt),
        inArray(supplierInvoices.purchaseOrderId, unique(orderIds)),
      ),
    )
  return rows.map((row) => ({
    ...row,
    purchaseOrderId: row.purchaseOrderId ?? '',
    createdAt: row.createdAt.toISOString(),
    cancelledAt: at(row.cancelledAt),
    approvedAt: at(row.approvedAt),
  }))
}

/** Siparişi olan iptal edilmemiş faturaların siparişleri (eşleşmeyen faturalar listesi). */
export async function loadMatchedOrderIds(db: Database, institutionId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ orderId: supplierInvoices.purchaseOrderId })
    .from(supplierInvoices)
    .where(
      and(
        eq(supplierInvoices.institutionId, institutionId),
        isNull(supplierInvoices.archivedAt),
        isNull(supplierInvoices.cancelledAt),
        isNotNull(supplierInvoices.purchaseOrderId),
      ),
    )
  return rows.map((row) => row.orderId).filter((id): id is string => id !== null)
}

/** Sipariş kalemi başına iptal edilmemiş kabullerde kabul edilen miktar (DOM-FIN-074). */
export async function loadAcceptedQuantities(
  db: Database,
  institutionId: string,
  orderIds: readonly string[],
): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map()
  const rows = await db
    .select({
      orderItemId: purchaseReceiptItems.orderItemId,
      accepted: sql<string>`sum(${purchaseReceiptItems.acceptedQuantity})`,
    })
    .from(purchaseReceiptItems)
    .innerJoin(
      purchaseReceipts,
      and(
        eq(purchaseReceipts.institutionId, purchaseReceiptItems.institutionId),
        eq(purchaseReceipts.id, purchaseReceiptItems.receiptId),
      ),
    )
    .where(
      and(
        eq(purchaseReceiptItems.institutionId, institutionId),
        isNull(purchaseReceiptItems.archivedAt),
        isNull(purchaseReceipts.archivedAt),
        isNull(purchaseReceipts.cancelledAt),
        inArray(purchaseReceipts.orderId, unique(orderIds)),
      ),
    )
    .groupBy(purchaseReceiptItems.orderItemId)
  return new Map(rows.map((row) => [row.orderItemId, Number(row.accepted)]))
}

/** Faturalara yazılmış iptal edilmemiş ödemelerin toplamı (liste ve CSV'deki kalan). */
export async function loadInvoicePaidCents(
  db: Database,
  institutionId: string,
  invoiceIds: readonly string[],
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map()
  const rows = await db
    .select({
      invoiceId: supplierPayments.invoiceId,
      paid: sql<string>`sum(${supplierPayments.amountCents})`,
    })
    .from(supplierPayments)
    .where(
      and(
        eq(supplierPayments.institutionId, institutionId),
        isNull(supplierPayments.archivedAt),
        isNull(supplierPayments.cancelledAt),
        inArray(supplierPayments.invoiceId, unique(invoiceIds)),
      ),
    )
    .groupBy(supplierPayments.invoiceId)
  return new Map(rows.map((row) => [row.invoiceId, Number(row.paid)]))
}

/** Fark onayını yazar; sürüm tutmazsa `false` (409). */
export async function approveInvoiceMatchRow(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    status: InvoiceMismatchStatus
    reason: string
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(supplierInvoices)
    .set({
      matchApprovedStatus: input.status,
      matchApprovedAt: input.now,
      matchApprovedByUserId: input.userId,
      matchApprovalReason: input.reason,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(supplierInvoices.institutionId, institutionId),
        isNull(supplierInvoices.archivedAt),
        eq(supplierInvoices.id, input.id),
        eq(supplierInvoices.version, input.expectedVersion),
      ),
    )
    .returning({ id: supplierInvoices.id })
  return rows.length === 1
}

/** Faturanın bağlı siparişi; siparişsiz ya da bulunmayan faturada `null`. */
export async function findInvoiceOrderId(
  db: Database,
  institutionId: string,
  invoiceId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ orderId: supplierInvoices.purchaseOrderId })
    .from(supplierInvoices)
    .where(
      and(
        eq(supplierInvoices.institutionId, institutionId),
        isNull(supplierInvoices.archivedAt),
        eq(supplierInvoices.id, invoiceId),
      ),
    )
    .limit(1)
  return row?.orderId ?? null
}
