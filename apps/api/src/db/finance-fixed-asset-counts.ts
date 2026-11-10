import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm'

import type {
  CountableFixedAsset,
  FixedAssetCountItemResult,
  FixedAssetCountScopeType,
  FixedAssetCountStatus,
  FixedAssetPlace,
} from '@kampus/school-core/lib/finance-fixed-asset-counts.ts'

import type { Database } from './client.ts'
import { fixedAssetCountItems, fixedAssetCounts } from './schema/finance-fixed-asset-counts.ts'
import { fixedAssets } from './schema/finance-fixed-assets.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Demirbaş sayımı deposu (DOM-FIN-087; ON-237). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-fixed-asset-counts.ts`'tedir; depo yalnız okur ve yazar. Sayım özeti
 * (beklenen, bulunan, yanlış konumda, okunmayan, listede olmayan) satırlardan sayılır, saklanmaz.
 */

export interface FixedAssetCountSummary {
  expected: number
  found: number
  misplaced: number
  pending: number
  extra: number
}

export interface StoredCount {
  id: string
  scopeType: FixedAssetCountScopeType
  campusId: string | null
  location: string | null
  note: string | null
  status: FixedAssetCountStatus
  startedAt: string
  completedAt: string | null
  cancelledAt: string | null
  version: number
  summary: FixedAssetCountSummary
}

const EMPTY_SUMMARY: FixedAssetCountSummary = {
  expected: 0,
  found: 0,
  misplaced: 0,
  pending: 0,
  extra: 0,
}

const COUNT_COLUMNS = {
  id: fixedAssetCounts.id,
  scopeType: fixedAssetCounts.scopeType,
  campusId: fixedAssetCounts.campusId,
  location: fixedAssetCounts.location,
  note: fixedAssetCounts.note,
  status: fixedAssetCounts.status,
  startedAt: fixedAssetCounts.startedAt,
  completedAt: fixedAssetCounts.completedAt,
  cancelledAt: fixedAssetCounts.cancelledAt,
  version: fixedAssetCounts.version,
}
type CountRow = Omit<StoredCount, 'startedAt' | 'completedAt' | 'cancelledAt' | 'summary'> & {
  startedAt: Date
  completedAt: Date | null
  cancelledAt: Date | null
}
const iso = (value: Date | null) => (value === null ? null : value.toISOString())
const toCount = (row: CountRow, summary: FixedAssetCountSummary | undefined): StoredCount => ({
  ...row,
  startedAt: row.startedAt.toISOString(),
  completedAt: iso(row.completedAt),
  cancelledAt: iso(row.cancelledAt),
  summary: summary ?? EMPTY_SUMMARY,
})

const countsOf = (institutionId: string) =>
  and(eq(fixedAssetCounts.institutionId, institutionId), isNull(fixedAssetCounts.archivedAt))
const itemsOf = (institutionId: string) =>
  and(
    eq(fixedAssetCountItems.institutionId, institutionId),
    isNull(fixedAssetCountItems.archivedAt),
  )

const tally = (condition: SQL) => sql<number>`(count(*) filter (where ${condition}))::int`

/** Sayımların özetleri tek sorguda. */
async function loadSummaries(
  db: Database,
  institutionId: string,
  countIds: readonly string[],
): Promise<Map<string, FixedAssetCountSummary>> {
  if (countIds.length === 0) return new Map()
  const rows = await db
    .select({
      countId: fixedAssetCountItems.countId,
      expected: tally(sql`${fixedAssetCountItems.inScope}`),
      found: tally(sql`${fixedAssetCountItems.result} = 'found'`),
      misplaced: tally(sql`${fixedAssetCountItems.result} = 'misplaced'`),
      pending: tally(sql`${fixedAssetCountItems.result} = 'pending'`),
      extra: tally(sql`not ${fixedAssetCountItems.inScope}`),
    })
    .from(fixedAssetCountItems)
    .where(and(itemsOf(institutionId), inArray(fixedAssetCountItems.countId, [...countIds])))
    .groupBy(fixedAssetCountItems.countId)
  return new Map(rows.map(({ countId, ...summary }) => [countId, summary]))
}

