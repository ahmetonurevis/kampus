import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  useApproveEarlyDismissal,
  useCancelEarlyDismissal,
  useCreateEarlyDismissal,
  useEarlyDismissal,
  useEarlyDismissalPickupOptions,
  useEarlyDismissals,
  useEarlyDismissalSummary,
  useRejectEarlyDismissal,
  useReleaseEarlyDismissal,
  type EarlyDismissalDetail,
  type EarlyDismissalRow,
} from '@kampus/react-shared/use-finance-early-dismissals.ts'
import {
  EARLY_DISMISSAL_REASON_LABELS,
  EARLY_DISMISSAL_REASONS,
  EARLY_DISMISSAL_STATUS_LABELS,
  EARLY_DISMISSAL_STATUSES,
  PICKUP_RELATIONSHIP_LABELS,
  PICKUP_RELATIONSHIPS,
} from '@kampus/school-core/lib/finance-early-dismissals.ts'
import { dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  authorizedPickupText,
  dismissalStatusBadge,
  dismissalTimeText,
  effectText,
  OTHER_PICKUP,
  pickupText,
  rejectFormSchema,
  releaseBody,
  releaseDefaults,
  releaseFormField,
  releaseFormSchema,
  requestBody,
  requestDefaults,
  requestFormField,
  requestFormSchema,
  type RejectFormValues,
  type ReleaseFormValues,
  type RequestFormValues,
} from './finance-early-dismissal-forms.ts'

const NO_SORT: readonly string[] = []
const STATUS_FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: EARLY_DISMISSAL_STATUSES.map((value) => ({
      value,
      label: EARLY_DISMISSAL_STATUS_LABELS[value],
    })),
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

type TableRow = {
  id: string
  row: EarlyDismissalRow
  student: string
  className: string
  time: string
  pickup: string
  reason: string
}
const toTableRow = (item: EarlyDismissalRow): TableRow => ({
  id: item.id,
  row: item,
  student: item.studentName ?? 'Öğrenci',
  className: item.className ?? item.classId ?? '—',
  time: dismissalTimeText(item),
  pickup: pickupText(item),
  reason: EARLY_DISMISSAL_REASON_LABELS[item.reason],
})

/**
 * Erken çıkış (DOM-FIN-161; ON-168): Finans "Erken çıkış" sekmesi, yönetici ve ön büro. Seçilen
 * günün talepleri planlanan saat sırasıyla gelir; bekleyen talep satırdan onaylanır ya da
 * gerekçeyle reddedilir, onaylı talepte "Teslim et" teslim formunu açar: teslim alan yetkili
 * listesinden seçilir, kimliğin görüldüğü işaretlenir (K-538, K-539). "Acil erken çıkış" okulun
 * kendi açtığı, onaylı doğan kayıttır. Ayrıntı panelinde etkilenen dersler görünür (K-540).
 */
