import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import {
  payRefundSchema,
  WITHDRAWAL_REASON_LABELS,
  WITHDRAWAL_REASONS,
  withdrawalFormSchema,
  type PayRefundInput,
  type PayRefundOutput,
  type WithdrawalBreakdown,
  type WithdrawalFormValues,
  type WithdrawalReason,
} from '@kampus/school-core/lib/withdrawals.ts'
import {
  REAUTHENTICATION_CODE,
  usePayRefund,
  useQuoteWithdrawal,
  useWithdrawals,
  useWithdrawStudent,
} from '@kampus/react-shared/use-withdrawals.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { ReauthModal } from './ReauthModal.tsx'

type WithdrawalRow = {
  id: string
  studentName: string
  withdrawalDate: string
  reason: WithdrawalReason
  reasonLabel: string
  refundCents: number
  debtCents: number
  refundDueDate: string
  refundStatus: 'none' | 'pending' | 'paid'
  statusLabel: string
  maskedIban: string | null
  breakdown: WithdrawalBreakdown
  version: number
}

const STATUS_LABELS = { none: 'İade yok', pending: 'Ödenecek', paid: 'Ödendi' } as const
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['studentName', 'refundCents', 'statusLabel']
const START_FORM = 'ayrilis-formu'
const REFUND_FORM = 'iade-formu'

/**
 * Ayrılış ve iade (ADR 0006 karar 10; DOM-FIN-040, -041; DOM-KAY-024; IST-110). Son günü en yakın
 * iade önce gelir. Yönetici hesabı önizler, onaylar ve iadeyi ödenmiş işaretler; ön büro yalnız
 * listeyi görür. Onay ve ödeme taze oturum ister: oturum eskiyse parola sorulup işlem tekrarlanır.
 */
