import { useMemo, useState } from 'react'
import {
  useCorporateCustomers,
  useCorporateInvoices,
} from '@kampus/react-shared/use-finance-corporate.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { CorporateCustomerPanel } from './CorporateCustomerPanel.tsx'
import { CorporateInvoicePanel } from './CorporateInvoicePanel.tsx'
import { CustomerFormModal } from './CorporateCustomerFormModal.tsx'

const NO_SORT: readonly string[] = []
const CUSTOMER_MOBILE = ['name', 'employees']
const INVOICE_MOBILE = ['number', 'customerName', 'total']
const OPTION_PAGE_SIZE = 100
const STATUS_OPTIONS = [
  { value: 'issued', label: 'Geçerli' },
  { value: 'cancelled', label: 'İptal edildi' },
]
const filterText = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isInvoiceStatus = (value: string | null): value is 'issued' | 'cancelled' =>
  value === 'issued' || value === 'cancelled'
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/**
 * Kurumsal müşteriler (`?gorunum=kurumsal`; IST-089, DOM-FIN-060): yalnız dil okulunda, yönetici ve
 * ön büro. Şirket kaydı, kursiyer bağı, toplu fatura ve katılım özeti şirket panelindedir
 * (`?kurumsal=`); toplu faturalar ayrı listededir (`?toplu-fatura=`). Fatura iptali yöneticidedir.
 * Şirket yetkilisinin girişi yoktur; rapor personelden PDF ya da CSV olarak verilir.
 */
export function CorporateCustomersSection({ canCancel }: { canCancel: boolean }) {
  return (
    <div className="grid gap-6">
      <CustomersTable />
      <InvoicesTable canCancel={canCancel} />
    </div>
  )
}

type CustomerRow = {
  id: string
  name: string
  taxNumber: string
  employees: number
  contact: string
}

function CustomersTable() {
  const list = useListState('kurumsal-musteriler', { urlPrefix: 'sirket_' })
  const search = useDebouncedValue(list.state.query).trim()
  const customers = useCorporateCustomers({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const panel = useDetailPanel('kurumsal')
  const openCustomer = panel.open
  const [creating, setCreating] = useState(false)

  const rows = useMemo(
    () =>
      customers.data?.data.map((item): CustomerRow => ({
        id: item.id,
        name: item.name,
        taxNumber: `${item.taxOffice} / ${item.taxNumber}`,
        employees: item.activeEmployeeCount,
        contact: item.contactName ?? '—',
      })),
    [customers.data],
  )
  const columns = useMemo<DataColumn<CustomerRow>[]>(
    () => [
      { key: 'name', label: 'Şirket' },
      { key: 'taxNumber', label: 'Vergi dairesi / numarası' },
      { key: 'employees', label: 'Bağlı kursiyer' },
      { key: 'contact', label: 'İletişim kişisi' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} ayrıntısını aç`}
            onClick={() => openCustomer(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openCustomer],
  )

  return (
    <section
      aria-labelledby="kurumsal-musteriler"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="kurumsal-musteriler" className="text-lg font-semibold">
            Kurumsal müşteriler
          </h2>
          <p className="text-sm text-muted-foreground">
            Şirket adına eğitim alan kursiyerler şirkete bağlanır; taksitleri toplu faturalanır.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni şirket
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={customers.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={CUSTOMER_MOBILE}
        caption="Kurumsal müşteriler"
        empty="Henüz kurumsal müşteri yok."
        emptyFiltered="Bu aramayla eşleşen şirket yok."
        loading={customers.isPending}
        fetching={customers.isFetching && !customers.isPending}
        error={
          customers.error ? (
            <QueryError error={customers.error} onRetry={() => void customers.refetch()} />
          ) : undefined
        }
      />
      {creating ? (
        <CustomerFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            openCustomer(id)
          }}
        />
      ) : null}
      <CorporateCustomerPanel customerId={panel.selectedId} onClose={panel.close} />
    </section>
  )
}

type InvoiceRow = {
  id: string
  number: string
  customerName: string
  period: string
  total: number
  lineCount: number
  cancelled: boolean
}

function InvoicesTable({ canCancel }: { canCancel: boolean }) {
  const list = useListState('toplu-faturalar', { urlPrefix: 'fatura_' })
  const customerId = filterText(list.state.filters.customerId)
  const status = filterText(list.state.filters.status)
  const invoices = useCorporateInvoices({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(customerId ? { customerId } : {}),
    ...(isInvoiceStatus(status) ? { status } : {}),
  })
  const customers = useCorporateCustomers({ page: 1, pageSize: OPTION_PAGE_SIZE })
  const panel = useDetailPanel('toplu-fatura')
  const openInvoice = panel.open

  const rows = useMemo(
    () =>
      invoices.data?.data.map((item): InvoiceRow => ({
        id: item.id,
        number: item.number,
        customerName: item.customerName,
        period: `${dayText(item.periodFrom)} – ${dayText(item.periodTo)}`,
        total: item.totalCents,
        lineCount: item.lineCount,
        cancelled: item.cancelledAt !== null,
      })),
    [invoices.data],
  )
  const columns = useMemo<DataColumn<InvoiceRow>[]>(
    () => [
      { key: 'number', label: 'Numara' },
      { key: 'customerName', label: 'Şirket' },
      { key: 'period', label: 'Dönem' },
      { key: 'total', label: 'Toplam', cell: (row) => money(row.total) },
      { key: 'lineCount', label: 'Taksit' },
      {
        key: 'cancelled',
        label: 'Durum',
        cell: (row) =>
          row.cancelled ? (
            <StatusBadge text="İptal edildi" tone="gray" />
          ) : (
            <StatusBadge text="Geçerli" tone="green" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.number} toplu faturasını aç`}
            onClick={() => openInvoice(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openInvoice],
  )
  const filters = useMemo(
    () => [
      {
        key: 'customerId',
        label: 'Şirket',
        type: 'select' as const,
        options: (customers.data?.data ?? []).map((item) => ({
          value: item.id,
          label: item.name,
        })),
      },
      { key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS },
    ],
    [customers.data],
  )

  return (
    <section
      aria-labelledby="toplu-faturalar"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="toplu-faturalar" className="text-lg font-semibold">
          Toplu faturalar
        </h2>
        <p className="text-sm text-muted-foreground">
          Kurum içi toplu dökümdür; resmi fatura muhasebe programında kesilir.
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={invoices.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={INVOICE_MOBILE}
        caption="Toplu faturalar"
        search={false}
        empty="Henüz toplu fatura kesilmedi."
        emptyFiltered="Bu seçimle eşleşen toplu fatura yok."
        loading={invoices.isPending}
        fetching={invoices.isFetching && !invoices.isPending}
        error={
          invoices.error ? (
            <QueryError error={invoices.error} onRetry={() => void invoices.refetch()} />
          ) : undefined
        }
      />
      <CorporateInvoicePanel
        invoiceId={panel.selectedId}
        canCancel={canCancel}
        onClose={panel.close}
      />
    </section>
  )
}