export function FinanceEarlyDismissalsSection() {
  const [day, setDay] = useState(() => dayKey())
  const dayId = useId()
  const panel = useDetailPanel('erken_cikis')
  const summary = useEarlyDismissalSummary(day, day !== '')
  const [requesting, setRequesting] = useState(false)
  const [rejecting, setRejecting] = useState<EarlyDismissalRow | null>(null)
  const [releasing, setReleasing] = useState<EarlyDismissalRow | null>(null)
  const counts = summary.data?.data.counts
  return (
    <section
      aria-labelledby="erken-cikis"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="erken-cikis" className="text-lg font-semibold">
            Erken çıkış
          </h2>
          <p className="text-sm text-muted-foreground">
            Veli talepleri ve okulun acil kayıtları. Öğrenci yalnız teslim yetkilisine ya da
            onaylanan kişiye, kimliği görülerek teslim edilir; kimlik numarası yazılmaz.
          </p>
          {counts ? (
            <p className="text-sm" aria-live="polite">
              {`Onay bekleyen ${String(counts.pending)} · onaylı ${String(counts.approved)} · teslim edilen ${String(counts.released)}`}
            </p>
          ) : null}
        </div>
        <Button className="min-h-11" onClick={() => setRequesting(true)}>
          Acil erken çıkış
        </Button>
      </header>
      {summary.error ? (
        <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
      ) : null}
      <div className="flex flex-wrap items-end gap-2 px-6 pt-2">
        <div className="grid gap-1">
          <Label htmlFor={dayId}>Çıkış günü</Label>
          <Input
            id={dayId}
            type="date"
            value={day}
            className="max-w-48"
            onChange={(event) => setDay(event.target.value)}
          />
        </div>
        <Button variant="ghost" className="min-h-11" onClick={() => setDay(dayKey())}>
          Bugün
        </Button>
      </div>
      <DismissalList
        day={day}
        onOpen={panel.open}
        onReject={setRejecting}
        onRelease={setReleasing}
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Erken çıkış"
      >
        {panel.selectedId ? <DismissalPanel dismissalId={panel.selectedId} /> : null}
      </SidePanel>
      <Modal
        open={requesting}
        onOpenChange={setRequesting}
        title="Acil erken çıkış"
        description="Okulun açtığı kayıt onaylı doğar. Teslim alacak kişiyi yetkililerden seçin ya da kayıtlı olmayan kişinin bilgilerini yazın."
        size="wide"
      >
        {requesting ? (
          <RequestForm
            onDone={(date) => {
              setRequesting(false)
              setDay(date)
            }}
          />
        ) : null}
      </Modal>
      <Modal
        open={rejecting !== null}
        onOpenChange={(open) => (open ? undefined : setRejecting(null))}
        title="Talebi reddet"
        description="Gerekçe veliye görünür."
      >
        {rejecting ? <RejectForm row={rejecting} onDone={() => setRejecting(null)} /> : null}
      </Modal>
      <Modal
        open={releasing !== null}
        onOpenChange={(open) => (open ? undefined : setReleasing(null))}
        title="Öğrenciyi teslim et"
        description="Teslim alan kişiyi listeden seçin ve kimliğini görün. Listede olmayan kişiye teslim edilmez."
      >
        {releasing ? (
          <ReleaseLoader dismissalId={releasing.id} onDone={() => setReleasing(null)} />
        ) : null}
      </Modal>
    </section>
  )
}

function DismissalList({
  day,
  onOpen,
  onReject,
  onRelease,
}: {
  day: string
  onOpen: (id: string) => void
  onReject: (row: EarlyDismissalRow) => void
  onRelease: (row: EarlyDismissalRow) => void
}) {
  const list = useListState('erken-cikis', { urlPrefix: 'erken_' })
  const status = EARLY_DISMISSAL_STATUSES.find((value) => value === text(list.state.filters.status))
  const dismissals = useEarlyDismissals({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(day === '' ? {} : { date: day }),
    ...(status === undefined ? {} : { status }),
  })
  const approve = useApproveEarlyDismissal()
  const today = dayKey()
  const rows = useMemo(() => dismissals.data?.data.map(toTableRow), [dismissals.data])
  const columns = useMemo<DataColumn<TableRow>[]>(() => {
    const approveRow = async (row: EarlyDismissalRow) => {
      const outcome = await approve.submit({ dismissalId: row.id, version: row.version })
      if (outcome.status === 'success')
        notify.success(`${row.studentName ?? 'Öğrenci'} için erken çıkış onaylandı.`)
    }
    return [
      { key: 'student', label: 'Öğrenci' },
      { key: 'className', label: 'Sınıf' },
      { key: 'time', label: 'Saat' },
      { key: 'pickup', label: 'Teslim alacak' },
      { key: 'reason', label: 'Neden' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => {
          const badge = dismissalStatusBadge(row.row)
          return <StatusBadge text={badge.text} tone={badge.tone} />
        },
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            {row.row.status === 'pending' ? (
              <>
                <Button
                  className="min-h-11"
                  variant="secondary"
                  aria-label={`${row.student} talebini onayla`}
                  disabled={approve.isPending}
                  onClick={() => void approveRow(row.row)}
                >
                  Onayla
                </Button>
                <Button
                  className="min-h-11"
                  variant="ghost"
                  aria-label={`${row.student} talebini reddet`}
                  onClick={() => onReject(row.row)}
                >
                  Reddet
                </Button>
              </>
            ) : null}
            {row.row.status === 'approved' && row.row.dismissalOn === today ? (
              <Button
                className="min-h-11"
                variant="secondary"
                aria-label={`${row.student} öğrencisini teslim et`}
                onClick={() => onRelease(row.row)}
              >
                Teslim et
              </Button>
            ) : null}
            <Button
              className="min-h-11"
              variant="ghost"
              aria-label={`${row.student} kaydını aç`}
              onClick={() => onOpen(row.id)}
            >
              Aç
            </Button>
          </span>
        ),
      },
    ]
  }, [approve, onOpen, onReject, onRelease, today])
  return (
    <ServerDataTable
      list={list}
      rows={rows}
      total={dismissals.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      filters={STATUS_FILTERS}
      search={false}
      mobileColumns={['student', 'status', ACTIONS_KEY]}
      caption="Erken çıkış talepleri"
      empty={day === '' ? 'Henüz erken çıkış yok.' : 'Bu gün için erken çıkış yok.'}
      emptyFiltered="Bu seçimle eşleşen erken çıkış yok."
      loading={dismissals.isPending}
      fetching={dismissals.isFetching && !dismissals.isPending}
      error={
        dismissals.error ? (
          <QueryError error={dismissals.error} onRetry={() => void dismissals.refetch()} />
        ) : undefined
      }
    />
  )
}

