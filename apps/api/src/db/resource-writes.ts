import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import {
  normalizeSearchText,
  type ResourceContent,
  type ResourceRecord,
  type ResourceTags,
  type ResourceVersion,
  type ResourceVersionMeta,
} from '@kampus/school-core/content/resource.ts'

import { AppError, ConflictError, databaseErrorInfo } from '../errors.ts'
import type { Database } from './client.ts'
import {
  insertResourceRows,
  insertResourceVersion,
  versionContentValues,
  versionMetaValues,
  type StoredResourceVersion,
} from './resources.ts'
import {
  resources,
  resourceShares,
  resourceVersionFiles,
  resourceVersionItems,
  resourceVersionOutcomes,
  resourceVersions,
} from './schema/resources.ts'

/**
 * İçerik havuzu yazma deposu (ADR 0004 karar 3). Fonksiyonlar çağıranın transaction'ında çalışır
 * (`services/resource-commands.ts`, kurum kilidi alınmış); ilk parametre `institutionId`'dir.
 *
 * - Satır sürümü (`version`) her yazmada bir artar. İyimser kilit beklenen sürümle yazılır:
 *   0 satır → 409 `version_conflict` (kurum kilidi zaten sıralar; koşul ikinci güvencedir).
 * - Bağlantı tabloları (kazanım, soru, dosya, paylaşım) silinmez: önce etkin satırlar arşivlenir, sonra
 *   yeni küme `on conflict` ile geri açılır (veritabani.md §7).
 */

const bump = (column: typeof resources.version | typeof resourceVersions.version) =>
  sql`${column} + 1`

/** Yeni kaynak ve ilk sürümü (oluşturma ve kopya). */
export function insertNewResource(
  tx: Database,
  institutionId: string,
  record: ResourceRecord,
  version: ResourceVersion,
  now: Date,
): Promise<void> {
  return insertResourceRows(tx, institutionId, record, [version], now)
}

/** Yeni sürüm; kaynakta açık sürüm varsa (eşzamanlı istek) 409 `open_version_exists`. */
export async function insertNewVersion(
  tx: Database,
  institutionId: string,
  version: ResourceVersion,
  now: Date,
): Promise<void> {
  try {
    await insertResourceVersion(tx, institutionId, version, now)
  } catch (error) {
    const info = databaseErrorInfo(error)
    if (info?.code === '23505' && info.constraint === 'resource_versions_editable_key')
      throw new AppError(
        409,
        'open_version_exists',
        'Bu içeriğin üzerinde çalışılan bir sürümü zaten var.',
        { cause: error },
      )
    throw error
  }
}

/** Taslağın içerik ve etiket kolonları, durumu, kazanım, dosya ve soru bağlantıları. */
export async function updateDraft(
  tx: Database,
  institutionId: string,
  version: ResourceVersion,
  expectedVersion: number,
  now: Date,
): Promise<void> {
  const updated = await tx
    .update(resourceVersions)
    .set({
      ...versionContentValues(version),
      status: version.status,
      updatedAt: now,
      version: bump(resourceVersions.version),
    })
    .where(
      and(
        eq(resourceVersions.institutionId, institutionId),
        eq(resourceVersions.id, version.id),
        eq(resourceVersions.version, expectedVersion),
      ),
    )
    .returning({ id: resourceVersions.id })
  if (updated.length === 0) throw new ConflictError()
  await syncOutcomes(tx, institutionId, version.id, version.tags.outcomes, now)
  await syncFiles(tx, institutionId, version.id, version.fileIds, now)
  await syncItems(tx, institutionId, version.id, version.content, now)
}

