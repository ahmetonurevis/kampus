import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import {
  useCreateDepartmentDecision,
  useCreateDepartmentMeeting,
  useDepartmentDecisions,
  useDepartmentMeeting,
  useDepartmentMeetings,
  useDepartmentMeetingSubjects,
  useFinalizeDepartmentMeeting,
  useFollowUpDepartmentDecision,
  useRemoveDepartmentDecision,
  useUpdateDepartmentDecision,
  useUpdateDepartmentMeeting,
  type DepartmentMeeting,
  type DepartmentMeetingDecision,
  type DepartmentMeetingRow,
} from '@kampus/react-shared/use-finance-department-meetings.ts'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  DEPARTMENT_DECISION_STATUS_LABELS,
  DEPARTMENT_DECISION_STATUSES,
  DEPARTMENT_MEETING_ATTENDANCE,
  DEPARTMENT_MEETING_ATTENDANCE_LABELS,
  DEPARTMENT_MEETING_KIND_LABELS,
  DEPARTMENT_MEETING_KINDS,
  DEPARTMENT_MEETING_STATUS_LABELS,
  DEPARTMENT_MEETING_STATUSES,
  type DepartmentMeetingKind,
  type DepartmentMeetingStatus,
} from '@kampus/school-core/lib/finance-department-meetings.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDepartmentMeetingMinutesPdf } from '@/hooks/use-finance-department-meeting-pdf.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { DEPARTMENT_MEETING_MINUTES_TITLE } from '@/lib/pdf/templates/finance-department-meeting-minutes.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import {
  attendanceText,
  decisionBody,
  decisionCountText,
  decisionFormField,
  decisionFormFrom,
  decisionFormSchema,
  emptyDecisionForm,
  emptyMeetingForm,
  followUpFormSchema,
  meetingBody,
  meetingFormField,
  meetingFormFrom,
  meetingFormSchema,
  meetingStaffOptions,
  type AttendanceChoice,
  type DecisionFormValues,
  type FollowUpFormValues,
  type MeetingFormValues,
  type MeetingStaffOption,
} from './finance-department-meeting-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['date', 'subject', 'status']
const FILTERS = [
  {
    key: 'kind',
    label: 'Tür',
    type: 'select' as const,
    options: DEPARTMENT_MEETING_KINDS.map((value) => ({
      value,
      label: DEPARTMENT_MEETING_KIND_LABELS[value],
    })),
  },
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: DEPARTMENT_MEETING_STATUSES.map((value) => ({
      value,
      label: DEPARTMENT_MEETING_STATUS_LABELS[value],
    })),
  },
]
const STATUS_TONES = { draft: 'amber', finalized: 'green' } as const
const DECISION_TONES = { open: 'purple', completed: 'green', cancelled: 'gray' } as const
const STAFF_PAGE = { page: 1, pageSize: 100 } as const
const VIEW_OPTIONS = [
  { value: 'meetings', label: 'Tutanaklar' },
  { value: 'overdue', label: 'Termini geçmiş kararlar' },
] as const
type View = (typeof VIEW_OPTIONS)[number]['value']

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isKind = (value: string | null): value is DepartmentMeetingKind =>
  (DEPARTMENT_MEETING_KINDS as readonly (string | null)[]).includes(value)
const isStatus = (value: string | null): value is DepartmentMeetingStatus =>
  (DEPARTMENT_MEETING_STATUSES as readonly (string | null)[]).includes(value)
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Personel seçenekleri (zümre katılımcısı, başkan, sorumlu). */
function useMeetingStaff(listed: ReadonlySet<string>) {
  const staff = useCertificateStaff(STAFF_PAGE)
  const options = useMemo(
    () => meetingStaffOptions(staff.data?.data ?? [], listed),
    [staff.data, listed],
  )
  return { options, query: staff }
}

