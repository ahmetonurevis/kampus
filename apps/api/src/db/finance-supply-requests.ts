import { randomUUID } from 'node:crypto'

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  max,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'

import type { StockCategory, StockUnit } from '@kampus/school-core/lib/finance-inventory.ts'
import type { PurchaseRequestStatus } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import type { SupplyRequestStatus } from '@kampus/school-core/lib/finance-supply-requests.ts'

import type { Database } from './client.ts'
import { users } from './schema/auth.ts'
import { stockItems, stockMovements, stockWarehouses } from './schema/finance-inventory.ts'
import { purchaseRequests } from './schema/finance-purchase-requests.ts'
import {
  supplyRequestIssues,
  supplyRequestItems,
  supplyRequests,
} from './schema/finance-supply-requests.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Sarf malzeme talebi deposu (DOM-FIN-091; ON-233). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-supply-requests.ts`'tedir; karşılanan miktar saklanmaz,
 * talebe bağlı iptal edilmemiş `supply` çıkışlarından toplanır.
 */

const at = (value: Date | null) => (value === null ? null : value.toISOString())

export interface StoredSupplyRequest {
  id: string
  sequence: number
  status: SupplyRequestStatus
  requestedByUserId: string
  neededDate: string
  justification: string
  decidedAt: string | null
  decidedByUserId: string | null
  decisionNote: string | null
  fulfilledAt: string | null
  fulfilledByUserId: string | null
  fulfillmentNote: string | null
  cancelledAt: string | null
  cancelledByUserId: string | null
  cancelReason: string | null
  purchaseRequestId: string | null
  purchaseRequestSequence: number | null
  purchaseRequestStatus: PurchaseRequestStatus | null
  createdAt: string
  version: number
}

const COLUMNS = {
  id: supplyRequests.id,
  sequence: supplyRequests.sequence,
  status: supplyRequests.status,
  requestedByUserId: supplyRequests.requestedByUserId,
  neededDate: supplyRequests.neededDate,
  justification: supplyRequests.justification,
  decidedAt: supplyRequests.decidedAt,
  decidedByUserId: supplyRequests.decidedByUserId,
  decisionNote: supplyRequests.decisionNote,
  fulfilledAt: supplyRequests.fulfilledAt,
  fulfilledByUserId: supplyRequests.fulfilledByUserId,
  fulfillmentNote: supplyRequests.fulfillmentNote,
  cancelledAt: supplyRequests.cancelledAt,
  cancelledByUserId: supplyRequests.cancelledByUserId,
  cancelReason: supplyRequests.cancelReason,
  purchaseRequestId: supplyRequests.purchaseRequestId,
  purchaseRequestSequence: purchaseRequests.sequence,
  purchaseRequestStatus: purchaseRequests.status,
  createdAt: supplyRequests.createdAt,
  version: supplyRequests.version,
}

type Row = Omit<StoredSupplyRequest, 'decidedAt' | 'fulfilledAt' | 'cancelledAt' | 'createdAt'> & {
  decidedAt: Date | null
  fulfilledAt: Date | null
  cancelledAt: Date | null
  createdAt: Date
}

const toRequest = (row: Row): StoredSupplyRequest => ({
  ...row,
  decidedAt: at(row.decidedAt),
  fulfilledAt: at(row.fulfilledAt),
  cancelledAt: at(row.cancelledAt),
  createdAt: row.createdAt.toISOString(),
})

const ofInstitution = (institutionId: string) =>
  and(eq(supplyRequests.institutionId, institutionId), isNull(supplyRequests.archivedAt))

const selectRequests = (db: Database) =>
  db
    .select(COLUMNS)
    .from(supplyRequests)
    .leftJoin(
      purchaseRequests,
      and(
        eq(purchaseRequests.institutionId, supplyRequests.institutionId),
        eq(purchaseRequests.id, supplyRequests.purchaseRequestId),
      ),
    )

export async function findSupplyRequest(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredSupplyRequest | null> {
  const [row] = await selectRequests(db)
    .where(and(ofInstitution(institutionId), eq(supplyRequests.id, id)))
    .limit(1)
  return row === undefined ? null : toRequest(row)
}

export interface SupplyRequestQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: SupplyRequestStatus | undefined
  stockItemId?: string | undefined
  /** Yalnız bu kişinin talepleri (öğretmen her zaman; K-244). */
  requestedByUserId?: string | undefined
}

