import { navigation as baseNavigation, type Role } from './navigation.ts'
import { schoolModules } from './school-workflows.ts'

export { roles } from './navigation.ts'

const SCHOOL_LIFE_MODULES = ['transport', 'meals', 'clubs', 'calendar']

// Temel sayfalara okul iş akışı modüllerini ekler; web ve mobil aynı menüyü paylaşır.
export type NavigationPage = (typeof baseNavigation)[Role][number]
// Temel listeler kopyalanır; anahtar sırası temel menüdekiyle aynıdır.
export const navigation: Record<Role, NavigationPage[]> = {
  yonetici: [...baseNavigation.yonetici],
  onburo: [...baseNavigation.onburo],
  ogretmen: [...baseNavigation.ogretmen],
  ogrenci: [...baseNavigation.ogrenci],
  veli: [...baseNavigation.veli],
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
