import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'

import type { StockMovementType } from '@kampus/school-core/lib/finance-inventory.ts'
import type {
  CountMovement,
  StockCountLine,
  StockCountStatus,
} from '@kampus/school-core/lib/finance-stock-counts.ts'

import type { Database } from './client.ts'
import { stockMovements } from './schema/finance-inventory.ts'
import { stockCountLines, stockCounts } from './schema/finance-stock-counts.ts'

/**
 * Stok sayımı deposu (DOM-FIN-081; ON-231). Kurum kapsamlıdır: ilk parametre `institutionId`. Kural
 * core `lib/finance-stock-counts.ts`'tedir; fark raporu saklanmaz, açık sayımda satırlardan ve
 * hareketlerden hesaplanır, tamamlamada satıra beklenen miktar ve birim maliyet yazılır.
 */

export interface StoredStockCount {
  id: string
  warehouseId: string
  status: StockCountStatus
  note: string | null
  startedAt: string
  startedByUserId: string
  completedAt: string | null
  completedByUserId: string | null
  adjustmentDate: string | null
  cancelledAt: string | null
  cancelledByUserId: string | null
  cancelReason: string | null
  version: number
}

export interface StoredStockCountLine extends StockCountLine {
  id: string
  countedByUserId: string | null
  stockMovementId: string | null
  version: number
}

const COUNT_COLUMNS = {
  id: stockCounts.id,
  warehouseId: stockCounts.warehouseId,
  status: stockCounts.status,
  note: stockCounts.note,
  startedAt: stockCounts.startedAt,
  startedByUserId: stockCounts.startedByUserId,
  completedAt: stockCounts.completedAt,
  completedByUserId: stockCounts.completedByUserId,
  adjustmentDate: stockCounts.adjustmentDate,
  cancelledAt: stockCounts.cancelledAt,
  cancelledByUserId: stockCounts.cancelledByUserId,
  cancelReason: stockCounts.cancelReason,
  version: stockCounts.version,
}
const LINE_COLUMNS = {
  id: stockCountLines.id,
  itemId: stockCountLines.itemId,
  systemQuantity: stockCountLines.systemQuantity,
  countedQuantity: stockCountLines.countedQuantity,
  countedAt: stockCountLines.countedAt,
  countedByUserId: stockCountLines.countedByUserId,
  expectedQuantity: stockCountLines.expectedQuantity,
  unitCostCents: stockCountLines.unitCostCents,
  stockMovementId: stockCountLines.stockMovementId,
  version: stockCountLines.version,
}

const iso = (value: Date | null) => (value === null ? null : value.toISOString())
type CountRow = Omit<StoredStockCount, 'startedAt' | 'completedAt' | 'cancelledAt'> & {
  startedAt: Date
  completedAt: Date | null
  cancelledAt: Date | null
}
const toCount = (row: CountRow): StoredStockCount => ({
  ...row,
  startedAt: row.startedAt.toISOString(),
  completedAt: iso(row.completedAt),
  cancelledAt: iso(row.cancelledAt),
})

const countsOf = (institutionId: string) =>
  and(eq(stockCounts.institutionId, institutionId), isNull(stockCounts.archivedAt))
const linesOf = (institutionId: string) =>
  and(eq(stockCountLines.institutionId, institutionId), isNull(stockCountLines.archivedAt))

export interface StockCountQuery {
  page: number
  pageSize: number
  status?: StockCountStatus | undefined
  warehouseId?: string | undefined
}

export interface StockCountSummary extends StoredStockCount {
  lineCount: number
  countedCount: number
  adjustmentCount: number
}

