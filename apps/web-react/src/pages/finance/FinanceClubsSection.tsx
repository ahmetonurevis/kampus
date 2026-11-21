import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useAddClubMember,
  useArchiveClub,
  useArchiveClubSession,
  useClub,
  useClubs,
  useClubSession,
  useCreateClub,
  useRecordClubAttendance,
  useRemoveClubMember,
  useUpdateClub,
  type ClubDetail,
  type ClubRow,
} from '@kampus/react-shared/use-finance-clubs.ts'
import { useVisitorHosts } from '@kampus/react-shared/use-finance-visitors.ts'
import {
  CLUB_ATTENDANCE_STATUS_LABELS,
  CLUB_ATTENDANCE_STATUSES,
  CLUB_WEEKDAY_LABELS,
  CLUB_WEEKDAYS,
  type ClubAttendanceStatus,
} from '@kampus/school-core/lib/finance-clubs.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  ClubViewTabs,
  FinanceClubSelectionSection,
  useClubView,
} from './FinanceClubSelectionSection.tsx'
import { FinanceStudentSearch } from './FinanceStudentSearch.tsx'
import {
  attendanceBody,
  attendanceDefaults,
  clubCreateBody,
  clubDefaults,
  clubFormField,
  clubFormSchema,
  clubUpdateBody,
  countsText,
  isAttendanceStatus,
  quotaText,
  scheduleText,
  type ClubFormValues,
} from './finance-club-forms.ts'
import { dayText } from './finance-visitor-forms.ts'

const NO_SORT: readonly string[] = []
const STAFF_QUERY = { page: 1, pageSize: 100 } as const

/**
 * Kulüpler (DOM-FIN-142; ON-098; IST-099): Finans "Kulüpler" sekmesi, yönetici ve ön büro (K-483).
 * Liste kontenjan doluluğunu ve gün/saati gösterir; satır sağ panelde üyeleri, oturumları ve
 * yoklama formunu açar. Kulüp ve üyelik yönetici ve ön büroda, yoklama yönetici ve sorumlu
 * öğretmende (ön büro yoklama almaz). `clubs` modülü kapalıysa sekme yalnız bilgi verir.
 */
export function FinanceClubsSection() {
  const { session } = useAuth()
  if (session?.modules.clubs !== true)
    return (
      <EmptyState
        icon="Palette"
        title="Kulüp modülü kapalı"
        description="Kulüpleri yönetmek için kurum ayarlarından Kulüpler modülünü açın."
      />
    )
  return <ClubViews canTakeAttendance={session.role === 'yonetici'} />
}

/** Kulüp listesi ve kulüp tercih dönemi (ON-169; DOM-FIN-150) alt görünümleri. */
function ClubViews({ canTakeAttendance }: { canTakeAttendance: boolean }) {
  const [view, setView] = useClubView()
  return (
    <div className="grid gap-4">
      <ClubViewTabs value={view} onChange={setView} />
      {view === 'tercih' ? (
        <FinanceClubSelectionSection />
      ) : (
        <ClubList canTakeAttendance={canTakeAttendance} />
      )}
    </div>
  )
}

type ClubTableRow = {
  id: string
  row: ClubRow
  name: string
  teacher: string
  schedule: string
  quota: string
}

