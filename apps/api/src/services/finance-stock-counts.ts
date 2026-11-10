import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import type { StockItemRef, StockWarehouseRef } from '@kampus/school-core/lib/finance-inventory.ts'
import {
  planStockCountCancel,
  planStockCountComplete,
  planStockCountLineSet,
  planStockCountScan,
  planStockCountStart,
  stockCountActions,
  stockCountReport,
  type StockCountReport,
} from '@kampus/school-core/lib/finance-stock-counts.ts'

import type { Database } from '../db/client.ts'
import {
  insertStockMovements,
  loadLastReceiptPrices,
  loadPairMovements,
  loadStockBalances,
  loadStockItems,
  loadStockItemsByIds,
  loadStockWarehouses,
  type StoredStockItem,
} from '../db/finance-inventory.ts'
import { purchaseActorNames } from '../db/finance-purchase-requests.ts'
import {
  closeStockCount,
  findStockCount,
  freezeStockCountLines,
  insertStockCount,
  listStockCounts,
  loadCountMovements,
  loadOpenCountWarehouseIds,
  loadStockCountLines,
  writeStockCountLine,
  type StockCountQuery,
  type StoredStockCount,
  type StoredStockCountLine,
} from '../db/finance-stock-counts.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { campusRecords } from './finance-inventory.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Stok sayımı ve fark raporu (DOM-FIN-081; ON-231). Kural core `lib/finance-stock-counts.ts`'tedir;
 * servis kurum kilidi altında sayımı, satırlarını ve depodaki hareketleri yükler, core kuralıyla
 * denetler ve aynı transaction'da yazar. Fark raporu açık sayımda o anki hareketlerden ve son alış
 * fiyatlarından hesaplanır; tamamlamada satırlara yazılır ve sonra değişmez. Rol ve modül denetimi
 * rotadadır.
 */

const COUNT = 'stock_counts'
const LINE = 'stock_count_lines'

const field = (input: unknown, key: string): string | undefined => {
  if (typeof input !== 'object' || input === null) return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}
const uuidLike = (value: string | undefined) =>
  value !== undefined && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined

const byId = <T extends { id: string }>(rows: readonly T[]) =>
  new Map(rows.map((row) => [row.id, row]))

/** Sayımın fark raporu: tamamlanan sayımda saklanan, açık ve iptal edilen sayımda o anki değerler. */
async function reportOf(
  db: Database,
  ctx: ServiceContext,
  count: StoredStockCount,
  lines: readonly StoredStockCountLine[],
): Promise<StockCountReport> {
  if (count.status === 'completed') return stockCountReport(lines, { kind: 'stored' })
  const countedIds = lines.flatMap((line) => (line.countedQuantity === null ? [] : [line.itemId]))
  const [movements, prices] = await Promise.all([
    countedIds.length === 0
      ? Promise.resolve([])
      : loadCountMovements(db, ctx.institutionId, count.warehouseId, count.startedAt),
    loadLastReceiptPrices(db, ctx.institutionId, countedIds),
  ])
  return stockCountReport(lines, {
    kind: 'live',
    startedAt: count.startedAt,
    movements,
    unitCosts: new Map([...prices].map(([itemId, price]) => [itemId, price.unitPriceCents])),
  })
}

const itemView = (items: ReadonlyMap<string, StoredStockItem>, itemId: string) => {
  const item = items.get(itemId)
  return {
    itemCode: item?.code ?? '',
    itemName: item?.name ?? '',
    unit: item?.unit ?? ('piece' as const),
  }
}

