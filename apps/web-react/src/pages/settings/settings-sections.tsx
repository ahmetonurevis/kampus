// Ayarlar sekme kaydı: rol + modül → sekme ya da sekme içi bölüm. İki kaynak birleşir: Oğuzhan'ın
// girdileri aşağıdaki ilk dizi, kayıt ve finans girdileri `// Onur: kayıt ve finans` bloğudur.
// Süzme, sıra ve adres anahtarı mantığı `settings-tabs.ts` içindedir; sayfa `SettingsPage.tsx`.
// Yeni sekme/bölüm eklemek için `docs/sayfalar/platform.md` "Ayar sekmesi ekleme".
import type { ComponentType } from 'react'
import { AuditSection } from './AuditSection.tsx'
import { ModuleSettingsSection } from './ModuleSettingsSection.tsx'
import { UsersSection } from './UsersSection.tsx'
import type { SettingsEntry } from './settings-tabs.ts'

// Onur: kayıt ve finans
import { PaymentSettingsSection } from './PaymentSettingsSection.tsx'

const ONUR_SETTINGS_SECTIONS: readonly SettingsEntry<ComponentType>[] = [
  // Nakit tahsilat ve banka hesapları "Kurum & Modüller" sekmesinin altındadır (ON-033'te kendi
  // sekmesine taşınabilir: `kind: 'tab'`, `label` ve `param` verilir).
  {
    kind: 'section',
    id: 'payment',
    tab: 'general',
    roles: ['yonetici'],
    module: 'finance',
    order: 100,
    component: PaymentSettingsSection,
  },
]
// Onur: kayıt ve finans sonu

const PLATFORM_SETTINGS_SECTIONS: readonly SettingsEntry<ComponentType>[] = [
  {
    kind: 'tab',
    id: 'general',
    label: 'Kurum & Modüller',
    param: '',
    roles: ['yonetici'],
    order: 10,
    component: ModuleSettingsSection,
  },
  {
    kind: 'tab',
    id: 'users',
    label: 'Kullanıcı & Yetkiler',
    param: 'kullanicilar',
    roles: ['yonetici'],
    order: 20,
    component: UsersSection,
  },
  {
    kind: 'tab',
    id: 'activity',
    label: 'İşlem Geçmişi',
    param: 'gecmis',
    roles: ['yonetici'],
    order: 30,
    component: AuditSection,
  },
]

export const SETTINGS_SECTIONS: readonly SettingsEntry<ComponentType>[] = [
  ...PLATFORM_SETTINGS_SECTIONS,
  ...ONUR_SETTINGS_SECTIONS,
]
