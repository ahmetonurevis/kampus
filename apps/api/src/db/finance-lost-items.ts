import { and, asc, count, desc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm'

import {
  DEFAULT_LOST_ITEM_SETTINGS,
  LOST_ITEM_PHOTO_PURPOSE,
  type LostItemCategory,
  type LostItemDisposalOutcome,
  type LostItemRecipientType,
  type LostItemSettings,
  type LostItemStatus,
  type LostReportStatus,
} from '@kampus/school-core/lib/finance-lost-items.ts'

import type { Database } from './client.ts'
import { files } from './schema/files.ts'
import { lostItemReports, lostItems, lostItemSettings } from './schema/finance-lost-items.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Kayıp eşya deposu (DOM-FIN-145; ON-171). Kurum kapsamlıdır: ilk parametre `institutionId`. Kural
 * core `lib/finance-lost-items.ts`'tedir; depo yalnız okur ve yazar. Satır silinmez. Fotoğraflar
 * platformun `files` satırlarıdır; burada yalnız okunur (bağ ve imha dosya servisindedir).
 */

/** Fotoğrafların bağ türü (`files.attached_type`). */
export const LOST_ITEM_ATTACHMENT = 'lost_item'

export interface StoredLostItem {
  id: string
  description: string
  category: LostItemCategory
  foundLocation: string
  foundOn: string
  finderMembershipId: string | null
  storageLocation: string
  status: LostItemStatus
  recipientType: LostItemRecipientType | null
  recipientStudentId: string | null
  recipientGuardianLinkId: string | null
  recipientName: string | null
  handedOverAt: string | null
  handedOverByMembershipId: string | null
  disposedAt: string | null
  disposalReason: string | null
  disposedByMembershipId: string | null
  createdByUserId: string
  createdAt: string
  updatedAt: string
  version: number
}

const ITEM_COLUMNS = {
  id: lostItems.id,
  description: lostItems.description,
  category: lostItems.category,
  foundLocation: lostItems.foundLocation,
  foundOn: lostItems.foundOn,
  finderMembershipId: lostItems.finderMembershipId,
  storageLocation: lostItems.storageLocation,
  status: lostItems.status,
  recipientType: lostItems.recipientType,
  recipientStudentId: lostItems.recipientStudentId,
  recipientGuardianLinkId: lostItems.recipientGuardianLinkId,
  recipientName: lostItems.recipientName,
  handedOverAt: lostItems.handedOverAt,
  handedOverByMembershipId: lostItems.handedOverByMembershipId,
  disposedAt: lostItems.disposedAt,
  disposalReason: lostItems.disposalReason,
  disposedByMembershipId: lostItems.disposedByMembershipId,
  createdByUserId: lostItems.createdByUserId,
  createdAt: lostItems.createdAt,
  updatedAt: lostItems.updatedAt,
  version: lostItems.version,
}
type ItemRow = Omit<StoredLostItem, 'handedOverAt' | 'disposedAt' | 'createdAt' | 'updatedAt'> & {
  handedOverAt: Date | null
  disposedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toItem = (row: ItemRow): StoredLostItem => ({
  ...row,
  handedOverAt: row.handedOverAt?.toISOString() ?? null,
  disposedAt: row.disposedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})
const itemOf = (institutionId: string) => eq(lostItems.institutionId, institutionId)

export async function findLostItem(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredLostItem | null> {
  const [row] = await db
    .select(ITEM_COLUMNS)
    .from(lostItems)
    .where(and(itemOf(institutionId), eq(lostItems.id, id)))
    .limit(1)
  return row === undefined ? null : toItem(row)
}

export async function loadLostItemsByIds(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<StoredLostItem[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select(ITEM_COLUMNS)
    .from(lostItems)
    .where(and(itemOf(institutionId), inArray(lostItems.id, [...new Set(ids)])))
  return rows.map(toItem)
}

export interface LostItemQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: LostItemStatus | undefined
  category?: LostItemCategory | undefined
}

/** Eşyalar: bekleyenler önce, sonra en yeni bulunan önce. Arama tanımda ve yerlerde. */
export async function listLostItems(
  db: Database,
  institutionId: string,
  query: LostItemQuery,
): Promise<{ items: StoredLostItem[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    itemOf(institutionId),
    query.status === undefined ? undefined : eq(lostItems.status, query.status),
    query.category === undefined ? undefined : eq(lostItems.category, query.category),
    search === undefined
      ? undefined
      : sql`(strpos(${foldSql(lostItems.description)}, ${search}) > 0 or strpos(${foldSql(lostItems.foundLocation)}, ${search}) > 0 or strpos(${foldSql(lostItems.storageLocation)}, ${search}) > 0)`,
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(lostItems).where(where)
  const rows = await db
    .select(ITEM_COLUMNS)
    .from(lostItems)
    .where(where)
    .orderBy(
      sql`case when ${lostItems.status} = 'pending' then 0 else 1 end`,
      desc(lostItems.foundOn),
      desc(lostItems.createdAt),
      asc(lostItems.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toItem), total: totalRow?.total ?? 0 }
}

/**
 * Saklama süresi dolan eşyalar (K-492): bekleyen ve bulunma günü + süre bugün ya da önce; en eski
 * önce (sayfalı). Eşlenmiş eşya da listelenir; toplu işlemde reddedilir.
 */
export async function listRetentionDueItems(
  db: Database,
  institutionId: string,
  query: { retentionDays: number; today: string; page: number; pageSize: number },
): Promise<{ items: StoredLostItem[]; total: number }> {
  const where = and(
    itemOf(institutionId),
    eq(lostItems.status, 'pending'),
    sql`${lostItems.foundOn} + ${query.retentionDays}::int <= ${query.today}::date`,
  )
  const [totalRow] = await db.select({ total: count() }).from(lostItems).where(where)
  const rows = await db
    .select(ITEM_COLUMNS)
    .from(lostItems)
    .where(where)
    .orderBy(asc(lostItems.foundOn), asc(lostItems.createdAt), asc(lostItems.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toItem), total: totalRow?.total ?? 0 }
}

/** Aile galerisi (K-491): bekleyen eşyalar, en yeni bulunan önce. */
export async function listPendingItems(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; category?: LostItemCategory | undefined },
): Promise<{ items: StoredLostItem[]; total: number }> {
  return listLostItems(db, institutionId, { ...query, status: 'pending' })
}

export async function lostItemCounts(
  db: Database,
  institutionId: string,
  query: { today: string; retentionDays: number },
): Promise<{ pending: number; due: number }> {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${lostItems.status} = 'pending')::int`,
      due: sql<number>`count(*) filter (where ${lostItems.status} = 'pending' and ${lostItems.foundOn} + ${query.retentionDays}::int <= ${query.today}::date)::int`,
    })
    .from(lostItems)
    .where(itemOf(institutionId))
  return { pending: row?.pending ?? 0, due: row?.due ?? 0 }
}

export async function insertLostItem(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    description: string
    category: LostItemCategory
    foundLocation: string
    foundOn: string
    finderMembershipId: string | null
    storageLocation: string
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(lostItems).values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Düzeltme, teslim ya da bağış/imha yazması; yalnız bekleyen satır yazılır, tutmazsa `false`. */
export async function updateLostItem(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<{
      description: string
      category: LostItemCategory
      foundLocation: string
      foundOn: string
      finderMembershipId: string | null
      storageLocation: string
      status: LostItemStatus
      recipientType: LostItemRecipientType
      recipientStudentId: string | null
      recipientGuardianLinkId: string | null
      recipientName: string
      handedOverAt: Date
      handedOverByMembershipId: string
      disposedAt: Date
      disposalReason: string
      disposedByMembershipId: string
    }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(lostItems)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        itemOf(institutionId),
        eq(lostItems.id, input.id),
        eq(lostItems.status, 'pending'),
        eq(lostItems.version, input.expectedVersion),
      ),
    )
    .returning({ id: lostItems.id })
  return rows.length === 1
}

/** Yalnız sürümü artırır (fotoğraf eklenip çıkarılınca eşyanın `If-Match` sürümü değişir). */
export function touchLostItem(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
) {
  return updateLostItem(tx, institutionId, { ...input, values: {} })
}

/** Bağış/imha sonucu (K-492). */
export function disposeLostItem(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    outcome: LostItemDisposalOutcome
    reason: string
    membershipId: string
    now: Date
  },
) {
  return updateLostItem(tx, institutionId, {
    id: input.id,
    expectedVersion: input.expectedVersion,
    now: input.now,
    values: {
      status: input.outcome,
      disposedAt: input.now,
      disposalReason: input.reason,
      disposedByMembershipId: input.membershipId,
    },
  })
}

// --- Fotoğraflar ---------------------------------------------------------------------------------

export interface LostItemPhotoRow {
  fileId: string
  itemId: string
  contentType: string
  byteSize: number
}

/** Eşyalara bağlı görünür fotoğraflar (silinmiş ve reddedilmiş hariç), eşya → kimlik sırasıyla. */
export async function listItemPhotos(
  db: Database,
  institutionId: string,
  itemIds: readonly string[],
): Promise<Map<string, LostItemPhotoRow[]>> {
  const byItem = new Map<string, LostItemPhotoRow[]>()
  if (itemIds.length === 0) return byItem
  const rows = await db
    .select({
      fileId: files.id,
      itemId: files.attachedId,
      contentType: files.contentType,
      byteSize: files.byteSize,
    })
    .from(files)
    .where(
      and(
        eq(files.institutionId, institutionId),
        eq(files.attachedType, LOST_ITEM_ATTACHMENT),
        inArray(files.attachedId, [...new Set(itemIds)]),
        eq(files.purpose, LOST_ITEM_PHOTO_PURPOSE),
        notInArray(files.status, ['deleted', 'rejected']),
      ),
    )
    .orderBy(asc(files.createdAt), asc(files.id))
  for (const row of rows) {
    if (row.itemId === null) continue
    const list = byItem.get(row.itemId) ?? []
    list.push({ ...row, itemId: row.itemId })
    byItem.set(row.itemId, list)
  }
  return byItem
}

// --- Kayıp bildirimi -----------------------------------------------------------------------------

export interface StoredLostReport {
  id: string
  studentId: string
  description: string
  category: LostItemCategory | null
  lostOn: string
  status: LostReportStatus
  matchedItemId: string | null
  matchedAt: string | null
  returnedAt: string | null
  closedAt: string | null
  closedByUserId: string | null
  reportedByUserId: string
  reporterRole: string
  createdAt: string
  version: number
}

const REPORT_COLUMNS = {
  id: lostItemReports.id,
  studentId: lostItemReports.studentId,
  description: lostItemReports.description,
  category: lostItemReports.category,
  lostOn: lostItemReports.lostOn,
  status: lostItemReports.status,
  matchedItemId: lostItemReports.matchedItemId,
  matchedAt: lostItemReports.matchedAt,
  returnedAt: lostItemReports.returnedAt,
  closedAt: lostItemReports.closedAt,
  closedByUserId: lostItemReports.closedByUserId,
  reportedByUserId: lostItemReports.reportedByUserId,
  reporterRole: lostItemReports.reporterRole,
  createdAt: lostItemReports.createdAt,
  version: lostItemReports.version,
}
type ReportRow = Omit<StoredLostReport, 'matchedAt' | 'returnedAt' | 'closedAt' | 'createdAt'> & {
  matchedAt: Date | null
  returnedAt: Date | null
  closedAt: Date | null
  createdAt: Date
}
const toReport = (row: ReportRow): StoredLostReport => ({
  ...row,
  matchedAt: row.matchedAt?.toISOString() ?? null,
  returnedAt: row.returnedAt?.toISOString() ?? null,
  closedAt: row.closedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})
const reportOf = (institutionId: string) => eq(lostItemReports.institutionId, institutionId)

export async function findLostReport(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredLostReport | null> {
  const [row] = await db
    .select(REPORT_COLUMNS)
    .from(lostItemReports)
    .where(and(reportOf(institutionId), eq(lostItemReports.id, id)))
    .limit(1)
  return row === undefined ? null : toReport(row)
}

export interface LostReportQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: LostReportStatus | undefined
  /** Aile kapsamı: yalnız bu öğrencilerin bildirimleri; `undefined` kurum geneli. */
  studentIds?: readonly string[] | undefined
}

/** Bildirimler: açıklar önce, sonra en yeni kaybolan önce. Arama tanımda. */
export async function listLostReports(
  db: Database,
  institutionId: string,
  query: LostReportQuery,
): Promise<{ items: StoredLostReport[]; total: number }> {
  if (query.studentIds !== undefined && query.studentIds.length === 0)
    return { items: [], total: 0 }
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    reportOf(institutionId),
    query.status === undefined ? undefined : eq(lostItemReports.status, query.status),
    query.studentIds === undefined
      ? undefined
      : inArray(lostItemReports.studentId, [...query.studentIds]),
    search === undefined
      ? undefined
      : sql`strpos(${foldSql(lostItemReports.description)}, ${search}) > 0`,
  )
  const [totalRow] = await db.select({ total: count() }).from(lostItemReports).where(where)
  const rows = await db
    .select(REPORT_COLUMNS)
    .from(lostItemReports)
    .where(where)
    .orderBy(
      sql`case ${lostItemReports.status} when 'open' then 0 when 'matched' then 1 else 2 end`,
      desc(lostItemReports.lostOn),
      desc(lostItemReports.createdAt),
      asc(lostItemReports.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toReport), total: totalRow?.total ?? 0 }
}

/** Eşyalarla eşlenmiş (teslim bekleyen) bildirimler: eşya → bildirim. */
export async function matchedReportsOf(
  db: Database,
  institutionId: string,
  itemIds: readonly string[],
): Promise<Map<string, StoredLostReport>> {
  if (itemIds.length === 0) return new Map()
  const rows = await db
    .select(REPORT_COLUMNS)
    .from(lostItemReports)
    .where(
      and(
        reportOf(institutionId),
        eq(lostItemReports.status, 'matched'),
        inArray(lostItemReports.matchedItemId, [...new Set(itemIds)]),
      ),
    )
  return new Map(
    rows.flatMap((row) => (row.matchedItemId === null ? [] : [[row.matchedItemId, toReport(row)]])),
  )
}

export async function lostReportCounts(
  db: Database,
  institutionId: string,
): Promise<{ open: number; matched: number }> {
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${lostItemReports.status} = 'open')::int`,
      matched: sql<number>`count(*) filter (where ${lostItemReports.status} = 'matched')::int`,
    })
    .from(lostItemReports)
    .where(reportOf(institutionId))
  return { open: row?.open ?? 0, matched: row?.matched ?? 0 }
}

