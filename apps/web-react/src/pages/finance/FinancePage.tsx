import { lazy, Suspense } from 'react'
import { useFinanceTotals } from '@kampus/react-shared/use-finance-exports.ts'
import { useMaintenancePlans } from '@kampus/react-shared/use-finance-maintenance-plans.ts'
import { useSearchParams } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { dayKey, money } from '@kampus/school-core/lib/format.ts'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { Button } from '@/components/ui/button'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { BOARD_REPORT_VIEW } from './finance-board-report.ts'
import { OPENING_WATCH_VIEW } from './finance-opening-watch.ts'
import { REFUND_INVOICES_VIEW } from './finance-refund-invoices.ts'
import { InstallmentImportSection } from './InstallmentImportSection.tsx'
import { InvoiceRemindButton } from './InvoiceRemindButton.tsx'
import { InvoicesSection } from './InvoicesSection.tsx'
import { InvoiceSummaryPanel } from './InvoiceSummaryPanel.tsx'
import { PaymentPanel } from './PaymentPanel.tsx'
import { LookupError, StatGrid } from '../academic/AcademicParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'

// Taksitler dışındaki her sekme ayrı parçadır: Finans rota parçası 100 KB bütçesinin altında kalır.
const CorporateCustomersSection = lazy(async () => ({
  default: (await import('./CorporateCustomersSection.tsx')).CorporateCustomersSection,
}))
const FinanceBoardReportSection = lazy(async () => ({
  default: (await import('./FinanceBoardReportSection.tsx')).FinanceBoardReportSection,
}))
const CourseOffersSection = lazy(async () => ({
  default: (await import('./CourseOffersSection.tsx')).CourseOffersSection,
}))
const EOzelSection = lazy(async () => ({
  default: (await import('./EOzelSection.tsx')).EOzelSection,
}))
const FinanceBankMatchingSection = lazy(async () => ({
  default: (await import('./FinanceBankMatchingSection.tsx')).FinanceBankMatchingSection,
}))
const FinanceBudgetSection = lazy(async () => ({
  default: (await import('./FinanceBudgetSection.tsx')).FinanceBudgetSection,
}))
const FinanceCostReportsSection = lazy(async () => ({
  default: (await import('./FinanceCostReportsSection.tsx')).FinanceCostReportsSection,
}))
const FeeTariffsSection = lazy(async () => ({
  default: (await import('./FeeTariffsSection.tsx')).FeeTariffsSection,
}))
const ReferralRewardsSection = lazy(async () => ({
  default: (await import('./ReferralRewardsSection.tsx')).ReferralRewardsSection,
}))
const FinanceDayClosingSection = lazy(async () => ({
  default: (await import('./FinanceDayClosingSection.tsx')).FinanceDayClosingSection,
}))
const FinanceOpeningWatchSection = lazy(async () => ({
  default: (await import('./FinanceOpeningWatchSection.tsx')).FinanceOpeningWatchSection,
}))
const ScholarshipFundsSection = lazy(async () => ({
  default: (await import('./ScholarshipFundsSection.tsx')).ScholarshipFundsSection,
}))
const ScholarshipsSection = lazy(async () => ({
  default: (await import('./ScholarshipsSection.tsx')).ScholarshipsSection,
}))
const FinanceExportSection = lazy(async () => ({
  default: (await import('./FinanceExportSection.tsx')).FinanceExportSection,
}))
const FinanceForecastSection = lazy(async () => ({
  default: (await import('./FinanceForecastSection.tsx')).FinanceForecastSection,
}))
const FinanceReconciliationSection = lazy(async () => ({
  default: (await import('./FinanceReconciliationSection.tsx')).FinanceReconciliationSection,
}))
const PackagesSection = lazy(async () => ({
  default: (await import('./PackagesSection.tsx')).PackagesSection,
}))
const PaymentsSection = lazy(async () => ({
  default: (await import('./PaymentsSection.tsx')).PaymentsSection,
}))
const ContractsSection = lazy(async () => ({
  default: (await import('./ContractsSection.tsx')).ContractsSection,
}))
const WithdrawalsSection = lazy(async () => ({
  default: (await import('./WithdrawalsSection.tsx')).WithdrawalsSection,
}))
const FinanceSuppliersSection = lazy(async () => ({
  default: (await import('./FinanceSuppliersSection.tsx')).FinanceSuppliersSection,
}))
const FinancePurchaseRequestsSection = lazy(async () => ({
  default: (await import('./FinancePurchaseRequestsSection.tsx')).FinancePurchaseRequestsSection,
}))
const FinancePurchaseOrdersSection = lazy(async () => ({
  default: (await import('./FinancePurchaseOrdersSection.tsx')).FinancePurchaseOrdersSection,
}))
const FinancePurchaseReportSection = lazy(async () => ({
  default: (await import('./FinancePurchaseReportSection.tsx')).FinancePurchaseReportSection,
}))
const FinanceSupplierLedgerSection = lazy(async () => ({
  default: (await import('./FinanceSupplierLedgerSection.tsx')).FinanceSupplierLedgerSection,
}))
const FinanceInventorySection = lazy(async () => ({
  default: (await import('./FinanceInventorySection.tsx')).FinanceInventorySection,
}))
const FinanceSupplyRequestsSection = lazy(async () => ({
  default: (await import('./FinanceSupplyRequestsSection.tsx')).FinanceSupplyRequestsSection,
}))
const FinanceFixedAssetsSection = lazy(async () => ({
  default: (await import('./FinanceFixedAssetsSection.tsx')).FinanceFixedAssetsSection,
}))
const FinanceMaintenanceSection = lazy(async () => ({
  default: (await import('./FinanceMaintenanceSection.tsx')).FinanceMaintenanceSection,
}))
const FinanceMaintenancePlansSection = lazy(async () => ({
  default: (await import('./FinanceMaintenancePlansSection.tsx')).FinanceMaintenancePlansSection,
}))
const FinanceBudgetDraftsSection = lazy(async () => ({
  default: (await import('./FinanceBudgetDraftsSection.tsx')).FinanceBudgetDraftsSection,
}))
const FinanceMaterialSetsSection = lazy(async () => ({
  default: (await import('./FinanceMaterialSetsSection.tsx')).FinanceMaterialSetsSection,
}))
const FinanceSeveranceSection = lazy(async () => ({
  default: (await import('./FinanceSeveranceSection.tsx')).FinanceSeveranceSection,
}))
const FinanceRefundInvoicesSection = lazy(async () => ({
  default: (await import('./FinanceRefundInvoicesSection.tsx')).FinanceRefundInvoicesSection,
}))
const FinancePayrollParametersSection = lazy(async () => ({
  default: (await import('./FinancePayrollParametersSection.tsx')).FinancePayrollParametersSection,
}))
const DonationsSection = lazy(async () => ({
  default: (await import('./DonationsSection.tsx')).DonationsSection,
}))
const FinanceStakeholdersSection = lazy(async () => ({
  default: (await import('./FinanceStakeholdersSection.tsx')).FinanceStakeholdersSection,
}))
const FinancePayRatesSection = lazy(async () => ({
  default: (await import('./FinancePayRatesSection.tsx')).FinancePayRatesSection,
}))
const FinanceStaffCostsSection = lazy(async () => ({
  default: (await import('./FinanceStaffCostsSection.tsx')).FinanceStaffCostsSection,
}))
const FinancePaidActivitiesSection = lazy(async () => ({
  default: (await import('./FinancePaidActivitiesSection.tsx')).FinancePaidActivitiesSection,
}))
const FinanceEventTicketsSection = lazy(async () => ({
  default: (await import('./FinanceEventTicketsSection.tsx')).FinanceEventTicketsSection,
}))
const FinanceStaffDeductionsSection = lazy(async () => ({
  default: (await import('./FinanceStaffDeductionsSection.tsx')).FinanceStaffDeductionsSection,
}))
const FinanceStaffCertificatesSection = lazy(async () => ({
  default: (await import('./FinanceStaffCertificatesSection.tsx')).FinanceStaffCertificatesSection,
}))
const FinancePayrollExportSection = lazy(async () => ({
  default: (await import('./FinancePayrollExportSection.tsx')).FinancePayrollExportSection,
}))
const FinanceMedicalReportsSection = lazy(async () => ({
  default: (await import('./FinanceMedicalReportsSection.tsx')).FinanceMedicalReportsSection,
}))
const FinancePayrollPeriodsSection = lazy(async () => ({
  default: (await import('./FinancePayrollPeriodsSection.tsx')).FinancePayrollPeriodsSection,
}))
const FinanceStaffLeaveSection = lazy(async () => ({
  default: (await import('./FinanceStaffLeaveSection.tsx')).FinanceStaffLeaveSection,
}))
const FinanceSgkPreparationSection = lazy(async () => ({
  default: (await import('./FinanceSgkPreparationSection.tsx')).FinanceSgkPreparationSection,
}))
const FinanceWorkPermitsSection = lazy(async () => ({
  default: (await import('./FinanceWorkPermitsSection.tsx')).FinanceWorkPermitsSection,
}))
const FinanceTripPlansSection = lazy(async () => ({
  default: (await import('./FinanceTripPlansSection.tsx')).FinanceTripPlansSection,
}))
const FinanceStaffDocumentsSection = lazy(async () => ({
  default: (await import('./FinanceStaffDocumentsSection.tsx')).FinanceStaffDocumentsSection,
}))
const FreeTuitionSection = lazy(async () => ({
  default: (await import('./FreeTuitionSection.tsx')).FreeTuitionSection,
}))

