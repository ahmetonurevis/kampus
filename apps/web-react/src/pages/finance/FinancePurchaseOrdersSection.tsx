import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { usePurchaseRequestOptions } from '@kampus/react-shared/use-finance-procurement.ts'
import {
  usePurchaseOrder,
  usePurchaseOrders,
  useTransitionPurchaseOrder,
  type PurchaseOrderDetail,
} from '@kampus/react-shared/use-finance-purchase-orders.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_STATUS_LABELS,
  type PurchaseOrderStatus,
} from '@kampus/school-core/lib/finance-purchase-orders.ts'
import { PURCHASE_UNIT_LABELS } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { usePurchaseOrderPdf } from '@/hooks/use-finance-purchase-order-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { PURCHASE_ORDER_TITLE } from '@/lib/pdf/templates/finance-purchase-order.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import { reasonFormSchema, type ReasonFormValues } from './finance-procurement-forms.ts'
import { ORDER_STATUS_VIEW } from './finance-purchase-order-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['number', 'status', 'total']
const STATUS_OPTIONS = PURCHASE_ORDER_STATUSES.map((value) => ({
  value,
  label: PURCHASE_ORDER_STATUS_LABELS[value],
}))
const CANCEL_FORM = 'satin-alma-siparis-iptal-formu'
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is PurchaseOrderStatus =>
  PURCHASE_ORDER_STATUSES.some((status) => status === value)
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const timeText = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

type Row = {
  id: string
  number: string
  supplier: string
  request: string
  total: number
  delivery: string
  status: PurchaseOrderStatus
}

/**
 * Satın alma siparişleri (`?gorunum=siparis`; DOM-FIN-073, ON-225). Sipariş talebin seçili
 * teklifinden açılır (talep panelindeki "Teklifler" bölümü). Ayrıntı (`?siparis=`) PDF önizlemesi,
 * gönderildi işareti (yönetici ve ön büro) ve iptal (yönetici) taşır. Tedarikçiye e-posta
 * gönderilmez: PDF kurum dışından iletilir (K-142).
 */
