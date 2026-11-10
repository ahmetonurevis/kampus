import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  isBelowMinimum,
  planReceiptStockCancel,
  planReceiptStockEntries,
  planStockEntry,
  planStockIssue,
  planStockItem,
  planStockItemUpdate,
  planStockMovementCancel,
  planStockTransfer,
  planStockWarehouse,
  planStockWarehouseUpdate,
  stockActions,
  type ReceiptStockLine,
  type StockCategory,
  type StockItemRef,
  type StockMovementType,
  type StockWarehouseRef,
} from '@kampus/school-core/lib/finance-inventory.ts'
import { criticalStockRows } from '@kampus/school-core/lib/finance-stock-alerts.ts'

import type { Database } from '../db/client.ts'
import {
  insertMovementLot,
  loadChemicalProfiles,
  loadMovementLots,
  type StoredChemicalProfile,
} from '../db/finance-chemicals.ts'
import {
  cancelStockMovements,
  findStockMovement,
  insertStockItem,
  insertStockMovements,
  insertStockWarehouse,
  listStockMovements,
  loadLastReceiptPrices,
  loadPairMovements,
  loadReceiptOrders,
  loadReceiptStockMovements,
  loadStockBalances,
  loadStockItems,
  loadStockItemsByIds,
  loadStockWarehouses,
  loadTransferMovements,
  stockItemHasMovements,
  updateStockItem,
  updateStockWarehouse,
  type NewStockMovement,
  type StockMovementQuery,
  type StoredStockItem,
  type StoredStockMovement,
  type StoredStockWarehouse,
} from '../db/finance-inventory.ts'
import { loadOpenRequestQuantities, purchaseActorNames } from '../db/finance-purchase-requests.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { foldSearch } from '../db/text-search.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Stok kartı, depo ve stok hareketi (DOM-FIN-077, DOM-FIN-078; ON-228, ON-229). Kural core
 * `lib/finance-inventory.ts`'tedir; servis kurum kilidi altında ilgili ürün × depo hareketlerini
 * yükler, core kuralıyla denetler ve aynı transaction'da yazar: eşzamanlı iki çıkış aynı miktarı
 * birlikte tüketemez. Miktar saklanmaz, hareketlerden toplanır. Rol ve modül denetimi rotadadır.
 * Mal kabulden giriş (K-184) `planReceiptStock`/`writeReceiptStock` ile mal kabul servisinden çağrılır.
 */

const ITEM = 'stock_items'
const WAREHOUSE = 'stock_warehouses'
const MOVEMENT = 'stock_movements'

interface Page {
  page: number
  pageSize: number
}
const pageOf = <T>(items: readonly T[], query: Page) => ({
  items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
  total: items.length,
})
const matches = (search: string | undefined, ...values: string[]) =>
  search === undefined || values.some((value) => foldSearch(value).includes(search))

export async function campusRecords(db: Database, institutionId: string, ids: readonly string[]) {
  const rows = await loadRecordsByIds(db, institutionId, 'branches', [...new Set(ids)])
  return new Map(
    rows.map((row) => [
      row.id,
      {
        name: typeof row.data.name === 'string' ? row.data.name : row.id,
        isActive: row.data.isActive !== false,
      },
    ]),
  )
}

const itemRef = (item: StoredStockItem): StockItemRef => item
const warehouseRef = (warehouse: StoredStockWarehouse): StockWarehouseRef => warehouse

// --- Stok kartı ----------------------------------------------------------------------------------

/** Kartın toplam miktarı: etkin ve pasif bütün depolar; `warehouseId` verilirse yalnız o depo. */
function quantities(
  balances: readonly { itemId: string; warehouseId: string; quantity: number }[],
  warehouseId?: string,
) {
  const totals = new Map<string, number>()
  for (const row of balances)
    if (warehouseId === undefined || row.warehouseId === warehouseId)
      totals.set(row.itemId, (totals.get(row.itemId) ?? 0) + row.quantity)
  return totals
}