const VIEW_PARAM = 'gorunum'
const VIEWS = {
  invoices: { label: 'Taksitler', param: '' },
  openingWatch: { label: 'Açılış nöbeti', param: OPENING_WATCH_VIEW },
  payments: { label: 'Tahsilat geçmişi', param: 'tahsilatlar' },
  dayClosing: { label: 'Gün sonu', param: 'gunsonu' },
  bankMatching: { label: 'Banka eşleştirme', param: 'banka' },
  contracts: { label: 'Sözleşmeler', param: 'sozlesmeler' },
  tariffs: { label: 'Ücret tarifesi', param: 'tarife' },
  packages: { label: 'Paketler', param: 'paket' },
  courseOffers: { label: 'Kur yenileme', param: 'kur-yenileme' },
  corporate: { label: 'Kurumsal müşteriler', param: 'kurumsal' },
  scholarships: { label: 'Burslar', param: 'burs' },
  scholarshipFunds: { label: 'Burs fonları', param: 'burs-fonu' },
  freeTuition: { label: 'Ücretsiz okutma', param: 'ucretsiz' },
  referrals: { label: 'Referans hakları', param: 'referans' },
  withdrawals: { label: 'Ayrılış ve iade', param: 'ayrilis' },
  refundInvoices: { label: 'İade belgeleri', param: REFUND_INVOICES_VIEW },
  exports: { label: 'Muhasebe aktarımı', param: 'aktarim' },
  budget: { label: 'Bütçe', param: 'butce' },
  budgetDrafts: { label: 'Bütçe taslakları', param: 'butce-taslak' },
  costs: { label: 'Maliyet', param: 'maliyet' },
  suppliers: { label: 'Tedarikçiler', param: 'tedarikci' },
  purchaseRequests: { label: 'Satın alma talepleri', param: 'satin-alma' },
  purchaseOrders: { label: 'Siparişler', param: 'siparis' },
  purchaseReport: { label: 'Satın alma raporu', param: 'satin-alma-raporu' },
  supplierLedger: { label: 'Tedarikçi carisi', param: 'tedarikci-cari' },
  inventory: { label: 'Stok', param: 'stok' },
  materialSets: { label: 'Materyal setleri', param: 'materyal-seti' },
  supplyRequests: { label: 'Sarf talepleri', param: 'sarf' },
  fixedAssets: { label: 'Demirbaşlar', param: 'demirbas' },
  maintenance: { label: 'Arıza ve bakım', param: 'ariza' },
  maintenancePlans: { label: 'Periyodik bakım', param: 'bakim-plani' },
  eOzel: { label: 'e-Özel işlem listesi', param: 'e-ozel' },
  forecast: { label: 'Tahmin', param: 'tahmin' },
  boardReport: { label: 'Yönetim kurulu raporu', param: BOARD_REPORT_VIEW },
  severance: { label: 'Kıdem/ihbar hesaplayıcı', param: 'kidem-ihbar' },
  payrollParameters: { label: 'Bordro parametreleri', param: 'bordro-parametreleri' },
  donations: { label: 'Bağışlar', param: 'bagis' },
  stakeholders: { label: 'Paydaşlar ve sponsorlar', param: 'paydas' },
  payRates: { label: 'Ücret tanımları', param: 'ucret-tanimi' },
  staffCosts: { label: 'Personel maliyeti', param: 'personel-maliyeti' },
  paidActivities: { label: 'Gezi ve etkinlik ücretleri', param: 'gezi-etkinlik' },
  eventTickets: { label: 'Etkinlik biletleri', param: 'etkinlik-bileti' },
  staffDeductions: { label: 'Avans ve kesintiler', param: 'avans-kesinti' },
  staffCertificates: { label: 'Personel belgeleri', param: 'personel-belgesi' },
  payrollExport: { label: 'Bordro aktarımı', param: 'bordro-aktarim' },
  medicalReports: { label: 'Sağlık raporları', param: 'saglik-raporu' },
  payrollPeriods: { label: 'Bordro dönemleri', param: 'bordro-donemleri' },
  staffLeave: { label: 'Personel izinleri', param: 'personel-izin' },
  sgkPreparation: { label: 'SGK hazırlık listesi', param: 'sgk-hazirlik' },
  workPermits: { label: 'Çalışma onayları', param: 'calisma-onayi' },
  tripPlans: { label: 'Gezi planları', param: 'gezi-plani' },
  staffDocuments: { label: 'Özlük belgeleri', param: 'ozluk-belgeleri' },
} as const
type FinanceView = keyof typeof VIEWS
const VIEW_OPTIONS = Object.entries(VIEWS).map(([value, view]) => ({
  value: value as FinanceView,
  label: view.label,
}))
/**
 * Paket satışı, kur yenileme teklifi ve kurumsal müşteri yalnız dil okulundadır (IST-078, IST-088,
 * IST-089), e-Özel listesi okulda yoktur (IST-085, ADR 0008); bütçe (DOM-FIN-062, K-60), maliyet
 * raporları (DOM-FIN-065), gelir ve nakit akışı tahmini (DOM-FIN-063) ile yönetim kurulu raporu
 * (DOM-FIN-064, K-80) ve banka eşleştirme (DOM-FIN-069, K-105) yalnız yöneticidedir: kapalı sekme gizlenir, adresi taksitlere düşer.
 * Tedarikçiler (DOM-FIN-070) ve satın alma talepleri (DOM-FIN-071) yönetici ve ön büroya açıktır;
 * ön büro tedarikçiyi salt okur (K-126), yalnız kendi talebini değiştirir (K-128).
 * Siparişler (DOM-FIN-073) de ikisine açıktır; siparişi yönetici açar ve iptal eder (K-141).
 * Satın alma raporu (DOM-FIN-075) yalnız yöneticidedir; ön büro görmez (K-155).
 * Tedarikçi carisi (DOM-FIN-076) yalnız yöneticidedir; ön büro görmez (K-160).
 * Stok (DOM-FIN-077, DOM-FIN-078) ikisine açıktır; ön büro okur ve çıkış yazar (K-180).
 * Materyal setleri (DOM-FIN-080) ikisine açıktır; ön büro teslim eder ve imzayı işler (K-205).
 * Sarf talepleri (DOM-FIN-091) ikisine açıktır; ön büro karşılar ve dönüştürür, onay yöneticide (K-244).
 * Demirbaşlar (DOM-FIN-085) yalnız yöneticidedir; ön büro görmez (K-189).
 * Arıza ve bakım (DOM-FIN-089) ikisine açıktır; ön büro bildirir, iş emrini yönetici yürütür (K-237).
 * Kıdem/ihbar hesaplayıcı (DOM-FIN-094) yalnız yöneticidedir (K-272).
 * Periyodik bakım (DOM-FIN-092) ikisine açıktır; ön büro okur, planı ve denetimi yönetici yazar
 * (K-255). Sekme rozeti geciken, 30 gün içinde yaklaşan ve hiç denetlenmemiş plan sayısıdır (K-253).
 * Bütçe taslakları (DOM-FIN-093) ikisine açıktır; ön büro yalnız sorumlusu olduğu birimi görür,
 * onay yöneticide (K-256, K-257).
 * Ücretsiz okutma (DOM-FIN-026) yalnız yöneticidedir; gerekçe ve belge hassastır (K-269).
 * İade belgeleri (DOM-FIN-096) yalnız yöneticidedir; faturayı muhasebe düzeltir (K-295).
 * Bordro parametreleri (DOM-FIN-100) ikisine açıktır; kurum kopyasını yönetici yazar (K-309).
 * Bağışlar (DOM-FIN-097) yalnız yöneticidedir; bağışçı verisi kişiseldir (K-299).
 * Paydaşlar ve sponsorlar (DOM-FIN-102) yalnız yöneticidedir (K-317).
 * Ücret tanımları (DOM-FIN-099) yalnız yöneticidedir; ücret kişisel veridir (K-306).
 * Personel maliyeti (DOM-FIN-104) yalnız yöneticidedir; rapor ücret içerir (K-334).
 * Gezi ve etkinlik ücretleri (DOM-FIN-098) ikisine açıktır; ön büro katılım yazar ve iptal eder,
 * etkinliği ve iadeyi yönetici yönetir (K-300).
 * Etkinlik biletleri (DOM-FIN-103) ikisine açıktır; etkinliği yönetici açar (K-324).
 * Avans ve kesintiler (DOM-FIN-101) yalnız yöneticidedir; icra bilgisi hassastır (K-315).
 * Personel belgeleri (DOM-FIN-106) yalnız yöneticidedir; belge ücret ve kimlik no içerir (K-342).
 * Sağlık raporları (DOM-FIN-110) yalnız yöneticidedir; sağlık verisi özel niteliklidir (K-363).
 * Bordro dönemleri (DOM-FIN-108) yalnız yöneticidedir; ücret verisiyle aynı (K-359).
 * Personel izinleri (DOM-FIN-109) yalnız yöneticidedir; personel kişisel verisidir.
 * SGK hazırlık listesi (DOM-FIN-107) yalnız yöneticidedir; liste ücret taşır (K-355).
 * Çalışma onayları (DOM-FIN-114) yalnız yöneticidedir; öğretmen özlük verisidir (K-377).
 * Gezi planları (DOM-FIN-111) ikisine açıktır; ön büro taslak yazar, yönetici onaylar (K-367).
 * Özlük belgeleri (DOM-FIN-113) ikisine açıktır; tür ayarı ve özel nitelikli belge yöneticide (K-374).
 */
