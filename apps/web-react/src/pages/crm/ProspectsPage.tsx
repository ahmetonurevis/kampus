import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PROSPECT_STAGES, prospectStageLabel } from '@kampus/school-core/lib/prospects.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { collectionQueryFromList, sortableColumns } from '@/lib/collection-list.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { ProspectFormPanel } from './ProspectFormPanel.tsx'
import { ProspectPanel } from './ProspectPanel.tsx'

type ProspectRow = {
  id: string
  name: string
  phone: string
  interest: string
  branchName: string
  source: string
  stage: string
}

const LIST = {
  filterFields: { stage: 'stage' },
  sortFields: { name: 'name', stage: 'stage', createdAt: 'createdAt' },
  defaultSort: ['-createdAt', 'id'],
} as const
const SORTABLE = sortableColumns(LIST)
const URL_FILTERS = { stage: 'asama' }
const MOBILE_COLUMNS = ['name', 'interest', 'stage']
const ALL = 'all'
const NEW = 'yeni'

/**
 * Aday Öğrenciler (ön büro `/adaylar`; Vue `Crm.vue`, DOM-KAY-001…009): sunucu sayfalı liste, ad
 * araması ve aşama süzgeci. Satır aday kartını sağ panelde açar; yeni aday kısa form olarak
 * sağ panelde girilir. Panel durumu adrestedir, geri ve ileri çalışır.
 */
export function ProspectsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const [, setParams] = useSearchParams()
  const institutionType = session?.institution.type ?? 'school'
  const list = useListState('adaylar', { urlFilters: URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const query = useMemo(
    () => collectionQueryFromList(list.state, LIST, search),
    [list.state, search],
  )
  const prospects = useCoreList('prospects', query)
  const detail = useDetailPanel('detay')
  const openDetail = detail.open
  const form = useDetailPanel('aday-form')

  const rows = useMemo(
    () =>
      prospects.data?.rows.map((item): ProspectRow => ({
        id: item.id,
        name: item.record.name,
        phone: item.record.phone ?? '',
        interest: item.record.interest ?? '—',
        branchName: item.joined?.branchName ?? '—',
        source: item.record.source ?? '—',
        stage: prospectStageLabel(item.record.stage, institutionType),
      })),
    [prospects.data, institutionType],
  )

  const columns = useMemo<DataColumn<ProspectRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Aday öğrenci',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.name} size="small" />
            <span className="grid min-w-0">
              <strong className="font-medium">{row.name}</strong>
              <small className="text-xs text-muted-foreground">{row.phone}</small>
            </span>
          </span>
        ),
      },
      { key: 'interest', label: 'İlgilendiği program' },
      { key: 'branchName', label: 'Kampüs' },
      { key: 'source', label: 'Kaynak' },
      { key: 'stage', label: 'Aşama', cell: (row) => <StatusBadge text={row.stage} /> },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} kartını aç`}
            onClick={() => openDetail(row.id)}
          >
            Kartı aç
          </Button>
        ),
      },
    ],
    [openDetail],
  )

  const stage = typeof list.state.filters.stage === 'string' ? list.state.filters.stage : ''
  const setStage = (value: string) =>
    list.dispatch({ type: 'filter', key: 'stage', value: value === ALL ? '' : value })

  const total = prospects.data?.total ?? 0
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <Button onClick={() => form.open(NEW)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni aday ekle
          </Button>
        }
      />
      <section
        aria-labelledby="aday-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="aday-tablosu" className="text-lg font-semibold">
            Aday listesi
          </h2>
          <p className="text-sm text-muted-foreground">
            {total} kayıt ·{' '}
            <Link className="text-primary hover:underline" to="../kayit-islemleri" relative="path">
              Kesin kayıt işlemleri
            </Link>
          </p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Aday listesi"
          loading={prospects.isPending}
          fetching={prospects.isFetching && !prospects.isPending}
          error={
            prospects.error ? (
              <QueryError error={prospects.error} onRetry={() => void prospects.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openDetail(row.id)}
          externalActive={stage !== ''}
          externalLabel={stage ? `Aşama: ${prospectStageLabel(stage, institutionType)}` : ''}
          onReset={() => setStage(ALL)}
          toolbar={
            <NativeSelect
              aria-label="Aday aşaması"
              value={stage || ALL}
              onChange={(event) => setStage(event.target.value)}
              className="min-h-9 text-sm"
            >
              <NativeSelectOption value={ALL}>Tüm aşamalar</NativeSelectOption>
              {PROSPECT_STAGES.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {prospectStageLabel(item, institutionType)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          }
        />
      </section>
      <ProspectPanel prospectId={detail.selectedId} onClose={detail.close} />
      <ProspectFormPanel
        open={form.selectedId === NEW}
        onClose={form.close}
        onCreated={(id) => {
          // Form ve kart tek adımda yer değiştirir: ardışık iki gezinme birbirini ezer.
          setParams(
            (current) => {
              const next = new URLSearchParams(current)
              next.delete('aday-form')
              next.set('detay', id)
              return next
            },
            { replace: true },
          )
        }}
      />
    </>
  )
}
