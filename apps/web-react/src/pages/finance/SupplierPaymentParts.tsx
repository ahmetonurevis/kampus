import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useBankAccounts } from '@kampus/react-shared/use-payment-commands.ts'
import {
  useCancelSupplierPayment,
  useCreateSupplierPayment,
  type SupplierInvoiceDetail,
  type SupplierPaymentRow,
} from '@kampus/react-shared/use-finance-supplier-ledger.ts'
import { dayKey, money } from '@kampus/school-core/lib/format.ts'
import { SUPPLIER_PAYMENT_METHOD_LABELS } from '@kampus/school-core/lib/finance-supplier-ledger.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { reasonFormSchema, type ReasonFormValues } from './finance-procurement-forms.ts'
import {
  dayText,
  PAYMENT_METHOD_OPTIONS,
  paymentBody,
  paymentDefaults,
  paymentFormField,
  paymentFormSchema,
  type PaymentFormValues,
} from './finance-supplier-ledger-forms.ts'

const PAYMENT_FORM = 'tedarikci-odeme-formu'
const CANCEL_FORM = 'tedarikci-odeme-iptal-formu'

/** Kurum hesabı etiketi: banka adı ve IBAN'ın son dört hanesi. */
export const accountLabel = (account: { bankName: string; iban: string }) =>
  `${account.bankName} ·${account.iban.slice(-4)}`

/** Faturanın ödemeleri (iptaller dahil) ve gerekçeli iptal. */
export function SupplierPaymentsList({ payments }: { payments: readonly SupplierPaymentRow[] }) {
  const [cancelling, setCancelling] = useState<SupplierPaymentRow | null>(null)
  return (
    <section aria-labelledby="tfatura-odemeler" className="grid gap-3">
      <h3 id="tfatura-odemeler" className="text-base font-semibold">
        Ödemeler
      </h3>
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz ödeme yok.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Ödemeler">
          {payments.map((payment) => (
            <li
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium tabular-nums">{`${money(payment.amountCents)} · ${SUPPLIER_PAYMENT_METHOD_LABELS[payment.method]}`}</span>
                <span className="block text-muted-foreground">
                  {[
                    dayText(payment.paidDate),
                    payment.bankAccount?.label,
                    payment.instructionExportedAt ? 'talimatı alındı' : null,
                    payment.cancelReason ? `iptal: ${payment.cancelReason}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {payment.cancelledAt ? (
                <StatusBadge text="İptal edildi" tone="gray" />
              ) : payment.actions.cancel ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${money(payment.amountCents)} ödemesini iptal et`}
                  onClick={() => setCancelling(payment)}
                >
                  İptal et
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {cancelling ? (
        <CancelPaymentModal payment={cancelling} onClose={() => setCancelling(null)} />
      ) : null}
    </section>
  )
}

/**
 * Taksite ödeme girişi: kalanı aşan tutar sunucuda reddedilir (422), formda kalan önerilir. Banka
 * hesapları yüklenince form açılır; ilk hesap öntanımlıdır.
 */
export function SupplierPaymentModal(props: {
  invoice: SupplierInvoiceDetail
  installment: SupplierInvoiceDetail['installments'][number]
  onClose: () => void
}) {
  const accounts = useBankAccounts()
  if (accounts.isPending)
    return (
      <Modal open onOpenChange={(open) => (open ? undefined : props.onClose())} title="Ödeme gir">
        <SummaryLoading />
      </Modal>
    )
  return <PaymentFormModal {...props} accounts={accounts.data?.data ?? []} />
}

function PaymentFormModal({
  invoice,
  installment,
  accounts: accountList,
  onClose,
}: {
  invoice: SupplierInvoiceDetail
  installment: SupplierInvoiceDetail['installments'][number]
  accounts: readonly { id: string; bankName: string; iban: string }[]
  onClose: () => void
}) {
  const create = useCreateSupplierPayment()
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: paymentDefaults(installment, dayKey(), accountList[0]?.id ?? ''),
  })
  const method = useWatch({ control: form.control, name: 'method' })
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(paymentBody(values), {
      setError: (name: string, error: { type: string; message: string }) => {
        const field = paymentFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success(`${money(outcome.data.data.amountCents)} ödeme kaydedildi.`)
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ödeme gir"
      description={`Fatura ${invoice.invoiceNumber} · taksit kalanı ${money(installment.remainingCents)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={PAYMENT_FORM} disabled={busy} aria-busy={busy || undefined}>
            Ödemeyi kaydet
          </Button>
        </>
      }
    >
      <form
        id={PAYMENT_FORM}
        noValidate
        aria-label="Ödeme gir"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="todeme-gun" label="Ödeme günü" error={errors.paidDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('paidDate')} disabled={busy} />
          )}
        </FormField>
        <FormField id="todeme-tutar" label="Tutar (₺)" error={errors.amount}>
          {(control) => (
            <Input {...control} inputMode="decimal" {...form.register('amount')} disabled={busy} />
          )}
        </FormField>
        <FormField id="todeme-yontem" label="Yöntem" error={errors.method}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('method')}
              className="w-full"
              disabled={busy}
            >
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {method === 'cash' ? (
          <p className="text-sm text-muted-foreground">
            Nakit ödeme kasadan çıkar; günü kapatılmış güne nakit ödeme girilmez.
          </p>
        ) : (
          <FormField
            id="todeme-hesap"
            label="Kurum banka hesabı"
            error={errors.bankAccountId}
            {...(accountList.length === 0
              ? { description: 'Tanımlı banka hesabı yok; Ayarlar’dan hesap ekleyin.' }
              : {})}
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('bankAccountId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Hesap seçin</NativeSelectOption>
                {accountList.map((account) => (
                  <NativeSelectOption key={account.id} value={account.id}>
                    {accountLabel(account)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
        <FormField
          id="todeme-aciklama"
          label="Banka açıklaması (isteğe bağlı)"
          error={errors.description}
          description={`Boşsa "Fatura ${invoice.invoiceNumber} ödemesi" yazılır.`}
        >
          {(control) => <Input {...control} {...form.register('description')} disabled={busy} />}
        </FormField>
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}

function CancelPaymentModal({
  payment,
  onClose,
}: {
  payment: SupplierPaymentRow
  onClose: () => void
}) {
  const cancel = useCancelSupplierPayment()
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { paymentId: payment.id, version: payment.version, reason: values.reason.trim() },
      {
        setError: (_name: string, error: { type: string; message: string }) =>
          form.setError('reason', error, { shouldFocus: true }),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Ödeme iptal edildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ödemeyi iptal et"
      description={`${money(payment.amountCents)} · ${dayText(payment.paidDate)}`}
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
        aria-label="Ödemeyi iptal et"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <p className="text-sm">
          Ödeme silinmez; taksit yeniden açılır.
          {payment.instructionExportedAt
            ? ' Bu ödemenin talimat dosyası alındı: bankadaki talimatı ayrıca durdurun.'
            : ''}
        </p>
        <FormField
          id="todeme-iptal-gerekce"
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
