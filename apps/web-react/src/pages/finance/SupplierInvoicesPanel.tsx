import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useFieldArray, useForm, useWatch, type Control, type UseFormReturn } from 'react-hook-form'
import { useSuppliers } from '@kampus/react-shared/use-finance-procurement.ts'
import { usePurchaseOrders } from '@kampus/react-shared/use-finance-purchase-orders.ts'
import {
  SUPPLIER_LEDGER_WARNING_CODES,
  useCreateSupplierInvoice,
  useSupplierInvoice,
  useSupplierInvoices,
  useTransitionSupplierInvoice,
  type SupplierInvoiceDetail,
} from '@kampus/react-shared/use-finance-supplier-ledger.ts'
import { dayKey, money } from '@kampus/school-core/lib/format.ts'
import {
  SUPPLIER_INVOICE_STATUSES,
  SUPPLIER_INVOICE_STATUS_LABELS,
  type SupplierInvoiceStatus,
} from '@kampus/school-core/lib/finance-supplier-ledger.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { reasonFormSchema, type ReasonFormValues } from './finance-procurement-forms.ts'
import {
  dayText,
  evenInstallments,
  installmentsTotalCents,
  INVOICE_STATUS_VIEW,
  invoiceBody,
  invoiceDefaults,
  invoiceFormField,
  invoiceFormSchema,
  invoiceGrossCents,
  planBody,
  planDefaults,
  planFormSchema,
  type InvoiceFormValues,
  type PlanFormValues,
} from './finance-supplier-ledger-forms.ts'
import { SupplierPaymentModal, SupplierPaymentsList } from './SupplierPaymentParts.tsx'

const NO_SORT: readonly string[] = []
const MOBILE = ['invoiceNumber', 'supplier', 'remaining', 'status']
const STATUS_OPTIONS = SUPPLIER_INVOICE_STATUSES.map((value) => ({
  value,
  label: SUPPLIER_INVOICE_STATUS_LABELS[value],
}))
const INVOICE_FORM = 'tedarikci-fatura-formu'
const PLAN_FORM = 'tedarikci-fatura-plan-formu'
const CANCEL_FORM = 'tedarikci-fatura-iptal-formu'
/** Faturanın bağlanabileceği sipariş durumları (gönderilmiş ve sonrası; K-162). */
const LINKABLE_ORDER = new Set(['sent', 'partially_received', 'completed'])
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is SupplierInvoiceStatus =>
  SUPPLIER_INVOICE_STATUSES.some((status) => status === value)
const isWarning = (error: { code: string }) =>
  SUPPLIER_LEDGER_WARNING_CODES.some((code) => code === error.code)

type Row = {
  id: string
  invoiceNumber: string
  supplier: string
  invoiceDate: string
  dueDate: string
  gross: number
  remaining: number
  status: SupplierInvoiceStatus
}

