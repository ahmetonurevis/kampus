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
import { FeeTariffsSection } from './FeeTariffsSection.tsx'
import { ScholarshipsSection } from './ScholarshipsSection.tsx'
import { FinanceExportSection } from './FinanceExportSection.tsx'
import { FinanceReconciliationSection } from './FinanceReconciliationSection.tsx'
import { InvoicesSection } from './InvoicesSection.tsx'
import { InvoiceSummaryPanel } from './InvoiceSummaryPanel.tsx'
import { PaymentPanel } from './PaymentPanel.tsx'
import { PaymentsSection } from './PaymentsSection.tsx'
import { ContractsSection } from './ContractsSection.tsx'
import { WithdrawalsSection } from './WithdrawalsSection.tsx'
import { LookupError, StatGrid } from '../academic/AcademicParts.tsx'

const VIEW_PARAM = 'gorunum'
const VIEWS = {
  invoices: { label: 'Taksitler', param: '' },
  payments: { label: 'Tahsilat geçmişi', param: 'tahsilatlar' },
  contracts: { label: 'Sözleşmeler', param: 'sozlesmeler' },
  tariffs: { label: 'Ücret tarifesi', param: 'tarife' },
  scholarships: { label: 'Burslar', param: 'burs' },
  withdrawals: { label: 'Ayrılış ve iade', param: 'ayrilis' },
  exports: { label: 'Muhasebe aktarımı', param: 'aktarim' },
} as const
type FinanceView = keyof typeof VIEWS
const VIEW_OPTIONS = Object.entries(VIEWS).map(([value, view]) => ({
  value: value as FinanceView,
  label: view.label,
}))
const viewOf = (param: string | null): FinanceView =>
  VIEW_OPTIONS.find(({ value }) => param !== null && VIEWS[value].param === param)?.value ??
  'invoices'

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
  const tab = viewOf(params.get(VIEW_PARAM))
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
        options={VIEW_OPTIONS}
        onChange={(next) =>
          setParams(
            next === 'invoices' ? new URLSearchParams() : { [VIEW_PARAM]: VIEWS[next].param },
          )
        }
      />
      {tab === 'payments' ? <PaymentsSection canReverse={isManager} /> : null}
      {tab === 'contracts' ? <ContractsSection /> : null}
      {tab === 'tariffs' ? (
        <FeeTariffsSection
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
      {tab === 'withdrawals' ? <WithdrawalsSection canManage={isManager} /> : null}
      {tab === 'exports' ? <FinanceExportSection canDownload={isManager} /> : null}
      {tab === 'exports' && isManager ? (
        <FinanceReconciliationSection
          academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
        />
      ) : null}
      {tab === 'invoices' ? (
        <InvoicesSection onOpenInvoice={openInvoice} onOpenPayment={openPayment} />
      ) : null}
      <InvoiceSummaryPanel
        invoiceId={panel.selectedId}
        onClose={panel.close}
        actions={(row) => (
          <Button onClick={() => openPayment(row.id)}>
            <Icon name="Wallet" size={17} aria-hidden="true" />
            Tahsil et
          </Button>
        )}
      />
      <PaymentPanel invoiceId={payment.selectedId} onClose={payment.close} />
    </>
  )
}
