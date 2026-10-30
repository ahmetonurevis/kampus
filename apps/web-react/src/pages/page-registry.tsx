// Taşınmış ekranların kaydı: rol + menü yolu → tembel yüklenen sayfa bileşeni. Kayıtta olmayan
// sayfa yer tutucuyla açılır. Her sayfa kendi parçasıdır (rota parçası ≤ 100 KB).
import { lazy } from 'react'
import type { NavPage, RoleKey } from '@/lib/navigation.ts'

const DashboardPage = lazy(async () => ({
  default: (await import('./dashboard/DashboardPage.tsx')).DashboardPage,
}))
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

const SettingsPage = lazy(async () => ({
  default: (await import('./settings/SettingsPage.tsx')).SettingsPage,
}))

const FinancePage = lazy(async () => ({
  default: (await import('./finance/FinancePage.tsx')).FinancePage,
}))

const TeacherHomeworkPage = lazy(async () => ({
  default: (await import('./learning/TeacherHomeworkPage.tsx')).TeacherHomeworkPage,
}))
const TeacherMaterialsPage = lazy(async () => ({
  default: (await import('./learning/TeacherMaterialsPage.tsx')).TeacherMaterialsPage,
}))
const TeacherQuizzesPage = lazy(async () => ({
  default: (await import('./learning/TeacherQuizzesPage.tsx')).TeacherQuizzesPage,
}))
const StudentHomeworkPage = lazy(async () => ({
  default: (await import('./learning/StudentLearningPages.tsx')).StudentHomeworkPage,
}))
const StudentQuizzesPage = lazy(async () => ({
  default: (await import('./learning/StudentLearningPages.tsx')).StudentQuizzesPage,
}))
const StudentMaterialsPage = lazy(async () => ({
  default: (await import('./learning/StudentMaterialsPage.tsx')).StudentMaterialsPage,
}))

const AnnouncementsPage = lazy(async () => ({
  default: (await import('./communication/AnnouncementsPage.tsx')).AnnouncementsPage,
}))
const MessagesPage = lazy(async () => ({
  default: (await import('./communication/MessagesPage.tsx')).MessagesPage,
}))
const ParentMessagesPage = lazy(async () => ({
  default: (await import('./communication/ParentMessagesPage.tsx')).ParentMessagesPage,
}))

// Okul iş akışı modülleri tek ortak sayfayı paylaşır (core sunum tanımı menü yolundan gelir).
const WorkflowPage = lazy(async () => ({
  default: (await import('./workflows/WorkflowPage.tsx')).WorkflowPage,
}))
// Optik değerlendirme ve otomatik etüt kendi ekranlarıdır (core modül kaydındaki yoldan).
const OpticalPage = lazy(async () => ({
  default: (await import('./assessment/OpticalPage.tsx')).OpticalPage,
}))
const TutoringPage = lazy(async () => ({
  default: (await import('./assessment/TutoringPage.tsx')).TutoringPage,
}))
const ASSESSMENT_PATHS = new Set(['optik-degerlendirme', 'otomatik-etut'])
/** Bağlanmış iş akışı sayfaları; kalanlar yer tutucudur (bkz. README geçiş durumu). */
const WORKFLOW_PATHS = new Set([
  'yemek-menusu',
  'okul-takvimi',
  'kulupler',
  'hedef-plani',
  'rehberlik',
  'deneme-sinavlari',
  'kayit-yenileme',
  'program-yonetimi',
  'calisma-plani',
  'okul-servisi',
])

const MIGRATED = new Set([
  'yonetici/dashboard',
  'onburo/dashboard',
  'ogretmen/dashboard',
  'ogrenci/dashboard',
  'veli/dashboard',
  'yonetici/subeler',
  'yonetici/personel',
  'yonetici/ayarlar',
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
  'ogretmen/odevler',
  'ogretmen/materyal-yukle',
  'ogretmen/quiz-olustur',
  'ogrenci/odevler',
  'ogrenci/materyaller',
  'ogrenci/soru-coz',
  'ogrenci/mesajlar',
  'ogretmen/mesajlar',
  'yonetici/mesajlar',
  'veli/randevu-mesaj',
])
// Duyurular beş rolün hepsinde aynı ekrandır; rol kapsamı sunucudadır.
// TODO(web-randevu): öğretmen `randevular` ve öğrenci `randevu-talep` yer tutucu kalır.
const ANNOUNCEMENT_PATH = 'duyurular'

export function isMigratedPage(role: RoleKey, path: string): boolean {
  return (
    MIGRATED.has(`${role}/${path}`) ||
    WORKFLOW_PATHS.has(path) ||
    ASSESSMENT_PATHS.has(path) ||
    path === ANNOUNCEMENT_PATH
  )
}

/** Taşınmış sayfayı çizer; `Suspense` içinde kullanılır. */
export function MigratedPage({ role, page }: { role: RoleKey; page: NavPage }) {
  if (page.path === 'dashboard') return <DashboardPage page={page} />
  // Menüde olmayan rol bu yola gelemez (`resolveShell`); modülün rolleri core kaydındadır.
  if (page.path === 'optik-degerlendirme') return <OpticalPage page={page} />
  if (page.path === 'otomatik-etut') return <TutoringPage page={page} />
  if (WORKFLOW_PATHS.has(page.path)) return <WorkflowPage page={page} />
  if (page.path === ANNOUNCEMENT_PATH) return <AnnouncementsPage page={page} />
  switch (`${role}/${page.path}`) {
    case 'yonetici/subeler':
      return <CampusesPage page={page} />
    case 'yonetici/personel':
      return <StaffPage page={page} />
    case 'yonetici/ayarlar':
      return <SettingsPage page={page} />
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
    case 'ogretmen/odevler':
      return <TeacherHomeworkPage page={page} />
    case 'ogretmen/materyal-yukle':
      return <TeacherMaterialsPage page={page} />
    case 'ogretmen/quiz-olustur':
      return <TeacherQuizzesPage page={page} />
    case 'ogrenci/odevler':
      return <StudentHomeworkPage page={page} />
    case 'ogrenci/materyaller':
      return <StudentMaterialsPage page={page} />
    case 'ogrenci/soru-coz':
      return <StudentQuizzesPage page={page} />
    case 'ogrenci/mesajlar':
    case 'ogretmen/mesajlar':
    case 'yonetici/mesajlar':
      return <MessagesPage page={page} />
    case 'veli/randevu-mesaj':
      return <ParentMessagesPage page={page} />
    default:
      return null
  }
}
