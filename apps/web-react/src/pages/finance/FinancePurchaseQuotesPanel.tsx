import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { usePurchaseRequestOptions } from '@kampus/react-shared/use-finance-procurement.ts'
import {
  useCreatePurchaseOrder,
  useCreatePurchaseQuote,
  usePurchaseQuoteAction,
  usePurchaseQuoteBoard,
  useUpdatePurchaseQuote,
  type PurchaseQuote,
  type PurchaseQuoteBoard,
} from '@kampus/react-shared/use-finance-purchase-orders.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { PURCHASE_UNIT_LABELS } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  ORDER_STATUS_VIEW,
  orderNoteFormSchema,
  quoteCreateBody,
  quoteDefaults,
  quoteFormField,
  quoteFormSchema,
  quoteFormTotals,
  quoteUpdateBody,
  selectionFormSchema,
  VAT_RATE_OPTIONS,
  type OrderNoteFormValues,
  type QuoteFormValues,
  type SelectionFormValues,
} from './finance-purchase-order-forms.ts'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const QUOTE_FORM = 'satin-alma-teklif-formu'
const SELECT_FORM = 'satin-alma-teklif-secim-formu'
const ORDER_FORM = 'satin-alma-siparis-formu'

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit' | 'remove' | 'select'; quote: PurchaseQuote }
  | { kind: 'order'; quote: PurchaseQuote }
  | null

/**
 * Onaylı talebin teklifleri (DOM-FIN-072; ON-224): kalem × tedarikçi karşılaştırma tablosu, en düşük
 * vurgusu, teklif girişi, gerekçeli seçim ve seçili tekliften sipariş (DOM-FIN-073). Ön büro teklif
 * girer, seçim ve sipariş yöneticidedir (K-136, K-141); etkin sipariş açılınca teklifler kilitlenir.
 */
export function FinancePurchaseQuotesPanel({ requestId }: { requestId: string }) {
  const query = usePurchaseQuoteBoard(requestId)
  const [dialog, setDialog] = useState<Dialog>(null)
  if (query.error) return <QueryError error={query.error} onRetry={() => void query.refetch()} />
  const board = query.data?.data
  if (!board) return <SummaryLoading />
  const selected = board.quotes.find((quote) => quote.selected)
  const close = () => setDialog(null)
  return (
    <section aria-labelledby="talep-teklifleri" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="talep-teklifleri" className="text-base font-semibold">
          Teklifler
        </h3>
        <div className="flex flex-wrap gap-2">
          {board.actions.add ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDialog({ kind: 'add' })}
            >
              <Icon name="Plus" size={16} aria-hidden="true" />
              Teklif ekle
            </Button>
          ) : null}
          {board.actions.order && selected ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setDialog({ kind: 'order', quote: selected })}
            >
              <Icon name="FileText" size={16} aria-hidden="true" />
              Sipariş aç
            </Button>
          ) : null}
        </div>
      </div>
      {board.orders.length > 0 ? (
        <ul className="grid gap-1 text-sm" aria-label="Talebin siparişleri">
          {board.orders.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center gap-2">
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                to={{ search: `?gorunum=siparis&siparis=${order.id}` }}
              >
                {order.number}
              </Link>
              <StatusBadge
                text={ORDER_STATUS_VIEW[order.status].label}
                tone={ORDER_STATUS_VIEW[order.status].tone}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {board.quotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Henüz teklif girilmedi. Tedarikçilerden alınan teklifler burada karşılaştırılır.
        </p>
      ) : (
        <ComparisonTable board={board} onAction={setDialog} />
      )}
      {selected?.selectionReason ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Seçim gerekçesi: </span>
          {selected.selectionReason}
        </p>
      ) : null}
      {dialog?.kind === 'add' ? <QuoteFormModal board={board} onClose={close} /> : null}
      {dialog?.kind === 'edit' ? (
        <QuoteFormModal board={board} quote={dialog.quote} onClose={close} />
      ) : null}
      {dialog?.kind === 'remove' ? (
        <RemoveModal board={board} quote={dialog.quote} onClose={close} />
      ) : null}
      {dialog?.kind === 'select' ? (
        <SelectModal board={board} quote={dialog.quote} onClose={close} />
      ) : null}
      {dialog?.kind === 'order' ? <OrderModal quote={dialog.quote} onClose={close} /> : null}
    </section>
  )
}

