import { lazy, Suspense } from 'react'
import { useFinanceTotals } from '@kampus/react-shared/use-finance-exports.ts'
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
import { CorporateCustomersSection } from './CorporateCustomersSection.tsx'
import { FinanceBoardReportSection } from './FinanceBoardReportSection.tsx'
import { BOARD_REPORT_VIEW } from './finance-board-report.ts'
import { CourseOffersSection } from './CourseOffersSection.tsx'
import { EOzelSection } from './EOzelSection.tsx'
import { FinanceBankMatchingSection } from './FinanceBankMatchingSection.tsx'
import { FinanceBudgetSection } from './FinanceBudgetSection.tsx'
import { FinanceCostReportsSection } from './FinanceCostReportsSection.tsx'
import { FeeTariffsSection } from './FeeTariffsSection.tsx'
import { ReferralRewardsSection } from './ReferralRewardsSection.tsx'
import { FinanceDayClosingSection } from './FinanceDayClosingSection.tsx'
import { FinanceOpeningWatchSection } from './FinanceOpeningWatchSection.tsx'
import { OPENING_WATCH_VIEW } from './finance-opening-watch.ts'
import { ScholarshipFundsSection } from './ScholarshipFundsSection.tsx'
import { ScholarshipsSection } from './ScholarshipsSection.tsx'
import { FinanceExportSection } from './FinanceExportSection.tsx'
import { FinanceForecastSection } from './FinanceForecastSection.tsx'
import { InstallmentImportSection } from './InstallmentImportSection.tsx'
import { FinanceReconciliationSection } from './FinanceReconciliationSection.tsx'
import { InvoiceRemindButton } from './InvoiceRemindButton.tsx'
import { InvoicesSection } from './InvoicesSection.tsx'
import { InvoiceSummaryPanel } from './InvoiceSummaryPanel.tsx'
import { PaymentPanel } from './PaymentPanel.tsx'
import { PackagesSection } from './PackagesSection.tsx'
import { PaymentsSection } from './PaymentsSection.tsx'
import { ContractsSection } from './ContractsSection.tsx'
import { WithdrawalsSection } from './WithdrawalsSection.tsx'
import { LookupError, StatGrid } from '../academic/AcademicParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'

// Satın alma sekmeleri ayrı parçadır: Finans rota parçası 100 KB bütçesinin altında kalır.
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
const FinanceSupplierLedgerSection = lazy(async () => ({
  default: (await import('./FinanceSupplierLedgerSection.tsx')).FinanceSupplierLedgerSection,
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
  referrals: { label: 'Referans hakları', param: 'referans' },
  withdrawals: { label: 'Ayrılış ve iade', param: 'ayrilis' },
  exports: { label: 'Muhasebe aktarımı', param: 'aktarim' },
  budget: { label: 'Bütçe', param: 'butce' },
  costs: { label: 'Maliyet', param: 'maliyet' },
  suppliers: { label: 'Tedarikçiler', param: 'tedarikci' },
  purchaseRequests: { label: 'Satın alma talepleri', param: 'satin-alma' },
  purchaseOrders: { label: 'Siparişler', param: 'siparis' },
  purchaseReport: { label: 'Satın alma raporu', param: 'satin-alma-raporu' },
  supplierLedger: { label: 'Tedarikçi carisi', param: 'tedarikci-cari' },
  eOzel: { label: 'e-Özel işlem listesi', param: 'e-ozel' },
  forecast: { label: 'Tahmin', param: 'tahmin' },
  boardReport: { label: 'Yönetim kurulu raporu', param: BOARD_REPORT_VIEW },
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
      value === 'supplierLedger'
    )
      return isManager
    if (value === 'packages' || value === 'courseOffers' || value === 'corporate')
      return institutionType === 'language_school'
    if (value === 'eOzel') return institutionType !== 'school'
    return true
  })
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
  const viewOptions = viewOptionsFor(session?.institution?.type, isManager)
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
      {tab === 'corporate' ? <CorporateCustomersSection canCancel={isManager} /> : null}
      {tab === 'referrals' ? <ReferralRewardsSection /> : null}
      {tab === 'withdrawals' ? <WithdrawalsSection canManage={isManager} /> : null}
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
      {tab === 'suppliers' ||
      tab === 'purchaseRequests' ||
      tab === 'purchaseOrders' ||
      tab === 'purchaseReport' ||
      tab === 'supplierLedger' ? (
        <Suspense fallback={<SummaryLoading />}>
          {tab === 'suppliers' ? <FinanceSuppliersSection canManage={isManager} /> : null}
          {tab === 'purchaseRequests' ? <FinancePurchaseRequestsSection /> : null}
          {tab === 'purchaseOrders' ? <FinancePurchaseOrdersSection /> : null}
          {tab === 'purchaseReport' ? <FinancePurchaseReportSection /> : null}
          {tab === 'supplierLedger' ? <FinanceSupplierLedgerSection /> : null}
        </Suspense>
      ) : null}
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
