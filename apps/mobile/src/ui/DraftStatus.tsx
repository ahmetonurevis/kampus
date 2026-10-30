import { View } from 'react-native'
import type { DraftStatus as DraftStatusCode } from '../store/use-persistent-draft.ts'
import { T } from './components.tsx'
import { TextAction } from './SchoolLayout.tsx'

type DraftStatusProps = {
  draft: {
    status: DraftStatusCode
    ready: boolean
    retry: () => void
    clear: () => Promise<boolean>
  }
}
const messages: Partial<Record<DraftStatusCode, string>> = {
  restored: 'Kaydedilmemiş çalışman geri yüklendi.',
  saving: 'Taslak saklanıyor…',
  saved: 'Taslak bu cihazda saklandı.',
  error: 'Taslak kaydedilemedi.',
  'read-error': 'Kayıtlı taslak açılamadı.',
}

export default function DraftStatus({ draft }: DraftStatusProps) {
  if (!draft.status && draft.ready) return null
  return (
    <View style={{ gap: 4 }}>
      <T muted size={12} accessibilityLiveRegion="polite">
        {messages[draft.status] || 'Taslak kontrol ediliyor…'}
      </T>
      {draft.status === 'error' && (
        <TextAction onPress={draft.retry}>Taslağı yeniden kaydet</TextAction>
      )}
      {draft.status === 'read-error' && (
        <TextAction onPress={() => draft.clear()}>Okunamayan taslağı temizle</TextAction>
      )}
    </View>
  )
}
