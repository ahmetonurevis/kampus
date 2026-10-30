import { navigation as baseNavigation, type Role } from './navigation.ts'
import { schoolModules } from './school-workflows.ts'

export { roles } from './navigation.ts'

const SCHOOL_LIFE_MODULES = ['transport', 'meals', 'clubs', 'calendar']

// Temel sayfalara okul iş akışı modüllerini ve API'li yüzeylerin iletişim sayfalarını ekler; web ve
// mobil aynı menüyü paylaşır.
// `apiOnly`: sayfa yalnız API'li yüzeylerde (yeni web, mobil) vardır; Vue demosunun karşılığı
// olmadığı için demo rotası ve menüsü `apiOnly` sayfaları düşürür (`apps/web/src/modules/navigation.js`).
export type NavigationPage = (typeof baseNavigation)[Role][number] & { apiOnly?: true }

const communicationPage = (
  path: string,
  title: string,
  icon: string,
  description: string,
): NavigationPage => ({
  path,
  title,
  icon,
  module: 'communication',
  view: 'Communication',
  description,
  group: 'İLETİŞİM',
  apiOnly: true,
})

// Temel menüde olmayan iletişim sayfaları (öğrenci ve veli için temel menüde zaten vardır). Hesap
// grubu varsa ondan önce, yoksa sona eklenir; yönetici ve ön büro mesajı yalnız yeni web açar,
// mobil bunlardan yalnız kendi taşıdığı sayfaları gösterir.
const apiCommunicationPages: Record<Role, readonly NavigationPage[]> = {
  yonetici: [
    communicationPage(
      'duyurular',
      'Duyurular',
      'Megaphone',
      'Kurum duyurularını yayınlayın ve izleyin.',
    ),
    communicationPage(
      'mesajlar',
      'Mesajlar',
      'MessagesSquare',
      'Öğrenci–öğretmen yazışmalarının üst verisini görün; içeriği gerekçeyle açın.',
    ),
  ],
  onburo: [
    communicationPage(
      'duyurular',
      'Duyurular',
      'Megaphone',
      'İdari duyuruları yayınlayın ve izleyin.',
    ),
  ],
  ogretmen: [
    communicationPage('duyurular', 'Duyurular', 'Megaphone', 'Sınıflarınıza duyuru yayınlayın.'),
    communicationPage(
      'mesajlar',
      'Mesajlar',
      'MessagesSquare',
      'Öğrencileriniz ve velileriyle yazışın.',
    ),
  ],
  ogrenci: [],
  veli: [],
}

function withCommunication(role: Role): NavigationPage[] {
  const base: NavigationPage[] = [...baseNavigation[role]]
  const extra = apiCommunicationPages[role].filter(
    (added) => !base.some((page) => page.path === added.path),
  )
  if (!extra.length) return base
  const at = base.findIndex((page) => page.group === 'HESABIM')
  return at < 0 ? [...base, ...extra] : [...base.slice(0, at), ...extra, ...base.slice(at)]
}

// Anahtar sırası temel menüdekiyle aynıdır.
export const navigation: Record<Role, NavigationPage[]> = {
  yonetici: withCommunication('yonetici'),
  onburo: withCommunication('onburo'),
  ogretmen: withCommunication('ogretmen'),
  ogrenci: withCommunication('ogrenci'),
  veli: withCommunication('veli'),
}

for (const module of schoolModules) {
  for (const role of module.roles) {
    navigation[role].push({
      path: module.path,
      title: module.title,
      icon: module.icon,
      module: module.key,
      view: module.view || 'SchoolWorkflows',
      description: module.description,
      group: SCHOOL_LIFE_MODULES.includes(module.key) ? 'OKUL YAŞAMI' : 'OKUL İŞ AKIŞLARI',
    })
  }
}
