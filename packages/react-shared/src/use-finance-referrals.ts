import type { operations } from '@kampus/api-client/schema.d.ts'

import { useFinanceListQuery, type FinanceListQueryOptions } from './use-finance-list-query.ts'

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
  options: FinanceListQueryOptions = {},
) {
  return useFinanceListQuery(
    {
      key: [...REFERRAL_REWARDS_KEY, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/referral-rewards', { params: { query }, signal }),
    },
    options,
  )
}

/**
 * Ailenin kullanılabilir hakları: form alanı ve önizleme aynı sorguyu paylaşır, önizleme seçili hakkın
 * sabit tutarını buradan okur (DOM-FIN-024). Sahip yoksa sorgu atılmaz.
 */
export function useAvailableReferralRewards(owner: ReferralRewardOwnerQuery | null) {
  const rewards = useReferralRewards(
    { ...owner, status: 'available', pageSize: 100 },
    // Hak önizlemede tutar kaynağıdır: başka ailenin hakkı yer tutucu olarak gösterilmez.
    { enabled: owner !== null, keepPreviousPage: false },
  )
  return { items: owner === null ? [] : (rewards.data?.data ?? []) }
}
