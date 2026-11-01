import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components } from '@kampus/api-client/schema.d.ts'
import { assertFileAllowed, type FilePurpose } from '@kampus/school-core/content/taxonomy.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'

import type { CommandHeaders } from './commands.ts'
import { useApiCommand, type SubmitOptions } from './use-api-command.ts'

/**
 * Dosya yükleme kancası (`POST /api/v1/files`; ADR 0003 karar 2, 3; DOM-KYN-004). Tür ve boyut
 * önce core'daki amaç tablosuyla (`assertFileAllowed`) burada denetlenir, sunucu içerikten yeniden
 * denetler; tarayıcının bildirdiği tür yalnız erken uyarıdır. Yüklenen dosya `pending` başlar ve
 * bir kayda bağlanana kadar yalnız yükleyene görünür; bağlama tüketici modülün işidir (F4b4).
 */

export type UploadedFile = components['schemas']['File']

/** Yüklenen dosya henüz bir sorguya bağlı değildir; tazelenecek liste yoktur. */
export const FILE_UPLOAD_INVALIDATES = [] as const

export interface FileUploadInput {
  purpose: FilePurpose
  file: Blob
  /** Dosyanın kimliği (`fileIdentity`): `File` JSON'da `{}` olur, parmak izi bu alandan ayrışır. */
  fileKey: string
}

/**
 * Seçilen dosyanın yerel kimliği: belirsiz hatadan sonra aynı dosyanın yeniden gönderimi aynı
 * `Idempotency-Key`'i, başka bir dosya yeni anahtarı alır. İçerik okunmaz (büyük dosyada pahalı).
 */
export function fileIdentity(file: Blob): string {
  const name = 'name' in file && typeof file.name === 'string' ? file.name : ''
  const lastModified =
    'lastModified' in file && typeof file.lastModified === 'number' ? file.lastModified : 0
  return [name, file.size, lastModified, file.type].join('|')
}

/**
 * Yüklemeden önce amaç kuralı: uymayan dosyanın Türkçe iletisi, uyan dosyada `null`. Tarayıcı türü
 * boş bildirirse karar sunucuya bırakılır (içerikten tespit eder).
 */
export function checkFileBeforeUpload(purpose: FilePurpose, file: Blob): string | null {
  if (file.type === '') return null
  try {
    assertFileAllowed(purpose, { contentType: file.type, byteSize: file.size })
    return null
  } catch (error) {
    if (error instanceof DomainError) return error.message
    throw error
  }
}

/** Sunucu önce `purpose`, sonra `file` alanını okur; sıra önemlidir. */
export function fileUploadForm({ purpose, file }: FileUploadInput): FormData {
  const form = new FormData()
  form.append('purpose', purpose)
  form.append('file', file)
  return form
}

export function uploadFileRequest(
  client: KampusClient,
  input: FileUploadInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/files', {
    // Oluşturma ucu `If-Match` kabul etmez.
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    // Tipli gövde JSON içindir; çok parçalı gövdeyi serileştirici kurar (openapi-fetch FormData'yı
    // olduğu gibi gönderir, sınır dizesini tarayıcı yazar).
    body: null,
    bodySerializer: () => fileUploadForm(input),
  })
}

interface UploadOptions {
  onSuccess?: (file: UploadedFile) => void | Promise<void>
}

/**
 * Tek dosya yükler. `upload` önce amaç kuralını denetler; uymayan dosya isteğe çıkmaz ve iletisi
 * `{ ok: false, message }` olarak döner (çağıran alanda gösterir). Sunucu hataları (413, 422,
 * 403 `consent_required`) ortak komut yoluyla toast veya alan hatası olur.
 */
export function useFileUpload(options: UploadOptions = {}) {
  const command = useApiCommand({
    request: uploadFileRequest,
    invalidates: FILE_UPLOAD_INVALIDATES,
    ...(options.onSuccess
      ? { onSuccess: (data: { data: UploadedFile }) => options.onSuccess?.(data.data) }
      : {}),
  })

  async function upload<TName extends string = string>(
    purpose: FilePurpose,
    file: Blob,
    submitOptions: SubmitOptions<TName> = {},
  ) {
    const problem = checkFileBeforeUpload(purpose, file)
    if (problem !== null) return { ok: false as const, message: problem }
    return command.submit({ purpose, file, fileKey: fileIdentity(file) }, submitOptions)
  }

  return { ...command, upload }
}
