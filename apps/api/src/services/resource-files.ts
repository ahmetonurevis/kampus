import { contentFileRefs, type ResourceContent } from '@kampus/school-core/content/resource.ts'
import {
  planVersionFiles,
  type ResourceFileRow,
  type VersionFilesPlan,
} from '@kampus/school-core/content/resource-files.ts'
import { canReadVersion } from '@kampus/school-core/content/visibility.ts'

import type { Database } from '../db/client.ts'
import { loadFilesByIds } from '../db/files.ts'
import {
  asCoreVersion,
  listContainerVersions,
  listFileVersionIds,
  loadVersionPairs,
} from '../db/resources.ts'
import { loadVersionAssignments } from '../db/skills.ts'
import { ForbiddenError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, detachFile } from './files.ts'
import { RESOURCE_VERSION_ATTACHMENT } from './listening-plays.ts'
import { contentReader } from './resources.ts'
import { viewerOf, visible, type Viewer } from './task-assignments.ts'
import { shownToLearners } from './task-progress.ts'

/**
 * Kaynak sürümünün dosyaları (DOM-KYN-006; ADR 0003 karar 5, 6). Kural core
 * `content/resource-files.ts`'tedir (`planVersionFiles`, saf); burada satırların yüklenmesi,
 * bağlama ve okuma kuralı vardır. Dosya satırının `attached_id`'si dosyanın ilk bağlandığı
 * sürümdür; sonraki sürüm ve kopya yalnız `resource_version_files` bağı açar.
 */

/**
 * Yazma işleminin dosya denetimi: `load`'da satırlar okunur, `run`'da core planı çalışır. İstenen
 * liste ve içeriklerin dosya alanları birlikte yüklenir.
 */
export async function loadVersionFileRows(
  tx: Database,
  institutionId: string,
  contents: readonly (ResourceContent | null)[],
  fileIds: readonly string[],
): Promise<ResourceFileRow[]> {
  const ids = [
    ...fileIds,
    ...contents.flatMap((content) =>
      content === null ? [] : contentFileRefs(content).map((ref) => ref.fileId),
    ),
  ]
  const rows = await loadFilesByIds(tx, institutionId, ids)
  return rows.map((row) => ({
    id: row.id,
    purpose: row.purpose,
    status: row.status,
    uploadedByUserId: row.uploadedByUserId,
    attached: row.attachedId !== null,
    contentType: row.contentType,
    byteSize: row.byteSize,
    durationSeconds: row.durationMs === null ? null : row.durationMs / 1000,
  }))
}

export function planFiles(
  ctx: ServiceContext,
  input: {
    content: ResourceContent
    fileIds: readonly string[]
    files: readonly ResourceFileRow[]
    kept: readonly string[]
  },
): VersionFilesPlan {
  return planVersionFiles({ actorUserId: ctx.actor.userId, ...input })
}

/**
 * Yeni dosyaları sürüme bağlar (sürüm ve bağ satırları yazıldıktan sonra, aynı transaction'da).
 * `attachFile` dosyayı kilitleyip koşulları yeniden denetler: arada bağlanmış dosya 409.
 */
export async function attachVersionFiles(
  tx: Database,
  ctx: ServiceContext,
  versionId: string,
  fileIds: readonly string[],
): Promise<void> {
  for (const fileId of fileIds)
    await attachFile(tx, ctx, {
      fileId,
      attachedType: RESOURCE_VERSION_ATTACHMENT,
      attachedId: versionId,
      dataSubjectId: null,
    })
}

/**
 * Taslaktan çıkarılan dosyanın bağı kalkar (bağsız dosya temizliği siler); yalnız ilk bağı bu
 * sürüm olan ve başka etkin bağı kalmayan dosyada. Önceki sürümden gelen dosya o sürümde kalır.
 */
export async function detachDroppedFiles(
  tx: Database,
  ctx: ServiceContext,
  versionId: string,
  dropped: readonly string[],
): Promise<void> {
  for (const fileId of dropped) {
    const links = await listFileVersionIds(tx, ctx.institutionId, fileId)
    if (links.length > 0) continue
    await detachFile(tx, ctx, {
      fileId,
      attachedType: RESOURCE_VERSION_ATTACHMENT,
      attachedId: versionId,
    })
  }
}

type VersionPair =
  Awaited<ReturnType<typeof loadVersionPairs>> extends Map<string, infer P> ? P : never

