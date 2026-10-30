import React, { useMemo } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { useSchool } from '../store/SchoolProvider.tsx'
import { categoryLabel, categoryPages } from '../model/hub.ts'
import { Empty, Heading } from '../ui/components.jsx'
import { Screen } from '../ui/SchoolLayout.jsx'
import { ModuleCard, cardGrid } from '../ui/ModuleHub.jsx'

// Seçilen kategorinin modülleri kart olarak listelenir.
export default function CategoryScreen({ route, navigation }) {
  const { data, session } = useSchool(),
    { fontScale } = useWindowDimensions()
  const category = route.params.category
  const pages = useMemo(
    () => categoryPages(data, session.role, category),
    [data, session.role, category],
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
              onPress={() => navigation.push('Module', { page: page.path })}
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
