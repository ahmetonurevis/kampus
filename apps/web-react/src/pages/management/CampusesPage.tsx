import { useMemo, useState } from 'react'
import { useClassMetrics } from '@kampus/react-shared/use-management-metrics.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
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
import type { FilterField } from '@/lib/list-query.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { ArchiveDialog, useRestoreAction, type ArchiveTarget } from './ArchiveDialog.tsx'
import { ArchiveTabs } from './ArchiveTabs.tsx'
import { CampusFormPanel, NEW_RECORD } from './CampusFormPanel.tsx'
import { CampusSummaryPanel } from './CampusSummaryPanel.tsx'
import { ClassFormModal } from './ClassFormModal.tsx'
import { ClassSummaryPanel } from './ClassSummaryPanel.tsx'
import { canManageStructure } from './management-forms.ts'
import { RecordActions, type RecordActionHandlers } from './RecordActions.tsx'
import {
  archiveViewFilter,
  averageText,
  campusesInView,
  campusSummaries,
  classCsvRow,
  classRow,
  isActiveFilter,
  isArchiveView,
  metricValues,
  type CampusSummary,
  type ClassRow,
} from './management-rows.ts'
import { CampusStats } from './ManagementStats.tsx'
import { useManagementLookups } from './use-management-lookups.ts'

// Sunucu listesi yapılandırması: hangi sütun sunucuda sıralanır, hangi filtre hangi alana gider.
const CLASS_LIST = {
  sortFields: { name: 'name', branch: 'branchName' },
  filterFields: { branchId: 'branchId', grade: 'grade' },
} satisfies CollectionListConfig
const CLASS_URL_FILTERS = { branchId: 'kampus', grade: 'duzey', archive: 'durum' }
const SORTABLE = sortableColumns(CLASS_LIST)
const GRADE_FILTER: FilterField[] = [
  {
    key: 'grade',
    label: 'Sınıf düzeyi',
    options: Array.from({ length: 8 }, (_, index) => ({
      value: String(index + 5),
      label: `${index + 5}. Sınıf`,
    })),
  },
]
const MOBILE_COLUMNS = ['branch', 'count', 'teacher']
const ALL = 'all'

/**
 * Kampüsler & Sınıflar (yönetici, Vue `SchoolManagement.vue` `/subeler`): kampüs kartları ve
 * sunucu sayfalı sınıf tablosu; satır ve kartlar sağ panelde özet açar. Yönetici kampüs ve sınıf
 * ekler, düzenler, arşivler ve geri alır (ön büro ve diğer roller salt okur): kampüs formu sağ
 * panelde (`?kampus-form=`), sınıf formu geniş pencerede (`?sinif-form=`) açılır; arşiv onayı
 * aktarım hedefini sorar.
 * "Aktif kayıtlar / Arşiv" sekmesi (`?durum=arsiv`) sınıf tablosunda sunucu `isActive` filtresidir;
 * kampüs kartları aynı sekmeyle başvuru koleksiyonundan süzülür.
 * Arama sunucuda sınıfın alanlarında ve kampüs adında (`q`), kampüs sütunu kampüs adına göre
 * (`branchName`) sıralanır. Öğrenci sayıları `counts?groupBy=classId` yanıtındandır.
 * "Ortalama" sütunu sunucu toplamıdır (`GET /class-metrics`, SQL; IST-010): not kayıtları
 * çekilmez. Sütun sunucuda sıralanamaz (ölçü kaydın alanı değil).
 */
