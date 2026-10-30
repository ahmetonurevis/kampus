import { useSearchParams } from 'react-router'
import { LineTabs } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { AuditSection } from './AuditSection.tsx'
import { ModuleSettingsSection } from './ModuleSettingsSection.tsx'
import { SETTINGS_TABS, settingsTab, type SettingsTab } from './settings-tabs.ts'
import { UsersSection } from './UsersSection.tsx'

/**
 * Ayarlar (yalnız yönetici; Vue `Settings.vue`): "Kurum & Modüller", "Kullanıcı & Yetkiler" ve
 * "İşlem Geçmişi". Sekme adreste `?sekme=` ile tutulur (yoksa Kurum & Modüller); sekme
 * değişince öteki sekmenin liste ve panel parametreleri adresten silinir. Diğer roller bu
 * sayfaya bağlı değildir (kayıt `page-registry.tsx`; onlar için `PersonalSettingsPage`).
 */
export function SettingsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const [params, setParams] = useSearchParams()
  const tab = settingsTab(params.get('sekme'))

  function select(next: SettingsTab) {
    setParams(next === 'general' ? new URLSearchParams() : { sekme: SETTINGS_TABS[next].param })
  }

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="grid gap-6">
        <LineTabs
          label="Kurum ayarları"
          value={tab}
          options={Object.entries(SETTINGS_TABS).map(([value, item]) => ({
            value: value as SettingsTab,
            label: item.label,
          }))}
          onChange={select}
        />
        {tab === 'general' ? <ModuleSettingsSection /> : null}
        {tab === 'users' ? <UsersSection /> : null}
        {tab === 'activity' ? <AuditSection /> : null}
      </div>
    </>
  )
}