function ClubList({ canTakeAttendance }: { canTakeAttendance: boolean }) {
  const list = useListState('kulupler', { urlPrefix: 'kulup_' })
  const search = useDebouncedValue(list.state.query).trim()
  const clubs = useClubs({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const panel = useDetailPanel('kulup')
  const [editing, setEditing] = useState<ClubRow | 'new' | null>(null)
  const rows = useMemo(
    () =>
      clubs.data?.data.map((row): ClubTableRow => ({
        id: row.id,
        row,
        name: row.name,
        teacher: row.teacherName ?? '—',
        schedule: scheduleText(row),
        quota: quotaText(row),
      })),
    [clubs.data],
  )
  const columns = useMemo<DataColumn<ClubTableRow>[]>(
    () => [
      { key: 'name', label: 'Kulüp' },
      { key: 'teacher', label: 'Sorumlu öğretmen' },
      { key: 'schedule', label: 'Gün ve saat' },
      { key: 'quota', label: 'Kontenjan' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              variant="secondary"
              aria-label={`${row.name} kulübünü düzenle`}
              onClick={() => setEditing(row.row)}
            >
              Düzenle
            </Button>
            <Button
              className="min-h-11"
              variant="ghost"
              aria-label={`${row.name} kulübünü aç`}
              onClick={() => panel.open(row.id)}
            >
              Aç
            </Button>
          </span>
        ),
      },
    ],
    [panel],
  )
  return (
    <section
      aria-labelledby="kulupler"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="kulupler" className="text-lg font-semibold">
            Kulüpler
          </h2>
          <p className="text-sm text-muted-foreground">
            Kulüp, kontenjan ve üyelik; oturum yoklaması gün başına bir kez alınır.
          </p>
        </div>
        <Button className="min-h-11" onClick={() => setEditing('new')}>
          Kulüp ekle
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={clubs.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['name', ACTIONS_KEY]}
        caption="Kulüpler"
        empty="Henüz kulüp yok."
        emptyFiltered="Bu aramayla eşleşen kulüp yok."
        loading={clubs.isPending}
        fetching={clubs.isFetching && !clubs.isPending}
        error={
          clubs.error ? (
            <QueryError error={clubs.error} onRetry={() => void clubs.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Kulüp"
      >
        {panel.selectedId ? (
          <ClubPanel
            clubId={panel.selectedId}
            canTakeAttendance={canTakeAttendance}
            onClose={panel.close}
          />
        ) : null}
      </SidePanel>
      <Modal
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title={editing === 'new' ? 'Kulüp ekle' : 'Kulübü düzenle'}
      >
        {editing === null ? null : (
          <ClubForm
            club={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  )
}

function ClubPanel({
  clubId,
  canTakeAttendance,
  onClose,
}: {
  clubId: string
  canTakeAttendance: boolean
  onClose: () => void
}) {
  const club = useClub(clubId)
  if (club.error) return <QueryError error={club.error} onRetry={() => void club.refetch()} />
  const detail = club.data?.data
  if (!detail) return <SummaryLoading />
  return (
    <ClubDetails
      key={detail.version}
      detail={detail}
      canTakeAttendance={canTakeAttendance}
      onClose={onClose}
    />
  )
}

function ClubDetails({
  detail,
  canTakeAttendance,
  onClose,
}: {
  detail: ClubDetail
  canTakeAttendance: boolean
  onClose: () => void
}) {
  const add = useAddClubMember()
  const remove = useRemoveClubMember()
  const archive = useArchiveClub()
  const [studentId, setStudentId] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [sessionId, setSessionId] = useState('')
  const addMember = async () => {
    if (studentId === '') {
      setError('Öğrenciyi seçin.')
      return
    }
    const outcome = await add.submit(
      { clubId: detail.id, studentId },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.studentName} kulübe eklendi.`)
    setStudentId('')
    setError(undefined)
  }
  const archiveClub = async () => {
    const outcome = await archive.submit({ clubId: detail.id, version: detail.version })
    if (outcome.status !== 'success') return
    notify.success(`${detail.name} arşivlendi.`)
    onClose()
  }
  return (
    <div className="grid gap-5">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Kulüp</dt>
        <dd>{detail.name}</dd>
        <dt className="text-muted-foreground">Sorumlu öğretmen</dt>
        <dd>{detail.teacherName ?? '—'}</dd>
        <dt className="text-muted-foreground">Gün ve saat</dt>
        <dd>{scheduleText(detail)}</dd>
        <dt className="text-muted-foreground">Kontenjan</dt>
        <dd>{quotaText(detail)}</dd>
      </dl>
      <section aria-labelledby="kulup-uyeler" className="grid gap-2">
        <h3 id="kulup-uyeler" className="font-semibold">
          Üyeler
        </h3>
        {detail.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kulüpte üye yok.</p>
        ) : (
          <ul aria-label="Kulüp üyeleri" className="grid gap-1 text-sm">
            {detail.members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{`${member.studentName} · ${String(member.presentCount)}/${String(member.sessionCount)} oturum`}</span>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  aria-label={`${member.studentName} üyeliğini sonlandır`}
                  disabled={remove.isPending}
                  onClick={() =>
                    void remove
                      .submit({ clubId: detail.id, memberId: member.id, version: member.version })
                      .then((outcome) => {
                        if (outcome.status === 'success')
                          notify.success(`${member.studentName} kulüpten ayrıldı.`)
                      })
                  }
                >
                  Çıkar
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          noValidate
          aria-label="Kulübe üye ekle"
          className="grid gap-3 rounded-card border p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void addMember()
          }}
        >
          {detail.memberCount >= detail.capacity ? (
            <p className="text-sm text-danger">Kontenjan dolu.</p>
          ) : null}
          <FinanceStudentSearch
            label="Eklenecek öğrenci"
            value={studentId}
            onChange={(next) => {
              setStudentId(next)
              setError(undefined)
            }}
            error={error}
            disabled={add.isPending}
          />
          <Button type="submit" className="min-h-11" disabled={add.isPending}>
            Üye ekle
          </Button>
        </form>
      </section>
      {canTakeAttendance && detail.members.length > 0 ? <AttendanceForm detail={detail} /> : null}
      <section aria-labelledby="kulup-oturumlar" className="grid gap-2">
        <h3 id="kulup-oturumlar" className="font-semibold">
          Oturumlar
        </h3>
        {detail.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz yoklama alınmadı.</p>
        ) : (
          <ul aria-label="Kulüp oturumları" className="grid gap-1 text-sm">
            {detail.sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{`${dayText(session.sessionDate)} · ${countsText(session.counts)}`}</span>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  aria-label={`${dayText(session.sessionDate)} yoklamasını aç`}
                  onClick={() => setSessionId(session.id)}
                >
                  Aç
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div>
        <Button
          variant="ghost"
          className="min-h-11"
          disabled={archive.isPending}
          onClick={() => void archiveClub()}
        >
          Kulübü arşivle
        </Button>
      </div>
      <Modal
        open={sessionId !== ''}
        onOpenChange={(open) => (open ? undefined : setSessionId(''))}
        title="Oturum yoklaması"
      >
        {sessionId === '' ? null : (
          <SessionView
            clubId={detail.id}
            sessionId={sessionId}
            canArchive={canTakeAttendance}
            onDone={() => setSessionId('')}
          />
        )}
      </Modal>
    </div>
  )
}

function AttendanceForm({ detail }: { detail: ClubDetail }) {
  const record = useRecordClubAttendance()
  const [sessionDate, setSessionDate] = useState(() => dayKey())
  const [marks, setMarks] = useState(() => attendanceDefaults(detail.members))
  const [error, setError] = useState<string | undefined>()
  const busy = record.isPending
  const submit = async () => {
    const outcome = await record.submit(
      { clubId: detail.id, body: attendanceBody(sessionDate, marks) },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status !== 'success') return
    notify.success(`Yoklama kaydedildi: ${countsText(outcome.data.data.counts)}.`)
    setError(undefined)
  }
  return (
    <form
      noValidate
      aria-label="Kulüp yoklaması"
      className="grid gap-3 rounded-card border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <h3 className="font-semibold">Yoklama al</h3>
      <FormField id="kulup-oturum-gunu" label="Oturum günü">
        {(control) => (
          <Input
            {...control}
            type="date"
            value={sessionDate}
            max={dayKey()}
            disabled={busy}
            onChange={(event) => setSessionDate(event.target.value)}
          />
        )}
      </FormField>
      {detail.members.map((member) => (
        <FormField key={member.id} id={`yoklama-${member.id}`} label={member.studentName}>
          {(control) => (
            <NativeSelect
              {...control}
              className="w-full"
              value={marks[member.id] ?? 'present'}
              disabled={busy}
              onChange={(event) => {
                const value = event.target.value
                if (isAttendanceStatus(value))
                  setMarks((current) => ({ ...current, [member.id]: value }))
              }}
            >
              {CLUB_ATTENDANCE_STATUSES.map((status) => (
                <NativeSelectOption key={status} value={status}>
                  {CLUB_ATTENDANCE_STATUS_LABELS[status as ClubAttendanceStatus]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ))}
      <RootError message={error} />
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Yoklamayı kaydet
      </Button>
    </form>
  )
}

function SessionView({
  clubId,
  sessionId,
  canArchive,
  onDone,
}: {
  clubId: string
  sessionId: string
  canArchive: boolean
  onDone: () => void
}) {
  const session = useClubSession(clubId, sessionId)
  const archive = useArchiveClubSession()
  if (session.error)
    return <QueryError error={session.error} onRetry={() => void session.refetch()} />
  const data = session.data?.data
  if (!data) return <SummaryLoading />
  return (
    <div className="grid gap-3">
      <p className="text-sm">{`${dayText(data.sessionDate)} · ${countsText(data.counts)}`}</p>
      <ul aria-label="Yoklama işaretleri" className="grid gap-1 text-sm">
        {data.marks.map((mark) => (
          <li key={mark.memberId} className="flex justify-between gap-2 border-b py-1">
            <span>{mark.studentName}</span>
            <span>{CLUB_ATTENDANCE_STATUS_LABELS[mark.status]}</span>
          </li>
        ))}
      </ul>
      {canArchive ? (
        <div>
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={archive.isPending}
            onClick={() =>
              void archive.submit({ clubId, sessionId, version: data.version }).then((outcome) => {
                if (outcome.status !== 'success') return
                notify.success('Yoklama geri alındı; aynı gün yeniden alınabilir.')
                onDone()
              })
            }
          >
            Yoklamayı geri al
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function ClubForm({ club, onDone }: { club?: ClubRow; onDone: () => void }) {
  const staff = useVisitorHosts(STAFF_QUERY)
  const create = useCreateClub()
  const update = useUpdateClub()
  const form = useForm<ClubFormValues>({
    resolver: zodResolver(clubFormSchema),
    defaultValues: clubDefaults(club),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const teachers = (staff.data?.data ?? []).filter(
    (person) => person.role === 'ogretmen' && person.active,
  )
  const setServerError = (name: string, error: { type: string; message: string }) => {
    const field = clubFormField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (club === undefined) {
      const outcome = await create.submit(clubCreateBody(values), { setError: setServerError })
      if (outcome.status !== 'success') return
      notify.success(`${outcome.data.data.name} açıldı.`)
      onDone()
      return
    }
    const body = clubUpdateBody(values, club)
    if (body === null) {
      onDone()
      return
    }
    const outcome = await update.submit(
      { clubId: club.id, version: club.version, body },
      { setError: setServerError },
    )
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.name} güncellendi.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label={club === undefined ? 'Kulüp ekle' : 'Kulübü düzenle'}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="kulup-ad" label="Kulüp adı" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
      </div>
      <FormField id="kulup-ogretmen" label="Sorumlu öğretmen" error={errors.teacherMembershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('teacherMembershipId')}
            className="w-full"
            disabled={busy || staff.isPending}
          >
            <NativeSelectOption value="">Öğretmen seçin</NativeSelectOption>
            {teachers.map((person) => (
              <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                {person.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="kulup-kontenjan" label="Kontenjan" error={errors.capacity}>
        {(control) => (
          <Input {...control} inputMode="numeric" {...form.register('capacity')} disabled={busy} />
        )}
      </FormField>
      <FormField id="kulup-gun" label="Gün" error={errors.meetingDay}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('meetingDay')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Gün seçin</NativeSelectOption>
            {CLUB_WEEKDAYS.map((day) => (
              <NativeSelectOption key={day} value={String(day)}>
                {CLUB_WEEKDAY_LABELS[day]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="grid grid-cols-2 gap-2">
        <FormField id="kulup-baslangic" label="Başlangıç" error={errors.startTime}>
          {(control) => (
            <Input {...control} type="time" {...form.register('startTime')} disabled={busy} />
          )}
        </FormField>
        <FormField id="kulup-bitis" label="Bitiş" error={errors.endTime}>
          {(control) => (
            <Input {...control} type="time" {...form.register('endTime')} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          {club === undefined ? 'Kulübü kaydet' : 'Değişiklikleri kaydet'}
        </Button>
      </div>
    </form>
  )
}