export function CampusesPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const data = useManagementLookups({ studentCounts: true })
  const { lookups, sources } = data
  const allCampuses = useMemo(() => campusSummaries(sources, lookups), [sources, lookups])

  const list = useListState('siniflar', { urlFilters: CLASS_URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const archived = isArchiveView(list.state.filters.archive)
  const campuses = useMemo(() => campusesInView(allCampuses, archived), [allCampuses, archived])
  const withActive = <T extends { filters?: Record<string, string | readonly string[]> }>(
    query: T,
  ): T => ({ ...query, filters: { ...query.filters, ...isActiveFilter(archived) } })
  const classes = useCoreList(
    'classes',
    withActive(collectionQueryFromList(list.state, CLASS_LIST, search)),
  )
  const metrics = useClassMetrics()
  const averages = useMemo(
    () =>
      metricValues(
        metrics.data?.data,
        (row) => row.classId,
        (row) => row.averageScore,
      ),
    [metrics.data],
  )
  const rows = useMemo(
    () => classes.data?.rows.map((item) => classRow(item, lookups, averages)),
    [classes.data, lookups, averages],
  )
  const classPanel = useDetailPanel('sinif')
  const openClass = classPanel.open
  const campusPanel = useDetailPanel('kampus-ozet')
  const campusForm = useDetailPanel('kampus-form')
  const classForm = useDetailPanel('sinif-form')
  const { session } = useAuth()
  const canManage = canManageStructure(session?.role)
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null)
  const restoreCampus = useRestoreAction('branch')
  const restoreClass = useRestoreAction('class')
  const openClassForm = classForm.open
  const openCampusForm = campusForm.open
  const fetchAll = useCoreFetchAll('classes')
  const csv = useCsvExport()

  const branchId =
    typeof list.state.filters.branchId === 'string' ? list.state.filters.branchId : ''
  const setBranch = (value: string) =>
    list.dispatch({ type: 'filter', key: 'branchId', value: value === ALL ? '' : value })
  const setArchive = (value: string) => list.dispatch({ type: 'filter', key: 'archive', value })

  const classActions: RecordActionHandlers = {
    canManage,
    onEdit: openClassForm,
    onArchive: (id) => setArchiveTarget({ kind: 'class', id }),
    onRestore: (id) => restoreClass.restore(id, lookups.classes.get(id)?.name ?? 'Sınıf'),
    restoring: restoreClass.pending,
  }
  const campusActions: RecordActionHandlers = {
    canManage,
    onEdit: openCampusForm,
    onArchive: (id) => setArchiveTarget({ kind: 'branch', id }),
    onRestore: (id) => restoreCampus.restore(id, lookups.branches.get(id)?.name ?? 'Kampüs'),
    restoring: restoreCampus.pending,
  }

  const columns = useMemo<DataColumn<ClassRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Sınıf',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.name} size="small" />
            <span className="grid">
              <button
                type="button"
                onClick={() => openClass(row.id)}
                className="record-link text-left font-medium text-primary hover:underline"
              >
                <strong className="font-medium">{row.name}</strong>
              </button>
              <small className="text-xs text-muted-foreground">{row.detail}</small>
            </span>
          </span>
        ),
      },
      { key: 'branch', label: 'Kampüs' },
      { key: 'teacher', label: 'Sınıf danışmanı' },
      {
        key: 'count',
        label: 'Öğrenci / Kontenjan',
        cell: (row) => (
          <>
            <strong className="font-semibold">{row.count}</strong> / {row.capacity}
          </>
        ),
      },
      { key: 'lessons', label: 'Branş' },
      { key: 'average', label: 'Ortalama', cell: (row) => averageText(row.average) },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${row.name} özeti`}
              onClick={() => openClass(row.id)}
            >
              <Icon name="Eye" size={15} aria-hidden="true" />
              Özet
            </Button>
            <RecordActions
              id={row.id}
              name={row.name}
              archived={row.status === 'Arşivde'}
              canManage={canManage}
              onEdit={openClassForm}
              onArchive={(id) => setArchiveTarget({ kind: 'class', id })}
              onRestore={(id) => restoreClass.restore(id, row.name)}
              restoring={restoreClass.pending}
            />
          </span>
        ),
      },
    ],
    [openClass, openClassForm, canManage, restoreClass],
  )

  function download() {
    const query = withActive(exportQueryFromList(list.state, CLASS_LIST, search))
    void csv.download(
      page.title,
      columns.filter((column) => column.key !== ACTIONS_KEY),
      async () =>
        (await fetchAll(query)).map((item) => classCsvRow(classRow(item, lookups, averages))),
    )
  }

  const total = classes.data?.total ?? 0
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={download}
              disabled={csv.busy || data.pending}
              aria-busy={csv.busy || undefined}
            >
              <Icon name="Download" size={17} aria-hidden="true" />
              Listeyi indir
            </Button>
            {canManage ? (
              <>
                <Button variant="secondary" onClick={() => openCampusForm(NEW_RECORD)}>
                  <Icon name="Plus" size={17} aria-hidden="true" />
                  Kampüs ekle
                </Button>
                <Button onClick={() => openClassForm(NEW_RECORD)}>
                  <Icon name="Plus" size={17} aria-hidden="true" />
                  Sınıf ekle
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <CampusStats />
      <ArchiveTabs
        archived={archived}
        onChange={setArchive}
        activeNote="Sınıf danışmanı ve branş öğretmenleri ayrı ayrı atanır."
      />
      {data.error ? (
        <div role="alert" className="mb-6 rounded-card border bg-surface p-8">
          <QueryError error={data.error} onRetry={data.retry} />
        </div>
      ) : (
        <CampusCards
          campuses={campuses}
          archived={archived}
          pending={data.pending}
          onOpen={(id) => campusPanel.open(id)}
          actions={campusActions}
        />
      )}
      <section
        aria-labelledby="sinif-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="sinif-tablosu" className="text-lg font-semibold">
            Sınıflar ve ders atamaları
          </h2>
          <p className="text-sm text-muted-foreground">
            {total} {archived ? 'arşiv kaydı' : 'kayıt'} · 5–12. sınıf düzeyleri
          </p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={SORTABLE}
          filters={GRADE_FILTER}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Sınıflar ve ders atamaları"
          loading={classes.isPending}
          fetching={classes.isFetching && !classes.isPending}
          error={
            classes.error ? (
              <QueryError error={classes.error} onRetry={() => void classes.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => classPanel.open(row.id)}
          externalActive={branchId !== ''}
          externalLabel={`Kampüs: ${lookups.branches.get(branchId)?.name ?? ''}`}
          onReset={() => {
            setBranch(ALL)
            // "Temizle" bütün filtreleri siler; kayıt durumu sekmesi arama/filtre değildir, kalır.
            setArchive(archiveViewFilter(archived))
          }}
          toolbar={
            <NativeSelect
              aria-label="Kampüs filtresi"
              value={branchId || ALL}
              onChange={(event) => setBranch(event.target.value)}
              className="min-h-9 text-sm"
            >
              <NativeSelectOption value={ALL}>Tüm kampüsler</NativeSelectOption>
              {sources.branches.map(({ record }) => (
                <NativeSelectOption key={record.id} value={record.id}>
                  {record.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          }
        />
      </section>
      <ClassSummaryPanel
        classId={classPanel.selectedId}
        lookups={lookups}
        actions={classActions}
        onClose={classPanel.close}
      />
      <CampusSummaryPanel
        campusId={campusPanel.selectedId}
        campuses={campuses}
        lookups={lookups}
        actions={campusActions}
        onClose={campusPanel.close}
      />
      {/* Formlar yalnız yönetici içindir ve başvuru verisi (kampüs, öğretmen, atama) yüklenince açılır. */}
      {canManage && !data.pending ? (
        <>
          <CampusFormPanel target={campusForm.selectedId} onClose={campusForm.close} />
          <ClassFormModal
            target={classForm.selectedId}
            lookups={lookups}
            onClose={classForm.close}
          />
        </>
      ) : null}
      <ArchiveDialog
        target={canManage ? archiveTarget : null}
        lookups={lookups}
        onClose={() => setArchiveTarget(null)}
      />
    </>
  )
}

function CampusCards({
  campuses,
  archived,
  pending,
  onOpen,
  actions,
}: {
  campuses: readonly CampusSummary[]
  archived: boolean
  pending: boolean
  onOpen: (id: string) => void
  actions: RecordActionHandlers
}) {
  if (pending)
    return (
      <p role="status" className="mb-6 text-sm text-muted-foreground">
        Kampüsler yükleniyor…
      </p>
    )
  if (!campuses.length)
    return (
      <div className="mb-6">
        <EmptyState icon="School" title={archived ? 'Arşivde kampüs yok' : 'Henüz kampüs yok'} />
      </div>
    )
  return (
    <ul
      aria-label="Kampüsler"
      className="campus-grid mb-6 grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-4"
    >
      {campuses.map((campus) => (
        <li key={campus.id} className="campus-card rounded-card border bg-surface p-6">
          <div className="campus-top mb-4 flex items-start justify-between gap-3">
            <span className="mini-icon grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
              <Icon name="School" size={24} aria-hidden="true" />
            </span>
            <StatusBadge
              text={campus.status === 'Aktif' ? 'Aktif kampüs' : 'Arşivde'}
              tone={campus.status === 'Aktif' ? 'green' : 'gray'}
            />
          </div>
          <h2 className="text-lg font-semibold">{campus.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{campus.address}</p>
          <dl className="campus-metrics mt-5 grid grid-cols-3 gap-2 border-t pt-4">
            {[
              { label: 'Sınıf', value: campus.classes.length },
              { label: 'Öğrenci', value: campus.students },
              { label: 'Öğretmen', value: campus.teachers },
            ].map((metric) => (
              <div key={metric.label} className="flex flex-col-reverse">
                <dt className="text-xs text-muted-foreground">{metric.label}</dt>
                <dd className="text-xl font-semibold">{metric.value}</dd>
              </div>
            ))}
          </dl>
          <div className="catalog-actions mt-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${campus.name} özeti`}
              onClick={() => onOpen(campus.id)}
            >
              <Icon name="Eye" size={15} aria-hidden="true" />
              Özeti aç
            </Button>
            <RecordActions
              {...actions}
              id={campus.id}
              name={campus.name}
              archived={campus.status === 'Arşivde'}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
