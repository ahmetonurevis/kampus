import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch, type Control } from 'react-hook-form'
import { useAllLanguageGroups } from '@kampus/react-shared/use-language-groups.ts'
import {
  useCancelSchoolEvent,
  useCreateSchoolEvent,
  usePublishSchoolEvent,
  useSchoolCalendar,
  useSchoolCalendarIcal,
  useSchoolEvents,
  useUpdateSchoolEvent,
  type SchoolCalendar,
  type SchoolCalendarLink,
  type SchoolEvent,
} from '@kampus/react-shared/use-finance-school-calendar.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  ALL_DAY_SCHOOL_EVENT_KINDS,
  SCHOOL_EVENT_STATUSES,
  type SchoolEventKind,
  type SchoolEventStatus,
} from '@kampus/school-core/lib/finance-school-calendar.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { cn } from '@/lib/utils'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  addDays,
  calendarRange,
  calendarWeeks,
  dayLongText,
  isWeekend,
  periodTitle,
  shiftAnchor,
  WEEKDAY_LABELS,
  WEEKDAY_NAMES,
} from './finance-leave-calendar-view.ts'
import {
  AUDIENCE_OPTIONS,
  audienceText,
  busyDays,
  CALENDAR_VIEWS,
  cancelFormSchema,
  CANCEL_REASON_LIMITS,
  createBody,
  eventDateText,
  eventDefaults,
  eventEnded,
  eventFormSchema,
  eventsOn,
  eventTimeText,
  eventValues,
  formField,
  GRADE_OPTIONS,
  KIND_OPTIONS,
  kindText,
  linkSourceText,
  linkTimeText,
  linksOn,
  statusText,
  statusTone,
  updateBody,
  type CalendarView,
  type EventFormValues,
} from './finance-school-calendar-forms.ts'

const NO_SORT: readonly string[] = []

/**
 * Okul takvimi (DOM-FIN-163; ON-090; IST-099; K-544…K-546): Finans "Okul takvimi" sekmesi, yönetici
 * ve ön büro. Ay ve hafta görünümü ızgaradır (dar ekranda dolu günlerin listesi), liste görünümü
 * sayfalı tablodur. Etkinlik taslak açılır, yayımlanınca hedef kitle görür; iptal gerekçelidir,
 * silme yoktur. Gezi planı ve biletli etkinlik takvimde bağlantı olarak görünür, kendi sekmesinde
 * yönetilir. `calendar` modülü kapalıysa sekme yalnız bilgi verir. Öğretmen, veli ve öğrenci
 * ekranı platform kabuğundadır (uç `GET /finance/school-calendar/my`).
 */
export function FinanceSchoolCalendarSection() {
  const { session } = useAuth()
  if (session?.modules.calendar !== true)
    return (
      <EmptyState
        icon="CalendarCheck2"
        title="Okul takvimi modülü kapalı"
        description="Etkinlik eklemek için kurum ayarlarından Okul Takvimi modülünü açın."
      />
    )
  return <SchoolCalendarView languageSchool={session.institution?.type === 'language_school'} />
}

type Dialog =
  | { mode: 'create'; day: string }
  | { mode: 'edit'; event: SchoolEvent }
  | { mode: 'cancel'; event: SchoolEvent }
  | null

