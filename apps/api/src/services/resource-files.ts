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
import { learnerContentGate, learnerHasWork } from './task-progress.ts'

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

/**
 * Kaldırmanın aşağı yayılması (DOM-KYN-051, sabah kararı 39): kaldırılan kaynağın ve ondan türeyen
 * kopyaların (zincirdeki bütün torunlar) sürümleri dosya açmaz; ata ve kardeş kopyalar açık kalır.
 * Kopya ilişkisi `resources.derived_from_version_id`'dir; soy yukarı doğru, düzey başına tek
 * sorguyla yüklenir. Kaldırma kaynağın bütün sürümlerini `removed` yapar: atanın sürümüne bakmak
 * yeter.
 */
async function openLinkedVersions(
  tx: Database,
  institutionId: string,
  linked: readonly VersionPair[],
): Promise<VersionPair[]> {
  const known = new Map<string, VersionPair>(linked.map((pair) => [pair.version.id, pair]))
  let parents = linked.map(({ resource }) => resource.derivedFromVersionId)
  for (;;) {
    const missing = parents.filter((id): id is string => id !== null && !known.has(id))
    if (missing.length === 0) break
    const loaded = await loadVersionPairs(tx, institutionId, missing)
    for (const [id, pair] of loaded) known.set(id, pair)
    parents = [...loaded.values()].map(({ resource }) => resource.derivedFromVersionId)
  }
  const removedLine = (start: VersionPair) => {
    const seen = new Set<string>()
    let pair: VersionPair | undefined = start
    while (pair && !seen.has(pair.version.id)) {
      if (pair.version.status === 'removed') return true
      seen.add(pair.version.id)
      const parent: string | null = pair.resource.derivedFromVersionId
      pair = parent === null ? undefined : known.get(parent)
    }
    return false
  }
  return linked.filter((pair) => !removedLine(pair))
}

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
 * veya alıştırma setinin atamasıyla da açılır. Kursiyerde görev içeriğinin kuralı aynen uygulanır
 * (`learnerContentGate`: yayın geçmişi, kitap sahibi sınırı, telif incelemesi ve kaldırma, lisans
 * süresi dolmuşsa yalnız süren iş); quiz yolunda sorunun sürümü de bu kuraldan geçer.
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
    const assignments = (await loadVersionAssignments(ctx.db, ctx.institutionId, versionId)).filter(
      (assignment) => visible(viewer, assignment),
    )
    if (assignments.length === 0) continue
    if (viewer.kind !== 'learner') return true
    const pairs = await loadVersionPairs(ctx.db, ctx.institutionId, [versionId])
    for (const assignment of assignments) {
      const gate = await learnerContentGate(
        ctx,
        viewer,
        assignment,
        [pairs.get(versionId), ...items],
        () => learnerHasWork(ctx, viewer, assignment),
      )
      if (gate === null) return true
    }
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
 * Kaldırma (DOM-KYN-051, sabah kararları 36 ve 39) aşağı yayılır: kaldırılan kaynağın ve ondan
 * türeyen kopyaların (torunlar dahil) sürümleri ne okumayla ne atanmış görevle dosya açar; ata ve
 * kardeş kopyalar açık kalır (`openLinkedVersions`). Orijinal kaldırılınca bütün kopyalar kapanır;
 * kopya kaldırılınca orijinal de aynı içeriği taşıyorsa yönetici onu ayrıca kaldırır. Bağ satırları
 * silinmez, yalnız okuma kapanır: karar geri alınabilir ve imha işi dosyayı bağlı bulur. Yayından
 * kaldırma (arşiv) kaldırma değildir: kopyanın okuyucusu açmaya devam eder. Sonradan yayımlanan sürümün yeni dosyası
 * eski sürüme atanmış göreve açılmaz: atama yalnız kendi sabitlediği sürümün bağını taşır. PGlite
 * tek bağlantılıdır: kapsam işlemin bağlantısıyla (`tx`) okunur.
 */
defineFileAttachment(RESOURCE_VERSION_ATTACHMENT, {
  purposes: ['material', 'listening_audio', 'question_image'],
  canRead: async (tx, ctx, _attachedId, file) => {
    const scoped = { ...ctx, db: tx }
    const versionIds = await listFileVersionIds(tx, ctx.institutionId, file.id)
    const pairs = await loadVersionPairs(tx, ctx.institutionId, versionIds)
    const linked = await openLinkedVersions(tx, ctx.institutionId, [...pairs.values()])
    if (linked.length === 0) return false
    return (
      (await readsLinkedVersion(scoped, linked)) || (await assignedLinkedVersion(scoped, linked))
    )
  },
})
