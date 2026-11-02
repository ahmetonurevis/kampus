import { contentFileRefs, type ResourceContent } from '@kampus/school-core/content/resource.ts'
import {
  planVersionFiles,
  type ResourceFileRow,
  type VersionFilesPlan,
} from '@kampus/school-core/content/resource-files.ts'
import { canReadVersion } from '@kampus/school-core/content/visibility.ts'

import type { Database } from '../db/client.ts'
import { loadFilesByIds } from '../db/files.ts'
import { asCoreVersion, listFileVersionIds, loadVersionPairs } from '../db/resources.ts'
import { ForbiddenError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, detachFile } from './files.ts'
import { RESOURCE_VERSION_ATTACHMENT } from './listening-plays.ts'
import { contentReader } from './resources.ts'

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

/**
 * Kaynak sürümüne bağlı dosya, dosyaya bağ açan sürümlerden birini okuyabilene açılır (ADR 0003
 * karar 6, DOM-KYN-006): personel okuyabildiği sürümün, öğrenci ve veli yalnız kendisine
 * paylaşılmış yayındaki sürümün dosyasını okur (core `canReadVersion`). Kaldırılan sürüm dosya
 * açmaz. Kopya aynı dosyaya bağ açtığından kopyanın okuyucusu da dosyayı okur. Ön büro içerik
 * havuzuna erişmez (`contentReader` 403 → okuyamaz, 404). PGlite tek bağlantılıdır: kapsam
 * işlemin bağlantısıyla (`tx`) okunur.
 */
defineFileAttachment(RESOURCE_VERSION_ATTACHMENT, {
  purposes: ['material', 'listening_audio', 'question_image'],
  canRead: async (tx, ctx, _attachedId, file) => {
    let reader
    try {
      reader = await contentReader({ ...ctx, db: tx })
    } catch (error) {
      if (error instanceof ForbiddenError) return false
      throw error
    }
    const versionIds = await listFileVersionIds(tx, ctx.institutionId, file.id)
    const pairs = await loadVersionPairs(tx, ctx.institutionId, versionIds)
    return [...pairs.values()].some(
      ({ resource, version }) =>
        version.status !== 'removed' &&
        canReadVersion(reader.viewer, {
          institutionType: reader.institutionType,
          resource,
          version: asCoreVersion(version),
          now: ctx.now,
        }),
    )
  },
})
