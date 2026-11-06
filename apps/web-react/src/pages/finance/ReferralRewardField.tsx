import type { ComponentProps } from 'react'
import type { FieldError } from 'react-hook-form'
import {
  useReferralRewards,
  type ReferralRewardsQuery,
} from '@kampus/react-shared/use-finance-referrals.ts'
import { FormField } from '@/components/FormField.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { referralOptionLabel } from './referral-forms.ts'

/**
 * Sözleşmede kullanılacak referans hakkı (DOM-FIN-024). Yalnız `referral` indirimi seçiliyken
 * gösterilir; ailenin kullanılabilir hakları listelenir, tavanı aşan kısım sunucuda düşer.
 */
export function ReferralRewardField({
  id,
  query,
  error,
  disabled,
  register,
}: {
  id: string
  /** Hak sahibi süzgeci: kesin kayıtta veli, yenilemede öğrencinin velisi. Boşsa seçenek yoktur. */
  query: Pick<ReferralRewardsQuery, 'parentId' | 'familyOfStudentId'> | null
  error: FieldError | undefined
  disabled?: boolean
  register: Omit<ComponentProps<typeof NativeSelect>, 'children'>
}) {
  const rewards = useReferralRewards(
    { ...query, status: 'available', pageSize: 100 },
    { enabled: query !== null },
  )
  const items = query === null ? [] : (rewards.data?.data ?? [])
  return (
    <FormField
      id={id}
      label="Referans hakkı"
      description="Hak bir kez kullanılır. İndirim tavanını aşan kısmı düşer, sonraki sözleşmeye devretmez."
      error={error}
    >
      {(control) => (
        <NativeSelect {...control} {...register} className="w-full" disabled={disabled}>
          <NativeSelectOption value="">
            {items.length > 0 ? 'Hak seçin' : 'Kullanılabilir referans hakkı yok'}
          </NativeSelectOption>
          {items.map((reward) => (
            <NativeSelectOption key={reward.id} value={reward.id}>
              {referralOptionLabel(reward)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}