/** Tedarikçi faturaları (DOM-FIN-076): liste, fatura girişi ve ayrıntı (`?fatura=`). */
export function SupplierInvoicesPanel() {
  const list = useListState('tedarikci-faturalari', { urlPrefix: 'tfatura_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const supplierId = text(list.state.filters.supplierId)
  const invoices = useSupplierInvoices({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
  })
  const suppliers = useSuppliers({ page: 1, pageSize: 100 })
  const panel = useDetailPanel('fatura')
  const openInvoice = panel.open
  const [creating, setCreating] = useState(false)
  const rows = useMemo(
    () =>
      invoices.data?.data.map((item): Row => ({
        id: item.id,
        invoiceNumber: item.invoiceNumber,
        supplier: item.supplier.name,
        invoiceDate: dayText(item.invoiceDate),
        dueDate: dayText(item.nextDueDate ?? item.dueDate),
        gross: item.grossCents,
        remaining: item.remainingCents,
        status: item.status,
      })),
    [invoices.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'invoiceNumber', label: 'Fatura no' },
      { key: 'supplier', label: 'Tedarikçi' },
      { key: 'invoiceDate', label: 'Fatura tarihi' },
      { key: 'dueDate', label: 'Vade' },
      { key: 'gross', label: 'Tutar (KDV dahil)', cell: (row) => money(row.gross) },
      { key: 'remaining', label: 'Kalan', cell: (row) => money(row.remaining) },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={INVOICE_STATUS_VIEW[row.status].label}
            tone={INVOICE_STATUS_VIEW[row.status].tone}
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
            aria-label={`${row.invoiceNumber} faturasını aç`}
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
      { key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS },
      {
        key: 'supplierId',
        label: 'Tedarikçi',
        type: 'select' as const,
        options: (suppliers.data?.data ?? []).map((item) => ({
          value: item.id,
          label: item.name,
        })),
      },
    ],
    [suppliers.data],
  )
  return (
    <div className="grid gap-2 pt-4">
      <div className="flex justify-end px-6">
        <Button onClick={() => setCreating(true)}>
          <Icon name="Plus" size={16} aria-hidden="true" />
          Fatura ekle
        </Button>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={invoices.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={MOBILE}
        caption="Tedarikçi faturaları"
        empty="Henüz tedarikçi faturası yok."
        emptyFiltered="Bu seçimle eşleşen fatura yok."
        loading={invoices.isPending}
        fetching={invoices.isFetching && !invoices.isPending}
        error={
          invoices.error ? (
            <QueryError error={invoices.error} onRetry={() => void invoices.refetch()} />
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
      {creating ? (
        <InvoiceFormModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            openInvoice(id)
          }}
        />
      ) : null}
    </div>
  )
}

function RootError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  ) : null
}

/** Taksit satırları; plan formu ve fatura formu paylaşır. */
function InstallmentFields({
  form,
  idPrefix,
  busy,
  grossCents,
}: {
  form: UseFormReturn<PlanFormValues> | UseFormReturn<InvoiceFormValues>
  idPrefix: string
  busy: boolean
  grossCents: number
}) {
  // İki form da `installments` dizisini aynı biçimde taşır.
  const typed = form as unknown as UseFormReturn<PlanFormValues>
  const array = useFieldArray({ control: typed.control, name: 'installments' })
  const watched = useWatch({
    control: typed.control as Control<PlanFormValues>,
    name: 'installments',
  })
  const [count, setCount] = useState('3')
  const total = installmentsTotalCents(watched ?? [])
  const errors = typed.formState.errors.installments
  const firstDue = watched?.[0]?.dueDate ?? dayKey()
  return (
    <fieldset className="col-span-full grid gap-3">
      <legend className="mb-2 text-sm font-medium">Ödeme planı</legend>
      <div className="flex flex-wrap items-end gap-2">
        <FormField id={`${idPrefix}-taksit-sayisi`} label="Taksit sayısı">
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              disabled={busy}
              className="w-24"
            />
          )}
        </FormField>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || grossCents <= 0}
          onClick={() => array.replace(evenInstallments(grossCents, Number(count) || 1, firstDue))}
        >
          Eşit aylık taksitlere böl
        </Button>
      </div>
      {array.fields.map((field, index) => (
        <div
          key={field.id}
          className="grid grid-cols-[1fr_1fr_auto] items-start gap-3 max-[650px]:grid-cols-1"
        >
          <FormField
            id={`${idPrefix}-taksit-${String(index)}-vade`}
            label={`${String(index + 1)}. taksit vadesi`}
            error={errors?.[index]?.dueDate}
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                {...typed.register(`installments.${index}.dueDate`)}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField
            id={`${idPrefix}-taksit-${String(index)}-tutar`}
            label={`${String(index + 1)}. taksit tutarı (₺)`}
            error={errors?.[index]?.amount}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                {...typed.register(`installments.${index}.amount`)}
                disabled={busy}
              />
            )}
          </FormField>
          <Button
            type="button"
            variant="ghost"
            className="mt-7 max-[650px]:mt-0"
            aria-label={`${String(index + 1)}. taksiti kaldır`}
            disabled={busy}
            onClick={() => array.remove(index)}
          >
            <Icon name="Trash2" size={16} aria-hidden="true" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => array.append({ dueDate: firstDue, amount: '' })}
        >
          Taksit ekle
        </Button>
        <p
          className={`text-sm tabular-nums ${total === grossCents ? 'text-muted-foreground' : 'font-semibold text-danger'}`}
          aria-live="polite"
        >
          {`Taksit toplamı ${money(total)} / fatura ${money(grossCents)}`}
        </p>
      </div>
      <RootError
        message={
          errors?.root?.message ??
          errors?.message ??
          typed.formState.errors.root?.installments?.message
        }
      />
    </fieldset>
  )
}

function InvoiceFormModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const create = useCreateSupplierInvoice()
  const suppliers = useSuppliers({ page: 1, pageSize: 100 })
  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: invoiceDefaults(dayKey()),
  })
  const [warning, setWarning] = useState<string | null>(null)
  const values = useWatch({ control: form.control })
  const supplierId = values.supplierId ?? ''
  const orders = usePurchaseOrders({
    page: 1,
    pageSize: 100,
    ...(supplierId ? { supplierId } : {}),
  })
  const orderOptions = (supplierId ? (orders.data?.data ?? []) : []).filter((order) =>
    LINKABLE_ORDER.has(order.status),
  )
  const gross = invoiceGrossCents(values)
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (input) => {
    const outcome = await create.submit(invoiceBody(input, warning !== null), {
      setError: (name: string, error: { type: string; message: string }) => {
        const field = invoiceFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
      silent: isWarning,
    })
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.invoiceNumber} faturası kaydedildi.`)
      onCreated(outcome.data.data.id)
    } else if (outcome.status === 'failed' && isWarning(outcome.error))
      setWarning(outcome.error.message)
  })
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Tedarikçi faturası ekle"
      description="Fatura numarası tedarikçide tekildir; taksitlerin toplamı KDV dahil tutardır."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={INVOICE_FORM} disabled={busy} aria-busy={busy || undefined}>
            {warning ? 'Aşımı onaylayarak kaydet' : 'Faturayı kaydet'}
          </Button>
        </>
      }
    >
      <form
        id={INVOICE_FORM}
        noValidate
        aria-label="Tedarikçi faturası ekle"
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField id="tfatura-tedarikci" label="Tedarikçi" error={errors.supplierId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('supplierId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Tedarikçi seçin</NativeSelectOption>
              {(suppliers.data?.data ?? []).map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.isActive ? item.name : `${item.name} (pasif)`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="tfatura-no" label="Fatura numarası" error={errors.invoiceNumber}>
          {(control) => <Input {...control} {...form.register('invoiceNumber')} disabled={busy} />}
        </FormField>
        <FormField id="tfatura-tarih" label="Fatura tarihi" error={errors.invoiceDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('invoiceDate')} disabled={busy} />
          )}
        </FormField>
        <FormField id="tfatura-kdv-dahil" label="Tutar" error={errors.amountIncludesVat}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('amountIncludesVat')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="true">KDV dahil</NativeSelectOption>
              <NativeSelectOption value="false">KDV hariç</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
        <FormField id="tfatura-tutar" label="Fatura tutarı (₺)" error={errors.amount}>
          {(control) => (
            <Input {...control} inputMode="decimal" {...form.register('amount')} disabled={busy} />
          )}
        </FormField>
        <FormField id="tfatura-kdv" label="KDV tutarı (₺)" error={errors.vat}>
          {(control) => (
            <Input {...control} inputMode="decimal" {...form.register('vat')} disabled={busy} />
          )}
        </FormField>
        <FormField
          id="tfatura-siparis"
          label="Sipariş (isteğe bağlı)"
          error={errors.purchaseOrderId}
          description="Yalnız seçilen tedarikçinin gönderilmiş siparişleri"
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('purchaseOrderId')}
              className="w-full"
              disabled={busy || !supplierId}
            >
              <NativeSelectOption value="">Siparişe bağlı değil</NativeSelectOption>
              {orderOptions.map((order) => (
                <NativeSelectOption key={order.id} value={order.id}>
                  {`${order.number} · ${money(order.grossCents)}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="tfatura-vade-bicimi" label="Vade" error={errors.planMode}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('planMode')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="single">Tek vade</NativeSelectOption>
              <NativeSelectOption value="plan">Taksitli ödeme planı</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
        {values.planMode === 'plan' ? (
          <InstallmentFields form={form} idPrefix="tfatura" busy={busy} grossCents={gross} />
        ) : (
          <FormField id="tfatura-vade" label="Vade günü" error={errors.dueDate}>
            {(control) => (
              <Input {...control} type="date" {...form.register('dueDate')} disabled={busy} />
            )}
          </FormField>
        )}
        <div className="col-span-full">
          <FormField id="tfatura-not" label="Not (isteğe bağlı)" error={errors.note}>
            {(control) => (
              <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
            )}
          </FormField>
        </div>
        <p
          className="col-span-full text-right text-sm font-semibold tabular-nums"
          aria-live="polite"
        >
          {`KDV dahil toplam ${money(gross)}`}
        </p>
        {warning ? (
          <p role="alert" className="col-span-full rounded-md border border-warning p-3 text-sm">
            {warning}
          </p>
        ) : null}
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

type Dialog =
  | { kind: 'plan' }
  | { kind: 'cancel' }
  | { kind: 'pay'; installment: SupplierInvoiceDetail['installments'][number] }
  | null

function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const item = useSupplierInvoice(invoiceId)
  const [dialog, setDialog] = useState<Dialog>(null)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const invoice = item.data?.data
  if (!invoice) return <SummaryLoading />
  const view = INVOICE_STATUS_VIEW[invoice.status]
  const close = () => setDialog(null)
  const facts: [string, string][] = [
    ['Tedarikçi', invoice.supplier.name],
    ['Fatura tarihi', dayText(invoice.invoiceDate)],
    ['KDV hariç / KDV', `${money(invoice.netCents)} / ${money(invoice.vatCents)}`],
    ['Toplam (KDV dahil)', money(invoice.grossCents)],
    ['Ödenen / kalan', `${money(invoice.paidCents)} / ${money(invoice.remainingCents)}`],
  ]
  if (invoice.overdueCents > 0) facts.push(['Vadesi geçmiş', money(invoice.overdueCents)])
  if (invoice.purchaseOrder) facts.push(['Sipariş', invoice.purchaseOrder.number])
  if (invoice.note) facts.push(['Not', invoice.note])
  facts.push(['Giren', invoice.createdByName ?? '—'])
  if (invoice.cancelReason)
    facts.push(['İptal gerekçesi', `${invoice.cancelReason} (${invoice.cancelledByName ?? '—'})`])
  return (
    <div className="grid gap-6">
      <section aria-labelledby="tfatura-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="tfatura-bilgileri" className="text-base font-semibold">
            {`Fatura ${invoice.invoiceNumber}`}
          </h3>
          <StatusBadge text={view.label} tone={view.tone} />
        </div>
        <dl className="grid gap-2 text-sm">
          {facts.map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-[minmax(0,11rem)_1fr] gap-2 max-[480px]:grid-cols-1"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="[overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          {invoice.actions.replan ? (
            <Button type="button" variant="secondary" onClick={() => setDialog({ kind: 'plan' })}>
              Ödeme planını değiştir
            </Button>
          ) : null}
          {invoice.actions.cancel ? (
            <Button type="button" variant="ghost" onClick={() => setDialog({ kind: 'cancel' })}>
              Faturayı iptal et
            </Button>
          ) : null}
        </div>
      </section>
      <section aria-labelledby="tfatura-plan" className="grid gap-3">
        <h3 id="tfatura-plan" className="text-base font-semibold">
          Ödeme planı
        </h3>
        <ul className="grid gap-2" aria-label="Taksitler">
          {invoice.installments.map((installment, index) => (
            <li
              key={installment.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium">{`${String(index + 1)}. taksit · ${dayText(installment.dueDate)}`}</span>
                <span className="block text-muted-foreground tabular-nums">
                  {`${money(installment.amountCents)} · ödenen ${money(installment.paidCents)} · kalan ${money(installment.remainingCents)}`}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {installment.overdue ? <StatusBadge text="Vadesi geçti" tone="red" /> : null}
                {invoice.actions.pay && installment.remainingCents > 0 ? (
                  <Button
                    size="sm"
                    aria-label={`${String(index + 1)}. taksite ödeme gir`}
                    onClick={() => setDialog({ kind: 'pay', installment })}
                  >
                    Ödeme gir
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <SupplierPaymentsList payments={invoice.payments} />
      {dialog?.kind === 'plan' ? <PlanModal invoice={invoice} onClose={close} /> : null}
      {dialog?.kind === 'cancel' ? <CancelInvoiceModal invoice={invoice} onClose={close} /> : null}
      {dialog?.kind === 'pay' ? (
        <SupplierPaymentModal invoice={invoice} installment={dialog.installment} onClose={close} />
      ) : null}
    </div>
  )
}

function PlanModal({ invoice, onClose }: { invoice: SupplierInvoiceDetail; onClose: () => void }) {
  const transition = useTransitionSupplierInvoice()
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: planDefaults(invoice),
  })
  const busy = transition.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await transition.submit(
      { invoiceId: invoice.id, version: invoice.version, action: 'plan', body: planBody(values) },
      {
        setError: (name: string, error: { type: string; message: string }) => {
          const field = invoiceFormField(name)
          if (field?.startsWith('installments.'))
            form.setError(field as `installments.${number}.${'amount' | 'dueDate'}`, error, {
              shouldFocus: true,
            })
          else form.setError('root.installments', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Ödeme planı güncellendi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ödeme planını değiştir"
      description={`Fatura ${invoice.invoiceNumber} · ${money(invoice.grossCents)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={PLAN_FORM} disabled={busy} aria-busy={busy || undefined}>
            Planı kaydet
          </Button>
        </>
      }
    >
      <form
        id={PLAN_FORM}
        noValidate
        aria-label="Ödeme planını değiştir"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <InstallmentFields
          form={form}
          idPrefix="tplan"
          busy={busy}
          grossCents={invoice.grossCents}
        />
      </form>
    </Modal>
  )
}

function CancelInvoiceModal({
  invoice,
  onClose,
}: {
  invoice: SupplierInvoiceDetail
  onClose: () => void
}) {
  const transition = useTransitionSupplierInvoice()
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = transition.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await transition.submit(
      {
        invoiceId: invoice.id,
        version: invoice.version,
        action: 'cancel',
        reason: values.reason.trim(),
      },
      {
        setError: (_name: string, error: { type: string; message: string }) =>
          form.setError('reason', error, { shouldFocus: true }),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`Fatura ${invoice.invoiceNumber} iptal edildi.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Faturayı iptal et"
      description={`Fatura ${invoice.invoiceNumber} · ${money(invoice.grossCents)}`}
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
        aria-label="Faturayı iptal et"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <p className="text-sm">
          Fatura silinmez; iptal ekstreye iptal gününde ters hareket olarak yazılır.
        </p>
        <FormField
          id="tfatura-iptal-gerekce"
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
