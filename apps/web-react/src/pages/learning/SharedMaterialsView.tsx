import { useMemo } from 'react'
import {
  isLearnerDetail,
  isLearnerItem,
  resourceListQuery,
  type LearnerResourceListItem,
} from '@kampus/react-shared/resource-model.ts'
import { useResourceDetail, useResourceList } from '@kampus/react-shared/use-resources.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { ResourceFileList } from '../content/ResourceFileList.tsx'
import { tagSummary } from '../content/content-pool-model.ts'

const SORTABLE = ['title']
const MOBILE_COLUMNS = ['tags']
/** Bu görünümde yalnız materyal dosyası türündeki kaynaklar listelenir (DOM-KYN-006). */
const MATERIAL_FILTER = { contentType: 'file' } as const

type SharedRow = { id: string; title: string; tags: string }

const sharedRow = (
  item: LearnerResourceListItem,
  subjectNames: ReadonlyMap<string, string>,
): SharedRow => ({
  id: item.id,
  title: item.version.title,
  tags: tagSummary(item.version.tags, subjectNames),
})

/**
 * Paylaşılan dosyalar (öğrenci; DOM-KYN-006, 040, 041): öğretmenin paylaştığı, yayındaki materyal
 * dosyaları sunucu sayfalı listede. Kapsam, düzey ve lisans süzgecini sunucu uygular; satırdan
 * sağ panelde dosyalar açılır. Yalnız okuma.
 */
export function SharedMaterialsView() {
  const { session } = useAuth()
  const languageSchool = session?.institution.type === 'language_school'
  const list = useListState('paylasilan-materyaller', { urlPrefix: 'dosya-' })
  const search = useDebouncedValue(list.state.query)
  const query = resourceListQuery({
    page: list.state.page,
    pageSize: list.state.pageSize,
    q: search,
    filters: MATERIAL_FILTER,
    sortKey: list.state.sortKey,
    sortDirection: list.state.sortDirection,
    userId: '',
  })
  const resources = useResourceList(query)
  const subjects = useCoreAll('subjects', {}, { enabled: !languageSchool })
  const subjectNames = useMemo(
    () => new Map((subjects.data ?? []).map(({ record }) => [record.id, record.name])),
    [subjects.data],
  )
  const rows = useMemo(
    () => resources.data?.data.filter(isLearnerItem).map((item) => sharedRow(item, subjectNames)),
    [resources.data, subjectNames],
  )
  const panel = useDetailPanel('paylasilan')
  const openPanel = panel.open

  const columns = useMemo<DataColumn<SharedRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Materyal',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openPanel(row.id)}
            aria-label={`${row.title} dosyalarını göster`}
            className="record-link text-left font-medium text-primary [overflow-wrap:anywhere] hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      {
        key: 'tags',
        label: 'Ders ve düzey',
        cell: (row) => <span className="[overflow-wrap:anywhere]">{row.tags}</span>,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.title} dosyaları`}
            onClick={() => openPanel(row.id)}
          >
            <Icon name="FolderOpen" size={15} aria-hidden="true" />
            Dosyalar
          </Button>
        ),
      },
    ],
    [openPanel],
  )

  const total = resources.data?.meta.total ?? 0
  return (
    <>
      <section
        aria-labelledby="paylasilan-dosyalar"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="paylasilan-dosyalar" className="text-lg font-semibold">
            Paylaşılan dosyalar
          </h2>
          <p className="text-sm text-muted-foreground">{total} paylaşılan materyal</p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Paylaşılan dosyalar"
          loading={resources.isPending}
          fetching={resources.isFetching && !resources.isPending}
          empty="Öğretmenleriniz henüz dosya paylaşmadı."
          emptyFiltered="Aramanızla eşleşen dosya bulunamadı."
          error={
            resources.error ? (
              <QueryError error={resources.error} onRetry={() => void resources.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openPanel(row.id)}
        />
      </section>
      <SharedMaterialPanel
        resourceId={panel.selectedId}
        onClose={panel.close}
        subjectNames={subjectNames}
      />
    </>
  )
}

function SharedMaterialPanel({
  resourceId,
  onClose,
  subjectNames,
}: {
  resourceId: string
  onClose: () => void
  subjectNames: ReadonlyMap<string, string>
}) {
  const detail = useResourceDetail(resourceId)
  const data = detail.data?.data
  const learner = data && isLearnerDetail(data) ? data : null
  return (
    <SidePanel
      open={resourceId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={learner ? learner.version.title : 'Materyal dosyaları'}
    >
      {detail.error ? (
        <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
      ) : learner ? (
        <div className="grid gap-5">
          <p className="text-sm text-muted-foreground">
            {tagSummary(learner.version.tags, subjectNames)}
          </p>
          <ResourceFileList files={learner.version.files} />
          {learner.version.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu materyalde açılabilecek dosya yok.</p>
          ) : null}
          {learner.version.attributions.length > 0 ? (
            <section aria-label="Kaynak gösterimi">
              <h3 className="mb-1.5 text-sm font-semibold">Kaynak gösterimi</h3>
              <ul className="grid gap-1 text-sm">
                {learner.version.attributions.map((item) => (
                  <li key={`${item.work}:${item.author}:${item.source}`}>
                    <span className="font-medium">{item.work}</span> — {item.author}, {item.source}
                    {item.year ? ` (${item.year})` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Materyal yükleniyor…
        </p>
      )}
    </SidePanel>
  )
}
