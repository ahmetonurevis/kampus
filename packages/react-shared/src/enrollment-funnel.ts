import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components } from '@kampus/api-client/schema.d.ts'

import { useApiQuery } from './use-api-query.ts'

/**
 * Kayıt hunisi (ON-052; `GET /api/v1/prospects/funnel`, DOM-KAY-040, IST-117): adayın açılış
 * gününe göre kohort, birikimli adımlar, kaynak ve danışman kırılımı. Sayı ve oranlar sunucudan
 * gelir; ekran hesap yapmaz. Aralık `YYYY-MM-DD` (Europe/Istanbul günü, dahil); boş uç açıktır.
 */

export type EnrollmentFunnel = components['schemas']['EnrollmentFunnel']
export type EnrollmentFunnelRange = { dateFrom?: string; dateTo?: string }

export const enrollmentFunnelKey = (range: EnrollmentFunnelRange) =>
  ['prospects', 'funnel', range.dateFrom ?? '', range.dateTo ?? ''] as const

export function enrollmentFunnelRequest(
  client: KampusClient,
  range: EnrollmentFunnelRange,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/prospects/funnel', {
    params: {
      query: {
        ...(range.dateFrom ? { dateFrom: range.dateFrom } : {}),
        ...(range.dateTo ? { dateTo: range.dateTo } : {}),
      },
    },
    ...(signal ? { signal } : {}),
  })
}

export function useEnrollmentFunnel(
  range: EnrollmentFunnelRange,
  options: { enabled?: boolean } = {},
) {
  return useApiQuery({
    key: enrollmentFunnelKey(range),
    request: (client, signal) => enrollmentFunnelRequest(client, range, signal),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}
