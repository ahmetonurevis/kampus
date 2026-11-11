import { useMemo, type ComponentType } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { LineTabs } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { SETTINGS_SECTIONS } from './settings-sections.tsx'
import {
  resolveSettingsTab,
  settingsSectionsOf,
  settingsTabs,
  settingsTabSearch,
  type SettingsEntry,
  type SettingsTabEntry,
  visibleSettingsEntries,
} from './settings-tabs.ts'

/**
 * Ayarlar (yönetici; Vue `Settings.vue`): sekmeler `settings-sections.tsx` kaydından çizilir
 * (şimdilik "Kurum & Modüller", "Kullanıcı & Yetkiler", "Eğitim yılı" ve "İşlem Geçmişi"). Sekme adreste
 * `?sekme=` ile tutulur (yoksa ilk sekme); sekme değişince öteki sekmenin liste ve panel
 * parametreleri adresten silinir. Diğer roller bu sayfaya bağlı değildir (kayıt
 * `page-registry.tsx`; onlar için `PersonalSettingsPage`).
 */
export function SettingsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const [params, setParams] = useSearchParams()
  const visible = useMemo(
    () => (session ? visibleSettingsEntries(SETTINGS_SECTIONS, session.role, session.modules) : []),
    [session],
  )
  const tabs = settingsTabs(visible)
  const tab = resolveSettingsTab(tabs, params.get('sekme'))

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="grid gap-6">
        <LineTabs
          label="Kurum ayarları"
          value={tab?.id ?? ''}
          options={tabs.map((item) => ({ value: item.id, label: item.label }))}
          onChange={(id) => {
            const next = tabs.find((item) => item.id === id)
            if (next) setParams(settingsTabSearch(tabs, next))
          }}
        />
        {tab ? <TabBody tab={tab} visible={visible} /> : null}
      </div>
    </>
  )
}

function TabBody({
  tab,
  visible,
}: {
  tab: SettingsTabEntry<ComponentType>
  visible: SettingsEntry<ComponentType>[]
}) {
  const Body = tab.component
  return (
    <>
      <Body />
      {settingsSectionsOf(visible, tab.id).map((section) => {
        const Section = section.component
        return <Section key={section.id} />
      })}
    </>
  )
}
