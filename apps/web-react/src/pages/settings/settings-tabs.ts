// Ayarlar sekme kaydının saf mantığı: rol ve modül süzmesi, sıra, adres anahtarı (`?sekme=`).
// Girdiler `settings-sections.tsx` içindedir; burada bileşen ve sayfa bilinmez.
import type { ModuleState, RoleKey } from '@/lib/navigation.ts'

type EntryBase<Component> = {
  /** Kalıcı kimlik; sekme ve bölüm kimlikleri tek kümededir. */
  id: string
  /** Girdiyi görecek roller. */
  roles: readonly RoleKey[]
  /** Kapalıysa girdinin gizleneceği modül anahtarı (yoksa her zaman açık). */
  module?: string
  /** Küçükten büyüğe; aynı sırada kayıt sırası korunur. */
  order: number
  component: Component
}

/** Kendi sekmesi olan girdi. `param` adres anahtarıdır (`?sekme=<param>`); boş değer adreste parametre yok demektir. */
export type SettingsTabEntry<Component> = EntryBase<Component> & {
  kind: 'tab'
  label: string
  param: string
}

/** Var olan bir sekmenin içinde, bileşeninin altında çizilen bölüm. */
export type SettingsSectionEntry<Component> = EntryBase<Component> & {
  kind: 'section'
  /** Bölümün çizileceği sekmenin kimliği. */
  tab: string
}

export type SettingsEntry<Component> = SettingsTabEntry<Component> | SettingsSectionEntry<Component>

/** Rol ve modül süzmesi (tek yer); sıralı döner, kayıt sırası eşitlikte korunur. */
export function visibleSettingsEntries<Component>(
  entries: readonly SettingsEntry<Component>[],
  role: RoleKey,
  modules: ModuleState,
): SettingsEntry<Component>[] {
  return entries
    .filter(
      (entry) => entry.roles.includes(role) && (!entry.module || modules[entry.module] === true),
    )
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.order - b.entry.order || a.index - b.index)
    .map(({ entry }) => entry)
}

export function settingsTabs<Component>(
  visible: readonly SettingsEntry<Component>[],
): SettingsTabEntry<Component>[] {
  return visible.filter((entry): entry is SettingsTabEntry<Component> => entry.kind === 'tab')
}

/** Sekmenin altında çizilecek bölümler; sekme görünmüyorsa bölümleri de çizilmez. */
export function settingsSectionsOf<Component>(
  visible: readonly SettingsEntry<Component>[],
  tabId: string,
): SettingsSectionEntry<Component>[] {
  return visible.filter(
    (entry): entry is SettingsSectionEntry<Component> =>
      entry.kind === 'section' && entry.tab === tabId,
  )
}

/** `?sekme=` değeri → sekme; bilinmeyen veya boş değer ilk görünür sekmeye düşer. */
export function resolveSettingsTab<Component>(
  tabs: readonly SettingsTabEntry<Component>[],
  param: string | null,
): SettingsTabEntry<Component> | undefined {
  return tabs.find((tab) => tab.param === (param ?? '')) ?? tabs[0]
}

/** Seçilen sekmenin adres parametreleri: ilk sekme parametresiz, ötekiler `sekme=<param>`. */
export function settingsTabSearch(
  tabs: readonly SettingsTabEntry<unknown>[],
  tab: SettingsTabEntry<unknown>,
): Record<string, string> {
  return tab === tabs[0] || tab.param === '' ? {} : { sekme: tab.param }
}

/** Kayıt hatalarını (yinelenen kimlik/adres anahtarı, var olmayan sekmeye bölüm) metin olarak döner. */
export function settingsRegistryErrors(entries: readonly SettingsEntry<unknown>[]): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  const params = new Set<string>()
  const tabIds = new Set(entries.filter((entry) => entry.kind === 'tab').map((entry) => entry.id))
  for (const entry of entries) {
    if (ids.has(entry.id)) errors.push(`Yinelenen kimlik: ${entry.id}`)
    ids.add(entry.id)
    if (entry.kind === 'tab') {
      if (params.has(entry.param)) errors.push(`Yinelenen adres anahtarı: "${entry.param}"`)
      params.add(entry.param)
    } else if (!tabIds.has(entry.tab)) {
      errors.push(`Bölüm ${entry.id}: sekme yok (${entry.tab})`)
    }
  }
  return errors
}
