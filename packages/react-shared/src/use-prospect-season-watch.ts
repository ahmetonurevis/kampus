import { collectionKeyPrefix } from './collections.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Kayıt sezonu nöbeti (`GET /prospects/season-watch`; DOM-KAY-037, ON-077). Anahtar aday
 * koleksiyonunun altındadır: görüşme, deneme, not ve aşama komutlarının tazelemesi bu sorguyu da
 * kapsar. `days` verilmezse pencere 7 gündür.
 */
export function useProspectSeasonWatch(days?: number) {
  const query = days === undefined ? {} : { days }
  return useApiQuery({
    key: [...collectionKeyPrefix('prospects'), 'season-watch', query],
    request: (client, signal) =>
      client.GET('/api/v1/prospects/season-watch', { params: { query }, signal }),
  })
}
