import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiQuery } from './use-api-query.ts'

/**
 * Oturum rolünün kitlesindeki güncel aydınlatma metni (IST-016/018; DOM-YTK-056): okuma yüzeyi.
 * Yayımlanmış metin yoksa `notice` boştur; istemci o durumda kendi şablonunu gösterebilir.
 */
type CurrentResponse =
  operations['getCurrentPrivacyNotice']['responses'][200]['content']['application/json']
export type CurrentPrivacyNoticeView = CurrentResponse['data']

export const PRIVACY_NOTICE_KEY_ROOT = 'privacy-notices'

export function currentPrivacyNoticeKey() {
  return [PRIVACY_NOTICE_KEY_ROOT, 'current'] as const
}

export function currentPrivacyNoticeRequest(client: KampusClient, signal?: AbortSignal) {
  return client.GET('/api/v1/privacy-notices/current', {
    params: { query: {} },
    ...(signal ? { signal } : {}),
  })
}

export function useCurrentPrivacyNotice(options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: currentPrivacyNoticeKey(),
    request: (client, signal) => currentPrivacyNoticeRequest(client, signal),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}
