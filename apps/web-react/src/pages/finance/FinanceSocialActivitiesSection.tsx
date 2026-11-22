import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useClubs } from '@kampus/react-shared/use-finance-clubs.ts'
import {
  useApproveSocialHour,
  useArchiveSocialActivity,
  useCreateSocialActivity,
  useCreateSocialHours,
  useLoadSocialCertificate,
  useRejectSocialHour,
  useReverseSocialHour,
  useSaveSocialActivitySettings,
  useSocialActivities,
  useSocialActivitySettings,
  useSocialClass,
  useSocialClasses,
  useSocialHours,
  useSocialStudent,
  useUpdateSocialActivity,
  type SocialActivityRow,
  type SocialHourRow,
  type SocialSettings,
} from '@kampus/react-shared/use-finance-social-activities.ts'
import { useVisitorHosts } from '@kampus/react-shared/use-finance-visitors.ts'
import {
  SOCIAL_ACTIVITY_KIND_LABELS,
  SOCIAL_HOUR_SOURCE_LABELS,
  SOCIAL_PROGRESS_STATUS_LABELS,
  SOCIAL_PROGRESS_STATUSES,
  socialAcademicYearOf,
  type SocialProgressStatus,
} from '@kampus/school-core/lib/finance-social-activities.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { FormField } from '@/components/FormField.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useListState } from '@/hooks/use-list-state.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { saveBlob } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  activityCreateBody,
  activityDefaults,
  activityFormField,
  activityFormSchema,
  activityUpdateBody,
  canReverse,
  dayText,
  entryBody,
  entryFormField,
  entryFormSchema,
  hourStatusText,
  isProgressStatus,
  KIND_OPTIONS,
  minutesText,
  organizationText,
  periodText,
  progressText,
  reasonSchema,
  SCOPE_OPTIONS,
  targetsBody,
  targetsFormSchema,
  yearOptions,
  type ActivityFormValues,
  type EntryFormValues,
  type ReasonFormValues,
  type TargetsFormValues,
} from './finance-social-activity-forms.ts'

const NO_SORT: readonly string[] = []
const STAFF_QUERY = { page: 1, pageSize: 100 } as const
const CLUB_QUERY = { page: 1, pageSize: 100 } as const
const VIEW_OPTIONS = [
  { value: 'etkinlikler', label: 'Etkinlikler' },
  { value: 'onay', label: 'Onay kuyruğu' },
  { value: 'siniflar', label: 'Sınıf özeti' },
] as const
type View = (typeof VIEW_OPTIONS)[number]['value']

/**
 * Sosyal etkinlik saatleri (DOM-FIN-160; ON-170; K-535…K-537): Finans "Sosyal etkinlik saatleri"
 * sekmesi, yalnız yönetici ve yalnız okul kurumunda. "Etkinlikler" etkinliği açar, düzeltir,
 * arşivler ve seçilen sınıftan öğrencilere saat girer (onaylı). "Onay kuyruğu" öğrenci beyanlarını
 * onaylar ya da gerekçeyle reddeder. "Sınıf özeti" hedefi, lise sınıflarının durumunu, eksik
 * kalanları, öğrencinin kayıtlarını (ters kayıtla düzeltme) ve belge PDF'ini verir. Öğretmen,
 * öğrenci ve veli ekranları platform kabuğundadır; uçları hazırdır.
 */
export function FinanceSocialActivitiesSection() {
  const { session } = useAuth()
  const [view, setView] = useState<View>('etkinlikler')
  if (session?.institution?.type !== 'school')
    return (
      <EmptyState
        icon="Users"
        title="Yalnız okulda"
        description="Sosyal etkinlik saatleri lise öğrencileri içindir; dil okulunda kullanılmaz."
      />
    )
  return (
    <section aria-labelledby="sosyal-etkinlik" className="grid gap-4">
      <h2 id="sosyal-etkinlik" className="text-lg font-semibold">
        Sosyal etkinlik saatleri
      </h2>
      <LineTabs
        label="Sosyal etkinlik görünümü"
        value={view}
        options={VIEW_OPTIONS}
        onChange={setView}
      />
      {view === 'etkinlikler' ? (
        <ActivityList clubsEnabled={session.modules.clubs === true} />
      ) : null}
      {view === 'onay' ? <ApprovalQueue /> : null}
      {view === 'siniflar' ? <ClassSummary /> : null}
    </section>
  )
}

