import { navigation as baseNavigation } from '@kampus/school-core/modules/navigation.js'
import { schoolModules } from '@kampus/school-core/modules/school-workflows.js'

export { roles } from '@kampus/school-core/modules/navigation.js'

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
      group: ['transport', 'meals', 'clubs', 'calendar'].includes(module.key)
        ? 'OKUL YAŞAMI'
        : 'OKUL İŞ AKIŞLARI',
    })
  }
}
