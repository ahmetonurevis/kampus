import { collectionKeyPrefix } from './collections.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Kayıp aday kırılımı (`GET /prospects/loss-breakdown`; IST-117, DOM-KAY-005). Anahtar aday
 * koleksiyonunun altındadır: aşama değişince aday komutlarının tazelemesi bu sorguyu da kapsar.
 */
export function useProspectLossBreakdown() {
  return useApiQuery({
    key: [...collectionKeyPrefix('prospects'), 'loss-breakdown'],
    request: (client, signal) => client.GET('/api/v1/prospects/loss-breakdown', { signal }),
  })
}
