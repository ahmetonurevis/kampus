import { useMemo } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { roles } from '@kampus/school-core/modules/navigation.ts'
import type { ApiScreenProps } from '../../route-types.ts'
import { Empty, T, useColors } from '../../ui/components.tsx'
import { ModuleCard, cardGrid } from '../../ui/ModuleHub.tsx'
import { Screen } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { apiCategories, apiPages } from '../pages.ts'

/** Rol ana ekranı: karşılama ve yalnız API'ye taşınmış, kurumda açık modüllerin kategorileri. */
export default function ApiHome({ navigation }: ApiScreenProps<'ApiHome'>) {
  const session = useApiSession()
  const c = useColors()
  const { fontScale } = useWindowDimensions()
  const categories = useMemo(() => apiCategories(apiPages(session)), [session])
  const firstName = session.user.name.split(' ')[0] || session.user.name
  return (
    <Screen>
      <View style={{ backgroundColor: c.hero, borderRadius: 24, padding: 20, gap: 6 }}>
        <T size={13} bold style={{ color: c.heroMuted }}>
          {roles[session.role].label.toLocaleUpperCase('tr')}
        </T>
        <T bold size={24} style={{ color: c.heroText, letterSpacing: -0.5 }}>
          Merhaba, {firstName}
        </T>
        <T size={14} style={{ color: c.heroMuted }}>
          {session.institution.name}
        </T>
      </View>
      {categories.length ? (
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
                onPress={() => navigation.navigate('ApiCategory', { category: category.key })}
              />
            ))}
          </View>
        </View>
      ) : (
        <Empty
          title="Bu rolün ekranları hazırlanıyor"
          text="Telefondaki modüller sunucuya bağlandıkça burada görünecek. Şimdilik web uygulamasını kullanabilirsin."
        />
      )}
    </Screen>
  )
}