function SchoolCalendarView({ languageSchool }: { languageSchool: boolean }) {
  const today = dayKey()
  const [view, setView] = useState<CalendarView>('month')
  const [anchor, setAnchor] = useState(today)
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [selected, setSelected] = useState<SchoolEvent | null>(null)
  const ical = useSchoolCalendarIcal()
  const grid = view === 'list' ? 'month' : view
  const gridRange = calendarRange(grid, anchor)
  const range =
    view === 'list'
      ? { from: gridRange.startDate, to: addDays(gridRange.startDate, 365) }
      : { from: gridRange.startDate, to: gridRange.endDate }
  const filters = {
    ...(kind === '' ? {} : { kind: kind as SchoolEventKind }),
    ...(status === '' ? {} : { status: status as SchoolEventStatus }),
  }
  const calendar = useSchoolCalendar(view === 'list' ? null : { ...range, ...filters })
  const title = periodTitle(grid, anchor)

  async function download() {
    const outcome = await ical.submit(range)
    if (outcome.status !== 'success') return
    saveBlob(
      new Blob([String(outcome.data)], { type: 'text/calendar;charset=utf-8' }),
      `okul-takvimi-${range.from}-${range.to}.ics`,
    )
    notify.success('Takvim dosyası indirildi.')
  }

  // Yazma yanıtı seçili etkinliği tazeler (sürüm ve durum güncel kalır).
  const open = (event: SchoolEvent) => setSelected(event)
  const current = selected

  return (
    <section
      aria-labelledby="okul-takvimi"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="okul-takvimi" className="text-lg font-semibold">
            Okul takvimi
          </h2>
          <p className="text-sm text-muted-foreground">
            Tören, veli toplantısı, sınav haftası, tatil, gezi ve gösteriler. Yayımlanan etkinliği
            hedef kitlesi görür; tatiller izin takviminde de görünür.
          </p>
        </div>
        <span className="flex flex-wrap gap-2">
          <Button
            className="min-h-11"
            variant="secondary"
            disabled={ical.isPending}
            aria-busy={ical.isPending || undefined}
            onClick={() => void download()}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            iCal indir
          </Button>
          <Button className="min-h-11" onClick={() => setDialog({ mode: 'create', day: today })}>
            Etkinlik ekle
          </Button>
        </span>
      </header>
      <div className="grid gap-3 px-6 pb-6">
        <div className="flex flex-wrap items-end gap-2">
          <LineTabs
            label="Takvim görünümü"
            value={view}
            options={CALENDAR_VIEWS}
            onChange={(next) => setView(next)}
          />
          {view === 'list' ? null : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={() => setAnchor(shiftAnchor(grid, anchor, -1))}
              >
                {view === 'month' ? 'Önceki ay' : 'Önceki hafta'}
              </Button>
              <Button variant="secondary" className="min-h-11" onClick={() => setAnchor(today)}>
                Bugün
              </Button>
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={() => setAnchor(shiftAnchor(grid, anchor, 1))}
              >
                {view === 'month' ? 'Sonraki ay' : 'Sonraki hafta'}
              </Button>
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="takvim-tur" label="Tür">
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <NativeSelectOption value="">Tüm türler</NativeSelectOption>
                {KIND_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="takvim-durum" label="Durum">
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <NativeSelectOption value="">Tüm durumlar</NativeSelectOption>
                {SCHOOL_EVENT_STATUSES.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {statusText(item)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
        {view === 'list' ? (
          <EventList range={range} filters={filters} onOpen={open} />
        ) : (
          <>
            <h3 className="text-base font-semibold">{title}</h3>
            {calendar.error ? (
              <QueryError error={calendar.error} onRetry={() => void calendar.refetch()} />
            ) : calendar.data === undefined ? (
              <SummaryLoading />
            ) : (
              <CalendarGrid
                data={calendar.data.data}
                title={title}
                today={today}
                month={grid === 'month' ? anchor.slice(0, 7) : null}
                onOpen={open}
                onAdd={(day) => setDialog({ mode: 'create', day })}
              />
            )}
          </>
        )}
      </div>
      {current === null ? null : (
        <EventDetails
          event={current}
          today={today}
          onClose={() => setSelected(null)}
          onChanged={setSelected}
          onEdit={() => setDialog({ mode: 'edit', event: current })}
          onCancel={() => setDialog({ mode: 'cancel', event: current })}
        />
      )}
      <Modal
        open={dialog?.mode === 'create' || dialog?.mode === 'edit'}
        onOpenChange={(next) => (next ? undefined : setDialog(null))}
        title={dialog?.mode === 'edit' ? 'Etkinliği düzenle' : 'Etkinlik ekle'}
        description="Taslak yalnız yönetici ve ön büroda görünür; yayımlayınca hedef kitle görür."
      >
        {dialog?.mode === 'create' ? (
          <EventForm
            day={dialog.day}
            languageSchool={languageSchool}
            onDone={(event) => {
              setDialog(null)
              if (event !== undefined) setSelected(event)
            }}
          />
        ) : dialog?.mode === 'edit' ? (
          <EventForm
            event={dialog.event}
            day={dialog.event.startDate}
            languageSchool={languageSchool}
            onDone={(event) => {
              setDialog(null)
              if (event !== undefined) setSelected(event)
            }}
          />
        ) : null}
      </Modal>
      <Modal
        open={dialog?.mode === 'cancel'}
        onOpenChange={(next) => (next ? undefined : setDialog(null))}
        title="Etkinliği iptal et"
        description="Etkinlik silinmez. Yayımlanmış etkinlik hedef kitleye gerekçesiyle iptal olarak görünür."
      >
        {dialog?.mode === 'cancel' ? (
          <CancelForm
            event={dialog.event}
            onDone={(event) => {
              setDialog(null)
              setSelected(event)
            }}
          />
        ) : null}
      </Modal>
    </section>
  )
}

// --- Izgara --------------------------------------------------------------------------------------

function DayItems({
  data,
  day,
  onOpen,
}: {
  data: SchoolCalendar
  day: string
  onOpen: (event: SchoolEvent) => void
}) {
  return (
    <ul className="grid gap-1">
      {eventsOn(data.events, day).map((event) => (
        <li key={event.id}>
          <button
            type="button"
            onClick={() => onOpen(event)}
            aria-label={`${event.title}, ${kindText(event.kind)}, ${statusText(event.status)}`}
            className={cn(
              'grid min-h-6 w-full rounded-sm border px-1.5 py-0.5 text-left text-xs leading-snug hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              event.status === 'draft' && 'border-dashed',
              event.status === 'cancelled' && 'line-through',
            )}
          >
            <span className="font-medium">{event.title}</span>
            <span className="text-muted-foreground">
              {event.allDay
                ? kindText(event.kind)
                : `${event.startTime ?? ''} · ${kindText(event.kind)}`}
              {event.status === 'published' ? '' : ` · ${statusText(event.status)}`}
            </span>
          </button>
        </li>
      ))}
      {linksOn(data.links, day).map((link) => (
        <li
          key={`${link.source}-${link.sourceId}`}
          className="rounded-sm bg-muted/60 px-1.5 py-0.5 text-xs leading-snug"
        >
          <span className="font-medium">{linkTitle(link)}</span>
          <span className="block text-muted-foreground">
            {linkSourceText(link.source)} · {linkTimeText(link)}
          </span>
        </li>
      ))}
    </ul>
  )
}

const linkTitle = (link: SchoolCalendarLink) =>
  link.reference === null ? link.title : `${link.reference} ${link.title}`

function CalendarGrid({
  data,
  title,
  today,
  month,
  onOpen,
  onAdd,
}: {
  data: SchoolCalendar
  title: string
  today: string
  month: string | null
  onOpen: (event: SchoolEvent) => void
  onAdd: (day: string) => void
}) {
  const weeks = calendarWeeks({ startDate: data.from, endDate: data.to })
  const days = busyDays(weeks.flat(), data)
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">Okul takvimi: {title}</caption>
          <thead>
            <tr>
              {WEEKDAY_LABELS.map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  abbr={WEEKDAY_NAMES[index]}
                  className="border-b px-2 py-1 text-left text-xs font-medium text-muted-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((day) => (
                  <td
                    key={day}
                    aria-current={day === today ? 'date' : undefined}
                    className={cn(
                      'h-28 border p-1 align-top',
                      (isWeekend(day) || (month !== null && day.slice(0, 7) !== month)) &&
                        'bg-muted/40',
                    )}
                  >
                    <div className="grid gap-1">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          aria-hidden="true"
                          className={cn(
                            'text-xs text-muted-foreground',
                            day === today && 'font-semibold text-foreground',
                          )}
                        >
                          {Number(day.slice(8))}
                        </span>
                        <button
                          type="button"
                          onClick={() => onAdd(day)}
                          aria-label={`${dayLongText(day)} için etkinlik ekle`}
                          className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <Icon name="Plus" size={14} aria-hidden="true" />
                        </button>
                      </div>
                      <span className="sr-only">{dayLongText(day)}</span>
                      <DayItems data={data} day={day} onOpen={onOpen} />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden">
        {days.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu dönemde etkinlik yok.</p>
        ) : (
          <ol aria-label={`Etkinlik listesi: ${title}`} className="grid gap-2">
            {days.map((day) => (
              <li key={day} className="grid gap-1 rounded-sm border px-3 py-2">
                <span className="text-sm font-medium">{dayLongText(day)}</span>
                <DayItems data={data} day={day} onOpen={onOpen} />
              </li>
            ))}
          </ol>
        )}
      </div>
      {data.events.length === 0 && data.links.length === 0 ? (
        <p className="hidden text-sm text-muted-foreground md:block">Bu dönemde etkinlik yok.</p>
      ) : null}
    </>
  )
}

// --- Liste ---------------------------------------------------------------------------------------

type EventRow = {
  id: string
  title: string
  date: string
  time: string
  kind: string
  audience: string
  status: string
  event: SchoolEvent
}

function EventList({
  range,
  filters,
  onOpen,
}: {
  range: { from: string; to: string }
  filters: { kind?: SchoolEventKind; status?: SchoolEventStatus }
  onOpen: (event: SchoolEvent) => void
}) {
  const list = useListState('okul-takvimi', { urlPrefix: 'takvim_' })
  const search = useDebouncedValue(list.state.query).trim()
  const events = useSchoolEvents({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...range,
    ...filters,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const rows = useMemo(
    () =>
      events.data?.data.map((event): EventRow => ({
        id: event.id,
        title: event.title,
        date: eventDateText(event),
        time: eventTimeText(event),
        kind: kindText(event.kind),
        audience: audienceText(event),
        status: statusText(event.status),
        event,
      })),
    [events.data],
  )
  const columns = useMemo<DataColumn<EventRow>[]>(
    () => [
      { key: 'title', label: 'Etkinlik' },
      { key: 'date', label: 'Tarih' },
      { key: 'time', label: 'Saat' },
      { key: 'kind', label: 'Tür' },
      { key: 'audience', label: 'Hedef kitle' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={statusTone(row.event.status)} />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            className="min-h-11"
            variant="secondary"
            aria-label={`${row.title} etkinliğini aç`}
            onClick={() => onOpen(row.event)}
          >
            Aç
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
      total={events.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      mobileColumns={['title', ACTIONS_KEY]}
      caption="Okul takvimi etkinlikleri"
      empty="Bu dönemde etkinlik yok."
      emptyFiltered="Bu süzgeçle eşleşen etkinlik yok."
      loading={events.isPending}
      fetching={events.isFetching && !events.isPending}
      error={
        events.error ? (
          <QueryError error={events.error} onRetry={() => void events.refetch()} />
        ) : undefined
      }
    />
  )
}

// --- Ayrıntı -------------------------------------------------------------------------------------

function EventDetails({
  event,
  today,
  onClose,
  onChanged,
  onEdit,
  onCancel,
}: {
  event: SchoolEvent
  today: string
  onClose: () => void
  onChanged: (event: SchoolEvent) => void
  onEdit: () => void
  onCancel: () => void
}) {
  const publish = usePublishSchoolEvent()
  const cancelled = event.status === 'cancelled'
  async function onPublish() {
    const outcome = await publish.submit({ eventId: event.id, version: event.version })
    if (outcome.status !== 'success') return
    notify.success(`${event.title} yayımlandı.`)
    onChanged(outcome.data.data)
  }
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={event.title}
      description={`${kindText(event.kind)} · ${eventDateText(event)} · ${eventTimeText(event)}`}
    >
      <div className="grid gap-3">
        <StatusBadge
          text={statusText(event.status)}
          tone={statusTone(event.status)}
          className="w-fit"
        />
        <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-muted-foreground">Hedef kitle</dt>
          <dd>{audienceText(event)}</dd>
          <dt className="text-muted-foreground">Yer</dt>
          <dd>{event.location ?? '—'}</dd>
          <dt className="text-muted-foreground">Açıklama</dt>
          <dd className="whitespace-pre-line">{event.description ?? '—'}</dd>
          {cancelled ? (
            <>
              <dt className="text-muted-foreground">İptal gerekçesi</dt>
              <dd>{event.cancelReason ?? '—'}</dd>
            </>
          ) : null}
        </dl>
        {cancelled ? null : (
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" variant="secondary" onClick={onEdit}>
              Düzenle
            </Button>
            {event.status === 'draft' ? (
              <Button
                className="min-h-11"
                disabled={publish.isPending}
                aria-busy={publish.isPending || undefined}
                onClick={() => void onPublish()}
              >
                Yayımla
              </Button>
            ) : null}
            {eventEnded(event, today) ? null : (
              <Button className="min-h-11" variant="destructive" onClick={onCancel}>
                İptal et
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

// --- Formlar -------------------------------------------------------------------------------------

function TargetChoices({
  control,
  audienceKind,
  languageSchool,
  disabled,
  error,
}: {
  control: Control<EventFormValues>
  audienceKind: EventFormValues['audienceKind']
  languageSchool: boolean
  disabled: boolean
  error: string | undefined
}) {
  const classes = useCoreAll('classes', {}, { enabled: audienceKind === 'class' })
  const groups = useAllLanguageGroups({}, { enabled: audienceKind === 'group' && languageSchool })
  if (audienceKind === 'institution') return null
  const options =
    audienceKind === 'grade'
      ? GRADE_OPTIONS.map((grade) => ({ value: grade, label: `${grade}. sınıf` }))
      : audienceKind === 'class'
        ? (classes.data ?? [])
            .map((row) => row.record)
            .filter((record) => record.isActive !== false)
            .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }))
            .map((record) => ({ value: record.id, label: record.name }))
        : (groups.data ?? [])
            .filter((group) => group.status !== 'cancelled')
            .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }))
            .map((group) => ({ value: group.id, label: group.name }))
  const legend =
    audienceKind === 'grade' ? 'Kademeler' : audienceKind === 'class' ? 'Sınıflar' : 'Gruplar'
  return (
    <Controller
      control={control}
      name="audienceIds"
      render={({ field }) => (
        <fieldset
          className="grid gap-1"
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : 'etkinlik-hedef-hata'}
        >
          <legend className="mb-1 text-sm font-medium">{legend}</legend>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">Seçilecek kayıt yok.</p>
          ) : (
            <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-3">
              {options.map((option) => {
                const id = `etkinlik-hedef-${option.value}`
                return (
                  <div key={option.value} className="flex min-h-11 items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={field.value.includes(option.value)}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked === true
                            ? [...field.value, option.value]
                            : field.value.filter((value) => value !== option.value),
                        )
                      }
                    />
                    <Label htmlFor={id}>{option.label}</Label>
                  </div>
                )
              })}
            </div>
          )}
          {error === undefined ? null : (
            <p id="etkinlik-hedef-hata" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </fieldset>
      )}
    />
  )
}

function EventForm({
  event,
  day,
  languageSchool,
  onDone,
}: {
  event?: SchoolEvent
  day: string
  languageSchool: boolean
  onDone: (event?: SchoolEvent) => void
}) {
  const create = useCreateSchoolEvent()
  const update = useUpdateSchoolEvent()
  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: event === undefined ? eventDefaults(day) : eventValues(event),
  })
  const allDay = useWatch({ control: form.control, name: 'allDay' })
  const audienceKind = useWatch({ control: form.control, name: 'audienceKind' })
  const kind = useWatch({ control: form.control, name: 'kind' })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const forcedAllDay = ALL_DAY_SCHOOL_EVENT_KINDS.includes(kind)
  const setError = (name: string, error: { type?: string; message?: string }) => {
    const field = formField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (event === undefined) {
      const outcome = await create.submit(createBody(values), { setError })
      if (outcome.status !== 'success') return
      notify.success(`${outcome.data.data.title} taslak olarak eklendi.`)
      onDone(outcome.data.data)
      return
    }
    const body = updateBody(event, values)
    if (body === null) {
      form.setError('root.server', { message: 'Etkinlikte değişiklik yok.' })
      return
    }
    const outcome = await update.submit(
      { eventId: event.id, version: event.version, body },
      { setError },
    )
    if (outcome.status !== 'success') return
    notify.success('Etkinlik güncellendi.')
    onDone(outcome.data.data)
  })
  return (
    <form
      noValidate
      aria-label={event === undefined ? 'Etkinlik ekle' : 'Etkinliği düzenle'}
      className="grid gap-3"
      onSubmit={(submitEvent) => void onSubmit(submitEvent)}
    >
      <FormField id="etkinlik-baslik" label="Başlık" error={errors.title}>
        {(control) => <Input {...control} {...form.register('title')} disabled={busy} />}
      </FormField>
      <FormField id="etkinlik-tur" label="Tür" error={errors.kind}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('kind', {
              onChange: (change: { target: { value: string } }) => {
                if ((ALL_DAY_SCHOOL_EVENT_KINDS as readonly string[]).includes(change.target.value))
                  form.setValue('allDay', true)
              },
            })}
            className="w-full"
            disabled={busy}
          >
            {KIND_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <Controller
        control={form.control}
        name="allDay"
        render={({ field }) => (
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox
              id="etkinlik-tum-gun"
              checked={field.value}
              disabled={busy || forcedAllDay}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
            <Label htmlFor="etkinlik-tum-gun">Tüm gün</Label>
            {errors.allDay?.message ? (
              <span className="text-sm text-destructive">{errors.allDay.message}</span>
            ) : null}
          </div>
        )}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="etkinlik-baslangic" label="Başlangıç günü" error={errors.startDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
          )}
        </FormField>
        <FormField id="etkinlik-bitis" label="Bitiş günü" error={errors.endDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('endDate')} disabled={busy} />
          )}
        </FormField>
        {allDay ? null : (
          <>
            <FormField
              id="etkinlik-baslangic-saati"
              label="Başlangıç saati"
              error={errors.startTime}
            >
              {(control) => (
                <Input {...control} type="time" {...form.register('startTime')} disabled={busy} />
              )}
            </FormField>
            <FormField id="etkinlik-bitis-saati" label="Bitiş saati" error={errors.endTime}>
              {(control) => (
                <Input {...control} type="time" {...form.register('endTime')} disabled={busy} />
              )}
            </FormField>
          </>
        )}
      </div>
      <FormField id="etkinlik-yer" label="Yer" error={errors.location}>
        {(control) => <Input {...control} {...form.register('location')} disabled={busy} />}
      </FormField>
      <FormField id="etkinlik-aciklama" label="Açıklama" error={errors.description}>
        {(control) => (
          <Textarea {...control} rows={3} {...form.register('description')} disabled={busy} />
        )}
      </FormField>
      <FormField id="etkinlik-hedef" label="Hedef kitle" error={errors.audienceKind}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('audienceKind', {
              onChange: () => form.setValue('audienceIds', []),
            })}
            className="w-full"
            disabled={busy}
          >
            {AUDIENCE_OPTIONS.filter((option) => option.value !== 'group' || languageSchool).map(
              (option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ),
            )}
          </NativeSelect>
        )}
      </FormField>
      <TargetChoices
        control={form.control}
        audienceKind={audienceKind}
        languageSchool={languageSchool}
        disabled={busy}
        error={errors.audienceIds?.message}
      />
      <RootError message={errors.root?.server?.message} />
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        {event === undefined ? 'Taslak olarak kaydet' : 'Değişiklikleri kaydet'}
      </Button>
    </form>
  )
}

function CancelForm({
  event,
  onDone,
}: {
  event: SchoolEvent
  onDone: (event: SchoolEvent) => void
}) {
  const cancel = useCancelSchoolEvent()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(cancelFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { eventId: event.id, version: event.version, body: values },
      {
        setError: (name, error) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`${event.title} iptal edildi.`)
    onDone(outcome.data.data)
  })
  return (
    <form
      noValidate
      aria-label="Etkinliği iptal et"
      className="grid gap-3"
      onSubmit={(submitEvent) => void onSubmit(submitEvent)}
    >
      <FormField
        id="etkinlik-iptal-gerekce"
        label="İptal gerekçesi"
        description={`${String(CANCEL_REASON_LIMITS.min)}–${String(CANCEL_REASON_LIMITS.max)} karakter; hedef kitle de görür.`}
        error={errors.reason}
      >
        {(control) => (
          <Textarea {...control} rows={3} {...form.register('reason')} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <Button
        type="submit"
        variant="destructive"
        className="min-h-11"
        disabled={busy}
        aria-busy={busy || undefined}
      >
        Etkinliği iptal et
      </Button>
    </form>
  )
}