/** `SM-0012`, `sm12` ya da `12` sıra numarasına çevrilir; değilse `null`. */
function sequenceOf(search: string): number | null {
  const match = /^(?:sm-?)?0*(\d{1,9})$/i.exec(search.trim())
  return match?.[1] === undefined ? null : Number(match[1])
}

/**
 * Talepler, yeni açılan önce. `q` numarada, gerekçede, talep edenin adında ve kalemlerin stok kartı
 * kod ya da adında arar; `stockItemId` o kartı içeren talepleri süzer.
 */
export async function listSupplyRequests(
  db: Database,
  institutionId: string,
  query: SupplyRequestQuery,
): Promise<{ items: StoredSupplyRequest[]; total: number }> {
  const filters: SQL[] = []
  if (query.q !== undefined) {
    const search = foldSearch(query.q)
    const sequence = sequenceOf(query.q)
    const itemMatch = db
      .select({ id: supplyRequestItems.id })
      .from(supplyRequestItems)
      .innerJoin(
        stockItems,
        and(
          eq(stockItems.institutionId, supplyRequestItems.institutionId),
          eq(stockItems.id, supplyRequestItems.stockItemId),
        ),
      )
      .where(
        and(
          eq(supplyRequestItems.institutionId, supplyRequests.institutionId),
          eq(supplyRequestItems.requestId, supplyRequests.id),
          isNull(supplyRequestItems.archivedAt),
          or(
            sql`strpos(${foldSql(stockItems.name)}, ${search}) > 0`,
            sql`strpos(${foldSql(stockItems.code)}, ${search}) > 0`,
          ),
        ),
      )
    const userMatch = db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, supplyRequests.requestedByUserId),
          sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
        ),
      )
    const matches: SQL[] = [
      sql`strpos(${foldSql(supplyRequests.justification)}, ${search}) > 0`,
      exists(itemMatch),
      exists(userMatch),
    ]
    if (sequence !== null) matches.push(eq(supplyRequests.sequence, sequence))
    const combined = or(...matches)
    if (combined) filters.push(combined)
  }
  if (query.status !== undefined) filters.push(eq(supplyRequests.status, query.status))
  if (query.requestedByUserId !== undefined)
    filters.push(eq(supplyRequests.requestedByUserId, query.requestedByUserId))
  if (query.stockItemId !== undefined)
    filters.push(
      exists(
        db
          .select({ id: supplyRequestItems.id })
          .from(supplyRequestItems)
          .where(
            and(
              eq(supplyRequestItems.institutionId, supplyRequests.institutionId),
              eq(supplyRequestItems.requestId, supplyRequests.id),
              eq(supplyRequestItems.stockItemId, query.stockItemId),
              isNull(supplyRequestItems.archivedAt),
            ),
          ),
      ),
    )
  const where = and(ofInstitution(institutionId), ...filters)
  const [totalRow] = await db.select({ total: count() }).from(supplyRequests).where(where)
  const rows = await selectRequests(db)
    .where(where)
    .orderBy(desc(supplyRequests.sequence))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toRequest), total: totalRow?.total ?? 0 }
}

export interface StoredSupplyItem {
  id: string
  requestId: string
  position: number
  stockItemId: string
  code: string
  name: string
  unit: StockUnit
  isActive: boolean
  quantity: number
  fulfilledQuantity: number
}