// --- Etkinlikler ---------------------------------------------------------------------------------

type ActivityTableRow = {
  id: string
  row: SocialActivityRow
  name: string
  kind: string
  period: string
  organization: string
  responsible: string
  hours: string
  pending: string
}

function ActivityList({ clubsEnabled }: { clubsEnabled: boolean }) {
  const list = useListState('sosyal-etkinlik', { urlPrefix: 'sosyal_' })
  const search = useDebouncedValue(list.state.query).trim()
  const activities = useSocialActivities({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const [editing, setEditing] = useState<SocialActivityRow | 'new' | null>(null)
  const [entering, setEntering] = useState<SocialActivityRow | null>(null)
  const archive = useArchiveSocialActivity()
  const rows = useMemo(
    () =>
      activities.data?.data.map((row): ActivityTableRow => ({
        id: row.id,
        row,
        name: row.name,
        kind: SOCIAL_ACTIVITY_KIND_LABELS[row.kind],
        period: periodText(row),
        organization: organizationText(row),
        responsible: row.responsibleName ?? '—',
        hours: minutesText(row.approvedMinutes),
        pending: String(row.pendingCount),
      })),
    [activities.data],
  )
  const columns = useMemo<DataColumn<ActivityTableRow>[]>(
    () => [
      { key: 'name', label: 'Etkinlik' },
      { key: 'kind', label: 'Tür' },
      { key: 'period', label: 'Tarih' },
      { key: 'organization', label: 'Kuruluş' },
      { key: 'responsible', label: 'Sorumlu' },
      { key: 'hours', label: 'Onaylı saat' },
      { key: 'pending', label: 'Bekleyen' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              aria-label={`${row.name} için saat gir`}
              onClick={() => setEntering(row.row)}
            >
              Saat gir
            </Button>
            <Button
              className="min-h-11"
              variant="secondary"
              aria-label={`${row.name} etkinliğini düzenle`}
              onClick={() => setEditing(row.row)}
            >
              Düzenle
            </Button>
            <Button
              className="min-h-11"
              variant="ghost"
              aria-label={`${row.name} etkinliğini arşivle`}
              disabled={archive.isPending}
              onClick={() =>
                void archive
                  .submit({ activityId: row.id, version: row.row.version })
                  .then((outcome) => {
                    if (outcome.status === 'success') notify.success(`${row.name} arşivlendi.`)
                  })
              }
            >
              Arşivle
            </Button>
          </span>
        ),
      },
    ],
    [archive],
  )
  return (
    <section aria-labelledby="sosyal-etkinlikler" className="panel rounded-card border bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h3 id="sosyal-etkinlikler" className="text-base font-semibold">
            Etkinlikler
          </h3>
          <p className="text-sm text-muted-foreground">
            Kulüp/topluluk çalışması ve gönüllülük; girilen saat onaylı açılır.
          </p>
        </div>
        <Button className="min-h-11" onClick={() => setEditing('new')}>
          Etkinlik ekle
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={activities.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['name', ACTIONS_KEY]}
        caption="Sosyal etkinlikler"
        empty="Henüz sosyal etkinlik yok."
        emptyFiltered="Bu aramayla eşleşen etkinlik yok."
        loading={activities.isPending}
        fetching={activities.isFetching && !activities.isPending}
        error={
          activities.error ? (
            <QueryError error={activities.error} onRetry={() => void activities.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title={editing === 'new' ? 'Etkinlik ekle' : 'Etkinliği düzenle'}
      >
        {editing === null ? null : (
          <ActivityForm
            activity={editing === 'new' ? undefined : editing}
            clubsEnabled={clubsEnabled}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal
        open={entering !== null}
        onOpenChange={(open) => (open ? undefined : setEntering(null))}
        title="Saat gir"
      >
        {entering === null ? null : (
          <EntryForm activity={entering} onDone={() => setEntering(null)} />
        )}
      </Modal>
    </section>
  )
}

function ActivityForm({
  activity,
  clubsEnabled,
  onDone,
}: {
  activity?: SocialActivityRow
  clubsEnabled: boolean
  onDone: () => void
}) {
  const staff = useVisitorHosts(STAFF_QUERY)
  const clubs = useClubs(CLUB_QUERY, clubsEnabled)
  const create = useCreateSocialActivity()
  const update = useUpdateSocialActivity()
  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: activityDefaults(activity, dayKey()),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const kind = useWatch({ control: form.control, name: 'kind' })
  const scope = useWatch({ control: form.control, name: 'organizationScope' })
  const responsibles = (staff.data?.data ?? []).filter(
    (person) => (person.role === 'ogretmen' || person.role === 'yonetici') && person.active,
  )
  const setServerError = (name: string, error: { type: string; message: string }) => {
    const field = activityFormField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (activity === undefined) {
      const outcome = await create.submit(activityCreateBody(values), { setError: setServerError })
      if (outcome.status !== 'success') return
      notify.success(`${outcome.data.data.name} açıldı.`)
      onDone()
      return
    }
    const body = activityUpdateBody(values, activity)
    if (body === null) {
      onDone()
      return
    }
    const outcome = await update.submit(
      { activityId: activity.id, version: activity.version, body },
      { setError: setServerError },
    )
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.name} güncellendi.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label={activity === undefined ? 'Etkinlik ekle' : 'Etkinliği düzenle'}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="sosyal-ad" label="Etkinlik adı" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
      </div>
      <FormField id="sosyal-tur" label="Tür" error={errors.kind}>
        {(control) => (
          <NativeSelect {...control} {...form.register('kind')} className="w-full" disabled={busy}>
            {KIND_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="sosyal-sorumlu"
        label="Sorumlu öğretmen"
        error={errors.responsibleMembershipId}
      >
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('responsibleMembershipId')}
            className="w-full"
            disabled={busy || staff.isPending}
          >
            <NativeSelectOption value="">Sorumlu seçin</NativeSelectOption>
            {responsibles.map((person) => (
              <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                {person.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="sosyal-baslangic" label="Başlangıç günü" error={errors.startDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="sosyal-bitis"
        label="Bitiş günü"
        description="Boş bırakılırsa etkinlik süren sayılır."
        error={errors.endDate}
      >
        {(control) => (
          <Input {...control} type="date" {...form.register('endDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="sosyal-yer" label="Yer" error={errors.location}>
        {(control) => <Input {...control} {...form.register('location')} disabled={busy} />}
      </FormField>
      <FormField id="sosyal-kapsam" label="Kurum içi / dışı" error={errors.organizationScope}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('organizationScope')}
            className="w-full"
            disabled={busy}
          >
            {SCOPE_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="sosyal-kurulus"
        label="Kuruluş adı"
        description={scope === 'external' ? 'Kurum dışında zorunlu.' : 'İsteğe bağlı.'}
        error={errors.organizationName}
      >
        {(control) => <Input {...control} {...form.register('organizationName')} disabled={busy} />}
      </FormField>
      {kind === 'club' && clubsEnabled ? (
        <FormField id="sosyal-kulup" label="Bağlı kulüp" error={errors.clubId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('clubId')}
              className="w-full"
              disabled={busy || clubs.isPending}
            >
              <NativeSelectOption value="">Kulüp bağı yok</NativeSelectOption>
              {(clubs.data?.data ?? []).map((club) => (
                <NativeSelectOption key={club.id} value={club.id}>
                  {club.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          {activity === undefined ? 'Etkinliği kaydet' : 'Değişiklikleri kaydet'}
        </Button>
      </div>
    </form>
  )
}

/** Saat girişi: sınıf seçilir, öğrenciler işaretlenir; hepsine aynı gün ve saat yazılır. */
function EntryForm({ activity, onDone }: { activity: SocialActivityRow; onDone: () => void }) {
  const academicYear = socialAcademicYearOf(dayKey())
  const classes = useSocialClasses(academicYear)
  const [classId, setClassId] = useState('')
  const klass = useSocialClass(classId, { academicYear })
  const create = useCreateSocialHours()
  const today = dayKey()
  const form = useForm<EntryFormValues>({
    resolver: zodResolver(entryFormSchema),
    defaultValues: {
      activityDate:
        activity.endDate !== null && activity.endDate < today ? activity.endDate : today,
      hours: '',
      studentIds: [],
      note: '',
    },
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const picked = useWatch({ control: form.control, name: 'studentIds' })
  const toggle = (studentId: string, checked: boolean) =>
    form.setValue(
      'studentIds',
      checked ? [...picked, studentId] : picked.filter((id) => id !== studentId),
      { shouldValidate: form.formState.isSubmitted },
    )
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(
      { activityId: activity.id, body: entryBody(values) },
      {
        setError: (name, error) => {
          const field = entryFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`${String(outcome.data.data.length)} öğrenciye saat yazıldı.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Saat gir"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted-foreground">{`${activity.name} · ${periodText(activity)}`}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="sosyal-saat-gun" label="Çalışma günü" error={errors.activityDate}>
          {(control) => (
            <Input
              {...control}
              type="date"
              min={activity.startDate}
              max={activity.endDate !== null && activity.endDate < today ? activity.endDate : today}
              {...form.register('activityDate')}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="sosyal-saat"
          label="Saat"
          description="Yarım saat adımıyla, ör. 2,5"
          error={errors.hours}
        >
          {(control) => (
            <Input {...control} inputMode="decimal" {...form.register('hours')} disabled={busy} />
          )}
        </FormField>
      </div>
      <FormField id="sosyal-saat-sinif" label="Sınıf">
        {(control) => (
          <NativeSelect
            {...control}
            className="w-full"
            value={classId}
            disabled={busy || classes.isPending}
            onChange={(event) => setClassId(event.target.value)}
          >
            <NativeSelectOption value="">Sınıf seçin</NativeSelectOption>
            {(classes.data?.data ?? []).map((item) => (
              <NativeSelectOption key={item.classId} value={item.classId}>
                {item.className}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {classes.error ? (
        <QueryError error={classes.error} onRetry={() => void classes.refetch()} />
      ) : null}
      <fieldset className="grid gap-1" aria-describedby="sosyal-saat-ogrenci-hata">
        <legend className="text-sm font-medium">{`Öğrenciler (${String(picked.length)} seçili)`}</legend>
        {classId === '' ? (
          <p className="text-sm text-muted-foreground">Öğrencileri listelemek için sınıf seçin.</p>
        ) : klass.data ? (
          klass.data.data.students.map((row) => (
            <label key={row.studentId} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={picked.includes(row.studentId)}
                disabled={busy}
                onChange={(event) => toggle(row.studentId, event.target.checked)}
              />
              {`${row.studentName} · ${minutesText(row.totalMinutes)}`}
            </label>
          ))
        ) : (
          <SummaryLoading />
        )}
        <RootError message={errors.studentIds?.message} />
      </fieldset>
      <FormField id="sosyal-saat-not" label="Yapılan çalışma (isteğe bağlı)" error={errors.note}>
        {(control) => <Textarea {...control} rows={2} {...form.register('note')} disabled={busy} />}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Saatleri kaydet
      </Button>
    </form>
  )
}

// --- Onay kuyruğu --------------------------------------------------------------------------------

type HourTableRow = {
  id: string
  row: SocialHourRow
  student: string
  activity: string
  day: string
  hours: string
  note: string
}

function ApprovalQueue() {
  const list = useListState('sosyal-onay', { urlPrefix: 'sosyalonay_' })
  const hours = useSocialHours({
    page: list.state.page,
    pageSize: list.state.pageSize,
    status: 'pending',
  })
  const approve = useApproveSocialHour()
  const [rejecting, setRejecting] = useState<SocialHourRow | null>(null)
  const rows = useMemo(
    () =>
      hours.data?.data.map((row): HourTableRow => ({
        id: row.id,
        row,
        student: row.className === null ? row.studentName : `${row.studentName} (${row.className})`,
        activity: row.activityName,
        day: dayText(row.activityDate),
        hours: minutesText(row.minutes),
        note: row.note ?? '—',
      })),
    [hours.data],
  )
  const columns = useMemo<DataColumn<HourTableRow>[]>(
    () => [
      { key: 'student', label: 'Öğrenci' },
      { key: 'activity', label: 'Etkinlik' },
      { key: 'day', label: 'Gün' },
      { key: 'hours', label: 'Saat' },
      { key: 'note', label: 'Açıklama' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              aria-label={`${row.row.studentName} beyanını onayla`}
              disabled={approve.isPending}
              onClick={() =>
                void approve
                  .submit({ entryId: row.id, version: row.row.version })
                  .then((outcome) => {
                    if (outcome.status === 'success')
                      notify.success(`${row.row.studentName} için ${row.hours} onaylandı.`)
                  })
              }
            >
              Onayla
            </Button>
            <Button
              className="min-h-11"
              variant="ghost"
              aria-label={`${row.row.studentName} beyanını reddet`}
              onClick={() => setRejecting(row.row)}
            >
              Reddet
            </Button>
          </span>
        ),
      },
    ],
    [approve],
  )
  return (
    <section aria-labelledby="sosyal-onay" className="panel rounded-card border bg-surface">
      <header className="grid gap-1 px-6 pt-6 pb-2">
        <h3 id="sosyal-onay" className="text-base font-semibold">
          Onay kuyruğu
        </h3>
        <p className="text-sm text-muted-foreground">
          Öğrenci beyanları; onaylanan saat değişmez, reddin gerekçesini öğrenci ve veli görür.
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={hours.data?.meta.total ?? 0}
        sortable={NO_SORT}
        search={false}
        columns={columns}
        mobileColumns={['student', ACTIONS_KEY]}
        caption="Onay bekleyen beyanlar"
        empty="Onay bekleyen beyan yok."
        emptyFiltered="Onay bekleyen beyan yok."
        loading={hours.isPending}
        fetching={hours.isFetching && !hours.isPending}
        error={
          hours.error ? (
            <QueryError error={hours.error} onRetry={() => void hours.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={rejecting !== null}
        onOpenChange={(open) => (open ? undefined : setRejecting(null))}
        title="Beyanı reddet"
      >
        {rejecting === null ? null : (
          <ReasonForm
            label="Ret gerekçesi"
            submitLabel="Reddet"
            row={rejecting}
            mode="reject"
            onDone={() => setRejecting(null)}
          />
        )}
      </Modal>
    </section>
  )
}

function ReasonForm({
  label,
  submitLabel,
  row,
  mode,
  onDone,
}: {
  label: string
  submitLabel: string
  row: SocialHourRow
  mode: 'reject' | 'reverse'
  onDone: () => void
}) {
  const reject = useRejectSocialHour()
  const reverse = useReverseSocialHour()
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: '' },
  })
  const busy = reject.isPending || reverse.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const input = { entryId: row.id, version: row.version, reason: values.reason.trim() }
    const options = {
      setError: (_name: string, error: { type: string; message: string }) =>
        form.setError('reason', error, { shouldFocus: true }),
    }
    const outcome =
      mode === 'reject' ? await reject.submit(input, options) : await reverse.submit(input, options)
    if (outcome.status !== 'success') return
    notify.success(
      mode === 'reject'
        ? `${row.studentName} beyanı reddedildi.`
        : `${minutesText(row.minutes)} ters kayıtla düzeltildi.`,
    )
    onDone()
  })
  return (
    <form
      noValidate
      aria-label={label}
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted-foreground">
        {`${row.studentName} · ${row.activityName} · ${dayText(row.activityDate)} · ${minutesText(row.minutes)}`}
      </p>
      <FormField id={`sosyal-gerekce-${mode}`} label={label} error={form.formState.errors.reason}>
        {(control) => (
          <Textarea {...control} rows={3} {...form.register('reason')} disabled={busy} />
        )}
      </FormField>
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        {submitLabel}
      </Button>
    </form>
  )
}

// --- Sınıf özeti ---------------------------------------------------------------------------------

function ClassSummary() {
  const { session } = useAuth()
  const currentYear = socialAcademicYearOf(dayKey())
  const [year, setYear] = useState(currentYear)
  const [classId, setClassId] = useState('')
  const [status, setStatus] = useState<SocialProgressStatus | ''>('')
  const settings = useSocialActivitySettings()
  const classes = useSocialClasses(year)
  const klass = useSocialClass(classId, {
    academicYear: year,
    ...(status === '' ? {} : { status }),
  })
  const panel = useDetailPanel('sosyal_ogrenci')
  const certificate = useLoadSocialCertificate()
  const [printing, setPrinting] = useState('')

  async function download(studentId: string) {
    setPrinting(studentId)
    try {
      const outcome = await certificate.submit({ studentId })
      if (outcome.status !== 'success') return
      const data = outcome.data.data
      const [{ renderPdf }, template] = await Promise.all([
        import('@/lib/pdf/render.ts'),
        import('@/lib/pdf/templates/finance-social-activity-certificate.ts'),
      ])
      const { blob } = await renderPdf((measurer) =>
        template.socialActivityCertificateDocument(measurer, data, {
          institution: session?.institution.name ?? 'Kampüs',
          generatedAt: new Date(),
        }),
      )
      saveBlob(blob, template.socialCertificateFilename(data))
      notify.success(`${data.studentName} için sosyal etkinlik belgesi indirildi.`)
    } catch (error) {
      console.error('[kampus]', 'pdf', error)
      notify.error('Sosyal etkinlik belgesi hazırlanamadı. Lütfen tekrar deneyin.')
    } finally {
      setPrinting('')
    }
  }

  return (
    <div className="grid gap-4">
      {settings.error ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.data ? (
        <TargetsForm key={settings.data.data.version} settings={settings.data.data} />
      ) : (
        <SummaryLoading />
      )}
      <section aria-labelledby="sosyal-siniflar" className="grid gap-3">
        <h3 id="sosyal-siniflar" className="text-base font-semibold">
          Sınıf özeti
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField id="sosyal-yil" label="Öğretim yılı">
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={String(year)}
                onChange={(event) => setYear(Number(event.target.value))}
              >
                {yearOptions(currentYear).map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="sosyal-sinif" label="Sınıf">
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={classId}
                disabled={classes.isPending}
                onChange={(event) => setClassId(event.target.value)}
              >
                <NativeSelectOption value="">Sınıf seçin</NativeSelectOption>
                {(classes.data?.data ?? []).map((item) => (
                  <NativeSelectOption key={item.classId} value={item.classId}>
                    {`${item.className} · ${String(item.behindCount)} eksik`}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="sosyal-durum" label="Durum">
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={status}
                onChange={(event) => {
                  const value = event.target.value
                  setStatus(isProgressStatus(value) ? value : '')
                }}
              >
                <NativeSelectOption value="">Tümü</NativeSelectOption>
                {SOCIAL_PROGRESS_STATUSES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {SOCIAL_PROGRESS_STATUS_LABELS[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
        {classes.error ? (
          <QueryError error={classes.error} onRetry={() => void classes.refetch()} />
        ) : null}
        {classes.data?.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kurumda lise (9–12) sınıfı yok.</p>
        ) : null}
        {classId === '' ? null : klass.error ? (
          <QueryError error={klass.error} onRetry={() => void klass.refetch()} />
        ) : klass.data ? (
          <ul aria-label={`${klass.data.data.className} öğrencileri`} className="grid gap-2">
            {klass.data.data.students.length === 0 ? (
              <li className="text-sm text-muted-foreground">Bu süzgece uyan öğrenci yok.</li>
            ) : null}
            {klass.data.data.students.map((row) => (
              <li
                key={row.studentId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border p-3"
              >
                <span className="grid gap-1 text-sm">
                  <span className="font-medium">{row.studentName}</span>
                  <span className="text-muted-foreground">
                    {`${SOCIAL_PROGRESS_STATUS_LABELS[row.status]} · toplam ${progressText(row.totalMinutes, row.totalTargetHours)} · bu yıl ${progressText(row.yearMinutes, row.yearlyTargetHours)}${row.pendingCount > 0 ? ` · ${String(row.pendingCount)} bekleyen` : ''}`}
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    aria-label={`${row.studentName} kayıtlarını aç`}
                    onClick={() => panel.open(row.studentId)}
                  >
                    Kayıtlar
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    aria-label={`${row.studentName} sosyal etkinlik belgesini indir`}
                    disabled={printing !== ''}
                    aria-busy={printing === row.studentId || undefined}
                    onClick={() => void download(row.studentId)}
                  >
                    Belge PDF
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <SummaryLoading />
        )}
      </section>
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Sosyal etkinlik kayıtları"
      >
        {panel.selectedId ? <StudentEntries studentId={panel.selectedId} year={year} /> : null}
      </SidePanel>
    </div>
  )
}

function TargetsForm({ settings }: { settings: SocialSettings }) {
  const save = useSaveSocialActivitySettings()
  const form = useForm<TargetsFormValues>({
    resolver: zodResolver(targetsFormSchema),
    defaultValues: {
      totalTargetHours: String(settings.totalTargetHours),
      yearlyTargetHours:
        settings.yearlyTargetHours === null ? '' : String(settings.yearlyTargetHours),
    },
  })
  const errors = form.formState.errors
  const busy = save.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await save.submit(
      { version: settings.version, body: targetsBody(values) },
      {
        setError: (name, error) => {
          if (name === 'totalTargetHours' || name === 'yearlyTargetHours')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success('Sosyal etkinlik hedefleri kaydedildi.')
  })
  return (
    <form
      noValidate
      aria-label="Sosyal etkinlik hedefleri"
      className="grid gap-3 rounded-card border p-4 sm:grid-cols-3 sm:items-end"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="sosyal-hedef-toplam"
        label="Toplam hedef (saat)"
        description={settings.isDefault ? 'Mevzuat önerisi: ortaöğrenim boyunca 40.' : undefined}
        error={errors.totalTargetHours}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            {...form.register('totalTargetHours')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="sosyal-hedef-yillik"
        label="Yıllık hedef (saat)"
        description="Boş bırakılırsa yıllık hedef yok."
        error={errors.yearlyTargetHours}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            {...form.register('yearlyTargetHours')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="grid gap-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          Hedefleri kaydet
        </Button>
      </div>
    </form>
  )
}

function StudentEntries({ studentId, year }: { studentId: string; year: number }) {
  const student = useSocialStudent(studentId, year)
  const [reversing, setReversing] = useState<SocialHourRow | null>(null)
  if (student.error)
    return <QueryError error={student.error} onRetry={() => void student.refetch()} />
  const data = student.data?.data
  if (!data) return <SummaryLoading />
  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Öğrenci</dt>
        <dd>{data.studentName}</dd>
        <dt className="text-muted-foreground">Sınıf</dt>
        <dd>{data.className ?? '—'}</dd>
        <dt className="text-muted-foreground">Durum</dt>
        <dd>{SOCIAL_PROGRESS_STATUS_LABELS[data.progress.status]}</dd>
        <dt className="text-muted-foreground">Toplam onaylı</dt>
        <dd>{progressText(data.progress.totalMinutes, data.progress.totalTargetHours)}</dd>
        <dt className="text-muted-foreground">Bu yıl</dt>
        <dd>{progressText(data.progress.yearMinutes, data.progress.yearlyTargetHours)}</dd>
      </dl>
      {data.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Kayıt yok.</p>
      ) : (
        <ul aria-label="Saat kayıtları" className="grid gap-2 text-sm">
          {data.entries.map((row) => (
            <li key={row.id} className="grid gap-1 border-b pb-2">
              <span className="font-medium">{`${dayText(row.activityDate)} · ${row.activityName} · ${minutesText(row.minutes)}`}</span>
              <span className="text-muted-foreground">
                {`${hourStatusText(row)} · ${SOCIAL_HOUR_SOURCE_LABELS[row.source]}${row.rejectionReason === null ? '' : ` · ${row.rejectionReason}`}${row.kind === 'reversal' && row.note !== null ? ` · ${row.note}` : ''}`}
              </span>
              {canReverse(row) ? (
                <div>
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    aria-label={`${dayText(row.activityDate)} ${row.activityName} kaydını düzelt`}
                    onClick={() => setReversing(row)}
                  >
                    Ters kayıtla düzelt
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={reversing !== null}
        onOpenChange={(open) => (open ? undefined : setReversing(null))}
        title="Ters kayıtla düzelt"
      >
        {reversing === null ? null : (
          <ReasonForm
            label="Düzeltme gerekçesi"
            submitLabel="Ters kaydı yaz"
            row={reversing}
            mode="reverse"
            onDone={() => setReversing(null)}
          />
        )}
      </Modal>
    </div>
  )
}
