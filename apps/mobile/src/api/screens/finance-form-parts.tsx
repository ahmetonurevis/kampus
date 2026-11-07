import { useQueryClient } from '@tanstack/react-query'
import { Pressable } from 'react-native'
import { collectionKeyPrefix } from '@kampus/react-shared/collections.ts'
import { invalidateInstitutionQueries } from '@kampus/react-shared/commands.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { recordError } from '../../lib/error-log.ts'
import { Icon, T, useColors } from '../../ui/components.tsx'
import { Notice } from '../../ui/SchoolLayout.tsx'

/** Alanı olmayan bileşenin (seçim, tarih) sunucu ya da doğrulama hatası. */
export function FieldError({ text }: { text: string | undefined }) {
  return text ? <Notice tone="red" title={text} /> : null
}

/** En az 48 dp işaret kutusu; ekran okuyucuya işaretli durumu bildirir. */
export function CheckRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  const c = useColors()
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={{
        flexDirection: 'row',
        gap: 12,
        padding: 14,
        borderRadius: 12,
        minHeight: 48,
        alignItems: 'center',
        backgroundColor: checked ? c.primarySoft : c.soft,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Icon name={checked ? 'SquareCheck' : 'Square'} color={c.primary} />
      <T style={{ flex: 1 }}>{label}</T>
    </Pressable>
  )
}

/**
 * Sonucu belirsiz kalan tahsilat komutundan çıkarken liste ve toplamlar sunucudan yeniden okunur:
 * istek işlenmiş olabilir, ekran eski tutarı göstermemeli. Komut kancası bunu yalnız 409'da yapar.
 */
export function useFinanceRefresh() {
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()
  return () => {
    invalidateInstitutionQueries(queryClient, institutionId, [
      collectionKeyPrefix('invoices'),
      ['payments'],
    ]).catch((error: unknown) => recordError(error, 'finance-refresh', 'warn'))
  }
}