/** Sayım ayrıntısı: başlık bilgileri, kişi adları, fark raporu (koda göre) ve rolün eylemleri. */
async function countDetail(db: Database, ctx: ServiceContext, id: string) {
  const count = await findStockCount(db, ctx.institutionId, id)
  if (count === null) throw new NotFoundError()
  const lines = await loadStockCountLines(db, ctx.institutionId, id)
  const [report, items, warehouses, names] = await Promise.all([
    reportOf(db, ctx, count, lines),
    loadStockItemsByIds(
      db,
      ctx.institutionId,
      lines.map((line) => line.itemId),
    ),
    loadStockWarehouses(db, ctx.institutionId),
    purchaseActorNames(db, ctx.institutionId, [
      count.startedByUserId,
      ...(count.completedByUserId === null ? [] : [count.completedByUserId]),
      ...(count.cancelledByUserId === null ? [] : [count.cancelledByUserId]),
    ]),
  ])
  const warehouse = warehouses.find((row) => row.id === count.warehouseId)
  const campuses = await campusRecords(
    db,
    ctx.institutionId,
    warehouse === undefined ? [] : [warehouse.campusId],
  )
  const itemById = byId(items)
  const lineByItem = new Map(lines.map((line) => [line.itemId, line]))
  const code = (itemId: string) => itemById.get(itemId)?.code ?? ''
  const byCode = (a: { itemId: string }, b: { itemId: string }) =>
    code(a.itemId).localeCompare(code(b.itemId), 'en')
  const nameOf = (userId: string | null) => (userId === null ? null : (names.get(userId) ?? null))
  const open = count.status === 'open'
  const actions = stockCountActions(ctx.actor.role)
  return {
    id: count.id,
    warehouseId: count.warehouseId,
    warehouseName: warehouse?.name ?? '',
    campusName: warehouse === undefined ? null : (campuses.get(warehouse.campusId)?.name ?? null),
    status: count.status,
    note: count.note,
    startedAt: count.startedAt,
    startedByName: nameOf(count.startedByUserId),
    completedAt: count.completedAt,
    completedByName: nameOf(count.completedByUserId),
    adjustmentDate: count.adjustmentDate,
    cancelledAt: count.cancelledAt,
    cancelledByName: nameOf(count.cancelledByUserId),
    cancelReason: count.cancelReason,
    counted: [...report.counted].sort(byCode).map((row) => {
      const line = lineByItem.get(row.itemId)
      return {
        ...row,
        ...itemView(itemById, row.itemId),
        countedAt: line?.countedAt ?? '',
        movementId: line?.stockMovementId ?? null,
      }
    }),
    uncounted: [...report.uncounted]
      .sort(byCode)
      .map((row) => ({ ...row, ...itemView(itemById, row.itemId) })),
    totals: report.totals,
    actions: {
      count: open && actions.count,
      complete: open && actions.complete,
      cancel: open && actions.cancel,
    },
    version: count.version,
  }
}

export const getStockCountFor = (ctx: ServiceContext, id: string) => countDetail(ctx.db, ctx, id)

/** Sayımlar, en yeni önce; depo, kampüs ve kişi adlarıyla. */
export async function listStockCountsFor(ctx: ServiceContext, query: StockCountQuery) {
  const { items, total } = await listStockCounts(ctx.db, ctx.institutionId, query)
  const [warehouses, names] = await Promise.all([
    loadStockWarehouses(ctx.db, ctx.institutionId),
    purchaseActorNames(
      ctx.db,
      ctx.institutionId,
      items.map((row) => row.startedByUserId),
    ),
  ])
  const warehouseById = byId(warehouses)
  const campuses = await campusRecords(
    ctx.db,
    ctx.institutionId,
    items.flatMap((row) => {
      const warehouse = warehouseById.get(row.warehouseId)
      return warehouse === undefined ? [] : [warehouse.campusId]
    }),
  )
  return {
    items: items.map((row) => {
      const warehouse = warehouseById.get(row.warehouseId)
      return {
        id: row.id,
        warehouseId: row.warehouseId,
        warehouseName: warehouse?.name ?? '',
        campusName:
          warehouse === undefined ? null : (campuses.get(warehouse.campusId)?.name ?? null),
        status: row.status,
        note: row.note,
        startedAt: row.startedAt,
        startedByName: names.get(row.startedByUserId) ?? null,
        completedAt: row.completedAt,
        cancelledAt: row.cancelledAt,
        lineCount: row.lineCount,
        countedCount: row.countedCount,
        adjustmentCount: row.adjustmentCount,
        version: row.version,
      }
    }),
    total,
  }
}

const warehouseRefs = (warehouses: readonly StockWarehouseRef[]) => byId(warehouses)
const itemRefs = (items: readonly StockItemRef[]) => byId(items)