const itemRow = (item: StoredStockItem, quantity: number, isChemical: boolean) => ({
  ...item,
  quantity,
  isBelowMinimum: isBelowMinimum(quantity, item.minQuantity),
  isChemical,
})

/** Kimyasal bilgisinin yanıt biçimi (DOM-FIN-090): kart kimliği yanıtta ayrıca yer almaz. */
const chemicalView = (profile: StoredChemicalProfile) => ({
  hazardPictograms: profile.hazardPictograms,
  signalWord: profile.signalWord,
  casNumber: profile.casNumber,
  storageClass: profile.storageClass,
  incompatibilityNote: profile.incompatibilityNote,
  sdsUrl: profile.sdsUrl,
  sdsDocumentNumber: profile.sdsDocumentNumber,
  sdsRevisionDate: profile.sdsRevisionDate,
  version: profile.version,
})

export interface StockItemListQuery extends Page {
  q?: string | undefined
  category?: StockCategory | undefined
  status?: 'active' | 'inactive' | undefined
  critical?: boolean | undefined
  warehouseId?: string | undefined
  /** Yalnız kimyasal bilgisi olan kartlar (DOM-FIN-090). */
  chemical?: boolean | undefined
}

/** Kartlar koda göre; miktar hareketlerden. `critical` yalnız kritik seviyedeki etkin kartlar. */
export async function listStockItemsFor(ctx: ServiceContext, query: StockItemListQuery) {
  const [items, balances, profiles] = await Promise.all([
    loadStockItems(ctx.db, ctx.institutionId),
    loadStockBalances(
      ctx.db,
      ctx.institutionId,
      query.warehouseId === undefined ? {} : { warehouseId: query.warehouseId },
    ),
    loadChemicalProfiles(ctx.db, ctx.institutionId),
  ])
  const totals = quantities(balances)
  const chemicals = new Set(profiles.map((profile) => profile.itemId))
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const rows = items
    .map((item) => itemRow(item, totals.get(item.id) ?? 0, chemicals.has(item.id)))
    .filter(
      (row) =>
        matches(search, row.code, row.name) &&
        (query.category === undefined || row.category === query.category) &&
        (query.status === undefined || row.isActive === (query.status === 'active')) &&
        (query.critical !== true || (row.isActive && row.isBelowMinimum)) &&
        (query.chemical !== true || row.isChemical),
    )
  return pageOf(rows, query)
}

export interface CriticalStockQuery extends Page {
  q?: string | undefined
  category?: StockCategory | undefined
}

/**
 * Kritik stok listesi (DOM-FIN-079, K-200): etkin kartlardan kurum toplamı kritik seviyeye eşit ya
 * da altında olanlar, aciliyet sırasında; depo kırılımı, öneri miktarı (K-201) ve son alış fiyatı
 * (K-202); siparişe dönmemiş açık taleplerdeki miktar (ON-339, K-222). Arama kod ve adda, kategori
 * süzgeci kartta.
 */
export async function listCriticalStockFor(ctx: ServiceContext, query: CriticalStockQuery) {
  const [items, warehouses, balances] = await Promise.all([
    loadStockItems(ctx.db, ctx.institutionId),
    loadStockWarehouses(ctx.db, ctx.institutionId),
    loadStockBalances(ctx.db, ctx.institutionId),
  ])
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filtered = items.filter(
    (item) =>
      matches(search, item.code, item.name) &&
      (query.category === undefined || item.category === query.category),
  )
  const { items: page, total } = pageOf(
    criticalStockRows({ items: filtered, warehouses, balances }),
    query,
  )
  const shownWarehouses = new Set(page.flatMap((row) => row.warehouses.map((w) => w.warehouseId)))
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]))
  const pageIds = page.map((row) => row.item.id)
  const [campuses, prices, openRequests] = await Promise.all([
    campusRecords(
      ctx.db,
      ctx.institutionId,
      warehouses.filter((warehouse) => shownWarehouses.has(warehouse.id)).map((w) => w.campusId),
    ),
    loadLastReceiptPrices(ctx.db, ctx.institutionId, pageIds),
    loadOpenRequestQuantities(ctx.db, ctx.institutionId, pageIds),
  ])
  return {
    items: page.map((row) => {
      const price = prices.get(row.item.id)
      const open = openRequests.get(row.item.id)
      return {
        id: row.item.id,
        code: row.item.code,
        name: row.item.name,
        category: row.item.category,
        unit: row.item.unit,
        minQuantity: row.minQuantity,
        quantity: row.quantity,
        shortage: row.shortage,
        suggestedQuantity: row.suggestedQuantity,
        lastUnitPriceCents: price?.unitPriceCents ?? null,
        lastReceiptDate: price?.receiptDate ?? null,
        lastOrderNumber: price?.orderNumber ?? null,
        openRequestQuantity: open?.quantity ?? 0,
        openRequestCount: open?.requestCount ?? 0,
        warehouses: row.warehouses.map((balance) => {
          const warehouse = warehouseById.get(balance.warehouseId)
          return {
            warehouseId: balance.warehouseId,
            warehouseName: warehouse?.name ?? '',
            campusName:
              warehouse === undefined ? null : (campuses.get(warehouse.campusId)?.name ?? null),
            isActive: warehouse?.isActive ?? false,
            quantity: balance.quantity,
          }
        }),
      }
    }),
    total,
  }
}

