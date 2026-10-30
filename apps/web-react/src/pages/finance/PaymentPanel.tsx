import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  paymentInputSchema,
  type PaymentInput,
} from '@kampus/school-core/lib/domain.ts'
import { dayKey, money } from '@kampus/school-core/lib/format.ts'
import { usePayInvoice } from '@kampus/react-shared/use-invoice-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { invoiceRow } from './finance-rows.ts'

type PaymentValues = PaymentInput

const FORM_ID = 'tahsilat-formu'

type Props = {
  invoiceId: string
  onClose: () => void
}

/**
 * Tahsilat kaydı (Vue "Tahsilat kaydet" drawer'ı): kısa form sağ panelde, ödeme yöntemi seçilir.
 * Gönderim `usePayInvoice` ile: istek anahtarı, çift tıklama kilidi, 409'da Türkçe mesaj ve
 * liste tazeleme kancadadır. Başarıda veya mükerrer ödemede panel kapanır.
 */
export function PaymentPanel({ invoiceId, onClose }: Props) {
  return (
    <SidePanel
      open={invoiceId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Tahsilat kaydet"
    >
      {invoiceId ? <PaymentForm invoiceId={invoiceId} onClose={onClose} /> : null}
    </SidePanel>
  )
}

function PaymentForm({ invoiceId, onClose }: Props) {
  const item = useCoreItem('invoices', invoiceId)
  const pay = usePayInvoice()
  const form = useForm<PaymentValues>({
    resolver: zodResolver(paymentInputSchema),
    defaultValues: { method: PAYMENT_METHODS[0] },
  })
  const busy = pay.isPending || form.formState.isSubmitting

  const onSubmit = form.handleSubmit(async ({ method }) => {
    const outcome = await pay.submit({ invoiceId, method }, { setError: form.setError })
    if (outcome.status === 'success') {
      notify.success('Tahsilat kaydedildi.')
      onClose()
    }
    // Mükerrer ödeme: mesaj gösterildi, liste tazelendi; form artık geçersiz.
    else if (outcome.status === 'failed' && outcome.error.status === 409) onClose()
  })

  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const row = invoiceRow(item.data, dayKey())
  // Bağlantıyla açılan ödenmiş taksit (veya başka sekmede ödenmiş): form gösterilmez.
  if (row.paidAt && !busy)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Bu taksit zaten ödenmiş.
      </p>
    )

  const methodError = form.formState.errors.method
  const rootError = form.formState.errors.root?.server
  return (
    <form id={FORM_ID} noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-5">
      <p className="info-box rounded-card border bg-surface-soft px-4 py-3 text-sm font-medium">
        {row.studentName} · {row.installment}. taksit · {money(row.amount)}
      </p>
      <FormField id="tahsilat-yontem" label="Ödeme yöntemi" error={methodError}>
        {(control) => (
          <NativeSelect {...control} {...form.register('method')} disabled={busy}>
            {PAYMENT_METHODS.map((method) => (
              <NativeSelectOption key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <p className="text-sm text-muted-foreground">
        Bu işlem tahsilatı kaydeder ve öğrencinin ödeme planını günceller.
      </p>
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
