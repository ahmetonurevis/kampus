import type { KampusClient } from '@kampus/api-client/client.ts'
import { isApiError } from '@kampus/api-client/errors.ts'
import type { components } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'

/**
 * Yüklenmiş dosyanın okunması (ADR 0003 karar 4, 6): meta veri (`GET /files/:id`, özgün ad ve
 * boyut) ve kısa ömürlü imzalı indirme bağlantısı (`GET /files/:id/url`). Bağlı dosya bağlı
 * kaydın okuma kuralından geçer (ör. teslim: DOM-AKD-074). Teslim dosyasında her bağlantı üretimi
 * denetim kaydına yazılır; bu yüzden bağlantı önceden değil, kullanıcı dosyayı açınca istenir.
 */

export type StoredFile = components['schemas']['File']
export type FileUrl = components['schemas']['FileUrl']

export const fileItemKey = (fileId: string): unknown[] => ['files', 'item', fileId]

export function getFileRequest(client: KampusClient, fileId: string, signal?: AbortSignal) {
  return client.GET('/api/v1/files/{fileId}', {
    params: { path: { fileId } },
    ...(signal ? { signal } : {}),
  })
}

export function fileUrlRequest(client: KampusClient, fileId: string) {
  return client.GET('/api/v1/files/{fileId}/url', { params: { path: { fileId } } })
}

/** İmzalı bağlantıyı ister; hata `ApiError` olarak fırlar. */
export async function fetchFileUrl(client: KampusClient, fileId: string): Promise<FileUrl> {
  const body = await runRequest(() => fileUrlRequest(client, fileId))
  return body.data
}

/** Dosyanın gösterim adı: temizlenmiş özgün ad, yoksa sıra numarası. */
export function fileLabel(file: Pick<StoredFile, 'originalName'> | undefined, index: number) {
  return file?.originalName?.trim() || `Dosya ${index + 1}`
}

/**
 * Yüklenen dosyanın işlenme sonucu (ADR 0003 karar 10; DOM-BEC-054): `waiting` tarama ya da ses
 * dönüşümü sürüyor (`pending`, `processing`), `ready` kullanıma hazır, `rejected` sunucu dosyayı
 * reddetti ya da sildi. Reddedilen ve silinen dosya okumada görünmez (404); nedeni (boş, sessiz,
 * bozuk, sınırı aşan kayıt) istemciye dönmez. `failed` başka bir okuma hatasıdır (yetki, modül).
 * Ağ ve sunucu hatası beklemeyi bozmaz: dosya hâlâ işleniyor olabilir.
 */
export type FileProcessing = 'waiting' | 'ready' | 'rejected' | 'failed' | 'timed_out'

/** İşlenmeyi bekleme üst süresi; aşılınca yoklama durur (`timed_out`), `fileId` korunur. */
export const FILE_WAIT_LIMIT_MS = 120_000

/**
 * `timedOut` bekleme süresi dolduysa `true`: sonuç hâlâ belli değilse (`waiting`) `timed_out`
 * döner. Dosya bu arada hazır, reddedilmiş ya da okunamıyorsa o sonuç korunur.
 */
export function fileProcessing(
  file: Pick<StoredFile, 'status'> | undefined,
  error: unknown,
  timedOut = false,
): FileProcessing {
  if (file?.status === 'ready') return 'ready'
  if (file?.status === 'rejected' || file?.status === 'deleted') return 'rejected'
  if (isApiError(error) && error.status === 404) return 'rejected'
  if (isApiError(error) && error.status >= 400 && error.status < 500) return 'failed'
  return timedOut ? 'timed_out' : 'waiting'
}

/** İşlenen dosyanın yoklama aralığı; dönüşüm birkaç saniye sürer. */
export const FILE_POLL_INTERVAL_MS = 1500

/**
 * Yoklama yalnız dosya beklenirken sürer; sonuç belli olunca (hazır, ret, hata) ya da bekleme
 * üst süresi dolunca durur.
 */
export function filePollInterval(
  file: Pick<StoredFile, 'status'> | undefined,
  error: unknown,
  timedOut = false,
): number | false {
  return fileProcessing(file, error, timedOut) === 'waiting' ? FILE_POLL_INTERVAL_MS : false
}
