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
import { EOzelSection } from './EOzelSection.tsx'
import { FeeTariffsSection } from './FeeTariffsSection.tsx'
import { ReferralRewardsSection } from './ReferralRewardsSection.tsx'
import { FinanceDayClosingSection } from './FinanceDayClosingSection.tsx'
import { ScholarshipsSection } from './ScholarshipsSection.tsx'
import { FinanceExportSection } from './FinanceExportSection.tsx'
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

const VIEW_PARAM = 'gorunum'
const VIEWS = {
  invoices: { label: 'Taksitler', param: '' },
  payments: { label: 'Tahsilat geçmişi', param: 'tahsilatlar' },
  dayClosing: { label: 'Gün sonu', param: 'gunsonu' },
  contracts: { label: 'Sözleşmeler', param: 'sozlesmeler' },
  tariffs: { label: 'Ücret tarifesi', param: 'tarife' },
  packages: { label: 'Paketler', param: 'paket' },
  scholarships: { label: 'Burslar', param: 'burs' },
  referrals: { label: 'Referans hakları', param: 'referans' },
  withdrawals: { label: 'Ayrılış ve iade', param: 'ayrilis' },
  exports: { label: 'Muhasebe aktarımı', param: 'aktarim' },
  eOzel: { label: 'e-Özel işlem listesi', param: 'e-ozel' },
} as const
type FinanceView = keyof typeof VIEWS
const VIEW_OPTIONS = Object.entries(VIEWS).map(([value, view]) => ({
  value: value as FinanceView,
  label: view.label,
}))
/**
 * Paket satışı yalnız dil okulundadır (IST-078), e-Özel listesi okulda yoktur (IST-085, ADR 0008):
 * kapalı sekme gizlenir, adresi taksitlere düşer.
 */
const viewOptionsFor = (institutionType: string | undefined) =>
  VIEW_OPTIONS.filter(({ value }) => {
    if (value === 'packages') return institutionType === 'language_school'
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
  const viewOptions = viewOptionsFor(session?.institution?.type)
  const tab = viewOf(params.get(VIEW_PARAM), viewOptions)
  const isManager = session?.role === 'yonetici'
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
            { label: 'Tahsil edilen', value: money(totals.paidCents) },
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
      {tab === 'payments' ? <PaymentsSection canReverse={isManager} /> : null}
      {tab === 'dayClosing' ? <FinanceDayClosingSection canReopen={isManager} /> : null}
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
      {tab === 'scholarships' ? (
        <ScholarshipsSection
          canManage={isManager}
          academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
        />
      ) : null}
      {tab === 'referrals' ? <ReferralRewardsSection /> : null}
      {tab === 'withdrawals' ? <WithdrawalsSection canManage={isManager} /> : null}
      {tab === 'exports' ? <FinanceExportSection canDownload={isManager} /> : null}
      {tab === 'exports' && isManager ? (
        <FinanceReconciliationSection
          academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
        />
      ) : null}
      {tab === 'eOzel' ? (
        <EOzelSection academicEnabled={session?.modules.academic === true} />
      ) : null}
      {tab === 'invoices' ? (
        <InvoicesSection onOpenInvoice={openInvoice} onOpenPayment={openPayment} />
      ) : null}
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
