import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import {
  useApproveInvoiceMatch,
  type SupplierInvoiceDetail,
  type SupplierInvoiceMatching,
} from '@kampus/react-shared/use-finance-supplier-ledger.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  INVOICE_MATCH_STATUS_LABELS,
  matchUnitLabel,
} from '@kampus/school-core/lib/finance-invoice-matching.ts'
import {
  PURCHASE_UNIT_LABELS,
  type PurchaseUnit,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { reasonFormSchema, type ReasonFormValues } from './finance-procurement-forms.ts'
import {
  invoiceLinesNetCents,
  MATCH_STATUS_VIEW,
  orderLineRows,
  type InvoiceFormValues,
} from './finance-supplier-ledger-forms.ts'

// Tedarikçi faturası üçlü eşleştirmesi (DOM-FIN-095; ON-277): fatura formundaki kalem tablosu,
// fatura ayrıntısındaki eşleştirme tablosu ve gerekçeli fark onayı (K-280…K-282).

const APPROVE_FORM = 'tedarikci-fatura-fark-onay-formu'
const signed = (cents: number) => (cents > 0 ? `+${money(cents)}` : money(cents))

export interface OrderItemOption {
  id: string
  name: string
  quantity: number
  unit: PurchaseUnit
  unitPriceCents: number
}

/**
 * Siparişe bağlı faturanın kalemleri: sipariş kalemi ya da siparişte olmayan kalem, faturalanan
 * miktar ve KDV hariç birim fiyat. Toplam faturanın KDV hariç tutarıyla karşılaştırılır.
 */
export function InvoiceLineFields({
  form,
  busy,
  items,
  netCents,
}: {
  form: UseFormReturn<InvoiceFormValues>
  busy: boolean
  items: readonly OrderItemOption[]
  netCents: number
}) {
  const array = useFieldArray({ control: form.control, name: 'lines' })
  const watched = useWatch({ control: form.control, name: 'lines' })
  const total = invoiceLinesNetCents(watched ?? [])
  const errors = form.formState.errors.lines
  const rootMessage =
    errors?.root?.message ?? errors?.message ?? form.formState.errors.root?.lines?.message
  return (
    <fieldset className="col-span-full grid gap-3">
      <legend className="mb-2 text-sm font-medium">Fatura kalemleri</legend>
      <p className="text-sm text-muted-foreground">
        Faturadaki miktar ve KDV hariç birim fiyatı yazın; sipariş ve mal kabulle eşleştirme
        kayıttan sonra fatura ayrıntısında görünür.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy || items.length === 0}
          onClick={() => array.replace(orderLineRows(items))}
        >
          Sipariş kalemlerini getir
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            array.append({ orderItemId: '', description: '', quantity: '1', unitPrice: '' })
          }
        >
          Siparişte olmayan kalem ekle
        </Button>
      </div>
      {array.fields.map((field, index) => {
        const row = watched?.[index]
        const linked = (row?.orderItemId ?? field.orderItemId) !== ''
        const rowErrors = errors?.[index]
        return (
          <div
            key={field.id}
            className="grid grid-cols-[2fr_1fr_1fr_auto] items-start gap-3 rounded-lg border p-3 max-[650px]:grid-cols-1"
          >
            {linked ? (
              <FormField
                id={`tfatura-kalem-${String(index)}-siparis`}
                label={`${String(index + 1)}. kalem`}
                error={rowErrors?.orderItemId}
              >
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register(`lines.${index}.orderItemId`)}
                    className="w-full"
                    disabled={busy}
                  >
                    {items.map((item) => (
                      <NativeSelectOption key={item.id} value={item.id}>
                        {`${item.name} · ${String(item.quantity)} ${PURCHASE_UNIT_LABELS[item.unit]} × ${money(item.unitPriceCents)}`}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            ) : (
              <FormField
                id={`tfatura-kalem-${String(index)}-ad`}
                label={`${String(index + 1)}. kalem (siparişte yok)`}
                error={rowErrors?.description}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`lines.${index}.description`)}
                    disabled={busy}
                  />
                )}
              </FormField>
            )}
            <FormField
              id={`tfatura-kalem-${String(index)}-miktar`}
              label={`${String(index + 1)}. kalem miktarı`}
              error={rowErrors?.quantity}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  {...form.register(`lines.${index}.quantity`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField
              id={`tfatura-kalem-${String(index)}-fiyat`}
              label={`${String(index + 1)}. kalem birim fiyatı (KDV hariç ₺)`}
              error={rowErrors?.unitPrice}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  {...form.register(`lines.${index}.unitPrice`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <Button
              type="button"
              variant="ghost"
              className="mt-7 max-[650px]:mt-0"
              aria-label={`${String(index + 1)}. kalemi kaldır`}
              disabled={busy}
              onClick={() => array.remove(index)}
            >
              <Icon name="Trash2" size={16} aria-hidden="true" />
            </Button>
          </div>
        )
      })}
      <p
        className={`text-right text-sm tabular-nums ${Math.abs(total - netCents) <= 100 ? 'text-muted-foreground' : 'font-semibold text-danger'}`}
        aria-live="polite"
      >
        {`Kalem toplamı ${money(total)} / fatura KDV hariç ${money(netCents)}`}
      </p>
      {rootMessage ? (
        <p role="alert" className="text-sm text-danger">
          {rootMessage}
        </p>
      ) : null}
    </fieldset>
  )
}

function MatchTable({ matching }: { matching: SupplierInvoiceMatching }) {
  if (matching.lines.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Bu faturanın kalemleri girilmemiş; sipariş ve mal kabulle karşılaştırılamaz.
      </p>
    )
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">Fatura eşleştirmesi</caption>
        <thead className="text-left text-muted-foreground">
          <tr>
            {[
              'Kalem',
              'Sipariş',
              'Kabul',
              'Önceki fatura',
              'Faturalanan',
              'Birim fiyat (sipariş / fatura)',
              'Durum',
            ].map((label) => (
              <th key={label} scope="col" className="py-2 pr-3 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {matching.lines.map((line, index) => {
            const view = MATCH_STATUS_VIEW[line.status]
            const unit = matchUnitLabel(line.unit)
            return (
              <tr
                key={`${line.orderItemId ?? 'yok'}-${String(index)}`}
                className="border-t align-top"
              >
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  {line.name}
                </th>
                <td className="py-2 pr-3">
                  {line.orderedQuantity === null ? '—' : `${String(line.orderedQuantity)} ${unit}`}
                </td>
                <td className="py-2 pr-3">
                  {line.acceptedQuantity === null ? '—' : String(line.acceptedQuantity)}
                </td>
                <td className="py-2 pr-3">
                  {line.previouslyInvoicedQuantity === null
                    ? '—'
                    : String(line.previouslyInvoicedQuantity)}
                </td>
                <td className="py-2 pr-3">
                  {String(line.invoicedQuantity)}
                  {line.quantityExcess > 0 ? (
                    <span className="block text-danger">{`${String(line.quantityExcess)} fazla`}</span>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  {`${line.orderUnitPriceCents === null ? '—' : money(line.orderUnitPriceCents)} / ${money(line.invoiceUnitPriceCents)}`}
                  {line.lineDifferenceCents !== 0 ? (
                    <span className="block text-muted-foreground">
                      {`Kalem farkı ${signed(line.lineDifferenceCents)}`}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge text={view.label} tone={view.tone} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Fatura ayrıntısındaki eşleştirme bölümü; siparişsiz faturada gösterilmez. */
export function InvoiceMatchingSection({ invoice }: { invoice: SupplierInvoiceDetail }) {
  const [approving, setApproving] = useState(false)
  const matching = invoice.matching
  if (matching === null) return null
  const view = MATCH_STATUS_VIEW[matching.status]
  const approval = matching.approved ? matching.approval : null
  const cancelled = invoice.status === 'cancelled'
  return (
    <section aria-labelledby="tfatura-eslestirme" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="tfatura-eslestirme" className="text-base font-semibold">
          Sipariş ve mal kabul eşleştirmesi
        </h3>
        <StatusBadge text={view.label} tone={view.tone} />
        {approval ? <StatusBadge text="Fark onaylandı" tone="green" /> : null}
      </div>
      <MatchTable matching={matching} />
      <p className="text-sm text-muted-foreground">
        {`Faturalanan miktar önceki faturalarla birlikte kabul edileni aşarsa miktar farkı; birim fiyat farkının kalem etkisi ${money(matching.toleranceCents)} tutarını aşarsa fiyat farkıdır.`}
      </p>
      {approval ? (
        <p className="text-sm">
          {`Fark ${dateLabel(approval.approvedAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' })} tarihinde ${approval.approvedByName ?? '—'} tarafından onaylandı: ${approval.reason}`}
        </p>
      ) : null}
      {matching.approvalRequired && !cancelled ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning p-3 text-sm"
        >
          <span>
            {`Fatura eşleşmiyor (${INVOICE_MATCH_STATUS_LABELS[matching.status].toLocaleLowerCase('tr-TR')}). Ödeme girmeden önce farkı gerekçeyle onaylayın.`}
          </span>
          <Button type="button" variant="secondary" onClick={() => setApproving(true)}>
            Farkı onayla
          </Button>
        </div>
      ) : null}
      {approving ? (
        <ApproveMatchModal invoice={invoice} onClose={() => setApproving(false)} />
      ) : null}
    </section>
  )
}

function ApproveMatchModal({
  invoice,
  onClose,
}: {
  invoice: SupplierInvoiceDetail
  onClose: () => void
}) {
  const approve = useApproveInvoiceMatch()
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = approve.isPending || form.formState.isSubmitting
  const status = invoice.matching?.status ?? 'unmatched'
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await approve.submit(
      { invoiceId: invoice.id, version: invoice.version, reason: values.reason.trim() },
      {
        setError: (_name: string, error: { type: string; message: string }) =>
          form.setError('reason', error, { shouldFocus: true }),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`Fatura ${invoice.invoiceNumber} farkı onaylandı.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Eşleştirme farkını onayla"
      description={`Fatura ${invoice.invoiceNumber} · ${INVOICE_MATCH_STATUS_LABELS[status]}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={APPROVE_FORM} disabled={busy} aria-busy={busy || undefined}>
            Farkı onayla
          </Button>
        </>
      }
    >
      <form
        id={APPROVE_FORM}
        noValidate
        aria-label="Eşleştirme farkını onayla"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <p className="text-sm">
          Onay bu sapma için geçerlidir ve denetim kaydına düşer; sapma değişirse ödeme yeniden onay
          ister.
        </p>
        <FormField
          id="tfatura-fark-gerekce"
          label="Onay gerekçesi"
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
