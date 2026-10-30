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
const TeacherClassesPage = lazy(async () => ({
  default: (await import('./academic/TeacherClassesPage.tsx')).TeacherClassesPage,
}))
const TeacherAttendancePage = lazy(async () => ({
  default: (await import('./academic/TeacherAttendancePage.tsx')).TeacherAttendancePage,
}))
const SchedulePage = lazy(async () => ({
  default: (await import('./academic/SchedulePage.tsx')).SchedulePage,
}))
const StudentGradesPage = lazy(async () => ({
  default: (await import('./academic/StudentGradesPage.tsx')).StudentGradesPage,
}))
const StudentAttendancePage = lazy(async () => ({
  default: (await import('./academic/StudentAttendancePage.tsx')).StudentAttendancePage,
}))
const ParentTrackingPage = lazy(async () => ({
  default: (await import('./academic/ParentTrackingPage.tsx')).ParentTrackingPage,
}))
const ChildrenPage = lazy(async () => ({
  default: (await import('./academic/ChildrenPage.tsx')).ChildrenPage,
}))

const FinancePage = lazy(async () => ({
  default: (await import('./finance/FinancePage.tsx')).FinancePage,
}))

const MIGRATED = new Set([
  'yonetici/subeler',
  'yonetici/personel',
  'yonetici/finans',
  'onburo/tahsilat-takip',
  'ogretmen/siniflarim',
  'ogretmen/yoklama',
  'ogretmen/ders-programi',
  'ogrenci/notlarim',
  'ogrenci/devamsizlik',
  'ogrenci/ders-programi',
  'veli/akademik-takip',
  'veli/cocuk-secici',
])

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
    case 'yonetici/finans':
    case 'onburo/tahsilat-takip':
      return <FinancePage page={page} />
    case 'ogretmen/siniflarim':
      return <TeacherClassesPage page={page} />
    case 'ogretmen/yoklama':
      return <TeacherAttendancePage page={page} />
    case 'ogretmen/ders-programi':
      return <SchedulePage page={page} audience="teacher" />
    case 'ogrenci/notlarim':
      return <StudentGradesPage page={page} />
    case 'ogrenci/devamsizlik':
      return <StudentAttendancePage page={page} />
    case 'ogrenci/ders-programi':
      return <SchedulePage page={page} audience="student" />
    case 'veli/akademik-takip':
      return <ParentTrackingPage page={page} />
    case 'veli/cocuk-secici':
      return <ChildrenPage page={page} />
    default:
      return null
  }
}
