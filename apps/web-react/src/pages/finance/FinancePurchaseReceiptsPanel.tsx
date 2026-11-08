import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useCancelPurchaseReceipt,
  useCreatePurchaseReceipt,
  usePurchaseReceiptBoard,
  type PurchaseReceipt,
  type PurchaseReceiptBoard,
} from '@kampus/react-shared/use-finance-purchase-receipts.ts'
import { useStockItems, useStockWarehouses } from '@kampus/react-shared/use-finance-inventory.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
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
import { usePurchaseReceiptPdf } from '@/hooks/use-finance-purchase-receipt-pdf.ts'
import { notify } from '@/lib/notify.ts'
import { PURCHASE_RECEIPT_TITLE } from '@/lib/pdf/templates/finance-purchase-receipt.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import { reasonFormSchema, type ReasonFormValues } from './finance-procurement-forms.ts'
import {
  receiptBody,
  receiptDefaults,
  receiptFormField,
  receiptFormSchema,
  type ReceiptFormValues,
} from './finance-purchase-receipt-forms.ts'

const RECEIPT_FORM = 'mal-kabul-formu'
const CANCEL_FORM = 'mal-kabul-iptal-formu'
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const timeText = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
const quantity = (value: number, unit: PurchaseReceiptBoard['items'][number]['unit']) =>
  `${String(value)} ${PURCHASE_UNIT_LABELS[unit]}`

type Dialog = { kind: 'receive' } | { kind: 'cancel'; receipt: PurchaseReceipt } | null

/**
 * Siparişin mal kabulü (DOM-FIN-074; ON-226): kalem başına sipariş, kabul, ret ve kalan miktar,
 * KDV hariç gerçekleşen tutar, kabul formu ve kabul geçmişi. Kabulü yönetici ve ön büro kaydeder,
 * iptal yalnız yöneticidedir (K-153). Taslak siparişte gösterilmez: önce gönderildi işaretlenir.
 * Kaleme stok kartı seçilirse kabul edilen miktar seçilen depoya girer (DOM-FIN-078, K-184).
 * Her kabulün tutanak PDF'i geçmişten alınır; iptal edilmiş kabulünki "İPTAL" işaretlidir (ON-337).
 */
export function FinancePurchaseReceiptsPanel({ orderId }: { orderId: string }) {
  const query = usePurchaseReceiptBoard(orderId)
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = () => setDialog(null)
  if (query.error) return <QueryError error={query.error} onRetry={() => void query.refetch()} />
  const board = query.data?.data
  if (!board) return <SummaryLoading />
  return (
    <section aria-labelledby="mal-kabul" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="mal-kabul" className="text-base font-semibold">
          Mal kabul
        </h3>
        {board.actions.receive ? (
          <Button type="button" onClick={() => setDialog({ kind: 'receive' })}>
            <Icon name="ClipboardCheck" size={16} aria-hidden="true" />
            Mal kabul kaydet
          </Button>
        ) : null}
      </div>
      <ProgressTable board={board} />
      <p className="text-sm">
        <span className="text-muted-foreground">Gerçekleşen (KDV hariç): </span>
        <span className="font-semibold tabular-nums">{money(board.receivedNetCents)}</span>
      </p>
      <History board={board} onCancel={(receipt) => setDialog({ kind: 'cancel', receipt })} />
      {dialog?.kind === 'receive' ? <ReceiveModal board={board} onClose={close} /> : null}
      {dialog?.kind === 'cancel' ? (
        <CancelModal board={board} receipt={dialog.receipt} onClose={close} />
      ) : null}
    </section>
  )
}

