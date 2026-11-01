import { fileTypeFromBuffer } from 'file-type'

import { canonicalMimeType, type AllowedMimeType } from '@kampus/school-core/content/taxonomy.ts'

/**
 * İçerikten tür tespiti (ADR 0003 karar 3, DOM-KYN-004). Tür `file-type` ile sihirli baytlardan
 * bulunur; uzantı ve istemcinin bildirdiği `Content-Type` yalnız tutarlılık denetimidir.
 * Her tür tek kanonik MIME ile saklanır (core `FILE_PURPOSES` listesindeki değer); istemcinin
 * bildirdiği takma adlar core `canonicalMimeType` ile çözülür (web/mobil ön denetimiyle aynı tablo).
 *
 * TODO(F3c2-scan): makrosuz OOXML ve parola korumalı PDF/Office reddi ClamAV taramasıyla
 * (`AlertOLE2Macros`, `AlertEncrypted`; karar 8) gelir. Makrolu OOXML (`.docm` vb.) burada
 * zaten tanınmaz ve reddedilir.
 */

type FileKind = {
  mime: AllowedMimeType
  /** `file-type`'ın döndürdüğü uzantılar. */
  detected: readonly string[]
  /** Dosya adında aynı türü gösteren uzantılar. */
  extensions: readonly string[]
}

const KINDS: readonly FileKind[] = [
  { mime: 'application/pdf', detected: ['pdf'], extensions: ['pdf'] },
  { mime: 'image/jpeg', detected: ['jpg'], extensions: ['jpg', 'jpeg', 'jpe'] },
  { mime: 'image/png', detected: ['png'], extensions: ['png'] },
  { mime: 'image/webp', detected: ['webp'], extensions: ['webp'] },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    detected: ['docx'],
    extensions: ['docx'],
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    detected: ['pptx'],
    extensions: ['pptx'],
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    detected: ['xlsx'],
    extensions: ['xlsx'],
  },
  { mime: 'audio/mpeg', detected: ['mp3'], extensions: ['mp3'] },
  { mime: 'audio/mp4', detected: ['m4a'], extensions: ['m4a'] },
  { mime: 'audio/wav', detected: ['wav'], extensions: ['wav'] },
  // Tarayıcı kayıtları WebM/Opus gelir; `file-type` her WebM'i `video/webm` sayar.
  { mime: 'audio/webm', detected: ['webm'], extensions: ['webm'] },
  { mime: 'video/mp4', detected: ['mp4'], extensions: ['mp4'] },
]

function kindOfMime(mime: string): FileKind | undefined {
  const canonical = canonicalMimeType(mime)
  return canonical ? KINDS.find((kind) => kind.mime === canonical) : undefined
}

function kindOfExtension(fileName: string | null): FileKind | undefined {
  const match = fileName ? /\.([A-Za-z0-9]{1,8})$/.exec(fileName) : null
  const extension = match?.[1]?.toLowerCase()
  return extension ? KINDS.find((kind) => kind.extensions.includes(extension)) : undefined
}

/** İçeriğin kanonik MIME'ı; tanınmayan veya izin listesinde hiç olmayan tür `null`. */
export async function detectContentType(head: Uint8Array): Promise<AllowedMimeType | null> {
  const result = await fileTypeFromBuffer(head)
  if (!result) return null
  return KINDS.find((kind) => kind.detected.includes(result.ext))?.mime ?? null
}

/**
 * İstemcinin bildirdiği tür veya dosya adı uzantısı tanınan başka bir türü gösteriyorsa çelişki
 * (422 `file_type_mismatch`). Tanınmayan bildirim (`application/octet-stream`, uzantısız ad)
 * çelişki sayılmaz: tür zaten içerikten bulunur.
 */
export function contentTypeMismatch(
  detected: AllowedMimeType,
  declared: { mime: string | null; fileName: string | null },
): boolean {
  const byMime = declared.mime ? kindOfMime(declared.mime) : undefined
  const byName = kindOfExtension(declared.fileName)
  return [byMime, byName].some((kind) => kind !== undefined && kind.mime !== detected)
}

/** Belge indirilir, görsel/ses/görüntü tarayıcıda açılır (karar 6). */
export function dispositionFor(contentType: string): 'inline' | 'attachment' {
  return /^(image|audio|video)\//.test(contentType) ? 'inline' : 'attachment'
}

const FILE_NAME_MAX = 200

/**
 * Özgün adın temizlenmiş biçimi (karar 4): yol kısmı, denetim ve biçim karakterleri atılır,
 * boşluklar sadeleşir, uzunluk sınırlanır (uzantı korunur). Boş kalan ad `null`.
 */
export function sanitizeFileName(name: string | null | undefined): string | null {
  if (!name) return null
  const base = name.split(/[/\\]/).pop() ?? ''
  const cleaned = base
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return null
  if (cleaned.length <= FILE_NAME_MAX) return cleaned
  const extension = /\.[A-Za-z0-9]{1,8}$/.exec(cleaned)?.[0] ?? ''
  return cleaned.slice(0, FILE_NAME_MAX - extension.length) + extension
}

/** RFC 6266 / 5987 `Content-Disposition`: ASCII yedek ad ve UTF-8 ad birlikte. */
export function contentDisposition(
  disposition: 'inline' | 'attachment',
  fileName: string | null,
): string {
  if (!fileName) return disposition
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%]/g, '_')
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
