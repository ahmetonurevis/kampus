import { useMemo } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { categoryLabel } from '../../model/hub.ts'
import type { ApiScreenProps } from '../../route-types.ts'
import { Empty, Heading } from '../../ui/components.tsx'
import { ModuleCard, cardGrid } from '../../ui/ModuleHub.tsx'
import { Screen } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { apiPages } from '../pages.ts'

/** Kategorinin API'li modülleri kart olarak listelenir. */
export default function ApiCategory({ route, navigation }: ApiScreenProps<'ApiCategory'>) {
  const session = useApiSession()
  const { fontScale } = useWindowDimensions()
  const { category } = route.params
  const pages = useMemo(
    () => apiPages(session).filter((page) => page.group === category),
    [session, category],
  )
  return (
    <Screen>
      <Heading
        title={categoryLabel(category)}
        subtitle={pages.length ? `${pages.length} modül` : undefined}
      />
      {pages.length ? (
        <View accessibilityRole="list" style={cardGrid}>
          {pages.map((page, index) => (
            <ModuleCard
              key={page.path}
              icon={page.icon}
              title={page.title}
              caption={page.description}
              accent={(Math.floor(index / 2) + index) % 2 === 1}
              stacked={fontScale > 1.3}
              onPress={() => navigation.push(page.screen)}
            />
          ))}
        </View>
      ) : (
        <Empty
          title="Bu kategoride modül yok"
          text="Yönetici modül ayarlarını değiştirdiğinde burada görünür."
        />
      )}
    </Screen>
  )
}
