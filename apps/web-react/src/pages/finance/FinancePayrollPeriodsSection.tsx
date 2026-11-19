import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { usePayRateStaff } from '@kampus/react-shared/use-finance-pay-rates.ts'
import {
  useApprovePayrollPeriod,
  useCancelPayrollAdjustment,
  useCreatePayrollAdjustment,
  usePayrollAdjustments,
  usePayrollPeriodYear,
  useReopenPayrollPeriod,
  type PayrollAdjustment,
  type PayrollPeriodMonth,
} from '@kampus/react-shared/use-finance-payroll-periods.ts'
import {
  adjustmentDirectionLabel,
  PAYROLL_ADJUSTMENT_ITEM_LABELS,
  PAYROLL_ADJUSTMENT_ITEMS,
  PAYROLL_ADJUSTMENT_MAX_CENTS,
  PAYROLL_PERIOD_STATE_LABELS,
  payrollAdjustmentCancelSchema,
  payrollMonthLabel,
  payrollReopenSchema,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'

type Summary = NonNullable<PayrollPeriodMonth['current']>

const STATE_TONES = { open: 'gray', approved: 'green', reopened: 'amber' } as const
const YEAR_SPAN = 5

/** Onaylı ayda onay anının özeti, diğerlerinde güncel özet (başlamamış ayda yok). */
const summaryOf = (month: PayrollPeriodMonth): Summary | null =>
  month.state === 'approved' ? month.approved : month.current

const approvalText = (month: PayrollPeriodMonth) =>
  month.approvedAt === null
    ? null
    : `${month.approvedByName ?? 'Bilinmeyen kullanıcı'} · ${dateLabel(month.approvedAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' })}`

/**
 * Bordro dönemleri (ON-200; DOM-FIN-108): Finans "Bordro dönemleri" sekmesi, yalnız yönetici
 * (K-359). Ay onayı bordro girdilerini (ücret tanımı, bordro parametresi, aya aktarılan
 * düzeltmeler) ve kayıtlı bordro hesabını (DOM-FIN-115, ADR 0011) kilitler. Kilitli ayın farkı düzeltme kaydıyla
 * sonraki ilk açık aya aktarılır (K-358).
 */
export function FinancePayrollPeriodsSection() {
  const [currentYear] = useState(() => Number(dayKey().slice(0, 4)))
  const [year, setYear] = useState(currentYear)
  const table = usePayrollPeriodYear(year)
  const [approving, setApproving] = useState<PayrollPeriodMonth | null>(null)
  const [reopening, setReopening] = useState<PayrollPeriodMonth | null>(null)
  const [adjusting, setAdjusting] = useState<string | null>(null)
  const data = table.data?.data
  const months = data?.months ?? []
  const years = Array.from({ length: YEAR_SPAN }, (_, index) => currentYear - index)
  const adjustingMonth = months.find((item) => item.month === adjusting) ?? null

  return (
    <section
      aria-labelledby="bordro-donemleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2 max-[650px]:px-4">
        <div>
          <h2 id="bordro-donemleri" className="text-lg font-semibold">
            Bordro dönemleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Ay onayı bordro programına giden girdileri kilitler; kilitli aya düşen ücret tanımı ve
            bordro parametresi değiştirilemez.
          </p>
        </div>
        <label className="grid gap-1 text-sm font-medium" htmlFor="bordro-donem-yil">
          Yıl
          <NativeSelect
            id="bordro-donem-yil"
            value={String(year)}
            onChange={(event) => setYear(Number(event.target.value))}
          >
            {years.map((item) => (
              <NativeSelectOption key={item} value={String(item)}>
                {item}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </header>
      <div className="grid gap-4 px-6 pb-6 max-[650px]:px-4">
        <p role="note" className="rounded-lg border p-3 text-sm">
          Bordro Kampüs&apos;te hesaplanmaz. Kilitli ayda değişiklik gerekiyorsa düzeltme kaydı
          girin: fark, ayın ardından gelen ilk açık aya aktarılır ve asıl dönem değişmez.
        </p>
        {table.error ? (
          <QueryError error={table.error} onRetry={() => void table.refetch()} />
        ) : table.isPending ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableCaption className="sr-only">{`${String(year)} bordro dönemleri`}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Ay</TableHead>
                  <TableHead scope="col">Durum</TableHead>
                  <TableHead scope="col" className="text-right">
                    Personel
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Aylık brüt toplamı
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Düzeltme
                  </TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">İşlemler</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((month) => (
                  <MonthRow
                    key={month.month}
                    month={month}
                    onApprove={() => setApproving(month)}
                    onReopen={() => setReopening(month)}
                    onAdjust={() => setAdjusting(month.month)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      {approving ? <ApproveModal month={approving} onClose={() => setApproving(null)} /> : null}
      {reopening ? <ReopenModal month={reopening} onClose={() => setReopening(null)} /> : null}
      {adjustingMonth ? (
        <AdjustmentsPanel month={adjustingMonth} onClose={() => setAdjusting(null)} />
      ) : null}
    </section>
  )
}

function MonthRow({
  month,
  onApprove,
  onReopen,
  onAdjust,
}: {
  month: PayrollPeriodMonth
  onApprove: () => void
  onReopen: () => void
  onAdjust: () => void
}) {
  const label = payrollMonthLabel(month.month)
  const summary = summaryOf(month)
  const approval = approvalText(month)
  return (
    <TableRow>
      <TableHead scope="row" className="font-medium">
        {label}
      </TableHead>
      <TableCell>
        <div className="grid gap-1">
          <StatusBadge
            text={PAYROLL_PERIOD_STATE_LABELS[month.state]}
            tone={STATE_TONES[month.state]}
          />
          {approval !== null ? (
            <span className="text-xs text-muted-foreground">
              {month.state === 'reopened' ? `Son onay: ${approval}` : approval}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {summary === null ? '—' : summary.staffCount}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {summary === null ? '—' : money(summary.monthlyGrossTotalCents)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{month.adjustmentCount}</TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          {month.state !== 'approved' && month.current !== null ? (
            <Button size="sm" onClick={onApprove} aria-label={`${label} onayla`}>
              Onayla
            </Button>
          ) : null}
          {month.state === 'approved' ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={onAdjust}
                aria-label={`${label} düzeltme kayıtları`}
              >
                Düzeltmeler
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={onReopen}
                aria-label={`${label} yeniden aç`}
              >
                Yeniden aç
              </Button>
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

function SummaryList({ summary }: { summary: Summary }) {
  const rows: [string, string][] = [
    ['Personel', String(summary.staffCount)],
    ['Ücret tanımı', String(summary.rateCount)],
    ['Aylık brüt toplamı', money(summary.monthlyGrossTotalCents)],
    [
      'Aya aktarılan düzeltme',
      `${String(summary.adjustmentCount)} kayıt · ${money(summary.adjustmentTotalCents)}`,
    ],
    [
      'Bordro parametresi',
      summary.parameterEffectiveFrom === null
        ? 'Tanımlı değil'
        : `${dateLabel(`${summary.parameterEffectiveFrom}T09:00:00.000Z`, { year: 'numeric' })} seti`,
    ],
    ['Girdi damgası', summary.inputsHash.slice(0, 12)],
  ]
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Onay (K-356): ekrandaki özetin damgası gönderilir; girdi değiştiyse sunucu 409 döner. */
function ApproveModal({ month, onClose }: { month: PayrollPeriodMonth; onClose: () => void }) {
  const approve = useApprovePayrollPeriod()
  const [error, setError] = useState<string | undefined>(undefined)
  const summary = month.current
  const label = payrollMonthLabel(month.month)
  async function confirm() {
    if (summary === null) return
    setError(undefined)
    const outcome = await approve.submit(
      { month: month.month, inputsHash: summary.inputsHash },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success(`${label} onaylandı ve kilitlendi.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'payroll_inputs_changed')
      onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`${label} bordrosunu onayla`}
      description="Onaydan sonra bu aya düşen ücret tanımı ve bordro parametresi değiştirilemez."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={approve.isPending}>
            Vazgeç
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={approve.isPending || summary === null}
            aria-busy={approve.isPending || undefined}
          >
            Onayla ve kilitle
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {summary === null ? null : <SummaryList summary={summary} />}
        <RootError message={error} />
      </div>
    </Modal>
  )
}

/** Yeniden açma (K-356): gerekçe zorunlu; aydan çıkan düzeltme varsa sunucu reddeder. */
function ReopenModal({ month, onClose }: { month: PayrollPeriodMonth; onClose: () => void }) {
  const reopen = useReopenPayrollPeriod()
  const label = payrollMonthLabel(month.month)
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(payrollReopenSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = reopen.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await reopen.submit(
      { month: month.month, version: month.version ?? 0, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${label} yeniden açıldı.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`${label} dönemini yeniden aç`}
      description="Kilit kalkar; ay düzeltildikten sonra yeniden onaylanmalıdır. İşlem denetim kaydına yazılır."
    >
      <form
        noValidate
        aria-label="Yeniden açma gerekçesi"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="bordro-yeniden-ac" label="Gerekçe" error={errors.reason}>
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
            Yeniden aç
          </Button>
        </div>
      </form>
    </Modal>
  )
}

const adjustmentFormSchema = z.object({
  membershipId: z.string().min(1, 'Personel seçin.'),
  item: z.enum(PAYROLL_ADJUSTMENT_ITEMS, 'Kalemi seçin.'),
  direction: z.enum(['plus', 'minus']),
  amount: z
    .string()
    .refine(
      (value) => parseAmountInput(value, { maxCents: PAYROLL_ADJUSTMENT_MAX_CENTS }) !== null,
      {
        message: 'Tutarı 1.234,56 biçiminde, sıfırdan büyük girin (en fazla 10.000.000 ₺).',
      },
    ),
  reason: payrollAdjustmentCancelSchema.shape.reason,
})
type AdjustmentFormValues = z.input<typeof adjustmentFormSchema>
const ADJUSTMENT_FIELDS: Readonly<Record<string, keyof AdjustmentFormValues>> = {
  membershipId: 'membershipId',
  item: 'item',
  amountCents: 'amount',
  reason: 'reason',
}

/** Kilitli ayın düzeltme kayıtları (K-358): liste, yeni kayıt ve gerekçeli iptal. */
function AdjustmentsPanel({ month, onClose }: { month: PayrollPeriodMonth; onClose: () => void }) {
  const label = payrollMonthLabel(month.month)
  const list = usePayrollAdjustments(month.month, { page: 1, pageSize: 100 })
  const [cancelling, setCancelling] = useState<PayrollAdjustment | null>(null)
  const items = list.data?.data ?? []
  return (
    <SidePanel
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`${label} düzeltme kayıtları`}
      description="Asıl dönem değişmez; fark sonraki ilk açık aya aktarılır."
    >
      <div className="grid gap-6">
        <AdjustmentForm month={month.month} />
        <section aria-labelledby="bordro-duzeltme-liste" className="grid gap-2">
          <h3 id="bordro-duzeltme-liste" className="font-semibold">
            Kayıtlar
          </h3>
          {list.error ? (
            <QueryError error={list.error} onRetry={() => void list.refetch()} />
          ) : list.isPending ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu ay için düzeltme kaydı yok.</p>
          ) : (
            <ul className="grid gap-3" aria-label="Düzeltme kayıtları">
              {items.map((item) => (
                <li key={item.id} className="grid gap-1 border-t pt-3 first:border-t-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{item.staffName}</span>
                    <span className="tabular-nums">
                      {`${adjustmentDirectionLabel(item.amountCents)} ${money(Math.abs(item.amountCents))}`}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {`${PAYROLL_ADJUSTMENT_ITEM_LABELS[item.item]} · ${payrollMonthLabel(item.targetMonth)} bordrosuna aktarılacak`}
                  </p>
                  <p className="text-sm">{item.reason}</p>
                  <div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setCancelling(item)}
                      aria-label={`${item.staffName} düzeltmesini iptal et`}
                    >
                      İptal et
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {cancelling ? (
        <CancelAdjustmentModal item={cancelling} onClose={() => setCancelling(null)} />
      ) : null}
    </SidePanel>
  )
}

function AdjustmentForm({ month }: { month: string }) {
  const create = useCreatePayrollAdjustment()
  const staff = usePayRateStaff({ page: 1, pageSize: 100 })
  const form = useForm<AdjustmentFormValues>({
    resolver: zodResolver(adjustmentFormSchema),
    defaultValues: { membershipId: '', item: 'wage', direction: 'plus', amount: '', reason: '' },
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const cents = parseAmountInput(values.amount, { maxCents: PAYROLL_ADJUSTMENT_MAX_CENTS }) ?? 0
    const outcome = await create.submit(
      {
        month,
        body: {
          membershipId: values.membershipId,
          item: values.item,
          amountCents: values.direction === 'minus' ? -cents : cents,
          reason: values.reason,
        },
      },
      {
        setError: (name, error) => {
          const field = ADJUSTMENT_FIELDS[name]
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(
      `Düzeltme kaydedildi; ${payrollMonthLabel(outcome.data.data.targetMonth)} bordrosuna aktarılacak.`,
    )
    form.reset()
  })
  return (
    <form
      noValidate
      aria-label="Düzeltme kaydı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="bordro-duzeltme-personel" label="Personel" error={errors.membershipId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('membershipId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Personel seçin</NativeSelectOption>
              {(staff.data?.data ?? []).map((person) => (
                <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                  {person.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <FormField id="bordro-duzeltme-kalem" label="Kalem" error={errors.item}>
        {(control) => (
          <NativeSelect {...control} {...form.register('item')} className="w-full" disabled={busy}>
            {PAYROLL_ADJUSTMENT_ITEMS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {PAYROLL_ADJUSTMENT_ITEM_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="bordro-duzeltme-yon" label="Yön" error={errors.direction}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('direction')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="plus">Ek ödeme (+)</NativeSelectOption>
            <NativeSelectOption value="minus">Geri alınacak (−)</NativeSelectOption>
          </NativeSelect>
        )}
      </FormField>
      <FormField id="bordro-duzeltme-tutar" label="Fark tutarı (₺)" error={errors.amount}>
        {(control) => (
          <Input
            {...control}
            inputMode="decimal"
            autoComplete="off"
            {...form.register('amount')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="bordro-duzeltme-gerekce" label="Gerekçe" error={errors.reason}>
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Düzeltmeyi kaydet
        </Button>
      </div>
    </form>
  )
}

function CancelAdjustmentModal({
  item,
  onClose,
}: {
  item: PayrollAdjustment
  onClose: () => void
}) {
  const cancel = useCancelPayrollAdjustment()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(payrollAdjustmentCancelSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { adjustmentId: item.id, version: item.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Düzeltme kaydı iptal edildi.')
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Düzeltme kaydını iptal et"
      description={`${item.staffName} · ${money(item.amountCents)}`}
    >
      <form
        noValidate
        aria-label="Düzeltme iptal gerekçesi"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="bordro-duzeltme-iptal" label="İptal gerekçesi" error={errors.reason}>
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div>
          <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
            İptal et
          </Button>
        </div>
      </form>
    </Modal>
  )
}
