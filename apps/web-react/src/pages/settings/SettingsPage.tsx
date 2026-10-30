import { LineTabs } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { ModuleSettingsSection } from './ModuleSettingsSection.tsx'

/**
 * Ayarlar (yalnız yönetici; Vue `Settings.vue`). Bugün yalnız "Kurum & Modüller" taşındı.
 * TODO(ayarlar-sekmeleri): "Kullanıcı & Yetkiler" ve "İşlem Geçmişi" sekmeleri kendi API
 * uçlarıyla eklenir. Diğer roller bu sayfaya bağlı değildir (kayıt `page-registry.tsx`).
 */
export function SettingsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="grid gap-6">
        <LineTabs
          label="Kurum ayarları"
          value="general"
          options={[{ value: 'general', label: 'Kurum & Modüller' }]}
          onChange={() => undefined}
        />
        <ModuleSettingsSection />
      </div>
    </>
  )
}