/** Sürümün durum kolonları (geçişler); içerik kolonlarına dokunmaz (DOM-KYN-032). */
export async function updateVersionMeta(
  tx: Database,
  institutionId: string,
  versionId: string,
  expectedVersion: number,
  meta: Partial<ResourceVersionMeta>,
  now: Date,
): Promise<void> {
  const updated = await tx
    .update(resourceVersions)
    .set({ ...versionMetaValues(meta), updatedAt: now, version: bump(resourceVersions.version) })
    .where(
      and(
        eq(resourceVersions.institutionId, institutionId),
        eq(resourceVersions.id, versionId),
        eq(resourceVersions.version, expectedVersion),
      ),
    )
    .returning({ id: resourceVersions.id })
  if (updated.length === 0) throw new ConflictError()
}

export interface ResourceRowChanges {
  currentVersionId?: string | null
  shareScope?: ResourceRecord['shareScope']
  /** Kaynak arşivi (R8 madde 7): bütün sürümleri arşivli veya kaynak kaldırıldı. */
  archivedAt?: Date | null
}

/** Kaynak satırı; `expectedVersion` verilirse iyimser kilitle. */
export async function updateResourceRow(
  tx: Database,
  institutionId: string,
  resourceId: string,
  expectedVersion: number | null,
  changes: ResourceRowChanges,
  now: Date,
): Promise<void> {
  const updated = await tx
    .update(resources)
    .set({ ...changes, updatedAt: now, version: bump(resources.version) })
    .where(
      and(
        eq(resources.institutionId, institutionId),
        eq(resources.id, resourceId),
        expectedVersion === null ? undefined : eq(resources.version, expectedVersion),
      ),
    )
    .returning({ id: resources.id })
  if (updated.length === 0) throw new ConflictError()
}

/**
 * Kaynağın bütün sürümlerini kaldırır (DOM-KYN-051): içerik ve cevap anahtarı silinir, arama
 * yalnız başlıkta kalır, quiz soru bağlantıları arşivlenir. Kaynak satırı arşivlenir.
 */
export async function removeResourceRows(
  tx: Database,
  institutionId: string,
  resourceId: string,
  versions: readonly StoredResourceVersion[],
  meta: Pick<ResourceVersionMeta, 'status' | 'removedAt' | 'removalReason'>,
  now: Date,
): Promise<void> {
  const ids = versions.map((version) => version.id)
  if (ids.length > 0) {
    for (const version of versions) {
      await tx
        .update(resourceVersions)
        .set({
          ...versionMetaValues(meta),
          content: null,
          answerKey: null,
          searchVector: sql`to_tsvector('simple', ${normalizeSearchText(version.title)})`,
          updatedAt: now,
          version: bump(resourceVersions.version),
        })
        .where(
          and(
            eq(resourceVersions.institutionId, institutionId),
            eq(resourceVersions.id, version.id),
          ),
        )
    }
    await tx
      .update(resourceVersionItems)
      .set({ archivedAt: now, updatedAt: now, version: sql`${resourceVersionItems.version} + 1` })
      .where(
        and(
          eq(resourceVersionItems.institutionId, institutionId),
          inArray(resourceVersionItems.versionId, ids),
          isNull(resourceVersionItems.archivedAt),
        ),
      )
  }
  await updateResourceRow(tx, institutionId, resourceId, null, { archivedAt: now }, now)
}

/** Paylaşım hedeflerini yeni kümeyle değiştirir; çıkan hedef arşivlenir, geri gelen açılır. */
export async function replaceShares(
  tx: Database,
  institutionId: string,
  resourceId: string,
  targets: Pick<ResourceRecord, 'sharedStudentIds' | 'sharedClassIds'>,
  now: Date,
): Promise<void> {
  await tx
    .update(resourceShares)
    .set({ archivedAt: now, updatedAt: now, version: sql`${resourceShares.version} + 1` })
    .where(
      and(
        eq(resourceShares.institutionId, institutionId),
        eq(resourceShares.resourceId, resourceId),
        isNull(resourceShares.archivedAt),
      ),
    )
  const rows = [
    ...targets.sharedStudentIds.map((targetId) => ({ targetKind: 'student' as const, targetId })),
    ...targets.sharedClassIds.map((targetId) => ({ targetKind: 'class' as const, targetId })),
  ].map((share) => ({ institutionId, resourceId, ...share, createdAt: now, updatedAt: now }))
  if (rows.length === 0) return
  await tx
    .insert(resourceShares)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        resourceShares.institutionId,
        resourceShares.resourceId,
        resourceShares.targetKind,
        resourceShares.targetId,
      ],
      set: { archivedAt: null, updatedAt: now, version: sql`${resourceShares.version} + 1` },
    })
}

