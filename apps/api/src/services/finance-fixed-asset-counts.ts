import { randomUUID } from 'node:crypto'

import {
  fixedAssetCountScanSchema,
  fixedAssetCountSchema,
  fixedAssetCountScopeKey,
  fixedAssetCountScopeOf,
  planFixedAssetCountClose,
  planFixedAssetCountRelocate,
  planFixedAssetCountScan,
  planFixedAssetCountStart,
  type FixedAssetCountScanChecks,
  type FixedAssetCountStartChecks,
} from '@kampus/school-core/lib/finance-fixed-asset-counts.ts'

import type { Database } from '../db/client.ts'
import {
  closeCount,
  findAssetByTag,
  findCount,
  findCountItem,
  hasOpenCount,
  insertCount,
  insertScannedItem,
  listCountItems,
  listCountPlaces,
  listCounts,
  loadCountableAssets,
  markItemRelocated,
  markItemScanned,
  type CountItemQuery,
  type CountQuery,
  type StoredCount,
  type StoredCountItem,
} from '../db/finance-fixed-asset-counts.ts'
import { findFixedAsset, updateFixedAsset } from '../db/finance-fixed-assets.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { campusNames } from './finance-fixed-assets.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Demirbaş sayımı (DOM-FIN-087; ON-237). Kural core `lib/finance-fixed-asset-counts.ts`'tedir;
 * servis kurum kilidi altında kapsamı, açık sayımı, demirbaşı ve sayım satırını yükler, aynı
 * transaction'da yazar. Başlatma, tamamlama, iptal ve konum düzeltmesi denetim kaydına alan
 * adlarıyla yazılır; okutmanın izi satırın kendisidir (okutan ve zaman), her okutma için ayrıca
 * denetim satırı açılmaz. Rol ve modül denetimi rotadadır (yalnız yönetici, K-189).
 */

const COUNT_ENTITY = 'fixed_asset_counts'
const ITEM_ENTITY = 'fixed_asset_count_items'

function countView(count: StoredCount, campuses: ReadonlyMap<string, string>) {
  return {
    ...count,
    campusName: count.campusId === null ? null : (campuses.get(count.campusId) ?? null),
  }
}

function itemView(item: StoredCountItem, campuses: ReadonlyMap<string, string>) {
  const name = (id: string | null) => (id === null ? null : (campuses.get(id) ?? null))
  return {
    id: item.id,
    assetId: item.assetId,
    inScope: item.inScope,
    tagNumber: item.tagNumber,
    assetName: item.assetName,
    recordedCampusId: item.recordedCampusId,
    recordedCampusName: name(item.recordedCampusId),
    recordedLocation: item.recordedLocation,
    result: item.result,
    observedCampusId: item.observedCampusId,
    observedCampusName: name(item.observedCampusId),
    observedLocation: item.observedLocation,
    scannedAt: item.scannedAt,
    relocatedAt: item.relocatedAt,
    version: item.version,
  }
}

async function countOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findCount(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

const countBody = async (db: Database, ctx: ServiceContext, id: string) => {
  const count = await countOf(db, ctx, id)
  return { data: countView(count, await campusNames(db, ctx.institutionId, [count.campusId])) }
}

async function itemViews(db: Database, ctx: ServiceContext, items: readonly StoredCountItem[]) {
  const campuses = await campusNames(
    db,
    ctx.institutionId,
    items.flatMap((item) => [item.recordedCampusId, item.observedCampusId]),
  )
  return items.map((item) => itemView(item, campuses))
}

export async function listFixedAssetCountsFor(ctx: ServiceContext, query: CountQuery) {
  const { items, total } = await listCounts(ctx.db, ctx.institutionId, query)
  const campuses = await campusNames(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.campusId),
  )
  return { items: items.map((item) => countView(item, campuses)), total }
}

export async function getFixedAssetCountFor(ctx: ServiceContext, id: string) {
  return (await countBody(ctx.db, ctx, id)).data
}

