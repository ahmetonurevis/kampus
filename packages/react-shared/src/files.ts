import type { KampusClient } from '@kampus/api-client/client.ts'
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
