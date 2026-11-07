import { useMemo } from 'react'
import { Link } from 'react-router'
import { learnerWords } from '@kampus/school-core/lib/enrollment-learner.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  useCoreAll,
  useCoreCounts,
  useCoreFetchAll,
  useCoreList,
} from '@/hooks/use-core-collection.ts'
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
import { NEW_PROSPECT, ProspectFormPanel } from './ProspectFormPanel.tsx'
import {
  ALL_STAGES,
  CONTACT_LABELS,
  CREATED_FILTER,
  prospectCsvRow,
  prospectRow,
  SOURCE_FILTER,
  stageFilter,
  stageTabs,
  stageTone,
  withCreatedRange,
  type ProspectRow,
} from './prospect-rows.ts'

// Sunucu listesi yapılandırması: hangi sütun sunucuda sıralanır, hangi süzgeç hangi alana gider.
const LIST = {
  sortFields: {
    name: 'name',
    branch: 'branchName',
    stageLabel: 'stage',
    createdLabel: 'createdAt',
  },
  filterFields: { stage: 'stage', source: 'source', branchId: 'branchId' },
  defaultSort: ['-createdAt'],
} satisfies CollectionListConfig
const URL_FILTERS = { stage: 'asama', source: 'kaynak', branchId: 'kampus' }
const SORTABLE = sortableColumns(LIST)
const MOBILE_COLUMNS = ['interest', 'stageLabel', 'branch']
const ALL = 'all'
const STAGE_COUNTS = { groupBy: 'stage' } as const

/**
 * Aday Öğrenciler (ön büro, Vue `Crm.vue` `adaylar`): sunucu sayfalı tablo; aşama, kaynak ve
 * kampüs süzgeci, sıralama ve sayfa adreste tutulur; arama (ad, telefon, ilgi) yalnız bellektedir
 * (ADR 0009). Aşama sekmeleri (Vue "Aday aşaması") aşama süzgecinin kısayoludur ve kurum
 * genelindeki sayıları gösterir; kayıt tarihi aralığı sunucuda `createdAt` gününe göre süzülür
 * (aralık bellektedir, adrese yazılmaz).
 * Aday adı detay sayfasına (`/onburo/aday/:id`) götürür; "Yeni aday ekle" sağ panelde açılır
 * (`?aday-form=yeni`). CSV tüm filtrelenmiş sonucu içerir.
 */