async function syncOutcomes(
  tx: Database,
  institutionId: string,
  versionId: string,
  outcomes: ResourceTags['outcomes'],
  now: Date,
): Promise<void> {
  await tx
    .update(resourceVersionOutcomes)
    .set({ archivedAt: now, updatedAt: now, version: sql`${resourceVersionOutcomes.version} + 1` })
    .where(
      and(
        eq(resourceVersionOutcomes.institutionId, institutionId),
        eq(resourceVersionOutcomes.versionId, versionId),
        isNull(resourceVersionOutcomes.archivedAt),
      ),
    )
  if (outcomes.length === 0) return
  await tx
    .insert(resourceVersionOutcomes)
    .values(
      outcomes.map((outcome, position) => ({
        institutionId,
        versionId,
        outcomeSource: outcome.outcomeSource,
        outcomeId: outcome.outcomeId,
        position,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [
        resourceVersionOutcomes.institutionId,
        resourceVersionOutcomes.versionId,
        resourceVersionOutcomes.outcomeSource,
        resourceVersionOutcomes.outcomeId,
      ],
      set: {
        position: sql`excluded.position`,
        archivedAt: null,
        updatedAt: now,
        version: sql`${resourceVersionOutcomes.version} + 1`,
      },
    })
}

async function syncFiles(
  tx: Database,
  institutionId: string,
  versionId: string,
  fileIds: readonly string[],
  now: Date,
): Promise<void> {
  await tx
    .update(resourceVersionFiles)
    .set({ archivedAt: now, updatedAt: now, version: sql`${resourceVersionFiles.version} + 1` })
    .where(
      and(
        eq(resourceVersionFiles.institutionId, institutionId),
        eq(resourceVersionFiles.versionId, versionId),
        isNull(resourceVersionFiles.archivedAt),
      ),
    )
  if (fileIds.length === 0) return
  await tx
    .insert(resourceVersionFiles)
    .values(
      fileIds.map((fileId, position) => ({
        institutionId,
        versionId,
        fileId,
        position,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [
        resourceVersionFiles.institutionId,
        resourceVersionFiles.versionId,
        resourceVersionFiles.fileId,
      ],
      set: {
        position: sql`excluded.position`,
        archivedAt: null,
        updatedAt: now,
        version: sql`${resourceVersionFiles.version} + 1`,
      },
    })
}

async function syncItems(
  tx: Database,
  institutionId: string,
  versionId: string,
  content: ResourceContent,
  now: Date,
): Promise<void> {
  await tx
    .update(resourceVersionItems)
    .set({ archivedAt: now, updatedAt: now, version: sql`${resourceVersionItems.version} + 1` })
    .where(
      and(
        eq(resourceVersionItems.institutionId, institutionId),
        eq(resourceVersionItems.versionId, versionId),
        isNull(resourceVersionItems.archivedAt),
      ),
    )
  if (content.type !== 'quiz' && content.type !== 'exercise_set') return
  if (content.items.length === 0) return
  await tx
    .insert(resourceVersionItems)
    .values(
      content.items.map((item, position) => ({
        institutionId,
        versionId,
        position,
        itemVersionId: item.questionVersionId,
        points: item.points,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [
        resourceVersionItems.institutionId,
        resourceVersionItems.versionId,
        resourceVersionItems.position,
      ],
      set: {
        itemVersionId: sql`excluded.item_version_id`,
        points: sql`excluded.points`,
        archivedAt: null,
        updatedAt: now,
        version: sql`${resourceVersionItems.version} + 1`,
      },
    })
}
