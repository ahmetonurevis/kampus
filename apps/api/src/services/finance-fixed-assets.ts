import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  fixedAssetSchema,
  nextFixedAssetTag,
  planFixedAsset,
  planFixedAssetScrap,
  scrapFixedAssetSchema,
  updateFixedAssetSchema,
  type FixedAssetChecks,
  type FixedAssetDraft,
} from '@kampus/school-core/lib/finance-fixed-assets.ts'

import type { Database } from '../db/client.ts'
import {
  findFixedAsset,
  insertFixedAsset,
  isFixedAssetTagTaken,
  listFixedAssets,
  listLinkableReceiptItems,
  loadReceiptItemViews,
  loadReceiptRef,
  loadYearTags,
  updateFixedAsset,
  type FixedAssetQuery,
  type StoredFixedAsset,
} from '../db/finance-fixed-assets.ts'
import { findSupplier } from '../db/finance-suppliers.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Demirbaş kaydı (DOM-FIN-085; ON-235). Kural core `lib/finance-fixed-assets.ts`'tedir; servis
 * kurum kilidi altında etiket tekilliğini, sıradaki `DB-<yıl>-<sıra>` önerisini, kampüs ve
 * tedarikçinin varlığını ve mal kabul kaleminin kalan adedini yükler, aynı transaction'da yazar.
 * Denetim kaydına alan adları yazılır, değerler yazılmaz. Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'fixed_assets'
const DRAFT_KEYS = [
  'tagNumber',
  'name',
  'category',
  'campusId',
  'location',
  'acquisitionValueCents',
  'acquisitionDate',
  'supplierId',
  'receiptItemId',
  'status',
] as const satisfies readonly (keyof FixedAssetDraft)[]

const draftOf = (asset: StoredFixedAsset): FixedAssetDraft =>
  Object.fromEntries(DRAFT_KEYS.map((key) => [key, asset[key]])) as FixedAssetDraft

/** Kampüs adları (`branches` kaydı); arşivlenen kampüs adsız (`null`) döner. */
async function campusNames(db: Database, institutionId: string, ids: readonly (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
  const rows = await loadRecordsByIds(db, institutionId, 'branches', wanted)
  return new Map(
    rows.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : row.id]),
  )
}

function listView(asset: StoredFixedAsset, campuses: ReadonlyMap<string, string>) {
  return {
    id: asset.id,
    tagNumber: asset.tagNumber,
    name: asset.name,
    category: asset.category,
    campusId: asset.campusId,
    campusName: asset.campusId === null ? null : (campuses.get(asset.campusId) ?? null),
    location: asset.location,
    acquisitionValueCents: asset.acquisitionValueCents,
    acquisitionDate: asset.acquisitionDate,
    supplierId: asset.supplierId,
    supplierName: asset.supplierName,
    receiptItemId: asset.receiptItemId,
    status: asset.status,
    scrapDate: asset.scrapDate,
    version: asset.version,
  }
}

async function detailView(db: Database, ctx: ServiceContext, asset: StoredFixedAsset) {
  const [campuses, receipts] = await Promise.all([
    campusNames(db, ctx.institutionId, [asset.campusId]),
    loadReceiptItemViews(
      db,
      ctx.institutionId,
      asset.receiptItemId === null ? [] : [asset.receiptItemId],
    ),
  ])
  const receipt = asset.receiptItemId === null ? null : receipts.get(asset.receiptItemId)
  return {
    ...listView(asset, campuses),
    receipt:
      receipt === undefined || receipt === null
        ? null
        : {
            receiptId: receipt.receiptId,
            receiptDate: receipt.receiptDate,
            receiptCancelled: receipt.receiptCancelled,
            orderId: receipt.orderId,
            orderNumber: receipt.orderNumber,
            itemName: receipt.itemName,
            unitPriceCents: receipt.unitPriceCents,
            acceptedQuantity: receipt.acceptedQuantity,
            linkedAssetCount: receipt.linkedAssetCount,
          },
    scrappedAt: asset.scrappedAt,
    scrapReason: asset.scrapReason,
    createdAt: asset.createdAt,
  }
}

async function assetOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findFixedAsset(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

const assetBody = async (tx: Database, ctx: ServiceContext, id: string) => ({
  data: await detailView(tx, ctx, await assetOf(tx, ctx, id)),
})

export async function listFixedAssetsFor(ctx: ServiceContext, query: FixedAssetQuery) {
  const { items, total } = await listFixedAssets(ctx.db, ctx.institutionId, query)
  const campuses = await campusNames(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.campusId),
  )
  return { items: items.map((item) => listView(item, campuses)), total }
}

export async function getFixedAssetFor(ctx: ServiceContext, id: string) {
  return detailView(ctx.db, ctx, await assetOf(ctx.db, ctx, id))
}

