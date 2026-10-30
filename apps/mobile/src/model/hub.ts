// Ana ekrandaki kategori kartları, kategori ekranındaki modül kartları ve hesap menüsü öğeleri.
import type { State } from '@kampus/school-core/data/seed.ts'
import type { NavigationPage } from '@kampus/school-core/modules/full-navigation.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'
import { availablePages } from './school.ts'

// Başlığı role göre farklı gösterilen sayfalar.
const targetedTitles: Record<string, string> = {
  'ogrenci/odevler': 'Ödevler',
  'veli/finans': 'Ödeme planı',
  'ogretmen/sorular': 'Öğrenci soruları',
}
const categoryIcons: Record<string, string> = {
  DERSLERİM: 'School',
  GELİŞİMİM: 'Award',
  AKADEMİK: 'GraduationCap',
  ÖĞRENME: 'NotebookPen',
  İLETİŞİM: 'MessagesSquare',
  FİNANS: 'Wallet',
  YÖNETİM: 'Building2',
  RAPORLAR: 'ChartNoAxesCombined',
  'KAYIT & SATIŞ': 'UserRoundPlus',
  'OKUL İŞ AKIŞLARI': 'ClipboardCheck',
  'OKUL YAŞAMI': 'UsersRound',
}

export const pageTitle = (role: Role, page: NavigationPage) =>
  targetedTitles[`${role}/${page.path}`] || page.title
export const categoryLabel = (group: string) =>
  group.charAt(0) + group.slice(1).toLocaleLowerCase('tr')

// Hesap menüsünde yer alan sayfalar kategori kartlarında tekrarlanmaz.
const isAccountPage = (page: NavigationPage) => page.path === 'ayarlar' || page.group === 'HESABIM'
// Ana ekranın kendisi ve çocuk seçici (veli hesap menüsünde ve ana ekranda) kart olmaz.
const isHubPage = (page: NavigationPage) =>
  page.path !== 'dashboard' && page.path !== 'cocuk-secici' && !isAccountPage(page)

export function accountPages(state: State, role: Role) {
  return availablePages(state, role)
    .filter(isAccountPage)
    .map((page) => ({ ...page, title: pageTitle(role, page) }))
}
export function hubCategories(state: State, role: Role) {
  const counts = new Map<string, number>()
  for (const page of availablePages(state, role).filter(isHubPage))
    counts.set(page.group, (counts.get(page.group) || 0) + 1)
  return [...counts].map(([group, count]) => ({
    key: group,
    label: categoryLabel(group),
    icon: categoryIcons[group] || 'LayoutGrid',
    count,
  }))
}
export function categoryPages(state: State, role: Role, category: string) {
  return availablePages(state, role)
    .filter((page) => isHubPage(page) && page.group === category)
    .map((page) => ({ ...page, title: pageTitle(role, page) }))
}
