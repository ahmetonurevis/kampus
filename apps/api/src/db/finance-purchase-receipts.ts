import { randomUUID } from 'node:crypto'

import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm'

import type {
  PeriodRange,
  ReceiptExpenseRow,
} from '@kampus/school-core/lib/finance-purchase-receipts.ts'

import type { Database } from './client.ts'
import { budgetPeriods } from './schema/finance-budget.ts'
import { purchaseOrderItems, purchaseOrders } from './schema/finance-purchase-orders.ts'
import { purchaseReceiptItems, purchaseReceipts } from './schema/finance-purchase-receipts.ts'
import { purchaseRequests } from './schema/finance-purchase-requests.ts'

/**
 * Mal kabul deposu (DOM-FIN-074; ON-226). Kurum kapsamlıdır: ilk parametre `institutionId`. Kural
 * core `lib/finance-purchase-receipts.ts`'tedir; tutar saklanmaz, kabul edilen miktar ve siparişteki
 * KDV hariç birim fiyattan hesaplanır (K-151).
 */

export interface StoredReceiptLine {
  id: string
  orderItemId: string
  acceptedQuantity: number
  rejectedQuantity: number
  rejectReason: string | null
}

export interface StoredReceipt {
  id: string
  orderId: string
  receiptDate: string
  receivedBy: string
  inspectionNote: string | null
  createdByUserId: string
  createdAt: string
  cancelledAt: string | null
  cancelledByUserId: string | null
  cancelReason: string | null
  version: number
  lines: StoredReceiptLine[]
}

const activeReceipt = (institutionId: string) =>
  and(eq(purchaseReceipts.institutionId, institutionId), isNull(purchaseReceipts.archivedAt))

/** Siparişin bütün kabulleri (iptal edilenler dahil), kabul günü ve giriş sırasıyla. */
export async function loadOrderReceipts(
  db: Database,
  institutionId: string,
  orderId: string,
): Promise<StoredReceipt[]> {
  const rows = await db
    .select({
      id: purchaseReceipts.id,
      orderId: purchaseReceipts.orderId,
      receiptDate: purchaseReceipts.receiptDate,
      receivedBy: purchaseReceipts.receivedBy,
      inspectionNote: purchaseReceipts.inspectionNote,
      createdByUserId: purchaseReceipts.createdByUserId,
      createdAt: purchaseReceipts.createdAt,
      cancelledAt: purchaseReceipts.cancelledAt,
      cancelledByUserId: purchaseReceipts.cancelledByUserId,
      cancelReason: purchaseReceipts.cancelReason,
      version: purchaseReceipts.version,
    })
    .from(purchaseReceipts)
    .where(and(activeReceipt(institutionId), eq(purchaseReceipts.orderId, orderId)))
    .orderBy(
      asc(purchaseReceipts.receiptDate),
      asc(purchaseReceipts.createdAt),
      asc(purchaseReceipts.id),
    )
  if (rows.length === 0) return []
  const lines = await db
    .select({
      receiptId: purchaseReceiptItems.receiptId,
      id: purchaseReceiptItems.id,
      orderItemId: purchaseReceiptItems.orderItemId,
      acceptedQuantity: purchaseReceiptItems.acceptedQuantity,
      rejectedQuantity: purchaseReceiptItems.rejectedQuantity,
      rejectReason: purchaseReceiptItems.rejectReason,
    })
    .from(purchaseReceiptItems)
    .innerJoin(
      purchaseOrderItems,
      and(
        eq(purchaseOrderItems.institutionId, purchaseReceiptItems.institutionId),
        eq(purchaseOrderItems.id, purchaseReceiptItems.orderItemId),
      ),
    )
    .where(
      and(
        eq(purchaseReceiptItems.institutionId, institutionId),
        inArray(
          purchaseReceiptItems.receiptId,
          rows.map((row) => row.id),
        ),
        isNull(purchaseReceiptItems.archivedAt),
      ),
    )
    .orderBy(asc(purchaseOrderItems.position))
  const byReceipt = new Map<string, StoredReceiptLine[]>()
  for (const { receiptId, ...line } of lines) {
    const list = byReceipt.get(receiptId) ?? []
    list.push(line)
    byReceipt.set(receiptId, list)
  }
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    cancelledAt: row.cancelledAt === null ? null : row.cancelledAt.toISOString(),
    lines: byReceipt.get(row.id) ?? [],
  }))
}

/** Kurumun kapalı bütçe dönemleri (kabul günü bunlara düşemez; K-153). */
export async function loadClosedBudgetPeriods(
  db: Database,
  institutionId: string,
): Promise<PeriodRange[]> {
  return db
    .select({ startDate: budgetPeriods.startDate, endDate: budgetPeriods.endDate })
    .from(budgetPeriods)
    .where(
      and(
        eq(budgetPeriods.institutionId, institutionId),
        eq(budgetPeriods.status, 'closed'),
        isNull(budgetPeriods.archivedAt),
      ),
    )
}

