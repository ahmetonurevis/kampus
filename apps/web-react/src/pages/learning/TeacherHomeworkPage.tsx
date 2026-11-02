import { useMemo } from 'react'
import { countOf } from '@kampus/react-shared/collections.ts'
import type { HomeworkStatusFilter } from '@kampus/react-shared/homework.ts'
import { useHomeworkList } from '@kampus/react-shared/use-homework.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll, useCoreCounts } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { homeworkActions, type HomeworkActor } from './homework-forms.ts'
import { HomeworkDeliveryPanel } from './HomeworkDeliveryPanel.tsx'
import { NEW_HOMEWORK } from './HomeworkForms.tsx'
import { ClassSubjectFilters, filterValue, useClassSubjectFilters } from './LearningFilters.tsx'
import { teacherHomeworkRow, uniqueValues, type TeacherHomeworkRow } from './learning-rows.ts'

// Panel parametreleri (`odev`, `odev-form`, `teslim`) süzgeç adlarıyla çakışmamalı.
const URL_FILTERS = { classId: 'sinif', subjectId: 'ders', status: 'durum' }
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['className', 'dueDate', 'delivered']
const NONE: readonly never[] = []

const STATUS_OPTIONS = [
  { value: '', label: 'Tüm durumlar' },
  { value: 'open', label: 'Açık' },
  { value: 'closed', label: 'Süresi doldu' },
] as const
const isStatus = (value: string): value is Exclude<HomeworkStatusFilter, 'all'> =>
  value === 'open' || value === 'closed'

/**
 * Ödevler & Değerlendirme (öğretmen; IST-095, DOM-AKD-070…074): kapsamdaki ödevler `/homework`
 * ucundan sunucu sayfalı; sınıf, ders ve durum süzgeci. Ödev ver ve düzenle, teslim durumu,
 * değerlendirme ve arşiv aynı sağ panelde açılır. Teslim sayısı yalnız teslimleri görebilen okura
 * (ödevin öğretmeni, rehber öğretmen, yönetici) gösterilir; sınıf mevcudu sunucu sayımındandır.
 */
