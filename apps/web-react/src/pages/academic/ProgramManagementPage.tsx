import { useMemo } from 'react'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  useLessonList,
  useLessonsFetchAll,
  useLessonsInRange,
} from '@kampus/react-shared/use-lessons.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { LookupError } from './AcademicParts.tsx'
import { addDays, isDayKey, weekStart } from './academic-rows.ts'
import { CancelDialog, LessonFormDialog, NEW_LESSON, SubstituteDialog } from './LessonForms.tsx'
import { LessonPanel, type LessonCommand } from './LessonPanel.tsx'
import { PeriodNav, ScheduleDays } from './ScheduleParts.tsx'
import {
  cancelledFilter,
  classOptions,
  rangeTitle,
  reversedRange,
  SCHEDULE_VIEWS,
  scheduleByDay,
  scheduleCsvRow,
  scheduleLesson,
  scheduleRange,
  scheduleViewMode,
  type ScheduleLesson,
  type ScheduleViewMode,
  viewDays,
} from './schedule-model.ts'
import { useAcademicLookups } from './use-academic-lookups.ts'

// Panel parametreleri (`ders`, `ders-form`, `ders-yedek`, `ders-iptal`) bu adlarla çakışmamalı:
// aynı ad hem süzgeç hem panel olursa süzgeç değeri kayıt kimliği gibi açılır.
const URL_FILTERS = {
  view: 'gorunum',
  day: 'gun',
  classId: 'sinif',
  teacherId: 'ogretmen',
  room: 'derslik',
  from: 'baslangic',
  to: 'bitis',
  cancelled: 'iptal',
}
type FilterKey = keyof typeof URL_FILTERS
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['when', 'title', 'status']
const ALL = 'all'
const SHOWN = 'goster'
const TABLE_NAME = 'Ders listesi'

/** CSV sütunları `scheduleCsvRow` alanlarıdır (ekrandaki metinle aynı). */
const CSV_COLUMNS = [
  { key: 'dayLabel', label: 'Tarih' },
  { key: 'time', label: 'Saat' },
  { key: 'title', label: 'Ders' },
  { key: 'className', label: 'Sınıf' },
  { key: 'teacher', label: 'Öğretmen' },
  { key: 'substitute', label: 'Yedek' },
  { key: 'room', label: 'Derslik' },
  { key: 'duration', label: 'Süre (dk)' },
  { key: 'statusLabel', label: 'Durum' },
] as const

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * Program Yönetimi (IST-094; DOM-YTK-068, DOM-YTK-069), `GET /lessons` üzerine: haftalık, günlük
 * ve liste görünümü; sınıf, öğretmen, derslik ve (listede) tarih aralığı süzgeci. Süzgeçler ve
 * görünüm adreste tutulur. İptal edilen ders varsayılan olarak gizlidir; yönetici "İptalleri
 * göster" ile iptal geçmişini görür. Yönetici ders planlar, düzenler, gerekçeyle yedek atar ve
 * iptal eder (başlamış ya da iptal edilmiş derste işlem görünmez); öğretmen kendi (asıl ya da
 * yedek olduğu) derslerini salt okur. Gerekçeler yalnız yöneticiye döner.
 */
