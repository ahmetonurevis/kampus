import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { useExtendPackageSale, usePackageSale } from '@kampus/react-shared/use-finance-packages.ts'
import {
  extendPackageSaleSchema,
  type ExtendPackageSaleInput,
} from '@kampus/school-core/lib/finance-packages.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading, SummaryMetrics } from '../management/SummaryParts.tsx'
import { PACKAGE_SALE_STATUS_VIEW } from './package-forms.ts'
import { CONTRACT_PANEL_PARAM } from './ContractsSection.tsx'

const EXTEND_FORM = 'paket-uzatma-formu'
const dayText = (day: string) => dateLabel(day, { year: 'numeric' })
const hoursText = (hours: number) => `${String(hours)} saat`

/**
 * Paket satışı ayrıntısı (`?paket-satis=`; IST-078, DOM-DIL-051): satın alınan, kullanılan, iade
 * edilen ve kalan saat, son kullanma ve sözleşmenin kendi taksitleri. Süre dolunca kalan saat
 * silinmez; kursiyerin seçimine göre süre uzatılır ya da iade hesabına girer (H-19, doğrulanmalı).
 */
export function PackageSalePanel({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  return (
    <SidePanel
      open={saleId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Paket satışı ayrıntısı"
    >
      {saleId ? <SaleDetail saleId={saleId} /> : null}
    </SidePanel>
  )
}

function SaleDetail({ saleId }: { saleId: string }) {
  const item = usePackageSale(saleId)
  const [extending, setExtending] = useState(false)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const sale = item.data.data
  const status = PACKAGE_SALE_STATUS_VIEW[sale.status]
  const canExtend = sale.expiresDate !== null && sale.remainingHours > 0
  return (
    <>
      <div className="mb-5 grid gap-1">
        <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">
          {sale.studentName ?? '—'}
        </h3>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{sale.packageName}</p>
        <div>
          <StatusBadge text={status.label} tone={status.tone} />
        </div>
      </div>
      <SummaryMetrics
        items={[
          { label: 'Satın alınan', value: hoursText(sale.purchasedHours) },
          { label: 'Kullanılan', value: hoursText(sale.consumedHours) },
          { label: 'İade edilen', value: hoursText(sale.refundedHours) },
          { label: 'Kalan', value: hoursText(sale.remainingHours) },
        ]}
      />
      <dl className="mb-6 divide-y text-sm">
        <div className="flex flex-wrap justify-between gap-x-4 py-1.5">
          <dt className="text-muted-foreground">Son kullanma</dt>
          <dd>{sale.expiresDate ? dayText(sale.expiresDate) : 'Süresiz'}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 py-1.5">
          <dt className="text-muted-foreground">Uygulanan saat ücreti</dt>
          <dd>{money(sale.hourlyCents)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 py-1.5">
          <dt className="text-muted-foreground">Öğrenim ücreti</dt>
          <dd>{money(sale.netCents)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 py-1.5">
          <dt className="text-muted-foreground">Satış tarihi</dt>
          <dd>{dayText(sale.soldAt)}</dd>
        </div>
      </dl>
      {sale.status === 'expired' ? (
        <p className="mb-6 text-sm">
          Kullanım süresi doldu; kalan saatler silinmez. Kursiyerin seçimine göre süre uzatılır ya
          da iade hesabına girer.
        </p>
      ) : null}
      <h4 className="mb-1 text-sm font-medium">Taksitler</h4>
      <ul aria-label="Satışın taksitleri" className="mb-6 divide-y text-sm">
        {sale.invoices.map((invoice) => (
          <li key={invoice.id} className="flex flex-wrap justify-between gap-x-4 py-1.5">
            <span className="text-muted-foreground">
              {invoice.installment}. taksit · {dayText(invoice.dueDate)}
            </span>
            <span>
              {money(invoice.amountCents)}
              {invoice.paidAt ? ' · Ödendi' : ''}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {canExtend ? (
          <Button onClick={() => setExtending(true)}>
            <Icon name="Calendar" size={17} aria-hidden="true" />
            Süreyi uzat
          </Button>
        ) : null}
        <Button asChild variant="secondary">
          <Link
            to={{
              search: new URLSearchParams({
                gorunum: 'sozlesmeler',
                [CONTRACT_PANEL_PARAM]: sale.contractId,
              }).toString(),
            }}
          >
            Sözleşmeyi aç
          </Link>
        </Button>
      </div>
      {extending && sale.expiresDate ? (
        <ExtendModal
          saleId={sale.id}
          version={sale.version}
          expiresDate={sale.expiresDate}
          onClose={() => setExtending(false)}
        />
      ) : null}
    </>
  )
}

/** Süre uzatma: gerekçe yalnız denetim kaydına yazılır; yeni gün sunucuda da denetlenir. */
function ExtendModal({
  saleId,
  version,
  expiresDate,
  onClose,
}: {
  saleId: string
  version: number
  expiresDate: string
  onClose: () => void
}) {
  const extend = useExtendPackageSale()
  const [today] = useState(() => dayKey())
  const form = useForm<ExtendPackageSaleInput>({
    resolver: zodResolver(extendPackageSaleSchema),
    defaultValues: { expiresDate: '', reason: '' },
  })
  const busy = extend.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (body) => {
    const outcome = await extend.submit(
      { saleId, version, body },
      {
        setError: (name, error) =>
          form.setError(name === 'reason' ? 'reason' : 'expiresDate', error, {
            shouldFocus: true,
          }),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Son kullanma tarihi uzatıldı.')
      onClose()
    }
  })

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Son kullanma tarihini uzat"
      description={`Mevcut son kullanma: ${dayText(expiresDate)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={EXTEND_FORM} disabled={busy} aria-busy={busy || undefined}>
            Süreyi uzat
          </Button>
        </>
      }
    >
      <form
        id={EXTEND_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="uzatma-tarih" label="Yeni son kullanma" error={errors.expiresDate}>
          {(control) => (
            <Input
              {...control}
              {...form.register('expiresDate')}
              type="date"
              min={today > expiresDate ? today : expiresDate}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="uzatma-gerekce" label="Gerekçe" error={errors.reason}>
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
          )}
        </FormField>
      </form>
    </Modal>
  )
}
