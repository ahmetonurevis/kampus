import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from './api-result.ts'
import {
  FILE_WAIT_LIMIT_MS,
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
 * olana ya da reddedilene (404) kadar `FILE_POLL_INTERVAL_MS` aralıkla yeniden okunur. Yoklama
 * sekme gizliyken durur, görününce sürer. Bekleme `FILE_WAIT_LIMIT_MS` sürerse yoklama durur ve
 * durum `timed_out` olur; çağıran `fileId`'yi saklayıp kullanıcıya sakin bir ileti gösterir,
 * `fileId` boşaltılıp aynı değerle yeniden verilince bekleme yeniden başlar (yeniden yükleme
 * gerekmez). `fileId` boşken istek atılmaz.
 */
export function useFileProcessing(fileId: string) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const [expiredFor, setExpiredFor] = useState<string | null>(null)
  const timedOut = fileId !== '' && expiredFor === fileId
  useEffect(() => {
    setExpiredFor(null)
    if (fileId === '') return undefined
    const timer = setTimeout(() => setExpiredFor(fileId), FILE_WAIT_LIMIT_MS)
    return () => clearTimeout(timer)
  }, [fileId])
  const query = useQuery<StoredFile, ApiError>({
    queryKey: institutionKey(institutionId, ...fileItemKey(fileId)),
    queryFn: async ({ signal }) =>
      (await runRequest(() => getFileRequest(client, fileId, signal))).data,
    enabled: institutionId !== null && fileId !== '',
    staleTime: 0,
    refetchInterval: (current) =>
      filePollInterval(current.state.data, current.state.error, timedOut),
    refetchIntervalInBackground: false,
  })
  return {
    file: query.data,
    state: fileId === '' ? ('waiting' as const) : fileProcessing(query.data, query.error, timedOut),
    error: query.error,
  }
}