/** Sayım başlatma (K-228): anlık görüntü depodaki miktarı sıfırdan farklı kartlardır. 201. */
export function startStockCountCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: COUNT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stock_count.start',
      collections: [],
      entity,
      load: async (tx) => {
        const warehouseId = uuidLike(field(input, 'warehouseId'))
        const [warehouses, openCountWarehouseIds, balances] = await Promise.all([
          loadStockWarehouses(tx, ctx.institutionId),
          loadOpenCountWarehouseIds(tx, ctx.institutionId),
          warehouseId === undefined
            ? Promise.resolve([])
            : loadStockBalances(tx, ctx.institutionId, { warehouseId }),
        ])
        return {
          run: () =>
            planStockCountStart(input, {
              warehouses: warehouseRefs(warehouses),
              openCountWarehouseIds,
              balances: new Map(balances.map((row) => [row.itemId, row.quantity])),
            }),
        }
      },
      after: async (tx, data) => {
        await insertStockCount(tx, ctx.institutionId, {
          id,
          warehouseId: data.warehouseId,
          note: data.note,
          startedByUserId: ctx.actor.userId,
          lines: data.lines.map((line) => ({ ...line, id: randomUUID() })),
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'stock_count.start', entity, [
          'warehouseId',
          ...(data.note === null ? [] : ['note']),
        ])
        body = { data: await countDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Sayımı ve satırlarını kurum kilidi altında yükler; yoksa ya da başka kurumunsa 404. */
async function loadCount(tx: Database, ctx: ServiceContext, countId: string) {
  const count = await findStockCount(tx, ctx.institutionId, countId)
  if (count === null) throw new NotFoundError()
  const lines = await loadStockCountLines(tx, ctx.institutionId, countId)
  return { count, lines, lineByItem: new Map(lines.map((line) => [line.itemId, line])) }
}

/** Okutulan ya da elle girilen satırın yanıtı. */
async function lineBody(tx: Database, ctx: ServiceContext, countId: string, itemId: string) {
  const [lines, items] = await Promise.all([
    loadStockCountLines(tx, ctx.institutionId, countId),
    loadStockItemsByIds(tx, ctx.institutionId, [itemId]),
  ])
  const line = lines.find((row) => row.itemId === itemId)
  const item = items[0]
  return {
    data: {
      countId,
      itemId,
      itemCode: item?.code ?? '',
      itemName: item?.name ?? '',
      unit: item?.unit ?? ('piece' as const),
      systemQuantity: line?.systemQuantity ?? 0,
      countedQuantity: line?.countedQuantity ?? null,
      countedAt: line?.countedAt ?? null,
    },
  }
}

/**
 * Okutma (K-229): kart kodu kartı bulur, satıra 1 ya da girilen miktar eklenir. Çift gönderim iki
 * kez saymasın diye `Idempotency-Key` zorunludur. 200.
 */
export function scanStockCountCommand(
  ctx: ServiceContext,
  countId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  let lineId = ''
  return runCommand(
    ctx,
    {
      action: 'stock_count.scan',
      collections: [],
      entity: () => ({ type: LINE, id: lineId }),
      load: async (tx) => {
        const [{ count, lineByItem }, items] = await Promise.all([
          loadCount(tx, ctx, countId),
          loadStockItems(tx, ctx.institutionId),
        ])
        return {
          run: () => {
            const result = planStockCountScan(count, input, { items, lines: lineByItem })
            lineId = lineByItem.get(result.itemId)?.id ?? randomUUID()
            return result
          },
        }
      },
      after: async (tx, result) => {
        await writeStockCountLine(tx, ctx.institutionId, {
          countId,
          itemId: result.itemId,
          newLineId: result.isNew ? lineId : null,
          countedQuantity: result.countedQuantity,
          countedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'stock_count.scan', { type: LINE, id: lineId }, [
          'countedQuantity',
        ])
        body = await lineBody(tx, ctx, countId, result.itemId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Satırın sayılan miktarını doğrudan yazar ya da (`null`) sayımı geri alır (K-229). 200. */
export function setStockCountLineCommand(
  ctx: ServiceContext,
  countId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const itemId = uuidLike(field(input, 'itemId'))
  let body: unknown
  let lineId = ''
  return runCommand(
    ctx,
    {
      action: 'stock_count.line',
      collections: [],
      entity: () => ({ type: LINE, id: lineId }),
      load: async (tx) => {
        const [{ count, lineByItem }, items] = await Promise.all([
          loadCount(tx, ctx, countId),
          loadStockItemsByIds(tx, ctx.institutionId, itemId === undefined ? [] : [itemId]),
        ])
        return {
          run: () => {
            const result = planStockCountLineSet(count, input, {
              items: itemRefs(items),
              lines: lineByItem,
            })
            lineId = lineByItem.get(result.itemId)?.id ?? randomUUID()
            return result
          },
        }
      },
      after: async (tx, result) => {
        // Hiç sayılmamış, anlık görüntüde olmayan kartı "sayılmadı" yapmak satır açmaz.
        if (!(result.isNew && result.countedQuantity === null)) {
          await writeStockCountLine(tx, ctx.institutionId, {
            countId,
            itemId: result.itemId,
            newLineId: result.isNew ? lineId : null,
            countedQuantity: result.countedQuantity,
            countedByUserId: ctx.actor.userId,
            now: ctx.now,
          })
          await auditWork(tx, ctx, 'stock_count.line', { type: LINE, id: lineId }, [
            'countedQuantity',
          ])
        }
        body = await lineBody(tx, ctx, countId, result.itemId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Tamamlama (K-230, K-231): fark raporu kurum kilidi altında yeniden hesaplanır, farklar tamamlama
 * gününde tek işlemde düzeltme hareketiyle yazılır, satırlara beklenen miktar ve birim maliyet
 * saklanır. `If-Match` sayımın sürümüdür. 200.
 */
export function completeStockCountCommand(
  ctx: ServiceContext,
  countId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: COUNT, id: countId }
  const today = dayKey(ctx.now)
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stock_count.complete',
      collections: [],
      entity,
      load: async (tx) => {
        const { count, lines } = await loadCount(tx, ctx, countId)
        if (count.version !== expectedVersion) throw new ConflictError()
        const report = await reportOf(tx, ctx, count, lines)
        const differing = report.counted.filter((row) => row.difference !== 0)
        const [items, warehouses, movements] = await Promise.all([
          loadStockItemsByIds(
            tx,
            ctx.institutionId,
            differing.map((row) => row.itemId),
          ),
          loadStockWarehouses(tx, ctx.institutionId),
          loadPairMovements(
            tx,
            ctx.institutionId,
            differing
              .filter((row) => row.difference < 0)
              .map((row) => ({ itemId: row.itemId, warehouseId: count.warehouseId })),
          ),
        ])
        return {
          run: () => ({
            report,
            adjustments: planStockCountComplete(count, report, {
              items: itemRefs(items),
              warehouses: warehouseRefs(warehouses),
              movements,
              today,
            }),
            warehouseId: count.warehouseId,
          }),
        }
      },
      after: async (tx, { report, adjustments, warehouseId }) => {
        const movementIds = new Map(adjustments.map((row) => [row.itemId, randomUUID()]))
        await insertStockMovements(tx, ctx.institutionId, {
          movements: adjustments.map((row) => ({
            id: movementIds.get(row.itemId) ?? randomUUID(),
            itemId: row.itemId,
            warehouseId,
            type: row.type,
            quantity: row.quantity,
            movementDate: today,
            reason: null,
            note: null,
            transferId: null,
            receiptId: null,
            receiptItemId: null,
          })),
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await freezeStockCountLines(tx, ctx.institutionId, {
          countId,
          lines: report.counted.map((row) => ({
            itemId: row.itemId,
            expectedQuantity: row.expectedQuantity,
            unitCostCents: row.unitCostCents,
            stockMovementId: movementIds.get(row.itemId) ?? null,
          })),
          now: ctx.now,
        })
        const closed = await closeStockCount(tx, ctx.institutionId, {
          id: countId,
          expectedVersion,
          now: ctx.now,
          close: {
            status: 'completed',
            completedByUserId: ctx.actor.userId,
            adjustmentDate: today,
          },
        })
        if (!closed) throw new ConflictError()
        await auditWork(tx, ctx, 'stock_count.complete', entity, ['status', 'completedAt'])
        for (const movementId of movementIds.values())
          await auditWork(
            tx,
            ctx,
            'stock_movement.adjustment',
            { type: 'stock_movements', id: movementId },
            ['itemId', 'warehouseId', 'quantity', 'movementDate'],
          )
        body = { data: await countDetail(tx, ctx, countId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** İptal (K-230): gerekçeyle; hareket yazılmaz. `If-Match` sayımın sürümüdür. 200. */
export function cancelStockCountCommand(
  ctx: ServiceContext,
  countId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: COUNT, id: countId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stock_count.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const count = await findStockCount(tx, ctx.institutionId, countId)
        if (count === null) throw new NotFoundError()
        if (count.version !== expectedVersion) throw new ConflictError()
        return { run: () => planStockCountCancel(count, input) }
      },
      after: async (tx, { reason }) => {
        const closed = await closeStockCount(tx, ctx.institutionId, {
          id: countId,
          expectedVersion,
          now: ctx.now,
          close: { status: 'cancelled', cancelledByUserId: ctx.actor.userId, cancelReason: reason },
        })
        if (!closed) throw new ConflictError()
        await auditWork(tx, ctx, 'stock_count.cancel', entity, ['status', 'cancelReason'])
        body = { data: await countDetail(tx, ctx, countId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
