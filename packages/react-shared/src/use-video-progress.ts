import { recordVideoProgressRequest, VIDEO_PROGRESS_INVALIDATES } from './video-progress.ts'
import { useApiMutation } from './use-api-mutation.ts'

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