export async function findCount(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredCount | null> {
  const [row] = await db
    .select(COUNT_COLUMNS)
    .from(fixedAssetCounts)
    .where(and(countsOf(institutionId), eq(fixedAssetCounts.id, id)))
    .limit(1)
  if (row === undefined) return null
  const summaries = await loadSummaries(db, institutionId, [id])
  return toCount(row, summaries.get(id))
}

export interface CountQuery {
  page: number
  pageSize: number
  status?: FixedAssetCountStatus | undefined
}

/** Sayımlar: açıklar önce, sonra yeni başlayan önce. */
export async function listCounts(
  db: Database,
  institutionId: string,
  query: CountQuery,
): Promise<{ items: StoredCount[]; total: number }> {
  const where = and(
    countsOf(institutionId),
    query.status === undefined ? undefined : eq(fixedAssetCounts.status, query.status),
  )
  const [totalRow] = await db.select({ total: count() }).from(fixedAssetCounts).where(where)
  const rows = await db
    .select(COUNT_COLUMNS)
    .from(fixedAssetCounts)
    .where(where)
    .orderBy(
      sql`${fixedAssetCounts.status} <> 'open'`,
      desc(fixedAssetCounts.startedAt),
      asc(fixedAssetCounts.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  const summaries = await loadSummaries(
    db,
    institutionId,
    rows.map((row) => row.id),
  )
  return {
    items: rows.map((row) => toCount(row, summaries.get(row.id))),
    total: totalRow?.total ?? 0,
  }
}

/** Aynı kapsam anahtarıyla açık sayım var mı (kurum kilidi altında; K-234). */
export async function hasOpenCount(
  tx: Database,
  institutionId: string,
  scopeKey: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: fixedAssetCounts.id })
    .from(fixedAssetCounts)
    .where(
      and(
        countsOf(institutionId),
        eq(fixedAssetCounts.scopeKey, scopeKey),
        eq(fixedAssetCounts.status, 'open'),
      ),
    )
    .limit(1)
  return row !== undefined
}

const COUNTABLE = {
  id: fixedAssets.id,
  tagNumber: fixedAssets.tagNumber,
  name: fixedAssets.name,
  campusId: fixedAssets.campusId,
  location: fixedAssets.location,
  status: fixedAssets.status,
}
const assetsOf = (institutionId: string) =>
  and(eq(fixedAssets.institutionId, institutionId), isNull(fixedAssets.archivedAt))

/**
 * Kapsam adayı demirbaşlar: hurdaya ayrılmamışlar; kampüs verilirse yalnız o kampüsünkiler. Oda
 * eşleşmesi core'da yapılır (harf ve boşluk farkı gözetmeden).
 */
export async function loadCountableAssets(
  tx: Database,
  institutionId: string,
  filter: { campusId?: string | null },
): Promise<CountableFixedAsset[]> {
  return tx
    .select(COUNTABLE)
    .from(fixedAssets)
    .where(
      and(
        assetsOf(institutionId),
        ne(fixedAssets.status, 'scrapped'),
        filter.campusId === undefined
          ? undefined
          : filter.campusId === null
            ? isNull(fixedAssets.campusId)
            : eq(fixedAssets.campusId, filter.campusId),
      ),
    )
}

/** Etiketi verilen kurum demirbaşı (hurdaya ayrılanlar dahil); yoksa `null`. */
export async function findAssetByTag(
  tx: Database,
  institutionId: string,
  tagNumber: string,
): Promise<CountableFixedAsset | null> {
  const [row] = await tx
    .select(COUNTABLE)
    .from(fixedAssets)
    .where(and(assetsOf(institutionId), eq(fixedAssets.tagNumber, tagNumber)))
    .limit(1)
  return row ?? null
}

export async function insertCount(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    scopeType: FixedAssetCountScopeType
    campusId: string | null
    location: string | null
    scopeKey: string
    note: string | null
    startedByUserId: string
    now: Date
    items: readonly CountableFixedAsset[]
    newId: () => string
  },
): Promise<void> {
  const { now, items, newId, ...fields } = input
  await tx.insert(fixedAssetCounts).values({
    ...fields,
    institutionId,
    status: 'open',
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  // Parametre sınırına takılmamak için parça parça yazılır (satır başına 9 değer).
  const CHUNK = 500
  for (let start = 0; start < items.length; start += CHUNK)
    await tx.insert(fixedAssetCountItems).values(
      items.slice(start, start + CHUNK).map((asset) => ({
        institutionId,
        id: newId(),
        countId: input.id,
        assetId: asset.id,
        inScope: true,
        tagNumber: asset.tagNumber,
        assetName: asset.name,
        recordedCampusId: asset.campusId,
        recordedLocation: asset.location,
        createdAt: now,
        updatedAt: now,
      })),
    )
}

export interface StoredCountItem {
  id: string
  countId: string
  assetId: string
  inScope: boolean
  tagNumber: string
  assetName: string
  recordedCampusId: string | null
  recordedLocation: string
  result: FixedAssetCountItemResult
  observedCampusId: string | null
  observedLocation: string | null
  scannedAt: string | null
  relocatedAt: string | null
  version: number
}

const ITEM_COLUMNS = {
  id: fixedAssetCountItems.id,
  countId: fixedAssetCountItems.countId,
  assetId: fixedAssetCountItems.assetId,
  inScope: fixedAssetCountItems.inScope,
  tagNumber: fixedAssetCountItems.tagNumber,
  assetName: fixedAssetCountItems.assetName,
  recordedCampusId: fixedAssetCountItems.recordedCampusId,
  recordedLocation: fixedAssetCountItems.recordedLocation,
  result: fixedAssetCountItems.result,
  observedCampusId: fixedAssetCountItems.observedCampusId,
  observedLocation: fixedAssetCountItems.observedLocation,
  scannedAt: fixedAssetCountItems.scannedAt,
  relocatedAt: fixedAssetCountItems.relocatedAt,
  version: fixedAssetCountItems.version,
}
type ItemRow = Omit<StoredCountItem, 'scannedAt' | 'relocatedAt'> & {
  scannedAt: Date | null
  relocatedAt: Date | null
}
const toItem = (row: ItemRow): StoredCountItem => ({
  ...row,
  scannedAt: iso(row.scannedAt),
  relocatedAt: iso(row.relocatedAt),
})

export async function findCountItem(
  db: Database,
  institutionId: string,
  countId: string,
  filter: { id: string } | { assetId: string },
): Promise<StoredCountItem | null> {
  const [row] = await db
    .select(ITEM_COLUMNS)
    .from(fixedAssetCountItems)
    .where(
      and(
        itemsOf(institutionId),
        eq(fixedAssetCountItems.countId, countId),
        'id' in filter
          ? eq(fixedAssetCountItems.id, filter.id)
          : eq(fixedAssetCountItems.assetId, filter.assetId),
      ),
    )
    .limit(1)
  return row === undefined ? null : toItem(row)
}

export interface CountItemQuery {
  page: number
  pageSize: number
  result?: FixedAssetCountItemResult | undefined
  inScope?: boolean | undefined
  q?: string | undefined
}

/** Sayım satırları, etiket sırasıyla; `q` etiket ve adda arar. */
export async function listCountItems(
  db: Database,
  institutionId: string,
  countId: string,
  query: CountItemQuery,
): Promise<{ items: StoredCountItem[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    itemsOf(institutionId),
    eq(fixedAssetCountItems.countId, countId),
    query.result === undefined ? undefined : eq(fixedAssetCountItems.result, query.result),
    query.inScope === undefined ? undefined : eq(fixedAssetCountItems.inScope, query.inScope),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(fixedAssetCountItems.tagNumber)}, ${search}) > 0`,
          sql`strpos(${foldSql(fixedAssetCountItems.assetName)}, ${search}) > 0`,
        ),
  )
  const [totalRow] = await db.select({ total: count() }).from(fixedAssetCountItems).where(where)
  const rows = await db
    .select(ITEM_COLUMNS)
    .from(fixedAssetCountItems)
    .where(where)
    .orderBy(asc(fixedAssetCountItems.tagNumber), asc(fixedAssetCountItems.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toItem), total: totalRow?.total ?? 0 }
}

/** Beklenen satırın ilk okutması; satır okunmuşsa `false`. */
export async function markItemScanned(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    result: 'found' | 'misplaced'
    observed: FixedAssetPlace
    scannedByUserId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(fixedAssetCountItems)
    .set({
      result: input.result,
      observedCampusId: input.observed.campusId,
      observedLocation: input.observed.location,
      scannedAt: input.now,
      scannedByUserId: input.scannedByUserId,
      updatedAt: input.now,
      version: sql`${fixedAssetCountItems.version} + 1`,
    })
    .where(
      and(
        itemsOf(institutionId),
        eq(fixedAssetCountItems.id, input.id),
        eq(fixedAssetCountItems.result, 'pending'),
      ),
    )
    .returning({ id: fixedAssetCountItems.id })
  return rows.length === 1
}

/** Beklenen listede olmayan kurum demirbaşının okutma satırı (K-233). */
export async function insertScannedItem(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    countId: string
    asset: CountableFixedAsset
    result: 'found' | 'misplaced'
    observed: FixedAssetPlace
    scannedByUserId: string
    now: Date
  },
): Promise<void> {
  const { asset, now } = input
  await tx.insert(fixedAssetCountItems).values({
    institutionId,
    id: input.id,
    countId: input.countId,
    assetId: asset.id,
    inScope: false,
    tagNumber: asset.tagNumber,
    assetName: asset.name,
    recordedCampusId: asset.campusId,
    recordedLocation: asset.location,
    result: input.result,
    observedCampusId: input.observed.campusId,
    observedLocation: input.observed.location,
    scannedAt: now,
    scannedByUserId: input.scannedByUserId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Tamamlama ya da iptal; sürüm tutmazsa ya da sayım açık değilse `false` (409). */
export async function closeCount(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    status: 'completed' | 'cancelled'
    userId: string
    now: Date
  },
): Promise<boolean> {
  const trail =
    input.status === 'completed'
      ? { completedAt: input.now, completedByUserId: input.userId }
      : { cancelledAt: input.now, cancelledByUserId: input.userId }
  const rows = await tx
    .update(fixedAssetCounts)
    .set({
      status: input.status,
      ...trail,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        countsOf(institutionId),
        eq(fixedAssetCounts.id, input.id),
        eq(fixedAssetCounts.version, input.expectedVersion),
        eq(fixedAssetCounts.status, 'open'),
      ),
    )
    .returning({ id: fixedAssetCounts.id })
  return rows.length === 1
}

/** Konum düzeltmesi izi (K-235); sürüm tutmazsa ya da düzeltildiyse `false` (409). */
export async function markItemRelocated(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(fixedAssetCountItems)
    .set({
      relocatedAt: input.now,
      relocatedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        itemsOf(institutionId),
        eq(fixedAssetCountItems.id, input.id),
        eq(fixedAssetCountItems.version, input.expectedVersion),
        isNull(fixedAssetCountItems.relocatedAt),
      ),
    )
    .returning({ id: fixedAssetCountItems.id })
  return rows.length === 1
}

export interface LastCount {
  countId: string
  completedAt: string
  result: FixedAssetCountItemResult
}

/**
 * Demirbaşların son tamamlanmış sayımı ve sonucu (ayrıntıda "son sayım"; K-235). Demirbaş kaydı
 * tamamlamada değişmez; bilgi sayım satırlarından okunur.
 */
export async function loadLastCounts(
  db: Database,
  institutionId: string,
  assetIds: readonly string[],
): Promise<Map<string, LastCount>> {
  if (assetIds.length === 0) return new Map()
  const rows = await db
    .selectDistinctOn([fixedAssetCountItems.assetId], {
      assetId: fixedAssetCountItems.assetId,
      countId: fixedAssetCounts.id,
      completedAt: fixedAssetCounts.completedAt,
      result: fixedAssetCountItems.result,
    })
    .from(fixedAssetCountItems)
    .innerJoin(
      fixedAssetCounts,
      and(
        eq(fixedAssetCounts.institutionId, fixedAssetCountItems.institutionId),
        eq(fixedAssetCounts.id, fixedAssetCountItems.countId),
      ),
    )
    .where(
      and(
        itemsOf(institutionId),
        countsOf(institutionId),
        inArray(fixedAssetCountItems.assetId, [...new Set(assetIds)]),
        eq(fixedAssetCounts.status, 'completed'),
      ),
    )
    .orderBy(fixedAssetCountItems.assetId, desc(fixedAssetCounts.completedAt))
  const found = new Map<string, LastCount>()
  for (const row of rows)
    if (row.completedAt !== null)
      found.set(row.assetId, {
        countId: row.countId,
        completedAt: row.completedAt.toISOString(),
        result: row.result,
      })
  return found
}

export interface StoredPlace {
  campusId: string | null
  location: string
  assetCount: number
}

/**
 * Hurdaya ayrılmamış demirbaşların bulunduğu yerler (kampüs + konum) ve demirbaş sayısı: sayım
 * kapsamı ve sayılan yer seçimi için öneri. Konum harf farkıyla ayrı yazılmışsa ayrı satırdır.
 */
export async function listCountPlaces(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; q?: string | undefined; campusId?: string | undefined },
): Promise<{ items: StoredPlace[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    assetsOf(institutionId),
    ne(fixedAssets.status, 'scrapped'),
    query.campusId === undefined ? undefined : eq(fixedAssets.campusId, query.campusId),
    search === undefined ? undefined : sql`strpos(${foldSql(fixedAssets.location)}, ${search}) > 0`,
  )
  const grouped = db
    .select({ campusId: fixedAssets.campusId, location: fixedAssets.location })
    .from(fixedAssets)
    .where(where)
    .groupBy(fixedAssets.campusId, fixedAssets.location)
    .as('places')
  const [totalRow] = await db.select({ total: count() }).from(grouped)
  const rows = await db
    .select({
      campusId: fixedAssets.campusId,
      location: fixedAssets.location,
      assetCount: sql<number>`count(*)::int`,
    })
    .from(fixedAssets)
    .where(where)
    .groupBy(fixedAssets.campusId, fixedAssets.location)
    .orderBy(
      asc(fixedAssets.campusId),
      asc(foldSql(fixedAssets.location)),
      asc(fixedAssets.location),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows, total: totalRow?.total ?? 0 }
}
