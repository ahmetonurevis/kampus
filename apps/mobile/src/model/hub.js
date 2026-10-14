// Ana ekrandaki kategori kartları, kategori ekranındaki modül kartları ve hesap menüsü öğeleri.
import { availablePages } from './school.js'

// Başlığı role göre farklı gösterilen sayfalar.
const targetedTitles = {
  'ogrenci/odevler': 'Ödevler',
  'veli/finans': 'Ödeme planı',
  'ogretmen/sorular': 'Öğrenci soruları',
}
const categoryIcons = {
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

export const pageTitle = (role, page) => targetedTitles[`${role}/${page.path}`] || page.title
export const categoryLabel = (group) => group.charAt(0) + group.slice(1).toLocaleLowerCase('tr')

// Hesap menüsünde yer alan sayfalar kategori kartlarında tekrarlanmaz.
const isAccountPage = (page) => page.path === 'ayarlar' || page.group === 'HESABIM'
// Ana ekranın kendisi ve çocuk seçici (veli hesap menüsünde ve ana ekranda) kart olmaz.
const isHubPage = (page) =>
  page.path !== 'dashboard' && page.path !== 'cocuk-secici' && !isAccountPage(page)

export function accountPages(state, role) {
  return availablePages(state, role)
    .filter(isAccountPage)
    .map((page) => ({ ...page, title: pageTitle(role, page) }))
}
export function hubCategories(state, role) {
  const counts = new Map()
  for (const page of availablePages(state, role).filter(isHubPage))
    counts.set(page.group, (counts.get(page.group) || 0) + 1)
  return [...counts].map(([group, count]) => ({
    key: group,
    label: categoryLabel(group),
    icon: categoryIcons[group] || 'LayoutGrid',
    count,
  }))
}
export function categoryPages(state, role, category) {
  return availablePages(state, role)
    .filter((page) => isHubPage(page) && page.group === category)
    .map((page) => ({ ...page, title: pageTitle(role, page) }))
}
