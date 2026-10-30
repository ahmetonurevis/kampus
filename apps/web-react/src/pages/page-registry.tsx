// Taşınmış ekranların kaydı: rol + menü yolu → tembel yüklenen sayfa bileşeni. Kayıtta olmayan
// sayfa yer tutucuyla açılır. Her sayfa kendi parçasıdır (rota parçası ≤ 100 KB).
import { lazy } from 'react'
import type { NavPage, RoleKey } from '@/lib/navigation.ts'
import { ANNOUNCEMENT_PATH, isMigratedPage, WORKFLOW_PATHS } from '@/lib/page-coverage.ts'

export { isMigratedPage }

const DashboardPage = lazy(async () => ({
  default: (await import('./dashboard/DashboardPage.tsx')).DashboardPage,
}))
const CampusesPage = lazy(async () => ({
  default: (await import('./management/CampusesPage.tsx')).CampusesPage,
}))
const StaffPage = lazy(async () => ({
  default: (await import('./management/StaffPage.tsx')).StaffPage,
}))
const ContentPoolPage = lazy(async () => ({
  default: (await import('./content/ContentPoolPage.tsx')).ContentPoolPage,
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
const ExamAnalysisPage = lazy(async () => ({
  default: (await import('./academic/ExamAnalysisPage.tsx')).ExamAnalysisPage,
}))
const AcademicProgressPage = lazy(async () => ({
  default: (await import('./academic/AcademicProgressPage.tsx')).AcademicProgressPage,
}))
const TeacherReviewsPage = lazy(async () => ({
  default: (await import('./academic/TeacherReviewsPage.tsx')).TeacherReviewsPage,
}))

const PersonalSettingsPage = lazy(async () => ({
  default: (await import('./settings/PersonalSettingsPage.tsx')).PersonalSettingsPage,
}))
const SettingsPage = lazy(async () => ({
  default: (await import('./settings/SettingsPage.tsx')).SettingsPage,
}))

const FinancePage = lazy(async () => ({
  default: (await import('./finance/FinancePage.tsx')).FinancePage,
}))
// Veli ve öğrenci ödeme sayfaları tek parçadır (aynı taksit görünümünü paylaşırlar).
const ParentFinancePage = lazy(async () => ({
  default: (await import('./finance/FamilyFinancePages.tsx')).ParentFinancePage,
}))
const ParentPayPage = lazy(async () => ({
  default: (await import('./finance/FamilyFinancePages.tsx')).ParentPayPage,
}))
const ParentContractsPage = lazy(async () => ({
  default: (await import('./finance/FamilyFinancePages.tsx')).ParentContractsPage,
}))
const StudentPaymentsPage = lazy(async () => ({
  default: (await import('./finance/FamilyFinancePages.tsx')).StudentPaymentsPage,
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

const RequestsPage = lazy(async () => ({
  default: (await import('./requests/RequestsPage.tsx')).RequestsPage,
}))
const AbsenceNoticesPage = lazy(async () => ({
  default: (await import('./requests/AbsenceNoticesPage.tsx')).AbsenceNoticesPage,
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
    case 'yonetici/icerik-havuzu':
    case 'ogretmen/icerik-havuzu':
      return <ContentPoolPage page={page} />
    case 'yonetici/ayarlar':
      return <SettingsPage page={page} />
    case 'ogrenci/ayarlar':
    case 'veli/ayarlar':
      return <PersonalSettingsPage page={page} />
    case 'yonetici/finans':
    case 'onburo/tahsilat-takip':
      return <FinancePage page={page} />
    case 'veli/finans':
      return <ParentFinancePage page={page} receipts={false} />
    case 'veli/dekontlar':
      return <ParentFinancePage page={page} receipts />
    case 'veli/odeme-yap':
      return <ParentPayPage page={page} />
    case 'veli/sozlesmeler':
      return <ParentContractsPage page={page} />
    case 'ogrenci/odemelerim':
      return <StudentPaymentsPage page={page} />
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
    case 'ogrenci/sinav-analizi':
    case 'veli/sinav-analizi':
      return <ExamAnalysisPage page={page} />
    case 'ogrenci/seviye-takibi':
    case 'veli/seviye-takibi':
      return <AcademicProgressPage page={page} />
    case 'veli/ogretmen-degerlendirmeleri':
      return <TeacherReviewsPage page={page} />
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
    case 'veli/sikayet-talep':
      return <RequestsPage page={page} audience="parent" />
    case 'onburo/talepler':
      return <RequestsPage page={page} audience="front-office" />
    case 'veli/devamsizlik-bildirimi':
      return <AbsenceNoticesPage page={page} />
    default:
      return null
  }
}