function ProgressTable({ board }: { board: PurchaseReceiptBoard }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <caption className="sr-only">Kalem teslim durumu</caption>
        <thead className="text-left text-muted-foreground">
          <tr>
            {['Kalem', 'Sipariş', 'Kabul', 'Ret', 'Kalan'].map((label) => (
              <th key={label} scope="col" className="py-2 pr-3 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {board.items.map((item) => (
            <tr key={item.id} className="border-t align-top">
              <th scope="row" className="py-2 pr-3 text-left font-medium">
                {item.name}
              </th>
              <td className="py-2 pr-3">{quantity(item.quantity, item.unit)}</td>
              <td className="py-2 pr-3">{String(item.acceptedQuantity)}</td>
              <td className="py-2 pr-3">{String(item.rejectedQuantity)}</td>
              <td className="py-2 pr-3 font-medium">{String(item.remainingQuantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function History({
  board,
  onCancel,
}: {
  board: PurchaseReceiptBoard
  onCancel: (receipt: PurchaseReceipt) => void
}) {
  if (board.receipts.length === 0)
    return <p className="text-sm text-muted-foreground">Henüz mal kabul yok.</p>
  return (
    <ul className="grid gap-2" aria-label="Kabul geçmişi">
      {board.receipts.map((receipt) => (
        <li key={receipt.id} className="grid gap-2 rounded-lg border px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {`${dayText(receipt.receiptDate)} · teslim alan ${receipt.receivedBy}`}
            </span>
            <span className="flex items-center gap-2">
              {receipt.cancelledAt ? <StatusBadge text="İptal edildi" tone="red" /> : null}
              <span className="font-medium tabular-nums">{money(receipt.netCents)}</span>
            </span>
          </div>
          <ul className="grid gap-1 text-muted-foreground">
            {receipt.lines.map((line) => (
              <li key={line.orderItemId}>
                {`${line.name}: ${quantity(line.acceptedQuantity, line.unit)} kabul`}
                {line.rejectedQuantity > 0
                  ? `, ${String(line.rejectedQuantity)} ret (${line.rejectReason ?? ''})`
                  : ''}
                {line.stockItemName && receipt.warehouseName
                  ? ` · ${receipt.warehouseName} deposunda ${line.stockItemName} stoğuna girdi`
                  : ''}
              </li>
            ))}
          </ul>
          {receipt.inspectionNote ? <p>{`Muayene notu: ${receipt.inspectionNote}`}</p> : null}
          <p className="text-muted-foreground">
            {`Kaydeden ${receipt.createdByName ?? '—'} · ${timeText(receipt.createdAt)}`}
          </p>
          {receipt.cancelledAt ? (
            <p className="text-muted-foreground">
              {`İptal: ${receipt.cancelledByName ?? '—'} · ${timeText(receipt.cancelledAt)} · ${receipt.cancelReason ?? ''}`}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <PdfDialogButton
              label="Tutanak PDF"
              title={PURCHASE_RECEIPT_TITLE}
              id={{ orderId: board.order.id, receiptId: receipt.id }}
              usePdf={usePurchaseReceiptPdf}
              accessibleName={`Tutanak PDF · ${dayText(receipt.receiptDate)} kabulü`}
            />
            {receipt.actions.cancel ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`${dayText(receipt.receiptDate)} kabulünü iptal et`}
                onClick={() => onCancel(receipt)}
              >
                Kabulü iptal et
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

function ReceiveModal({ board, onClose }: { board: PurchaseReceiptBoard; onClose: () => void }) {
  const create = useCreatePurchaseReceipt()
  // Formun başlangıç değeri açılış anında bir kez kurulur; kabul günü bugündür (Europe/Istanbul).
  const [defaults] = useState(() => receiptDefaults(board, dayKey(new Date())))
  const form = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: defaults,
  })
  const items = new Map(board.items.map((item) => [item.id, item]))
  const lines = defaults.lines
  // Stok bağı isteğe bağlıdır: etkin depolar ve birimi kalemle aynı etkin stok kartları.
  const warehouses = useStockWarehouses({ page: 1, pageSize: 100, status: 'active' })
  const stockItems = useStockItems({ page: 1, pageSize: 100, status: 'active' })
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const { body, formIndexes } = receiptBody(values)
    const outcome = await create.submit(
      { orderId: board.order.id, body },
      {
        setError: (name: string, error: { type: string; message: string }) => {
          const field = receiptFormField(name, formIndexes)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${board.order.number} için mal kabul kaydedildi.`)
      onClose()
    }
  })
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Mal kabul kaydet"
      description={`${board.order.number} · kabul edilen miktar kalanı aşamaz`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={RECEIPT_FORM} disabled={busy} aria-busy={busy || undefined}>
            Kabulü kaydet
          </Button>
        </>
      }
    >
      <form
        id={RECEIPT_FORM}
        noValidate
        aria-label="Mal kabul kaydet"
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField id="mal-kabul-gun" label="Kabul günü" error={errors.receiptDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('receiptDate')} disabled={busy} />
          )}
        </FormField>
        <FormField id="mal-kabul-teslim-alan" label="Teslim alan" error={errors.receivedBy}>
          {(control) => <Input {...control} {...form.register('receivedBy')} disabled={busy} />}
        </FormField>
        <div className="col-span-full">
          <FormField
            id="mal-kabul-not"
            label="Muayene notu (isteğe bağlı)"
            error={errors.inspectionNote}
          >
            {(control) => (
              <Textarea
                {...control}
                {...form.register('inspectionNote')}
                rows={2}
                disabled={busy}
              />
            )}
          </FormField>
        </div>
        <div className="col-span-full">
          <FormField
            id="mal-kabul-depo"
            label="Stok deposu (isteğe bağlı)"
            error={errors.warehouseId}
            description="Kaleme stok kartı seçilirse kabul edilen miktar bu depoya girer."
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('warehouseId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Stoğa girmesin</NativeSelectOption>
                {(warehouses.data?.data ?? []).map((warehouse) => (
                  <NativeSelectOption key={warehouse.id} value={warehouse.id}>
                    {warehouse.campusName
                      ? `${warehouse.name} · ${warehouse.campusName}`
                      : warehouse.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
        <fieldset className="col-span-full grid gap-4">
          <legend className="mb-2 text-sm font-medium">Teslim alınan miktarlar</legend>
          {lines.map((line, index) => {
            const item = items.get(line.orderItemId)
            const name = item?.name ?? ''
            return (
              <div
                key={line.orderItemId}
                className="grid grid-cols-[1.5fr_1fr_1fr_2fr_2fr] items-start gap-3 max-[650px]:grid-cols-1"
              >
                <p className="pt-7 text-sm max-[650px]:pt-0">
                  <span className="font-medium">{name}</span>
                  <span className="block text-muted-foreground">
                    {item ? `kalan ${quantity(line.remaining, item.unit)}` : ''}
                  </span>
                </p>
                <FormField
                  id={`mal-kabul-${String(index)}-kabul`}
                  label={`${name} kabul edilen`}
                  error={errors.lines?.[index]?.accepted}
                >
                  {(control) => (
                    <Input
                      {...control}
                      inputMode="numeric"
                      {...form.register(`lines.${index}.accepted`)}
                      disabled={busy}
                    />
                  )}
                </FormField>
                <FormField
                  id={`mal-kabul-${String(index)}-ret`}
                  label={`${name} reddedilen`}
                  error={errors.lines?.[index]?.rejected}
                >
                  {(control) => (
                    <Input
                      {...control}
                      inputMode="numeric"
                      {...form.register(`lines.${index}.rejected`)}
                      disabled={busy}
                    />
                  )}
                </FormField>
                <FormField
                  id={`mal-kabul-${String(index)}-neden`}
                  label={`${name} ret nedeni`}
                  error={errors.lines?.[index]?.rejectReason}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`lines.${index}.rejectReason`)}
                      disabled={busy}
                    />
                  )}
                </FormField>
                <FormField
                  id={`mal-kabul-${String(index)}-stok`}
                  label={`${name} stok kartı`}
                  error={errors.lines?.[index]?.stockItemId}
                >
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`lines.${index}.stockItemId`)}
                      className="w-full"
                      disabled={busy}
                    >
                      <NativeSelectOption value="">Stok kartı yok</NativeSelectOption>
                      {(stockItems.data?.data ?? [])
                        .filter((stock) => stock.unit === item?.unit)
                        .map((stock) => (
                          <NativeSelectOption key={stock.id} value={stock.id}>
                            {`${stock.code} · ${stock.name}`}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  )}
                </FormField>
              </div>
            )
          })}
        </fieldset>
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

function CancelModal({
  board,
  receipt,
  onClose,
}: {
  board: PurchaseReceiptBoard
  receipt: PurchaseReceipt
  onClose: () => void
}) {
  const cancel = useCancelPurchaseReceipt()
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      {
        orderId: board.order.id,
        receiptId: receipt.id,
        version: receipt.version,
        reason: values.reason.trim(),
      },
      {
        setError: (_name: string, error: { type: string; message: string }) =>
          form.setError('reason', error, { shouldFocus: true }),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Mal kabul iptal edildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Mal kabulü iptal et"
      description={`${board.order.number} · ${dayText(receipt.receiptDate)} · ${money(receipt.netCents)}`}
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
        aria-label="Mal kabulü iptal et"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <p className="text-sm">
          Kayıt silinmez; sipariş durumu ve gider gerçekleşeni kalan kabullerden yeniden hesaplanır.
        </p>
        <FormField
          id="mal-kabul-iptal-gerekce"
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
