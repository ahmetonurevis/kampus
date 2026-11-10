import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'

import {
  STOCK_INBOUND_TYPES,
  type CancellableMovement,
  type StockCategory,
  type StockEntryReason,
  type StockIssueReason,
  type StockItemFields,
  type StockMovementType,
  type StockUnit,
  type StockWarehouseFields,
} from '@kampus/school-core/lib/finance-inventory.ts'

import type { Database } from './client.ts'
import { stockItems, stockMovements, stockWarehouses } from './schema/finance-inventory.ts'
import { purchaseOrderItems, purchaseOrders } from './schema/finance-purchase-orders.ts'
import { purchaseReceiptItems, purchaseReceipts } from './schema/finance-purchase-receipts.ts'

/**
 * Stok kartı, depo ve hareket deposu (DOM-FIN-077, DOM-FIN-078; ON-228, ON-229). Kurum
 * kapsamlıdır: ilk parametre `institutionId`. Kural core `lib/finance-inventory.ts`'tedir; miktar
 * saklanmaz, iptal edilmemiş hareketlerden toplanır.
 */

export interface StoredStockItem {
  id: string
  code: string
  name: string
  category: StockCategory
  unit: StockUnit
  minQuantity: number | null
  isActive: boolean
  version: number
}

export interface StoredStockWarehouse {
  id: string
  name: string
  campusId: string
  note: string | null
  isActive: boolean
  version: number
}

export interface StoredStockMovement extends CancellableMovement {
  reason: StockEntryReason | StockIssueReason | null
  note: string | null
  receiptItemId: string | null
  createdByUserId: string
  createdAt: string
  cancelledByUserId: string | null
  cancelReason: string | null
  version: number
}

const ITEM_COLUMNS = {
  id: stockItems.id,
  code: stockItems.code,
  name: stockItems.name,
  category: stockItems.category,
  unit: stockItems.unit,
  minQuantity: stockItems.minQuantity,
  isActive: stockItems.isActive,
  version: stockItems.version,
}
const WAREHOUSE_COLUMNS = {
  id: stockWarehouses.id,
  name: stockWarehouses.name,
  campusId: stockWarehouses.campusId,
  note: stockWarehouses.note,
  isActive: stockWarehouses.isActive,
  version: stockWarehouses.version,
}
const MOVEMENT_COLUMNS = {
  id: stockMovements.id,
  itemId: stockMovements.itemId,
  warehouseId: stockMovements.warehouseId,
  type: stockMovements.type,
  quantity: stockMovements.quantity,
  movementDate: stockMovements.movementDate,
  reason: stockMovements.reason,
  note: stockMovements.note,
  transferId: stockMovements.transferId,
  receiptId: stockMovements.receiptId,
  receiptItemId: stockMovements.receiptItemId,
  createdByUserId: stockMovements.createdByUserId,
  createdAt: stockMovements.createdAt,
  cancelledAt: stockMovements.cancelledAt,
  cancelledByUserId: stockMovements.cancelledByUserId,
  cancelReason: stockMovements.cancelReason,
  version: stockMovements.version,
}

type MovementRow = Omit<StoredStockMovement, 'createdAt' | 'cancelledAt' | 'reason'> & {
  reason: string | null
  createdAt: Date
  cancelledAt: Date | null
}
const toMovement = (row: MovementRow): StoredStockMovement => ({
  ...row,
  reason: row.reason as StoredStockMovement['reason'],
  createdAt: row.createdAt.toISOString(),
  cancelledAt: row.cancelledAt === null ? null : row.cancelledAt.toISOString(),
})

const itemsOf = (institutionId: string) =>
  and(eq(stockItems.institutionId, institutionId), isNull(stockItems.archivedAt))
const warehousesOf = (institutionId: string) =>
  and(eq(stockWarehouses.institutionId, institutionId), isNull(stockWarehouses.archivedAt))
const movementsOf = (institutionId: string) =>
  and(eq(stockMovements.institutionId, institutionId), isNull(stockMovements.archivedAt))

// --- Stok kartı ----------------------------------------------------------------------------------