export function ProgramManagementPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const canManage = session?.role === 'yonetici'
  const data = useAcademicLookups({ students: false })
  const { lookups } = data
  const list = useListState('ders-programi', { pageSize: 25, urlFilters: URL_FILTERS })
  const filters = list.state.filters
  const view: ScheduleViewMode = scheduleViewMode(filters.view)
  const today = dayKey()
  const anchor = isDayKey(filters.day) ? filters.day : today
  const classId = text(filters.classId)
  const teacherId = canManage ? text(filters.teacherId) : ''
  const roomInput = text(filters.room)
  const room = useDebouncedValue(roomInput)
  const from = text(filters.from)
  const to = text(filters.to)
  const showCancelled = canManage && filters.cancelled === SHOWN
  const reversed = view === 'liste' && reversedRange(from, to)

  const setFilter = (key: FilterKey, value: string) =>
    list.dispatch({ type: 'filter', key, value: value === ALL ? '' : value })

  const query = {
    ...scheduleRange(view, anchor, from, to),
    ...(classId ? { classId } : {}),
    ...(teacherId ? { teacherId } : {}),
    ...(room.trim() ? { room } : {}),
    cancelled: cancelledFilter(showCancelled),
  }
  const ranged = useLessonsInRange(query, { enabled: view !== 'liste' })
  const paged = useLessonList(
    { ...query, page: list.state.page, pageSize: list.state.pageSize },
    { enabled: view === 'liste' && !reversed },
  )
  const fetchAll = useLessonsFetchAll()
  const csv = useCsvExport()

  const panel = useDetailPanel('ders')
  const lessonForm = useDetailPanel('ders-form')
  const substituteForm = useDetailPanel('ders-yedek')
  const cancelForm = useDetailPanel('ders-iptal')
  const openLesson = panel.open

  const days = viewDays(view, anchor)
  const byDay = useMemo(
    () =>
      scheduleByDay(
        (ranged.data ?? []).map((lesson) => scheduleLesson(lesson, lookups, 'admin')),
        viewDays(view, anchor),
        showCancelled,
      ),
    [ranged.data, lookups, view, anchor, showCancelled],
  )
  const rows = useMemo(
    () => paged.data?.rows.map((lesson) => scheduleLesson(lesson, lookups, 'admin')),
    [paged.data, lookups],
  )

  const columns = useMemo<DataColumn<ScheduleLesson>[]>(
    () => [
      {
        key: 'when',
        label: 'Tarih',
        cell: (row) => (
          <span className="grid">
            <span>{row.dayLabel}</span>
            <small className="text-xs text-muted-foreground">
              {row.time} · {row.duration} dk
            </small>
          </span>
        ),
      },
      {
        key: 'title',
        label: 'Ders',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openLesson(row.id)}
            className="record-link text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'className', label: 'Sınıf' },
      {
        key: 'teacher',
        label: 'Öğretmen',
        cell: (row) => (
          <span className="grid">
            <span>{row.teacher || '—'}</span>
            {row.substitute ? (
              <small className="text-xs text-muted-foreground">{row.substitute}</small>
            ) : null}
          </span>
        ),
      },
      { key: 'room', label: 'Derslik' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={row.statusLabel}
            tone={row.cancelled ? 'red' : row.substitute ? 'amber' : 'purple'}
          />
        ),
      },
    ],
    [openLesson],
  )

  function download() {
    void csv.download(page.title, CSV_COLUMNS, async () =>
      (await fetchAll(query)).map((lesson) =>
        scheduleCsvRow(scheduleLesson(lesson, lookups, 'admin')),
      ),
    )
  }

  function onCommand(command: LessonCommand, lessonId: string) {
    if (command === 'edit') lessonForm.open(lessonId)
    else if (command === 'substitute') substituteForm.open(lessonId)
    else cancelForm.open(lessonId)
  }

  const step = view === 'gun' ? 1 : 7
  const current = view === 'gun' ? today : weekStart(today)
  const anchorStart = view === 'gun' ? anchor : weekStart(anchor)
  const goTo = (key: string) => setFilter('day', key === today ? '' : key)
  const classChoices = classOptions(lookups)
  const teacherChoices = [...lookups.teachers.values()]
    .filter((teacher) => teacher.isActive)
    .sort((left, right) => left.name.localeCompare(right.name, 'tr'))

  const toolbar = (
    <div
      role="group"
      aria-label="Program süzgeçleri"
      className="flex flex-wrap items-end gap-3 border-b px-6 py-4 max-[650px]:px-4"
    >
      <ToggleGroup
        type="single"
        variant="outline"
        value={view}
        onValueChange={(value) => {
          if (value) setFilter('view', value === 'hafta' ? '' : value)
        }}
        aria-label="Görünüm"
      >
        {SCHEDULE_VIEWS.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className="min-h-9 px-3 data-[state=on]:bg-primary-soft data-[state=on]:font-semibold data-[state=on]:text-primary"
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <NativeSelect
        aria-label="Sınıf süzgeci"
        value={classId || ALL}
        onChange={(event) => setFilter('classId', event.target.value)}
        className="min-h-9 text-sm"
      >
        <NativeSelectOption value={ALL}>Tüm sınıflar</NativeSelectOption>
        {classChoices.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {canManage ? (
        <NativeSelect
          aria-label="Öğretmen süzgeci"
          value={teacherId || ALL}
          onChange={(event) => setFilter('teacherId', event.target.value)}
          className="min-h-9 text-sm"
        >
          <NativeSelectOption value={ALL}>Tüm öğretmenler</NativeSelectOption>
          {teacherChoices.map((teacher) => (
            <NativeSelectOption key={teacher.id} value={teacher.id}>
              {teacher.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : null}
      <Input
        type="search"
        aria-label="Derslik süzgeci"
        placeholder="Derslik"
        value={roomInput}
        maxLength={80}
        onChange={(event) => setFilter('room', event.target.value)}
        className="min-h-9 w-36 text-sm"
      />
      {view === 'liste' ? (
        <>
          <Input
            type="date"
            aria-label="Başlangıç günü"
            value={from}
            max={to || undefined}
            onChange={(event) => setFilter('from', event.target.value)}
            className="min-h-9 w-auto text-sm"
          />
          <Input
            type="date"
            aria-label="Bitiş günü"
            value={to}
            min={from || undefined}
            onChange={(event) => setFilter('to', event.target.value)}
            className="min-h-9 w-auto text-sm"
          />
        </>
      ) : null}
      {canManage ? (
        <div className="flex min-h-9 items-center gap-2">
          <Checkbox
            id="iptalleri-goster"
            checked={showCancelled}
            onCheckedChange={(checked) => setFilter('cancelled', checked === true ? SHOWN : '')}
          />
          <Label htmlFor="iptalleri-goster" className="text-sm">
            İptalleri göster
          </Label>
        </div>
      ) : null}
    </div>
  )

  const loading = ranged.isPending || data.pending
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          canManage ? (
            <Button onClick={() => lessonForm.open(NEW_LESSON)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Ders planla
            </Button>
          ) : undefined
        }
      />
      {data.error ? <LookupError error={data.error} onRetry={data.retry} /> : null}
      <section
        aria-labelledby="program-yonetimi-baslik"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4 max-[650px]:px-4">
          <div className="min-w-0">
            <h2 id="program-yonetimi-baslik" className="text-lg font-semibold">
              {view === 'liste' ? TABLE_NAME : rangeTitle(view, anchor)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {canManage ? 'Kurumun ders programı' : 'Asıl ya da yedek olduğunuz dersler'}
            </p>
          </div>
          {view === 'liste' ? (
            <Button
              variant="secondary"
              onClick={download}
              disabled={csv.busy || reversed}
              aria-busy={csv.busy || undefined}
            >
              <Icon name="Download" size={17} aria-hidden="true" />
              Listeyi indir
            </Button>
          ) : (
            <PeriodNav
              unit={view === 'gun' ? 'gun' : 'hafta'}
              onPrevious={() => goTo(addDays(anchorStart, -step))}
              onCurrent={() => goTo(today)}
              onNext={() => goTo(addDays(anchorStart, step))}
              atCurrent={anchorStart === current}
            />
          )}
        </header>
        {toolbar}
        {view === 'liste' ? (
          <ServerDataTable
            list={list}
            rows={reversed ? [] : rows}
            total={reversed ? 0 : (paged.data?.total ?? 0)}
            sortable={NO_SORT}
            columns={columns}
            mobileColumns={MOBILE_COLUMNS}
            search={false}
            caption={TABLE_NAME}
            empty="Bu aralıkta ders yok."
            emptyFiltered="Bu süzgeçlere uyan ders yok."
            loading={!reversed && paged.isPending}
            fetching={paged.isFetching && !paged.isPending}
            externalActive={Boolean(classId || teacherId || roomInput || from || to)}
            externalLabel="Seçili süzgeçler"
            error={
              reversed ? (
                <p className="text-sm text-danger">Başlangıç günü bitiş gününden sonra olamaz.</p>
              ) : paged.error ? (
                <QueryError error={paged.error} onRetry={() => void paged.refetch()} />
              ) : undefined
            }
            onRowClick={(row) => openLesson(row.id)}
          />
        ) : ranged.error ? (
          <div role="alert" className="p-8">
            <QueryError error={ranged.error} onRetry={() => void ranged.refetch()} />
          </div>
        ) : loading ? (
          <p role="status" className="p-8 text-center text-base text-muted-foreground">
            Program yükleniyor…
          </p>
        ) : (
          <ScheduleDays
            days={days}
            byDay={byDay}
            onOpen={openLesson}
            label={view === 'gun' ? 'Günlük ders programı' : 'Haftalık ders programı'}
            hideEmptyWeekend={view === 'hafta'}
          />
        )}
      </section>
      <LessonPanel
        lessonId={panel.selectedId}
        lookups={lookups}
        onClose={panel.close}
        canManage={canManage}
        onCommand={onCommand}
      />
      {canManage && lessonForm.selectedId ? (
        <LessonFormDialog
          key={lessonForm.selectedId}
          target={lessonForm.selectedId}
          lookups={lookups}
          onClose={lessonForm.close}
        />
      ) : null}
      {canManage && substituteForm.selectedId ? (
        <SubstituteDialog
          key={substituteForm.selectedId}
          lessonId={substituteForm.selectedId}
          lookups={lookups}
          onClose={substituteForm.close}
        />
      ) : null}
      {canManage && cancelForm.selectedId ? (
        <CancelDialog
          key={cancelForm.selectedId}
          lessonId={cancelForm.selectedId}
          lookups={lookups}
          onClose={cancelForm.close}
        />
      ) : null}
    </>
  )
}
