import React, { useMemo } from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { useSchool } from '../store/SchoolProvider.jsx'
import { hubCategories } from '../model/hub.ts'
import { Icon, T, useColors } from './components.jsx'
import { shape } from './theme.js'

// Modül kartının ortak görünümü: ikon kutusu, başlık ve isteğe bağlı açıklama.
export function ModuleCard({ icon, title, caption, accent = false, onPress, stacked = false }) {
  const c = useColors()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={caption ? `${title}, ${caption}` : title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexBasis: stacked ? '100%' : '47%',
        flexGrow: 1,
        minHeight: 124,
        padding: 14,
        gap: 10,
        borderRadius: shape.card,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: accent ? c.accentSoft : c.primarySoft,
        }}
      >
        <Icon name={icon} size={22} color={accent ? c.accentText : c.primary} />
      </View>
      <View style={{ gap: 2 }}>
        <T bold size={15} numberOfLines={2}>
          {title}
        </T>
        {!!caption && (
          <T muted size={12} numberOfLines={2}>
            {caption}
          </T>
        )}
      </View>
    </Pressable>
  )
}
export const cardGrid = { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }

// Ana ekranın ilk bölümü: kategoriler kart olarak gelir, dokununca kategori ekranı açılır.
export default function ModuleHub({ navigation }) {
  const { data, session } = useSchool(),
    { fontScale } = useWindowDimensions()
  const categories = useMemo(() => hubCategories(data, session.role), [data, session.role])
  return (
    <View style={{ gap: 14 }}>
      <T bold size={18} style={{ letterSpacing: -0.3 }}>
        Modüller
      </T>
      <View accessibilityRole="list" style={cardGrid}>
        {categories.map((category, index) => (
          <ModuleCard
            key={category.key}
            icon={category.icon}
            title={category.label}
            caption={`${category.count} modül`}
            accent={(Math.floor(index / 2) + index) % 2 === 1}
            stacked={fontScale > 1.3}
            onPress={() => navigation.navigate('Category', { category: category.key })}
          />
        ))}
      </View>
    </View>
  )
}