/** Kurumun bütün stok kartları (pasifler dahil), koda göre. */
export async function loadStockItems(
  db: Database,
  institutionId: string,
): Promise<StoredStockItem[]> {
  return db
    .select(ITEM_COLUMNS)
    .from(stockItems)
    .where(itemsOf(institutionId))
    .orderBy(asc(stockItems.code), asc(stockItems.id))
}

export async function loadStockItemsByIds(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<StoredStockItem[]> {
  if (ids.length === 0) return []
  return db
    .select(ITEM_COLUMNS)
    .from(stockItems)
    .where(and(itemsOf(institutionId), inArray(stockItems.id, [...new Set(ids)])))
}

export async function insertStockItem(
  tx: Database,
  institutionId: string,
  input: StockItemFields & { id: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(stockItems).values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateStockItem(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<StockItemFields> & { isActive?: boolean }
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(stockItems)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        itemsOf(institutionId),
        eq(stockItems.id, input.id),
        eq(stockItems.version, input.expectedVersion),
      ),
    )
    .returning({ id: stockItems.id })
  return rows.length === 1
}

// --- Depo ----------------------------------------------------------------------------------------

/** Kurumun bütün depoları (pasifler dahil), ada göre. */
export async function loadStockWarehouses(
  db: Database,
  institutionId: string,
): Promise<StoredStockWarehouse[]> {
  return db
    .select(WAREHOUSE_COLUMNS)
    .from(stockWarehouses)
    .where(warehousesOf(institutionId))
    .orderBy(asc(stockWarehouses.name), asc(stockWarehouses.id))
}

export async function insertStockWarehouse(
  tx: Database,
  institutionId: string,
  input: StockWarehouseFields & { id: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(stockWarehouses)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateStockWarehouse(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<StockWarehouseFields> & { isActive?: boolean }
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(stockWarehouses)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        warehousesOf(institutionId),
        eq(stockWarehouses.id, input.id),
        eq(stockWarehouses.version, input.expectedVersion),
      ),
    )
    .returning({ id: stockWarehouses.id })
  return rows.length === 1
}

// --- Miktar --------------------------------------------------------------------------------------

export interface StockBalanceRow {
  itemId: string
  warehouseId: string
  quantity: number
}

/** Ürün × depo miktarları (iptal edilmemiş hareketlerin toplamı); sıfır olanlar da döner. */
export async function loadStockBalances(
  db: Database,
  institutionId: string,
  filter: { itemId?: string; warehouseId?: string } = {},
): Promise<StockBalanceRow[]> {
  const rows = await db
    .select({
      itemId: stockMovements.itemId,
      warehouseId: stockMovements.warehouseId,
      quantity: sql<string>`sum(case when ${inArray(stockMovements.type, [...STOCK_INBOUND_TYPES])} then ${stockMovements.quantity} else -${stockMovements.quantity} end)`,
    })
    .from(stockMovements)
    .where(
      and(
        movementsOf(institutionId),
        isNull(stockMovements.cancelledAt),
        filter.itemId === undefined ? undefined : eq(stockMovements.itemId, filter.itemId),
        filter.warehouseId === undefined
          ? undefined
          : eq(stockMovements.warehouseId, filter.warehouseId),
      ),
    )
    .groupBy(stockMovements.itemId, stockMovements.warehouseId)
  return rows.map((row) => ({ ...row, quantity: Number(row.quantity) }))
}

/** Kartın (iptal edilmiş dahil) hareketi var mı; varsa birimi değişmez (K-182). */
export async function stockItemHasMovements(
  db: Database,
  institutionId: string,
  itemId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(and(movementsOf(institutionId), eq(stockMovements.itemId, itemId)))
    .limit(1)
  return row !== undefined
}

// --- Hareket -------------------------------------------------------------------------------------

/** Verilen ürün × depo çiftlerinin bütün hareketleri (iptal edilenler dahil); kurum kilidi altında. */
export async function loadPairMovements(
  db: Database,
  institutionId: string,
  pairs: readonly { itemId: string; warehouseId: string }[],
): Promise<StoredStockMovement[]> {
  if (pairs.length === 0) return []
  const unique = [
    ...new Map(pairs.map((pair) => [`${pair.itemId}|${pair.warehouseId}`, pair])).values(),
  ]
  const rows = await db
    .select(MOVEMENT_COLUMNS)
    .from(stockMovements)
    .where(
      and(
        movementsOf(institutionId),
        or(
          ...unique.map((pair) =>
            and(
              eq(stockMovements.itemId, pair.itemId),
              eq(stockMovements.warehouseId, pair.warehouseId),
            ),
          ),
        ),
      ),
    )
    .orderBy(
      asc(stockMovements.movementDate),
      asc(stockMovements.createdAt),
      asc(stockMovements.id),
    )
  return rows.map(toMovement)
}

export async function findStockMovement(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStockMovement | null> {
  const [row] = await db
    .select(MOVEMENT_COLUMNS)
    .from(stockMovements)
    .where(and(movementsOf(institutionId), eq(stockMovements.id, id)))
    .limit(1)
  return row === undefined ? null : toMovement(row)
}

/** Kabullerin stok girişleri (iptal edilenler dahil). */
export async function loadReceiptStockMovements(
  db: Database,
  institutionId: string,
  receiptIds: readonly string[],
): Promise<StoredStockMovement[]> {
  if (receiptIds.length === 0) return []
  const rows = await db
    .select(MOVEMENT_COLUMNS)
    .from(stockMovements)
    .where(and(movementsOf(institutionId), inArray(stockMovements.receiptId, [...receiptIds])))
    .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id))
  return rows.map(toMovement)
}