/** Taleplerin kalemleri, sırayla; karşılanan miktar bağlı iptal edilmemiş çıkışlardan toplanır. */
export async function loadSupplyRequestItems(
  db: Database,
  institutionId: string,
  requestIds: readonly string[],
): Promise<StoredSupplyItem[]> {
  if (requestIds.length === 0) return []
  const fulfilled = db
    .select({
      requestItemId: supplyRequestIssues.requestItemId,
      quantity: sql<string>`sum(${stockMovements.quantity})`.as('fulfilled_quantity'),
    })
    .from(supplyRequestIssues)
    .innerJoin(
      stockMovements,
      and(
        eq(stockMovements.institutionId, supplyRequestIssues.institutionId),
        eq(stockMovements.id, supplyRequestIssues.stockMovementId),
      ),
    )
    .where(
      and(
        eq(supplyRequestIssues.institutionId, institutionId),
        inArray(supplyRequestIssues.requestId, [...new Set(requestIds)]),
        isNull(supplyRequestIssues.archivedAt),
        isNull(stockMovements.cancelledAt),
      ),
    )
    .groupBy(supplyRequestIssues.requestItemId)
    .as('fulfilled')
  const rows = await db
    .select({
      id: supplyRequestItems.id,
      requestId: supplyRequestItems.requestId,
      position: supplyRequestItems.position,
      stockItemId: supplyRequestItems.stockItemId,
      code: stockItems.code,
      name: stockItems.name,
      unit: stockItems.unit,
      isActive: stockItems.isActive,
      quantity: supplyRequestItems.quantity,
      fulfilledQuantity: fulfilled.quantity,
    })
    .from(supplyRequestItems)
    .innerJoin(
      stockItems,
      and(
        eq(stockItems.institutionId, supplyRequestItems.institutionId),
        eq(stockItems.id, supplyRequestItems.stockItemId),
      ),
    )
    .leftJoin(fulfilled, eq(fulfilled.requestItemId, supplyRequestItems.id))
    .where(
      and(
        eq(supplyRequestItems.institutionId, institutionId),
        inArray(supplyRequestItems.requestId, [...new Set(requestIds)]),
        isNull(supplyRequestItems.archivedAt),
      ),
    )
    .orderBy(asc(supplyRequestItems.requestId), asc(supplyRequestItems.position))
  return rows.map((row) => ({ ...row, fulfilledQuantity: Number(row.fulfilledQuantity ?? 0) }))
}

export interface StoredSupplyIssue {
  movementId: string
  requestItemId: string
  warehouseId: string
  warehouseName: string
  quantity: number
  movementDate: string
  createdByUserId: string
  createdAt: string
  cancelledAt: string | null
}

/** Talebin karşılama geçmişi (iptal edilen çıkışlar dahil), eskiden yeniye. */
export async function loadSupplyRequestIssues(
  db: Database,
  institutionId: string,
  requestId: string,
): Promise<StoredSupplyIssue[]> {
  const rows = await db
    .select({
      movementId: stockMovements.id,
      requestItemId: supplyRequestIssues.requestItemId,
      warehouseId: stockMovements.warehouseId,
      warehouseName: stockWarehouses.name,
      quantity: stockMovements.quantity,
      movementDate: stockMovements.movementDate,
      createdByUserId: stockMovements.createdByUserId,
      createdAt: stockMovements.createdAt,
      cancelledAt: stockMovements.cancelledAt,
    })
    .from(supplyRequestIssues)
    .innerJoin(
      stockMovements,
      and(
        eq(stockMovements.institutionId, supplyRequestIssues.institutionId),
        eq(stockMovements.id, supplyRequestIssues.stockMovementId),
      ),
    )
    .innerJoin(
      stockWarehouses,
      and(
        eq(stockWarehouses.institutionId, stockMovements.institutionId),
        eq(stockWarehouses.id, stockMovements.warehouseId),
      ),
    )
    .where(
      and(
        eq(supplyRequestIssues.institutionId, institutionId),
        eq(supplyRequestIssues.requestId, requestId),
        isNull(supplyRequestIssues.archivedAt),
      ),
    )
    .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id))
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    cancelledAt: at(row.cancelledAt),
  }))
}

/** Kartların etkin depolardaki pozitif miktarları (karşılama formu bilgisi). */
export async function loadSupplyStock(
  db: Database,
  institutionId: string,
  itemIds: readonly string[],
): Promise<{ itemId: string; warehouseId: string; warehouseName: string; quantity: number }[]> {
  if (itemIds.length === 0) return []
  const rows = await db
    .select({
      itemId: stockMovements.itemId,
      warehouseId: stockMovements.warehouseId,
      warehouseName: stockWarehouses.name,
      quantity: sql<string>`sum(case when ${stockMovements.type} in ('in', 'transfer_in', 'receipt') then ${stockMovements.quantity} else -${stockMovements.quantity} end)`,
    })
    .from(stockMovements)
    .innerJoin(
      stockWarehouses,
      and(
        eq(stockWarehouses.institutionId, stockMovements.institutionId),
        eq(stockWarehouses.id, stockMovements.warehouseId),
      ),
    )
    .where(
      and(
        eq(stockMovements.institutionId, institutionId),
        inArray(stockMovements.itemId, [...new Set(itemIds)]),
        isNull(stockMovements.archivedAt),
        isNull(stockMovements.cancelledAt),
        eq(stockWarehouses.isActive, true),
        isNull(stockWarehouses.archivedAt),
      ),
    )
    .groupBy(stockMovements.itemId, stockMovements.warehouseId, stockWarehouses.name)
    .orderBy(asc(stockWarehouses.name))
  return rows
    .map((row) => ({ ...row, quantity: Number(row.quantity) }))
    .filter((row) => row.quantity > 0)
}

