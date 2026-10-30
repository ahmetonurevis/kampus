import { useMemo } from 'react'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll, useCoreFetchAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { isSearchActive, sortableColumns } from '@/lib/collection-list.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import {
  financeLookups,
  INVOICE_LIST,
  INVOICE_STATUSES,
  invoiceCsvRow,
  invoiceListPlan,
  invoiceRow,
  isInvoiceStatusSlug,
  matchingStudentIds,
  selectInvoicePage,
  type InvoiceRow,
} from './finance-rows.ts'
import { InvoiceSummaryPanel } from './InvoiceSummaryPanel.tsx'
import { PaymentPanel } from './PaymentPanel.tsx'

const INVOICE_URL_FILTERS = { status: 'durum' }
const SORTABLE = sortableColumns(INVOICE_LIST)
const MOBILE_COLUMNS = ['installment', 'dueDate', 'amount', 'status']
const CSV_NAME = 'finans-raporu'
const ALL = 'all'
const NONE: readonly never[] = []
const STATUS_OPTIONS = Object.entries(INVOICE_STATUSES)

/**
 * Finans & Tahsilat (yönetici `/finans`, ön büro `/tahsilat-takip`; Vue `Finance.vue`): kurumun
 * taksitleri sunucu sayfalı; öğrenci araması, ödeme durumu filtresi, vade/tutar/taksit sıralaması,
 * satırdan taksit detayı ve CSV.
 * TODO(api-aggregate): Vue'daki toplam/tahsil edilen/kalan/gecikmiş kartları toplu uçla gelir.
 * TODO(api-invoice-status): durum filtresi sunucuda olmadığından durum seçilince filtrenin bütün
 * taksitleri çekilir (bkz. `invoiceListPlan`).
 */
export function FinancePage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const students = useCoreAll('students')
  const classes = useCoreAll('classes')
  const lookups = useMemo(
    () => financeLookups(students.data ?? NONE, classes.data ?? NONE),
    [students.data, classes.data],
  )
  const lookupsPending = students.isPending || classes.isPending
  const lookupsError = students.error ?? classes.error

  const list = useListState('taksitler', { urlFilters: INVOICE_URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const searching = isSearchActive(search)
  // Arama öğrenci eşlemesine dayanır; öğrenciler gelmeden sorgu kurulmaz.
  const canQuery = !searching || !lookupsPending
  const studentIds = useMemo(
    () => (searching ? matchingStudentIds(lookups, search) : null),
    [searching, lookups, search],
  )
  const plan = useMemo(() => invoiceListPlan(list.state, studentIds), [list.state, studentIds])
  const pageQuery = useCoreList('invoices', plan.kind === 'server' ? plan.query : {}, {
    enabled: canQuery && plan.kind === 'server',
  })
  const allQuery = useCoreAll('invoices', plan.kind === 'all' ? plan.query : {}, {
    enabled: canQuery && plan.kind === 'all',
  })
  const active = plan.kind === 'all' ? allQuery : pageQuery

  const today = dayKey()
  const view = useMemo(() => {
    if (plan.kind === 'empty') return { rows: NONE, total: 0 }
    if (plan.kind === 'server') {
      const data = pageQuery.data
      return {
        rows: data?.rows.map((item) => invoiceRow(item, lookups, today)),
        total: data?.total ?? 0,
      }
    }
    if (!allQuery.data) return { rows: undefined, total: 0 }
    const rows = allQuery.data.map((item) => invoiceRow(item, lookups, today))
    return selectInvoicePage(rows, list.state, plan.status)
  }, [plan, pageQuery.data, allQuery.data, lookups, today, list.state])

  const panel = useDetailPanel('detay')
  const openInvoice = panel.open
  const payment = useDetailPanel('tahsilat')
  const openPayment = payment.open
  const fetchAll = useCoreFetchAll('invoices')
  const csv = useCsvExport()

  const status = list.state.filters.status
  const statusSlug = isInvoiceStatusSlug(status) ? status : ''
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
              <small className="text-xs text-muted-foreground">
                {row.className} · No: {row.studentNumber}
              </small>
            </span>
          </span>
        ),
      },
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
        // TODO(pdf-receipt): ödenmiş taksitte "Dekont" düğmesi PDF görevinde eklenir.
        cell: (row) =>
          row.paidAt ? null : (
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
      if (plan.kind === 'empty') return []
      const rows = (await fetchAll(plan.query)).map((item) => invoiceRow(item, lookups, today))
      const filtered = plan.kind === 'all' ? rows.filter((row) => row.status === plan.status) : rows
      return filtered.map(invoiceCsvRow)
    })
  }

  const loading = lookupsPending || (plan.kind !== 'empty' && active.isPending)
  const error = active.error ?? lookupsError
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <Button
            variant="secondary"
            onClick={download}
            disabled={csv.busy || lookupsPending}
            aria-busy={csv.busy || undefined}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            Raporu indir
          </Button>
        }
      />
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
            error ? (
              <QueryError
                error={error}
                onRetry={() => {
                  if (lookupsError) {
                    void students.refetch()
                    void classes.refetch()
                  }
                  void active.refetch()
                }}
              />
            ) : undefined
          }
          onRowClick={(row) => openInvoice(row.id)}
          externalActive={statusSlug !== ''}
          externalLabel={statusSlug ? `Ödeme durumu: ${INVOICE_STATUSES[statusSlug]}` : ''}
          onReset={() => setStatus(ALL)}
          toolbar={
            <NativeSelect
              aria-label="Ödeme durumu"
              value={statusSlug || ALL}
              onChange={(event) => setStatus(event.target.value)}
              className="min-h-9 text-sm"
            >
              <NativeSelectOption value={ALL}>Tüm durumlar</NativeSelectOption>
              {STATUS_OPTIONS.map(([slug, label]) => (
                <NativeSelectOption key={slug} value={slug}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          }
        />
      </section>
      <InvoiceSummaryPanel
        invoiceId={panel.selectedId}
        lookups={lookups}
        onClose={panel.close}
        actions={(row) => (
          <Button onClick={() => openPayment(row.id)}>
            <Icon name="Wallet" size={17} aria-hidden="true" />
            Tahsil et
          </Button>
        )}
      />
      <PaymentPanel invoiceId={payment.selectedId} lookups={lookups} onClose={payment.close} />
    </>
  )
}
