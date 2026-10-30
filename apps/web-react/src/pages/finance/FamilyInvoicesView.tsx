import { useMemo } from 'react'
import { Link } from 'react-router'
import { dateLabel, dayKey, INVOICE_STATUS_LABELS, money } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreCounts, useCoreFetchAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { sortableColumns } from '@/lib/collection-list.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { LookupError, StatGrid, TableSection } from '../academic/AcademicParts.tsx'
import {
  familyInvoiceCsvRow,
  familyInvoiceExportQuery,
  familyInvoiceListQuery,
  familyTotalsQuery,
  INVOICE_LIST,
  INVOICE_STATUS_OPTIONS,
  invoiceRow,
  invoiceTotals,
  isInvoiceStatusKey,
  remainingAmount,
  type FamilyScope,
  type InvoiceRow,
} from './finance-rows.ts'
import { InvoiceSummaryPanel } from './InvoiceSummaryPanel.tsx'

const URL_FILTERS = { status: 'durum' }
const SORTABLE = sortableColumns(INVOICE_LIST)
const MOBILE_COLUMNS = ['installment', 'dueDate', 'amount', 'status']
const ALL = 'all'

type Props = {
  audience: 'parent' | 'student'
  /** Veli: seçili çocuk. Öğrencide boştur. */
  studentId: string
  /** Dekontlar: yalnız ödenmiş taksitler. */
  receiptsOnly?: boolean
  /** Görünen ad (başlık, tablo ve CSV adı). */
  title: string
}

/**
 * Taksit listesi (veli `finans`/`dekontlar`, öğrenci `odemelerim`; Vue `Finance.vue` veli/öğrenci
 * görünümü): seçili çocuğun (öğrencide kendi) taksitleri sunucu sayfalı; durum filtresi, vade/tutar
 * sıralaması ve arama sunucuda uygulanır. Kalan tutar kayıtlardan hesaplanır. Ödenmiş taksitte
 * dekont açılır; çevrim içi ödeme yoktur (`invoice.pay` yalnız yönetici ve ön büro), ödeme okulun
 * tahsilat birimince kaydedilir. Kapsamı sunucu uygular: başka öğrencinin taksidi 404 verir.
 */
export function FamilyInvoicesView({ audience, studentId, receiptsOnly = false, title }: Props) {
  const parent = audience === 'parent'
  const scope = useMemo<FamilyScope>(
    () => ({ studentId, paidOnly: receiptsOnly }),
    [studentId, receiptsOnly],
  )
  const list = useListState(`${audience}-${receiptsOnly ? 'dekontlar' : 'taksitler'}`, {
    urlFilters: receiptsOnly ? {} : URL_FILTERS,
  })
  const search = useDebouncedValue(list.state.query)
  const query = useMemo(
    () => familyInvoiceListQuery(list.state, search, scope),
    [list.state, search, scope],
  )
  const active = useCoreList('invoices', query)
  const totalsQuery = useCoreCounts('invoices', familyTotalsQuery(studentId))
  const totals = useMemo(
    () => (totalsQuery.data ? invoiceTotals(totalsQuery.data) : null),
    [totalsQuery.data],
  )
  const today = dayKey()
  const rows = useMemo(
    () => active.data?.rows.map((item) => invoiceRow(item, today)),
    [active.data, today],
  )
  const total = active.data?.total ?? 0

  const panel = useDetailPanel('detay')
  const openInvoice = panel.open
  const fetchAll = useCoreFetchAll('invoices')
  const csv = useCsvExport()

  const status = list.state.filters.status
  const statusKey = !receiptsOnly && isInvoiceStatusKey(status) ? status : ''
  const setStatus = (value: string) =>
    list.dispatch({ type: 'filter', key: 'status', value: value === ALL ? '' : value })

  const columns = useMemo<DataColumn<InvoiceRow>[]>(
    () => [
      {
        key: 'installment',
        label: 'Taksit',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openInvoice(row.id)}
            aria-label={`${row.installment}. taksit detayını aç`}
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
      {
        key: 'remaining',
        label: 'Kalan tutar',
        cell: (row) => (row.paidAt ? '—' : money(remainingAmount(row))),
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
              ariaLabel={`${row.installment}. taksit dekontunu görüntüle`}
            />
          ) : null,
      },
    ],
    [openInvoice],
  )

  function download() {
    const csvColumns = columns.filter((column) => column.key !== ACTIONS_KEY)
    void csv.download(title.toLocaleLowerCase('tr').replaceAll(' ', '-'), csvColumns, async () => {
      const items = await fetchAll(familyInvoiceExportQuery(list.state, search, scope))
      return items.map((item) => familyInvoiceCsvRow(invoiceRow(item, today)))
    })
  }

  return (
    <>
      {totalsQuery.error ? (
        <LookupError error={totalsQuery.error} onRetry={() => void totalsQuery.refetch()} />
      ) : null}
      {totals ? (
        <StatGrid
          label="Ödeme özeti"
          items={[
            {
              label: 'Toplam eğitim bedeli',
              value: money(totals.total),
              note: 'Tüm ödeme planı',
            },
            { label: 'Ödenen', value: money(totals.paid) },
            {
              label: 'Kalan bakiye',
              value: money(totals.remaining),
              note: 'Gelecek ve gecikmiş taksitler',
            },
            { label: 'Gecikmiş tutar', value: money(totals.overdue) },
          ]}
        />
      ) : null}
      {parent && !receiptsOnly ? (
        <p
          role="note"
          className="info-box mb-6 rounded-card border bg-surface-soft px-4 py-3 text-sm"
        >
          Ödemeler çevrim içi yapılmaz; okulun tahsilat birimi kaydeder.{' '}
          <Link to="/veli/odeme-yap" className="font-medium text-primary hover:underline">
            Ödeme bilgisi için okulla iletişime geçin
          </Link>
          .
        </p>
      ) : null}
      <TableSection
        title={receiptsOnly ? 'Ödeme dekontları' : 'Taksit listesi'}
        subtitle={`${total} kayıt · Güncel ödeme planı${audience === 'student' ? ' · Salt okunur' : ''}`}
        onDownload={download}
        downloadBusy={csv.busy}
      >
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption={title}
          loading={active.isPending}
          fetching={active.isFetching && !active.isPending}
          error={
            active.error ? (
              <QueryError error={active.error} onRetry={() => void active.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openInvoice(row.id)}
          externalActive={statusKey !== ''}
          externalLabel={statusKey ? `Ödeme durumu: ${INVOICE_STATUS_LABELS[statusKey]}` : ''}
          onReset={() => setStatus(ALL)}
          toolbar={
            receiptsOnly ? undefined : (
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
            )
          }
        />
      </TableSection>
      <InvoiceSummaryPanel invoiceId={panel.selectedId} onClose={panel.close} />
    </>
  )
}
