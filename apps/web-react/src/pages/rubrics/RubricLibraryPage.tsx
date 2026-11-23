import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { useRubrics } from '@kampus/react-shared/use-rubrics.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { FilterField } from '@/lib/list-query.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { RubricDetailPanel } from './RubricDetailPanel.tsx'
import { RubricForm } from './RubricForm.tsx'
import {
  KIND_OPTIONS,
  NEW_RUBRIC,
  rubricListQuery,
  rubricRow,
  SKILL_OPTIONS,
  STATUS_OPTIONS,
  STATUS_TONES,
  type RubricRow,
} from './rubric-library-model.ts'

const URL_FILTERS = { skill: 'beceri', kind: 'tur', status: 'durum', mine: 'benim' }
const MOBILE_COLUMNS = ['skill', 'status', 'version']
const NO_SORT: readonly string[] = []
const MINE = 'yes'
const PANEL = 'rubrik'
const FORM = 'rubrik-form'

const FILTERS: readonly FilterField[] = [
  { key: 'skill', label: 'Beceri', options: SKILL_OPTIONS },
  { key: 'kind', label: 'Rubrik türü', options: KIND_OPTIONS },
  { key: 'status', label: 'Durum', options: STATUS_OPTIONS },
]

/**
 * Rubrik kütüphanesi (OG-083; IST-048, DOM-BEC-020, DOM-BEC-022): kurumun ortak rubrikleri sunucu
 * sayfalı tabloda; başlık araması, beceri/tür/durum süzgeci ve "Yalnız benimkiler" sunucuda
 * uygulanır, durum baş sürümündür (taslak, yayında, arşiv). Satırdan ayrıntı sağ panelde
 * (`?rubrik=`), yeni rubrik, yeni sürüm ve taslak düzenleme geniş pencerede (`?rubrik-form=`).
 * Yetki (sahip ya da yönetici) ve sürüm kuralları sunucudadır.
 */
export function RubricLibraryPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const list = useListState('rubrik', { urlFilters: URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const rubrics = useRubrics(
    rubricListQuery({
      page: list.state.page,
      pageSize: list.state.pageSize,
      q: search,
      filters: list.state.filters,
      userId,
    }),
  )
  const rows = useMemo(() => rubrics.data?.data.map(rubricRow), [rubrics.data])

  const panel = useDetailPanel(PANEL)
  const form = useDetailPanel(FORM)
  const openPanel = panel.open
  const navigate = useNavigate()
  /** Kaydedilen rubriğin ayrıntısı formun yerine açılır (tek geçmiş adımı). */
  const showSaved = (rubricId: string) => {
    const next = new URLSearchParams(window.location.search)
    next.delete(FORM)
    next.set(PANEL, rubricId)
    void Promise.resolve(
      navigate({ search: `?${next.toString()}` }, { replace: true, preventScrollReset: true }),
    ).catch((error: unknown) => console.error('[panel] açılamadı', error))
  }

  const columns = useMemo<DataColumn<RubricRow>[]>(
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
      { key: 'skill', label: 'Beceri' },
      { key: 'kind', label: 'Tür' },
      { key: 'version', label: 'Sürüm' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={STATUS_TONES[row.statusKey]} />,
      },
      { key: 'published', label: 'Yayındaki sürüm' },
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

  const total = rubrics.data?.meta.total ?? 0
  const mine = list.state.filters.mine === MINE
  const setMine = (value: boolean) =>
    list.dispatch({ type: 'filter', key: 'mine', value: value ? MINE : '' })
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <Button onClick={() => form.open(NEW_RUBRIC)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni rubrik
          </Button>
        }
      />
      <section
        aria-labelledby="rubrik-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="rubrik-tablosu" className="text-lg font-semibold">
            Rubrikler
          </h2>
          <p className="text-sm text-muted-foreground">
            {total} rubrik · yazma, konuşma ve aracılık görevlerinde ortak kullanılır
          </p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={NO_SORT}
          filters={FILTERS}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Rubrik kütüphanesi"
          loading={rubrics.isPending}
          fetching={rubrics.isFetching && !rubrics.isPending}
          empty="Henüz rubrik yok. Yeni rubrik ekleyerek başlayın."
          emptyFiltered="Aramanızla eşleşen rubrik bulunamadı."
          error={
            rubrics.error ? (
              <QueryError error={rubrics.error} onRetry={() => void rubrics.refetch()} />
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
      <RubricDetailPanel rubricId={panel.selectedId} onClose={panel.close} onForm={form.open} />
      <RubricForm target={form.selectedId} onClose={form.close} onSaved={showSaved} />
    </>
  )
}
