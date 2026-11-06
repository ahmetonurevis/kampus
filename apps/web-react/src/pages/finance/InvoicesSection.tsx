import { useMemo } from 'react'
import { dateLabel, dayKey, INVOICE_STATUS_LABELS, money } from '@kampus/school-core/lib/format.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll, useCoreFetchAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { sortableColumns } from '@/lib/collection-list.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import {
  CLASS_FILTER_TOO_MANY,
  INVOICE_LIST,
  INVOICE_STATUS_OPTIONS,
  invoiceClassScope,
  invoiceCsvRow,
  invoiceExportQuery,
  invoiceFilterFields,
  invoiceListQuery,
  invoiceRow,
  isInvoiceStatusKey,
  type InvoiceBranchRef,
  type InvoiceClassRef,
  type InvoiceRow,
} from './finance-rows.ts'
import { InvoicePresets } from './InvoicePresets.tsx'
import { InvoiceRemindButton } from './InvoiceRemindButton.tsx'
import { LookupError } from '../academic/AcademicParts.tsx'

const INVOICE_URL_FILTERS = { status: 'durum', branchId: 'kampus', classId: 'sinif' }
const SORTABLE = sortableColumns(INVOICE_LIST)
const MOBILE_COLUMNS = ['installment', 'dueDate', 'amount', 'status']
const CSV_NAME = 'finans-raporu'
const ALL = 'all'

/**
 * Finans & Tahsilat "Taksitler" görünümü: kurumun taksitleri sunucu sayfalı; öğrenci
 * adı/numarası/sınıf araması, ödeme durumu filtresi (hazır çipler aynı süzgeçtir), kampüs/sınıf ve
 * tahsilat tarihi süzgeci (panel), öğrenci/vade/tutar/taksit sıralaması sunucuda uygulanır.
 * Öğrenci adı, okul numarası ve sınıf adı satırın `joined` alanından gelir. Liste durumu yalnız bu
 * görünüm açıkken bağlanır: başka sekmenin adresi taksit süzgecini sıfırlamaz, geri dönünce
 * süzgeç, sayfa ve konum bellekten gelir (ON-109).
 */
export function InvoicesSection({
  onOpenInvoice,
  onOpenPayment,
}: {
  onOpenInvoice: (id: string) => void
  onOpenPayment: (id: string) => void
}) {
  const list = useListState('taksitler', { urlFilters: INVOICE_URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const branchQuery = useCoreAll('branches')
  const classQuery = useCoreAll('classes')
  const branches = useMemo<InvoiceBranchRef[]>(
    () => (branchQuery.data ?? []).map(({ record }) => ({ id: record.id, name: record.name })),
    [branchQuery.data],
  )
  const classes = useMemo<InvoiceClassRef[]>(
    () =>
      (classQuery.data ?? []).map(({ record }) => ({
        id: record.id,
        name: record.name,
        branchId: record.branchId,
      })),
    [classQuery.data],
  )
  const branchFilter =
    typeof list.state.filters.branchId === 'string' ? list.state.filters.branchId : ''
  const filterFields = useMemo(
    () => invoiceFilterFields(branches, classes, branchFilter),
    [branches, classes, branchFilter],
  )
  const classScope = invoiceClassScope(list.state.filters, classes)
  const query = useMemo(
    () => invoiceListQuery(list.state, search, classes),
    [list.state, search, classes],
  )
  // Kampüs süzgeci sınıf listesine çevrilir: sınıflar gelmeden süzülmemiş liste istenmez.
  const active = useCoreList('invoices', query, {
    enabled: branchFilter === '' || classQuery.data !== undefined,
  })

  const today = dayKey()
  const view = useMemo(
    () => ({
      rows: active.data?.rows.map((item) => invoiceRow(item, today)),
      total: active.data?.total ?? 0,
    }),
    [active.data, today],
  )

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
            onClick={() => onOpenInvoice(row.id)}
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
            <span className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                aria-label={`${row.studentName} ${row.installment}. taksiti tahsil et`}
                onClick={() => onOpenPayment(row.id)}
              >
                Tahsil et
              </Button>
              <InvoiceRemindButton row={row} size="sm" />
            </span>
          ),
      },
    ],
    [onOpenInvoice, onOpenPayment],
  )

  function download() {
    const csvColumns = columns.filter((column) => column.key !== ACTIONS_KEY)
    void csv.download(CSV_NAME, csvColumns, async () => {
      const items = await fetchAll(invoiceExportQuery(list.state, search, classes))
      return items.map((item) => invoiceCsvRow(invoiceRow(item, today)))
    })
  }

  const error = active.error
  return (
    <>
      {branchQuery.error || classQuery.error ? (
        <LookupError
          error={branchQuery.error ?? classQuery.error}
          onRetry={() => {
            void branchQuery.refetch()
            void classQuery.refetch()
          }}
        />
      ) : null}
      <section
        aria-labelledby="taksit-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-4 px-6 pt-6 pb-2">
          <div className="min-w-0">
            <h2 id="taksit-tablosu" className="text-lg font-semibold">
              Taksit ve tahsilat listesi
            </h2>
            <p className="text-sm text-muted-foreground">
              {view.total} kayıt · Kurum genelinde ödeme hareketleri
            </p>
            {classScope.kind === 'too_many' ? (
              <p role="status" className="mt-2 text-sm text-muted-foreground">
                {CLASS_FILTER_TOO_MANY}
              </p>
            ) : null}
          </div>
          <Button
            variant="secondary"
            onClick={download}
            disabled={csv.busy}
            aria-busy={csv.busy || undefined}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            Raporu indir
          </Button>
        </header>
        <ServerDataTable
          list={list}
          rows={view.rows}
          total={view.total}
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Taksit ve tahsilat listesi"
          loading={active.isPending}
          fetching={active.isFetching && !active.isPending}
          error={
            error ? <QueryError error={error} onRetry={() => void active.refetch()} /> : undefined
          }
          onRowClick={(row) => onOpenInvoice(row.id)}
          filters={filterFields}
          presets={<InvoicePresets value={statusKey} onChange={setStatus} />}
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
    </>
  )
}