/** Kart ayrıntısı: depo başına miktar ve kimyasal bilgisi (DOM-FIN-077, DOM-FIN-090). */
export async function itemDetail(db: Database, ctx: ServiceContext, id: string) {
  const [items, warehouses, balances, hasMovements, profiles] = await Promise.all([
    loadStockItemsByIds(db, ctx.institutionId, [id]),
    loadStockWarehouses(db, ctx.institutionId),
    loadStockBalances(db, ctx.institutionId, { itemId: id }),
    stockItemHasMovements(db, ctx.institutionId, id),
    loadChemicalProfiles(db, ctx.institutionId, [id]),
  ])
  const item = items[0]
  if (item === undefined) throw new NotFoundError()
  const byWarehouse = new Map(balances.map((row) => [row.warehouseId, row.quantity]))
  const shown = warehouses.filter(
    (warehouse) => warehouse.isActive || (byWarehouse.get(warehouse.id) ?? 0) !== 0,
  )
  const campuses = await campusRecords(
    db,
    ctx.institutionId,
    shown.map((warehouse) => warehouse.campusId),
  )
  const quantity = balances.reduce((total, row) => total + row.quantity, 0)
  const profile = profiles[0]
  return {
    ...itemRow(item, quantity, profile !== undefined),
    hasMovements,
    chemical: profile === undefined ? null : chemicalView(profile),
    balances: shown.map((warehouse) => ({
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      campusName: campuses.get(warehouse.campusId)?.name ?? null,
      isActive: warehouse.isActive,
      quantity: byWarehouse.get(warehouse.id) ?? 0,
    })),
  }
}

export const getStockItemFor = (ctx: ServiceContext, id: string) => itemDetail(ctx.db, ctx, id)

