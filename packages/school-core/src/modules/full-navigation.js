import { navigation as baseNavigation } from './navigation.js'
import { schoolModules } from './school-workflows.js'

export { roles } from './navigation.js'

const SCHOOL_LIFE_MODULES = ['transport', 'meals', 'clubs', 'calendar']

// Temel sayfalara okul iş akışı modüllerini ekler; web ve mobil aynı menüyü paylaşır.
export const navigation = Object.fromEntries(
  Object.entries(baseNavigation).map(([role, pages]) => [role, [...pages]]),
)

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
