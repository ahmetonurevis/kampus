import { useMemo } from 'react'
import { useAuth } from '@/auth/use-auth.ts'
import { Avatar } from '@/components/Avatar.tsx'
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
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import {
  collectionQueryFromList,
  sortableColumns,
  type CollectionListConfig,
} from '@/lib/collection-list.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { stageFilter, withDayRange } from './prospect-rows.ts'
import { TRIAL_DATE_FILTER, trialResultRow, type TrialResultRow } from './prospect-trial-results.ts'
import { TrialResultPanel } from './TrialResultPanel.tsx'

// Sunucu listesi: öğretmenin kapsamı (yalnız kendi gruplarının deneme adayları) sunucudadır.
const LIST = {
  sortFields: { name: 'name', stageLabel: 'stage' },
  filterFields: { stage: 'stage' },
  defaultSort: ['-createdAt'],
} satisfies CollectionListConfig
const URL_FILTERS = { stage: 'asama' }
const SORTABLE = sortableColumns(LIST)
const MOBILE_COLUMNS = ['trialLabel', 'resultLabel']

/**
 * Deneme Dersleri (öğretmen, dil okulu; IST-079, DOM-DIL-031, DOM-YTK-080): öğretmenin kendi
 * gruplarındaki derslere deneme katılımcısı olarak yazılmış adaylar ve seviye uygunluğu sonucu.
 * Liste sunucu sayfalıdır; arama ad ve ilgide, aşama ve deneme dersi günü süzgeci sunucudadır.
 * Öğretmen adayın iletişim, veli, not ve satış bilgisini görmez (sunucu ayıklar). Sonuç sağ
 * panelde yazılır (`?deneme-sonucu=<aday>`); ders başlamadan, iptal edilmiş derste ve kapalı
 * adayda form kilitlidir.
 */
export function TrialResultsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const type = session?.institution.type ?? 'language_school'
  const now = Date.parse(useMinuteClock())
  const list = useListState('deneme-sonuclari', { urlFilters: URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const classes = useCoreAll('classes')
  const groups = useMemo(
    () => new Map((classes.data ?? []).map((item) => [item.record.id, item.record.name])),
    [classes.data],
  )
  const prospects = useCoreList(
    'prospects',
    withDayRange(
      collectionQueryFromList(list.state, LIST, search),
      list.state.filters.trialDate,
      'trialLesson.date',
    ),
  )
  const rows = useMemo(
    () =>
      prospects.data?.rows.flatMap((item) => {
        const row = trialResultRow(item, type, groups, now)
        return row ? [row] : []
      }),
    [prospects.data, type, groups, now],
  )
  const panel = useDetailPanel('deneme-sonucu')
  const openPanel = panel.open
  const filters = useMemo(() => [stageFilter(type), TRIAL_DATE_FILTER], [type])

  const columns = useMemo<DataColumn<TrialResultRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Aday',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.name} size="small" />
            <span className="grid">
              <span className="font-medium">{row.name}</span>
              {row.minor ? (
                <small className="text-xs text-muted-foreground">18 yaş altı</small>
              ) : null}
            </span>
          </span>
        ),
      },
      { key: 'group', label: 'Grup' },
      { key: 'trialLabel', label: 'Deneme dersi' },
      { key: 'interest', label: 'Hedef seviye' },
      {
        key: 'stageLabel',
        label: 'Aşama',
        cell: (row) => <StatusBadge text={row.stageLabel} tone={row.stageTone} />,
      },
      {
        key: 'resultLabel',
        label: 'Sonuç',
        cell: (row) => <StatusBadge text={row.resultLabel} tone={row.resultTone} />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant={row.writable && !row.fit ? 'default' : 'secondary'}
            size="sm"
            onClick={() => openPanel(row.id)}
            aria-label={`${row.name} deneme sonucunu ${row.fit ? 'düzelt' : 'yaz'}`}
          >
            <Icon name={row.fit ? 'Pencil' : 'ClipboardCheck'} size={15} aria-hidden="true" />
            {row.fit ? 'Sonucu düzelt' : row.writable ? 'Sonuç yaz' : 'Ayrıntı'}
          </Button>
        ),
      },
    ],
    [openPanel],
  )

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <section
        aria-labelledby="deneme-adaylari"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="deneme-adaylari" className="text-lg font-semibold">
            Deneme dersi adayları
          </h2>
          <p className="text-sm text-muted-foreground">
            {prospects.data?.total ?? 0} aday · yalnız gruplarınızın derslerine katılan adaylar
            listelenir
          </p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={prospects.data?.total ?? 0}
          sortable={SORTABLE}
          filters={filters}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Deneme dersi adayları"
          empty="Gruplarınızın derslerine planlanmış deneme dersi yok."
          loading={prospects.isPending}
          fetching={prospects.isFetching && !prospects.isPending}
          error={
            prospects.error ? (
              <QueryError error={prospects.error} onRetry={() => void prospects.refetch()} />
            ) : undefined
          }
        />
      </section>
      <TrialResultPanel
        prospectId={panel.selectedId}
        groups={groups}
        type={type}
        now={now}
        onClose={panel.close}
      />
    </>
  )
}