// --- Ayrıntı -------------------------------------------------------------------------------------

function DismissalPanel({ dismissalId }: { dismissalId: string }) {
  const dismissal = useEarlyDismissal(dismissalId)
  if (dismissal.error)
    return <QueryError error={dismissal.error} onRetry={() => void dismissal.refetch()} />
  const detail = dismissal.data?.data
  if (!detail) return <SummaryLoading />
  return <DismissalDetails key={detail.version} detail={detail} />
}

function DismissalDetails({ detail }: { detail: EarlyDismissalDetail }) {
  const cancel = useCancelEarlyDismissal()
  const status = dismissalStatusBadge(detail)
  const effect = effectText(detail.effect)
  const items: [string, string][] = [
    ['Sınıf', detail.className ?? detail.classId ?? '—'],
    ['Saat', dismissalTimeText(detail)],
    ['Neden', EARLY_DISMISSAL_REASON_LABELS[detail.reason]],
    ...(detail.reasonNote ? ([['Açıklama', detail.reasonNote]] as [string, string][]) : []),
    ['Teslim alacak', pickupText(detail)],
    ...(detail.maskedIdLast4
      ? ([['Kimlik son dört hane', detail.maskedIdLast4]] as [string, string][])
      : []),
    ['Açan', detail.source === 'school' ? 'Okul (acil kayıt)' : 'Veli talebi'],
    ...(detail.rejectionReason
      ? ([['Ret gerekçesi', detail.rejectionReason]] as [string, string][])
      : []),
    ...(detail.releasedToName
      ? ([['Teslim alan', detail.releasedToName]] as [string, string][])
      : []),
  ]
  const open = detail.status === 'pending' || detail.status === 'approved'
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{detail.studentName ?? 'Öğrenci'}</h3>
        <StatusBadge text={status.text} tone={status.tone} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {effect ? (
        <div className="grid gap-2">
          <h4 className="text-sm font-semibold">Yoklamaya yansıma</h4>
          <p className="text-sm">{effect}</p>
          {detail.effect && detail.effect.lessons.length > 0 ? (
            <ul className="grid gap-1 text-sm" aria-label="Etkilenen dersler">
              {detail.effect.lessons.map((lesson) => (
                <li key={lesson.lessonId}>
                  {`${String(lesson.period)}. ders · ${timeLabel(lesson.startsAt)}–${timeLabel(lesson.endsAt)}${lesson.title ? ` · ${lesson.title}` : ''}${lesson.partial ? ' (dersin ortasında çıktı)' : ''}`}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-1">
        <h4 className="text-sm font-semibold">Teslim yetkilileri</h4>
        {detail.authorizedPickups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kayıtlı teslim yetkilisi yok.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {detail.authorizedPickups.map((item) => (
              <li key={item.guardianLinkId}>{authorizedPickupText(item)}</li>
            ))}
          </ul>
        )}
      </div>
      {open ? (
        <div>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={cancel.isPending}
            onClick={() =>
              void cancel
                .submit({ dismissalId: detail.id, version: detail.version, body: {} })
                .then((outcome) => {
                  if (outcome.status === 'success') notify.success('Erken çıkış iptal edildi.')
                })
            }
          >
            Talebi iptal et
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// --- Ret -----------------------------------------------------------------------------------------

function RejectForm({ row, onDone }: { row: EarlyDismissalRow; onDone: () => void }) {
  const reject = useRejectEarlyDismissal()
  const form = useForm<RejectFormValues>({
    resolver: zodResolver(rejectFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = reject.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await reject.submit(
      { dismissalId: row.id, version: row.version, body: values },
      {
        setError: (name, error) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Talep reddedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Talebi reddet"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="erken-ret-gerekce" label="Ret gerekçesi" error={form.formState.errors.reason}>
        {(control) => (
          <Textarea {...control} rows={3} {...form.register('reason')} disabled={busy} />
        )}
      </FormField>
      <RootError message={form.formState.errors.root?.server?.message} />
      <div>
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          Reddet
        </Button>
      </div>
    </form>
  )
}

// --- Teslim --------------------------------------------------------------------------------------

function ReleaseLoader({ dismissalId, onDone }: { dismissalId: string; onDone: () => void }) {
  const dismissal = useEarlyDismissal(dismissalId)
  if (dismissal.error)
    return <QueryError error={dismissal.error} onRetry={() => void dismissal.refetch()} />
  const detail = dismissal.data?.data
  if (!detail) return <SummaryLoading />
  return <ReleaseForm detail={detail} onDone={onDone} />
}

function ReleaseForm({ detail, onDone }: { detail: EarlyDismissalDetail; onDone: () => void }) {
  const release = useReleaseEarlyDismissal()
  const form = useForm<ReleaseFormValues>({
    resolver: zodResolver(releaseFormSchema),
    defaultValues: releaseDefaults(detail),
  })
  const pickup = useWatch({ control: form.control, name: 'pickup' })
  const errors = form.formState.errors
  const busy = release.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await release.submit(
      {
        dismissalId: detail.id,
        version: detail.version,
        body: releaseBody(values, detail.dismissalOn),
      },
      {
        setError: (name, error) => {
          const field = releaseFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(
      `${detail.studentName ?? 'Öğrenci'} ${outcome.data.data.releasedToName ?? ''} kişisine teslim edildi.`,
    )
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Teslim formu"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">{`${detail.studentName ?? 'Öğrenci'} · ${dismissalTimeText(detail)}`}</p>
      <FormField
        id="erken-teslim-kisi"
        label="Teslim alan kişi"
        error={errors.pickup}
        description="Yalnız öğrencinin teslim yetkilileri ve talepte onaylanan kişi listelenir."
      >
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('pickup')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {detail.authorizedPickups.map((item) => (
              <NativeSelectOption key={item.guardianLinkId} value={item.guardianLinkId}>
                {authorizedPickupText(item)}
              </NativeSelectOption>
            ))}
            {detail.pickupKind === 'other' ? (
              <NativeSelectOption value={OTHER_PICKUP}>
                {`${detail.pickupName ?? '—'} · onaylanan kişi (kayıtlı değil)`}
              </NativeSelectOption>
            ) : null}
          </NativeSelect>
        )}
      </FormField>
      {pickup === OTHER_PICKUP ? (
        <FormField
          id="erken-teslim-son4"
          label="Görülen kimliğin son dört hanesi"
          error={errors.idLast4}
          description="Talepte yazılanla eşleşmezse öğrenci teslim edilmez."
        >
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              {...form.register('idLast4')}
              disabled={busy}
            />
          )}
        </FormField>
      ) : null}
      <FormField id="erken-teslim-saat" label="Çıkış saati (boşsa şimdi)" error={errors.time}>
        {(control) => <Input {...control} type="time" {...form.register('time')} disabled={busy} />}
      </FormField>
      <div className="grid gap-1">
        <div className="flex min-h-11 items-center gap-2">
          <Controller
            control={form.control}
            name="identityVerified"
            render={({ field }) => (
              <Checkbox
                id="erken-teslim-kimlik"
                checked={field.value}
                disabled={busy}
                aria-invalid={Boolean(errors.identityVerified)}
                aria-describedby={errors.identityVerified ? 'erken-teslim-kimlik-hata' : undefined}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
            )}
          />
          <Label htmlFor="erken-teslim-kimlik">Teslim alanın kimliğini gördüm</Label>
        </div>
        {errors.identityVerified?.message ? (
          <p id="erken-teslim-kimlik-hata" className="text-sm text-danger">
            {errors.identityVerified.message}
          </p>
        ) : null}
      </div>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          Teslimi kaydet
        </Button>
      </div>
    </form>
  )
}

// --- Acil talep ----------------------------------------------------------------------------------

function RequestForm({ onDone }: { onDone: (date: string) => void }) {
  const create = useCreateEarlyDismissal()
  const [defaults] = useState(() => requestDefaults(new Date()))
  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestFormSchema),
    defaultValues: defaults,
  })
  const [studentId, pickupKind, reason] = useWatch({
    control: form.control,
    name: ['studentId', 'pickupKind', 'reason'],
  })
  const options = useEarlyDismissalPickupOptions(studentId)
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(requestBody(values), {
      setError: (name, error) => {
        const field = requestFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.studentName ?? 'Öğrenci'} için acil erken çıkış açıldı.`)
    onDone(values.date)
  })
  return (
    <form
      noValidate
      aria-label="Acil erken çıkış"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <Controller
          control={form.control}
          name="studentId"
          render={({ field }) => (
            <StudentChoice
              value={field.value}
              onChange={(value) => {
                field.onChange(value)
                form.setValue('guardianLinkId', '')
              }}
              error={errors.studentId?.message}
              disabled={busy}
            />
          )}
        />
      </div>
      <FormField id="erken-gun" label="Gün" error={errors.date}>
        {(control) => <Input {...control} type="date" {...form.register('date')} disabled={busy} />}
      </FormField>
      <FormField id="erken-saat" label="Çıkış saati" error={errors.time}>
        {(control) => <Input {...control} type="time" {...form.register('time')} disabled={busy} />}
      </FormField>
      <FormField id="erken-neden" label="Neden" error={errors.reason}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('reason')}
            className="w-full"
            disabled={busy}
          >
            {EARLY_DISMISSAL_REASONS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {EARLY_DISMISSAL_REASON_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="erken-aciklama"
        label={reason === 'other' ? 'Açıklama' : 'Açıklama (isteğe bağlı)'}
        error={errors.reasonNote}
        description="Sağlık ayrıntısı yazmayın."
      >
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('reasonNote')} disabled={busy} />
        )}
      </FormField>
      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="text-sm font-medium">Teslim alacak kişi</legend>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ['guardian', 'Teslim yetkilisi'],
              ['other', 'Kayıtlı olmayan kişi'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                value={value}
                {...form.register('pickupKind')}
                disabled={busy}
                className="size-5"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {pickupKind === 'guardian' ? (
        <div className="sm:col-span-2">
          <FormField id="erken-yetkili" label="Teslim yetkilisi" error={errors.guardianLinkId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('guardianLinkId')}
                className="w-full"
                disabled={busy || studentId === '' || options.isPending}
              >
                <NativeSelectOption value="">
                  {studentId === '' ? 'Önce öğrenciyi seçin' : 'Seçin'}
                </NativeSelectOption>
                {(options.data?.data ?? []).map((item) => (
                  <NativeSelectOption key={item.guardianLinkId} value={item.guardianLinkId}>
                    {authorizedPickupText(item)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {options.isSuccess && options.data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Öğrencinin kayıtlı teslim yetkilisi yok; kayıtlı olmayan kişiyi seçin.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <FormField id="erken-kisi-ad" label="Ad soyad" error={errors.pickupName}>
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                {...form.register('pickupName')}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField
            id="erken-kisi-son4"
            label="Kimliğin son dört hanesi"
            error={errors.idLast4}
            description="Kimlik numarasının tamamını yazmayın."
          >
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                {...form.register('idLast4')}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField id="erken-kisi-yakinlik" label="Yakınlık" error={errors.relationship}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('relationship')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Seçin</NativeSelectOption>
                {PICKUP_RELATIONSHIPS.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {PICKUP_RELATIONSHIP_LABELS[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </>
      )}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          Acil kaydı aç
        </Button>
      </div>
    </form>
  )
}

/** Öğrenci: ad ya da numarayla arama (en az 2 karakter). */
function StudentChoice({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  error: string | undefined
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState('')
  const search = useDebouncedValue(query).trim()
  const students = useCoreList(
    'students',
    { q: search, pageSize: 5 },
    { enabled: search.length >= 2 },
  )
  const id = useId()
  if (value !== '')
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{`Öğrenci: ${picked}`}</span>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={disabled}
          onClick={() => onChange('')}
        >
          Öğrenciyi değiştir
        </Button>
      </div>
    )
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Öğrenci</Label>
      <Input
        id={id}
        value={query}
        placeholder="Ad ya da numara (en az 2 karakter)"
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {search.length >= 2 ? (
        <ul aria-label="Öğrenci arama sonuçları" className="grid gap-1">
          {(students.data?.rows ?? []).map(({ record }) => (
            <li key={record.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPicked(record.name)
                  setQuery('')
                  onChange(record.id)
                }}
              >
                {record.name}
                {record.number ? ` · ${record.number}` : ''}
              </Button>
            </li>
          ))}
          {students.isSuccess && students.data.rows.length === 0 ? (
            <li className="text-sm text-muted-foreground">Sonuç yok.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
