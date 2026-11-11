import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  chemicalExpiry,
  chemicalInventoryCsv,
  chemicalInventoryRows,
  chemicalLotBalances,
  isChemicalAttention,
  planChemicalProfile,
  planChemicalProfileUpdate,
  type ChemicalExpiryStatus,
} from '@kampus/school-core/lib/finance-chemicals.ts'

import {
  insertChemicalProfile,
  loadChemicalProfiles,
  loadLotLedger,
  updateChemicalProfile,
} from '../db/finance-chemicals.ts'
import { loadStockItemsByIds, loadStockWarehouses } from '../db/finance-inventory.ts'
import { foldSearch } from '../db/text-search.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { campusRecords, itemDetail } from './finance-inventory.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Laboratuvar kimyasal envanteri (DOM-FIN-090; ON-234). Kimyasal bilgisi stok kartına bağlıdır
 * (K-240); parti miktarı saklanmaz, kartların iptal edilmemiş hareketlerinden core
 * `chemicalLotBalances` ile FEFO düşülerek okunduğu anda hesaplanır (K-242). Son kullanma uyarısı
 * ve envanter raporu bu partilerden türer (K-243). Rol ve modül denetimi rotadadır.
 */

const PROFILE = 'stock_chemical_profiles'

interface Page {
  page: number
  pageSize: number
}
const pageOf = <T>(items: readonly T[], query: Page) => ({
  items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
  total: items.length,
})
const matches = (search: string | undefined, ...values: (string | null)[]) =>
  search === undefined ||
  values.some((value) => value !== null && foldSearch(value).includes(search))

// --- Kimyasal bilgisi ----------------------------------------------------------------------------

