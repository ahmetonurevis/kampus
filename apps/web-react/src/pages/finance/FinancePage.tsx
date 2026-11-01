import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { dateLabel, dayKey, INVOICE_STATUS_LABELS, money } from '@kampus/school-core/lib/format.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreCounts, useCoreFetchAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { sortableColumns } from '@/lib/collection-list.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import {
  INVOICE_LIST,
  INVOICE_STATUS_OPTIONS,
  invoiceCsvRow,
  invoiceExportQuery,
  invoiceListQuery,
  invoiceRow,
  invoiceTotals,
  isInvoiceStatusKey,
  type InvoiceRow,
} from './finance-rows.ts'
import { FeeTariffsSection } from './FeeTariffsSection.tsx'
import { FinanceExportSection } from './FinanceExportSection.tsx'
import { InvoiceSummaryPanel } from './InvoiceSummaryPanel.tsx'
import { PaymentPanel } from './PaymentPanel.tsx'
import { PaymentsSection } from './PaymentsSection.tsx'
import { LookupError, StatGrid } from '../academic/AcademicParts.tsx'

const INVOICE_URL_FILTERS = { status: 'durum' }
const SORTABLE = sortableColumns(INVOICE_LIST)
const MOBILE_COLUMNS = ['installment', 'dueDate', 'amount', 'status']
const CSV_NAME = 'finans-raporu'
const ALL = 'all'
const TOTALS_QUERY = { groupBy: 'status', sum: 'amount' } as const
const VIEW_PARAM = 'gorunum'
const VIEWS = {
  invoices: { label: 'Taksitler', param: '' },
  payments: { label: 'Tahsilat geçmişi', param: 'tahsilatlar' },
  tariffs: { label: 'Ücret tarifesi', param: 'tarife' },
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
 * Finans & Tahsilat (yönetici `/finans`, ön büro `/tahsilat-takip`; Vue `Finance.vue`): kurumun
 * taksitleri sunucu sayfalı; öğrenci adı/numarası/sınıf araması, ödeme durumu filtresi,
 * öğrenci/vade/tutar/taksit sıralaması sunucuda uygulanır. Toplam kartları kurum geneli
 * `counts?groupBy=status&sum=amount` yanıtından gelir (liste araması ve durumundan bağımsız).
 * Öğrenci adı, okul numarası ve sınıf adı satırın `joined` alanından gelir; ayrı öğrenci/sınıf listesi çekilmez.
 */
export function FinancePage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = viewOf(params.get(VIEW_PARAM))
  const isManager = session?.role === 'yonetici'
  const list = useListState('taksitler', { urlFilters: INVOICE_URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const query = useMemo(() => invoiceListQuery(list.state, search), [list.state, search])
  const active = useCoreList('invoices', query)
  const totalsQuery = useCoreCounts('invoices', TOTALS_QUERY)
  const totals = useMemo(
    () => (totalsQuery.data ? invoiceTotals(totalsQuery.data) : null),
    [totalsQuery.data],
  )

  const today = dayKey()
  const view = useMemo(
    () => ({
      rows: active.data?.rows.map((item) => invoiceRow(item, today)),
      total: active.data?.total ?? 0,
    }),
    [active.data, today],
  )

  const panel = useDetailPanel('detay')
  const openInvoice = panel.open
  const payment = useDetailPanel('tahsilat')
  const openPayment = payment.open
  const fetchAll = useCoreFetchAll('invoices')
  const csv = useCsvExport()

  const status = list.state.filters.status
  const statusKey = isInvoiceStatusKey(status) ? status : ''
  const setStatus = (value: string) =>
    list.dispatch({ type: 'filter', key: 'status', value: value === ALL ? '' : value })

  const columns = useMemo<DataColumn<InvoiceRow>[]>(
    () => [
      {
        key: 'studentName',
        label: 'Öğrenci',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.studentName} size="small" />
            <span className="grid min-w-0">
              <strong className="font-medium">{row.studentName}</strong>
              <small className="text-xs text-muted-foreground">{row.className}</small>
            </span>
          </span>
        ),
      },
      { key: 'studentNumber', label: 'Okul no' },
      {
        key: 'installment',
        label: 'Taksit',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openInvoice(row.id)}
            aria-label={`${row.studentName} ${row.installment}. taksit detayını aç`}
            className="record-link text-left font-medium text-primary hover:underline"
          >
            {row.installment}. taksit
          </button>
        ),
      },
      {
        key: 'dueDate',
        label: 'Vade tarihi',
        cell: (row) => dateLabel(row.dueDate, { year: 'numeric' }),
      },
      {
        key: 'amount',
        label: 'Tutar',
        cell: (row) => <strong className="font-semibold">{money(row.amount)}</strong>,
      },
      { key: 'status', label: 'Durum', cell: (row) => <StatusBadge text={row.status} /> },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) =>
          row.paidAt ? (
            <PdfButton
              type="receipt"
              recordId={row.id}
              label="Dekont"
              ariaLabel={`${row.studentName} ${row.installment}. taksit dekontunu görüntüle`}
            />
          ) : (
            <Button
              size="sm"
              aria-label={`${row.studentName} ${row.installment}. taksiti tahsil et`}
              onClick={() => openPayment(row.id)}
            >
              Tahsil et
            </Button>
          ),
      },
    ],
    [openInvoice, openPayment],
  )

  function download() {
    const csvColumns = columns.filter((column) => column.key !== ACTIONS_KEY)
    void csv.download(CSV_NAME, csvColumns, async () => {
      const items = await fetchAll(invoiceExportQuery(list.state, search))
      return items.map((item) => invoiceCsvRow(invoiceRow(item, today)))
    })
  }

  const loading = active.isPending
  const error = active.error
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <Button
            variant="secondary"
            onClick={download}
            disabled={csv.busy}
            aria-busy={csv.busy || undefined}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            Raporu indir
          </Button>
        }
      />
      {totalsQuery.error ? (
        <LookupError error={totalsQuery.error} onRetry={() => void totalsQuery.refetch()} />
      ) : null}
      {totals ? (
        <StatGrid
          label="Kurum geneli ödeme toplamları"
          items={[
            {
              label: 'Toplam eğitim bedeli',
              value: money(totals.total),
              note: 'Tüm ödeme planları',
            },
            { label: 'Tahsil edilen', value: money(totals.paid) },
            {
              label: 'Kalan bakiye',
              value: money(totals.remaining),
              note: 'Gelecek ve gecikmiş taksitler',
            },
            { label: 'Gecikmiş tutar', value: money(totals.overdue) },
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
      {tab === 'tariffs' ? (
        <FeeTariffsSection
          canManage={isManager}
          academicYear={session?.institution?.academicYear ?? Number(today.slice(0, 4))}
        />
      ) : null}
      {tab === 'exports' ? <FinanceExportSection canDownload={isManager} /> : null}
      {tab === 'invoices' ? (
        <section
          aria-labelledby="taksit-tablosu"
          className="panel overflow-hidden rounded-card border bg-surface"
        >
          <header className="panel-heading px-6 pt-6 pb-2">
            <h2 id="taksit-tablosu" className="text-lg font-semibold">
              Taksit ve tahsilat listesi
            </h2>
            <p className="text-sm text-muted-foreground">
              {view.total} kayıt · Kurum genelinde ödeme hareketleri
            </p>
          </header>
          <ServerDataTable
            list={list}
            rows={view.rows}
            total={view.total}
            sortable={SORTABLE}
            columns={columns}
            mobileColumns={MOBILE_COLUMNS}
            caption="Taksit ve tahsilat listesi"
            loading={loading}
            fetching={active.isFetching && !active.isPending}
            error={
              error ? <QueryError error={error} onRetry={() => void active.refetch()} /> : undefined
            }
            onRowClick={(row) => openInvoice(row.id)}
            externalActive={statusKey !== ''}
            externalLabel={statusKey ? `Ödeme durumu: ${INVOICE_STATUS_LABELS[statusKey]}` : ''}
            onReset={() => setStatus(ALL)}
            toolbar={
              <NativeSelect
                aria-label="Ödeme durumu"
                value={statusKey || ALL}
                onChange={(event) => setStatus(event.target.value)}
                className="min-h-9 text-sm"
              >
                <NativeSelectOption value={ALL}>Tüm durumlar</NativeSelectOption>
                {INVOICE_STATUS_OPTIONS.map(({ key, label }) => (
                  <NativeSelectOption key={key} value={key}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            }
          />
        </section>
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
