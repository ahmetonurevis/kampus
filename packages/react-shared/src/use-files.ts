import { useQueries } from '@tanstack/react-query'

import { runRequest } from './api-result.ts'
import { fetchFileUrl, fileItemKey, getFileRequest } from './files.ts'
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
