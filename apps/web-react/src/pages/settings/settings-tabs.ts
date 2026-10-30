// Ayarlar sekmeleri ve adres parametresi (saf).
export const SETTINGS_TABS = {
  general: { label: 'Kurum & Modüller', param: '' },
  users: { label: 'Kullanıcı & Yetkiler', param: 'kullanicilar' },
  activity: { label: 'İşlem Geçmişi', param: 'gecmis' },
} as const

export type SettingsTab = keyof typeof SETTINGS_TABS

/** `?sekme=` değeri → sekme; bilinmeyen veya boş değer ilk sekmeye düşer. */
export function settingsTab(param: string | null): SettingsTab {
  if (param === SETTINGS_TABS.users.param) return 'users'
  if (param === SETTINGS_TABS.activity.param) return 'activity'
  return 'general'
}
