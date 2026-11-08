import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useRef, useState, type RefObject } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import {
  useCloseFinanceDay,
  useFinanceDayReport,
  useReopenFinanceDay,
  type FinanceDayClosingRecord,
  type FinanceDayReport,
} from '@kampus/react-shared/use-finance-day-closings.ts'
import {
  financeDayFormSchema,
  parseCashCountInput,
  reopenFinanceDaySchema,
  type FinanceDayFormValues,
} from '@kampus/school-core/lib/finance-day-closings.ts'
import { receiptNumberLabel } from '@kampus/school-core/lib/finance-receipt.ts'
import { dateLabel, dayKey, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import { amountInputValue, PAYMENT_METHOD_LABELS } from '@kampus/school-core/lib/payments.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { useFinanceDayClosingPdf } from '@/hooks/use-finance-day-closing-pdf.ts'
import { notify } from '@/lib/notify.ts'
import { cashDifferenceLabel, DAY_CLOSING_TITLE } from '@/lib/pdf/templates/finance-day-closing.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { FinancePdfDialog } from './FinancePdfDialog.tsx'

const DAY_PARAM = 'gun'
const CLOSE_FORM = 'gun-kapat-formu'
const REOPEN_FORM = 'gun-ac-formu'

type MethodRow = {
  id: string
  label: string
  count: string
  collectedCents: number
  reversedCents: number
  refundCents: number
  netCents: number
}
type RefundRow = {
  id: string
  studentName: string
  bankAccount: string
  amountCents: number
}
type LineRow = {
  id: string
  receipt: string
  studentName: string
  method: string
  reference: string
  bankAccount: string
  paidAt: string
  reason: string
  amountCents: number
}

const METHOD_COLUMNS: readonly DataColumn<MethodRow>[] = [
  { key: 'label', label: 'Yöntem' },
  { key: 'count', label: 'Tahsilat / iptal / iade adedi' },
  { key: 'collectedCents', label: 'Tahsilat', cell: (row) => money(row.collectedCents) },
  { key: 'reversedCents', label: 'İptal', cell: (row) => money(row.reversedCents) },
  { key: 'refundCents', label: 'İade ödemesi', cell: (row) => money(row.refundCents) },
  { key: 'netCents', label: 'Net', cell: (row) => money(row.netCents) },
]
const REFUND_COLUMNS: readonly DataColumn<RefundRow>[] = [
  { key: 'studentName', label: 'Öğrenci' },
  { key: 'bankAccount', label: 'Kurum banka hesabı' },
  { key: 'amountCents', label: 'Tutar', cell: (row) => money(row.amountCents) },
]
const COLLECTED_COLUMNS: readonly DataColumn<LineRow>[] = [
  { key: 'receipt', label: 'Dekont no' },
  { key: 'studentName', label: 'Öğrenci' },
  { key: 'method', label: 'Yöntem' },
  { key: 'reference', label: 'İşlem referansı' },
  { key: 'bankAccount', label: 'Banka hesabı' },
  { key: 'amountCents', label: 'Tutar', cell: (row) => money(row.amountCents) },
]
const REVERSED_COLUMNS: readonly DataColumn<LineRow>[] = [
  { key: 'receipt', label: 'Dekont no' },
  { key: 'studentName', label: 'Öğrenci' },
  { key: 'method', label: 'Yöntem' },
  {
    key: 'paidAt',
    label: 'Ödeme tarihi',
    cell: (row) => dateLabel(row.paidAt, { year: 'numeric' }),
  },
  { key: 'reason', label: 'İptal gerekçesi' },
  { key: 'amountCents', label: 'Tutar', cell: (row) => money(row.amountCents) },
]
const METHOD_MOBILE = ['label', 'netCents']
const LINE_MOBILE = ['receipt', 'studentName', 'amountCents']
// Rapor tablosu kısa ve toplamları üstündedir; süzgeç kalabalık etmesin.
const METHOD_NO_FILTERS = METHOD_COLUMNS.map((column) => column.key)
const COLLECTED_NO_FILTERS = COLLECTED_COLUMNS.map((column) => column.key)
const REVERSED_NO_FILTERS = REVERSED_COLUMNS.map((column) => column.key)
const REFUND_NO_FILTERS = REFUND_COLUMNS.map((column) => column.key)
const REFUND_MOBILE = ['studentName', 'amountCents']
/** Kayıtlı kişi sütunu kurum türünün terimini taşır: okulda öğrenci, dil okulu ve kursta kursiyer (DOM-KAY-012). */
const withLearner = <Row extends { id: string; studentName: string }>(
  columns: readonly DataColumn<Row>[],
  learner: string,
) =>
  columns.map((column) => (column.key === 'studentName' ? { ...column, label: learner } : column))

const validDay = (value: string | null, today: string) =>
  value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today ? value : today
const stampOf = (at: string) => `${dateLabel(at, { year: 'numeric' })} ${timeLabel(at)}`

const refundRow = (line: FinanceDayReport['refunds'][number]): RefundRow => ({
  id: line.withdrawalId,
  studentName: line.studentName ?? '—',
  bankAccount: line.bankAccountLabel ?? '—',
  amountCents: line.amountCents,
})

function lineRow(line: FinanceDayReport['collected'][number]): LineRow {
  return {
    id: line.paymentId,
    receipt: receiptNumberLabel(line),
    studentName: line.studentName ?? '—',
    method: PAYMENT_METHOD_LABELS[line.method],
    reference: line.reference ?? '—',
    bankAccount: line.bankAccountLabel ?? '—',
    paidAt: line.paidAt,
    reason: line.reversalReason ?? '—',
    amountCents: line.amountCents,
  }
}

/**
 * Gün sonu (IST-113, DOM-FIN-036; Finans & Tahsilat `?gorunum=gunsonu`). O gün ödenen ayrılış
 * iadesi banka havalesi satırında ayrı sayılır ve netten düşer (M-13). Seçili gün adreste
 * (`?gun=`) durur. Rapor sunucudan gelir, rakam burada hesaplanmaz; yalnız kapanış penceresindeki
 * beklenen ve fark önizlemedir, kesin değeri sunucu yazar. Kapatma yönetici ve ön büro, yeniden
 * açma yalnız yönetici; kapatılan günün kaydı değişmez.
 */
export function FinanceDayClosingSection({ canReopen }: { canReopen: boolean }) {
  const [params, setParams] = useSearchParams()
  const today = dayKey()
  const closingDate = validDay(params.get(DAY_PARAM), today)
  const query = useFinanceDayReport(closingDate)
  const report = query.data?.data

  function selectDay(value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === '' || value === today) next.delete(DAY_PARAM)
        else next.set(DAY_PARAM, value)
        return next
      },
      { replace: true },
    )
  }

  return (
    <section aria-labelledby="gun-sonu-baslik" className="mt-6 grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h2 id="gun-sonu-baslik" className="text-lg font-semibold">
            Gün sonu
          </h2>
          <p className="text-sm text-muted-foreground">
            Günün tahsilatları, iptaller, iade ödemeleri ve kasa sayımı. Kapatılan güne tahsilat ve
            iade ödemesi girilemez.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-medium">
            Gün
            <Input
              type="date"
              value={closingDate}
              max={today}
              onChange={(event) => selectDay(event.target.value)}
            />
          </label>
          <DayClosingPdfButton closingDate={closingDate} />
        </div>
      </header>
      {query.error ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : !report ? (
        <p role="status" className="text-sm text-muted-foreground">
          Gün sonu raporu yükleniyor…
        </p>
      ) : (
        <DayReport report={report} canReopen={canReopen} />
      )}
    </section>
  )
}

