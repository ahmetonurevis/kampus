import { useMemo, useState } from 'react'
import { useSuppliers } from '@kampus/react-shared/use-finance-procurement.ts'
import {
  useSupplierInvoiceMatches,
  useSupplierInvoiceMatchExport,
  type SupplierInvoiceMatchQuery,
} from '@kampus/react-shared/use-finance-supplier-ledger.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import { dayKey, money } from '@kampus/school-core/lib/format.ts'
import {
  INVOICE_MATCH_APPROVAL_FILTERS,
  INVOICE_MATCH_FILTERS,
  INVOICE_MATCH_STATUS_LABELS,
  type InvoiceMatchApprovalFilter,
  type InvoiceMatchFilter,
  type InvoiceMatchStatus,
} from '@kampus/school-core/lib/finance-invoice-matching.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { dayText, MATCH_STATUS_VIEW } from './finance-supplier-ledger-forms.ts'
import { InvoiceDetail } from './SupplierInvoicesPanel.tsx'

const BOM = '﻿'
const NO_SORT: readonly string[] = []
const MOBILE = ['invoiceNumber', 'supplier', 'status']
const FILTER_LABELS = {
  mismatched: 'Eşleşmeyenler',
  ...INVOICE_MATCH_STATUS_LABELS,
} as const satisfies Record<InvoiceMatchFilter, string>
const APPROVAL_LABELS = {
  pending: 'Onay bekleyen',
  approved: 'Farkı onaylanmış',
} as const satisfies Record<InvoiceMatchApprovalFilter, string>
const STATUS_OPTIONS = INVOICE_MATCH_FILTERS.filter((value) => value !== 'mismatched').map(
  (value) => ({ value, label: FILTER_LABELS[value] }),
)
const APPROVAL_OPTIONS = INVOICE_MATCH_APPROVAL_FILTERS.map((value) => ({
  value,
  label: APPROVAL_LABELS[value],
}))
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isFilter = (value: string | null): value is InvoiceMatchFilter =>
  INVOICE_MATCH_FILTERS.some((item) => item === value)
const isApproval = (value: string | null): value is InvoiceMatchApprovalFilter =>
  INVOICE_MATCH_APPROVAL_FILTERS.some((item) => item === value)

type Row = {
  id: string
  invoiceNumber: string
  supplier: string
  order: string
  invoiceDate: string
  gross: number
  issues: string
  status: InvoiceMatchStatus
  approved: boolean
}

function issueText(row: { quantityLines: number; priceLines: number; unmatchedLines: number }) {
  const parts = [
    row.quantityLines > 0 ? `${String(row.quantityLines)} miktar` : null,
    row.priceLines > 0 ? `${String(row.priceLines)} fiyat` : null,
    row.unmatchedLines > 0 ? `${String(row.unmatchedLines)} siparişte yok` : null,
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? '—' : parts.join(', ')
}

/**
 * Eşleşmeyen faturalar (DOM-FIN-095; ON-277): siparişe bağlı faturalar üçlü eşleştirme durumuyla;
 * varsayılan eşleşmeyenler. Satır fatura ayrıntısını açar (eşleştirme tablosu ve fark onayı). CSV
 * aynı süzgeçle sunucuda üretilir, taze oturum ister.
 */
export function SupplierInvoiceMatchesPanel() {
  const list = useListState('tedarikci-fatura-eslestirme', { urlPrefix: 'eslesme_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const approval = text(list.state.filters.approval)
  const supplierId = text(list.state.filters.supplierId)
  const filters: Omit<SupplierInvoiceMatchQuery, 'page' | 'pageSize'> = {
    status: isFilter(status) ? status : 'mismatched',
    ...(isApproval(approval) ? { approval } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(search.length >= 2 ? { q: search } : {}),
  }
  const matches = useSupplierInvoiceMatches({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...filters,
  })
  const suppliers = useSuppliers({ page: 1, pageSize: 100 })
  const exporter = useSupplierInvoiceMatchExport()
  const [reauth, setReauth] = useState(false)
  const panel = useDetailPanel('eslesme_fatura')
  const openInvoice = panel.open
  const rows = useMemo(
    () =>
      matches.data?.data.map((item): Row => ({
        id: item.id,
        invoiceNumber: item.invoiceNumber,
        supplier: item.supplier.name,
        order: item.purchaseOrder.number,
        invoiceDate: dayText(item.invoiceDate),
        gross: item.grossCents,
        issues: issueText(item),
        status: item.status,
        approved: item.approved,
      })),
    [matches.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'invoiceNumber', label: 'Fatura no' },
      { key: 'supplier', label: 'Tedarikçi' },
      { key: 'order', label: 'Sipariş' },
      { key: 'invoiceDate', label: 'Fatura tarihi' },
      { key: 'gross', label: 'Tutar (KDV dahil)', cell: (row) => money(row.gross) },
      { key: 'issues', label: 'Sapan kalem' },
      {
        key: 'status',
        label: 'Eşleştirme',
        cell: (row) => (
          <span className="flex flex-wrap gap-1">
            <StatusBadge
              text={MATCH_STATUS_VIEW[row.status].label}
              tone={MATCH_STATUS_VIEW[row.status].tone}
            />
            {row.status === 'matched' ? null : row.approved ? (
              <StatusBadge text="Onaylandı" tone="green" />
            ) : (
              <StatusBadge text="Onay bekliyor" tone="gray" />
            )}
          </span>
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.invoiceNumber} faturasının eşleştirmesini aç`}
            onClick={() => openInvoice(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openInvoice],
  )
  const filterFields = useMemo(
    () => [
      { key: 'status', label: 'Eşleştirme', type: 'select' as const, options: STATUS_OPTIONS },
      { key: 'approval', label: 'Fark onayı', type: 'select' as const, options: APPROVAL_OPTIONS },
      {
        key: 'supplierId',
        label: 'Tedarikçi',
        type: 'select' as const,
        options: (suppliers.data?.data ?? []).map((item) => ({ value: item.id, label: item.name })),
      },
    ],
    [suppliers.data],
  )

  async function download() {
    const outcome = await exporter.submit({ page: 1, pageSize: 20, ...filters })
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      `fatura-eslestirme-${dayKey()}.csv`,
    )
    notify.success('Dosya indirildi.')
  }

  return (
    <div className="grid gap-2 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 max-[650px]:px-4">
        <p className="text-sm text-muted-foreground">
          Siparişe bağlı faturalar sipariş ve mal kabulle kalem bazında karşılaştırılır. Eşleşmeyen
          faturanın ödemesi farkın gerekçeyle onaylanmasını ister.
        </p>
        <Button
          variant="outline"
          disabled={exporter.isPending || (matches.data?.meta.total ?? 0) === 0}
          aria-busy={exporter.isPending || undefined}
          onClick={() => void download()}
        >
          <Icon name="Download" size={17} aria-hidden="true" />
          CSV indir
        </Button>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={matches.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filterFields}
        mobileColumns={MOBILE}
        caption="Eşleşmeyen faturalar"
        empty="Eşleşmeyen fatura yok."
        emptyFiltered="Bu seçimle eşleşen fatura yok."
        loading={matches.isPending}
        fetching={matches.isFetching && !matches.isPending}
        error={
          matches.error ? (
            <QueryError error={matches.error} onRetry={() => void matches.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Tedarikçi faturası"
      >
        {panel.selectedId ? <InvoiceDetail invoiceId={panel.selectedId} /> : null}
      </SidePanel>
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void download()
          }}
        />
      ) : null}
    </div>
  )
}
