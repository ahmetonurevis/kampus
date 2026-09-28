import React from 'react'
import { View } from 'react-native'
import { T } from './components.jsx'
import { TextAction } from './SchoolLayout.jsx'

export default function DraftStatus({ draft }) {
  if (!draft.status && draft.ready) return null
  return (
    <View style={{ gap: 4 }}>
      <T muted size={12} accessibilityLiveRegion="polite">
        {{
          restored: 'Kaydedilmemiş çalışman geri yüklendi.',
          saving: 'Taslak saklanıyor…',
          saved: 'Taslak bu cihazda saklandı.',
          error: 'Taslak kaydedilemedi.',
          'read-error': 'Kayıtlı taslak açılamadı.',
        }[draft.status] || 'Taslak kontrol ediliyor…'}
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