/** Kartı kimyasal olarak işaretler (K-240); kart yoksa ya da başka kurumunsa 404. 201. */
export function createChemicalProfileCommand(
  ctx: ServiceContext,
  itemId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PROFILE, id: itemId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stock_chemical_profile.create',
      collections: [],
      entity,
      load: async (tx) => {
        const [items, profiles] = await Promise.all([
          loadStockItemsByIds(tx, ctx.institutionId, [itemId]),
          loadChemicalProfiles(tx, ctx.institutionId, [itemId]),
        ])
        if (items.length === 0) throw new NotFoundError()
        return {
          run: () =>
            planChemicalProfile(input, { exists: profiles.length > 0, today: dayKey(ctx.now) }),
        }
      },
      after: async (tx, data) => {
        await insertChemicalProfile(tx, ctx.institutionId, { ...data, itemId, now: ctx.now })
        await auditWork(tx, ctx, 'stock_chemical_profile.create', entity, Object.keys(data))
        body = { data: await itemDetail(tx, ctx, itemId) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kimyasal bilgisi düzeltmesi (K-240); `If-Match` kimyasal bilgisinin sürümüdür. */
export function updateChemicalProfileCommand(
  ctx: ServiceContext,
  itemId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PROFILE, id: itemId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stock_chemical_profile.update',
      collections: [],
      entity,
      load: async (tx) => {
        const [current] = await loadChemicalProfiles(tx, ctx.institutionId, [itemId])
        if (current === undefined) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planChemicalProfileUpdate(input, { today: dayKey(ctx.now) }) }
      },
      after: async (tx, changes) => {
        const saved = await updateChemicalProfile(tx, ctx.institutionId, {
          itemId,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'stock_chemical_profile.update', entity, Object.keys(changes))
        body = { data: await itemDetail(tx, ctx, itemId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Partiler ve rapor ---------------------------------------------------------------------------

/** Kurumun kimyasal kartları, depoları ve FEFO ile türetilen parti miktarları. */
async function chemicalStock(ctx: ServiceContext) {
  const profiles = await loadChemicalProfiles(ctx.db, ctx.institutionId)
  const itemIds = profiles.map((profile) => profile.itemId)
  const [items, warehouses, ledger] = await Promise.all([
    loadStockItemsByIds(ctx.db, ctx.institutionId, itemIds),
    loadStockWarehouses(ctx.db, ctx.institutionId),
    loadLotLedger(ctx.db, ctx.institutionId, itemIds),
  ])
  const campuses = await campusRecords(
    ctx.db,
    ctx.institutionId,
    warehouses.map((warehouse) => warehouse.campusId),
  )
  const profileOf = new Map(profiles.map((profile) => [profile.itemId, profile]))
  return {
    items: items.flatMap((item) => {
      const profile = profileOf.get(item.id)
      return profile === undefined
        ? []
        : [
            {
              id: item.id,
              code: item.code,
              name: item.name,
              unit: item.unit,
              hazardPictograms: profile.hazardPictograms,
              signalWord: profile.signalWord,
              casNumber: profile.casNumber,
              storageClass: profile.storageClass,
              sdsUrl: profile.sdsUrl,
              sdsDocumentNumber: profile.sdsDocumentNumber,
            },
          ]
    }),
    warehouses: warehouses.map((warehouse) => ({
      id: warehouse.id,
      name: warehouse.name,
      campusName: campuses.get(warehouse.campusId)?.name ?? null,
      isActive: warehouse.isActive,
    })),
    lots: chemicalLotBalances(ledger.movements, ledger.lots),
    today: dayKey(ctx.now),
  }
}

export interface ChemicalLotQuery extends Page {
  status?: ChemicalExpiryStatus | 'attention' | undefined
  itemId?: string | undefined
  warehouseId?: string | undefined
  q?: string | undefined
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Stoktaki kimyasal partiler (DOM-FIN-090, K-243): en yakın son kullanma önce, partisiz miktar
 * sonda; eşitlikte depo adı, kart kodu ve parti numarası. `attention` süresi geçen ve 30 gün içinde
 * dolan partileri verir (uyarı listesi).
 */
export async function listChemicalLotsFor(ctx: ServiceContext, query: ChemicalLotQuery) {
  const stock = await chemicalStock(ctx)
  const items = new Map(stock.items.map((item) => [item.id, item]))
  const warehouses = new Map(stock.warehouses.map((warehouse) => [warehouse.id, warehouse]))
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const rows = stock.lots.flatMap((lot) => {
    const item = items.get(lot.itemId)
    const warehouse = warehouses.get(lot.warehouseId)
    if (item === undefined || warehouse === undefined) return []
    const expiry = chemicalExpiry(lot.expiryDate, stock.today)
    const keep =
      (query.status === undefined ||
        (query.status === 'attention'
          ? isChemicalAttention(expiry.status)
          : expiry.status === query.status)) &&
      (query.itemId === undefined || item.id === query.itemId) &&
      (query.warehouseId === undefined || warehouse.id === query.warehouseId) &&
      matches(search, item.code, item.name, item.casNumber, lot.lotNumber)
    if (!keep) return []
    return [
      {
        key: [item.id, warehouse.id, lot.lotNumber ?? '', lot.expiryDate ?? ''].join('|'),
        itemId: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        hazardPictograms: item.hazardPictograms,
        signalWord: item.signalWord,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        campusName: warehouse.campusName,
        warehouseIsActive: warehouse.isActive,
        lotNumber: lot.lotNumber,
        expiryDate: lot.expiryDate,
        quantity: lot.quantity,
        status: expiry.status,
        daysLeft: expiry.daysLeft,
      },
    ]
  })
  rows.sort(
    (a, b) =>
      (a.expiryDate === null ? 1 : 0) - (b.expiryDate === null ? 1 : 0) ||
      compareText(a.expiryDate ?? '', b.expiryDate ?? '') ||
      a.warehouseName.localeCompare(b.warehouseName, 'tr') ||
      compareText(a.code, b.code) ||
      compareText(a.lotNumber ?? '', b.lotNumber ?? ''),
  )
  return pageOf(rows, query)
}

export interface ChemicalInventoryQuery {
  warehouseId?: string | undefined
  q?: string | undefined
}

async function inventoryRows(ctx: ServiceContext, query: ChemicalInventoryQuery) {
  const stock = await chemicalStock(ctx)
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  return chemicalInventoryRows(stock)
    .filter(
      (row) =>
        (query.warehouseId === undefined || row.warehouseId === query.warehouseId) &&
        matches(search, row.code, row.name, row.casNumber),
    )
    .map((row) => ({ key: `${row.warehouseId}|${row.itemId}`, ...row }))
}

/** Kimyasal envanter raporu (DOM-FIN-090): depo × kimyasal, stokta olanlar, partileriyle. */
export async function chemicalInventoryFor(
  ctx: ServiceContext,
  query: ChemicalInventoryQuery & Page,
) {
  return pageOf(await inventoryRows(ctx, query), query)
}

/** Raporun CSV'si: süzgeçle eşleşen bütün satırlar, parti başına bir satır; kişi verisi yok. */
export async function chemicalInventoryCsvFor(ctx: ServiceContext, query: ChemicalInventoryQuery) {
  return {
    csv: chemicalInventoryCsv(await inventoryRows(ctx, query)),
    filename: `kimyasal-envanter-${dayKey(ctx.now)}.csv`,
  }
}
