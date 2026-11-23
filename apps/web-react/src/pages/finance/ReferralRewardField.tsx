import type { ComponentProps } from 'react'
import type { FieldError } from 'react-hook-form'
import {
  useAvailableReferralRewards,
  type ReferralRewardOwnerQuery,
} from '@kampus/react-shared/use-finance-referrals.ts'
import { FormField } from '@/components/FormField.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { referralOptionLabel } from './referral-forms.ts'

/**
 * Sözleşmede kullanılacak referans hakkı (DOM-FIN-024). Yalnız `referral` indirimi seçiliyken
 * gösterilir; ailenin kullanılabilir hakları sabit değerleriyle listelenir, tavanı aşan kısım
 * sunucuda düşer.
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
  query: ReferralRewardOwnerQuery | null
  error: FieldError | undefined
  disabled?: boolean
  register: Omit<ComponentProps<typeof NativeSelect>, 'children'>
}) {
  const { items } = useAvailableReferralRewards(query)
  const learner = useEnrollmentLearner()
  return (
    <FormField
      id={id}
      label="Referans hakkı"
      description="Hakkın değeri kayıt anında sabitlenmiştir ve bir kez kullanılır. İndirim tavanını aşan kısmı düşer, sonraki sözleşmeye devretmez."
      error={error}
    >
      {(control) => (
        <NativeSelect {...control} {...register} className="w-full" disabled={disabled}>
          <NativeSelectOption value="">
            {items.length > 0 ? 'Hak seçin' : 'Kullanılabilir referans hakkı yok'}
          </NativeSelectOption>
          {items.map((reward) => (
            <NativeSelectOption key={reward.id} value={reward.id}>
              {referralOptionLabel(reward, learner.title)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}
