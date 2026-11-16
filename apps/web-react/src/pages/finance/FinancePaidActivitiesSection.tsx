import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCancelPaidActivity,
  useCancelPaidActivityParticipation,
  useCreatePaidActivity,
  useJoinPaidActivity,
  usePaidActivities,
  usePaidActivityParticipants,
  usePayPaidActivityRefund,
  type PaidActivityParticipant,
  type PaidActivityRow,
} from '@kampus/react-shared/use-finance-paid-activities.ts'
import { useBankAccounts } from '@kampus/react-shared/use-payment-commands.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import {
  LATE_REFUND_RULE_LABELS,
  LATE_REFUND_RULES,
  PAID_ACTIVITY_KIND_LABELS,
  PAID_ACTIVITY_KINDS,
  PAID_ACTIVITY_STATUS_LABELS,
  PARTICIPATION_PAYMENT_STATUS_LABELS,
  PARTICIPATION_REFUND_STATUS_LABELS,
  type LateRefundRule,
  type PaidActivityKind,
} from '@kampus/school-core/lib/finance-paid-activities.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { bankAccountLabel, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import {
  payRefundSchema,
  type PayRefundInput,
  type PayRefundOutput,
} from '@kampus/school-core/lib/withdrawals.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'

/**
 * Gezi ve etkinlik ücretleri (DOM-FIN-098; ON-142; K-300…K-303). Yönetici ücretli gezi ya da
 * etkinliği tanımlar ve iptal eder; yönetici ve ön büro öğrenciyi yazar (öğrenciye taksit açılır,
 * veli ekranında borç görünür), katılımcıların ödeme durumunu izler ve katılımı iptal eder. İade
 * kuralı etkinlikte tanımlıdır; iadeyi yönetici öder ve gün sonuna girer. Bilet ve oturma düzeni
 * bu ekranın işi değildir.
 */

const NO_SORT: readonly string[] = []
const ACTIVITY_MOBILE = ['name', 'activityDate', 'status']
const PARTICIPANT_MOBILE = ['studentName', 'payment', 'status']
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

type ActivityRow = PaidActivityRow & Record<string, unknown>
type ParticipantRow = PaidActivityParticipant & { name: string } & Record<string, unknown>

function refundRuleText(row: PaidActivityRow): string {
  const late =
    row.lateRefundRule === 'percent'
      ? `sonra ücretin %${String(row.lateRefundPercent ?? 0)}'i iade edilir`
      : `sonra kişi başı ${money(row.lateCostCents ?? 0)} masraf düşülür`
  return `${dayText(row.cancelDeadline)} gününe kadar iptalde tam iade, ${late}.`
}

