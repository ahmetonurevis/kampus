import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useBulkJoinPaidActivity,
  useCancelPaidActivityParticipation,
  useGrantPaidActivityConsent,
  useJoinPaidActivity,
  usePaidActivityParticipants,
  usePaidActivityRoster,
  usePaidActivityRosterCsv,
  usePayPaidActivityRefund,
  useSyncPaidActivityConsents,
  useWithdrawPaidActivityConsent,
  type PaidActivityParticipant,
  type PaidActivityRow,
} from '@kampus/react-shared/use-finance-paid-activities.ts'
import { useBankAccounts } from '@kampus/react-shared/use-payment-commands.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import {
  grantConsentSchema,
  rosterStatusText,
  type GrantConsentInput,
} from '@kampus/school-core/lib/finance-paid-activity-participants.ts'
import {
  CONSENT_CHANNEL_LABELS,
  CONSENT_STATUS_LABELS,
  MANUAL_CONSENT_CHANNELS,
  PARTICIPATION_PAYMENT_STATUS_LABELS,
  PARTICIPATION_REFUND_STATUS_LABELS,
  PARTICIPATION_STATUS_LABELS,
  PARTICIPATION_STATUSES,
  type ParticipationStatus,
} from '@kampus/school-core/lib/finance-paid-activities.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { bankAccountLabel } from '@kampus/school-core/lib/payments.ts'
import {
  payRefundSchema,
  type PayRefundInput,
  type PayRefundOutput,
} from '@kampus/school-core/lib/withdrawals.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { useAuth } from '@/auth/use-auth.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
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
import { saveBlob } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'

/**
 * Gezi ve etkinlik katılımcı paneli (DOM-FIN-098, DOM-FIN-112; ON-142, ON-156; K-369…K-371).
 * Katılımcılar asil, izin bekleyen, yedek ve iptal olarak süzülür; tek tek ya da sınıf seçerek
 * yazılır (kontenjanı aşan yedeğe). Veli izni elle kaydedilir ya da bağlı izin formundan eşitlenir;
 * geri çekilen izin katılımı iptal eder, boşalan yere sıradaki yedek geçer. Katılım listesi PDF ve
 * CSV olarak alınır (veli telefonu maskeli); ikisi de taze oturum ister.
 */

const NO_SORT: readonly string[] = []
const PARTICIPANT_MOBILE = ['studentName', 'status', 'payment']
const BOM = '﻿'
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

type ParticipantRow = PaidActivityParticipant & { name: string } & Record<string, unknown>

type ManualChannel = (typeof MANUAL_CONSENT_CHANNELS)[number]

const isStatus = (value: unknown): value is ParticipationStatus =>
  typeof value === 'string' && (PARTICIPATION_STATUSES as readonly string[]).includes(value)

const STATUS_TONES = {
  active: 'green',
  awaiting_consent: 'amber',
  waitlisted: 'purple',
  cancelled: 'gray',
} as const

const FORM_STATUS_TEXT = {
  pending: 'Formda karar bekleniyor',
  approved: 'Formda onaylandı',
  rejected: 'Formda reddedildi',
  not_targeted: 'Form bu öğrenciye açılmamış',
} as const

function statusText(row: PaidActivityParticipant): string {
  if (row.status === 'cancelled')
    return `${PARTICIPATION_STATUS_LABELS.cancelled}${row.cancelledDate ? ` · ${dayText(row.cancelledDate)}` : ''}`
  return rosterStatusText({ status: row.status, waitlistRank: row.waitlistRank })
}

function consentText(row: PaidActivityParticipant): string {
  if (row.consentStatus === 'granted' && row.consentChannel !== null)
    return `${CONSENT_STATUS_LABELS.granted} · ${CONSENT_CHANNEL_LABELS[row.consentChannel]}`
  return CONSENT_STATUS_LABELS[row.consentStatus]
}

export function refundRuleText(row: PaidActivityRow): string {
  const late =
    row.lateRefundRule === 'percent'
      ? `sonra ücretin %${String(row.lateRefundPercent ?? 0)}'i iade edilir`
      : `sonra kişi başı ${money(row.lateCostCents ?? 0)} masraf düşülür`
  return `${dayText(row.cancelDeadline)} gününe kadar iptalde tam iade, ${late}.`
}

