import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiQuery } from './use-api-query.ts'

// Referans indirimi hakkı kancası (`/finance/referral-rewards`; DOM-FIN-024). Yazma ucu yoktur: hak
// kesin kayıtta açılır, tahsilatta doğar, kesin kayıt ya da yenilemede `referralRewardId` ile
// kullanılır; o komutlar bu anahtarı tazeler.

export const REFERRAL_REWARDS_KEY = ['referral-rewards']

export type ReferralRewardsQuery = NonNullable<
  operations['listReferralRewards']['parameters']['query']
>
export type ReferralReward =
  operations['listReferralRewards']['responses'][200]['content']['application/json']['data'][number]

export function useReferralRewards(
  query: ReferralRewardsQuery = {},
  options: { enabled?: boolean } = {},
) {
  return useApiQuery({
    key: [...REFERRAL_REWARDS_KEY, query],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/referral-rewards', { params: { query }, signal }),
  })
}
