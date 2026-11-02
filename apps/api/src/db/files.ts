import { and, asc, eq, gt, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm'

import type { Database } from './client.ts'
import { files, type FileStatus } from './schema/files.ts'
import { institutionSettings } from './schema/institution-settings.ts'

/**
 * `files` deposu (ADR 0003 karar 4, 5, 13). İlk parametre her zaman `institutionId`'dir; yalnız
 * kurumlar arası teknik temizlik (`listStaleUnattachedFiles`) istisnadır. İçerik kolonları
 * değişmez (migration 0015 tetikleyicisi); depo yalnız durum, bağlama ve silme yazar.
 */

export type StoredFile = typeof files.$inferSelect
export type NewFile = Pick<
  typeof files.$inferInsert,
  | 'id'
  | 'purpose'
  | 'storageKey'
  | 'contentType'
  | 'byteSize'
  | 'sha256'
  | 'originalName'
  | 'uploadedByUserId'
>

/** Kotayı tüketen durumlar: nesnesi silinmiş (`rejected`, `deleted`) dosya sayılmaz. */
const QUOTA_EXCLUDED: FileStatus[] = ['rejected', 'deleted']

export async function insertFile(
  tx: Database,
  institutionId: string,
  file: NewFile,
  now: Date,
): Promise<StoredFile> {
  const [row] = await tx
    .insert(files)
    .values({ ...file, institutionId, status: 'pending', createdAt: now, updatedAt: now })
    .returning()
  if (!row) throw new Error('file insert returned no row')
  return row
}

export async function findFile(
  tx: Database,
  institutionId: string,
  fileId: string,
  options: { lock?: boolean } = {},
): Promise<StoredFile | null> {
  const query = tx
    .select()
    .from(files)
    .where(and(eq(files.institutionId, institutionId), eq(files.id, fileId)))
    .limit(1)
  const [row] = options.lock ? await query.for('update') : await query
  return row ?? null
}

/** Kurumun depoda tuttuğu toplam bayt (karar 3: `files` tablosundan toplanır). */
export async function usedStorageBytes(tx: Database, institutionId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${files.byteSize}), 0)` })
    .from(files)
    .where(and(eq(files.institutionId, institutionId), notInArray(files.status, QUOTA_EXCLUDED)))
  return Number(row?.total ?? 0)
}

/** Kurum ayarındaki kota; ayar satırı veya değer yoksa `null` (varsayılan çağıranda). */
export async function storageQuotaSetting(
  tx: Database,
  institutionId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ quota: institutionSettings.storageQuotaBytes })
    .from(institutionSettings)
    .where(eq(institutionSettings.institutionId, institutionId))
    .limit(1)
  return row?.quota ?? null
}

/** Satırı iyimser kilitle günceller; sürüm tutmazsa `null`. */
async function updateFile(
  tx: Database,
  institutionId: string,
  current: StoredFile,
  values: Partial<
    Pick<
      StoredFile,
      | 'status'
      | 'attachedType'
      | 'attachedId'
      | 'attachedAt'
      | 'dataSubjectId'
      | 'retentionUntil'
      | 'deletedAt'
      | 'originalName'
    >
  >,
  now: Date,
): Promise<StoredFile | null> {
  const [row] = await tx
    .update(files)
    .set({ ...values, updatedAt: now, version: current.version + 1 })
    .where(
      and(
        eq(files.institutionId, institutionId),
        eq(files.id, current.id),
        eq(files.version, current.version),
      ),
    )
    .returning()
  return row ?? null
}

export function attachFileRow(
  tx: Database,
  institutionId: string,
  current: StoredFile,
  attachment: { type: string; id: string; dataSubjectId: string | null },
  now: Date,
) {
  return updateFile(
    tx,
    institutionId,
    current,
    {
      attachedType: attachment.type,
      attachedId: attachment.id,
      attachedAt: now,
      dataSubjectId: attachment.dataSubjectId,
    },
    now,
  )
}

export function setFileStatus(
  tx: Database,
  institutionId: string,
  current: StoredFile,
  status: 'processing' | 'ready' | 'rejected',
  now: Date,
) {
  return updateFile(tx, institutionId, current, { status }, now)
}

/** İmha: nesne silindikten sonra satır `deleted` kalır, özgün ad (K) silinir (karar 13). */
export function markFileDeleted(
  tx: Database,
  institutionId: string,
  current: StoredFile,
  now: Date,
) {
  return updateFile(
    tx,
    institutionId,
    current,
    { status: 'deleted', deletedAt: now, originalName: null },
    now,
  )
}

/**
 * Rızaya dayalı dosyaların imha işareti (ADR 0003 karar 9, 13; DOM-YTK-059): veri sahibinin bu
 * amaçtaki silinmemiş dosyalarının saklama sonu `now`'a çekilir; daha erken saklama sonu korunur.
 * Nesneyi imha işi siler. İşaretlenen dosyaların kimliklerini döndürür.
 */
export async function scheduleSubjectFilesPurge(
  tx: Database,
  institutionId: string,
  subject: { purpose: StoredFile['purpose']; dataSubjectId: string },
  now: Date,
): Promise<string[]> {
  const rows = await tx
    .update(files)
    .set({ retentionUntil: now, updatedAt: now, version: sql`${files.version} + 1` })
    .where(
      and(
        eq(files.institutionId, institutionId),
        eq(files.purpose, subject.purpose),
        eq(files.dataSubjectId, subject.dataSubjectId),
        ne(files.status, 'deleted'),
        or(isNull(files.retentionUntil), gt(files.retentionUntil, now)),
      ),
    )
    .returning({ id: files.id })
  return rows.map((row) => row.id)
}

/**
 * Bağlanmamış ve `before`'dan önce yüklenmiş, silinmemiş dosyalar (karar 5: 24 saat). Kurumlar
 * arası teknik temizliktir; en eskiler önce, `limit` kadar.
 */
export async function listStaleUnattachedFiles(
  db: Database,
  before: Date,
  limit: number,
): Promise<StoredFile[]> {
  return db
    .select()
    .from(files)
    .where(and(isNull(files.attachedId), ne(files.status, 'deleted'), lt(files.createdAt, before)))
    .orderBy(asc(files.createdAt), asc(files.id))
    .limit(limit)
}