/**
 * Zümre toplantısı tutanağı (DOM-FIN-132; ON-217): Finans "Zümre toplantıları" sekmesi, yalnız
 * yönetici (K-451). Taslak tutanak açılır, gündem, katılım ve kararlar yazılır; imza günüyle
 * kesinleşen tutanakta yalnız karar takibi değişir (K-453). Tutanak PDF'i web'de üretilir.
 */
export function FinanceDepartmentMeetingsSection() {
  const [view, setView] = useState<View>('meetings')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <section
      aria-labelledby="zumre-toplantilari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="zumre-toplantilari" className="text-lg font-semibold">
            Zümre toplantıları
          </h2>
          <p className="text-sm text-muted-foreground">
            Zümre öğretmenler kurulu tutanakları: gündem, katılım, karar, sorumlu ve termin. Tutanak
            imza günüyle kesinleşir; sonra yalnız kararların takibi yazılır.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Yeni tutanak</Button>
      </header>
      <div className="px-6">
        <LineTabs
          label="Zümre görünümü"
          value={view}
          options={VIEW_OPTIONS}
          onChange={(next) => setView(next)}
        />
      </div>
      {view === 'meetings' ? (
        <MeetingList onOpen={setOpenId} />
      ) : (
        <OverdueDecisions onOpen={setOpenId} />
      )}
      <Modal
        open={creating}
        onOpenChange={(open) => (open ? undefined : setCreating(false))}
        title="Yeni zümre tutanağı"
        description="Başkan katılımcılar arasında “katıldı” olarak işaretlenir. Kararlar tutanak açıldıktan sonra eklenir."
        size="wide"
      >
        {creating ? (
          <MeetingForm
            meeting={null}
            onDone={(id) => {
              setCreating(false)
              if (id !== null) setOpenId(id)
            }}
          />
        ) : null}
      </Modal>
      <Modal
        open={openId !== null}
        onOpenChange={(open) => (open ? undefined : setOpenId(null))}
        title="Zümre tutanağı"
        size="wide"
      >
        {openId !== null ? <MeetingDetail meetingId={openId} /> : null}
      </Modal>
    </section>
  )
}

type Row = {
  id: string
  date: string
  subject: string
  kind: string
  chair: string
  attendance: string
  decisions: string
  meeting: DepartmentMeetingRow
}

function MeetingList({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('zumre-toplantilari', { urlPrefix: 'zt_' })
  const search = useDebouncedValue(list.state.query).trim()
  const kind = text(list.state.filters.kind)
  const status = text(list.state.filters.status)
  const meetings = useDepartmentMeetings({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isKind(kind) ? { kind } : {}),
    ...(isStatus(status) ? { status } : {}),
  })
  const rows = useMemo(
    () =>
      meetings.data?.data.map((item): Row => ({
        id: item.id,
        date: dayText(item.meetingDate),
        subject: item.subjectName,
        kind: DEPARTMENT_MEETING_KIND_LABELS[item.kind],
        chair: item.chairName,
        attendance: attendanceText(item),
        decisions: decisionCountText(item),
        meeting: item,
      })),
    [meetings.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'date', label: 'Gün' },
      { key: 'subject', label: 'Zümre' },
      { key: 'kind', label: 'Tür' },
      { key: 'chair', label: 'Başkan' },
      { key: 'attendance', label: 'Katılım' },
      { key: 'decisions', label: 'Kararlar' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={DEPARTMENT_MEETING_STATUS_LABELS[row.meeting.status]}
            tone={STATUS_TONES[row.meeting.status]}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label={`${row.subject} ${row.date} tutanağını aç`}
              onClick={() => onOpen(row.id)}
            >
              Aç
            </Button>
            <PdfDialogButton
              label="PDF"
              title={DEPARTMENT_MEETING_MINUTES_TITLE}
              id={row.id}
              usePdf={useDepartmentMeetingMinutesPdf}
              accessibleName={`${row.subject} ${row.date} tutanak PDF`}
            />
          </span>
        ),
      },
    ],
    [onOpen],
  )
  return (
    <ServerDataTable
      list={list}
      rows={rows}
      total={meetings.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      filters={FILTERS}
      mobileColumns={MOBILE}
      caption="Zümre toplantısı tutanakları"
      empty="Henüz zümre tutanağı yok."
      emptyFiltered="Bu seçimle eşleşen tutanak yok."
      loading={meetings.isPending}
      fetching={meetings.isFetching && !meetings.isPending}
      error={
        meetings.error ? (
          <QueryError error={meetings.error} onRetry={() => void meetings.refetch()} />
        ) : undefined
      }
    />
  )
}

