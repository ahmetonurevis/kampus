import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  useSupplierLedger,
  useSupplierStatement,
} from '@kampus/react-shared/use-finance-supplier-ledger.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  STATEMENT_MOVEMENT_LABELS,
  SUPPLIER_PAYMENT_METHOD_LABELS,
} from '@kampus/school-core/lib/finance-supplier-ledger.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { dayText } from './finance-supplier-ledger-forms.ts'
import { SupplierInvoicesPanel } from './SupplierInvoicesPanel.tsx'
import { SupplierPaymentsPanel } from './SupplierPaymentsPanel.tsx'

const VIEW_PARAM = 'cari'
const VIEWS = {
  summary: { label: 'Cari özet', param: '' },
  invoices: { label: 'Faturalar', param: 'fatura' },
  payments: { label: 'Ödemeler ve talimat', param: 'odeme' },
} as const
type LedgerView = keyof typeof VIEWS
const VIEW_OPTIONS = Object.entries(VIEWS).map(([value, view]) => ({
  value: value as LedgerView,
  label: view.label,
}))
const NO_SORT: readonly string[] = []
const MOBILE = ['supplier', 'balance', 'overdue']
const BALANCE_OPTIONS = [
  { value: 'open', label: 'Bakiyesi olan' },
  { value: 'overdue', label: 'Vadesi geçmiş' },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

type Row = {
  id: string
  supplier: string
  invoices: number
  invoiced: number
  balance: number
  overdue: number
  nextDue: string
}

/**
 * Tedarikçi carisi (`?gorunum=tedarikci-cari`; DOM-FIN-076, ON-143): cari özet, faturalar ve ödeme
 * planı, ödemeler ve talimat dosyası. Yalnız yönetici (K-160). Kampüs muhasebe defteri tutmaz
 * (IST-142): bu ekran yönetim takibidir, resmi kayıt muhasebe programındadır.
 */
export function FinanceSupplierLedgerSection() {
  const [params, setParams] = useSearchParams()
  const view =
    VIEW_OPTIONS.find(({ value }) => {
      const param = params.get(VIEW_PARAM)
      return VIEWS[value].param !== '' && VIEWS[value].param === param
    })?.value ?? 'summary'
  const changeView = (next: LedgerView) =>
    setParams((current) => {
      const updated = new URLSearchParams()
      const finance = current.get('gorunum')
      if (finance) updated.set('gorunum', finance)
      if (VIEWS[next].param) updated.set(VIEW_PARAM, VIEWS[next].param)
      return updated
    })
  return (
    <section
      aria-labelledby="tedarikci-carisi"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="tedarikci-carisi" className="text-lg font-semibold">
            Tedarikçi carisi
          </h2>
          <p className="text-sm text-muted-foreground">
            Tedarikçi faturaları, ödeme planı ve ödemeler. Yönetim takibidir; resmi muhasebe kaydı
            muhasebe programında tutulur.
          </p>
        </div>
        <LineTabs
          label="Tedarikçi carisi görünümü"
          value={view}
          options={VIEW_OPTIONS}
          onChange={changeView}
        />
      </header>
      {view === 'summary' ? <LedgerSummary /> : null}
      {view === 'invoices' ? <SupplierInvoicesPanel /> : null}
      {view === 'payments' ? <SupplierPaymentsPanel /> : null}
    </section>
  )
}

function LedgerSummary() {
  const list = useListState('tedarikci-carisi', { urlPrefix: 'cari_' })
  const search = useDebouncedValue(list.state.query).trim()
  const balance = text(list.state.filters.balance)
  const ledger = useSupplierLedger({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(balance === 'open' || balance === 'overdue' ? { balance } : {}),
  })
  const panel = useDetailPanel('ekstre')
  const openStatement = panel.open
  const totals = ledger.data?.meta.totals
  const rows = useMemo(
    () =>
      ledger.data?.data.map((item): Row => ({
        id: item.supplier.id,
        supplier: item.supplier.name,
        invoices: item.invoiceCount,
        invoiced: item.invoicedCents,
        balance: item.balanceCents,
        overdue: item.overdueCents,
        nextDue: dayText(item.nextDueDate),
      })),
    [ledger.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'supplier', label: 'Tedarikçi' },
      { key: 'invoices', label: 'Fatura' },
      { key: 'invoiced', label: 'Faturalanan', cell: (row) => money(row.invoiced) },
      { key: 'balance', label: 'Bakiye', cell: (row) => money(row.balance) },
      {
        key: 'overdue',
        label: 'Vadesi geçmiş',
        cell: (row) =>
          row.overdue > 0 ? <StatusBadge text={money(row.overdue)} tone="red" /> : money(0),
      },
      { key: 'nextDue', label: 'İlk açık vade' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.supplier} ekstresini aç`}
            onClick={() => openStatement(row.id)}
          >
            Ekstre
          </Button>
        ),
      },
    ],
    [openStatement],
  )
  const filters = useMemo(
    () => [{ key: 'balance', label: 'Bakiye', type: 'select' as const, options: BALANCE_OPTIONS }],
    [],
  )
  return (
    <div className="grid gap-2 pt-4">
      {totals ? (
        <div className="px-6">
          <StatGrid
            label="Tedarikçi carisi toplamları"
            items={[
              { label: 'Faturalanan', value: money(totals.invoicedCents) },
              { label: 'Ödenen', value: money(totals.paidCents) },
              { label: 'Bakiye', value: money(totals.balanceCents), note: 'Kurumun borcu' },
              { label: 'Vadesi geçmiş', value: money(totals.overdueCents) },
            ]}
          />
        </div>
      ) : null}
      <ServerDataTable
        list={list}
        rows={rows}
        total={ledger.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={MOBILE}
        caption="Tedarikçi carisi"
        empty="Henüz tedarikçi faturası yok. Faturalar sekmesinden fatura ekleyin."
        emptyFiltered="Bu seçimle eşleşen tedarikçi yok."
        loading={ledger.isPending}
        fetching={ledger.isFetching && !ledger.isPending}
        error={
          ledger.error ? (
            <QueryError error={ledger.error} onRetry={() => void ledger.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Tedarikçi ekstresi"
      >
        {panel.selectedId ? <Statement supplierId={panel.selectedId} /> : null}
      </SidePanel>
    </div>
  )
}

const STATEMENT_PAGE_SIZE = 20

function Statement({ supplierId }: { supplierId: string }) {
  const [page, setPage] = useState(1)
  const statement = useSupplierStatement(supplierId, { page, pageSize: STATEMENT_PAGE_SIZE })
  if (statement.error)
    return <QueryError error={statement.error} onRetry={() => void statement.refetch()} />
  const data = statement.data?.data
  if (!data) return <SummaryLoading />
  const total = statement.data?.meta.total ?? 0
  const pages = Math.max(Math.ceil(total / STATEMENT_PAGE_SIZE), 1)
  return (
    <div className="grid gap-5">
      <section aria-labelledby="ekstre-tedarikci" className="grid gap-2">
        <h3 id="ekstre-tedarikci" className="text-base font-semibold">
          {data.supplier.name}
        </h3>
        <dl className="grid gap-1 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">Vergi numarası</dt>
            <dd className="tabular-nums">{data.supplier.taxNumber}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">IBAN</dt>
            <dd className="tabular-nums">{data.supplier.iban ?? 'Tanımlı değil'}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">Faturalanan / ödenen</dt>
            <dd className="tabular-nums">{`${money(data.invoicedCents)} / ${money(data.paidCents)}`}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2 font-semibold">
            <dt>Bakiye</dt>
            <dd className="tabular-nums">{money(data.balanceCents)}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">Vadesi geçmiş</dt>
            <dd className="tabular-nums">{money(data.overdueCents)}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="ekstre-hareketleri" className="grid gap-2">
        <h3 id="ekstre-hareketleri" className="text-base font-semibold">
          Hareketler
        </h3>
        {data.movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Hareket yok.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Ekstre hareketleri">
            {data.movements.map((movement) => (
              <li
                key={`${movement.kind}-${movement.paymentId ?? movement.invoiceId}`}
                className="grid grid-cols-[1fr_auto] gap-x-3 rounded-lg border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{STATEMENT_MOVEMENT_LABELS[movement.kind]}</span>
                  <span className="block text-muted-foreground">
                    {`${dayText(movement.date)} · Fatura ${movement.invoiceNumber}${movement.method ? ` · ${SUPPLIER_PAYMENT_METHOD_LABELS[movement.method]}` : ''}`}
                  </span>
                </span>
                <span className="text-right tabular-nums">
                  <span className="block font-medium">
                    {movement.debitCents > 0
                      ? `+${money(movement.debitCents)}`
                      : `−${money(movement.creditCents)}`}
                  </span>
                  <span className="block text-muted-foreground">{`Bakiye ${money(movement.balanceCents)}`}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 ? (
          <nav aria-label="Ekstre sayfaları" className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Daha yeni
            </Button>
            <span className="text-sm text-muted-foreground">{`${String(page)} / ${String(pages)}`}</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= pages}
              onClick={() => setPage((current) => current + 1)}
            >
              Daha eski
            </Button>
          </nav>
        ) : null}
      </section>
    </div>
  )
}
