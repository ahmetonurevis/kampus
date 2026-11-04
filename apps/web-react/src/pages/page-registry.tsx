// Taşınmış ekranların kaydı: rol + menü yolu → tembel yüklenen sayfa bileşeni. Kayıtta olmayan
// sayfa yer tutucuyla açılır. Her sayfa kendi parçasıdır (rota parçası ≤ 100 KB).
// İki kaynak birleşir: Oğuzhan'ın girdileri `registry/platform-pages.tsx`, kayıt ve finans girdileri
// aşağıdaki `// Onur: kayıt ve finans` bloğudur (§7.6). Bir yol yalnız bir kaynakta bulunur.
import { lazy, type ReactNode } from 'react'
import type { NavPage, RoleKey } from '@/lib/navigation.ts'
import { isMigratedPage } from '@/lib/page-coverage.ts'
import { renderPlatformPage } from './registry/platform-pages.tsx'

export { isMigratedPage }

// Onur: kayıt ve finans
const EnrollmentReportsPage = lazy(async () => ({
  default: (await import('./management/EnrollmentReportsPage.tsx')).EnrollmentReportsPage,
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
const ProspectsPage = lazy(async () => ({
  default: (await import('./crm/ProspectsPage.tsx')).ProspectsPage,
}))
const ProspectDetailPage = lazy(async () => ({
  default: (await import('./crm/ProspectDetailPage.tsx')).ProspectDetailPage,
}))
const MeetingsPage = lazy(async () => ({
  default: (await import('./crm/MeetingsPage.tsx')).MeetingsPage,
}))
const EnrollmentPage = lazy(async () => ({
  default: (await import('./crm/EnrollmentPage.tsx')).EnrollmentPage,
}))
// Öğretmenin deneme dersi sonucu ekranı (dil okulu; DOM-DIL-031, DOM-YTK-080).
const TrialResultsPage = lazy(async () => ({
  default: (await import('./crm/TrialResultsPage.tsx')).TrialResultsPage,
}))
const RenewalsPage = lazy(async () => ({
  default: (await import('./finance/RenewalsPage.tsx')).RenewalsPage,
}))

function renderOnurPage(role: RoleKey, page: NavPage): ReactNode {
  switch (`${role}/${page.path}`) {
    case 'yonetici/kayit-raporlari':
      return <EnrollmentReportsPage page={page} />
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
    case 'onburo/adaylar':
      return <ProspectsPage page={page} />
    case 'onburo/deneme-dersi-takvimi':
      return <MeetingsPage page={page} />
    case 'onburo/kayit-islemleri':
    case 'yonetici/kayit-islemleri':
      return <EnrollmentPage page={page} />
    case 'onburo/aday':
    case 'yonetici/aday':
      return <ProspectDetailPage page={page} />
    case 'ogretmen/deneme-sonuclari':
      return <TrialResultsPage page={page} />
    case 'yonetici/kayit-yenileme':
    case 'onburo/kayit-yenileme':
    case 'veli/kayit-yenileme':
      return <RenewalsPage page={page} />
    default:
      return null
  }
}
// Onur: kayıt ve finans sonu

/** Taşınmış sayfayı çizer; `Suspense` içinde kullanılır. */
export function MigratedPage({ role, page }: { role: RoleKey; page: NavPage }) {
  return renderOnurPage(role, page) ?? renderPlatformPage(role, page)
}