export function ParticipantsPanel({
  activity,
  isManager,
}: {
  activity: PaidActivityRow
  isManager: boolean
}) {
  const learner = useEnrollmentLearner()
  const list = useListState('gezi-katilimcilar', { resetKey: activity.id })
  const filterValue = list.state.filters.durum
  const status = isStatus(filterValue) ? filterValue : undefined
  const participants = usePaidActivityParticipants(activity.id, {
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(status === undefined ? {} : { status }),
  })
  const [joining, setJoining] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [cancelling, setCancelling] = useState<ParticipantRow | null>(null)
  const [refunding, setRefunding] = useState<ParticipantRow | null>(null)
  const [granting, setGranting] = useState<ParticipantRow | null>(null)
  const [withdrawing, setWithdrawing] = useState<ParticipantRow | null>(null)
  const open = activity.status === 'open'
  const rows = useMemo(
    () =>
      participants.data?.data.map((item): ParticipantRow => ({
        ...item,
        name: item.studentName ?? '—',
      })),
    [participants.data],
  )
  const filters = useMemo(
    () => [
      {
        key: 'durum',
        label: 'Katılım',
        type: 'select' as const,
        options: PARTICIPATION_STATUSES.map((value) => ({
          value,
          label: PARTICIPATION_STATUS_LABELS[value],
        })),
      },
    ],
    [],
  )
  const columns = useMemo<DataColumn<ParticipantRow>[]>(
    () => [
      {
        key: 'studentName',
        label: learner.title,
        cell: (row) => (
          <span className="grid">
            <span>{row.name}</span>
            {row.className ? (
              <span className="text-sm text-muted-foreground">{row.className}</span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'status',
        label: 'Katılım',
        cell: (row) => <StatusBadge text={statusText(row)} tone={STATUS_TONES[row.status]} />,
      },
      ...(activity.requiresConsent
        ? [
            {
              key: 'consent',
              label: 'Veli izni',
              cell: (row: ParticipantRow) => (
                <span className="grid gap-1">
                  <span className="text-sm">{consentText(row)}</span>
                  {row.permissionStatus ? (
                    <span className="text-sm text-muted-foreground">
                      {FORM_STATUS_TEXT[row.permissionStatus]}
                    </span>
                  ) : null}
                </span>
              ),
            },
          ]
        : []),
      {
        key: 'payment',
        label: 'Ödeme',
        cell: (row) =>
          row.paymentStatus === 'not_billed' ? (
            <StatusBadge text={PARTICIPATION_PAYMENT_STATUS_LABELS.not_billed} tone="gray" />
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge text={PARTICIPATION_PAYMENT_STATUS_LABELS[row.paymentStatus]} />
              <span className="text-sm text-muted-foreground">
                {money(row.collectedCents)} / {money(row.amountCents)}
              </span>
            </span>
          ),
      },
      {
        key: 'refund',
        label: 'İade',
        cell: (row) =>
          row.status !== 'cancelled' ? (
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
            {open && row.status !== 'cancelled' && row.consentStatus === 'pending' ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.name} veli iznini kaydet`}
                onClick={() => setGranting(row)}
              >
                İzni kaydet
              </Button>
            ) : null}
            {open && row.status !== 'cancelled' && row.consentStatus === 'granted' ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${row.name} izninin geri çekildiğini kaydet`}
                onClick={() => setWithdrawing(row)}
              >
                İzin geri çekildi
              </Button>
            ) : null}
            {open && row.status !== 'cancelled' ? (
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
    [activity.requiresConsent, isManager, learner, open],
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
          <p className="text-sm text-muted-foreground">
            Asil {activity.participantCount} / {activity.capacity}
            {activity.requiresConsent
              ? ` · izin bekleyen ${String(activity.awaitingConsentCount)}`
              : ''}{' '}
            · yedek {activity.waitlistCount}. Kontenjan dolunca yeni katılım yedeğe yazılır; yer
            açılınca sıradaki yedek asile geçer ve taksiti o anda açılır.
            {activity.requiresConsent ? ' Veli izni zorunludur; taksit izinle açılır.' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RosterButtons activity={activity} />
          {open && activity.requiresConsent && activity.permissionFormId ? (
            <SyncButton activity={activity} />
          ) : null}
          {open ? (
            <>
              <Button variant="secondary" onClick={() => setBulk(true)}>
                <Icon name="Users" size={17} aria-hidden="true" />
                Sınıf ekle
              </Button>
              <Button onClick={() => setJoining(true)}>
                <Icon name="Plus" size={17} aria-hidden="true" />
                Katılımcı ekle
              </Button>
            </>
          ) : null}
        </div>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={participants.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={PARTICIPANT_MOBILE}
        caption={`${activity.name} katılımcıları`}
        search={false}
        empty={status === undefined ? 'Henüz katılımcı yok.' : 'Bu durumda katılımcı yok.'}
        loading={participants.isPending}
        fetching={participants.isFetching && !participants.isPending}
        error={
          participants.error ? (
            <QueryError error={participants.error} onRetry={() => void participants.refetch()} />
          ) : undefined
        }
      />
      {joining ? <JoinModal activity={activity} onClose={() => setJoining(false)} /> : null}
      {bulk ? <BulkJoinModal activity={activity} onClose={() => setBulk(false)} /> : null}
      {cancelling ? (
        <CancelParticipantModal
          activity={activity}
          row={cancelling}
          onClose={() => setCancelling(null)}
        />
      ) : null}
      {granting ? <ConsentModal row={granting} onClose={() => setGranting(null)} /> : null}
      {withdrawing ? (
        <WithdrawConsentModal
          activity={activity}
          row={withdrawing}
          onClose={() => setWithdrawing(null)}
        />
      ) : null}
      {refunding ? <RefundModal row={refunding} onClose={() => setRefunding(null)} /> : null}
    </section>
  )
}

function RosterButtons({ activity }: { activity: PaidActivityRow }) {
  const learner = useEnrollmentLearner()
  const { session } = useAuth()
  const roster = usePaidActivityRoster()
  const csv = usePaidActivityRosterCsv()
  const { run, reauthModal } = useReauthRetry()
  const [printing, setPrinting] = useState(false)

  async function downloadCsv() {
    const outcome = await run(() => csv.submit({ activityId: activity.id }))
    if (outcome.status !== 'done' || outcome.result.status !== 'success') return
    const content = String(outcome.result.data).replace(BOM, '')
    saveBlob(
      new Blob([BOM, content], { type: 'text/csv;charset=utf-8' }),
      `katilim-listesi-${dayKey(Date.now())}.csv`,
    )
    notify.success('Katılım listesi indirildi.')
  }

  async function downloadPdf() {
    setPrinting(true)
    try {
      const outcome = await run(() => roster.submit({ activityId: activity.id }))
      if (outcome.status !== 'done' || outcome.result.status !== 'success') return
      const data = outcome.result.data.data
      const [{ renderPdf }, template] = await Promise.all([
        import('@/lib/pdf/render.ts'),
        import('@/lib/pdf/templates/finance-paid-activity-roster.ts'),
      ])
      const { blob } = await renderPdf((measurer) =>
        template.paidActivityRosterDocument(measurer, data, {
          institution: session?.institution.name ?? 'Kampüs',
          generatedAt: new Date(),
          learnerTitle: learner.title,
        }),
      )
      saveBlob(blob, template.paidActivityRosterFilename(data.activity))
      notify.success('Katılım listesi PDF olarak indirildi.')
    } catch (error) {
      console.error('[kampus]', 'pdf', error)
      notify.error('Katılım listesi PDF’i hazırlanamadı. Lütfen tekrar deneyin.')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => void downloadPdf()}
        disabled={printing || roster.isPending}
        aria-busy={printing || undefined}
      >
        <Icon name="Printer" size={17} aria-hidden="true" />
        Liste PDF
      </Button>
      <Button
        variant="secondary"
        onClick={() => void downloadCsv()}
        disabled={csv.isPending}
        aria-busy={csv.isPending || undefined}
      >
        <Icon name="Download" size={17} aria-hidden="true" />
        CSV
      </Button>
      {reauthModal}
    </>
  )
}

function SyncButton({ activity }: { activity: PaidActivityRow }) {
  const sync = useSyncPaidActivityConsents()
  async function start() {
    const outcome = await sync.submit({ activityId: activity.id })
    if (outcome.status !== 'success') return
    const { grantedCount, withdrawnCount, promotedCount } = outcome.data.data
    notify.success(
      grantedCount + withdrawnCount === 0
        ? 'İzin formunda yeni karar yok.'
        : `${String(grantedCount)} izin alındı, ${String(withdrawnCount)} katılım iptal edildi${promotedCount > 0 ? `, ${String(promotedCount)} yedek asile geçti` : ''}.`,
    )
  }
  return (
    <Button
      variant="secondary"
      onClick={() => void start()}
      disabled={sync.isPending}
      aria-busy={sync.isPending || undefined}
    >
      <Icon name="RefreshCw" size={17} aria-hidden="true" />
      İzinleri formdan eşitle
    </Button>
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

const seatsLeft = (activity: PaidActivityRow) =>
  Math.max(0, activity.capacity - activity.participantCount)

function joinDescription(activity: PaidActivityRow, dative: string): string {
  if (seatsLeft(activity) === 0)
    return `${activity.name}: kontenjan dolu; katılım sıra numarasıyla yedeğe yazılır, taksit açılmaz.`
  if (activity.requiresConsent)
    return `${activity.name}: veli izni zorunlu; ${dative} ${money(activity.feeCents)} tutarındaki taksit izin kaydedilince açılır.`
  return `${activity.name}: ${dative} ${money(activity.feeCents)} tutarında, ${dayText(activity.joinDeadline)} vadeli taksit açılır.`
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
      const { status, waitlistRank } = outcome.data.data
      notify.success(
        status === 'waitlisted'
          ? `Kontenjan dolu; ${String(waitlistRank ?? '')}. yedek olarak yazıldı.`
          : status === 'awaiting_consent'
            ? 'Katılım yazıldı; taksit veli izni kaydedilince açılır.'
            : `Katılım yazıldı; ${money(activity.feeCents)} taksit açıldı.`,
      )
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Katılımcı ekle"
      description={joinDescription(activity, learner.dative)}
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

function BulkJoinModal({ activity, onClose }: { activity: PaidActivityRow; onClose: () => void }) {
  const learner = useEnrollmentLearner()
  const classes = useCoreAll('classes')
  const bulk = useBulkJoinPaidActivity()
  const form = useForm<{ classId: string }>({ defaultValues: { classId: '' } })
  const busy = bulk.isPending || form.formState.isSubmitting
  const options = (classes.data ?? [])
    .filter((item) => item.record.isActive !== false)
    .sort((a, b) => a.record.name.localeCompare(b.record.name, 'tr', { numeric: true }))
  const onSubmit = form.handleSubmit(async ({ classId }) => {
    const outcome = await bulk.submit(
      { activityId: activity.id, classIds: [classId] },
      {
        setError: (name, error) =>
          name === 'classIds'
            ? form.setError('classId', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      const { activeCount, awaitingConsentCount, waitlistedCount, skippedStudentIds } =
        outcome.data.data
      const parts = [
        activeCount > 0 ? `${String(activeCount)} asil` : '',
        awaitingConsentCount > 0 ? `${String(awaitingConsentCount)} izin bekleyen` : '',
        waitlistedCount > 0 ? `${String(waitlistedCount)} yedek` : '',
      ].filter(Boolean)
      notify.success(
        `${parts.length > 0 ? `${parts.join(', ')} yazıldı` : 'Yeni katılım yazılmadı'}${skippedStudentIds.length > 0 ? `; ${String(skippedStudentIds.length)} ${learner.noun} zaten listede` : ''}.`,
      )
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Sınıf ekle"
      description={`${activity.name}: sınıfın etkin ${learner.plural} ada göre yazılır. Boş yer ${String(seatsLeft(activity))}; aşan kısım sırayla yedeğe yazılır, zaten listede olanlar atlanır.`}
      footer={<ModalFooter busy={busy} form="gezi-toplu-formu" submit="Yaz" onClose={onClose} />}
    >
      <form
        id="gezi-toplu-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="gezi-toplu-sinif" label="Sınıf" error={form.formState.errors.classId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('classId', { required: 'Sınıf seçin.' })}
              className="w-full"
              disabled={busy || !classes.data}
            >
              <NativeSelectOption value="">Sınıf seçin</NativeSelectOption>
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

function ConsentModal({ row, onClose }: { row: ParticipantRow; onClose: () => void }) {
  const grant = useGrantPaidActivityConsent()
  const form = useForm<GrantConsentInput>({
    resolver: zodResolver(grantConsentSchema),
    defaultValues: { channel: 'paper', grantorName: '' },
  })
  const busy = grant.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await grant.submit(
      { participantId: row.id, version: row.version, body: values },
      {
        setError: (name, error) =>
          name === 'channel' || name === 'grantorName'
            ? form.setError(name, error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success(
        outcome.data.data.invoiceId !== null && row.invoiceId === null
          ? 'Veli izni kaydedildi; taksit açıldı.'
          : 'Veli izni kaydedildi.',
      )
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Veli iznini kaydet"
      description={`${row.name}: ${row.status === 'awaiting_consent' ? 'izin kaydedilince katılım asil olur ve taksit açılır.' : 'izin kaydedilir; yedekten asile geçince taksit açılır.'}`}
      footer={<ModalFooter busy={busy} form="gezi-izin-formu" submit="Kaydet" onClose={onClose} />}
    >
      <form
        id="gezi-izin-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="gezi-izin-kanal" label="İznin geldiği kanal" error={errors.channel}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('channel')}
              className="w-full"
              disabled={busy}
            >
              {MANUAL_CONSENT_CHANNELS.map((channel) => (
                <NativeSelectOption key={channel} value={channel}>
                  {CONSENT_CHANNEL_LABELS[channel]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="gezi-izin-veren"
          label="İzni veren"
          error={errors.grantorName}
          description="Velinin (yetişkin öğrencide kendisinin) adı soyadı."
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('grantorName')}
              autoComplete="off"
              disabled={busy}
            />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

function WithdrawConsentModal({
  activity,
  row,
  onClose,
}: {
  activity: PaidActivityRow
  row: ParticipantRow
  onClose: () => void
}) {
  const withdraw = useWithdrawPaidActivityConsent()
  const form = useForm<{ channel: ManualChannel }>({ defaultValues: { channel: 'paper' } })
  const busy = withdraw.isPending || form.formState.isSubmitting
  const [today] = useState(() => dayKey(Date.now()))
  const onTime = today <= activity.cancelDeadline
  const onSubmit = form.handleSubmit(async ({ channel }) => {
    const outcome = await withdraw.submit(
      { participantId: row.id, version: row.version, body: { channel } },
      { setError: (_name, error) => form.setError('root.server', error) },
    )
    if (outcome.status === 'success') {
      notify.success(
        outcome.data.data.refundCents > 0
          ? `İzin geri çekildi; katılım iptal edildi, ${money(outcome.data.data.refundCents)} iade kaydı açıldı.`
          : 'İzin geri çekildi; katılım iptal edildi.',
      )
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="İzin geri çekildi"
      description={`${row.name}: katılım iptal edilir; ${
        onTime
          ? 'son iptal günü geçmedi, tam iade yapılır.'
          : `son iptal günü geçti; ${refundRuleText(activity)}`
      } Boşalan yere sıradaki yedek geçer.`}
      footer={
        <ModalFooter
          busy={busy}
          form="gezi-izin-geri-formu"
          submit="Katılımı iptal et"
          onClose={onClose}
        />
      }
    >
      <form
        id="gezi-izin-geri-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="gezi-izin-geri-kanal" label="Geri çekmenin geldiği kanal">
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('channel')}
              className="w-full"
              disabled={busy}
            >
              {MANUAL_CONSENT_CHANNELS.map((channel) => (
                <NativeSelectOption key={channel} value={channel}>
                  {CONSENT_CHANNEL_LABELS[channel]}
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
  const billed = row.invoiceId !== null
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
        !billed
          ? 'taksit açılmadığı için ücret ya da iade yok.'
          : onTime
            ? 'son iptal günü geçmedi, tam iade yapılır.'
            : `son iptal günü geçti; ${refundRuleText(activity)}`
      }${billed ? ' Ödenmemiş taksit kapanır.' : ''}${row.status === 'waitlisted' ? '' : ' Boşalan yere sıradaki yedek geçer.'}`}
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
        {billed
          ? `Alınan tutar: ${money(row.collectedCents)} / ${money(row.amountCents)}.`
          : `Katılım: ${statusText(row)}.`}
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
