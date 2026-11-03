import { focusManager, useQueries, useQueryClient, type Query } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import type { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from './api-result.ts'
import {
  fetchFileUrl,
  fileItemKey,
  filePollInterval,
  createWaitDeadlines,
  fileProcessing,
  getFileRequest,
  queryReads,
  type FileProcessing,
  type FileUrlOptions,
  type StoredFile,
} from './files.ts'
import { useKampusClient } from './kampus-context.ts'
import { fetchListeningUrl } from './listening.ts'
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

/**
 * Dosyanın imzalı indirme bağlantısını isteyen işlev (kullanıcı dosyayı açınca). Dinleme kaydında
 * öğrencinin süren denemesi `attemptId` ile verilir ve hak o denemeden düşer (`listening.ts`).
 */
export function useFileUrlFetcher() {
  const client = useKampusClient()
  return (fileId: string, options?: FileUrlOptions) => fetchFileUrl(client, fileId, options)
}

/**
 * Dinleme kaydının bağlantısını isteyen işlev (`fetchListeningUrl`): `attemptId` öğrencinin süren
 * denemesidir; sayılan dinlemeden sonra denemenin ayrıntı sorgusu eskitilir (kalan hak).
 */
export function useListeningUrlFetcher() {
  const client = useKampusClient()
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()
  return (fileId: string, attemptId?: string) =>
    fetchListeningUrl(client, queryClient, institutionId, fileId, attemptId)
}

/**
 * Bekleme üst süresi (`FILE_WAIT_LIMIT_MS`) yalnız sekme görünürken işler (`focusManager`: webde
 * `visibilitychange`, mobilde uygulama durumu). Listeye giren kimliğin saati başlar, listeden
 * çıkanın saati silinir; `restart` saati ve geri çekilme sayacını sıfırlar. Mantık
 * `createWaitDeadlines`'tadır (saf, `node --test` ile sınanır); kanca yalnız bağlar.
 */
function useWaitDeadlines(fileIds: readonly string[]) {
  const [expired, setExpired] = useState<readonly string[]>([])
  const [deadlines] = useState(() =>
    createWaitDeadlines({
      now: () => Date.now(),
      visible: () => focusManager.isFocused(),
      subscribe: (listener) => focusManager.subscribe(listener),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      onExpired: setExpired,
    }),
  )
  const idsKey = fileIds.join('\n')
  useEffect(() => {
    deadlines.sync(idsKey === '' ? [] : idsKey.split('\n'))
  }, [deadlines, idsKey])
  // Kalkınca zamanlayıcı ve abonelik bırakılır (Strict Mode'da yeniden bağlanınca `sync` yeniden abone olur).
  useEffect(() => () => deadlines.dispose(), [deadlines])
  return { expired, attempt: deadlines.attempt, restart: deadlines.restart }
}

export interface FileProcessingView {
  fileId: string
  file: StoredFile | undefined
  state: FileProcessing
  /** Son okuma hatası (`ApiError` ya da ağ hatası). */
  error: Error | null
}

/**
 * Yeni yüklenen dosyaların işlenmesini izler (`GET /files/:id`; ADR 0003 karar 8, 10; OG-987):
 * dosya `ready` olana, reddedilene (422 `file_rejected`), bulunamayana (404) ya da tarayıcısız
 * ortamda `pending` görünene kadar geri çekilen aralıkla (`filePollInterval`) yeniden okunur.
 * Yoklama sekme gizliyken durur, görününce sürer; üst süre de yalnız görünür sürede işler. Bekleme
 * `FILE_WAIT_LIMIT_MS` sürerse yoklama durur ve durum `timed_out` olur; `retry(fileId)` yeniden
 * yükleme gerektirmeden beklemeyi ve geri çekilmeyi (ilk aralık 1,5 sn) baştan başlatır. Sıra
 * `fileIds` sırasıdır; boş kimlik atlanır.
 */
export function useFilesProcessing(fileIds: readonly string[]) {
  const client = useKampusClient()
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()
  const ids = [...new Set(fileIds.filter((id) => id !== ''))]
  const deadlines = useWaitDeadlines(ids)
  const queries = useQueries({
    queries: ids.map((fileId) => {
      const timedOut = deadlines.expired.includes(fileId)
      return {
        queryKey: institutionKey(institutionId, ...fileItemKey(fileId)),
        queryFn: async ({ signal }: { signal: AbortSignal }) =>
          (await runRequest(() => getFileRequest(client, fileId, signal))).data,
        enabled: institutionId !== null,
        staleTime: 0,
        refetchInterval: (query: Query<StoredFile, ApiError, StoredFile, readonly unknown[]>) =>
          filePollInterval(
            query.state.data,
            query.state.error,
            timedOut,
            // Yeniden denemeden ya da yeniden izlemeden bu yana yapılan okuma sayısı.
            deadlines.attempt(fileId, queryReads(query.state)),
          ),
        refetchIntervalInBackground: false,
      }
    }),
  })
  const files: FileProcessingView[] = ids.map((fileId, index) => {
    const query = queries[index]
    return {
      fileId,
      file: query?.data,
      state: fileProcessing(query?.data, query?.error, deadlines.expired.includes(fileId)),
      error: query?.error ?? null,
    }
  })
  const { restart } = deadlines
  const retry = useCallback(
    (fileId: string) => {
      restart(fileId)
      void queryClient.refetchQueries({
        queryKey: institutionKey(institutionId, ...fileItemKey(fileId)),
        exact: true,
      })
    },
    [restart, queryClient, institutionId],
  )
  return { files, retry }
}

/**
 * Tek dosyanın işlenmesi (`useFilesProcessing`; konuşma kaydı, IST-051). `fileId` boşken istek
 * atılmaz ve durum `processing`; `fileId` boşaltılıp aynı değerle yeniden verilince bekleme
 * yeniden başlar (yeniden yükleme gerekmez).
 */
export function useFileProcessing(fileId: string) {
  const { files } = useFilesProcessing(fileId === '' ? [] : [fileId])
  const view = files[0]
  return {
    file: view?.file,
    state: view?.state ?? ('processing' as const),
    error: view?.error ?? null,
  }
}
