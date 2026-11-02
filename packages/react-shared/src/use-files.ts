import { focusManager, useQueries, useQueryClient, type Query } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from './api-result.ts'
import {
  fetchFileUrl,
  fileItemKey,
  filePollInterval,
  fileProcessing,
  getFileRequest,
  pauseWaitClock,
  resumeWaitClock,
  startWaitClock,
  waitRemainingMs,
  type FileProcessing,
  type StoredFile,
  type WaitClock,
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

/** Bekleme saatleri: kimlik başına görünür süre ve süresi dolmuşluk. */
type WaitEntry = { clock: WaitClock; expired: boolean }

/**
 * Bekleme üst süresi (`FILE_WAIT_LIMIT_MS`) yalnız sekme görünürken işler (`focusManager`: webde
 * `visibilitychange`, mobilde uygulama durumu). Listeye giren kimliğin saati başlar, listeden
 * çıkanın saati silinir; `restart` saati sıfırlar. Süresi dolan kimlikler döner.
 */
function useWaitDeadlines(fileIds: readonly string[]) {
  const entries = useRef(new Map<string, WaitEntry>())
  const [expired, setExpired] = useState<readonly string[]>([])
  const [round, setRound] = useState(0)
  const idsKey = fileIds.join('\n')
  useEffect(() => {
    const ids = idsKey === '' ? [] : idsKey.split('\n')
    const map = entries.current
    const visible = focusManager.isFocused()
    for (const id of [...map.keys()]) if (!ids.includes(id)) map.delete(id)
    for (const id of ids)
      if (!map.has(id)) map.set(id, { clock: startWaitClock(Date.now(), visible), expired: false })
    const publish = () =>
      setExpired((current) => {
        const next = ids.filter((id) => map.get(id)?.expired === true)
        return next.length === current.length && next.every((id, i) => current[i] === id)
          ? current
          : next
      })
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      const now = Date.now()
      let next = Infinity
      for (const entry of map.values()) {
        if (entry.expired || entry.clock.visibleSince === null) continue
        const left = waitRemainingMs(entry.clock, now)
        if (left === 0) entry.expired = true
        else next = Math.min(next, left)
      }
      publish()
      if (next !== Infinity) timer = setTimeout(schedule, next)
    }
    const unsubscribe = focusManager.subscribe((focused) => {
      const now = Date.now()
      for (const entry of map.values())
        entry.clock = focused ? resumeWaitClock(entry.clock, now) : pauseWaitClock(entry.clock, now)
      schedule()
    })
    schedule()
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [idsKey, round])
  const restart = useCallback((fileId: string) => {
    entries.current.delete(fileId)
    setExpired((current) => current.filter((id) => id !== fileId))
    setRound((value) => value + 1)
  }, [])
  return { expired, restart }
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
 * dosya `ready` olana, reddedilene (422 `file_rejected` ya da 404) ya da tarayıcısız ortamda
 * `pending` görünene kadar geri çekilen aralıkla (`filePollInterval`) yeniden okunur. Yoklama
 * sekme gizliyken durur, görününce sürer; üst süre de yalnız görünür sürede işler. Bekleme
 * `FILE_WAIT_LIMIT_MS` sürerse yoklama durur ve durum `timed_out` olur; `retry(fileId)` yeniden
 * yükleme gerektirmeden beklemeyi baştan başlatır. Sıra `fileIds` sırasıdır; boş kimlik atlanır.
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
            query.state.dataUpdateCount + query.state.errorUpdateCount,
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
