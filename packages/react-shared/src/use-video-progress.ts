import { useCallback } from 'react'

import { useKampusClient } from './kampus-context.ts'
import { useApiMutation } from './use-api-mutation.ts'
import {
  recordVideoProgressRequest,
  VIDEO_PROGRESS_INVALIDATES,
  type RecordVideoProgressInput,
} from './video-progress.ts'

/**
 * Öğrencinin video izleme ilerlemesini yazar (`POST /videos/{videoId}/progress`; DOM-KYN-005).
 * Başarıdan sonra `videoProgress` okumaları tazelenir (liste yüzdesi). Hata toast göstermez:
 * çağıran sessiz bırakır, ilerleme bir sonraki aralıkta yeniden yazılır.
 */
export function useRecordVideoProgress() {
  return useApiMutation({
    request: recordVideoProgressRequest,
    invalidates: VIDEO_PROGRESS_INVALIDATES,
  })
}

/**
 * Sekme/pencere kapanırken (`pagehide`) ya da gizlenirken son ilerlemeyi yazar: `keepalive`'lı
 * istek sayfa kapandıktan sonra da sürer. Mutasyon (TanStack Query) kullanılmaz: kapanışta sorgu
 * tazelemenin anlamı yoktur ve istek aynı olay döngüsü turunda çıkmalıdır. Sonuç beklenmez, hata
 * sessizdir (ilerleme bir sonraki açılışta yeniden yazılır).
 */
export function useRecordVideoProgressOnClose() {
  const client = useKampusClient()
  return useCallback(
    (input: RecordVideoProgressInput) => {
      void recordVideoProgressRequest(client, input, { keepalive: true }).catch(() => undefined)
    },
    [client],
  )
}
