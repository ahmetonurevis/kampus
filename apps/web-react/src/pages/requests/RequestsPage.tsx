import { use, useMemo } from 'react'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreFetchAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import {
  collectionQueryFromList,
  exportQueryFromList,
  sortableColumns,
} from '@/lib/collection-list.ts'
import type { UrlFilters } from '@/lib/list-url.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { TableSection } from '../academic/AcademicParts.tsx'
import { PendingWriteNotice } from './PendingWriteNotice.tsx'
import { RequestPanel } from './RequestPanel.tsx'
import {
  REQUEST_CATEGORIES,
  REQUEST_LIST,
  REQUEST_STATUSES,
  requestCsvRow,
  requestRow,
  type RequestRow,
} from './request-rows.ts'

const SORTABLE = sortableColumns(REQUEST_LIST)
const ALL = 'all'
const URL_FILTERS: UrlFilters = { status: 'durum', category: 'tur' }
const filterValue = (value: unknown) => (typeof value === 'string' ? value : '')

type Audience = 'parent' | 'front-office'

/**
 * Şikayet & Talep (veli) ve Şikayet & Talepler (ön büro), Vue `Communication.vue`: sunucu sayfalı
 * liste; arama, durum ve tür filtresi (adreste), sıralama, satırdan sağ panelde ayrıntı, CSV.
 * Velide liste seçili çocuğun (`?cocuk=`) talepleriyle sınırlanır; kapsamı ayrıca sunucu velinin
 * bağlı çocuklarına daraltır. Ön büro kurumun bütün taleplerini görür.
 * TODO(api-request-write): talep açma (veli) ile durum/ilgili birim güncelleme ve yanıt (ön büro)
 * komut uçları API'de ve core'da yok; uçlar gelene kadar ekran yalnız okur ve bunu söyler.
 * SLA veya süre alanı core `requests` kaydında tanımlı değildir; gösterilmez.
 */
export function RequestsPage({ page, audience }: { page: NavPage; audience: Audience }) {
  useDocumentTitle(page.title)
  const parent = audience === 'parent'
  const childId = use(ViewScopeContext)
  const list = useListState('talepler', { urlFilters: URL_FILTERS })
  const status = filterValue(list.state.filters.status)
  const category = filterValue(list.state.filters.category)
  const search = useDebouncedValue(list.state.query)
  const panel = useDetailPanel('talep')
  const openRecord = panel.open
  const fetchAll = useCoreFetchAll('requests')
  const csv = useCsvExport()

  const withScope = <T extends { filters?: Record<string, string | readonly string[]> }>(
    query: T,
  ): T => ({
    ...query,
    filters: { ...query.filters, ...(parent && childId ? { studentId: childId } : {}) },
  })
  const records = useCoreList(
    'requests',
    withScope(collectionQueryFromList(list.state, REQUEST_LIST, search)),
    { enabled: !parent || childId !== '' },
  )
  const rows = useMemo(() => records.data?.rows.map(requestRow), [records.data])

  const setFilter = (key: 'status' | 'category', value: string) =>
    list.dispatch({ type: 'filter', key, value: value === ALL ? '' : value })

  const columns = useMemo<DataColumn<RequestRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Konu',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openRecord(row.id)}
            className="record-link text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      ...(parent
        ? []
        : [
            {
              key: 'student',
              label: 'Öğrenci',
              cell: (row: RequestRow) => (
                <span className="person-cell flex items-center gap-2.5">
                  <Avatar name={row.student} size="small" />
                  {row.student || '—'}
                </span>
              ),
            },
          ]),
      { key: 'category', label: 'Tür' },
      { key: 'status', label: 'Durum', cell: (row) => <StatusBadge text={row.status} /> },
      { key: 'assignedTo', label: 'İlgili birim' },
      { key: 'date', label: 'Tarih', cell: (row) => dateLabel(row.date, { year: 'numeric' }) },
    ],
    [parent, openRecord],
  )

  function download() {
    const query = withScope(exportQueryFromList(list.state, REQUEST_LIST, search))
    void csv.download(page.title, columns, async () =>
      (await fetchAll(query)).map((item) => requestCsvRow(requestRow(item))),
    )
  }

  const total = records.data?.total ?? 0
  const tableName = parent ? 'Taleplerim' : 'Şikayet ve talepler'
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <PendingWriteNotice>
        {parent
          ? 'Web üzerinden yeni talep gönderme hazırlanıyor. Şimdilik ön büroya ilettiğiniz talepleri ve durumlarını buradan izleyebilirsiniz.'
          : 'Talebin durumunu değiştirme ve yanıt yazma hazırlanıyor. Şimdilik talepler yalnız okunabilir.'}
      </PendingWriteNotice>
      <TableSection
        title={tableName}
        subtitle={`${total} kayıt`}
        onDownload={download}
        downloadBusy={csv.busy}
      >
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={parent ? ['title', 'status'] : ['title', 'student', 'status']}
          caption={tableName}
          empty={parent ? 'Henüz talep göndermediniz.' : 'Henüz talep yok.'}
          loading={records.isPending}
          fetching={records.isFetching && !records.isPending}
          error={
            records.error ? (
              <QueryError error={records.error} onRetry={() => void records.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openRecord(row.id)}
          externalActive={status !== '' || category !== ''}
          externalLabel={[status, category].filter(Boolean).join(' · ')}
          onReset={() => {
            setFilter('status', ALL)
            setFilter('category', ALL)
          }}
          toolbar={
            <>
              <NativeSelect
                aria-label="Talep durumu"
                value={status || ALL}
                onChange={(event) => setFilter('status', event.target.value)}
                className="min-h-9 text-sm"
              >
                <NativeSelectOption value={ALL}>Tüm durumlar</NativeSelectOption>
                {REQUEST_STATUSES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {value}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Bildirim türü"
                value={category || ALL}
                onChange={(event) => setFilter('category', event.target.value)}
                className="min-h-9 text-sm"
              >
                <NativeSelectOption value={ALL}>Tüm türler</NativeSelectOption>
                {REQUEST_CATEGORIES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {value}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </>
          }
        />
      </TableSection>
      <RequestPanel recordId={panel.selectedId} onClose={panel.close} />
    </>
  )
}
