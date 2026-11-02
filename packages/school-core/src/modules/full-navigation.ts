import { navigation as baseNavigation, type Role } from './navigation.ts'
import type { InstitutionType } from './collection-modules.ts'
import {
  API_ACADEMIC_PAGES,
  API_COMMUNICATION_PAGES,
  API_LANGUAGE_SCHOOL_PAGES,
  API_LEARNING_PAGES,
} from '../platform/navigation.ts'
import { schoolModules } from './school-workflows.ts'

export { roles } from './navigation.ts'

const SCHOOL_LIFE_MODULES = ['transport', 'meals', 'clubs', 'calendar']

// Temel sayfalara okul iş akışı modüllerini ve API'li yüzeylerin iletişim sayfalarını ekler; web ve
// mobil aynı menüyü paylaşır. Eklenen iletişim, içerik havuzu ve akademik yönetim sayfaları
// `platform/navigation.ts`'tedir; kayıt ve finans menüsü temel menü (`navigation.ts`) ve okul iş
// akışı kaydından (`school-workflows.ts`) gelir.
// `apiOnly`: sayfa yalnız API'li yüzeylerde (yeni web, mobil) vardır; Vue demosunun karşılığı
// olmadığı için demo rotası ve menüsü `apiOnly` sayfaları düşürür (`apps/web/src/modules/navigation.js`).
// `institutionTypes`: sayfa yalnız bu kurum türlerinde vardır (dil okulu kur ve grup sayfaları);
// başka türde menüde görünmez ve doğrudan adresi kapalıdır. Verilmezse her türde vardır.
export type NavigationPage = (typeof baseNavigation)[Role][number] & {
  apiOnly?: true
  institutionTypes?: readonly InstitutionType[]
}

/** Sayfa kurum türünde var mı (`institutionTypes` verilmemişse her türde). */
export const pageAvailableFor = (
  page: Pick<NavigationPage, 'institutionTypes'>,
  type: InstitutionType,
) => page.institutionTypes === undefined || page.institutionTypes.includes(type)

/**
 * ÖĞRENME kategorisi varsa onun sonuna, yoksa RAPORLAR'dan (o da yoksa SİSTEM'den) önce; hiçbiri
 * yoksa sona eklenir.
 */
function withLearning(role: Role, pages: NavigationPage[]): NavigationPage[] {
  const extra = API_LEARNING_PAGES[role].filter(
    (added) => !pages.some((p) => p.path === added.path),
  )
  if (!extra.length) return pages
  const lastLearning = pages.findLastIndex((page) => page.group === 'ÖĞRENME')
  const before = pages.findIndex((page) => page.group === 'RAPORLAR' || page.group === 'SİSTEM')
  const at = lastLearning >= 0 ? lastLearning + 1 : before >= 0 ? before : pages.length
  return [...pages.slice(0, at), ...extra, ...pages.slice(at)]
}

/**
 * Akademik yönetim sayfaları kendi kategorisinin sonuna; kategori yoksa RAPORLAR'dan (o da yoksa
 * SİSTEM'den) önce, hiçbiri yoksa sona eklenir.
 */
function withAcademic(role: Role, pages: NavigationPage[]): NavigationPage[] {
  let result = pages
  for (const added of API_ACADEMIC_PAGES[role]) {
    if (result.some((p) => p.path === added.path)) continue
    const lastOfGroup = result.findLastIndex((page) => page.group === added.group)
    const before = result.findIndex((page) => page.group === 'RAPORLAR' || page.group === 'SİSTEM')
    const at = lastOfGroup >= 0 ? lastOfGroup + 1 : before >= 0 ? before : result.length
    result = [...result.slice(0, at), added, ...result.slice(at)]
  }
  return result
}

/** Kurum türüne bağlı sayfalar kendi kategorilerinin sonuna, kategori yoksa iletişimden önce. */
function withLanguageSchool(role: Role, pages: NavigationPage[]): NavigationPage[] {
  const result = [...pages]
  for (const added of API_LANGUAGE_SCHOOL_PAGES[role]) {
    if (result.some((page) => page.path === added.path)) continue
    const last = result.findLastIndex((page) => page.group === added.group)
    const before = result.findIndex((page) => page.group === 'İLETİŞİM' || page.group === 'HESABIM')
    const at = last >= 0 ? last + 1 : before >= 0 ? before : result.length
    result.splice(at, 0, added)
  }
  return result
}

function withCommunication(role: Role): NavigationPage[] {
  const base: NavigationPage[] = withLanguageSchool(
    role,
    withLearning(role, withAcademic(role, [...baseNavigation[role]])),
  )
  const extra = API_COMMUNICATION_PAGES[role].filter(
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
