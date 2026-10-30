import { useMemo } from 'react'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { collectionQueryFromList, sortableColumns } from '@/lib/collection-list.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { ClassSubjectFilters, filterValue, useClassSubjectFilters } from './LearningFilters.tsx'
import { MATERIAL_LIST, materialRow, type MaterialRow } from './learning-rows.ts'
import { MaterialPanel } from './MaterialPanel.tsx'

const URL_FILTERS = { subjectId: 'ders' }
const SORTABLE = sortableColumns(MATERIAL_LIST)
const MOBILE_COLUMNS = ['subject', 'level']
const NONE: readonly never[] = []

/**
 * Materyal Kütüphanesi (öğretmen, Vue `Learning.vue` `/materyal-yukle`): öğretmenin paylaştığı
 * materyaller sunucu sayfalı; ders filtresi, başlık araması, satırdan içerik özeti. Yalnız okuma.
 * TODO(api-material-write): materyal yükleme dosya depolama ADR'si (0003) onaylanınca gelir.
 * TODO(api-video): video kütüphanesi ayrı görevdir.
 */
export function TeacherMaterialsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  // Öğretmen kapsamı bütün materyalleri okur; "paylaştıklarım" kendi kimliğiyle süzülür.
  const teachers = useCoreAll('teachers')
  const teacherId = teachers.data?.[0]?.record.id
  const filters = useClassSubjectFilters(NONE)

  const list = useListState('materyaller', { urlFilters: URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const query = useMemo(() => {
    const base = collectionQueryFromList(list.state, MATERIAL_LIST, search)
    return { ...base, filters: { ...base.filters, ...(teacherId ? { teacherId } : {}) } }
  }, [list.state, search, teacherId])
  const materials = useCoreList('materials', query, { enabled: teacherId !== undefined })
  const rows = useMemo(() => materials.data?.rows.map(materialRow), [materials.data])

  const panel = useDetailPanel('materyal')
  const openMaterial = panel.open
  const subjectId = filterValue(list.state.filters.subjectId)

  const columns = useMemo<DataColumn<MaterialRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Materyal',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openMaterial(row.id)}
            aria-label={`${row.title} özetini aç`}
            className="record-link max-w-[340px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'subject', label: 'Ders', cell: (row) => <StatusBadge text={row.subject} /> },
      { key: 'level', label: 'Düzey' },
      { key: 'type', label: 'Tür' },
      { key: 'fileName', label: 'Dosya' },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.title} özeti`}
            onClick={() => openMaterial(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Özet
          </Button>
        ),
      },
    ],
    [openMaterial],
  )

  const error = teachers.error ?? materials.error
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <section
        aria-labelledby="materyal-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="materyal-tablosu" className="text-lg font-semibold">
            Paylaştığınız materyaller
          </h2>
          <p className="text-sm text-muted-foreground">{materials.data?.total ?? 0} materyal</p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={materials.data?.total ?? 0}
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Paylaştığınız materyaller"
          loading={teachers.isPending || (teacherId !== undefined && materials.isPending)}
          fetching={materials.isFetching && !materials.isPending}
          error={
            error ? (
              <QueryError
                error={error}
                onRetry={() => {
                  if (teachers.error) void teachers.refetch()
                  if (materials.error) void materials.refetch()
                }}
              />
            ) : undefined
          }
          onRowClick={(row) => openMaterial(row.id)}
          externalActive={subjectId !== ''}
          externalLabel={subjectId ? `Ders: ${filters.subjectName(subjectId)}` : ''}
          onReset={() => list.dispatch({ type: 'filter', key: 'subjectId', value: '' })}
          toolbar={
            <ClassSubjectFilters
              filters={filters}
              classId=""
              subjectId={subjectId}
              withClass={false}
              onChange={(key, value) => list.dispatch({ type: 'filter', key, value })}
            />
          }
        />
      </section>
      <MaterialPanel materialId={panel.selectedId} onClose={panel.close} />
    </>
  )
}
