import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Saat ücretli öğretmen ders saati hakediş dökümü kancaları (`/finance/hourly-lesson-payouts`,
// `/finance/my-hourly-lesson-payouts`; DOM-FIN-167, ON-075). Döküm ücret tanımından tutar taşır;
// anahtar ücret tanımı anahtarının altındadır, ücret yazıları dökümü de tazeler. Yönetici ekran
// okuması denetime düşer; CSV taze oturum ister ve sorgu tazelemez.

export type HourlyLessonPayouts =
  operations['getHourlyLessonPayouts']['responses'][200]['content']['application/json']['data']
export type HourlyLessonPayoutTeacher = HourlyLessonPayouts['teachers'][number]
export type HourlyLessonPayoutDetail =
  operations['getHourlyLessonPayoutDetail']['responses'][200]['content']['application/json']['data']
export type HourlyLessonPayoutLine = HourlyLessonPayoutDetail['days'][number]['lines'][number]
export type OwnHourlyLessonPayout =
  operations['getOwnHourlyLessonPayout']['responses'][200]['content']['application/json']['data']

/** Ücret tanımı anahtarıyla başlar (`use-finance-pay-rates.ts` `PAY_RATES_KEY`). */
export const HOURLY_PAYOUTS_KEY = ['finance', 'pay-rates', 'hourly-lesson-payouts'] as const

/** Ayın dökümü (yönetici); ay geçersizken (`null`) istek atılmaz. */
export function useHourlyLessonPayouts(month: string | null) {
  return useApiQuery({
    key: [...HOURLY_PAYOUTS_KEY, month],
    enabled: month !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/hourly-lesson-payouts/{month}', {
        params: { path: { month: month ?? '' } },
        signal,
      }),
  })
}

/** Öğretmenin gün gün dökümü (yönetici). */
export function useHourlyLessonPayoutDetail(month: string, membershipId: string | null) {
  return useApiQuery({
    key: [...HOURLY_PAYOUTS_KEY, month, 'teacher', membershipId],
    enabled: membershipId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/hourly-lesson-payouts/{month}/teachers/{membershipId}', {
        params: { path: { month, membershipId: membershipId ?? '' } },
        signal,
      }),
  })
}

/** Oturumdaki personelin dökümü; dökümü yoksa `payout: null`. */
export function useOwnHourlyLessonPayout(month: string | null) {
  return useApiQuery({
    key: [...HOURLY_PAYOUTS_KEY, 'own', month],
    enabled: month !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/my-hourly-lesson-payouts/{month}', {
        params: { path: { month: month ?? '' } },
        signal,
      }),
  })
}

/** CSV kapsamı: ayın bütünü, bir öğretmen ya da oturumdaki personel. */
export type HourlyPayoutCsvScope =
  { month: string } | { month: string; membershipId: string } | { month: string; own: true }

/** CSV (`Accept: text/csv`); taze oturum ister, denetime düşer. */
export function useHourlyLessonPayoutExport() {
  return useApiCommand({
    request: (client, scope: HourlyPayoutCsvScope) => {
      const options = { headers: { accept: 'text/csv' }, parseAs: 'text' as const }
      if ('own' in scope)
        return client.GET('/api/v1/finance/my-hourly-lesson-payouts/{month}', {
          params: { path: { month: scope.month } },
          ...options,
        })
      if ('membershipId' in scope)
        return client.GET('/api/v1/finance/hourly-lesson-payouts/{month}/teachers/{membershipId}', {
          params: { path: { month: scope.month, membershipId: scope.membershipId } },
          ...options,
        })
      return client.GET('/api/v1/finance/hourly-lesson-payouts/{month}', {
        params: { path: { month: scope.month } },
        ...options,
      })
    },
    invalidates: [],
  })
}