export function FinancePurchaseOrdersSection() {
  const list = useListState('satin-alma-siparisleri', { urlPrefix: 'siparis_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const supplierId = text(list.state.filters.supplierId)
  const orders = usePurchaseOrders({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
  })
  const options = usePurchaseRequestOptions()
  const panel = useDetailPanel('siparis')
  const openOrder = panel.open

  const rows = useMemo(
    () =>
      orders.data?.data.map((item): Row => ({
        id: item.id,
        number: item.number,
        supplier: item.supplier.name,
        request: item.request.number,
        total: item.grossCents,
        delivery: dayText(item.expectedDeliveryDate),
        status: item.status,
      })),
    [orders.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'number', label: 'Numara' },
      { key: 'supplier', label: 'Tedarikçi' },
      { key: 'request', label: 'Talep' },
      { key: 'total', label: 'Toplam (KDV dahil)', cell: (row) => money(row.total) },
      { key: 'delivery', label: 'Beklenen teslim' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={ORDER_STATUS_VIEW[row.status].label}
            tone={ORDER_STATUS_VIEW[row.status].tone}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.number} siparişini aç`}
            onClick={() => openOrder(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openOrder],
  )
  const filters = useMemo(
    () => [
      { key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS },
      {
        key: 'supplierId',
        label: 'Tedarikçi',
        type: 'select' as const,
        options: (options.data?.data.suppliers ?? []).map((item) => ({
          value: item.id,
          label: item.name,
        })),
      },
    ],
    [options.data],
  )

  return (
    <section
      aria-labelledby="satin-alma-siparisleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="satin-alma-siparisleri" className="text-lg font-semibold">
          Satın alma siparişleri
        </h2>
        <p className="text-sm text-muted-foreground">
          Onaylı talebin seçili teklifinden açılan siparişler; PDF tedarikçiye kurum dışından
          iletilir.
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={orders.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={MOBILE}
        caption="Satın alma siparişleri"
        empty="Henüz sipariş yok. Sipariş, onaylı talebin seçili teklifinden açılır."
        emptyFiltered="Bu seçimle eşleşen sipariş yok."
        loading={orders.isPending}
        fetching={orders.isFetching && !orders.isPending}
        error={
          orders.error ? (
            <QueryError error={orders.error} onRetry={() => void orders.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Sipariş ayrıntısı"
      >
        {panel.selectedId ? <OrderDetail orderId={panel.selectedId} /> : null}
      </SidePanel>
    </section>
  )
}

function OrderDetail({ orderId }: { orderId: string }) {
  const item = usePurchaseOrder(orderId)
  const transition = useTransitionPurchaseOrder()
  const [cancelling, setCancelling] = useState(false)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const order = item.data?.data
  if (!order) return <SummaryLoading />
  const view = ORDER_STATUS_VIEW[order.status]
  const busy = transition.isPending
  const send = async () => {
    const outcome = await transition.submit({
      orderId: order.id,
      version: order.version,
      action: 'send',
    })
    if (outcome.status === 'success')
      notify.success(`${order.number} gönderildi olarak işaretlendi.`)
  }
  return (
    <div className="grid gap-6">
      <section aria-labelledby="siparis-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="siparis-bilgileri" className="text-base font-semibold">
            {order.number}
          </h3>
          <StatusBadge text={view.label} tone={view.tone} />
        </div>
        <Facts order={order} />
        <div className="flex flex-wrap gap-2">
          <PdfDialogButton
            label="Sipariş PDF"
            title={PURCHASE_ORDER_TITLE}
            id={order.id}
            usePdf={usePurchaseOrderPdf}
          />
          {order.actions.send ? (
            <Button
              type="button"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => void send()}
            >
              <Icon name="Send" size={16} aria-hidden="true" />
              Gönderildi işaretle
            </Button>
          ) : null}
          {order.actions.cancel ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setCancelling(true)}
            >
              Siparişi iptal et
            </Button>
          ) : null}
        </div>
        {order.actions.send ? (
          <p className="text-sm text-muted-foreground">
            Tedarikçiye e-posta gönderilmez: PDF'i indirip iletin, sonra gönderildi olarak
            işaretleyin.
          </p>
        ) : null}
      </section>
      <section aria-labelledby="siparis-kalemleri" className="grid gap-3">
        <h3 id="siparis-kalemleri" className="text-base font-semibold">
          Kalemler
        </h3>
        <ul className="grid gap-2" aria-label="Sipariş kalemleri">
          {order.items.map((line) => (
            <li
              key={line.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium">{line.name}</span>
                <span className="block text-muted-foreground">
                  {`${String(line.quantity)} ${PURCHASE_UNIT_LABELS[line.unit]} × ${money(line.unitPriceCents)} + %${String(line.vatRate)} KDV`}
                </span>
              </span>
              <span className="font-medium tabular-nums">{money(line.grossCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="grid justify-end gap-1 text-right text-sm tabular-nums">
          <div className="flex justify-end gap-2">
            <dt className="text-muted-foreground">KDV hariç</dt>
            <dd>{money(order.netCents)}</dd>
          </div>
          <div className="flex justify-end gap-2">
            <dt className="text-muted-foreground">KDV</dt>
            <dd>{money(order.vatCents)}</dd>
          </div>
          <div className="flex justify-end gap-2 font-semibold">
            <dt>Toplam</dt>
            <dd>{money(order.grossCents)}</dd>
          </div>
        </dl>
      </section>
      {cancelling ? <CancelModal order={order} onClose={() => setCancelling(false)} /> : null}
    </div>
  )
}

function Facts({ order }: { order: PurchaseOrderDetail }) {
  const pairs: [string, string][] = [
    ['Tedarikçi', order.supplier.name],
    ['Vergi dairesi / numarası', `${order.supplier.taxOffice} / ${order.supplier.taxNumber}`],
    ['Talep', order.request.number],
    [
      'Teslim',
      `${String(order.deliveryDays)} gün · beklenen ${dayText(order.expectedDeliveryDate)}`,
    ],
    ['Açan', `${order.createdByName ?? '—'} · ${timeText(order.createdAt)}`],
  ]
  if (order.note) pairs.push(['Not', order.note])
  if (order.sentAt)
    pairs.push(['Gönderildi', `${order.sentByName ?? '—'} · ${timeText(order.sentAt)}`])
  if (order.cancelledAt)
    pairs.push(['İptal edildi', `${order.cancelledByName ?? '—'} · ${timeText(order.cancelledAt)}`])
  if (order.cancelReason) pairs.push(['İptal gerekçesi', order.cancelReason])
  return (
    <dl className="grid gap-2 text-sm">
      {pairs.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[minmax(0,11rem)_1fr] gap-2 max-[480px]:grid-cols-1"
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="[overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function CancelModal({ order, onClose }: { order: PurchaseOrderDetail; onClose: () => void }) {
  const transition = useTransitionPurchaseOrder()
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = transition.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await transition.submit(
      { orderId: order.id, version: order.version, action: 'cancel', reason: values.reason.trim() },
      {
        setError: (_name: string, error: { type: string; message: string }) =>
          form.setError('reason', error, { shouldFocus: true }),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${order.number} iptal edildi.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Siparişi iptal et"
      description={`${order.number} · ${money(order.grossCents)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={CANCEL_FORM} disabled={busy} aria-busy={busy || undefined}>
            İptal et
          </Button>
        </>
      }
    >
      <form
        id={CANCEL_FORM}
        noValidate
        aria-label="Siparişi iptal et"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <p className="text-sm">Numara boşta kalır; talep yeniden teklif ve seçime açılır.</p>
        <FormField
          id="siparis-iptal-gerekce"
          label="İptal gerekçesi"
          error={form.formState.errors.reason}
        >
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
          )}
        </FormField>
      </form>
    </Modal>
  )
}
