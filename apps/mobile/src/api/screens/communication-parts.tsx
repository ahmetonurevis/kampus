import { View } from 'react-native'
import { T, toneSoft, useColors } from '../../ui/components.tsx'
import type { StatusBadge } from '@kampus/react-shared/status-badge.ts'

/** Durum rozeti: renk metinle birlikte anlam taşır (renge tek başına dayanılmaz). */
export function ToneBadge({ text, tone }: StatusBadge) {
  const c = useColors()
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: toneSoft(c, tone),
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
      }}
    >
      <T size={12} bold style={{ color: c[tone] }}>
        {text}
      </T>
    </View>
  )
}

export function BadgeRow({ badges }: { badges: readonly StatusBadge[] }) {
  if (badges.length === 0) return null
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {badges.map((badge) => (
        <ToneBadge key={badge.text} {...badge} />
      ))}
    </View>
  )
}