export interface SupplyStockCardRow {
  id: string
  code: string
  name: string
  category: StockCategory
  unit: StockUnit
}

/** Talep formunun kart seçimi: etkin kartlar, koda göre; `q` kod ya da adda arar. */
export async function listSupplyStockCards(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; q?: string | undefined },
): Promise<{ items: SupplyStockCardRow[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    eq(stockItems.institutionId, institutionId),
    isNull(stockItems.archivedAt),
    eq(stockItems.isActive, true),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(stockItems.name)}, ${search}) > 0`,
          sql`strpos(${foldSql(stockItems.code)}, ${search}) > 0`,
        ),
  )
  const [totalRow] = await db.select({ total: count() }).from(stockItems).where(where)
  const items = await db
    .select({
      id: stockItems.id,
      code: stockItems.code,
      name: stockItems.name,
      category: stockItems.category,
      unit: stockItems.unit,
    })
    .from(stockItems)
    .where(where)
    .orderBy(asc(stockItems.code), asc(stockItems.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

/** Kurumun sıradaki sarf talebi numarası; kurum kilidi altında çağrılır. */
export async function nextSupplyRequestSequence(
  tx: Database,
  institutionId: string,
): Promise<number> {
  const [row] = await tx
    .select({ last: max(supplyRequests.sequence) })
    .from(supplyRequests)
    .where(eq(supplyRequests.institutionId, institutionId))
  return (row?.last ?? 0) + 1
}

export async function insertSupplyRequest(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    sequence: number
    requestedByUserId: string
    neededDate: string
    justification: string
    items: readonly { stockItemId: string; quantity: number }[]
    now: Date
  },
): Promise<void> {
  const { now, items, ...fields } = input
  await tx
    .insert(supplyRequests)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
  await tx.insert(supplyRequestItems).values(
    items.map((item, position) => ({
      ...item,
      institutionId,
      id: randomUUID(),
      requestId: input.id,
      position,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

export type SupplyRequestUpdate = {
  status?: SupplyRequestStatus
  decidedAt?: Date
  decidedByUserId?: string
  decisionNote?: string | null
  fulfilledAt?: Date
  fulfilledByUserId?: string
  fulfillmentNote?: string | null
  cancelledAt?: Date
  cancelledByUserId?: string
  cancelReason?: string
  purchaseRequestId?: string
}

/** Sürüm tutmazsa `false` (409). */
export async function updateSupplyRequest(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; changes: SupplyRequestUpdate; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(supplyRequests)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(supplyRequests.id, input.id),
        eq(supplyRequests.version, input.expectedVersion),
      ),
    )
    .returning({ id: supplyRequests.id })
  return rows.length === 1
}

export async function insertSupplyRequestIssues(
  tx: Database,
  institutionId: string,
  input: {
    requestId: string
    issues: readonly { requestItemId: string; stockMovementId: string }[]
    now: Date
  },
): Promise<void> {
  if (input.issues.length === 0) return
  await tx.insert(supplyRequestIssues).values(
    input.issues.map((issue) => ({
      ...issue,
      institutionId,
      id: randomUUID(),
      requestId: input.requestId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

/** Satın alma talebine bağlanmış sarf talebi (DOM-FIN-071 ayrıntısı; K-246); yoksa `null`. */
export async function findSupplyRequestForPurchase(
  db: Database,
  institutionId: string,
  purchaseRequestId: string,
): Promise<{ id: string; sequence: number } | null> {
  const [row] = await db
    .select({ id: supplyRequests.id, sequence: supplyRequests.sequence })
    .from(supplyRequests)
    .where(
      and(ofInstitution(institutionId), eq(supplyRequests.purchaseRequestId, purchaseRequestId)),
    )
    .limit(1)
  return row ?? null
}
