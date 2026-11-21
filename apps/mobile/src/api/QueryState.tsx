import { View } from 'react-native'
import type { ApiError } from '@kampus/api-client/errors.ts'
import { isModuleDisabledError } from '@kampus/react-shared/collections.ts'
import { Button, Empty, T } from '../ui/components.tsx'
import { Notice } from '../ui/SchoolLayout.tsx'

/** Sorgu hatası: kapalı modül ayrı anlatılır; diğerlerinde sunucunun Türkçe mesajı ve yeniden dene. */
export function QueryError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  if (isModuleDisabledError(error))
    return (
      <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
    )
  return (
    <Notice title="Liste yüklenemedi" text={error.message} tone="red">
      <Button onPress={onRetry}>Yeniden dene</Button>
    </Notice>
  )
}

export function ListLoading({ label }: { label: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ paddingVertical: 12 }}
    >
      <T muted>{label}</T>
    </View>
  )
}