export interface NewStockMovement {
  id: string
  itemId: string
  warehouseId: string
  type: StockMovementType
  quantity: number
  movementDate: string
  reason: StockEntryReason | StockIssueReason | null
  note: string | null
  transferId: string | null
  receiptId: string | null
  receiptItemId: string | null
}

export async function insertStockMovements(
  tx: Database,
  institutionId: string,
  input: { movements: readonly NewStockMovement[]; createdByUserId: string; now: Date },
): Promise<void> {
  if (input.movements.length === 0) return
  await tx.insert(stockMovements).values(
    input.movements.map((movement) => ({
      ...movement,
      institutionId,
      createdByUserId: input.createdByUserId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

/** Hareketleri iptal eder; biri zaten iptal edildiyse ya da yoksa `false` (409). */
export async function cancelStockMovements(
  tx: Database,
  institutionId: string,
  input: { ids: readonly string[]; cancelledByUserId: string; cancelReason: string; now: Date },
): Promise<boolean> {
  if (input.ids.length === 0) return true
  const rows = await tx
    .update(stockMovements)
    .set({
      cancelledAt: input.now,
      cancelledByUserId: input.cancelledByUserId,
      cancelReason: input.cancelReason,
      updatedAt: input.now,
      version: sql`${stockMovements.version} + 1`,
    })
    .where(
      and(
        movementsOf(institutionId),
        inArray(stockMovements.id, [...input.ids]),
        isNull(stockMovements.cancelledAt),
      ),
    )
    .returning({ id: stockMovements.id })
  return rows.length === input.ids.length
}

export interface StockMovementQuery {
  page: number
  pageSize: number
  itemId?: string | undefined
  warehouseId?: string | undefined
  type?: StockMovementType | undefined
  from?: string | undefined
  to?: string | undefined
}

/** Hareketler, en yeni gün önce (aynı günde son kaydedilen önce). */
export async function listStockMovements(
  db: Database,
  institutionId: string,
  query: StockMovementQuery,
): Promise<{ items: StoredStockMovement[]; total: number }> {
  const filters: (SQL | undefined)[] = [
    movementsOf(institutionId),
    query.itemId === undefined ? undefined : eq(stockMovements.itemId, query.itemId),
    query.warehouseId === undefined ? undefined : eq(stockMovements.warehouseId, query.warehouseId),
    query.type === undefined ? undefined : eq(stockMovements.type, query.type),
    query.from === undefined ? undefined : gte(stockMovements.movementDate, query.from),
    query.to === undefined ? undefined : lte(stockMovements.movementDate, query.to),
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(stockMovements).where(where)
  const rows = await db
    .select(MOVEMENT_COLUMNS)
    .from(stockMovements)
    .where(where)
    .orderBy(
      desc(stockMovements.movementDate),
      desc(stockMovements.createdAt),
      // Transferin iki hareketi aynı anda yazılır: çıkış girişten önce görünür.
      desc(stockMovements.type),
      asc(stockMovements.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toMovement), total: totalRow?.total ?? 0 }
}

/** Transferlerin bütün hareketleri (karşı depoyu göstermek ve birlikte iptal için). */
export async function loadTransferMovements(
  db: Database,
  institutionId: string,
  transferIds: readonly string[],
): Promise<StoredStockMovement[]> {
  if (transferIds.length === 0) return []
  const rows = await db
    .select(MOVEMENT_COLUMNS)
    .from(stockMovements)
    .where(
      and(
        movementsOf(institutionId),
        inArray(stockMovements.transferId, [...new Set(transferIds)]),
      ),
    )
  return rows.map(toMovement)
}

/** Kabul → sipariş kimliği ve numarası (mal kabul girişinin kaynağı). */
export async function loadReceiptOrders(
  db: Database,
  institutionId: string,
  receiptIds: readonly string[],
): Promise<Map<string, { orderId: string; orderNumber: string }>> {
  if (receiptIds.length === 0) return new Map()
  const rows = await db
    .select({
      receiptId: purchaseReceipts.id,
      orderId: purchaseOrders.id,
      orderNumber: purchaseOrders.number,
    })
    .from(purchaseReceipts)
    .innerJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.institutionId, purchaseReceipts.institutionId),
        eq(purchaseOrders.id, purchaseReceipts.orderId),
      ),
    )
    .where(
      and(
        eq(purchaseReceipts.institutionId, institutionId),
        inArray(purchaseReceipts.id, [...new Set(receiptIds)]),
      ),
    )
  return new Map(rows.map(({ receiptId, ...order }) => [receiptId, order]))
}

export interface LastReceiptPrice {
  /** Sipariş kaleminin KDV hariç birim fiyatı (kuruş). */
  unitPriceCents: number
  receiptDate: string
  orderNumber: string
}

/**
 * Kartların son alış fiyatı (DOM-FIN-079, K-202): iptal edilmemiş en son mal kabul girişinin
 * sipariş kalemi birim fiyatı, KDV hariç. "Son" hareket günü, eşitlikte kayıt anı ve kimlikle
 * belirlenir (deterministik). Mal kabulden girmemiş kart haritada yoktur.
 */
export async function loadLastReceiptPrices(
  db: Database,
  institutionId: string,
  itemIds: readonly string[],
): Promise<Map<string, LastReceiptPrice>> {
  if (itemIds.length === 0) return new Map()
  const rows = await db
    .select({
      itemId: stockMovements.itemId,
      unitPriceCents: purchaseOrderItems.unitPriceCents,
      receiptDate: stockMovements.movementDate,
      orderNumber: purchaseOrders.number,
    })
    .from(stockMovements)
    .innerJoin(
      purchaseReceiptItems,
      and(
        eq(purchaseReceiptItems.institutionId, stockMovements.institutionId),
        eq(purchaseReceiptItems.id, stockMovements.receiptItemId),
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
        eq(purchaseOrders.institutionId, purchaseOrderItems.institutionId),
        eq(purchaseOrders.id, purchaseOrderItems.orderId),
      ),
    )
    .where(
      and(
        movementsOf(institutionId),
        eq(stockMovements.type, 'receipt'),
        isNull(stockMovements.cancelledAt),
        inArray(stockMovements.itemId, [...new Set(itemIds)]),
      ),
    )
    .orderBy(
      asc(stockMovements.itemId),
      desc(stockMovements.movementDate),
      desc(stockMovements.createdAt),
      desc(stockMovements.id),
    )
  const prices = new Map<string, LastReceiptPrice>()
  for (const { itemId, ...price } of rows) if (!prices.has(itemId)) prices.set(itemId, price)
  return prices
}
