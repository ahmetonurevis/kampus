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

/** Hak sahibi süzgeci: kesin kayıtta veli, yenilemede öğrencinin velisi. */
export type ReferralRewardOwnerQuery = Pick<ReferralRewardsQuery, 'parentId' | 'familyOfStudentId'>

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

/**
 * Ailenin kullanılabilir hakları: form alanı ve önizleme aynı sorguyu paylaşır, önizleme seçili hakkın
 * sabit tutarını buradan okur (DOM-FIN-024). Sahip yoksa sorgu atılmaz.
 */
export function useAvailableReferralRewards(owner: ReferralRewardOwnerQuery | null) {
  const rewards = useReferralRewards(
    { ...owner, status: 'available', pageSize: 100 },
    { enabled: owner !== null },
  )
  return { items: owner === null ? [] : (rewards.data?.data ?? []) }
}
