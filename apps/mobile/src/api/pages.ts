// API modunda açılabilen ekranlar. Başlık, simge, kategori ve modül anahtarı ortak menüden
// (`school-core/modules/full-navigation.ts`) gelir; hangi rol + yolun hangi ekranla açılacağı ve
// telefona özgü kısa başlıklar ekran kaydındadır (`screen-registry.ts`). Kayıtta olmayan sayfa henüz
// taşınmamıştır.
import { navigation } from '@kampus/school-core/modules/full-navigation.ts'
import { categoryLabel } from '../model/hub.ts'
import {
  SCREEN_REGISTRY,
  type ApiScreen,
  type ScreenEntry,
  type ScreenPlacement,
} from './screen-registry.ts'
import { isModuleOpen, type MemberRole, type MobileSession } from './session-state.ts'

export type { ApiScreen }

/** Ekran kaydının adları, gezinme yığınındaki sabit ekranlarla çakışamaz (`ApiApp.tsx`). */
export const RESERVED_SCREENS: readonly string[] = ['ApiHome', 'ApiCategory', 'ApiConversation']

/** Öğrenci ödemeleri telefonda gösterilmez; bu modüldeki sayfa öğrenciye kaydedilmez. */
const STUDENT_HIDDEN_MODULE = 'finance'

/**
 * Kaydın kural ihlalleri (Türkçe, boş liste geçerli kayıt demektir): ekran adı tek ve ayrılmış
 * adlardan farklı; rol + yol tek ekrana bağlı; yol rolün ortak menüsünde; öğrenciye ödeme ekranı yok.
 */
export function screenRegistryIssues(entries: readonly ScreenEntry[]): string[] {
  const issues: string[] = []
  const screens = new Set<string>()
  const placements = new Map<string, string>()
  for (const entry of entries) {
    if (RESERVED_SCREENS.includes(entry.screen))
      issues.push(`${entry.screen}: ayrılmış ekran adı kullanılamaz`)
    if (screens.has(entry.screen)) issues.push(`${entry.screen}: ekran adı iki kez kaydedilmiş`)
    screens.add(entry.screen)
    if (!entry.pages.length) issues.push(`${entry.screen}: menü sayfası yok`)
    for (const placement of entry.pages) {
      const key = `${placement.role}/${placement.path}`
      const previous = placements.get(key)
      if (previous !== undefined)
        issues.push(`${key}: iki ekrana bağlanmış (${previous}, ${entry.screen})`)
      placements.set(key, entry.screen)
      const page = navigation[placement.role].find((item) => item.path === placement.path)
      if (!page) issues.push(`${key}: rolün menüsünde böyle bir sayfa yok`)
      else if (placement.role === 'ogrenci' && page.module === STUDENT_HIDDEN_MODULE)
        issues.push(`${key}: öğrenci ödemeleri telefonda gösterilmez`)
    }
  }
  return issues
}

type Placement = { screen: ApiScreen } & Pick<ScreenPlacement, 'title' | 'description'>

/** Rol → menü yolu → ekran; kayıttan bir kez kurulur. */
const PLACEMENTS = new Map<MemberRole, Map<string, Placement>>()
for (const entry of SCREEN_REGISTRY) {
  for (const placement of entry.pages as readonly ScreenPlacement[]) {
    const byPath = PLACEMENTS.get(placement.role) ?? new Map<string, Placement>()
    byPath.set(placement.path, {
      screen: entry.screen,
      title: placement.title,
      description: placement.description,
    })
    PLACEMENTS.set(placement.role, byPath)
  }
}

export type ApiPage = {
  path: string
  title: string
  icon: string
  description: string
  group: string
  screen: ApiScreen
}

/** Rolün taşınmış ve kurumda açık sayfaları (menü sırası korunur). */
export function apiPages(session: Pick<MobileSession, 'role' | 'modules'>): ApiPage[] {
  const placed = PLACEMENTS.get(session.role)
  return navigation[session.role].flatMap((page) => {
    const placement = placed?.get(page.path)
    if (!placement || !isModuleOpen(session.modules, page.module)) return []
    return [
      {
        path: page.path,
        title: placement.title ?? page.title,
        icon: page.icon,
        description: placement.description ?? page.description,
        group: page.group,
        screen: placement.screen,
      },
    ]
  })
}

export type ApiCategory = { key: string; label: string; icon: string; count: number }

const CATEGORY_ICONS: Record<string, string> = {
  AKADEMİK: 'GraduationCap',
  GELİŞİMİM: 'Award',
  DERSLERİM: 'School',
  İLETİŞİM: 'MessagesSquare',
}

/** Ana ekran kategori kartları: yalnız en az bir açık sayfası olan kategoriler. */
export function apiCategories(pages: readonly ApiPage[]): ApiCategory[] {
  const counts = new Map<string, number>()
  for (const page of pages) counts.set(page.group, (counts.get(page.group) ?? 0) + 1)
  return [...counts].map(([key, count]) => ({
    key,
    label: categoryLabel(key),
    icon: CATEGORY_ICONS[key] ?? 'LayoutGrid',
    count,
  }))
}

/** Ekran hâlâ açık mı (modül kapatıldıysa doğrudan erişim de kapanır). */
export function canOpenScreen(
  session: Pick<MobileSession, 'role' | 'modules'>,
  screen: ApiScreen,
): boolean {
  return apiPages(session).some((page) => page.screen === screen)
}
