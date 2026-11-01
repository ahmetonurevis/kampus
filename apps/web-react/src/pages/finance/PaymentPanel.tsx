import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@kampus/school-core/lib/domain.ts'
import { dayKey, money } from '@kampus/school-core/lib/format.ts'
import {
  amountInputValue,
  parseAmountInput,
  paymentFormSchema,
  type PaymentFormValues,
} from '@kampus/school-core/lib/payments.ts'
import {
  allocatedToInvoice,
  usePaymentSettings,
  useRecordPayment,
  useStudentPayments,
} from '@kampus/react-shared/use-payment-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { invoiceRow, type InvoiceRow } from './finance-rows.ts'

const FORM_ID = 'tahsilat-formu'
const CASH: PaymentMethod = 'Nakit'

type Props = {
  invoiceId: string
  onClose: () => void
}

/**
 * Tahsilat kaydı (`POST /payments`; ADR 0006, DOM-FIN-030…032): kısa form sağ panelde. Tutar
 * taksitin kalanıyla gelir, kısmi ödeme girilebilir. Nakit yalnız kurum ayarı açıksa listelenir.
 * Gönderim `useRecordPayment` ile: istek anahtarı, çift tıklama kilidi, 409'da Türkçe mesaj ve
 * liste tazeleme kancadadır. Başarıda veya mükerrer ödemede panel kapanır.
 */
export function PaymentPanel({ invoiceId, onClose }: Props) {
  return (
    <SidePanel
      open={invoiceId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Tahsilat kaydet"
    >
      {invoiceId ? <PaymentLoader invoiceId={invoiceId} onClose={onClose} /> : null}
    </SidePanel>
  )
}

/** Kalan tutar formun başlangıç değeridir: form ancak veriler gelince kurulur. */
function PaymentLoader({ invoiceId, onClose }: Props) {
  const item = useCoreItem('invoices', invoiceId)
  const row = item.data ? invoiceRow(item.data, dayKey()) : null
  const history = useStudentPayments(row?.studentId ?? '')
  const settings = usePaymentSettings()

  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (history.error)
    return <QueryError error={history.error} onRetry={() => void history.refetch()} />
  if (!row || !history.data || settings.isPending) return <SummaryLoading />
  // Bağlantıyla açılan ödenmiş taksit (veya başka sekmede ödenmiş): form gösterilmez.
  if (row.paidAt)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Bu taksit zaten ödenmiş.
      </p>
    )
  return (
    <PaymentForm
      row={row}
      paidCents={allocatedToInvoice(history.data.data, invoiceId)}
      cashEnabled={settings.cashEnabled}
      onClose={onClose}
    />
  )
}

function PaymentForm({
  row,
  paidCents,
  cashEnabled,
  onClose,
}: {
  row: InvoiceRow
  paidCents: number
  cashEnabled: boolean
  onClose: () => void
}) {
  const pay = useRecordPayment()
  const today = dayKey()
  const open = Math.max(row.amount - paidCents, 0)
  const methods = PAYMENT_METHODS.filter((method) => method !== CASH || cashEnabled)
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      amount: amountInputValue(open),
      method: methods[0] ?? 'Banka havalesi',
      reference: '',
      paidDate: today,
    },
  })
  const busy = pay.isPending || form.formState.isSubmitting
  const isCash = useWatch({ control: form.control, name: 'method' }) === CASH

  const onSubmit = form.handleSubmit(async ({ amount, method, reference, paidDate }) => {
    const amountCents = parseAmountInput(amount)
    if (amountCents === null) return
    const outcome = await pay.submit(
      {
        studentId: row.studentId,
        invoiceId: row.id,
        amountCents,
        method,
        ...(method === CASH ? {} : { reference }),
        // Bugün için gün gönderilmez: tahsilat kayıt anını taşır.
        ...(paidDate === today ? {} : { paidDate }),
      },
      {
        setError: (name, error) => {
          if (name === 'amountCents') form.setError('amount', error)
          else if (name === 'reference' || name === 'paidDate' || name === 'method')
            form.setError(name, error)
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Tahsilat kaydedildi.')
      onClose()
    }
    // Mükerrer ödeme: mesaj gösterildi, liste tazelendi; form artık geçersiz. Kullanılmış
    // referans da 409'dur ama düzeltilebilir: form açık kalır.
    else if (outcome.status === 'failed' && outcome.error.code === 'invoice_already_paid') onClose()
  })

  const errors = form.formState.errors
  const rootError = errors.root?.server
  return (
    <form id={FORM_ID} noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-5">
      <div className="info-box rounded-card border bg-surface-soft px-4 py-3 text-sm font-medium">
        <p>
          {row.studentName} · {row.installment}. taksit · {money(row.amount)}
        </p>
        {paidCents > 0 ? (
          <p className="mt-1 font-normal text-muted-foreground">
            Ödenen {money(paidCents)} · Kalan {money(open)}
          </p>
        ) : null}
      </div>
      <FormField
        id="tahsilat-tutar"
        label="Tutar (₺)"
        error={errors.amount}
        description="Kısmi ödeme girilebilir. Taksiti aşan tutar en eski vadeli taksite düşer."
      >
        {(control) => (
          <Input {...control} {...form.register('amount')} inputMode="decimal" disabled={busy} />
        )}
      </FormField>
      <FormField id="tahsilat-yontem" label="Ödeme yöntemi" error={errors.method}>
        {(control) => (
          <NativeSelect {...control} {...form.register('method')} disabled={busy}>
            {methods.map((method) => (
              <NativeSelectOption key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {isCash ? null : (
        <FormField
          id="tahsilat-referans"
          label="İşlem referansı"
          error={errors.reference}
          description="Banka dekontundaki veya POS fişindeki numara."
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('reference')}
              autoComplete="off"
              disabled={busy}
            />
          )}
        </FormField>
      )}
      <FormField id="tahsilat-tarih" label="Ödeme tarihi" error={errors.paidDate}>
        {(control) => (
          <Input
            {...control}
            {...form.register('paidDate')}
            type="date"
            max={today}
            disabled={busy}
          />
        )}
      </FormField>
      {rootError?.message ? (
        <p role="alert" className="text-sm text-danger">
          {rootError.message}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        <Icon name="CircleCheck" size={17} aria-hidden="true" />
        Tahsilatı kaydet
      </Button>
    </form>
  )
}