/** Kişi dosyaya bağ açan sürümlerden birini içerik havuzu kuralıyla okuyabiliyor mu. */
async function readsLinkedVersion(
  ctx: ServiceContext,
  linked: readonly VersionPair[],
): Promise<boolean> {
  let reader
  try {
    reader = await contentReader(ctx)
  } catch (error) {
    if (error instanceof ForbiddenError) return false
    throw error
  }
  return linked.some(({ resource, version }) =>
    canReadVersion(reader.viewer, {
      institutionType: reader.institutionType,
      resource,
      version: asCoreVersion(version),
      now: ctx.now,
    }),
  )
}

/**
 * Kişinin, dosyaya bağ açan sürümü sabitleyen görülebilir bir ataması var mı (DOM-YTK-028): öğrenci
 * kendisine, veli çocuklarına (kardeşler dahil) hedeflenen; öğretmen atadığı ya da kapsamındaki
 * sınıfa hedeflenen; yönetici kurumdaki atamayı görür (`visible`). Soru görseli, soruyu içeren quiz
 * veya alıştırma setinin atamasıyla da açılır. Kursiyerde atamanın sürümü kursiyere gösterilebilir
 * olmalı (`shownToLearners`: yayın geçmişi var, telif incelemesinde veya kaldırılmış değil); quiz
 * yolunda sorunun kaynağı da.
 */
async function assignedLinkedVersion(
  ctx: ServiceContext,
  linked: readonly VersionPair[],
): Promise<boolean> {
  let viewer: Viewer
  try {
    viewer = await viewerOf(ctx)
  } catch (error) {
    if (error instanceof ForbiddenError) return false
    throw error
  }
  const linkedIds = new Set(linked.map(({ version }) => version.id))
  const containers = await listContainerVersions(ctx.db, ctx.institutionId, [...linkedIds])
  // Sabitlenen sürüm → kursiyere gösterilmesi de gereken soru sürümleri.
  const pinned = new Map<string, VersionPair[]>(linked.map((pair) => [pair.version.id, []]))
  for (const { id, content } of containers)
    if (content.type === 'quiz' || content.type === 'exercise_set')
      pinned.set(
        id,
        linked.filter(({ version }) =>
          content.items.some((item) => item.questionVersionId === version.id),
        ),
      )
  for (const [versionId, items] of pinned) {
    const assignments = await loadVersionAssignments(ctx.db, ctx.institutionId, versionId)
    if (!assignments.some((assignment) => visible(viewer, assignment))) continue
    if (viewer.kind !== 'learner') return true
    const pairs = await loadVersionPairs(ctx.db, ctx.institutionId, [versionId])
    let shown = await shownToLearners(ctx.db, ctx.institutionId, pairs.get(versionId))
    for (const item of items) shown &&= await shownToLearners(ctx.db, ctx.institutionId, item)
    if (shown) return true
  }
  return false
}

/**
 * Kaynak sürümüne bağlı dosyanın okuma kuralı (ADR 0003 karar 6, DOM-KYN-006). Dosyayı şunlar açar:
 * dosyaya bağ açan sürümlerden birini okuyabilen kişi (personel okuyabildiği sürümün, öğrenci ve
 * veli yalnız kendisine paylaşılmış yayının; core `canReadVersion`) ve o sürümlerden birini
 * sabitleyen bir görevi gören kişi (`assignedLinkedVersion`). Kopya aynı dosyaya bağ açtığından
 * kopyanın okuyucusu da dosyayı okur. Ön büro içerik havuzuna ve görevlere erişmez (404).
 *
 * Kaldırılan sürüm (DOM-KYN-051) atanmış olsa da dosya açmaz. Sonradan yayımlanan sürümün yeni dosyası
 * eski sürüme atanmış göreve açılmaz: atama yalnız kendi sabitlediği sürümün bağını taşır. PGlite
 * tek bağlantılıdır: kapsam işlemin bağlantısıyla (`tx`) okunur.
 */
defineFileAttachment(RESOURCE_VERSION_ATTACHMENT, {
  purposes: ['material', 'listening_audio', 'question_image'],
  canRead: async (tx, ctx, _attachedId, file) => {
    const scoped = { ...ctx, db: tx }
    const versionIds = await listFileVersionIds(tx, ctx.institutionId, file.id)
    const linked = [...(await loadVersionPairs(tx, ctx.institutionId, versionIds)).values()].filter(
      ({ version }) => version.status !== 'removed',
    )
    if (linked.length === 0) return false
    return (
      (await readsLinkedVersion(scoped, linked)) || (await assignedLinkedVersion(scoped, linked))
    )
  },
})
