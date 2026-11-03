import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  reversePaymentSchema,
  type PaymentMethod,
} from '@kampus/school-core/lib/payments.ts'
import {
  usePaymentList,
  useReversePayment,
  useSetPaymentMebbis,
} from '@kampus/react-shared/use-payment-commands.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
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
  bankAccount: string
  mebbisRecordedAt: string | null
  amountCents: number
  creditCents: number
  status: string
  reversed: boolean
  version: number
}

const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['paidAt', 'studentName', 'amountCents', 'status']
const FORM_ID = 'tahsilat-iptal-formu'
const ALL = 'all'

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value)
}

/**
 * Tahsilat geçmişi ve iptal (ADR 0006; DOM-FIN-030, -033, -050). Her ödeme ayrı satırdır; arama
 * öğrenci adı ve işlem referansında, ödeme yöntemi ve MEBBİS süzgeci sunucuda yapılır (Vue
 * `Finance.vue` "Ödeme yöntemi" süzgecinin karşılığı: kısmi ödemede taksitin tek yöntemi yoktur,
 * yöntem tahsilatındır). İptal yalnız yöneticide ve gerekçelidir; iptal edilen satır silinmez,
 * "İptal edildi" olarak kalır.
 */
export function PaymentsSection({ canReverse }: { canReverse: boolean }) {
  const setMebbis = useSetPaymentMebbis()
  const list = useListState('tahsilatlar')
  const search = useDebouncedValue(list.state.query)
  const mebbisPending = list.state.filters.mebbis === 'pending'
  const method = isPaymentMethod(list.state.filters.method) ? list.state.filters.method : null
  const payments = usePaymentList({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.trim().length >= 2 ? { q: search.trim() } : {}),
    ...(mebbisPending ? { mebbis: 'pending' as const } : {}),
    ...(method ? { method } : {}),
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
        bankAccount: payment.bankAccountLabel ?? '—',
        mebbisRecordedAt: payment.mebbisRecordedAt,
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
      { key: 'bankAccount', label: 'Banka hesabı' },
      {
        key: 'mebbisRecordedAt',
        label: 'MEBBİS',
        cell: (row) =>
          row.reversed
            ? '—'
            : row.mebbisRecordedAt === null
              ? 'İşlenmedi'
              : dateLabel(row.mebbisRecordedAt, { year: 'numeric' }),
      },
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
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: PaymentRow) => (
          <span className="flex flex-wrap gap-2">
            <PdfButton
              type="payment-receipt"
              recordId={row.id}
              label="Dekont"
              ariaLabel={`${row.receipt} numaralı dekontu görüntüle`}
            />
            {row.reversed ? null : (
              <Button
                size="sm"
                variant="secondary"
                disabled={setMebbis.isPending}
                aria-label={`${row.receipt} numaralı tahsilatın MEBBİS işaretini değiştir`}
                onClick={() =>
                  void setMebbis.submit({
                    paymentId: row.id,
                    version: row.version,
                    recorded: row.mebbisRecordedAt === null,
                  })
                }
              >
                {row.mebbisRecordedAt === null ? "MEBBİS'e işlendi" : 'İşareti kaldır'}
              </Button>
            )}
            {canReverse && !row.reversed ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.receipt} numaralı tahsilatı iptal et`}
                onClick={() => setReversing(row)}
              >
                İptal et
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [canReverse, setMebbis],
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
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="grid w-full max-w-xs gap-1 text-sm font-medium">
            Ödeme yöntemi
            <NativeSelect
              value={method ?? ALL}
              onChange={(event) =>
                list.dispatch({
                  type: 'filter',
                  key: 'method',
                  value: isPaymentMethod(event.target.value) ? event.target.value : '',
                })
              }
            >
              <NativeSelectOption value={ALL}>Tüm yöntemler</NativeSelectOption>
              {PAYMENT_METHODS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {PAYMENT_METHOD_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid w-full max-w-xs gap-1 text-sm font-medium">
            MEBBİS durumu
            <NativeSelect
              value={mebbisPending ? 'pending' : ALL}
              onChange={(event) =>
                list.dispatch({
                  type: 'filter',
                  key: 'mebbis',
                  value: event.target.value === 'pending' ? 'pending' : '',
                })
              }
            >
              <NativeSelectOption value={ALL}>Tümü</NativeSelectOption>
              <NativeSelectOption value="pending">İşlenmemiş</NativeSelectOption>
            </NativeSelect>
          </label>
        </div>
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
