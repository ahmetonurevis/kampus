// Kategorili menü: kaynak school-core modül kaydı ve tam navigasyon (web ve mobil ortak).
import {
  navigation,
  roles,
  type NavigationPage,
} from '@kampus/school-core/modules/full-navigation.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'

export type NavPage = NavigationPage
export type RoleInfo = (typeof roles)[RoleKey]
export type NavGroup = { key: string; label: string; pages: NavPage[] }
export type ModuleState = Readonly<Record<string, boolean | undefined>>

export const ROLE_KEYS = [
  'yonetici',
  'onburo',
  'ogretmen',
  'ogrenci',
  'veli',
] as const satisfies readonly Role[]
export type RoleKey = Role

export const ACCOUNT_GROUP = 'HESABIM'
export const DEFAULT_GROUP = 'GENEL'

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value)
}

export function getRole(role: RoleKey): RoleInfo {
  return roles[role]
}

export function rolePages(role: RoleKey): readonly NavPage[] {
  return navigation[role]
}

/** Modülü kapalı sayfalar menüden ve doğrudan erişimden düşer. */
export function isPageEnabled(page: NavPage, modules: ModuleState): boolean {
  return !page.module || modules[page.module] === true
}

export function visiblePages(role: RoleKey, modules: ModuleState): NavPage[] {
  return rolePages(role).filter((page) => isPageEnabled(page, modules))
}

/** Hesap sayfaları sidebar'da değil, sağ üstteki isim/avatar menüsünde gösterilir. */
export function isAccountPage(page: NavPage): boolean {
  return page.group === ACCOUNT_GROUP
}

export function accountPages(role: RoleKey, modules: ModuleState): NavPage[] {
  return visiblePages(role, modules).filter(isAccountPage)
}

export function groupLabel(group: string): string {
  return group.charAt(0).toLocaleUpperCase('tr') + group.slice(1).toLocaleLowerCase('tr')
}

/** Sidebar grupları: kayıt sırası korunur, kapalı modüller ve boş kategoriler gizlenir. */
export function sidebarGroups(role: RoleKey, modules: ModuleState): NavGroup[] {
  const groups = new Map<string, NavPage[]>()
  for (const page of visiblePages(role, modules)) {
    if (isAccountPage(page)) continue
    const list = groups.get(page.group)
    if (list) list.push(page)
    else groups.set(page.group, [page])
  }
  return [...groups].map(([key, pages]) => ({ key, label: groupLabel(key), pages }))
}

export function findPage(role: RoleKey, path: string): NavPage | undefined {
  return rolePages(role).find((page) => page.path === path)
}

export function pageHref(role: RoleKey, page: Pick<NavPage, 'path'>): string {
  return `/${role}/${page.path}`
}

/** Bütün rollerin navigasyonundaki modül anahtarları (kapalı/açık durumu için). */
export function moduleKeys(): string[] {
  const keys = new Set<string>()
  for (const role of ROLE_KEYS)
    for (const page of rolePages(role)) if (page.module) keys.add(page.module)
  return [...keys]
}

export type GroupState = Readonly<Record<string, boolean>>

/** Grup açık mı: kayıtlı tercih yoksa yalnız GENEL açıktır (Vue ile aynı). */
/** Kayıtlı tercih yoksa GENEL ve etkin sayfayı içeren grup açık başlar. */
export function isGroupExpanded(
  expanded: GroupState,
  role: RoleKey,
  group: string,
  containsActivePage = false,
): boolean {
  return expanded[`${role}:${group}`] ?? (group === DEFAULT_GROUP || containsActivePage)
}

export function setGroupExpanded(
  expanded: GroupState,
  role: RoleKey,
  group: string,
  open: boolean,
): GroupState {
  const key = `${role}:${group}`
  return expanded[key] === open ? expanded : { ...expanded, [key]: open }
}