export function TeacherHomeworkPage({
  page,
  heading = true,
}: {
  page: NavPage
  /** Başlık dış sayfada (sekmeli) çiziliyorsa `false`. */
  heading?: boolean
}) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const actor: HomeworkActor = useMemo(
    () => ({
      role: session?.role ?? '',
      teacherId: session?.links.find((link) => link.kind === 'teacher')?.recordId ?? null,
    }),
    [session],
  )
  const canCreate = homeworkActions(actor).create
  const classes = useCoreAll('classes')
  const filters = useClassSubjectFilters(classes.data ?? NONE)

  const list = useListState('odevler', { urlFilters: URL_FILTERS })
  const classId = filterValue(list.state.filters.classId)
  const subjectId = filterValue(list.state.filters.subjectId)
  const statusValue = filterValue(list.state.filters.status)
  const status = isStatus(statusValue) ? statusValue : undefined
  const homework = useHomeworkList({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(classId ? { classId } : {}),
    ...(subjectId ? { subjectId } : {}),
    ...(status ? { status } : {}),
  })
  const classIds = useMemo(
    () => uniqueValues(homework.data?.rows.map((row) => row.classId) ?? []),
    [homework.data],
  )
  const enrolled = useCoreCounts(
    'students',
    { groupBy: 'classId', filters: { classId: classIds, isActive: 'true' } },
    { enabled: classIds.length > 0 },
  )
  const classById = useMemo(
    () => new Map((classes.data ?? NONE).map((row) => [row.record.id, row.record])),
    [classes.data],
  )
  const rows = useMemo(
    () =>
      homework.data?.rows.map((item) =>
        teacherHomeworkRow(item, {
          className: classById.get(item.classId)?.name,
          total: countOf(enrolled.data, item.classId),
        }),
      ),
    [homework.data, enrolled.data, classById],
  )
  // Teslimleri görmeyen öğretmene (başka dersin öğretmeni) sayı yerine "—" (DOM-AKD-074).
  const seesCounts = (row: TeacherHomeworkRow) =>
    actor.role === 'yonetici' ||
    (actor.teacherId !== null &&
      (row.teacherId === actor.teacherId ||
        classById.get(row.classId)?.teacherId === actor.teacherId))
  // Sayımlar gelene kadar sayılar yanıltmasın: satırlar görünür, teslim sütunu "…" kalır.
  const countsReady = classIds.length === 0 || enrolled.data !== undefined

  const detail = useDetailPanel('odev')
  const form = useDetailPanel('odev-form')
  const grading = useDetailPanel('teslim')
  const openHomework = detail.open

  const columns: DataColumn<TeacherHomeworkRow>[] = [
    {
      key: 'title',
      label: 'Ödev',
      cell: (row) => (
        <button
          type="button"
          onClick={() => openHomework(row.id)}
          aria-label={`${row.title} teslim durumunu aç`}
          className="record-link max-w-[340px] truncate text-left font-medium text-primary hover:underline"
        >
          {row.title}
        </button>
      ),
    },
    { key: 'className', label: 'Sınıf' },
    { key: 'subject', label: 'Ders' },
    {
      key: 'dueDate',
      label: 'Son teslim',
      cell: (row) => dateLabel(row.dueDate, { year: 'numeric' }),
    },
    {
      key: 'status',
      label: 'Durum',
      cell: (row) => (
        <StatusBadge
          text={row.status === 'open' ? 'Açık' : 'Süresi doldu'}
          tone={row.status === 'open' ? 'green' : 'gray'}
        />
      ),
    },
    {
      key: 'delivered',
      label: 'Teslim',
      cell: (row) =>
        !seesCounts(row) ? '—' : countsReady ? `${row.delivered} / ${row.total}` : '…',
    },
    {
      key: 'actions',
      label: 'İşlemler',
      cell: (row) => (
        <Button
          variant="secondary"
          size="sm"
          aria-label={`${row.title} teslim özeti`}
          onClick={() => openHomework(row.id)}
        >
          <Icon name="Eye" size={15} aria-hidden="true" />
          Teslimler
        </Button>
      ),
    },
  ]

  const error = homework.error ?? classes.error ?? enrolled.error
  return (
    <>
      {heading ? <PageHeading title={page.title} description={page.description} /> : null}
      <section
        aria-labelledby="odev-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div>
            <h2 id="odev-tablosu" className="text-lg font-semibold">
              Ödev ve teslim listesi
            </h2>
            <p className="text-sm text-muted-foreground">
              {homework.data?.total ?? 0} ödev · Sınıflarınızın ödevleri ve teslim durumu
            </p>
          </div>
          {canCreate ? (
            <Button type="button" onClick={() => form.open(NEW_HOMEWORK)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Ödev ver
            </Button>
          ) : null}
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={homework.data?.total ?? 0}
          sortable={NO_SORT}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          search={false}
          caption="Ödev ve teslim listesi"
          empty="Henüz ödev yok."
          emptyFiltered="Bu süzgeçlere uyan ödev yok."
          loading={homework.isPending}
          fetching={homework.isFetching && !homework.isPending}
          error={
            error ? (
              <QueryError
                error={error}
                onRetry={() => {
                  if (homework.error) void homework.refetch()
                  if (classes.error) void classes.refetch()
                  if (enrolled.error) void enrolled.refetch()
                }}
              />
            ) : undefined
          }
          onRowClick={(row) => openHomework(row.id)}
          externalActive={classId !== '' || subjectId !== '' || status !== undefined}
          externalLabel={[
            classId ? `Sınıf: ${filters.className(classId)}` : '',
            subjectId ? `Ders: ${filters.subjectName(subjectId)}` : '',
            status ? `Durum: ${status === 'open' ? 'Açık' : 'Süresi doldu'}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          onReset={() => {
            for (const key of ['classId', 'subjectId', 'status'] as const)
              list.dispatch({ type: 'filter', key, value: '' })
          }}
          toolbar={
            <>
              <ClassSubjectFilters
                filters={filters}
                classId={classId}
                subjectId={subjectId}
                onChange={(key, value) => list.dispatch({ type: 'filter', key, value })}
              />
              <NativeSelect
                aria-label="Durum"
                value={status ?? ''}
                onChange={(event) =>
                  list.dispatch({ type: 'filter', key: 'status', value: event.target.value })
                }
                className="min-h-9 text-sm"
              >
                {STATUS_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </>
          }
        />
      </section>
      <HomeworkDeliveryPanel detail={detail} form={form} grading={grading} actor={actor} />
    </>
  )
}
