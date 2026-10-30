import { useMemo } from 'react'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
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
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { ArchiveTabs } from './ArchiveTabs.tsx'
import {
  archiveViewFilter,
  isActiveFilter,
  isArchiveView,
  teacherCsvRow,
  teacherRow,
  type TeacherRow,
} from './management-rows.ts'
import { TeacherSummaryPanel } from './TeacherSummaryPanel.tsx'
import { useManagementLookups } from './use-management-lookups.ts'

const TEACHER_LIST = {
  sortFields: { name: 'name' },
  filterFields: { branchId: 'branchId', subjectId: 'subjectId' },
} satisfies CollectionListConfig
const TEACHER_URL_FILTERS = { branchId: 'kampus', subjectId: 'brans', archive: 'durum' }
const SORTABLE = sortableColumns(TEACHER_LIST)
const MOBILE_COLUMNS = ['subject', 'branch', 'attendanceRate']
const ALL = 'all'

const filterValue = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * Eğitim Kadrosu (yönetici, Vue `SchoolManagement.vue` `/personel`): sunucu sayfalı öğretmen
 * tablosu; kampüs ve branş filtresi, ad sıralaması, satırdan öğretmen özeti. Yalnız okuma.
 * TODO(D1b2): "Öğretmen ekle", düzenle/arşivle yazma uçlarıyla eklenir.
 * "Aktif kayıtlar / Arşiv" sekmesi (`?durum=arsiv`) sunucu `isActive` filtresidir.
 * TODO(api-search-joined): kampüs/branş adıyla arama (Vue'da var) ilişkili ad araması gelince.
 * TODO(api-aggregate): Vue'daki "Performans" sütunu soru/SLA verisinden hesaplanır; toplu uç
 * veya kaynak ucu gelince eklenir.
 */
export function StaffPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const data = useManagementLookups()
  const { lookups, sources } = data

  const list = useListState('ogretmenler', { urlFilters: TEACHER_URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const archived = isArchiveView(list.state.filters.archive)
  const withActive = <T extends { filters?: Record<string, string | readonly string[]> }>(
    query: T,
  ): T => ({ ...query, filters: { ...query.filters, ...isActiveFilter(archived) } })
  const teachers = useCoreList(
    'teachers',
    withActive(collectionQueryFromList(list.state, TEACHER_LIST, search)),
  )
  const rows = useMemo(
    () => teachers.data?.rows.map((item) => teacherRow(item, lookups)),
    [teachers.data, lookups],
  )
  const panel = useDetailPanel('ogretmen')
  const openTeacher = panel.open
  const fetchAll = useCoreFetchAll('teachers')
  const csv = useCsvExport()

  const branchId = filterValue(list.state.filters.branchId)
  const subjectId = filterValue(list.state.filters.subjectId)
  const setFilter = (key: 'branchId' | 'subjectId', value: string) =>
    list.dispatch({ type: 'filter', key, value: value === ALL ? '' : value })
  const setArchive = (value: string) => list.dispatch({ type: 'filter', key: 'archive', value })

  const columns = useMemo<DataColumn<TeacherRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Öğretmen',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.name} size="small" />
            <span className="grid">
              <button
                type="button"
                onClick={() => openTeacher(row.id)}
                className="record-link text-left font-medium text-primary hover:underline"
              >
                <strong className="font-medium">{row.name}</strong>
              </button>
              <small className="text-xs text-muted-foreground">{row.email}</small>
            </span>
          </span>
        ),
      },
      { key: 'subject', label: 'Branş', cell: (row) => <StatusBadge text={row.subject} /> },
      { key: 'branch', label: 'Kampüs' },
      {
        key: 'classes',
        label: 'Ders verdiği sınıflar',
        cell: (row) => (
          <span className="block max-w-[260px] truncate" title={row.classes}>
            {row.classes}
          </span>
        ),
      },
      { key: 'attendanceRate', label: 'Yoklama', cell: (row) => `%${row.attendanceRate}` },
      { key: 'homeworkRate', label: 'Ödev takibi', cell: (row) => `%${row.homeworkRate}` },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        // TODO(D1b2): "Düzenle" ve "Arşivle" yazma uçlarıyla eklenir.
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.name} özeti`}
            onClick={() => openTeacher(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Özet
          </Button>
        ),
      },
    ],
    [openTeacher],
  )

  function download() {
    const query = withActive(exportQueryFromList(list.state, TEACHER_LIST, search))
    void csv.download(
      page.title,
      columns.filter((column) => column.key !== ACTIONS_KEY),
      async () => (await fetchAll(query)).map((item) => teacherCsvRow(teacherRow(item, lookups))),
    )
  }

  const total = teachers.data?.total ?? 0
  const branchName = lookups.branches.get(branchId)?.name
  const subjectName = lookups.subjects.get(subjectId)?.name
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <Button
            variant="secondary"
            onClick={download}
            disabled={csv.busy || data.pending}
            aria-busy={csv.busy || undefined}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            Listeyi indir
          </Button>
        }
      />
      <ArchiveTabs
        archived={archived}
        onChange={setArchive}
        activeNote="İletişim, branş ve görev bilgileri."
      />
      {data.error ? (
        <div role="alert" className="mb-6 rounded-card border bg-surface p-8">
          <QueryError error={data.error} onRetry={data.retry} />
        </div>
      ) : null}
      <section
        aria-labelledby="ogretmen-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="ogretmen-tablosu" className="text-lg font-semibold">
            Branş öğretmenleri
          </h2>
          <p className="text-sm text-muted-foreground">
            {total} {archived ? 'arşiv kaydı' : 'kayıt'} · İletişim, branş ve görev bilgileri
          </p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Branş öğretmenleri"
          loading={teachers.isPending}
          fetching={teachers.isFetching && !teachers.isPending}
          error={
            teachers.error ? (
              <QueryError error={teachers.error} onRetry={() => void teachers.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openTeacher(row.id)}
          externalActive={branchId !== '' || subjectId !== ''}
          externalLabel={[branchName, subjectName].filter(Boolean).join(' · ')}
          onReset={() => {
            setFilter('branchId', ALL)
            setFilter('subjectId', ALL)
            // "Temizle" bütün filtreleri siler; kayıt durumu sekmesi arama/filtre değildir, kalır.
            setArchive(archiveViewFilter(archived))
          }}
          toolbar={
            <>
              <NativeSelect
                aria-label="Kampüs filtresi"
                value={branchId || ALL}
                onChange={(event) => setFilter('branchId', event.target.value)}
                className="min-h-9 text-sm"
              >
                <NativeSelectOption value={ALL}>Tüm kampüsler</NativeSelectOption>
                {sources.branches.map(({ record }) => (
                  <NativeSelectOption key={record.id} value={record.id}>
                    {record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Branş filtresi"
                value={subjectId || ALL}
                onChange={(event) => setFilter('subjectId', event.target.value)}
                className="min-h-9 text-sm"
              >
                <NativeSelectOption value={ALL}>Tüm branşlar</NativeSelectOption>
                {sources.subjects.map(({ record }) => (
                  <NativeSelectOption key={record.id} value={record.id}>
                    {record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </>
          }
        />
      </section>
      <TeacherSummaryPanel teacherId={panel.selectedId} lookups={lookups} onClose={panel.close} />
    </>
  )
}
