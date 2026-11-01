import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { reversePaymentSchema } from '@kampus/school-core/lib/payments.ts'
import { usePaymentList, useReversePayment } from '@kampus/react-shared/use-payment-commands.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'

type PaymentRow = {
  id: string
  paidAt: string
  receipt: string
  studentName: string
  method: string
  reference: string
  amountCents: number
  creditCents: number
  status: string
  reversed: boolean
  version: number
}

const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['paidAt', 'studentName', 'amountCents', 'status']
const FORM_ID = 'tahsilat-iptal-formu'

/**
 * Tahsilat geçmişi ve iptal (ADR 0006; DOM-FIN-030, -033, -050). Her ödeme ayrı satırdır; arama
 * öğrenci adı ve işlem referansında sunucuda yapılır. İptal yalnız yöneticide ve gerekçelidir;
 * iptal edilen satır silinmez, "İptal edildi" olarak kalır.
 */
export function PaymentsSection({ canReverse }: { canReverse: boolean }) {
  const list = useListState('tahsilatlar')
  const search = useDebouncedValue(list.state.query)
  const payments = usePaymentList({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.trim().length >= 2 ? { q: search.trim() } : {}),
  })
  const [reversing, setReversing] = useState<PaymentRow | null>(null)

  const rows = useMemo(
    () =>
      payments.data?.data.map((payment): PaymentRow => ({
        id: payment.id,
        paidAt: payment.paidAt,
        receipt: `${String(payment.receiptYear)}-${String(payment.receiptNumber)}`,
        studentName: payment.studentName ?? '—',
        method: payment.method,
        reference: payment.reference ?? '—',
        amountCents: payment.amountCents,
        creditCents: payment.creditCents,
        status: payment.reversedAt === null ? 'Geçerli' : 'İptal edildi',
        reversed: payment.reversedAt !== null,
        version: payment.version,
      })),
    [payments.data],
  )

  const columns = useMemo<DataColumn<PaymentRow>[]>(
    () => [
      {
        key: 'paidAt',
        label: 'Ödeme tarihi',
        cell: (row) => dateLabel(row.paidAt, { year: 'numeric' }),
      },
      { key: 'receipt', label: 'Dekont no' },
      { key: 'studentName', label: 'Öğrenci' },
      { key: 'method', label: 'Yöntem' },
      { key: 'reference', label: 'İşlem referansı' },
      {
        key: 'amountCents',
        label: 'Tutar',
        cell: (row) => (
          <span className="grid">
            <strong className="font-semibold">{money(row.amountCents)}</strong>
            {row.creditCents > 0 ? (
              <small className="text-xs text-muted-foreground">
                {money(row.creditCents)} iade alacağı
              </small>
            ) : null}
          </span>
        ),
      },
      { key: 'status', label: 'Durum', cell: (row) => <StatusBadge text={row.status} /> },
      ...(canReverse
        ? [
            {
              key: ACTIONS_KEY,
              label: 'İşlemler',
              cell: (row: PaymentRow) =>
                row.reversed ? null : (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`${row.receipt} numaralı tahsilatı iptal et`}
                    onClick={() => setReversing(row)}
                  >
                    İptal et
                  </Button>
                ),
            },
          ]
        : []),
    ],
    [canReverse],
  )

  const total = payments.data?.meta.total ?? 0
  return (
    <section
      aria-labelledby="tahsilat-tablosu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="tahsilat-tablosu" className="text-lg font-semibold">
          Tahsilat geçmişi
        </h2>
        <p className="text-sm text-muted-foreground">{total} kayıt · En yeni ödeme önce</p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={total}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Tahsilat geçmişi"
        loading={payments.isPending}
        fetching={payments.isFetching && !payments.isPending}
        error={
          payments.error ? (
            <QueryError error={payments.error} onRetry={() => void payments.refetch()} />
          ) : undefined
        }
      />
      {reversing ? <ReverseModal row={reversing} onClose={() => setReversing(null)} /> : null}
    </section>
  )
}

function ReverseModal({ row, onClose }: { row: PaymentRow; onClose: () => void }) {
  const reverse = useReversePayment()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(reversePaymentSchema),
    defaultValues: { reason: '' },
  })
  const busy = reverse.isPending || form.formState.isSubmitting

  const onSubmit = form.handleSubmit(async ({ reason }) => {
    const outcome = await reverse.submit(
      { paymentId: row.id, version: row.version, reason },
      { setError: (_name, error) => form.setError('reason', error) },
    )
    if (outcome.status === 'success') {
      notify.success('Tahsilat iptal edildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.status === 409) onClose()
  })

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Tahsilatı iptal et"
      description={`${row.receipt} · ${row.studentName} · ${money(row.amountCents)}. Kayıt silinmez, dağıtıldığı taksitler yeniden açılır.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            Tahsilatı iptal et
          </Button>
        </>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={(event) => void onSubmit(event)}>
        <FormField id="iptal-gerekce" label="İptal gerekçesi" error={form.formState.errors.reason}>
          {(control) => <Textarea {...control} {...form.register('reason')} disabled={busy} />}
        </FormField>
      </form>
    </Modal>
  )
}