/** Kalem × tedarikçi tablosu: hücrede birim fiyat, KDV ve KDV dahil tutar; en düşük vurgulanır. */
function ComparisonTable({
  board,
  onAction,
}: {
  board: PurchaseQuoteBoard
  onAction: (dialog: Dialog) => void
}) {
  const cell = (quote: PurchaseQuote, itemId: string) =>
    quote.lines.find((line) => line.requestItemId === itemId)
  const lowestMark = (
    <span className="ml-1 rounded-sm bg-success-soft px-1 text-xs font-medium text-success">
      En düşük
    </span>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <caption className="sr-only">Teklif karşılaştırması</caption>
        <thead className="text-left text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              Kalem
            </th>
            {board.quotes.map((quote) => (
              <th key={quote.id} scope="col" className="py-2 pr-3 align-bottom font-medium">
                <span className="block text-foreground">{quote.supplier.name}</span>
                {quote.selected ? <StatusBadge text="Seçili" tone="green" /> : null}
                {quote.expired ? <StatusBadge text="Süresi geçti" tone="red" /> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {board.items.map((item) => (
            <tr key={item.id} className="border-t align-top">
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                <span className="block font-medium">{item.name}</span>
                <span className="text-muted-foreground">
                  {`${String(item.quantity)} ${PURCHASE_UNIT_LABELS[item.unit]}`}
                </span>
              </th>
              {board.quotes.map((quote) => {
                const line = cell(quote, item.id)
                return (
                  <td key={quote.id} className="py-2 pr-3">
                    {line ? (
                      <>
                        <span className={line.lowest ? 'font-semibold' : undefined}>
                          {money(line.grossCents)}
                        </span>
                        {line.lowest ? lowestMark : null}
                        <span className="block text-xs text-muted-foreground">
                          {`${money(line.unitPriceCents)} + %${String(line.vatRate)} KDV`}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot className="tabular-nums">
          <tr className="border-t">
            <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">
              KDV hariç / KDV
            </th>
            {board.quotes.map((quote) => (
              <td key={quote.id} className="py-2 pr-3 text-muted-foreground">
                {`${money(quote.netCents)} / ${money(quote.vatCents)}`}
              </td>
            ))}
          </tr>
          <tr className="border-t">
            <th scope="row" className="py-2 pr-3 text-left">
              Toplam (KDV dahil)
            </th>
            {board.quotes.map((quote) => (
              <td key={quote.id} className="py-2 pr-3 font-semibold">
                {money(quote.grossCents)}
                {quote.lowest ? lowestMark : null}
              </td>
            ))}
          </tr>
          <tr className="border-t">
            <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">
              Teslim / geçerlilik
            </th>
            {board.quotes.map((quote) => (
              <td key={quote.id} className="py-2 pr-3 text-muted-foreground">
                {`${String(quote.deliveryDays)} gün · ${dayText(quote.validUntil)}`}
                {quote.note ? <span className="block text-xs">{quote.note}</span> : null}
              </td>
            ))}
          </tr>
          <tr className="border-t">
            <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">
              İşlemler
            </th>
            {board.quotes.map((quote) => (
              <td key={quote.id} className="py-2 pr-3">
                <div className="flex flex-wrap gap-1">
                  {quote.actions.select ? (
                    <Button
                      type="button"
                      size="sm"
                      aria-label={`${quote.supplier.name} teklifini seç`}
                      onClick={() => onAction({ kind: 'select', quote })}
                    >
                      Seç
                    </Button>
                  ) : null}
                  {quote.actions.edit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-label={`${quote.supplier.name} teklifini düzenle`}
                      onClick={() => onAction({ kind: 'edit', quote })}
                    >
                      Düzenle
                    </Button>
                  ) : null}
                  {quote.actions.remove ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`${quote.supplier.name} teklifini sil`}
                      onClick={() => onAction({ kind: 'remove', quote })}
                    >
                      Sil
                    </Button>
                  ) : null}
                </div>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/** Teklif formu: tedarikçi (yalnız yenide), teslim süresi, geçerlilik, not ve kalem fiyatları. */
function QuoteFormModal({
  board,
  quote,
  onClose,
}: {
  board: PurchaseQuoteBoard
  quote?: PurchaseQuote
  onClose: () => void
}) {
  const options = usePurchaseRequestOptions(quote === undefined)
  const create = useCreatePurchaseQuote()
  const update = useUpdatePurchaseQuote()
  const form = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteFormSchema),
    defaultValues: quoteDefaults(board, quote),
  })
  const watched = useWatch({ control: form.control, name: 'items' })
  const quantities = useMemo(
    () => new Map(board.items.map((item) => [item.id, item.quantity])),
    [board.items],
  )
  const totals = quoteFormTotals(watched ?? [], quantities)
  const taken = new Set(board.quotes.map((item) => item.supplier.id))
  const suppliers = (options.data?.data.suppliers ?? []).filter((item) => !taken.has(item.id))
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const title = quote ? `${quote.supplier.name} teklifini düzenle` : 'Teklif ekle'
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = quoteFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = quote
      ? await update.submit(
          {
            requestId: board.request.id,
            quoteId: quote.id,
            version: quote.version,
            body: quoteUpdateBody(values),
          },
          fields,
        )
      : await create.submit({ requestId: board.request.id, body: quoteCreateBody(values) }, fields)
    if (outcome.status === 'success') {
      notify.success(quote ? 'Teklif güncellendi.' : 'Teklif kaydedildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description={`${board.request.number} · fiyatlar KDV hariç birim fiyattır`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={QUOTE_FORM} disabled={busy} aria-busy={busy || undefined}>
            Teklifi kaydet
          </Button>
        </>
      }
    >
      <form
        id={QUOTE_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        {quote ? null : (
          <FormField id="teklif-tedarikci" label="Tedarikçi" error={errors.supplierId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('supplierId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Tedarikçi seçin</NativeSelectOption>
                {suppliers.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
        <FormField id="teklif-teslim" label="Teslim süresi (gün)" error={errors.deliveryDays}>
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              {...form.register('deliveryDays')}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="teklif-gecerlilik" label="Geçerlilik tarihi" error={errors.validUntil}>
          {(control) => (
            <Input {...control} type="date" {...form.register('validUntil')} disabled={busy} />
          )}
        </FormField>
        <div className="col-span-full">
          <FormField id="teklif-not" label="Not (isteğe bağlı)" error={errors.note}>
            {(control) => (
              <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
            )}
          </FormField>
        </div>
        <fieldset className="col-span-full grid gap-3">
          <legend className="mb-2 text-sm font-medium">Kalem fiyatları</legend>
          {board.items.map((item, index) => (
            <div
              key={item.id}
              className="grid grid-cols-[2fr_1.5fr_1fr] items-start gap-3 max-[650px]:grid-cols-1"
            >
              <p className="pt-7 text-sm max-[650px]:pt-0">
                <span className="font-medium">{item.name}</span>
                <span className="block text-muted-foreground">
                  {`${String(item.quantity)} ${PURCHASE_UNIT_LABELS[item.unit]}`}
                </span>
              </p>
              <FormField
                id={`teklif-kalem-${String(index)}-fiyat`}
                label={`${item.name} birim fiyatı (₺, KDV hariç)`}
                error={errors.items?.[index]?.price}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    {...form.register(`items.${index}.price`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField
                id={`teklif-kalem-${String(index)}-kdv`}
                label={`${item.name} KDV oranı`}
                error={errors.items?.[index]?.vatRate}
              >
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register(`items.${index}.vatRate`)}
                    className="w-full"
                    disabled={busy}
                  >
                    {VAT_RATE_OPTIONS.map((option) => (
                      <NativeSelectOption key={option.value} value={option.value}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            </div>
          ))}
          <p className="text-right text-sm font-semibold tabular-nums" aria-live="polite">
            {`KDV hariç ${money(totals.netCents)} · KDV ${money(totals.vatCents)} · Toplam ${money(totals.grossCents)}`}
          </p>
        </fieldset>
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

function RemoveModal({
  board,
  quote,
  onClose,
}: {
  board: PurchaseQuoteBoard
  quote: PurchaseQuote
  onClose: () => void
}) {
  const action = usePurchaseQuoteAction()
  const remove = async () => {
    const outcome = await action.submit({
      requestId: board.request.id,
      quoteId: quote.id,
      version: quote.version,
      action: 'remove',
    })
    if (outcome.status === 'busy') return
    if (outcome.status === 'success') notify.success('Teklif silindi.')
    onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Teklifi sil"
      description={`${quote.supplier.name} · ${money(quote.grossCents)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={action.isPending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            onClick={() => void remove()}
            disabled={action.isPending}
            aria-busy={action.isPending || undefined}
          >
            Sil
          </Button>
        </>
      }
    >
      <p className="text-sm">
        Teklif karşılaştırmadan çıkar{quote.selected ? ' ve seçim düşer' : ''}.
      </p>
    </Modal>
  )
}

/** Seçim: en düşük geçerli teklif değilse gerekçe zorunludur (K-137). */
function SelectModal({
  board,
  quote,
  onClose,
}: {
  board: PurchaseQuoteBoard
  quote: PurchaseQuote
  onClose: () => void
}) {
  const action = usePurchaseQuoteAction()
  const form = useForm<SelectionFormValues>({
    resolver: zodResolver(selectionFormSchema(quote.lowest)),
    defaultValues: { reason: '' },
  })
  const busy = action.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const reason = values.reason.trim()
    const outcome = await action.submit(
      {
        requestId: board.request.id,
        quoteId: quote.id,
        version: quote.version,
        action: 'select',
        reason: reason === '' ? null : reason,
      },
      {
        setError: (_name: string, error: { type: string; message: string }) =>
          form.setError('reason', error, { shouldFocus: true }),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${quote.supplier.name} teklifi seçildi.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  const lowest = board.lowestGrossCents
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Teklifi seç"
      description={`${quote.supplier.name} · ${money(quote.grossCents)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={SELECT_FORM} disabled={busy} aria-busy={busy || undefined}>
            Seç
          </Button>
        </>
      }
    >
      <form
        id={SELECT_FORM}
        noValidate
        aria-label="Teklifi seç"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <p className="text-sm">
          {quote.lowest
            ? 'Bu teklif geçerli teklifler arasında en düşük toplamlıdır.'
            : `En düşük geçerli teklif ${lowest === null ? '—' : money(lowest)}; bu teklifi seçmek için gerekçe yazın.`}
        </p>
        <FormField
          id="teklif-secim-gerekce"
          label={quote.lowest ? 'Gerekçe (isteğe bağlı)' : 'Seçim gerekçesi'}
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

/** Seçili tekliften sipariş (DOM-FIN-073): isteğe bağlı not; numara sunucuda verilir. */
function OrderModal({ quote, onClose }: { quote: PurchaseQuote; onClose: () => void }) {
  const create = useCreatePurchaseOrder()
  const form = useForm<OrderNoteFormValues>({
    resolver: zodResolver(orderNoteFormSchema),
    defaultValues: { note: '' },
  })
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const note = values.note.trim()
    const outcome = await create.submit(
      { quoteId: quote.id, note: note === '' ? null : note },
      {
        setError: (name: string, error: { type: string; message: string }) =>
          name === 'note'
            ? form.setError('note', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.number} siparişi açıldı.`)
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Sipariş aç"
      description={`${quote.supplier.name} · ${money(quote.grossCents)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={ORDER_FORM} disabled={busy} aria-busy={busy || undefined}>
            Siparişi aç
          </Button>
        </>
      }
    >
      <form
        id={ORDER_FORM}
        noValidate
        aria-label="Sipariş aç"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <p className="text-sm">
          Sipariş seçili teklifin fiyatlarıyla taslak olarak açılır; açıldıktan sonra teklifler
          değiştirilemez. PDF'i indirip tedarikçiye iletin, sonra gönderildi olarak işaretleyin.
        </p>
        <FormField
          id="siparis-not"
          label="Sipariş notu (isteğe bağlı)"
          error={form.formState.errors.note}
        >
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}
