// Ödev teslimi için dosya seçimi ve yükleme (`POST /files`, amaç `submission`; konuşma görevinde
// `speaking_recording`; ADR 0003). Seçilen
// dosya yalnız uygulama önbelleğinde (`copyToCacheDirectory`) durur; AsyncStorage'a hiçbir şey
// yazılmaz. Yükleme `useApiCommand` üzerindedir: her yükleme yeni `Idempotency-Key` taşır, ağ
// hatasından sonra aynı dosya aynı anahtarla yeniden gönderilir.
import * as DocumentPicker from 'expo-document-picker'
import { Platform } from 'react-native'
import { ApiError } from '@kampus/api-client/errors.ts'
import type { KampusClient } from '@kampus/api-client/client.ts'
import type { CommandHeaders } from '@kampus/react-shared/commands.ts'
import { useApiCommand } from '@kampus/react-shared/use-api-command.ts'
import { FILE_UPLOAD_INVALIDATES } from '@kampus/react-shared/use-file-upload.ts'
import { FILE_PURPOSES } from '@kampus/school-core/content/taxonomy.ts'
import { resolveMimeType, type PickedFile } from './homework-submission.ts'

/** Seçicinin gösterdiği türler: core `submission` amacının tablosu. */
const PICKER_TYPES = [...FILE_PURPOSES.submission.mimeTypes]

/** Dosya seçtirir; iptalde boş liste. */
export async function pickSubmissionFiles(): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: PICKER_TYPES,
    multiple: true,
    copyToCacheDirectory: true,
  })
  if (result.canceled) return []
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    size: typeof asset.size === 'number' ? asset.size : null,
    mimeType: asset.mimeType ?? null,
  }))
}

/** Yükleme amacı: ödev dosyası ya da konuşma kaydı (`speaking_recording`, rıza ister). */
export type UploadPurpose = 'submission' | 'speaking_recording'

export type SubmissionUploadInput = {
  file: PickedFile
  /** Varsayılan `submission`. */
  purpose?: UploadPurpose
  /** Yüklemeyi durdurur (pencere kapandı); durdurulan istek hata olarak döner. */
  signal?: AbortSignal
}

async function uploadBody(file: PickedFile, purpose: UploadPurpose): Promise<FormData> {
  const type = resolveMimeType(file) ?? 'application/octet-stream'
  const form = new FormData()
  // Sunucu önce `purpose`, sonra `file` alanını okur; sıra önemlidir.
  form.append('purpose', purpose)
  if (Platform.OS === 'web') {
    // Webde `uri` blob adresidir; çok parçalı gövde gerçek bir Blob ister.
    const blob = await (await fetch(file.uri)).blob()
    form.append('file', new Blob([blob], { type }), file.name)
  } else {
    // React Native çok parçalı gövdeyi `{ uri, name, type }` nesnesinden dosya olarak akıtır.
    form.append('file', { uri: file.uri, name: file.name, type } as unknown as Blob)
  }
  return form
}

async function uploadRequest(
  client: KampusClient,
  input: SubmissionUploadInput,
  headers: CommandHeaders,
) {
  let form: FormData
  try {
    form = await uploadBody(input.file, input.purpose ?? 'submission')
  } catch (cause) {
    throw new ApiError({
      status: 0,
      code: 'file_unreadable',
      message: 'Dosya okunamadı. Dosyayı yeniden seç.',
      cause,
    })
  }
  return client.POST('/api/v1/files', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    ...(input.signal ? { signal: input.signal } : {}),
    body: null,
    bodySerializer: () => form,
  })
}

/** Tek dosya yükler; hata fırlatmaz, sonucu döndürür (`useApiCommand.submit`). */
export function useSubmissionUpload() {
  const command = useApiCommand({ request: uploadRequest, invalidates: FILE_UPLOAD_INVALIDATES })
  return {
    upload: (input: SubmissionUploadInput) => command.submit(input, { silent: () => true }),
  }
}
