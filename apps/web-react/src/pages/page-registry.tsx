// Taşınmış ekranların kaydı: rol + menü yolu → tembel yüklenen sayfa bileşeni. Kayıtta olmayan
// sayfa yer tutucuyla açılır. Her sayfa kendi parçasıdır (rota parçası ≤ 100 KB).
import { lazy } from 'react'
import type { NavPage, RoleKey } from '@/lib/navigation.ts'

const CampusesPage = lazy(async () => ({
  default: (await import('./management/CampusesPage.tsx')).CampusesPage,
}))
const StaffPage = lazy(async () => ({
  default: (await import('./management/StaffPage.tsx')).StaffPage,
}))

const MIGRATED = new Set(['yonetici/subeler', 'yonetici/personel'])

export function isMigratedPage(role: RoleKey, path: string): boolean {
  return MIGRATED.has(`${role}/${path}`)
}

/** Taşınmış sayfayı çizer; `Suspense` içinde kullanılır. */
export function MigratedPage({ role, page }: { role: RoleKey; page: NavPage }) {
  switch (`${role}/${page.path}`) {
    case 'yonetici/subeler':
      return <CampusesPage page={page} />
    case 'yonetici/personel':
      return <StaffPage page={page} />
    default:
      return null
  }
}