const viewOptionsFor = (institutionType: string | undefined, isManager: boolean) =>
  VIEW_OPTIONS.filter(({ value }) => {
    if (
      value === 'budget' ||
      value === 'costs' ||
      value === 'forecast' ||
      value === 'boardReport' ||
      value === 'bankMatching' ||
      value === 'purchaseReport' ||
      value === 'supplierLedger' ||
      value === 'fixedAssets' ||
      value === 'severance' ||
      value === 'freeTuition' ||
      value === 'workPermits' ||
      value === 'sgkPreparation' ||
      value === 'staffLeave' ||
      value === 'payrollPeriods' ||
      value === 'medicalReports' ||
      value === 'payrollExport' ||
      value === 'staffCertificates' ||
      value === 'staffDeductions' ||
      value === 'payRates' ||
      value === 'staffCosts' ||
      value === 'stakeholders' ||
      value === 'donations' ||
      value === 'refundInvoices'
    )
      return isManager
    if (value === 'packages' || value === 'courseOffers' || value === 'corporate')
      return institutionType === 'language_school'
    if (value === 'eOzel') return institutionType !== 'school'
    return true
  })
const ATTENTION_QUERY = { page: 1, pageSize: 1, due: 'attention' } as const

/** Periyodik bakım sekmesinin rozeti: uyarıdaki plan sayısı; sıfırsa rozet yok. */
function withMaintenanceBadge(options: typeof VIEW_OPTIONS, attention: number) {
  return options.map((option) =>
    option.value === 'maintenancePlans' && attention > 0 ? { ...option, count: attention } : option,
  )
}
const viewOf = (param: string | null, options: typeof VIEW_OPTIONS): FinanceView =>
  options.find(({ value }) => param !== null && VIEWS[value].param === param)?.value ?? 'invoices'

