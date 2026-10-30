// API modunda açılabilen ekranlar. Başlık, simge, kategori ve modül anahtarı ortak menüden
// (`school-core/modules/full-navigation.ts`) gelir; listede olmayan sayfa henüz taşınmamıştır.
import { navigation } from '@kampus/school-core/modules/full-navigation.ts'
import { categoryLabel } from '../model/hub.ts'
import { isModuleOpen, type MemberRole, type MobileSession } from './session-state.ts'

/**
 * API'ye taşınmış modül ekranları (gezinme yığınında parametresiz). Gezinme tipleri bu
 * birleşimden türer (`route-types.ts`); bu dosya React Navigation tiplerine bağlı kalmaz.
 */
export type ApiScreen = 'TeacherClasses' | 'ParentGrades'

/** Rol + sayfa yolu → API'li ekran. Demo ekranlarının API karşılıkları buraya eklenir. */
const MIGRATED: Partial<Record<MemberRole, Partial<Record<string, ApiScreen>>>> = {
  ogretmen: { siniflarim: 'TeacherClasses' },
  veli: { 'akademik-takip': 'ParentGrades' },
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
  const migrated = MIGRATED[session.role] ?? {}
  return navigation[session.role].flatMap((page) => {
    const screen = migrated[page.path]
    if (!screen || !isModuleOpen(session.modules, page.module)) return []
    return [
      {
        path: page.path,
        title: page.title,
        icon: page.icon,
        description: page.description,
        group: page.group,
        screen,
      },
    ]
  })
}

export type ApiCategory = { key: string; label: string; icon: string; count: number }

const CATEGORY_ICONS: Record<string, string> = {
  AKADEMİK: 'GraduationCap',
  GELİŞİMİM: 'Award',
  DERSLERİM: 'School',
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
