import { useQueries, useQuery } from '@tanstack/react-query'

import type { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from './api-result.ts'
import {
  fetchFileUrl,
  fileItemKey,
  filePollInterval,
  fileProcessing,
  getFileRequest,
  type StoredFile,
} from './files.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

// Dosya okuma kancaları (ADR 0003 karar 4, 6). Meta veri önbellekten paylaşılır; imzalı bağlantı
// önbelleğe yazılmaz (kısa ömürlüdür ve her üretimi teslimde denetim kaydıdır).

/** Dosyaların meta verisi (ad, boyut); sıra `fileIds` sırasıdır. */
export function useFileInfos(fileIds: readonly string[]) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQueries({
    queries: fileIds.map((fileId) => ({
      queryKey: institutionKey(institutionId, ...fileItemKey(fileId)),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        (await runRequest(() => getFileRequest(client, fileId, signal))).data,
      enabled: institutionId !== null,
      staleTime: 5 * 60_000,
    })),
  })
}

/** Dosyanın imzalı indirme bağlantısını isteyen işlev (kullanıcı dosyayı açınca). */
export function useFileUrlFetcher() {
  const client = useKampusClient()
  return (fileId: string) => fetchFileUrl(client, fileId)
}

/**
 * Yeni yüklenen dosyanın işlenmesini izler (`GET /files/:id`; ADR 0003 karar 10): dosya `ready`
 * olana ya da reddedilene (404) kadar `FILE_POLL_INTERVAL_MS` aralıkla yeniden okunur. Sekme arka
 * plandayken de sürer: teslim, dönüşüm biter bitmez yapılabilsin. `fileId` boşken istek atılmaz.
 */
export function useFileProcessing(fileId: string) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const query = useQuery<StoredFile, ApiError>({
    queryKey: institutionKey(institutionId, ...fileItemKey(fileId)),
    queryFn: async ({ signal }) =>
      (await runRequest(() => getFileRequest(client, fileId, signal))).data,
    enabled: institutionId !== null && fileId !== '',
    staleTime: 0,
    refetchInterval: (current) => filePollInterval(current.state.data, current.state.error),
    refetchIntervalInBackground: true,
  })
  return {
    file: query.data,
    state: fileId === '' ? ('waiting' as const) : fileProcessing(query.data, query.error),
    error: query.error,
  }
}