export function FinancePaidActivitiesSection({ isManager }: { isManager: boolean }) {
  const list = useListState('gezi-etkinlik')
  const activities = usePaidActivities({ page: list.state.page, pageSize: list.state.pageSize })
  const [selectedId, setSelectedId] = useState('')
  const [creating, setCreating] = useState(false)
  const [cancelling, setCancelling] = useState<PaidActivityRow | null>(null)
  const rows = useMemo(
    () => activities.data?.data.map((item): ActivityRow => ({ ...item })),
    [activities.data],
  )
  const selected = activities.data?.data.find((item) => item.id === selectedId)
  const columns = useMemo<DataColumn<ActivityRow>[]>(
    () => [
      { key: 'name', label: 'Etkinlik', cell: (row) => row.name },
      { key: 'kind', label: 'Tür', cell: (row) => PAID_ACTIVITY_KIND_LABELS[row.kind] },
      { key: 'activityDate', label: 'Gün', cell: (row) => dayText(row.activityDate) },
      { key: 'feeCents', label: 'Kişi başı', cell: (row) => money(row.feeCents) },
      {
        key: 'participantCount',
        label: 'Katılımcı',
        cell: (row) => `${String(row.participantCount)} / ${String(row.capacity)}`,
      },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={
              row.pendingRefundCount > 0 && row.status === 'cancelled'
                ? `${PAID_ACTIVITY_STATUS_LABELS[row.status]} · ${String(row.pendingRefundCount)} iade`
                : PAID_ACTIVITY_STATUS_LABELS[row.status]
            }
            tone={row.status === 'open' ? 'green' : 'gray'}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.name} katılımcıları`}
              aria-pressed={row.id === selectedId}
              onClick={() => setSelectedId(row.id)}
            >
              Katılımcılar
            </Button>
            {isManager && row.status === 'open' ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.name} etkinliğini iptal et`}
                onClick={() => setCancelling(row)}
              >
                İptal et
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [isManager, selectedId],
  )
  return (
    <div className="grid gap-6">
      <section
        aria-labelledby="gezi-etkinlik-baslik"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div>
            <h2 id="gezi-etkinlik-baslik" className="text-lg font-semibold">
              Gezi ve etkinlik ücretleri
            </h2>
            <p className="text-sm text-muted-foreground">
              Katılım öğrenciye ayrı bir taksit açar ve veli ekranında borç olarak görünür. İptalde
              iade, etkinlikte tanımlı kurala göre hesaplanır.
            </p>
          </div>
          {isManager ? (
            <Button onClick={() => setCreating(true)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Etkinlik tanımla
            </Button>
          ) : null}
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={activities.data?.meta.total ?? 0}
          sortable={NO_SORT}
          columns={columns}
          mobileColumns={ACTIVITY_MOBILE}
          caption="Gezi ve etkinlikler"
          search={false}
          empty="Henüz ücretli gezi ya da etkinlik yok."
          loading={activities.isPending}
          fetching={activities.isFetching && !activities.isPending}
          error={
            activities.error ? (
              <QueryError error={activities.error} onRetry={() => void activities.refetch()} />
            ) : undefined
          }
        />
      </section>
      {selected ? <ParticipantsPanel activity={selected} isManager={isManager} /> : null}
      {creating ? <CreateActivityModal onClose={() => setCreating(false)} /> : null}
      {cancelling ? (
        <CancelActivityModal activity={cancelling} onClose={() => setCancelling(null)} />
      ) : null}
    </div>
  )
}