export async function insertLostReport(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    studentId: string
    description: string
    category: LostItemCategory | null
    lostOn: string
    reportedByUserId: string
    reporterRole: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(lostItemReports)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Eşleme, eşleme kaldırma, teslim ya da kapatma yazması; sürüm tutmazsa `false` (409). */
export async function updateLostReport(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<{
      status: LostReportStatus
      matchedItemId: string | null
      matchedAt: Date | null
      returnedAt: Date
      closedAt: Date
      closedByUserId: string
    }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(lostItemReports)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        reportOf(institutionId),
        eq(lostItemReports.id, input.id),
        eq(lostItemReports.version, input.expectedVersion),
      ),
    )
    .returning({ id: lostItemReports.id })
  return rows.length === 1
}

// --- Ayar ----------------------------------------------------------------------------------------

export interface StoredLostItemSettings extends LostItemSettings {
  /** `If-Match` sürümü; ayar hiç kaydedilmediyse 1. */
  version: number
}

export async function loadLostItemSettings(
  db: Database,
  institutionId: string,
): Promise<StoredLostItemSettings> {
  const [row] = await db
    .select({
      retentionDays: lostItemSettings.retentionDays,
      familyGalleryEnabled: lostItemSettings.familyGalleryEnabled,
      version: lostItemSettings.version,
    })
    .from(lostItemSettings)
    .where(eq(lostItemSettings.institutionId, institutionId))
    .limit(1)
  return row ?? { ...DEFAULT_LOST_ITEM_SETTINGS, version: 1 }
}

/** Ayarı sürüm koşuluyla yazar; tutmazsa `null` (409). İlk kayıt satırı sürüm 2 ile açar. */
export async function saveLostItemSettings(
  tx: Database,
  institutionId: string,
  input: LostItemSettings & { expectedVersion: number; now: Date },
): Promise<number | null> {
  const values = {
    retentionDays: input.retentionDays,
    familyGalleryEnabled: input.familyGalleryEnabled,
    updatedAt: input.now,
  }
  const [updated] = await tx
    .update(lostItemSettings)
    .set({ ...values, version: sql`${lostItemSettings.version} + 1` })
    .where(
      and(
        eq(lostItemSettings.institutionId, institutionId),
        eq(lostItemSettings.version, input.expectedVersion),
      ),
    )
    .returning({ version: lostItemSettings.version })
  if (updated !== undefined) return updated.version
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(lostItemSettings)
    .values({ ...values, institutionId, version: 2, createdAt: input.now })
    .onConflictDoNothing()
    .returning({ version: lostItemSettings.version })
  return created?.version ?? null
}