type OverdueRow = {
  id: string
  due: string
  late: string
  subject: string
  agenda: string
  decision: string
  responsible: string
  meetingId: string
}

function OverdueDecisions({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('zumre-geciken-kararlar', { urlPrefix: 'zk_' })
  const decisions = useDepartmentDecisions({
    page: list.state.page,
    pageSize: list.state.pageSize,
    overdue: 'true',
  })
  const rows = useMemo(
    () =>
      decisions.data?.data.map((item): OverdueRow => ({
        id: item.id,
        due: item.dueDate === null ? '—' : dayText(item.dueDate),
        late: `${String(item.overdueDays)} gün`,
        subject: `${item.subjectName} · ${dayText(item.meetingDate)}`,
        agenda: item.agendaTitle,
        decision: item.text,
        responsible: item.responsibleName,
        meetingId: item.meetingId,
      })),
    [decisions.data],
  )
  const columns = useMemo<DataColumn<OverdueRow>[]>(
    () => [
      { key: 'due', label: 'Termin' },
      { key: 'late', label: 'Gecikme' },
      { key: 'subject', label: 'Toplantı' },
      { key: 'agenda', label: 'Gündem maddesi' },
      { key: 'decision', label: 'Karar' },
      { key: 'responsible', label: 'Sorumlu' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="outline"
            aria-label={`${row.decision} kararının tutanağını aç`}
            onClick={() => onOpen(row.meetingId)}
          >
            Tutanağı aç
          </Button>
        ),
      },
    ],
    [onOpen],
  )
  return (
    <ServerDataTable
      list={list}
      rows={rows}
      total={decisions.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      mobileColumns={['due', 'decision', 'responsible']}
      caption="Termini geçmiş açık kararlar"
      empty="Termini geçmiş açık karar yok."
      emptyFiltered="Termini geçmiş açık karar yok."
      loading={decisions.isPending}
      fetching={decisions.isFetching && !decisions.isPending}
      error={
        decisions.error ? (
          <QueryError error={decisions.error} onRetry={() => void decisions.refetch()} />
        ) : undefined
      }
    />
  )
}

function MeetingForm({
  meeting,
  onDone,
}: {
  meeting: DepartmentMeeting | null
  onDone: (createdId: string | null) => void
}) {
  const create = useCreateDepartmentMeeting()
  const update = useUpdateDepartmentMeeting()
  const subjects = useDepartmentMeetingSubjects()
  const listed = useMemo(
    () =>
      new Set(
        meeting === null
          ? []
          : [meeting.chairMembershipId, ...meeting.attendees.map((row) => row.membershipId)],
      ),
    [meeting],
  )
  const staff = useMeetingStaff(listed)
  const form = useForm<MeetingFormValues>({
    resolver: zodResolver(meetingFormSchema),
    defaultValues: meeting === null ? emptyMeetingForm(dayKey()) : meetingFormFrom(meeting),
  })
  const agenda = useFieldArray({ control: form.control, name: 'agenda' })
  const attendance = useWatch({ control: form.control, name: 'attendance' })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const setChoice = (membershipId: string, choice: AttendanceChoice) =>
    form.setValue('attendance', { ...attendance, [membershipId]: choice }, { shouldDirty: true })

  const onSubmit = form.handleSubmit(async (values) => {
    const setError = (name: string, error: { message: string }) => {
      const field = meetingFormField(name.split('.'))
      if (field) form.setError(field as keyof MeetingFormValues, error, { shouldFocus: true })
      else form.setError('root.server', error)
    }
    const body = meetingBody(values)
    if (meeting === null) {
      const outcome = await create.submit(body, { setError })
      if (outcome.status === 'success') {
        notify.success('Zümre tutanağı taslak olarak açıldı.')
        onDone(outcome.data.data.id)
      }
      return
    }
    const outcome = await update.submit(
      { meetingId: meeting.id, version: meeting.version, body },
      { setError },
    )
    if (outcome.status === 'success') {
      notify.success('Tutanak güncellendi.')
      onDone(null)
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict')
      onDone(null)
  })

  const agendaError = errors.agenda?.message ?? errors.agenda?.root?.message
  // Katılım bir kayıt (üyelik → seçim) olduğundan hata tipi alan haritasıdır; liste hatası
  // `attendance` kökünde mesaj taşır.
  const attendanceMessage = (errors.attendance as { message?: unknown } | undefined)?.message
  const attendanceError = typeof attendanceMessage === 'string' ? attendanceMessage : undefined
  return (
    <form
      noValidate
      aria-label="Zümre tutanağı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="zt-zumre" label="Zümre (ders)" error={errors.subjectId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('subjectId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {(subjects.data?.data ?? []).map((subject) => (
              <NativeSelectOption key={subject.id} value={subject.id}>
                {subject.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="zt-tur" label="Toplantı türü" error={errors.kind}>
        {(control) => (
          <NativeSelect {...control} {...form.register('kind')} className="w-full" disabled={busy}>
            {DEPARTMENT_MEETING_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {DEPARTMENT_MEETING_KIND_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="zt-gun" label="Toplantı günü" error={errors.meetingDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('meetingDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="zt-yer" label="Yer" error={errors.location}>
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('location')} disabled={busy} />
        )}
      </FormField>
      <FormField id="zt-baskan" label="Toplantı başkanı" error={errors.chairMembershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('chairMembershipId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {staff.options.map((person) => (
              <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                {person.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>

      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="text-sm font-medium">Gündem maddeleri (görüşülme sırasıyla)</legend>
        {agenda.fields.map((field, index) => (
          <div key={field.id} className="grid gap-2 border-t pt-2 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2">
              <FormField
                id={`zt-madde-${String(index)}`}
                label={`${String(index + 1)}. madde`}
                error={errors.agenda?.[index]?.title}
              >
                {(control) => (
                  <Input
                    {...control}
                    autoComplete="off"
                    {...form.register(`agenda.${index}.title`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField
                id={`zt-gorusme-${String(index)}`}
                label={`${String(index + 1)}. madde görüşme özeti (isteğe bağlı)`}
                error={errors.agenda?.[index]?.discussion}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    rows={2}
                    {...form.register(`agenda.${index}.discussion`)}
                    disabled={busy}
                  />
                )}
              </FormField>
            </div>
            <span className="flex flex-wrap items-start gap-1 sm:flex-col">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`${String(index + 1)}. maddeyi yukarı taşı`}
                disabled={busy || index === 0}
                onClick={() => agenda.move(index, index - 1)}
              >
                Yukarı
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`${String(index + 1)}. maddeyi aşağı taşı`}
                disabled={busy || index === agenda.fields.length - 1}
                onClick={() => agenda.move(index, index + 1)}
              >
                Aşağı
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`${String(index + 1)}. maddeyi sil`}
                disabled={busy || agenda.fields.length === 1}
                onClick={() => agenda.remove(index)}
              >
                Sil
              </Button>
            </span>
          </div>
        ))}
        {agendaError ? (
          <p role="alert" className="text-sm text-danger">
            {agendaError}
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => agenda.append({ id: '', title: '', discussion: '' })}
          >
            Madde ekle
          </Button>
        </div>
      </fieldset>

      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="text-sm font-medium">Katılım</legend>
        {staff.query.error ? (
          <QueryError error={staff.query.error} onRetry={() => void staff.query.refetch()} />
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {staff.options.map((person: MeetingStaffOption) => (
            <div key={person.membershipId} className="grid gap-1">
              <Label htmlFor={`zt-katilim-${person.membershipId}`}>
                {person.name}
                {person.active ? '' : ' (ayrıldı)'}
              </Label>
              <NativeSelect
                id={`zt-katilim-${person.membershipId}`}
                className="w-full"
                value={attendance[person.membershipId] ?? ''}
                disabled={busy}
                onChange={(event) =>
                  setChoice(person.membershipId, event.target.value as AttendanceChoice)
                }
              >
                <NativeSelectOption value="">Listede değil</NativeSelectOption>
                {DEPARTMENT_MEETING_ATTENDANCE.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {DEPARTMENT_MEETING_ATTENDANCE_LABELS[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          ))}
        </div>
        {attendanceError ? (
          <p role="alert" className="text-sm text-danger">
            {attendanceError}
          </p>
        ) : null}
      </fieldset>
      <div className="grid gap-2 sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {meeting === null ? 'Tutanağı aç' : 'Kaydet'}
          </Button>
        </div>
      </div>
    </form>
  )
}

function MeetingDetail({ meetingId }: { meetingId: string }) {
  const meeting = useDepartmentMeeting(meetingId)
  const [editing, setEditing] = useState(false)
  if (meeting.error)
    return <QueryError error={meeting.error} onRetry={() => void meeting.refetch()} />
  const data = meeting.data?.data
  if (data === undefined)
    return <p className="text-sm text-muted-foreground">Tutanak yükleniyor…</p>
  if (editing) return <MeetingForm meeting={data} onDone={() => setEditing(false)} />
  const draft = data.status === 'draft'
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <h3 className="font-semibold">
            {data.subjectName} · {DEPARTMENT_MEETING_KIND_LABELS[data.kind]}
          </h3>
          <p className="text-sm text-muted-foreground">
            {dayText(data.meetingDate)} · {data.location} · Başkan {data.chairName}
            {data.signedDate === null ? '' : ` · İmza ${dayText(data.signedDate)}`}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge
            text={DEPARTMENT_MEETING_STATUS_LABELS[data.status]}
            tone={STATUS_TONES[data.status]}
          />
          {draft ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Tutanağı düzelt
            </Button>
          ) : null}
          <PdfDialogButton
            label="Tutanak PDF"
            title={DEPARTMENT_MEETING_MINUTES_TITLE}
            id={data.id}
            usePdf={useDepartmentMeetingMinutesPdf}
          />
        </span>
      </div>
      <section aria-label="Gündem" className="grid gap-1">
        <h4 className="text-sm font-semibold">Gündem</h4>
        <ol className="grid list-decimal gap-1 pl-5 text-sm">
          {data.agenda.map((item) => (
            <li key={item.id}>
              {item.title}
              {item.discussion === null ? null : (
                <p className="text-muted-foreground">{item.discussion}</p>
              )}
            </li>
          ))}
        </ol>
      </section>
      <section aria-label="Katılım" className="grid gap-1">
        <h4 className="text-sm font-semibold">Katılım</h4>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {data.attendees.map((attendee) => (
            <li key={attendee.membershipId}>
              {attendee.name}: {DEPARTMENT_MEETING_ATTENDANCE_LABELS[attendee.status]}
            </li>
          ))}
        </ul>
      </section>
      <Decisions meeting={data} />
      {draft ? <FinalizeForm meeting={data} /> : null}
    </div>
  )
}

function Decisions({ meeting }: { meeting: DepartmentMeeting }) {
  const remove = useRemoveDepartmentDecision()
  const [editing, setEditing] = useState<DepartmentMeetingDecision | 'new' | null>(null)
  const [following, setFollowing] = useState<DepartmentMeetingDecision | null>(null)
  const draft = meeting.status === 'draft'
  const agendaTitle = (id: string) => meeting.agenda.find((item) => item.id === id)?.title ?? ''
  const removeDecision = async (decision: DepartmentMeetingDecision) => {
    const outcome = await remove.submit({
      meetingId: meeting.id,
      decisionId: decision.id,
      version: decision.version,
    })
    if (outcome.status === 'success')
      notify.success(`${decision.number} numaralı karar kaldırıldı.`)
  }
  return (
    <section aria-label="Kararlar" className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Kararlar</h4>
        {draft ? (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            Karar ekle
          </Button>
        ) : null}
      </div>
      {meeting.decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz karar yok.</p>
      ) : (
        <ul className="grid gap-2">
          {meeting.decisions.map((decision) => (
            <li key={decision.id} className="grid gap-1 border-t pt-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {decision.number} · {agendaTitle(decision.agendaItemId)}
                </span>
                <StatusBadge
                  text={
                    decision.overdue
                      ? 'Termini geçti'
                      : DEPARTMENT_DECISION_STATUS_LABELS[decision.status]
                  }
                  tone={decision.overdue ? 'red' : DECISION_TONES[decision.status]}
                />
              </div>
              <p>{decision.text}</p>
              <p className="text-muted-foreground">
                Sorumlu {decision.responsibleName} · Termin{' '}
                {decision.dueDate === null ? 'yok' : dayText(decision.dueDate)}
                {decision.followUpNote === null ? '' : ` · Takip: ${decision.followUpNote}`}
              </p>
              <span className="flex flex-wrap gap-2">
                {draft ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`${decision.number} numaralı kararı düzelt`}
                      onClick={() => setEditing(decision)}
                    >
                      Düzelt
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${decision.number} numaralı kararı kaldır`}
                      disabled={remove.isPending}
                      onClick={() => void removeDecision(decision)}
                    >
                      Kaldır
                    </Button>
                  </>
                ) : decision.status === 'cancelled' ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`${decision.number} numaralı kararın takibi`}
                    onClick={() => setFollowing(decision)}
                  >
                    Takip
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing !== null ? (
        <DecisionForm
          meeting={meeting}
          decision={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {following !== null ? (
        <FollowUpForm meeting={meeting} decision={following} onDone={() => setFollowing(null)} />
      ) : null}
    </section>
  )
}

function DecisionForm({
  meeting,
  decision,
  onDone,
}: {
  meeting: DepartmentMeeting
  decision: DepartmentMeetingDecision | null
  onDone: () => void
}) {
  const create = useCreateDepartmentDecision()
  const update = useUpdateDepartmentDecision()
  const listed = useMemo(
    () => new Set(decision === null ? [] : [decision.responsibleMembershipId]),
    [decision],
  )
  const staff = useMeetingStaff(listed)
  const form = useForm<DecisionFormValues>({
    resolver: zodResolver(decisionFormSchema),
    defaultValues:
      decision === null
        ? emptyDecisionForm(meeting.agenda[0]?.id ?? '')
        : decisionFormFrom(decision),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const setError = (name: string, error: { message: string }) => {
      const field = decisionFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    }
    const body = decisionBody(values)
    const outcome =
      decision === null
        ? await create.submit({ meetingId: meeting.id, body }, { setError })
        : await update.submit(
            {
              meetingId: meeting.id,
              decisionId: decision.id,
              version: decision.version,
              body,
            },
            { setError },
          )
    if (outcome.status === 'success') {
      notify.success(decision === null ? 'Karar eklendi.' : 'Karar güncellendi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label={decision === null ? 'Yeni karar' : `${decision.number} numaralı karar`}
      className="grid gap-3 rounded-card border p-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="zk-madde" label="Gündem maddesi" error={errors.agendaItemId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('agendaItemId')}
            className="w-full"
            disabled={busy}
          >
            {meeting.agenda.map((item, index) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {`${String(index + 1)}. ${item.title}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="zk-sorumlu" label="Sorumlu" error={errors.responsibleMembershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('responsibleMembershipId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {staff.options.map((person) => (
              <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                {person.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="zk-metin" label="Karar metni" error={errors.text}>
          {(control) => (
            <Textarea {...control} rows={3} {...form.register('text')} disabled={busy} />
          )}
        </FormField>
      </div>
      <FormField id="zk-termin" label="Termin (isteğe bağlı)" error={errors.dueDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('dueDate')} disabled={busy} />
        )}
      </FormField>
      <div className="grid gap-2 sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy}>
            {decision === null ? 'Kararı ekle' : 'Kaydet'}
          </Button>
        </div>
      </div>
    </form>
  )
}

function FollowUpForm({
  meeting,
  decision,
  onDone,
}: {
  meeting: DepartmentMeeting
  decision: DepartmentMeetingDecision
  onDone: () => void
}) {
  const followUp = useFollowUpDepartmentDecision()
  const form = useForm<FollowUpFormValues>({
    resolver: zodResolver(followUpFormSchema),
    defaultValues: { status: decision.status, followUpNote: decision.followUpNote ?? '' },
  })
  const errors = form.formState.errors
  const busy = followUp.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await followUp.submit(
      { meetingId: meeting.id, decisionId: decision.id, version: decision.version, body: values },
      {
        setError: (name, error) =>
          name === 'followUpNote' || name === 'status'
            ? form.setError(name, error)
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${decision.number} numaralı kararın takibi kaydedildi.`)
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label={`${decision.number} numaralı karar takibi`}
      className="grid gap-3 rounded-card border p-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="zk-durum" label="Karar durumu" error={errors.status}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('status')}
            className="w-full"
            disabled={busy}
          >
            {DEPARTMENT_DECISION_STATUSES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {DEPARTMENT_DECISION_STATUS_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          id="zk-not"
          label="Takip notu"
          description="İptalde gerekçe zorunludur; iptal edilen karar yeniden açılmaz."
          error={errors.followUpNote}
        >
          {(control) => (
            <Textarea {...control} rows={2} {...form.register('followUpNote')} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy}>
            Takibi kaydet
          </Button>
        </div>
      </div>
    </form>
  )
}

function FinalizeForm({ meeting }: { meeting: DepartmentMeeting }) {
  const finalize = useFinalizeDepartmentMeeting()
  const [signedDate, setSignedDate] = useState(() => dayKey())
  const [error, setError] = useState<string | undefined>(undefined)
  const submit = async () => {
    setError(undefined)
    const outcome = await finalize.submit(
      { meetingId: meeting.id, version: meeting.version, signedDate },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') notify.success('Tutanak kesinleşti.')
  }
  return (
    <section aria-label="Kesinleştirme" className="grid gap-2 border-t pt-3">
      <h4 className="text-sm font-semibold">Kesinleştirme</h4>
      <p className="text-sm text-muted-foreground">
        İmza günüyle kesinleşen tutanakta toplantı, katılım ve karar metni değiştirilemez; yalnız
        kararların takibi yazılır.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="zt-imza">İmza günü</Label>
          <Input
            id="zt-imza"
            type="date"
            value={signedDate}
            aria-invalid={error === undefined ? undefined : true}
            disabled={finalize.isPending}
            onChange={(event) => setSignedDate(event.target.value)}
          />
        </div>
        <Button disabled={finalize.isPending} onClick={() => void submit()}>
          Tutanağı kesinleştir
        </Button>
      </div>
      <RootError message={error} />
    </section>
  )
}
