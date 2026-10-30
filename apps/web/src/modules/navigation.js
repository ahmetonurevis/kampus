import { navigation as coreNavigation, roles } from '@kampus/school-core/modules/full-navigation.ts'

export { roles }

// `apiOnly` sayfaların (yeni web ve mobildeki iletişim ekranları) Vue demosunda karşılığı yoktur;
// demo menüsü ve rotaları bunları almaz.
/** @type {typeof coreNavigation} */
export const navigation = Object.fromEntries(
  Object.entries(coreNavigation).map(([role, pages]) => [
    role,
    pages.filter((page) => !page.apiOnly),
  ]),
)