/** Yeni stok kartı (DOM-FIN-077); kod kurumda tekil. 201. */
export function createStockItemCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ITEM, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stock_item.create',
      collections: [],
      entity,
      load: async (tx) => {
        const items = await loadStockItems(tx, ctx.institutionId)
        return { run: () => planStockItem(input, { items }) }
      },
      after: async (tx, data) => {
        await insertStockItem(tx, ctx.institutionId, { ...data, id, now: ctx.now })
        await auditWork(tx, ctx, 'stock_item.create', entity, Object.keys(data))
        body = { data: await itemDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kart düzeltmesi ve pasifleştirme (K-182). */
export function updateStockItemCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ITEM, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stock_item.update',
      collections: [],
      entity,
      load: async (tx) => {
        const [items, balances, hasMovements] = await Promise.all([
          loadStockItems(tx, ctx.institutionId),
          loadStockBalances(tx, ctx.institutionId, { itemId: id }),
          stockItemHasMovements(tx, ctx.institutionId, id),
        ])
        const current = items.find((item) => item.id === id)
        if (current === undefined) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        const quantity = balances.reduce((total, row) => total + row.quantity, 0)
        return {
          run: () => planStockItemUpdate(current, input, { items, hasMovements, quantity }),
        }
      },
      after: async (tx, changes) => {
        const saved = await updateStockItem(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'stock_item.update', entity, Object.keys(changes))
        body = { data: await itemDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Depo ----------------------------------------------------------------------------------------

async function warehouseRows(
  db: Database,
  ctx: ServiceContext,
  warehouses: readonly StoredStockWarehouse[],
) {
  const [campuses, balances] = await Promise.all([
    campusRecords(
      db,
      ctx.institutionId,
      warehouses.map((warehouse) => warehouse.campusId),
    ),
    loadStockBalances(db, ctx.institutionId),
  ])
  return warehouses.map((warehouse) => ({
    ...warehouse,
    campusName: campuses.get(warehouse.campusId)?.name ?? null,
    itemCount: balances.filter((row) => row.warehouseId === warehouse.id && row.quantity !== 0)
      .length,
  }))
}

export interface StockWarehouseListQuery extends Page {
  q?: string | undefined
  status?: 'active' | 'inactive' | undefined
  campusId?: string | undefined
}

/** Depolar ada göre; stoklu ürün çeşidi sayısıyla. */
export async function listStockWarehousesFor(ctx: ServiceContext, query: StockWarehouseListQuery) {
  const all = await loadStockWarehouses(ctx.db, ctx.institutionId)
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filtered = all.filter(
    (warehouse) =>
      matches(search, warehouse.name) &&
      (query.status === undefined || warehouse.isActive === (query.status === 'active')) &&
      (query.campusId === undefined || warehouse.campusId === query.campusId),
  )
  const { items, total } = pageOf(filtered, query)
  return { items: await warehouseRows(ctx.db, ctx, items), total }
}

async function warehouseBody(tx: Database, ctx: ServiceContext, id: string) {
  const warehouse = (await loadStockWarehouses(tx, ctx.institutionId)).find(
    (item) => item.id === id,
  )
  if (warehouse === undefined) throw new NotFoundError()
  const [row] = await warehouseRows(tx, ctx, [warehouse])
  return { data: row }
}

const activeCampusIds = async (tx: Database, ctx: ServiceContext, campusId: string | undefined) => {
  if (campusId === undefined) return new Set<string>()
  const campuses = await campusRecords(tx, ctx.institutionId, [campusId])
  return new Set([...campuses].filter(([, campus]) => campus.isActive).map(([id]) => id))
}

const campusOf = (input: unknown) =>
  typeof input === 'object' &&
  input !== null &&
  'campusId' in input &&
  typeof input.campusId === 'string'
    ? input.campusId.trim()
    : undefined

/** Yeni depo (DOM-FIN-077, K-180): etkin kampüse bağlı, ad tekil. 201. */
export function createStockWarehouseCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: WAREHOUSE, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stock_warehouse.create',
      collections: [],
      entity,
      load: async (tx) => {
        const [warehouses, campusIds] = await Promise.all([
          loadStockWarehouses(tx, ctx.institutionId),
          activeCampusIds(tx, ctx, campusOf(input)),
        ])
        return {
          run: () => planStockWarehouse(input, { warehouses, activeCampusIds: campusIds }),
        }
      },
      after: async (tx, data) => {
        await insertStockWarehouse(tx, ctx.institutionId, { ...data, id, now: ctx.now })
        await auditWork(tx, ctx, 'stock_warehouse.create', entity, Object.keys(data))
        body = await warehouseBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Depo düzeltmesi ve pasifleştirme; stoku olan depo taşınmaz ve pasifleşmez (K-180). */
export function updateStockWarehouseCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: WAREHOUSE, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stock_warehouse.update',
      collections: [],
      entity,
      load: async (tx) => {
        const [warehouses, balances, campusIds] = await Promise.all([
          loadStockWarehouses(tx, ctx.institutionId),
          loadStockBalances(tx, ctx.institutionId, { warehouseId: id }),
          activeCampusIds(tx, ctx, campusOf(input)),
        ])
        const current = warehouses.find((warehouse) => warehouse.id === id)
        if (current === undefined) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        // Depoda herhangi bir ürünün miktarı varsa depo dolu sayılır.
        const quantity = balances.some((row) => row.quantity !== 0) ? 1 : 0
        return {
          run: () =>
            planStockWarehouseUpdate(current, input, {
              warehouses,
              activeCampusIds: campusIds,
              quantity,
            }),
        }
      },
      after: async (tx, changes) => {
        const saved = await updateStockWarehouse(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'stock_warehouse.update', entity, Object.keys(changes))
        body = await warehouseBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Hareket -------------------------------------------------------------------------------------

/** Hareket yanıtları: kart, depo, kampüs, karşı depo, kaynak sipariş ve kişi adları. */
async function movementViews(
  db: Database,
  ctx: ServiceContext,
  movements: readonly StoredStockMovement[],
) {
  const transferIds = movements.flatMap((movement) =>
    movement.transferId === null ? [] : [movement.transferId],
  )
  const receiptIds = movements.flatMap((movement) =>
    movement.receiptId === null ? [] : [movement.receiptId],
  )
  const [items, warehouses, transfers, orders, names, lots] = await Promise.all([
    loadStockItemsByIds(
      db,
      ctx.institutionId,
      movements.map((movement) => movement.itemId),
    ),
    loadStockWarehouses(db, ctx.institutionId),
    loadTransferMovements(db, ctx.institutionId, transferIds),
    loadReceiptOrders(db, ctx.institutionId, receiptIds),
    purchaseActorNames(
      db,
      ctx.institutionId,
      movements.flatMap((movement) =>
        movement.cancelledByUserId === null
          ? [movement.createdByUserId]
          : [movement.createdByUserId, movement.cancelledByUserId],
      ),
    ),
    loadMovementLots(
      db,
      ctx.institutionId,
      movements.filter((movement) => movement.type === 'in').map((movement) => movement.id),
    ),
  ])
  const itemById = new Map(items.map((item) => [item.id, item]))
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]))
  const campuses = await campusRecords(
    db,
    ctx.institutionId,
    warehouses.map((warehouse) => warehouse.campusId),
  )
  const canCancel = stockActions(ctx.actor.role).cancel
  const nameOf = (userId: string | null) => (userId === null ? null : (names.get(userId) ?? null))
  return movements.map((movement) => {
    const item = itemById.get(movement.itemId)
    const warehouse = warehouseById.get(movement.warehouseId)
    const counterpart =
      movement.transferId === null
        ? undefined
        : transfers.find(
            (other) => other.transferId === movement.transferId && other.id !== movement.id,
          )
    const order = movement.receiptId === null ? undefined : orders.get(movement.receiptId)
    const lot = lots.get(movement.id)
    return {
      id: movement.id,
      type: movement.type,
      movementDate: movement.movementDate,
      itemId: movement.itemId,
      itemCode: item?.code ?? '',
      itemName: item?.name ?? '',
      unit: item?.unit ?? 'piece',
      warehouseId: movement.warehouseId,
      warehouseName: warehouse?.name ?? '',
      campusName: warehouse === undefined ? null : (campuses.get(warehouse.campusId)?.name ?? null),
      quantity: movement.quantity,
      reason: movement.reason,
      note: movement.note,
      transferId: movement.transferId,
      counterpartWarehouseName:
        counterpart === undefined
          ? null
          : (warehouseById.get(counterpart.warehouseId)?.name ?? null),
      orderId: order?.orderId ?? null,
      orderNumber: order?.orderNumber ?? null,
      lotNumber: lot?.lotNumber ?? null,
      expiryDate: lot?.expiryDate ?? null,
      createdAt: movement.createdAt,
      createdByName: nameOf(movement.createdByUserId),
      cancelledAt: movement.cancelledAt,
      cancelledByName: nameOf(movement.cancelledByUserId),
      cancelReason: movement.cancelReason,
      actions: {
        cancel:
          canCancel &&
          movement.cancelledAt === null &&
          movement.receiptId === null &&
          movement.type !== 'delivery',
      },
      version: movement.version,
    }
  })
}

export async function listStockMovementsFor(ctx: ServiceContext, query: StockMovementQuery) {
  const { items, total } = await listStockMovements(ctx.db, ctx.institutionId, query)
  return { items: await movementViews(ctx.db, ctx, items), total }
}

/**
 * Hareketin ürün ve depo bağlamı: kartlar, bütün depolar ve ilgili çiftlerin hareketleri. Materyal
 * seti teslimi (DOM-FIN-080) de çıkış denetimini bununla kurar; kurum kilidi altında çağrılır.
 */
export async function movementContext(
  tx: Database,
  ctx: ServiceContext,
  itemIds: readonly (string | undefined)[],
  pairs: readonly { itemId: string; warehouseId: string }[],
) {
  const [items, warehouses, movements] = await Promise.all([
    loadStockItemsByIds(
      tx,
      ctx.institutionId,
      itemIds.filter((id): id is string => id !== undefined),
    ),
    loadStockWarehouses(tx, ctx.institutionId),
    loadPairMovements(tx, ctx.institutionId, pairs),
  ])
  return {
    items: new Map(items.map((item) => [item.id, itemRef(item)])),
    warehouses: new Map(warehouses.map((warehouse) => [warehouse.id, warehouseRef(warehouse)])),
    movements,
  }
}

const field = (input: unknown, key: string): string | undefined => {
  if (typeof input !== 'object' || input === null) return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}
const uuidLike = (value: string | undefined) =>
  value !== undefined && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined
const pairFrom = (input: unknown, warehouseKey: string) => {
  const itemId = uuidLike(field(input, 'itemId'))
  const warehouseId = uuidLike(field(input, warehouseKey))
  return itemId === undefined || warehouseId === undefined ? [] : [{ itemId, warehouseId }]
}

async function movementBody(tx: Database, ctx: ServiceContext, ids: readonly string[]) {
  const movements = await Promise.all(ids.map((id) => findStockMovement(tx, ctx.institutionId, id)))
  // Transferin iki bacağı veritabanından sırasız gelir; yanıt hep önce çıkışı, sonra girişi verir.
  const legOrder = (type: string) => (type === 'transfer_in' ? 1 : 0)
  return movementViews(
    tx,
    ctx,
    movements
      .filter((movement): movement is StoredStockMovement => movement !== null)
      .sort((a, b) => legOrder(a.type) - legOrder(b.type)),
  )
}

type ManualKind = 'entry' | 'issue'

/** Elle giriş ya da çıkış (DOM-FIN-078). Çıkış kalan miktarı kurum kilidi altında denetler. 201. */
export function createStockMovementCommand(
  ctx: ServiceContext,
  kind: ManualKind,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: MOVEMENT, id }
  const action = kind === 'entry' ? 'stock_movement.entry' : 'stock_movement.issue'
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const itemId = uuidLike(field(input, 'itemId'))
        const [context, profiles] = await Promise.all([
          movementContext(
            tx,
            ctx,
            [itemId],
            kind === 'issue' ? pairFrom(input, 'warehouseId') : [],
          ),
          kind === 'entry' && itemId !== undefined
            ? loadChemicalProfiles(tx, ctx.institutionId, [itemId])
            : Promise.resolve([]),
        ])
        const today = dayKey(ctx.now)
        // Kimyasal kartın girişi parti ister (DOM-FIN-090, K-241).
        const chemicalItemIds = new Set(profiles.map((profile) => profile.itemId))
        return {
          run: () =>
            kind === 'entry'
              ? planStockEntry(input, { ...context, today, chemicalItemIds })
              : {
                  ...planStockIssue(input, { ...context, today }),
                  lotNumber: null,
                  expiryDate: null,
                },
        }
      },
      after: async (tx, data) => {
        const type: StockMovementType = kind === 'entry' ? 'in' : 'out'
        await insertStockMovements(tx, ctx.institutionId, {
          movements: [
            {
              id,
              itemId: data.itemId,
              warehouseId: data.warehouseId,
              type,
              quantity: data.quantity,
              movementDate: data.movementDate,
              reason: data.reason,
              note: data.note,
              transferId: null,
              receiptId: null,
              receiptItemId: null,
            },
          ],
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (data.lotNumber !== null && data.expiryDate !== null)
          await insertMovementLot(tx, ctx.institutionId, {
            movementId: id,
            lotNumber: data.lotNumber,
            expiryDate: data.expiryDate,
            now: ctx.now,
          })
        await auditWork(tx, ctx, action, entity, [
          'itemId',
          'warehouseId',
          'quantity',
          'movementDate',
          'reason',
          ...(data.note === null ? [] : ['note']),
          ...(data.lotNumber === null ? [] : ['lotNumber', 'expiryDate']),
        ])
        const [view] = await movementBody(tx, ctx, [id])
        body = { data: view }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Depolar arası transfer (DOM-FIN-078): tek işlemde iki hareket, aynı `transferId`. 201. */
export function createStockTransferCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const transferId = randomUUID()
  const outId = randomUUID()
  const inId = randomUUID()
  const entity = { type: MOVEMENT, id: outId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stock_movement.transfer',
      collections: [],
      entity,
      load: async (tx) => {
        const context = await movementContext(
          tx,
          ctx,
          [uuidLike(field(input, 'itemId'))],
          pairFrom(input, 'fromWarehouseId'),
        )
        return { run: () => planStockTransfer(input, { ...context, today: dayKey(ctx.now) }) }
      },
      after: async (tx, data) => {
        const leg = (
          id: string,
          type: StockMovementType,
          warehouseId: string,
        ): NewStockMovement => ({
          id,
          itemId: data.itemId,
          warehouseId,
          type,
          quantity: data.quantity,
          movementDate: data.movementDate,
          reason: null,
          note: data.note,
          transferId,
          receiptId: null,
          receiptItemId: null,
        })
        await insertStockMovements(tx, ctx.institutionId, {
          movements: [
            leg(outId, 'transfer_out', data.fromWarehouseId),
            leg(inId, 'transfer_in', data.toWarehouseId),
          ],
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'stock_movement.transfer', entity, [
          'itemId',
          'fromWarehouseId',
          'toWarehouseId',
          'quantity',
          'movementDate',
          ...(data.note === null ? [] : ['note']),
        ])
        body = { data: { transferId, movements: await movementBody(tx, ctx, [outId, inId]) } }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Hareket iptali (K-183): transferin iki hareketi birlikte; giriş iptali stoku eksiye düşüremez. */
export function cancelStockMovementCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: MOVEMENT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stock_movement.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const movement = await findStockMovement(tx, ctx.institutionId, id)
        if (movement === null) throw new NotFoundError()
        if (movement.version !== expectedVersion) throw new ConflictError()
        const legs =
          movement.transferId === null
            ? [movement]
            : await loadTransferMovements(tx, ctx.institutionId, [movement.transferId])
        const context = await movementContext(
          tx,
          ctx,
          [movement.itemId],
          legs.map((leg) => ({ itemId: leg.itemId, warehouseId: leg.warehouseId })),
        )
        return { run: () => planStockMovementCancel(movement, input, context) }
      },
      after: async (tx, { reason, ids }) => {
        const saved = await cancelStockMovements(tx, ctx.institutionId, {
          ids,
          cancelledByUserId: ctx.actor.userId,
          cancelReason: reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        for (const cancelled of ids)
          await auditWork(tx, ctx, 'stock_movement.cancel', { type: MOVEMENT, id: cancelled }, [
            'cancelledAt',
            'cancelReason',
          ])
        body = { data: await movementBody(tx, ctx, ids) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Mal kabul bağı (K-184) ----------------------------------------------------------------------

/** Kabul gövdesinin stok girişleri; kart seçilmediyse boş. Kurum kilidi altında yüklenir. */
export async function planReceiptStock(
  tx: Database,
  ctx: ServiceContext,
  data: { warehouseId: string | null; lines: readonly ReceiptStockLine[] },
  orderUnits: ReadonlyMap<string, string>,
) {
  const itemIds = data.lines.flatMap((line) =>
    line.stockItemId === null ? [] : [line.stockItemId],
  )
  if (itemIds.length === 0)
    return () =>
      planReceiptStockEntries(data, { items: new Map(), warehouses: new Map(), orderUnits })
  const context = await movementContext(tx, ctx, itemIds, [])
  return () => planReceiptStockEntries(data, { ...context, orderUnits })
}

/** Kabul kalemlerinin stok girişlerini yazar (kalem başına bir hareket, kabul gününde). */
export async function writeReceiptStock(
  tx: Database,
  ctx: ServiceContext,
  receipt: { id: string; receiptDate: string; lineIds: ReadonlyMap<string, string> },
  entries: readonly {
    orderItemId: string
    itemId: string
    warehouseId: string
    quantity: number
  }[],
) {
  await insertStockMovements(tx, ctx.institutionId, {
    movements: entries.map((entry) => ({
      id: randomUUID(),
      itemId: entry.itemId,
      warehouseId: entry.warehouseId,
      type: 'receipt',
      quantity: entry.quantity,
      movementDate: receipt.receiptDate,
      reason: null,
      note: null,
      transferId: null,
      receiptId: receipt.id,
      receiptItemId: receipt.lineIds.get(entry.orderItemId) ?? null,
    })),
    createdByUserId: ctx.actor.userId,
    now: ctx.now,
  })
}

/** Kabul iptalinin stok planı: kabulün iptal edilmemiş girişleri; stok eksiye düşerse 422. */
export async function planReceiptStockCancellation(
  tx: Database,
  ctx: ServiceContext,
  receiptId: string,
) {
  const linked = (await loadReceiptStockMovements(tx, ctx.institutionId, [receiptId])).filter(
    (movement) => movement.cancelledAt === null,
  )
  if (linked.length === 0) return () => []
  const context = await movementContext(
    tx,
    ctx,
    linked.map((movement) => movement.itemId),
    linked.map((movement) => ({ itemId: movement.itemId, warehouseId: movement.warehouseId })),
  )
  return () =>
    planReceiptStockCancel(
      linked.map((movement) => movement.id),
      context,
    )
}

/** Kabul iptaliyle birlikte stok girişlerini iptal eder. */
export async function cancelReceiptStock(
  tx: Database,
  ctx: ServiceContext,
  ids: readonly string[],
  reason: string,
) {
  if (ids.length === 0) return
  const saved = await cancelStockMovements(tx, ctx.institutionId, {
    ids,
    cancelledByUserId: ctx.actor.userId,
    cancelReason: reason,
    now: ctx.now,
  })
  if (!saved) throw new ConflictError()
  for (const id of ids)
    await auditWork(tx, ctx, 'stock_movement.cancel', { type: MOVEMENT, id }, [
      'cancelledAt',
      'cancelReason',
    ])
}

/** Kabullerin stok bağı (mal kabul panosunda kalem başına kart ve depo adı). */
export async function receiptStockLinks(
  db: Database,
  ctx: ServiceContext,
  receiptIds: readonly string[],
) {
  const movements = await loadReceiptStockMovements(db, ctx.institutionId, receiptIds)
  if (movements.length === 0)
    return new Map<
      string,
      { stockItemId: string; stockItemName: string; warehouseId: string; warehouseName: string }
    >()
  const [items, warehouses] = await Promise.all([
    loadStockItemsByIds(
      db,
      ctx.institutionId,
      movements.map((movement) => movement.itemId),
    ),
    loadStockWarehouses(db, ctx.institutionId),
  ])
  const itemName = new Map(items.map((item) => [item.id, item.name]))
  const warehouseName = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]))
  return new Map(
    movements.flatMap((movement) =>
      movement.receiptItemId === null
        ? []
        : [
            [
              movement.receiptItemId,
              {
                stockItemId: movement.itemId,
                stockItemName: itemName.get(movement.itemId) ?? '',
                warehouseId: movement.warehouseId,
                warehouseName: warehouseName.get(movement.warehouseId) ?? '',
              },
            ],
          ],
    ),
  )
}