/**
 * Finans & Tahsilat (yönetici `/finans`, ön büro `/tahsilat-takip`; Vue `Finance.vue`): görünümler
 * `?gorunum=` sekmeleridir; her görünüm kendi liste durumunu yalnız açıkken bağlar (taksitler
 * `InvoicesSection`). Toplam kartları kurum geneli `GET /finance/totals` yanıtından gelir; kısmi
 * ödemeleri sayar (liste araması ve durumundan bağımsız). Taksit ve tahsilat panelleri adresle
 * (`?detay=`, `?tahsilat=`) açılır.
 */
export function FinancePage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const [params, setParams] = useSearchParams()
  const isManager = session?.role === 'yonetici'
  const canReadPlans = isManager || session?.role === 'onburo'
  const attentionPlans = useMaintenancePlans(ATTENTION_QUERY, canReadPlans)
  const viewOptions = withMaintenanceBadge(
    viewOptionsFor(session?.institution?.type, isManager),
    attentionPlans.data?.meta.total ?? 0,
  )
  const tab = viewOf(params.get(VIEW_PARAM), viewOptions)
  const totalsQuery = useFinanceTotals()
  const totals = totalsQuery.data?.data

  const today = dayKey()
  const panel = useDetailPanel('detay')
  const openInvoice = panel.open
  const payment = useDetailPanel('tahsilat')
  const openPayment = payment.open
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {totalsQuery.error ? (
        <LookupError error={totalsQuery.error} onRetry={() => void totalsQuery.refetch()} />
      ) : null}
      {totals ? (
        <StatGrid
          label="Kurum geneli ödeme toplamları"
          items={[
            {
              label: 'Toplam eğitim bedeli',
              value: money(totals.totalCents),
              note: 'Tüm ödeme planları',
            },
            {
              label: 'Tahsil edilen',
              // Dosyadan aktarılan geçmiş ödeme borcu kapatır, tahsilat değildir (DOM-FIN-014).
              value: money(totals.paidCents - totals.openingImportCents),
              ...(totals.openingImportCents > 0
                ? { note: `Ayrıca ${money(totals.openingImportCents)} açılış aktarımı` }
                : {}),
            },
            {
              label: 'Kalan bakiye',
              value: money(totals.remainingCents),
              note: 'Gelecek ve gecikmiş taksitler',
            },
            { label: 'Gecikmiş tutar', value: money(totals.overdueCents) },
          ]}
        />
      ) : null}
      <LineTabs
        label="Finans görünümü"
        value={tab}
        options={viewOptions}
        onChange={(next) =>
          setParams(
            next === 'invoices' ? new URLSearchParams() : { [VIEW_PARAM]: VIEWS[next].param },
          )
        }
      />
      <Suspense fallback={<SummaryLoading />}>
        {tab === 'openingWatch' ? <FinanceOpeningWatchSection onOpenInvoice={openInvoice} /> : null}
        {tab === 'payments' ? <PaymentsSection canReverse={isManager} /> : null}
        {tab === 'dayClosing' ? <FinanceDayClosingSection canReopen={isManager} /> : null}
        {tab === 'bankMatching' ? <FinanceBankMatchingSection /> : null}
        {tab === 'contracts' ? <ContractsSection /> : null}
        {tab === 'tariffs' ? (
          <FeeTariffsSection
            canManage={isManager}
            academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
          />
        ) : null}
        {tab === 'packages' ? (
          <PackagesSection
            canManage={isManager}
            academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
          />
        ) : null}
        {tab === 'courseOffers' ? (
          <CourseOffersSection
            canApproveCapException={isManager}
            academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
          />
        ) : null}
        {tab === 'scholarships' ? (
          <ScholarshipsSection
            canManage={isManager}
            academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
          />
        ) : null}
        {tab === 'scholarshipFunds' ? <ScholarshipFundsSection canManage={isManager} /> : null}
        {tab === 'freeTuition' ? (
          <FreeTuitionSection
            academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
          />
        ) : null}
        {tab === 'corporate' ? <CorporateCustomersSection canCancel={isManager} /> : null}
        {tab === 'referrals' ? <ReferralRewardsSection /> : null}
        {tab === 'withdrawals' ? <WithdrawalsSection canManage={isManager} /> : null}
        {tab === 'refundInvoices' ? <FinanceRefundInvoicesSection /> : null}
        {tab === 'exports' ? <FinanceExportSection canDownload={isManager} /> : null}
        {tab === 'exports' && isManager ? (
          <FinanceReconciliationSection
            academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
          />
        ) : null}
        {tab === 'forecast' && session?.institution ? (
          <FinanceForecastSection
            enrollmentYear={session.institution.academicYear ?? Number(today.slice(0, 4))}
            institutionType={session.institution.type}
          />
        ) : null}
        {tab === 'budget' ? (
          <FinanceBudgetSection
            academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
            institutionType={session?.institution?.type ?? 'school'}
          />
        ) : null}
        {tab === 'costs' ? <FinanceCostReportsSection /> : null}
        {tab === 'suppliers' ? <FinanceSuppliersSection canManage={isManager} /> : null}
        {tab === 'purchaseRequests' ? <FinancePurchaseRequestsSection /> : null}
        {tab === 'purchaseOrders' ? <FinancePurchaseOrdersSection /> : null}
        {tab === 'purchaseReport' ? <FinancePurchaseReportSection /> : null}
        {tab === 'supplierLedger' ? <FinanceSupplierLedgerSection /> : null}
        {tab === 'inventory' ? <FinanceInventorySection role={session?.role ?? ''} /> : null}
        {tab === 'materialSets' ? (
          <FinanceMaterialSetsSection
            role={session?.role ?? ''}
            institutionType={session?.institution?.type ?? 'school'}
            academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
          />
        ) : null}
        {tab === 'supplyRequests' ? (
          <FinanceSupplyRequestsSection role={session?.role ?? ''} />
        ) : null}
        {tab === 'fixedAssets' ? <FinanceFixedAssetsSection /> : null}
        {tab === 'maintenance' ? <FinanceMaintenanceSection /> : null}
        {tab === 'severance' ? <FinanceSeveranceSection /> : null}
        {tab === 'maintenancePlans' ? (
          <FinanceMaintenancePlansSection role={session?.role ?? ''} />
        ) : null}
        {tab === 'budgetDrafts' ? <FinanceBudgetDraftsSection isManager={isManager} /> : null}
        {tab === 'boardReport' ? (
          <FinanceBoardReportSection
            academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
          />
        ) : null}
        {tab === 'eOzel' ? (
          <EOzelSection academicEnabled={session?.modules.academic === true} />
        ) : null}
        {tab === 'invoices' ? (
          <InvoicesSection onOpenInvoice={openInvoice} onOpenPayment={openPayment} />
        ) : null}
        {tab === 'invoices' && isManager ? <InstallmentImportSection /> : null}
        {tab === 'payrollParameters' ? (
          <FinancePayrollParametersSection canManage={isManager} />
        ) : null}
        {tab === 'donations' ? <DonationsSection /> : null}
        {tab === 'stakeholders' ? <FinanceStakeholdersSection /> : null}
        {tab === 'payRates' ? <FinancePayRatesSection /> : null}
        {tab === 'staffCosts' ? <FinanceStaffCostsSection /> : null}
        {tab === 'paidActivities' ? <FinancePaidActivitiesSection isManager={isManager} /> : null}
        {tab === 'eventTickets' ? <FinanceEventTicketsSection role={session?.role ?? ''} /> : null}
        {tab === 'staffDeductions' ? <FinanceStaffDeductionsSection /> : null}
        {tab === 'staffCertificates' ? <FinanceStaffCertificatesSection /> : null}
        {tab === 'payrollExport' ? <FinancePayrollExportSection /> : null}
        {tab === 'medicalReports' ? <FinanceMedicalReportsSection /> : null}
        {tab === 'payrollPeriods' ? <FinancePayrollPeriodsSection /> : null}
        {tab === 'staffLeave' ? <FinanceStaffLeaveSection /> : null}
        {tab === 'sgkPreparation' ? <FinanceSgkPreparationSection /> : null}
        {tab === 'workPermits' ? <FinanceWorkPermitsSection /> : null}
        {tab === 'tripPlans' ? <FinanceTripPlansSection /> : null}
        {tab === 'staffDocuments' ? <FinanceStaffDocumentsSection isManager={isManager} /> : null}
      </Suspense>
      <InvoiceSummaryPanel
        invoiceId={panel.selectedId}
        onClose={panel.close}
        actions={(row) => (
          <>
            <Button onClick={() => openPayment(row.id)}>
              <Icon name="Wallet" size={17} aria-hidden="true" />
              Tahsil et
            </Button>
            <InvoiceRemindButton row={row} />
          </>
        )}
      />
      <PaymentPanel invoiceId={payment.selectedId} onClose={payment.close} />
    </>
  )
}