function ParticipantsPanel({
  activity,
  isManager,
}: {
  activity: PaidActivityRow
  isManager: boolean
}) {
  const learner = useEnrollmentLearner()
  const list = useListState('gezi-katilimcilar', { resetKey: activity.id })
  const participants = usePaidActivityParticipants(activity.id, {
    page: list.state.page,
    pageSize: list.state.pageSize,
  })
  const [joining, setJoining] = useState(false)
  const [cancelling, setCancelling] = useState<ParticipantRow | null>(null)
  const [refunding, setRefunding] = useState<ParticipantRow | null>(null)
  const rows = useMemo(
    () =>
      participants.data?.data.map((item): ParticipantRow => ({
        ...item,
        name: item.studentName ?? '—',
      })),
    [participants.data],
  )
  const columns = useMemo<DataColumn<ParticipantRow>[]>(
    () => [
      { key: 'studentName', label: learner.title, cell: (row) => row.name },
      {
        key: 'payment',
        label: 'Ödeme',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge text={PARTICIPATION_PAYMENT_STATUS_LABELS[row.paymentStatus]} />
            <span className="text-sm text-muted-foreground">
              {money(row.collectedCents)} / {money(row.amountCents)}
            </span>
          </span>
        ),
      },
      {
        key: 'status',
        label: 'Katılım',
        cell: (row) =>
          row.status === 'active' ? (
            <StatusBadge text="Katılıyor" tone="green" />
          ) : (
            <StatusBadge
              text={`İptal · ${row.cancelledDate ? dayText(row.cancelledDate) : ''}`}
              tone="gray"
            />
          ),
      },
      {
        key: 'refund',
        label: 'İade',
        cell: (row) =>
          row.status === 'active' ? (
            '—'
          ) : (
            <span className="grid gap-1">
              <StatusBadge
                text={PARTICIPATION_REFUND_STATUS_LABELS[row.refundStatus]}
                tone={row.refundStatus === 'pending' ? 'amber' : 'gray'}
              />
              <span className="text-sm text-muted-foreground">
                İade {money(row.refundCents)} · kesinti {money(row.retainedCents ?? 0)}
              </span>
            </span>
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <div className="flex flex-wrap gap-2">
            {row.status === 'active' && activity.status === 'open' ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.name} katılımını iptal et`}
                onClick={() => setCancelling(row)}
              >
                Katılımı iptal et
              </Button>
            ) : null}
            {isManager && row.refundStatus === 'pending' ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.name} iadesini öde`}
                onClick={() => setRefunding(row)}
              >
                İadeyi öde
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [activity.status, isManager, learner],
  )
  return (
    <section
      aria-labelledby="gezi-katilimci-baslik"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="gezi-katilimci-baslik" className="text-lg font-semibold">
            {activity.name} · katılımcılar
          </h2>
          <p className="text-sm text-muted-foreground">
            {dayText(activity.activityDate)} · kişi başı {money(activity.feeCents)} · son katılım{' '}
            {dayText(activity.joinDeadline)}. {refundRuleText(activity)}
          </p>
        </div>
        {activity.status === 'open' ? (
          <Button onClick={() => setJoining(true)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Katılımcı ekle
          </Button>
        ) : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={participants.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={PARTICIPANT_MOBILE}
        caption={`${activity.name} katılımcıları`}
        search={false}
        empty="Henüz katılımcı yok."
        loading={participants.isPending}
        fetching={participants.isFetching && !participants.isPending}
        error={
          participants.error ? (
            <QueryError error={participants.error} onRetry={() => void participants.refetch()} />
          ) : undefined
        }
      />
      {joining ? <JoinModal activity={activity} onClose={() => setJoining(false)} /> : null}
      {cancelling ? (
        <CancelParticipantModal
          activity={activity}
          row={cancelling}
          onClose={() => setCancelling(null)}
        />
      ) : null}
      {refunding ? <RefundModal row={refunding} onClose={() => setRefunding(null)} /> : null}
    </section>
  )
}

function ModalFooter({
  busy,
  form,
  submit,
  onClose,
}: {
  busy: boolean
  form: string
  submit: string
  onClose: () => void
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Vazgeç
      </Button>
      <Button type="submit" form={form} disabled={busy} aria-busy={busy || undefined}>
        {submit}
      </Button>
    </>
  )
}

function RootError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  ) : null
}

interface ActivityForm {
  name: string
  kind: PaidActivityKind
  activityDate: string
  fee: string
  joinDeadline: string
  cancelDeadline: string
  capacity: string
  lateRefundRule: LateRefundRule
  lateRefundPercent: string
  lateCost: string
  externalRef: string
}
type ActivityField = keyof ActivityForm
const SERVER_FIELDS: Readonly<Record<string, ActivityField>> = {
  name: 'name',
  kind: 'kind',
  activityDate: 'activityDate',
  feeCents: 'fee',
  joinDeadline: 'joinDeadline',
  cancelDeadline: 'cancelDeadline',
  capacity: 'capacity',
  lateRefundRule: 'lateRefundRule',
  lateRefundPercent: 'lateRefundPercent',
  lateCostCents: 'lateCost',
  externalRef: 'externalRef',
}

function CreateActivityModal({ onClose }: { onClose: () => void }) {
  const create = useCreatePaidActivity()
  const [today] = useState(() => dayKey(Date.now()))
  const form = useForm<ActivityForm>({
    defaultValues: {
      name: '',
      kind: 'trip',
      activityDate: today,
      fee: '',
      joinDeadline: today,
      cancelDeadline: today,
      capacity: '30',
      lateRefundRule: 'percent',
      lateRefundPercent: '0',
      lateCost: '',
      externalRef: '',
    },
  })
  const rule = useWatch({ control: form.control, name: 'lateRefundRule' })
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const feeCents = parseAmountInput(values.fee)
    if (feeCents === null) {
      form.setError('fee', { message: 'Geçerli bir tutar girin (ör. 1.500,00).' })
      return
    }
    const lateCostCents =
      values.lateRefundRule === 'cost'
        ? parseAmountInput(values.lateCost, { allowZero: true })
        : null
    if (values.lateRefundRule === 'cost' && lateCostCents === null) {
      form.setError('lateCost', { message: 'Geçerli bir tutar girin.' })
      return
    }
    const outcome = await create.submit(
      {
        name: values.name,
        kind: values.kind,
        activityDate: values.activityDate,
        feeCents,
        joinDeadline: values.joinDeadline,
        cancelDeadline: values.cancelDeadline,
        capacity: Number(values.capacity),
        lateRefundRule: values.lateRefundRule,
        lateRefundPercent:
          values.lateRefundRule === 'percent' ? Number(values.lateRefundPercent) : null,
        lateCostCents,
        externalRef: values.externalRef.trim() === '' ? null : values.externalRef.trim(),
      },
      {
        setError: (name, error) => {
          const target = SERVER_FIELDS[name]
          if (target) form.setError(target, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Etkinlik tanımlandı.')
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ücretli gezi ya da etkinlik"
      description="Ücret, gün ve iade kuralı katılımcıları bağladığı için kaydedildikten sonra değişmez."
      footer={
        <ModalFooter busy={busy} form="gezi-etkinlik-formu" submit="Kaydet" onClose={onClose} />
      }
    >
      <form
        id="gezi-etkinlik-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <FormField id="gezi-ad" label="Ad" error={errors.name}>
          {(control) => (
            <Input
              {...control}
              {...form.register('name', { required: 'Etkinlik adını yazın.' })}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="gezi-tur" label="Tür" error={errors.kind}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('kind')}
              className="w-full"
              disabled={busy}
            >
              {PAID_ACTIVITY_KINDS.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {PAID_ACTIVITY_KIND_LABELS[kind]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="gezi-gun" label="Etkinlik günü" error={errors.activityDate}>
          {(control) => (
            <Input
              {...control}
              {...form.register('activityDate')}
              type="date"
              min={today}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="gezi-ucret"
          label="Kişi başı ücret (₺)"
          error={errors.fee}
          description="Ör. 1.500,00"
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('fee', { required: 'Kişi başı ücreti girin.' })}
              inputMode="decimal"
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="gezi-son-katilim"
          label="Son katılım günü"
          error={errors.joinDeadline}
          description="Katılım taksitinin vadesidir."
        >
          {(control) => (
            <Input {...control} {...form.register('joinDeadline')} type="date" disabled={busy} />
          )}
        </FormField>
        <FormField
          id="gezi-son-iptal"
          label="Son iptal günü"
          error={errors.cancelDeadline}
          description="Bu güne kadar iptalde tam iade."
        >
          {(control) => (
            <Input {...control} {...form.register('cancelDeadline')} type="date" disabled={busy} />
          )}
        </FormField>
        <FormField id="gezi-kontenjan" label="Kontenjan" error={errors.capacity}>
          {(control) => (
            <Input
              {...control}
              {...form.register('capacity')}
              type="number"
              min={1}
              inputMode="numeric"
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="gezi-gec-iptal"
          label="Son iptal gününden sonra"
          error={errors.lateRefundRule}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('lateRefundRule')}
              className="w-full"
              disabled={busy}
            >
              {LATE_REFUND_RULES.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {LATE_REFUND_RULE_LABELS[item]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {rule === 'percent' ? (
          <FormField id="gezi-oran" label="İade oranı (%)" error={errors.lateRefundPercent}>
            {(control) => (
              <Input
                {...control}
                {...form.register('lateRefundPercent')}
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                disabled={busy}
              />
            )}
          </FormField>
        ) : (
          <FormField
            id="gezi-masraf"
            label="Kişi başı masraf (₺)"
            error={errors.lateCost}
            description="Geç iptalde iadeden düşülür."
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('lateCost')}
                inputMode="decimal"
                disabled={busy}
              />
            )}
          </FormField>
        )}
        <FormField
          id="gezi-referans"
          label="Gezi planı referansı (isteğe bağlı)"
          error={errors.externalRef}
        >
          {(control) => <Input {...control} {...form.register('externalRef')} disabled={busy} />}
        </FormField>
        <div className="sm:col-span-2">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

function CancelActivityModal({
  activity,
  onClose,
}: {
  activity: PaidActivityRow
  onClose: () => void
}) {
  const cancel = useCancelPaidActivity()
  const form = useForm<{ reason: string }>({ defaultValues: { reason: '' } })
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async ({ reason }) => {
    const outcome = await cancel.submit(
      { activityId: activity.id, version: activity.version, body: { reason } },
      {
        setError: (name, error) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Etkinlik iptal edildi; katılımcılara tam iade yazıldı.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Etkinliği iptal et"
      description={`${activity.name}: ${String(activity.participantCount)} katılımın hepsi tam iadeyle kapanır. Ödenmemiş taksitler kapanır; alınan tutarlar iade kaydı olur.`}
      footer={
        <ModalFooter busy={busy} form="gezi-iptal-formu" submit="İptal et" onClose={onClose} />
      }
    >
      <form
        id="gezi-iptal-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="gezi-iptal-gerekce" label="Gerekçe" error={form.formState.errors.reason}>
          {(control) => (
            <Input
              {...control}
              {...form.register('reason', { required: 'İptal gerekçesini yazın.' })}
              disabled={busy}
            />
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

function JoinModal({ activity, onClose }: { activity: PaidActivityRow; onClose: () => void }) {
  const learner = useEnrollmentLearner()
  const students = useCoreAll('students')
  const join = useJoinPaidActivity()
  const form = useForm<{ studentId: string }>({ defaultValues: { studentId: '' } })
  const busy = join.isPending || form.formState.isSubmitting
  const options = (students.data ?? [])
    .filter((item) => item.record.isActive)
    .sort((a, b) => a.record.name.localeCompare(b.record.name, 'tr'))
  const onSubmit = form.handleSubmit(async ({ studentId }) => {
    const outcome = await join.submit(
      { activityId: activity.id, studentId },
      {
        setError: (name, error) =>
          name === 'studentId'
            ? form.setError('studentId', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`Katılım yazıldı; ${money(activity.feeCents)} taksit açıldı.`)
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Katılımcı ekle"
      description={`${activity.name}: ${learner.dative} ${money(activity.feeCents)} tutarında, ${dayText(activity.joinDeadline)} vadeli taksit açılır.`}
      footer={<ModalFooter busy={busy} form="gezi-katilim-formu" submit="Yaz" onClose={onClose} />}
    >
      <form
        id="gezi-katilim-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField
          id="gezi-katilim-ogrenci"
          label={learner.title}
          error={form.formState.errors.studentId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('studentId', { required: `${learner.title} seçin.` })}
              className="w-full"
              disabled={busy || !students.data}
            >
              <NativeSelectOption value="">{learner.title} seçin</NativeSelectOption>
              {options.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.record.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

function CancelParticipantModal({
  activity,
  row,
  onClose,
}: {
  activity: PaidActivityRow
  row: ParticipantRow
  onClose: () => void
}) {
  const cancel = useCancelPaidActivityParticipation()
  const [today] = useState(() => dayKey(Date.now()))
  const onTime = today <= activity.cancelDeadline
  async function confirm() {
    const outcome = await cancel.submit({ participantId: row.id, version: row.version })
    if (outcome.status === 'success') {
      const { refundCents, debtInvoiceId } = outcome.data.data
      notify.success(
        refundCents > 0
          ? `Katılım iptal edildi; ${money(refundCents)} iade kaydı açıldı.`
          : debtInvoiceId
            ? 'Katılım iptal edildi; kalan kesinti için taksit açıldı.'
            : 'Katılım iptal edildi.',
      )
      onClose()
    } else if (outcome.status === 'failed') onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Katılımı iptal et"
      description={`${row.name}: ${
        onTime
          ? 'son iptal günü geçmedi, tam iade yapılır.'
          : `son iptal günü geçti; ${refundRuleText(activity)}`
      } Ödenmemiş taksit kapanır.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={cancel.isPending}>
            Vazgeç
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={cancel.isPending}
            aria-busy={cancel.isPending || undefined}
          >
            Katılımı iptal et
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Alınan tutar: {money(row.collectedCents)} / {money(row.amountCents)}.
      </p>
    </Modal>
  )
}

function RefundModal({ row, onClose }: { row: ParticipantRow; onClose: () => void }) {
  const accounts = useBankAccounts()
  if (accounts.isPending)
    return (
      <Modal open onOpenChange={(open) => (open ? undefined : onClose())} title="İadeyi öde">
        <SummaryLoading />
      </Modal>
    )
  return <RefundFormModal row={row} onClose={onClose} accounts={accounts.data?.data ?? []} />
}

function RefundFormModal({
  row,
  onClose,
  accounts,
}: {
  row: ParticipantRow
  onClose: () => void
  accounts: readonly { id: string; bankName: string; iban: string }[]
}) {
  const pay = usePayPaidActivityRefund()
  const [today] = useState(() => dayKey(Date.now()))
  const [reauth, setReauth] = useState(false)
  const form = useForm<PayRefundInput, unknown, PayRefundOutput>({
    resolver: zodResolver(payRefundSchema),
    defaultValues: {
      paidDate: today,
      iban: '',
      accountHolder: '',
      bankAccountId: accounts[0]?.id ?? '',
    },
  })
  const busy = pay.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  async function send(values: PayRefundOutput) {
    const outcome = await pay.submit(
      { participantId: row.id, version: row.version, body: values },
      {
        setError: (name, error) => {
          if (
            name === 'iban' ||
            name === 'accountHolder' ||
            name === 'paidDate' ||
            name === 'bankAccountId'
          )
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
      description={`${row.name} · ${money(row.refundCents)}. Ödenen iade değiştirilemez; ödeme gününün gün sonuna iade ödemesi olarak girer.`}
      footer={
        <ModalFooter
          busy={busy}
          form="gezi-iade-formu"
          submit="Ödendi olarak kaydet"
          onClose={onClose}
        />
      }
    >
      <form
        id="gezi-iade-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="gezi-iade-tarih" label="Ödeme tarihi" error={errors.paidDate}>
          {(control) => (
            <Input
              {...control}
              {...form.register('paidDate')}
              type="date"
              min={row.cancelledDate ?? undefined}
              max={today}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="gezi-iade-hesap"
          label="Kurum banka hesabı"
          error={errors.bankAccountId}
          description={
            accounts.length === 0
              ? 'Tanımlı banka hesabı yok; Ayarlar’dan hesap ekleyin.'
              : 'İadenin çıktığı bildirilmiş hesap.'
          }
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('bankAccountId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Hesap seçin</NativeSelectOption>
              {accounts.map((account) => (
                <NativeSelectOption key={account.id} value={account.id}>
                  {bankAccountLabel(account)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="gezi-iade-iban" label="IBAN" error={errors.iban}>
          {(control) => (
            <Input {...control} {...form.register('iban')} autoComplete="off" disabled={busy} />
          )}
        </FormField>
        <FormField
          id="gezi-iade-sahip"
          label="Hesap sahibi"
          error={errors.accountHolder}
          description="Öğrencinin kayıtlı velisi; velisi yoksa kendisi."
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
        <RootError message={errors.root?.server?.message} />
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