export function ProspectsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const role = session?.role ?? 'onburo'
  const type = session?.institution.type ?? 'school'
  const list = useListState('adaylar', { urlFilters: URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const branches = useCoreAll('branches')
  const lookups = useMemo(
    () => ({
      branches: new Map((branches.data ?? []).map((item) => [item.record.id, item.record.name])),
    }),
    [branches.data],
  )
  const createdRange = list.state.filters.createdAt
  const prospects = useCoreList(
    'prospects',
    withCreatedRange(collectionQueryFromList(list.state, LIST, search), createdRange),
  )
  const stageCounts = useCoreCounts('prospects', STAGE_COUNTS)
  const tabs = useMemo(() => stageTabs(stageCounts.data, type), [stageCounts.data, type])
  const stage = typeof list.state.filters.stage === 'string' ? list.state.filters.stage : ''
  const rows = useMemo(
    () => prospects.data?.rows.map((item) => prospectRow(item, type, lookups)),
    [prospects.data, type, lookups],
  )
  const form = useDetailPanel('aday-form')
  const fetchAll = useCoreFetchAll('prospects')
  const csv = useCsvExport()
  const filters = useMemo(() => [stageFilter(type), SOURCE_FILTER, CREATED_FILTER], [type])

  const branchId =
    typeof list.state.filters.branchId === 'string' ? list.state.filters.branchId : ''
  const setBranch = (value: string) =>
    list.dispatch({ type: 'filter', key: 'branchId', value: value === ALL ? '' : value })

  const columns = useMemo<DataColumn<ProspectRow>[]>(
    () => [
      {
        key: 'name',
        label: `Aday ${learnerWords(type).noun}`,
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.name} size="small" />
            <span className="grid">
              <Link
                to={`/${role}/aday/${encodeURIComponent(row.id)}`}
                className="record-link font-medium text-primary hover:underline"
              >
                {row.name}
              </Link>
              <small className="text-xs text-muted-foreground">
                {row.phoneOwner === 'guardian' ? (
                  <>
                    <span aria-hidden="true">Veli · </span>
                    <span className="sr-only">{CONTACT_LABELS.guardian.phone}: </span>
                  </>
                ) : null}
                {row.phone}
              </small>
            </span>
          </span>
        ),
      },
      {
        key: 'interest',
        label: type === 'language_school' ? 'Hedef seviye' : 'İlgilendiği program',
      },
      { key: 'branch', label: 'Kampüs' },
      { key: 'source', label: 'Kaynak' },
      {
        key: 'stageLabel',
        label: 'Aşama',
        cell: (row) => <StatusBadge text={row.stageLabel} tone={stageTone(row.stage)} />,
      },
      { key: 'createdLabel', label: 'Kayıt tarihi' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button variant="secondary" size="sm" asChild>
            <Link
              to={`/${role}/aday/${encodeURIComponent(row.id)}`}
              aria-label={`${row.name} detayını aç`}
            >
              <Icon name="ArrowUpRight" size={15} aria-hidden="true" />
              Detay
            </Link>
          </Button>
        ),
      },
    ],
    [role, type],
  )

  function download() {
    const query = withCreatedRange(exportQueryFromList(list.state, LIST, search), createdRange)
    void csv.download(
      page.title,
      columns.filter((column) => column.key !== ACTIONS_KEY),
      async () =>
        (await fetchAll(query)).map((item) => prospectCsvRow(prospectRow(item, type, lookups))),
    )
  }

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
              disabled={csv.busy}
              aria-busy={csv.busy || undefined}
            >
              <Icon name="Download" size={17} aria-hidden="true" />
              Listeyi indir
            </Button>
            <Button onClick={() => form.open(NEW_PROSPECT)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Yeni aday ekle
            </Button>
          </>
        }
      />
      <section
        aria-labelledby="aday-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="aday-tablosu" className="text-lg font-semibold">
            Adaylar
          </h2>
          <p className="text-sm text-muted-foreground">
            {prospects.data?.total ?? 0} aday · arama ad, telefon ve ilgi alanında çalışır
          </p>
        </header>
        <div className="px-6 max-[650px]:px-4">
          <LineTabs
            label="Aday aşaması"
            value={stage || ALL_STAGES}
            options={tabs}
            onChange={(value) =>
              list.dispatch({
                type: 'filter',
                key: 'stage',
                value: value === ALL_STAGES ? '' : value,
              })
            }
          />
        </div>
        <ServerDataTable
          list={list}
          rows={rows}
          total={prospects.data?.total ?? 0}
          sortable={SORTABLE}
          filters={filters}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption={`Aday ${learnerWords(type).plural}`}
          empty="Henüz aday kaydı yok."
          loading={prospects.isPending}
          fetching={prospects.isFetching && !prospects.isPending}
          error={
            prospects.error ? (
              <QueryError error={prospects.error} onRetry={() => void prospects.refetch()} />
            ) : undefined
          }
          externalActive={branchId !== ''}
          externalLabel={`Kampüs: ${lookups.branches.get(branchId) ?? ''}`}
          onReset={() => setBranch(ALL)}
          toolbar={
            <NativeSelect
              aria-label="Kampüs filtresi"
              value={branchId || ALL}
              onChange={(event) => setBranch(event.target.value)}
              className="min-h-9 text-sm"
            >
              <NativeSelectOption value={ALL}>Tüm kampüsler</NativeSelectOption>
              {(branches.data ?? []).map(({ record }) => (
                <NativeSelectOption key={record.id} value={record.id}>
                  {record.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          }
        />
      </section>
      <ProspectFormPanel open={form.selectedId !== ''} onClose={form.close} />
    </>
  )
}