function DayClosingPdfButton({ closingDate }: { closingDate: string }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="secondary"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="FileText" size={16} />
        Gün sonu PDF
      </Button>
      {open ? (
        <DayClosingPdfPreview
          closingDate={closingDate}
          onClose={() => setOpen(false)}
          button={button}
        />
      ) : null}
    </>
  )
}

function DayClosingPdfPreview({
  closingDate,
  onClose,
  button,
}: {
  closingDate: string
  onClose: () => void
  button: RefObject<HTMLButtonElement | null>
}) {
  const pdf = useFinanceDayClosingPdf(closingDate, true)
  return (
    <FinancePdfDialog
      title={DAY_CLOSING_TITLE}
      pdf={pdf}
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        button.current?.focus()
      }}
    />
  )
}

function DayReport({ report, canReopen }: { report: FinanceDayReport; canReopen: boolean }) {
  const { summary, closingDate } = report
  const methodRows = useMemo<MethodRow[]>(
    () => [
      ...summary.methods.map((item) => ({
        id: item.method,
        label: PAYMENT_METHOD_LABELS[item.method],
        count: `${String(item.collectedCount)} / ${String(item.reversedCount)} / ${String(item.refundPaidCount)}`,
        collectedCents: item.collectedCents,
        reversedCents: item.reversedCents,
        refundCents: item.refundPaidCents,
        netCents: item.netCents,
      })),
      {
        id: 'toplam',
        label: 'Toplam',
        count: `${String(summary.collectedCount)} / ${String(summary.reversedCount)} / ${String(summary.refundPaidCount)}`,
        collectedCents: summary.collectedCents,
        reversedCents: summary.reversedCents,
        refundCents: summary.refundPaidCents,
        netCents: summary.netCents,
      },
    ],
    [summary],
  )
  const collectedRows = useMemo(() => report.collected.map(lineRow), [report.collected])
  const reversedRows = useMemo(() => report.reversed.map(lineRow), [report.reversed])
  const refundRows = useMemo(() => report.refunds.map(refundRow), [report.refunds])
  const learner = useEnrollmentLearner()
  const collectedColumns = useMemo(() => withLearner(COLLECTED_COLUMNS, learner.title), [learner])
  const reversedColumns = useMemo(() => withLearner(REVERSED_COLUMNS, learner.title), [learner])
  const refundColumns = useMemo(() => withLearner(REFUND_COLUMNS, learner.title), [learner])
  return (
    <>
      <StatGrid
        label="Gün özeti"
        items={[
          {
            label: 'Tahsilat',
            value: money(summary.collectedCents),
            note: `${String(summary.collectedCount)} işlem`,
          },
          {
            label: 'İptal',
            value: money(summary.reversedCents),
            note: `${String(summary.reversedCount)} işlem`,
          },
          {
            label: 'İade ödemesi',
            value: money(summary.refundPaidCents),
            note: `${String(summary.refundPaidCount)} işlem`,
          },
          { label: 'Net', value: money(summary.netCents), note: 'Tahsilat − iptal − iade' },
          { label: 'Net nakit', value: money(report.cashNetCents) },
        ]}
      />
      <ClosingPanel report={report} canReopen={canReopen} />
      <div className="grid gap-2">
        <h3 className="text-base font-semibold">Ödeme yöntemine göre</h3>
        <DataTable
          listKey="gun-sonu-yontem"
          rows={methodRows}
          columns={METHOD_COLUMNS}
          mobileColumns={METHOD_MOBILE}
          caption="Ödeme yöntemine göre gün özeti"
          search={false}
          excludeFilters={METHOD_NO_FILTERS}
        />
      </div>
      <div className="grid gap-2">
        <h3 className="text-base font-semibold">Tahsilatlar</h3>
        <DataTable
          listKey={`gun-sonu-tahsilat-${closingDate}`}
          rows={collectedRows}
          columns={collectedColumns}
          mobileColumns={LINE_MOBILE}
          caption="Günün tahsilatları"
          search={false}
          excludeFilters={COLLECTED_NO_FILTERS}
          empty="Bu gün tahsilat yok."
        />
      </div>
      <div className="grid gap-2">
        <h3 className="text-base font-semibold">İptaller</h3>
        <p className="text-sm text-muted-foreground">
          İptal, yapıldığı güne yazılır; tahsilat başka bir gün alınmış olabilir.
        </p>
        <DataTable
          listKey={`gun-sonu-iptal-${closingDate}`}
          rows={reversedRows}
          columns={reversedColumns}
          mobileColumns={LINE_MOBILE}
          caption="Günün iptalleri"
          search={false}
          excludeFilters={REVERSED_NO_FILTERS}
          empty="Bu gün iptal yok."
        />
      </div>
      <div className="grid gap-2">
        <h3 className="text-base font-semibold">İade ödemeleri</h3>
        <p className="text-sm text-muted-foreground">
          Ayrılış iadesi ödeme gününe, kurumun banka hesabından çıkış olarak yazılır ve netten
          düşer.
        </p>
        <DataTable
          listKey={`gun-sonu-iade-${closingDate}`}
          rows={refundRows}
          columns={refundColumns}
          mobileColumns={REFUND_MOBILE}
          caption="Günün iade ödemeleri"
          search={false}
          excludeFilters={REFUND_NO_FILTERS}
          empty="Bu gün iade ödemesi yok."
        />
      </div>
      {report.history.length > 0 ? <ClosingHistory history={report.history} /> : null}
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

function ClosingPanel({ report, canReopen }: { report: FinanceDayReport; canReopen: boolean }) {
  const [dialog, setDialog] = useState<'close' | 'reopen' | null>(null)
  const { closing } = report
  return (
    <div
      role="group"
      aria-label="Gün kapanışı"
      className="grid gap-4 rounded-card border bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">Gün kapanışı</h3>
          <StatusBadge text={closing ? 'Kapatıldı' : 'Açık'} tone={closing ? 'green' : 'amber'} />
        </div>
        {closing ? (
          canReopen ? (
            <Button type="button" variant="secondary" onClick={() => setDialog('reopen')}>
              Günü yeniden aç
            </Button>
          ) : null
        ) : (
          <Button type="button" onClick={() => setDialog('close')}>
            Günü kapat
          </Button>
        )}
      </div>
      {closing ? (
        <ClosingFacts closing={closing} cashNetCents={report.cashNetCents} canReopen={canReopen} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {report.cashCountRequired
            ? 'Kapatmadan önce kasadaki nakdi sayın. Kapatılan güne tahsilat girilemez.'
            : 'Kapatılan güne tahsilat girilemez. Bu gün için kasa sayımı gerekmiyor.'}
        </p>
      )}
      {dialog === 'close' ? (
        <CloseDayModal report={report} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'reopen' && closing ? (
        <ReopenDayModal closing={closing} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  )
}

function ClosingFacts({
  closing,
  cashNetCents,
  canReopen,
}: {
  closing: FinanceDayClosingRecord
  cashNetCents: number
  canReopen: boolean
}) {
  const { cash } = closing
  return (
    <>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 text-sm">
        <Fact label="Kapatan" value={closing.closedByName ?? '—'} />
        <Fact label="Kapanış anı" value={stampOf(closing.closedAt)} />
        {cash ? (
          <>
            <Fact label="Açılış kasası" value={money(cash.openingCents)} />
            <Fact label="Günün net nakdi" value={money(cashNetCents)} />
            <Fact label="Beklenen nakit" value={money(cash.expectedCents)} />
            <Fact label="Sayılan nakit" value={money(cash.countedCents)} />
            <Fact label="Kasa farkı" value={cashDifferenceLabel(cash.differenceCents)} />
          </>
        ) : (
          <Fact label="Kasa sayımı" value="Gerekmedi" />
        )}
        {closing.note ? <Fact label="Açıklama" value={closing.note} /> : null}
      </dl>
      {canReopen ? null : (
        <p className="text-sm text-muted-foreground">
          Bu gün için düzeltme gerekiyorsa yöneticinin günü yeniden açması gerekir.
        </p>
      )}
    </>
  )
}

function ClosingHistory({ history }: { history: readonly FinanceDayClosingRecord[] }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-base font-semibold">Önceki kapanışlar</h3>
      <ul className="grid gap-2 text-sm">
        {history.map((item) => (
          <li key={item.id} className="rounded-card border bg-surface p-4">
            <p>
              {item.closedByName ?? '—'} {stampOf(item.closedAt)} tarihinde kapattı, net{' '}
              {money(item.summary.netCents)}.
            </p>
            <p>
              {item.reopenedByName ?? '—'} {item.reopenedAt ? stampOf(item.reopenedAt) : '—'}{' '}
              tarihinde yeniden açtı. Gerekçe: {item.reopenReason ?? '—'}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Sunucu yolu → form alanı; kapanış gövdesi kuruş, form metin tutar. */
const CLOSE_FIELDS: Readonly<Record<string, keyof FinanceDayFormValues>> = {
  openingCashCents: 'openingCash',
  countedCashCents: 'countedCash',
  note: 'note',
}

function CloseDayModal({ report, onClose }: { report: FinanceDayReport; onClose: () => void }) {
  const closeDay = useCloseFinanceDay()
  const form = useForm<FinanceDayFormValues>({
    resolver: zodResolver(financeDayFormSchema),
    defaultValues: {
      openingCash: report.cashCountRequired
        ? amountInputValue(report.suggestedOpeningCents ?? 0)
        : '',
      countedCash: '',
      note: '',
    },
  })
  const busy = closeDay.isPending || form.formState.isSubmitting
  const { errors } = form.formState
  const opening = useWatch({ control: form.control, name: 'openingCash' })
  const counted = useWatch({ control: form.control, name: 'countedCash' })
  const openingCents = parseCashCountInput(opening)
  const countedCents = parseCashCountInput(counted)
  const expectedCents = openingCents === null ? null : openingCents + report.cashNetCents

  const onSubmit = form.handleSubmit(async (values) => {
    const countedValue = parseCashCountInput(values.countedCash)
    const openingValue = parseCashCountInput(values.openingCash)
    const outcome = await closeDay.submit(
      {
        closingDate: report.closingDate,
        body: {
          reportStamp: report.reportStamp,
          ...(countedValue === null ? {} : { countedCashCents: countedValue }),
          // Boş bırakılan açılışı sunucu önceki kapanıştaki sayımdan alır.
          ...(countedValue === null || openingValue === null
            ? {}
            : { openingCashCents: openingValue }),
          ...(values.note === '' ? {} : { note: values.note }),
        },
      },
      {
        setError: (name, error) => {
          const field = CLOSE_FIELDS[name]
          form.setError(field ?? 'root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Gün kapatıldı.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.status === 409) onClose()
  })

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Günü kapat"
      description={`${dateLabel(`${report.closingDate}T09:00:00.000Z`, { year: 'numeric' })} · Net ${money(report.summary.netCents)}. Kapatılan güne tahsilat ve iade ödemesi girilemez; yalnız yönetici yeniden açabilir.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={CLOSE_FORM} disabled={busy} aria-busy={busy || undefined}>
            Günü kapat
          </Button>
        </>
      }
    >
      <form
        id={CLOSE_FORM}
        noValidate
        className="grid gap-4"
        onSubmit={(event) => void onSubmit(event)}
      >
        {errors.root?.server ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.server.message}
          </p>
        ) : null}
        {report.cashCountRequired ? (
          <>
            <FormField id="gun-acilis" label="Açılış kasası (₺)" error={errors.openingCash}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('openingCash')}
                  inputMode="decimal"
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField id="gun-sayilan" label="Sayılan nakit (₺)" error={errors.countedCash}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('countedCash')}
                  inputMode="decimal"
                  disabled={busy}
                />
              )}
            </FormField>
            <dl
              aria-live="polite"
              className="grid grid-cols-2 gap-4 rounded-card border bg-surface-soft p-4 text-sm"
            >
              <Fact
                label="Beklenen nakit"
                value={expectedCents === null ? '—' : money(expectedCents)}
              />
              <Fact
                label="Kasa farkı"
                value={
                  expectedCents === null || countedCents === null
                    ? '—'
                    : cashDifferenceLabel(countedCents - expectedCents)
                }
              />
            </dl>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nakit tahsilat kapalı ve bu gün nakit hareketi yok; kasa sayımı gerekmiyor.
          </p>
        )}
        <FormField id="gun-aciklama" label="Açıklama" error={errors.note}>
          {(control) => <Textarea {...control} {...form.register('note')} disabled={busy} />}
        </FormField>
        <p className="text-sm text-muted-foreground">
          Kasa farkı varsa ya da açılış kasası önceki kapanıştan farklıysa açıklama zorunludur.
        </p>
      </form>
    </Modal>
  )
}

function ReopenDayModal({
  closing,
  onClose,
}: {
  closing: FinanceDayClosingRecord
  onClose: () => void
}) {
  const reopen = useReopenFinanceDay()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(reopenFinanceDaySchema),
    defaultValues: { reason: '' },
  })
  const busy = reopen.isPending || form.formState.isSubmitting

  const onSubmit = form.handleSubmit(async ({ reason }) => {
    const outcome = await reopen.submit(
      { closingDate: closing.closingDate, version: closing.version, reason },
      { setError: (_name, error) => form.setError('reason', error) },
    )
    if (outcome.status === 'success') {
      notify.success('Gün yeniden açıldı.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.status === 409) onClose()
  })

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Günü yeniden aç"
      description="Eski kapanış gerekçesiyle kayıtta kalır, silinmez. Gün yeniden kapatılana kadar tahsilat girilebilir."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form={REOPEN_FORM}
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            Günü yeniden aç
          </Button>
        </>
      }
    >
      <form id={REOPEN_FORM} noValidate onSubmit={(event) => void onSubmit(event)}>
        <FormField
          id="gun-gerekce"
          label="Yeniden açma gerekçesi"
          error={form.formState.errors.reason}
        >
          {(control) => <Textarea {...control} {...form.register('reason')} disabled={busy} />}
        </FormField>
      </form>
    </Modal>
  )
}
