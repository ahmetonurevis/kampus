import type { operations } from '@kampus/api-client/schema.d.ts'
import {
  healthAccessReasonHeaders,
  type HealthAccessReason,
} from '@kampus/school-core/lib/finance-health-access.ts'

import { useFinanceListQuery } from './use-finance-list-query.ts'

// Sağlık verisi okuma gerekçesi (DOM-FIN-156; ON-164; K-523…K-525). Sağlık ayrıntısı okuyan
// kancalar gerekçeyi `healthReasonHeaders` ile başlığa, `healthReasonKey` ile sorgu anahtarına
// koyar: farklı gerekçe yeni okuma (ve yeni denetim satırı) demektir. Gerekçe yokken sorgu çalışmaz.
// Erişim günlüğü (`useHealthAccessLogs`) yalnız yöneticidir ve sağlık değeri taşımaz.

export type { HealthAccessReason }

type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never
type Ok<TOperation extends keyof operations> = operations[TOperation]['responses'] extends {
  200: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type HealthAccessLogQuery = Query<'listHealthAccessLogs'>
export type HealthAccessLogRow = Ok<'listHealthAccessLogs'>['data'][number]

export const HEALTH_ACCESS_KEY = ['finance', 'health-access'] as const

/** Sorgu anahtarı parçası: gerekçe kodu ve açıklaması (gerekçe yoksa boş). */
export function healthReasonKey(reason: HealthAccessReason | null): readonly unknown[] {
  return reason === null ? [] : ['reason', reason.code, reason.note]
}

/**
 * Gerekçenin zorunlu olduğu okuma: sorgu `reason !== null` iken etkin olduğundan `null` buraya
 * ulaşmaz; ulaşırsa istek gönderilmez.
 */
export function healthReasonHeaders(reason: HealthAccessReason | null) {
  if (reason === null) throw new TypeError('Sağlık okuması gerekçesiz çağrıldı.')
  return healthAccessReasonHeaders(reason)
}

/** Velinin de okuduğu uç: gerekçe yoksa başlık gönderilmez. */
export function optionalHealthReasonHeaders(reason: HealthAccessReason | null) {
  return reason === null ? {} : healthAccessReasonHeaders(reason)
}

export function useHealthAccessLogs(query: HealthAccessLogQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...HEALTH_ACCESS_KEY, 'logs', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/health-access-logs', { params: { query }, signal }),
    },
    { enabled },
  )
}
