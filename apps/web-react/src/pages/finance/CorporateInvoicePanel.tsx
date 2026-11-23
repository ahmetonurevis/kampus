import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useCancelCorporateInvoice,
  useCorporateInvoice,
  useCorporateInvoiceExport,
  type CorporateInvoice,
} from '@kampus/react-shared/use-finance-corporate.ts'
import { FEE_ITEM_KIND_LABELS } from '@kampus/school-core/lib/fee-tariffs.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useCorporateInvoicePdf } from '@/hooks/use-finance-corporate-pdf.ts'
import { CORPORATE_INVOICE_TITLE } from '@/lib/pdf/templates/finance-corporate.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading, SummaryMetrics } from '../management/SummaryParts.tsx'
import { RootError } from '../management/FormParts.tsx'
import { CsvButton, PdfDialogButton } from './CorporateParts.tsx'
import { cancelFormSchema, LINE_STATUS_VIEW, type CancelFormValues } from './corporate-forms.ts'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/**
 * Toplu fatura ayrıntısı (`?toplu-fatura=`; DOM-FIN-060): kesim anındaki şirket bilgisi, satırlar ve
 * satırın bugünkü ödeme durumu. Döküm PDF ve CSV olarak alınır; CSV taze oturum ister. İptal yalnız
 * yöneticide, gerekçeyle; iptal satırları serbest bırakır.
 */
export function CorporateInvoicePanel({
  invoiceId,
  canCancel,
  onClose,
}: {
  invoiceId: string
  canCancel: boolean
  onClose: () => void
}) {
  return (
    <SidePanel
      open={invoiceId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Toplu fatura"
    >
      {invoiceId ? <InvoiceDetail invoiceId={invoiceId} canCancel={canCancel} /> : null}
    </SidePanel>
  )
}

function InvoiceDetail({ invoiceId, canCancel }: { invoiceId: string; canCancel: boolean }) {
  const item = useCorporateInvoice(invoiceId)
  const exporter = useCorporateInvoiceExport()
  const [cancelling, setCancelling] = useState(false)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const invoice = item.data?.data
  if (!invoice) return <SummaryLoading />
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{invoice.number}</h3>
        {invoice.cancelledAt ? (
          <StatusBadge text="İptal edildi" tone="gray" />
        ) : (
          <StatusBadge text="Geçerli" tone="green" />
        )}
      </div>
      <SummaryMetrics
        items={[
          { label: 'Toplam', value: money(invoice.totalCents) },
          { label: 'Taksit', value: String(invoice.lineCount) },
        ]}
      />
      <dl className="grid gap-2 text-sm">
        <Pair label="Şirket" value={invoice.customerName} />
        <Pair
          label="Vergi dairesi / numarası"
          value={`${invoice.taxOffice} / ${invoice.taxNumber}`}
        />
        <Pair label="Fatura adresi" value={invoice.billingAddress} />
        <Pair
          label="Dönem"
          value={`${dayText(invoice.periodFrom)} – ${dayText(invoice.periodTo)}`}
        />
        <Pair label="Kesim" value={dateLabel(invoice.issuedAt, { year: 'numeric' })} />
        {invoice.cancelledAt ? (
          <Pair label="İptal gerekçesi" value={invoice.cancelReason ?? '—'} />
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        <PdfDialogButton
          label="Döküm PDF"
          title={CORPORATE_INVOICE_TITLE}
          id={invoiceId}
          usePdf={useCorporateInvoicePdf}
        />
        <CsvButton
          label="Döküm CSV"
          filename={`toplu-fatura-${invoice.number}.csv`}
          busy={exporter.isPending}
          download={() => exporter.submit(invoiceId)}
        />
        {canCancel && !invoice.cancelledAt ? (
          <Button type="button" variant="outline" onClick={() => setCancelling(true)}>
            İptal et
          </Button>
        ) : null}
      </div>
      <section aria-labelledby="toplu-fatura-satirlari" className="grid gap-2">
        <h4 id="toplu-fatura-satirlari" className="text-sm font-semibold">
          Taksitler
        </h4>
        <ul className="grid gap-2">
          {invoice.lines.map((line) => {
            const view = LINE_STATUS_VIEW[line.status]
            return (
              <li
                key={line.invoiceId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{line.studentName ?? '—'}</span>
                  <span className="block text-muted-foreground">
                    {line.installment}. taksit · {FEE_ITEM_KIND_LABELS[line.feeKind ?? 'tuition']} ·{' '}
                    {dayText(line.dueDate)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge text={view.label} tone={view.tone} />
                  <span className="font-medium tabular-nums">{money(line.amountCents)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      </section>
      {cancelling ? <CancelModal invoice={invoice} onClose={() => setCancelling(false)} /> : null}
    </div>
  )
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_1fr] gap-2 max-[480px]:grid-cols-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

const CANCEL_FORM = 'toplu-fatura-iptal-formu'

function CancelModal({ invoice, onClose }: { invoice: CorporateInvoice; onClose: () => void }) {
  const cancel = useCancelCorporateInvoice()
  const form = useForm<CancelFormValues>({
    resolver: zodResolver(cancelFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { invoiceId: invoice.id, version: invoice.version, reason: values.reason },
      {
        setError: (name, error) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${invoice.number} iptal edildi.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Toplu faturayı iptal et"
      description={`${invoice.number} iptal edilince taksitleri yeniden faturalanabilir; numara yeniden kullanılmaz.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form={CANCEL_FORM}
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            İptal et
          </Button>
        </>
      }
    >
      <form
        id={CANCEL_FORM}
        noValidate
        aria-label="Toplu fatura iptali"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField
          id="toplu-fatura-iptal-gerekce"
          label="İptal gerekçesi"
          error={form.formState.errors.reason}
        >
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}