/** Sayımlar, en yeni başlangıç önce; satır, sayılan satır ve düzeltme sayısıyla. */
export async function listStockCounts(
  db: Database,
  institutionId: string,
  query: StockCountQuery,
): Promise<{ items: StockCountSummary[]; total: number }> {
  const filters: (SQL | undefined)[] = [
    countsOf(institutionId),
    query.status === undefined ? undefined : eq(stockCounts.status, query.status),
    query.warehouseId === undefined ? undefined : eq(stockCounts.warehouseId, query.warehouseId),
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(stockCounts).where(where)
  const rows = await db
    .select(COUNT_COLUMNS)
    .from(stockCounts)
    .where(where)
    .orderBy(desc(stockCounts.startedAt), desc(stockCounts.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  const ids = rows.map((row) => row.id)
  const tallies =
    ids.length === 0
      ? []
      : await db
          .select({
            countId: stockCountLines.countId,
            lineCount: count(),
            countedCount: count(stockCountLines.countedQuantity),
            adjustmentCount: count(stockCountLines.stockMovementId),
          })
          .from(stockCountLines)
          .where(and(linesOf(institutionId), inArray(stockCountLines.countId, ids)))
          .groupBy(stockCountLines.countId)
  const byCount = new Map(tallies.map((row) => [row.countId, row]))
  return {
    items: rows.map((row) => {
      const tally = byCount.get(row.id)
      return {
        ...toCount(row),
        lineCount: tally?.lineCount ?? 0,
        countedCount: tally?.countedCount ?? 0,
        adjustmentCount: tally?.adjustmentCount ?? 0,
      }
    }),
    total: totalRow?.total ?? 0,
  }
}

export async function findStockCount(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStockCount | null> {
  const [row] = await db
    .select(COUNT_COLUMNS)
    .from(stockCounts)
    .where(and(countsOf(institutionId), eq(stockCounts.id, id)))
    .limit(1)
  return row === undefined ? null : toCount(row)
}

/** Açık sayımı olan depolar (aynı depoda tek açık sayım, K-228). */
export async function loadOpenCountWarehouseIds(
  db: Database,
  institutionId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ warehouseId: stockCounts.warehouseId })
    .from(stockCounts)
    .where(and(countsOf(institutionId), eq(stockCounts.status, 'open')))
  return new Set(rows.map((row) => row.warehouseId))
}

/** Sayımın satırları (sırasız; çağıran kart koduna göre sıralar). */
export async function loadStockCountLines(
  db: Database,
  institutionId: string,
  countId: string,
): Promise<StoredStockCountLine[]> {
  const rows = await db
    .select(LINE_COLUMNS)
    .from(stockCountLines)
    .where(and(linesOf(institutionId), eq(stockCountLines.countId, countId)))
  return rows.map((row) => ({ ...row, countedAt: iso(row.countedAt) }))
}

export async function insertStockCount(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    warehouseId: string
    note: string | null
    startedByUserId: string
    lines: readonly { id: string; itemId: string; systemQuantity: number }[]
    now: Date
  },
): Promise<void> {
  const { now } = input
  await tx.insert(stockCounts).values({
    institutionId,
    id: input.id,
    warehouseId: input.warehouseId,
    status: 'open',
    note: input.note,
    startedAt: now,
    startedByUserId: input.startedByUserId,
    createdAt: now,
    updatedAt: now,
  })
  if (input.lines.length === 0) return
  await tx.insert(stockCountLines).values(
    input.lines.map((line) => ({
      institutionId,
      id: line.id,
      countId: input.id,
      itemId: line.itemId,
      systemQuantity: line.systemQuantity,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/**
 * Satırın sayılan miktarını yazar; anlık görüntüde olmayan kart için sistem miktarı 0 olan satır
 * açar. `null` sayımı geri alır (sayım anı ve sayan da boşalır).
 */
export async function writeStockCountLine(
  tx: Database,
  institutionId: string,
  input: {
    countId: string
    itemId: string
    newLineId: string | null
    countedQuantity: number | null
    countedByUserId: string
    now: Date
  },
): Promise<void> {
  const counted =
    input.countedQuantity === null
      ? { countedQuantity: null, countedAt: null, countedByUserId: null }
      : {
          countedQuantity: input.countedQuantity,
          countedAt: input.now,
          countedByUserId: input.countedByUserId,
        }
  if (input.newLineId !== null) {
    await tx.insert(stockCountLines).values({
      institutionId,
      id: input.newLineId,
      countId: input.countId,
      itemId: input.itemId,
      systemQuantity: 0,
      ...counted,
      createdAt: input.now,
      updatedAt: input.now,
    })
    return
  }
  await tx
    .update(stockCountLines)
    .set({ ...counted, updatedAt: input.now, version: sql`${stockCountLines.version} + 1` })
    .where(
      and(
        linesOf(institutionId),
        eq(stockCountLines.countId, input.countId),
        eq(stockCountLines.itemId, input.itemId),
      ),
    )
}

/** Tamamlamada satıra beklenen miktar, birim maliyet ve düzeltme hareketini yazar. */
export async function freezeStockCountLines(
  tx: Database,
  institutionId: string,
  input: {
    countId: string
    lines: readonly {
      itemId: string
      expectedQuantity: number
      unitCostCents: number | null
      stockMovementId: string | null
    }[]
    now: Date
  },
): Promise<void> {
  for (const line of input.lines)
    await tx
      .update(stockCountLines)
      .set({
        expectedQuantity: line.expectedQuantity,
        unitCostCents: line.unitCostCents,
        stockMovementId: line.stockMovementId,
        updatedAt: input.now,
        version: sql`${stockCountLines.version} + 1`,
      })
      .where(
        and(
          linesOf(institutionId),
          eq(stockCountLines.countId, input.countId),
          eq(stockCountLines.itemId, line.itemId),
        ),
      )
}

/** Açık sayımı kapatır (tamamlama ya da iptal); sürüm tutmazsa ya da sayım açık değilse `false`. */
export async function closeStockCount(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    close:
      | { status: 'completed'; completedByUserId: string; adjustmentDate: string }
      | { status: 'cancelled'; cancelledByUserId: string; cancelReason: string }
  },
): Promise<boolean> {
  const { close, now } = input
  const rows = await tx
    .update(stockCounts)
    .set(
      close.status === 'completed'
        ? {
            status: 'completed',
            completedAt: now,
            completedByUserId: close.completedByUserId,
            adjustmentDate: close.adjustmentDate,
            updatedAt: now,
            version: input.expectedVersion + 1,
          }
        : {
            status: 'cancelled',
            cancelledAt: now,
            cancelledByUserId: close.cancelledByUserId,
            cancelReason: close.cancelReason,
            updatedAt: now,
            version: input.expectedVersion + 1,
          },
    )
    .where(
      and(
        countsOf(institutionId),
        eq(stockCounts.id, input.id),
        eq(stockCounts.status, 'open'),
        eq(stockCounts.version, input.expectedVersion),
      ),
    )
    .returning({ id: stockCounts.id })
  return rows.length === 1
}

/**
 * Depoda sayım başladıktan sonra kaydedilen ya da iptal edilen hareketler (K-231). Başlangıçtan önce
 * kaydedilip iptal edilmemiş hareket anlık görüntüdedir, yüklenmez.
 */
export async function loadCountMovements(
  db: Database,
  institutionId: string,
  warehouseId: string,
  startedAt: string,
): Promise<CountMovement[]> {
  const since = new Date(startedAt)
  const rows = await db
    .select({
      itemId: stockMovements.itemId,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      createdAt: stockMovements.createdAt,
      cancelledAt: stockMovements.cancelledAt,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.institutionId, institutionId),
        isNull(stockMovements.archivedAt),
        eq(stockMovements.warehouseId, warehouseId),
        or(
          gt(stockMovements.createdAt, since),
          and(isNotNull(stockMovements.cancelledAt), gt(stockMovements.cancelledAt, since)),
        ),
      ),
    )
  return rows.map((row) => ({
    itemId: row.itemId,
    type: row.type as StockMovementType,
    quantity: row.quantity,
    createdAt: row.createdAt.toISOString(),
    cancelledAt: iso(row.cancelledAt),
  }))
}

/** Düzeltme hareketi → sayım (hareket listesindeki sayım bağlantısı). */
export async function loadMovementCounts(
  db: Database,
  institutionId: string,
  movementIds: readonly string[],
): Promise<Map<string, string>> {
  if (movementIds.length === 0) return new Map()
  const rows = await db
    .select({ movementId: stockCountLines.stockMovementId, countId: stockCountLines.countId })
    .from(stockCountLines)
    .where(
      and(
        linesOf(institutionId),
        inArray(stockCountLines.stockMovementId, [...new Set(movementIds)]),
      ),
    )
  return new Map(
    rows.flatMap((row) => (row.movementId === null ? [] : [[row.movementId, row.countId]])),
  )
}