/** Sayım satırları; başka kurumun ya da olmayan sayım 404. */
export async function listFixedAssetCountItemsFor(
  ctx: ServiceContext,
  countId: string,
  query: CountItemQuery,
) {
  await countOf(ctx.db, ctx, countId)
  const { items, total } = await listCountItems(ctx.db, ctx.institutionId, countId, query)
  return { items: await itemViews(ctx.db, ctx, items), total }
}

/** Demirbaşların bulunduğu yerler (kapsam ve sayılan yer önerisi). */
export async function listFixedAssetPlacesFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined; campusId?: string | undefined },
) {
  const { items, total } = await listCountPlaces(ctx.db, ctx.institutionId, query)
  const campuses = await campusNames(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.campusId),
  )
  return {
    items: items.map((item) => ({
      ...item,
      campusName: item.campusId === null ? null : (campuses.get(item.campusId) ?? null),
    })),
    total,
  }
}

/** Sayım başlat (K-232, K-234): beklenen liste aynı transaction'da dondurulur. 201. */
export function startFixedAssetCountCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: COUNT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'fixed_asset_count.start',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = fixedAssetCountSchema.parse(input)
        const scope = fixedAssetCountScopeOf(parsed)
        const checks: FixedAssetCountStartChecks = {
          openSameScope: await hasOpenCount(tx, ctx.institutionId, fixedAssetCountScopeKey(scope)),
          assets: await loadCountableAssets(
            tx,
            ctx.institutionId,
            scope.scopeType === 'institution' ? {} : { campusId: scope.campusId },
          ),
        }
        if (scope.campusId !== null)
          checks.campusFound =
            (await campusNames(tx, ctx.institutionId, [scope.campusId])).size === 1
        return { run: () => planFixedAssetCountStart(parsed, checks) }
      },
      after: async (tx, planned) => {
        await insertCount(tx, ctx.institutionId, {
          id,
          ...planned.scope,
          scopeKey: planned.scopeKey,
          note: planned.note,
          startedByUserId: ctx.actor.userId,
          now: ctx.now,
          items: planned.items,
          newId: randomUUID,
        })
        await auditWork(tx, ctx, 'fixed_asset_count.start', entity, [
          'scopeType',
          ...(planned.scope.campusId === null ? [] : ['campusId']),
          ...(planned.scope.location === null ? [] : ['location']),
          ...(planned.note === null ? [] : ['note']),
        ])
        body = await countBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Okutma (K-233): kod kurumun demirbaşına bakar; kurumda yoksa (başka kurumun etiketi dahil) 422
 * ve hiçbir şey yazılmaz. Yanıt sonucu, satırı ve güncel özeti taşır; okuyucu ekranı bir sonraki
 * kodu beklerken listeyi yeniden okumaz.
 */
export function scanFixedAssetCountCommand(
  ctx: ServiceContext,
  countId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: COUNT_ENTITY, id: countId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'fixed_asset_count.scan',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = fixedAssetCountScanSchema.parse(input)
        const count = await countOf(tx, ctx, countId)
        const asset = await findAssetByTag(tx, ctx.institutionId, parsed.code)
        const item =
          asset === null
            ? null
            : await findCountItem(tx, ctx.institutionId, countId, { assetId: asset.id })
        const checks: FixedAssetCountScanChecks = { count, asset, item }
        if (count.scopeType === 'institution' && parsed.campusId !== null)
          checks.campusFound =
            (await campusNames(tx, ctx.institutionId, [parsed.campusId])).size === 1
        return {
          run: () => ({ plan: planFixedAssetCountScan(parsed, checks), asset, item }),
        }
      },
      after: async (tx, { plan, asset, item }) => {
        let itemId = item?.id ?? null
        if (plan.outcome !== 'already_counted' && asset !== null) {
          const fields = {
            result: plan.outcome,
            observed: plan.observed,
            scannedByUserId: ctx.actor.userId,
            now: ctx.now,
          }
          if (item === null) {
            itemId = randomUUID()
            await insertScannedItem(tx, ctx.institutionId, {
              ...fields,
              id: itemId,
              countId,
              asset,
            })
          } else if (!(await markItemScanned(tx, ctx.institutionId, { ...fields, id: item.id })))
            throw new ConflictError()
        }
        const saved =
          itemId === null
            ? null
            : await findCountItem(tx, ctx.institutionId, countId, { id: itemId })
        if (saved === null) throw new NotFoundError()
        const [view] = await itemViews(tx, ctx, [saved])
        const count = await countOf(tx, ctx, countId)
        body = { data: { outcome: plan.outcome, item: view, summary: count.summary } }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Tamamlama ya da iptal (K-234, K-235): demirbaş kayıtları değişmez. */
function closeFixedAssetCountCommand(
  ctx: ServiceContext,
  countId: string,
  status: 'completed' | 'cancelled',
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: COUNT_ENTITY, id: countId }
  const action = status === 'completed' ? 'fixed_asset_count.complete' : 'fixed_asset_count.cancel'
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const current = await countOf(tx, ctx, countId)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planFixedAssetCountClose(current) }
      },
      after: async (tx) => {
        const saved = await closeCount(tx, ctx.institutionId, {
          id: countId,
          expectedVersion,
          status,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, action, entity, ['status'])
        body = await countBody(tx, ctx, countId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

export const completeFixedAssetCountCommand = (
  ctx: ServiceContext,
  countId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) => closeFixedAssetCountCommand(ctx, countId, 'completed', expectedVersion, idempotency)

export const cancelFixedAssetCountCommand = (
  ctx: ServiceContext,
  countId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) => closeFixedAssetCountCommand(ctx, countId, 'cancelled', expectedVersion, idempotency)

/**
 * Konum düzeltmesi (K-235): tamamlanmış sayımda yanlış konumdaki demirbaşın kampüsü ve konumu
 * sayılan yere yazılır; demirbaşın sürümü artar, durumu ve zimmeti değişmez. `If-Match` satırın
 * sürümüdür.
 */
export function relocateFixedAssetCountItemCommand(
  ctx: ServiceContext,
  countId: string,
  itemId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ITEM_ENTITY, id: itemId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'fixed_asset_count.relocate',
      collections: [],
      entity,
      load: async (tx) => {
        const count = await countOf(tx, ctx, countId)
        const item = await findCountItem(tx, ctx.institutionId, countId, { id: itemId })
        if (item === null) throw new NotFoundError()
        if (item.version !== expectedVersion) throw new ConflictError()
        const asset = await findFixedAsset(tx, ctx.institutionId, item.assetId)
        if (asset === null) throw new NotFoundError()
        const campusFound =
          item.observedCampusId === null
            ? undefined
            : (await campusNames(tx, ctx.institutionId, [item.observedCampusId])).size === 1
        return {
          run: () => ({
            place: planFixedAssetCountRelocate({
              count,
              item,
              asset,
              ...(campusFound === undefined ? {} : { campusFound }),
            }),
            assetVersion: asset.version,
            assetId: asset.id,
          }),
        }
      },
      after: async (tx, { place, assetVersion, assetId }) => {
        const moved = await updateFixedAsset(tx, ctx.institutionId, {
          id: assetId,
          expectedVersion: assetVersion,
          changes: { campusId: place.campusId, location: place.location },
          now: ctx.now,
        })
        const marked = await markItemRelocated(tx, ctx.institutionId, {
          id: itemId,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!moved || !marked) throw new ConflictError()
        await auditWork(tx, ctx, 'fixed_asset_count.relocate', entity, ['campusId', 'location'])
        await auditWork(tx, ctx, 'fixed_asset.update', { type: 'fixed_assets', id: assetId }, [
          'campusId',
          'location',
        ])
        const saved = await findCountItem(tx, ctx.institutionId, countId, { id: itemId })
        if (saved === null) throw new NotFoundError()
        const [view] = await itemViews(tx, ctx, [saved])
        body = { data: view }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
