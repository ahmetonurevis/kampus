import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/Icon.tsx'
import { useCoreFetchAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import {
  collectionQueryFromList,
  exportQueryFromList,
  sortableColumns,
  type CollectionListConfig,
} from '@/lib/collection-list.ts'
import type { FilterField } from '@/lib/list-query.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { LookupError, TableSection } from './AcademicParts.tsx'
import { teacherClassRow, ROLE_HOMEROOM, type TeacherClassRow } from './academic-rows.ts'
import { GradesView } from './GradesView.tsx'
import { TeacherClassPanel } from './TeacherClassPanel.tsx'
import { useAcademicLookups } from './use-academic-lookups.ts'

const CLASS_LIST = {
  sortFields: { name: 'name' },
  filterFields: { grade: 'grade' },
} satisfies CollectionListConfig
const CLASS_URL_FILTERS = { grade: 'duzey' }
const SORTABLE = sortableColumns(CLASS_LIST)
const MOBILE_COLUMNS = ['level', 'count', 'duty']

type Tab = 'siniflar' | 'notlar'
const TABS: readonly LineTabOption<Tab>[] = [
  { value: 'siniflar', label: 'Sınıflar', icon: 'UsersRound' },
  { value: 'notlar', label: 'Not listesi', icon: 'Award' },
]
const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab.value === value)

/**
 * Sınıflarım (öğretmen, Vue `Academic.vue` `siniflarim`): kapsamdaki sınıflar ve Not listesi
 * sekmesi. Sınıf ve öğrenci kapsamı sunucuda school-core'dan gelir (öğretmen yalnız ders
 * verdiği ve danışmanı olduğu sınıfları, kendi branşının notlarını görür). Sınıf özetinden
 * öğrenci profiline (`/ogretmen/ogrenci/:id`, `TeacherStudentProfilePage`) geçilir.
 */
export function TeacherClassesPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const [params, setParams] = useSearchParams()
  const requested = params.get('sekme')
  const tab: Tab = isTab(requested) ? requested : 'siniflar'
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="mb-6">
        <LineTabs
          label="Sınıflarım bölümleri"
          value={tab}
          options={TABS}
          onChange={(next) =>
            setParams(next === 'siniflar' ? {} : { sekme: next }, { preventScrollReset: true })
          }
        />
      </div>
      {tab === 'siniflar' ? (
        <ClassesTable title={page.title} />
      ) : (
        <GradesView audience="teacher" urlPrefix="not-" title="Not listesi" />
      )}
    </>
  )
}

function ClassesTable({ title }: { title: string }) {
  const data = useAcademicLookups()
  const { lookups, sources } = data
  // Öğretmenin `teachers` okuması yalnız kendi kaydını döndürür.
  const teacherId = [...lookups.teachers.keys()][0] ?? ''

  const list = useListState('siniflarim', { urlFilters: CLASS_URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const classes = useCoreList('classes', collectionQueryFromList(list.state, CLASS_LIST, search))
  const rows = useMemo(
    () => classes.data?.rows.map((item) => teacherClassRow(item, lookups, teacherId)),
    [classes.data, lookups, teacherId],
  )
  const panel = useDetailPanel('sinif')
  const openClass = panel.open
  const fetchAll = useCoreFetchAll('classes')
  const csv = useCsvExport()

  const gradeFilter = useMemo<FilterField[]>(() => {
    const grades = [...new Set(sources.classes.map((item) => item.record.grade))].sort(
      (left, right) => left - right,
    )
    return [
      {
        key: 'grade',
        label: 'Sınıf düzeyi',
        options: grades.map((grade) => ({ value: String(grade), label: `${grade}. Sınıf` })),
      },
    ]
  }, [sources.classes])

  const columns = useMemo<DataColumn<TeacherClassRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Sınıf',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.name} size="small" />
            <button
              type="button"
              onClick={() => openClass(row.id)}
              className="record-link text-left font-medium text-primary hover:underline"
            >
              {row.name}
            </button>
          </span>
        ),
      },
      { key: 'level', label: 'Düzey' },
      { key: 'branch', label: 'Kampüs' },
      { key: 'room', label: 'Derslik' },
      { key: 'count', label: 'Öğrenci', cell: (row) => `${row.count} öğrenci` },
      {
        key: 'duty',
        label: 'Göreviniz',
        cell: (row) => (
          <StatusBadge text={row.duty} tone={row.duty === ROLE_HOMEROOM ? 'purple' : 'gray'} />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.name} özeti`}
            onClick={() => openClass(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Özet
          </Button>
        ),
      },
    ],
    [openClass],
  )

  function download() {
    const query = exportQueryFromList(list.state, CLASS_LIST, search)
    void csv.download(
      title,
      columns.filter((column) => column.key !== ACTIONS_KEY),
      async () => (await fetchAll(query)).map((item) => teacherClassRow(item, lookups, teacherId)),
    )
  }

  const total = classes.data?.total ?? 0
  return (
    <>
      {data.error ? <LookupError error={data.error} onRetry={data.retry} /> : null}
      <TableSection
        title="Sınıflarınız"
        subtitle={`${total} kayıt · Ders verdiğiniz ve danışmanı olduğunuz sınıflar`}
        onDownload={download}
        downloadBusy={csv.busy}
        downloadDisabled={data.pending}
      >
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={SORTABLE}
          filters={gradeFilter}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Sınıflarım"
          loading={classes.isPending}
          fetching={classes.isFetching && !classes.isPending}
          error={
            classes.error ? (
              <QueryError error={classes.error} onRetry={() => void classes.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openClass(row.id)}
        />
      </TableSection>
      <TeacherClassPanel
        classId={panel.selectedId}
        teacherId={teacherId}
        lookups={lookups}
        onClose={panel.close}
      />
    </>
  )
}