export async function insertReceipt(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    orderId: string
    receiptDate: string
    receivedBy: string
    inspectionNote: string | null
    createdByUserId: string
    lines: readonly Omit<StoredReceiptLine, 'id'>[]
    now: Date
  },
): Promise<void> {
  const { now, lines, ...fields } = input
  await tx
    .insert(purchaseReceipts)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
  await tx.insert(purchaseReceiptItems).values(
    lines.map((line) => ({
      ...line,
      institutionId,
      id: randomUUID(),
      receiptId: input.id,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/** Kabulü iptal eder; sürüm tutmazsa ya da zaten iptal edildiyse `false` (409). */
export async function cancelReceipt(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    cancelledByUserId: string
    cancelReason: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(purchaseReceipts)
    .set({
      cancelledAt: input.now,
      cancelledByUserId: input.cancelledByUserId,
      cancelReason: input.cancelReason,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        activeReceipt(institutionId),
        eq(purchaseReceipts.id, input.id),
        eq(purchaseReceipts.version, input.expectedVersion),
        isNull(purchaseReceipts.cancelledAt),
      ),
    )
    .returning({ id: purchaseReceipts.id })
  return rows.length === 1
}

const liveOrder = and(ne(purchaseOrders.status, 'cancelled'), isNull(purchaseOrders.archivedAt))

/**
 * Gider gerçekleşeni satırları (DOM-FIN-066, K-151): gün aralığındaki iptal edilmemiş kabullerin
 * kalemleri; kalem talebin gider kalemi, merkez talebin birimi, fiyat siparişin KDV hariç birim fiyatı.
 */
export async function loadReceiptExpenseRows(
  db: Database,
  institutionId: string,
  range: { startDate: string; endDate: string },
): Promise<ReceiptExpenseRow[]> {
  return db
    .select({
      itemId: purchaseRequests.budgetItemId,
      costCenterId: purchaseRequests.costCenterId,
      receiptDate: purchaseReceipts.receiptDate,
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
    .innerJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.institutionId, purchaseReceipts.institutionId),
        eq(purchaseOrders.id, purchaseReceipts.orderId),
      ),
    )
    .innerJoin(
      purchaseRequests,
      and(
        eq(purchaseRequests.institutionId, purchaseOrders.institutionId),
        eq(purchaseRequests.id, purchaseOrders.requestId),
      ),
    )
    .where(
      and(
        activeReceipt(institutionId),
        isNull(purchaseReceipts.cancelledAt),
        gte(purchaseReceipts.receiptDate, range.startDate),
        lte(purchaseReceipts.receiptDate, range.endDate),
        liveOrder,
      ),
    )
    .orderBy(asc(purchaseReceipts.receiptDate), asc(purchaseReceiptItems.id))
}

/**
 * Bütçe kalanının sipariş girdileri (DOM-FIN-071, K-145, K-154): dönem × merkez × kalem üçlüsündeki
 * taleplerin etkin (iptal edilmemiş) siparişlerinin KDV hariç toplamı ve bunun iptal edilmemiş
 * kabullerde kabul edilen kısmı. `exceptId` talebi hariç tutulur. Kurum kilidi altında okunabilir.
 */
export async function loadOrderBudgetFigures(
  db: Database,
  institutionId: string,
  key: { periodId: string; costCenterId: string; budgetItemId: string; exceptId: string | null },
): Promise<{ orderedCents: number; receivedCents: number }> {
  const sameLine = and(
    eq(purchaseRequests.institutionId, institutionId),
    eq(purchaseRequests.periodId, key.periodId),
    eq(purchaseRequests.costCenterId, key.costCenterId),
    eq(purchaseRequests.budgetItemId, key.budgetItemId),
    key.exceptId === null ? undefined : ne(purchaseRequests.id, key.exceptId),
  )
  const orderJoin = and(
    eq(purchaseRequests.institutionId, purchaseOrders.institutionId),
    eq(purchaseRequests.id, purchaseOrders.requestId),
  )
  const [ordered] = await db
    .select({
      totalCents: sql<string>`coalesce(sum(${purchaseOrderItems.quantity}::bigint * ${purchaseOrderItems.unitPriceCents}), 0)`,
    })
    .from(purchaseOrders)
    .innerJoin(purchaseRequests, orderJoin)
    .innerJoin(
      purchaseOrderItems,
      and(
        eq(purchaseOrderItems.institutionId, purchaseOrders.institutionId),
        eq(purchaseOrderItems.orderId, purchaseOrders.id),
        isNull(purchaseOrderItems.archivedAt),
      ),
    )
    .where(and(eq(purchaseOrders.institutionId, institutionId), liveOrder, sameLine))
  const [received] = await db
    .select({
      totalCents: sql<string>`coalesce(sum(${purchaseReceiptItems.acceptedQuantity}::bigint * ${purchaseOrderItems.unitPriceCents}), 0)`,
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
    .innerJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.institutionId, purchaseReceipts.institutionId),
        eq(purchaseOrders.id, purchaseReceipts.orderId),
      ),
    )
    .innerJoin(purchaseRequests, orderJoin)
    .where(
      and(activeReceipt(institutionId), isNull(purchaseReceipts.cancelledAt), liveOrder, sameLine),
    )
  const receivedCents = Number(received?.totalCents ?? 0)
  return { orderedCents: Number(ordered?.totalCents ?? 0) - receivedCents, receivedCents }
}

/** Talebin etkin siparişi var mı ifadesi: bütçe kalanında onaylı talebin yerine sipariş sayılır. */
export const requestHasLiveOrder = sql`exists (select 1 from ${purchaseOrders} where ${purchaseOrders.institutionId} = ${purchaseRequests.institutionId} and ${purchaseOrders.requestId} = ${purchaseRequests.id} and ${purchaseOrders.status} <> 'cancelled' and ${purchaseOrders.archivedAt} is null)`