export function WithdrawalsSection({ canManage }: { canManage: boolean }) {
  const list = useListState('ayrilislar')
  const withdrawals = useWithdrawals({ page: list.state.page, pageSize: list.state.pageSize })
  const [starting, setStarting] = useState(false)
  const [paying, setPaying] = useState<WithdrawalRow | null>(null)
  const [viewing, setViewing] = useState<WithdrawalRow | null>(null)

  const rows = useMemo(
    () =>
      withdrawals.data?.data.map((item): WithdrawalRow => ({
        id: item.id,
        studentName: item.studentName ?? '—',
        withdrawalDate: item.withdrawalDate,
        reason: item.reason,
        reasonLabel: WITHDRAWAL_REASON_LABELS[item.reason],
        refundCents: item.refundCents,
        debtCents: item.debtCents,
        refundDueDate: item.refundDueDate,
        refundStatus: item.refundStatus,
        statusLabel: STATUS_LABELS[item.refundStatus],
        maskedIban: item.maskedIban,
        breakdown: item.breakdown,
        version: item.version,
      })),
    [withdrawals.data],
  )

  const columns = useMemo<DataColumn<WithdrawalRow>[]>(
    () => [
      { key: 'studentName', label: 'Öğrenci' },
      {
        key: 'withdrawalDate',
        label: 'Ayrılış',
        cell: (row) => dateLabel(row.withdrawalDate, { year: 'numeric' }),
      },
      { key: 'reasonLabel', label: 'Neden' },
      { key: 'refundCents', label: 'İade', cell: (row) => money(row.refundCents) },
      { key: 'debtCents', label: 'Kalan borç', cell: (row) => money(row.debtCents) },
      {
        key: 'refundDueDate',
        label: 'İade son günü',
        cell: (row) =>
          row.refundStatus === 'pending' ? dateLabel(row.refundDueDate, { year: 'numeric' }) : '—',
      },
      {
        key: 'statusLabel',
        label: 'İade durumu',
        cell: (row) => <StatusBadge text={row.statusLabel} />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.studentName} hesap dökümünü görüntüle`}
              onClick={() => setViewing(row)}
            >
              Döküm
            </Button>
            {canManage && row.refundStatus === 'pending' ? (
              <Button
                size="sm"
                aria-label={`${row.studentName} iadesini ödenmiş işaretle`}
                onClick={() => setPaying(row)}
              >
                İadeyi öde
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [canManage],
  )

  const total = withdrawals.data?.meta.total ?? 0
  return (
    <section
      aria-labelledby="ayrilis-iade"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="ayrilis-iade" className="text-lg font-semibold">
            Ayrılış ve iade
          </h2>
          <p className="text-sm text-muted-foreground">
            {total} kayıt · İade, ayrılıştan en geç bir ay sonra yapılır.
          </p>
        </div>
        {canManage ? <Button onClick={() => setStarting(true)}>Ayrılış başlat</Button> : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={total}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Ayrılış ve iade kayıtları"
        search={false}
        loading={withdrawals.isPending}
        fetching={withdrawals.isFetching && !withdrawals.isPending}
        error={
          withdrawals.error ? (
            <QueryError error={withdrawals.error} onRetry={() => void withdrawals.refetch()} />
          ) : undefined
        }
      />
      {starting ? <StartModal onClose={() => setStarting(false)} /> : null}
      {paying ? <RefundModal row={paying} onClose={() => setPaying(null)} /> : null}
      {viewing ? (
        <Modal
          open
          onOpenChange={(open) => (open ? undefined : setViewing(null))}
          title="Hesap dökümü"
          description={`${viewing.studentName} · ${viewing.reasonLabel}`}
        >
          <BreakdownList breakdown={viewing.breakdown} />
        </Modal>
      ) : null}
    </section>
  )
}

function BreakdownList({ breakdown }: { breakdown: WithdrawalBreakdown }) {
  const extras = breakdown.extras.reduce((sum, line) => sum + line.paidCents - line.usedCents, 0)
  const lines: readonly [string, string][] = [
    ['Hesap tabanı (net ücret)', money(breakdown.baseCents)],
    [`Kesinti (%${String(breakdown.deductionBasisPoints / 100)})`, money(breakdown.deductionCents)],
    [
      `Kullanım (${String(breakdown.attendedUnits)} / ${String(breakdown.totalUnits)})`,
      money(breakdown.usageCents),
    ],
    ['Hak edilen', money(breakdown.entitledCents)],
    ['Ödenen öğrenim ücreti', money(breakdown.paidCents)],
    ...(breakdown.extras.length > 0
      ? ([['Ek hizmet bakiyesi', money(extras)]] as [string, string][])
      : []),
    ...(breakdown.creditCents > 0
      ? ([['Dağıtılmamış tahsilat', money(breakdown.creditCents)]] as [string, string][])
      : []),
  ]
  return (
    <dl className="grid gap-1 text-sm">
      {lines.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 border-b py-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 py-1.5 font-semibold">
        <dt>İade</dt>
        <dd>{money(breakdown.refundCents)}</dd>
      </div>
      <div className="flex justify-between gap-4 py-1.5 font-semibold">
        <dt>Kalan borç</dt>
        <dd>{money(breakdown.debtCents)}</dd>
      </div>
    </dl>
  )
}

function StartModal({ onClose }: { onClose: () => void }) {
  const students = useCoreAll('students')
  const quote = useQuoteWithdrawal()
  const withdraw = useWithdrawStudent()
  const [preview, setPreview] = useState<WithdrawalBreakdown | null>(null)
  const [reauth, setReauth] = useState(false)
  const today = dayKey()
  const form = useForm<WithdrawalFormValues>({
    resolver: zodResolver(withdrawalFormSchema),
    defaultValues: {
      studentId: '',
      withdrawalDate: today,
      termStartDate: '',
      attendedUnits: 0,
      totalUnits: 180,
      publicSchoolExemption: false,
      reason: 'transfer',
      targetSchool: '',
    },
  })
  const busy = quote.isPending || withdraw.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      if (
        name === 'withdrawalDate' ||
        name === 'attendedUnits' ||
        name === 'publicSchoolExemption' ||
        name === 'termStartDate'
      )
        form.setError(name, error)
      else form.setError('root.server', error)
    },
  }

  const onPreview = form.handleSubmit(async (values) => {
    const outcome = await quote.submit(
      {
        studentId: values.studentId,
        body: {
          withdrawalDate: values.withdrawalDate,
          termStartDate: values.termStartDate,
          attendedUnits: values.attendedUnits,
          totalUnits: values.totalUnits,
          publicSchoolExemption: values.publicSchoolExemption,
        },
      },
      fields,
    )
    if (outcome.status === 'success') setPreview(outcome.data.data.breakdown)
  })

  async function confirm() {
    const { studentId, targetSchool, ...rest } = form.getValues()
    const outcome = await withdraw.submit(
      { studentId, body: { ...rest, targetSchool: targetSchool.trim() || null } },
      fields,
    )
    if (outcome.status === 'success') {
      notify.success('Ayrılış kaydedildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE)
      setReauth(true)
  }

  if (students.error)
    return (
      <Modal open onOpenChange={(open) => (open ? undefined : onClose())} title="Ayrılış başlat">
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      </Modal>
    )

  const options = (students.data ?? [])
    .filter((row) => row.record.isActive !== false)
    .map((row) => ({ id: row.id, name: row.record.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  const locked = busy || preview !== null
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ayrılış başlat"
      description="Önce hesap gösterilir; onaydan önce hiçbir kayıt yazılmaz."
      footer={
        preview ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setPreview(null)}>
              Bilgileri düzenle
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => void confirm()}
            >
              Ayrılışı onayla
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Vazgeç
            </Button>
            <Button type="submit" form={START_FORM} disabled={busy} aria-busy={busy || undefined}>
              Hesabı göster
            </Button>
          </>
        )
      }
    >
      {!students.data ? (
        <SummaryLoading />
      ) : (
        <form
          id={START_FORM}
          noValidate
          onSubmit={(event) => void onPreview(event)}
          className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
        >
          <FormField id="ayrilis-ogrenci" label="Öğrenci" error={errors.studentId}>
            {(control) => (
              <NativeSelect {...control} {...form.register('studentId')} disabled={locked}>
                <NativeSelectOption value="">Öğrenci seçin</NativeSelectOption>
                {options.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="ayrilis-neden" label="Ayrılış nedeni" error={errors.reason}>
            {(control) => (
              <NativeSelect {...control} {...form.register('reason')} disabled={locked}>
                {WITHDRAWAL_REASONS.map((reason) => (
                  <NativeSelectOption key={reason} value={reason}>
                    {WITHDRAWAL_REASON_LABELS[reason]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="ayrilis-tarih" label="Ayrılış tarihi" error={errors.withdrawalDate}>
            {(control) => (
              <Input
                {...control}
                {...form.register('withdrawalDate')}
                type="date"
                max={today}
                disabled={locked}
              />
            )}
          </FormField>
          <FormField id="ayrilis-donem" label="Dönem başlangıcı" error={errors.termStartDate}>
            {(control) => (
              <Input
                {...control}
                {...form.register('termStartDate')}
                type="date"
                disabled={locked}
              />
            )}
          </FormField>
          <FormField
            id="ayrilis-gorulen"
            label="Görülen gün veya ders saati"
            error={errors.attendedUnits}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('attendedUnits', { valueAsNumber: true })}
                type="number"
                min={0}
                disabled={locked}
              />
            )}
          </FormField>
          <FormField
            id="ayrilis-toplam"
            label="Toplam gün veya ders saati"
            error={errors.totalUnits}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('totalUnits', { valueAsNumber: true })}
                type="number"
                min={1}
                disabled={locked}
              />
            )}
          </FormField>
          <FormField id="ayrilis-hedef" label="Gittiği okul (varsa)" error={errors.targetSchool}>
            {(control) => (
              <Input {...control} {...form.register('targetSchool')} disabled={locked} />
            )}
          </FormField>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              {...form.register('publicSchoolExemption')}
              disabled={locked}
              className="size-4"
            />
            Resmî okul 9. sınıf kaydı belgelendi (kesinti yok)
          </label>
          {errors.root?.server?.message ? (
            <p role="alert" className="col-span-full text-sm text-danger">
              {errors.root.server.message}
            </p>
          ) : null}
        </form>
      )}
      {preview ? (
        <div className="mt-5 rounded-card border bg-surface-soft p-4">
          <h3 className="mb-2 font-semibold">Hesap önizlemesi</h3>
          <BreakdownList breakdown={preview} />
          <p className="mt-3 text-sm text-muted-foreground">
            Onayla öğrenci pasifleşir, açık taksitler iptal edilir, ileri tarihli etüt, servis ve
            kulüp kayıtları sonlanır. Kesinti oranı ve hesap tabanı hukuki doğrulama bekliyor.
          </p>
        </div>
      ) : null}
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void confirm()
          }}
        />
      ) : null}
    </Modal>
  )
}

function RefundModal({ row, onClose }: { row: WithdrawalRow; onClose: () => void }) {
  const pay = usePayRefund()
  const today = dayKey()
  const [reauth, setReauth] = useState(false)
  const form = useForm<PayRefundInput, unknown, PayRefundOutput>({
    resolver: zodResolver(payRefundSchema),
    defaultValues: { paidDate: today, iban: '', accountHolder: '' },
  })
  const busy = pay.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  async function send(values: PayRefundOutput) {
    const outcome = await pay.submit(
      { withdrawalId: row.id, version: row.version, body: values },
      {
        setError: (name, error) => {
          if (name === 'iban' || name === 'accountHolder' || name === 'paidDate')
            form.setError(name, error)
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('İade ödendi olarak kaydedildi.')
      onClose()
    } else if (outcome.status === 'failed') {
      if (outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
      else if (outcome.error.code === 'version_conflict') onClose()
    }
  }
  const onSubmit = form.handleSubmit((values) => send(values))

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="İadeyi öde"
      description={`${row.studentName} · ${money(row.refundCents)}. Ödenen iade değiştirilemez.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={REFUND_FORM} disabled={busy} aria-busy={busy || undefined}>
            Ödendi olarak kaydet
          </Button>
        </>
      }
    >
      <form
        id={REFUND_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="iade-tarih" label="Ödeme tarihi" error={errors.paidDate}>
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
        <FormField id="iade-iban" label="IBAN" error={errors.iban}>
          {(control) => (
            <Input {...control} {...form.register('iban')} autoComplete="off" disabled={busy} />
          )}
        </FormField>
        <FormField
          id="iade-sahip"
          label="Hesap sahibi"
          error={errors.accountHolder}
          description="Sözleşmedeki ödeyici olmalıdır."
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('accountHolder')}
              autoComplete="off"
              disabled={busy}
            />
          )}
        </FormField>
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
      </form>
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void onSubmit()
          }}
        />
      ) : null}
    </Modal>
  )
}
