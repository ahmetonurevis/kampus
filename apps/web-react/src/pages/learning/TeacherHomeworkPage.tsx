import { useMemo } from 'react'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { collectionQueryFromList, sortableColumns } from '@/lib/collection-list.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { HomeworkDeliveryPanel } from './HomeworkDeliveryPanel.tsx'
import { ClassSubjectFilters, filterValue, useClassSubjectFilters } from './LearningFilters.tsx'
import {
  HOMEWORK_LIST,
  learningLookups,
  teacherHomeworkRow,
  uniqueValues,
  type TeacherHomeworkRow,
} from './learning-rows.ts'

const URL_FILTERS = { classId: 'sinif', subjectId: 'ders' }
const SORTABLE = sortableColumns(HOMEWORK_LIST)
const MOBILE_COLUMNS = ['className', 'dueDate', 'delivered']
const NONE: readonly never[] = []

/**
 * Ödevler & Değerlendirme (öğretmen, Vue `Learning.vue` `/odevler`): kapsamdaki sınıfların
 * ödevleri sunucu sayfalı; sınıf ve ders filtresi, başlık araması, son teslim sıralaması. Satırdan
 * açılan panel teslim eden/geciken/bekleyen sayılarını ve öğrenci durumunu gösterir. Yalnız okuma.
 * TODO(api-homework-write): ödev atama, teslim değerlendirme ve geri bildirim yazma uçlarıyla gelir.
 * TODO(api-aggregate): teslim sayıları sayfadaki ödevlerin teslimlerinden hesaplanır; toplu uç
 * gelince tek sorguya iner.
 */
export function TeacherHomeworkPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const classes = useCoreAll('classes')
  const students = useCoreAll('students')
  const lookups = useMemo(
    () => learningLookups(classes.data ?? NONE, students.data ?? NONE),
    [classes.data, students.data],
  )
  const filters = useClassSubjectFilters(classes.data ?? NONE)

  const list = useListState('odevler', { urlFilters: URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const homework = useCoreList(
    'homework',
    collectionQueryFromList(list.state, HOMEWORK_LIST, search),
  )
  const ids = useMemo(() => homework.data?.rows.map((row) => row.record.id) ?? [], [homework.data])
  const submissions = useCoreAll(
    'submissions',
    { filters: { homeworkId: uniqueValues(ids) } },
    { enabled: ids.length > 0 },
  )
  const rows = useMemo(() => {
    const entries = submissions.data?.map((row) => row.record) ?? NONE
    return homework.data?.rows.map((item) => teacherHomeworkRow(item, entries, lookups))
  }, [homework.data, submissions.data, lookups])
  // Teslimler gelene kadar sayılar yanıltmasın: satırlar görünür, teslim sütunu "…" kalır.
  const countsReady = ids.length === 0 || submissions.data !== undefined

  const panel = useDetailPanel('odev')
  const openHomework = panel.open

  const classId = filterValue(list.state.filters.classId)
  const subjectId = filterValue(list.state.filters.subjectId)

  const columns = useMemo<DataColumn<TeacherHomeworkRow>[]>(
    () => [
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
        key: 'delivered',
        label: 'Teslim',
        cell: (row) => (countsReady ? `${row.delivered} / ${row.total}` : '…'),
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
    ],
    [openHomework, countsReady],
  )

  const error = homework.error ?? classes.error ?? students.error
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <section
        aria-labelledby="odev-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="odev-tablosu" className="text-lg font-semibold">
            Ödev ve teslim listesi
          </h2>
          <p className="text-sm text-muted-foreground">
            {homework.data?.total ?? 0} ödev · Sınıflarınızın ödevleri ve teslim durumu
          </p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={homework.data?.total ?? 0}
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Ödev ve teslim listesi"
          loading={homework.isPending}
          fetching={homework.isFetching && !homework.isPending}
          error={
            error ? (
              <QueryError
                error={error}
                onRetry={() => {
                  if (homework.error) void homework.refetch()
                  if (classes.error) void classes.refetch()
                  if (students.error) void students.refetch()
                }}
              />
            ) : undefined
          }
          onRowClick={(row) => openHomework(row.id)}
          externalActive={classId !== '' || subjectId !== ''}
          externalLabel={[
            classId ? `Sınıf: ${lookups.classes.get(classId)?.name ?? classId}` : '',
            subjectId ? `Ders: ${filters.subjectName(subjectId)}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          onReset={() => {
            list.dispatch({ type: 'filter', key: 'classId', value: '' })
            list.dispatch({ type: 'filter', key: 'subjectId', value: '' })
          }}
          toolbar={
            <ClassSubjectFilters
              filters={filters}
              classId={classId}
              subjectId={subjectId}
              onChange={(key, value) => list.dispatch({ type: 'filter', key, value })}
            />
          }
        />
      </section>
      <HomeworkDeliveryPanel
        homeworkId={panel.selectedId}
        lookups={lookups}
        onClose={panel.close}
      />
    </>
  )
}
