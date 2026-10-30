import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { isStaffItem } from '@kampus/react-shared/resource-model.ts'
import { resourceListQuery } from '@kampus/react-shared/resource-model.ts'
import { useResourceList } from '@kampus/react-shared/use-resources.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { FilterField } from '@/lib/list-query.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { ContentDraftForm, NEW_CONTENT } from './ContentDraftForm.tsx'
import { ContentPoolPanel } from './ContentPoolPanel.tsx'
import {
  CEFR_OPTIONS,
  GRADE_OPTIONS,
  resourceRow,
  SKILL_OPTIONS,
  STATUS_OPTIONS,
  STATUS_TONES,
  TYPE_OPTIONS,
  type ResourceRow,
} from './content-pool-model.ts'

const URL_FILTERS = {
  contentType: 'tur',
  cefrLevel: 'cefr',
  primarySkill: 'beceri',
  subjectId: 'ders',
  gradeLevel: 'duzey',
  status: 'durum',
  mine: 'benim',
}
const SORTABLE = ['title', 'updatedAt']
const MOBILE_COLUMNS = ['type', 'status', 'updatedAt']
const MINE = 'yes'

const field = (
  key: string,
  label: string,
  options: readonly { value: string | number; label: string }[],
): FilterField => ({ key, label, options })

/**
 * İçerik Havuzu (yönetici ve öğretmen; docs/domain/kaynak-platformu.md): personelin görebildiği
 * içerikler sunucu sayfalı tabloda. Arama (`q`, Türkçe karakter katlamalı), tür/CEFR/beceri/ders/
 * düzey/durum süzgeci ve "Yalnız benimkiler" sunucuda uygulanır; satırdan ayrıntı sağ panelde,
 * yeni içerik ve düzenleme geniş pencerede (`?icerik-form=`) açılır. Yetki, kapsam ve görünürlük
 * sunucudadır; burada yalnız çağrı ve sunum vardır.
 */
export function ContentPoolPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const languageSchool = session?.institution.type === 'language_school'

  const list = useListState('icerik', { urlFilters: URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const query = resourceListQuery({
    page: list.state.page,
    pageSize: list.state.pageSize,
    q: search,
    filters: list.state.filters,
    sortKey: list.state.sortKey,
    sortDirection: list.state.sortDirection,
    userId,
  })
  const resources = useResourceList(query)
  const subjects = useCoreAll('subjects', {}, { enabled: !languageSchool })
  const subjectNames = useMemo(
    () => new Map((subjects.data ?? []).map(({ record }) => [record.id, record.name])),
    [subjects.data],
  )
  const rows = useMemo(
    () => resources.data?.data.filter(isStaffItem).map((item) => resourceRow(item, subjectNames)),
    [resources.data, subjectNames],
  )

  const panel = useDetailPanel('icerik')
  const form = useDetailPanel('icerik-form')
  const openPanel = panel.open
  const navigate = useNavigate()
  /** Yeni içerik kaydedilince form kapanır, yeni kaydın ayrıntısı açılır (tek geçmiş adımı). */
  const showCreated = (id: string) => {
    const next = new URLSearchParams(window.location.search)
    next.delete('icerik-form')
    next.set('icerik', id)
    void Promise.resolve(
      navigate({ search: `?${next.toString()}` }, { replace: true, preventScrollReset: true }),
    ).catch((error: unknown) => console.error('[panel] açılamadı', error))
  }

  const mine = list.state.filters.mine === MINE
  const filters = useMemo<FilterField[]>(
    () => [
      field('contentType', 'İçerik türü', TYPE_OPTIONS),
      field('cefrLevel', 'CEFR düzeyi', CEFR_OPTIONS),
      field('primarySkill', 'Beceri', SKILL_OPTIONS),
      ...(languageSchool
        ? []
        : [
            field(
              'subjectId',
              'Ders',
              [...subjectNames].map(([value, label]) => ({ value, label })),
            ),
            field('gradeLevel', 'Sınıf düzeyi', GRADE_OPTIONS),
          ]),
      field('status', 'Durum', STATUS_OPTIONS),
    ],
    [languageSchool, subjectNames],
  )

  const columns = useMemo<DataColumn<ResourceRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Başlık',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openPanel(row.id)}
            className="record-link text-left font-medium text-primary [overflow-wrap:anywhere] hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'type', label: 'Tür' },
      {
        key: 'tags',
        label: 'Etiketler',
        cell: (row) => <span className="[overflow-wrap:anywhere]">{row.tags}</span>,
      },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={STATUS_TONES[row.statusKey]} />,
      },
      { key: 'license', label: 'Lisans' },
      {
        key: 'updatedAt',
        label: 'Güncellendi',
        cell: (row) => dateLabel(row.updatedAt, { year: 'numeric' }),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.title} ayrıntısı`}
            onClick={() => openPanel(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openPanel],
  )

  const total = resources.data?.meta.total ?? 0
  const setMine = (value: boolean) =>
    list.dispatch({ type: 'filter', key: 'mine', value: value ? MINE : '' })
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <Button onClick={() => form.open(NEW_CONTENT)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni içerik
          </Button>
        }
      />
      <section
        aria-labelledby="icerik-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="icerik-tablosu" className="text-lg font-semibold">
            İçerikler
          </h2>
          <p className="text-sm text-muted-foreground">
            {total} kayıt · okuma parçası ve çoktan seçmeli soru
          </p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={SORTABLE}
          filters={filters}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="İçerik havuzu"
          loading={resources.isPending}
          fetching={resources.isFetching && !resources.isPending}
          empty="Henüz içerik yok. Yeni içerik ekleyerek başlayın."
          emptyFiltered="Aramanızla eşleşen içerik bulunamadı."
          error={
            resources.error ? (
              <QueryError error={resources.error} onRetry={() => void resources.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openPanel(row.id)}
          externalActive={mine}
          externalLabel="Yalnız benimkiler"
          onReset={() => setMine(false)}
          toolbar={
            <Label className="min-h-9 cursor-pointer gap-2 text-sm font-normal">
              <Checkbox
                checked={mine}
                onCheckedChange={(checked) => setMine(checked === true)}
                aria-label="Yalnız benimkiler"
              />
              Yalnız benimkiler
            </Label>
          }
        />
      </section>
      <ContentPoolPanel
        resourceId={panel.selectedId}
        onClose={panel.close}
        onEdit={form.open}
        subjectNames={subjectNames}
      />
      <ContentDraftForm
        target={form.selectedId}
        onClose={form.close}
        onCreated={showCreated}
        onSaved={() => form.close()}
      />
    </>
  )
}
