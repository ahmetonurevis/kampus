import { DomainError } from '../lib/errors.ts'
import { contentFileRefs, type ResourceContent } from './resource.ts'
import {
  RESOURCE_FILE_RULES,
  assertFileAllowed,
  type ContentType,
  type FileCandidate,
  type FilePurpose,
  type ResourceFileRule,
} from './taxonomy.ts'

/**
 * Kaynak sürümünün dosyaları (DOM-KYN-006; ADR 0003 karar 3, 5). Sürüm dosyaları sıralı bir
 * kimlik listesidir (`fileIds`); içerikteki ana dosya alanı (`fileId`, `imageFileId`) bu listeden
 * birini gösterir. Tür başına amaç ve sayı `RESOURCE_FILE_RULES` tablosundadır.
 *
 * Yeni dosya bağlamanın koşulları ödev teslimiyle aynıdır: aynı kurumda, işlemi yapanın yüklediği,
 * `ready`, amacı türe uygun ve başka kayda bağlı olmayan dosya. Önceki sürümden gelen (`kept`)
 * dosya zaten bir sürüme bağlıdır ve yeniden denetlenmez: yeni sürüm ve kopya aynı değişmez
 * dosyaya yeni bir bağ açar. Fonksiyon saftır; satırları servis yükler, bağlamayı servis yazar.
 */

/** Dosya satırının durumu (`files.status`, ADR 0003 karar 4). */
export type ResourceFileStatus = 'pending' | 'processing' | 'ready' | 'rejected' | 'deleted'

/** Servisin yüklediği dosya satırı; kurum dışındaki kimlik listede yoktur. */
export type ResourceFileRow = FileCandidate & {
  id: string
  purpose: FilePurpose
  status: ResourceFileStatus
  // kvkk: K
  uploadedByUserId: string
  /** Dosya bir kayda bağlı mı (`files.attached_id` dolu). */
  attached: boolean
}

export type VersionFilesInput = {
  actorUserId: string
  content: ResourceContent
  /** İstenen dosya listesi (core şeması tekilleştirir). */
  fileIds: readonly string[]
  /** `fileIds`'teki kimliklerin satırları (bulunmayan kimlik yok sayılır). */
  files: readonly ResourceFileRow[]
  /** Temel alınan sürümün dosyaları: zaten bağlıdır, yeniden denetlenmez. */
  kept?: readonly string[] | undefined
}

export type VersionFilesPlan = {
  /** Sürümün dosya listesi, istekteki sırayla. */
  fileIds: string[]
  /** Bu işlemde sürüme bağlanacak yeni dosyalar. */
  attach: string[]
}

export const RESOURCE_FILE_MESSAGES = {
  resource_files_not_allowed: 'Bu içerik türüne dosya eklenemez.',
  resource_file_unlinked: 'İçerikteki dosya, sürümün dosyaları arasında bulunmalıdır.',
  file_unavailable: 'Eklenen dosya bulunamadı. Dosyayı yeniden yükleyin.',
  file_purpose_mismatch: 'Bu dosya bu içerik türüne eklenemez.',
  file_already_attached: 'Bu dosya başka bir kayda eklenmiş.',
  file_not_ready: 'Dosya henüz kullanıma hazır değil.',
} as const

export const resourceFilesLimitMessage = (max: number) =>
  `Bu içerik türüne en fazla ${max} dosya eklenebilir.`

export type ResourceFileIssue = { code: string; message: string; path: string[] }

/**
 * Tür ve sayı denetimi (dosya satırı gerekmez): web formu aynı iletiyle uyarır, sunucu
 * `planVersionFiles` ile 422 verir. İlk sorunu döndürür; sorun yoksa `null`.
 */
export function resourceFileCountIssue(
  contentType: ContentType,
  fileIds: readonly string[],
): ResourceFileIssue | null {
  const rule: ResourceFileRule = RESOURCE_FILE_RULES[contentType]
  if (fileIds.length === 0) return null
  if (rule.maxFiles === 0)
    return {
      code: 'resource_files_not_allowed',
      message: RESOURCE_FILE_MESSAGES.resource_files_not_allowed,
      path: ['fileIds'],
    }
  if (fileIds.length > rule.maxFiles)
    return {
      code: 'resource_files_limit',
      message: resourceFilesLimitMessage(rule.maxFiles),
      path: ['fileIds'],
    }
  return null
}

function reject(issue: ResourceFileIssue): never {
  throw new DomainError(issue.code, issue.message, { path: issue.path })
}

function fail(code: keyof typeof RESOURCE_FILE_MESSAGES, path: string[]): never {
  return reject({ code, message: RESOURCE_FILE_MESSAGES[code], path })
}

/** İçerikteki dosya alanının yolu (hata `issues` yolu). */
function contentFilePath(content: ResourceContent): string[] {
  return content.type === 'question'
    ? ['content', 'question', 'imageFileId']
    : ['content', 'fileId']
}

/**
 * Sürüm dosyalarını denetler ve bağlanacak yenileri döndürür (DOM-KYN-006). Sıra: tür ve sayı,
 * her dosya (bulunamadı → amaç → bağlı → hazır değil → tür/boyut), sonra içerik alanının listede
 * olması. Hata 422'dir (`DomainError` `rule`), yol `fileIds.<sıra>`; hiçbir kayıt değişmez.
 */
export function planVersionFiles(input: VersionFilesInput): VersionFilesPlan {
  const { content } = input
  const fileIds = [...new Set(input.fileIds)]
  const issue = resourceFileCountIssue(content.type, fileIds)
  if (issue) reject(issue)
  const rule: ResourceFileRule = RESOURCE_FILE_RULES[content.type]
  const kept = new Set(input.kept ?? [])
  const rows = new Map(input.files.map((file) => [file.id, file]))
  const attach: string[] = []
  fileIds.forEach((id, index) => {
    const path = ['fileIds', String(index)]
    const row = rows.get(id)
    if (kept.has(id)) {
      // Önceki sürümün dosyası: amacı tür kuralına uymalı (tür değişmez, yine de güvence).
      if (row && !rule.purposes.includes(row.purpose)) fail('file_purpose_mismatch', path)
      return
    }
    if (
      !row ||
      row.uploadedByUserId !== input.actorUserId ||
      row.status === 'deleted' ||
      row.status === 'rejected'
    )
      fail('file_unavailable', path)
    if (!rule.purposes.includes(row.purpose)) fail('file_purpose_mismatch', path)
    if (row.attached) fail('file_already_attached', path)
    if (row.status !== 'ready') fail('file_not_ready', path)
    try {
      assertFileAllowed(row.purpose, row)
    } catch (error) {
      if (error instanceof DomainError)
        throw new DomainError(error.code, error.message, { path, cause: error })
      throw error
    }
    attach.push(id)
  })
  for (const ref of contentFileRefs(content)) {
    const row = rows.get(ref.fileId)
    if (!fileIds.includes(ref.fileId)) fail('resource_file_unlinked', contentFilePath(content))
    if (row && !ref.purposes.includes(row.purpose))
      fail('file_purpose_mismatch', contentFilePath(content))
  }
  return { fileIds, attach }
}