/** Bağlanabilir mal kabul kalemleri (form seçimi): kalan adedi olan, iptal edilmemiş kabuller. */
export async function listFixedAssetReceiptItemsFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  const { items, total } = await listLinkableReceiptItems(ctx.db, ctx.institutionId, query)
  return {
    items: items.map((item) => ({
      receiptItemId: item.receiptItemId,
      receiptId: item.receiptId,
      receiptDate: item.receiptDate,
      orderId: item.orderId,
      orderNumber: item.orderNumber,
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      itemName: item.itemName,
      unitPriceCents: item.unitPriceCents,
      acceptedQuantity: item.acceptedQuantity,
      linkedAssetCount: item.linkedAssetCount,
    })),
    total,
  }
}

/** Değişen bağların denetim girdileri; değişmeyen bağ yeniden sınanmaz (core `FixedAssetChecks`). */
async function checksFor(
  tx: Database,
  ctx: ServiceContext,
  draft: FixedAssetDraft,
  previous: { asset: StoredFixedAsset } | null,
): Promise<FixedAssetChecks> {
  const changed = (key: keyof FixedAssetDraft) =>
    previous === null || previous.asset[key] !== draft[key]
  const exceptId = previous?.asset.id
  const checks: FixedAssetChecks = {
    today: dayKey(ctx.now),
    tagTaken:
      changed('tagNumber') &&
      (await isFixedAssetTagTaken(tx, ctx.institutionId, draft.tagNumber, exceptId)),
    ...(previous === null ? {} : { currentStatus: previous.asset.status }),
  }
  if (draft.campusId !== null && changed('campusId'))
    checks.campusFound = (await campusNames(tx, ctx.institutionId, [draft.campusId])).size === 1
  if (draft.supplierId !== null && changed('supplierId'))
    checks.supplierFound = (await findSupplier(tx, ctx.institutionId, draft.supplierId)) !== null
  if (
    draft.receiptItemId !== null &&
    (changed('receiptItemId') || changed('supplierId') || changed('acquisitionDate'))
  )
    checks.receipt = {
      ref: await loadReceiptRef(tx, ctx.institutionId, draft.receiptItemId, exceptId),
      link: changed('receiptItemId'),
    }
  return checks
}

/** Yeni demirbaş (DOM-FIN-085); etiket boşsa yılın sıradaki `DB-<yıl>-<sıra>` etiketi. 201. */
export function createFixedAssetCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'fixed_asset.create',
      collections: [],
      entity,
      load: async (tx) => {
        const { tagNumber, ...fields } = fixedAssetSchema.parse(input)
        const year = Number(dayKey(ctx.now).slice(0, 4))
        const draft: FixedAssetDraft = {
          ...fields,
          tagNumber:
            tagNumber ?? nextFixedAssetTag(year, await loadYearTags(tx, ctx.institutionId, year)),
        }
        const checks = await checksFor(tx, ctx, draft, null)
        return { run: () => planFixedAsset(draft, checks) }
      },
      after: async (tx, planned) => {
        await insertFixedAsset(tx, ctx.institutionId, {
          ...planned,
          id,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'fixed_asset.create', entity, Object.keys(planned))
        body = await assetBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kısmi düzeltme ve durum değişikliği (kullanımda, depoda, arızalı); hurdaya ayrılmış kayıt 422. */
export function updateFixedAssetCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'fixed_asset.update',
      collections: [],
      entity,
      load: async (tx) => {
        const changes = updateFixedAssetSchema.parse(input)
        const current = await assetOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const draft: FixedAssetDraft = { ...draftOf(current), ...changes }
        const checks = await checksFor(tx, ctx, draft, { asset: current })
        return {
          run: () => {
            const planned = planFixedAsset(draft, checks)
            // Gövdedeki alanlar ve core'un doldurduğu tedarikçi yazılır.
            const keys = DRAFT_KEYS.filter((key) => key in changes || planned[key] !== current[key])
            return Object.fromEntries(
              keys.map((key) => [key, planned[key]]),
            ) as Partial<FixedAssetDraft>
          },
        }
      },
      after: async (tx, written) => {
        const saved = await updateFixedAsset(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: written,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'fixed_asset.update', entity, Object.keys(written))
        body = await assetBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Hurdaya ayırma (K-188): gerekçe ve gün; kayıt silinmez, geri alınmaz. */
export function scrapFixedAssetCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'fixed_asset.scrap',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = scrapFixedAssetSchema.parse(input)
        const current = await assetOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        return {
          run: () => {
            planFixedAssetScrap(current, parsed, dayKey(ctx.now))
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const saved = await updateFixedAsset(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: {
            status: 'scrapped',
            scrappedAt: ctx.now,
            scrapDate: parsed.scrapDate,
            scrappedByUserId: ctx.actor.userId,
            scrapReason: parsed.reason,
          },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'fixed_asset.scrap', entity, ['status', 'scrapDate', 'reason'])
        body = await assetBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
