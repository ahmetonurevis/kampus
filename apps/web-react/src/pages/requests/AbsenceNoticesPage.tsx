import { use, useMemo } from 'react'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
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
import type { NavPage } from '@/lib/navigation.ts'
import { TableSection } from '../academic/AcademicParts.tsx'
import { AbsenceFormPanel, NEW_NOTICE } from './AbsenceFormPanel.tsx'
import { AbsencePanel } from './AbsencePanel.tsx'
import { ABSENCE_LIST, absenceCsvRow, absenceRow, type AbsenceRow } from './request-rows.ts'

const SORTABLE = sortableColumns(ABSENCE_LIST)
const TABLE_NAME = 'Bildirim geçmişi'

/**
 * İzin & Mazeret (veli), Vue `Communication.vue` `devamsizlik-bildirimi`: seçili çocuğun (`?cocuk=`)
 * bildirim geçmişi; arama, sıralama, sayfa, satırdan sağ panelde ayrıntı ve CSV. Kapsamı sunucu
 * velinin bağlı çocuklarına daraltır; mazeret metni sağlık bilgisi içerebileceğinden ön büro bu
 * koleksiyonu okuyamaz (DOM-ILT-053).
 * Tür sütunu gerekçe kategorisidir; yeni bildirim serbest açıklama taşımaz, Açıklama sütunu
 * yalnız eski kayıtların metnini gösterir (DOM-ILT-053, KVKK md. 6).
 * "İzin veya mazeret bildir" sağ panelde açılır (`?bildirim-form=yeni`): çocuk, tarih aralığı ve
 * gerekçe kategorisi; serbest açıklama yoktur.
 */
export function AbsenceNoticesPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const childId = use(ViewScopeContext)
  const list = useListState('izin-bildirimleri')
  const search = useDebouncedValue(list.state.query)
  const panel = useDetailPanel('bildirim')
  const form = useDetailPanel('bildirim-form')
  const openRecord = panel.open
  const fetchAll = useCoreFetchAll('absences')
  const csv = useCsvExport()

  const withScope = <T extends { filters?: Record<string, string | readonly string[]> }>(
    query: T,
  ): T => ({ ...query, filters: { ...query.filters, ...(childId ? { studentId: childId } : {}) } })
  const records = useCoreList(
    'absences',
    withScope(collectionQueryFromList(list.state, ABSENCE_LIST, search)),
    { enabled: childId !== '' },
  )
  const rows = useMemo(() => records.data?.rows.map(absenceRow), [records.data])

  const columns = useMemo<DataColumn<AbsenceRow>[]>(
    () => [
      {
        key: 'category',
        label: 'Mazeret türü',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openRecord(row.id)}
            className="record-link text-left font-medium text-primary hover:underline"
          >
            {row.category}
          </button>
        ),
      },
      { key: 'range', label: 'Tarih aralığı' },
      { key: 'status', label: 'Durum', cell: (row) => <StatusBadge text={row.status} /> },
      {
        key: 'sentAt',
        label: 'Gönderildi',
        cell: (row) => dateLabel(row.sentAt, { year: 'numeric' }),
      },
      { key: 'reason', label: 'Açıklama' },
    ],
    [openRecord],
  )

  function download() {
    const query = withScope(exportQueryFromList(list.state, ABSENCE_LIST, search))
    void csv.download(page.title, columns, async () =>
      (await fetchAll(query)).map((item) => absenceCsvRow(absenceRow(item))),
    )
  }

  const total = records.data?.total ?? 0
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <Button onClick={() => form.open(NEW_NOTICE)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni bildirim
          </Button>
        }
      />
      <TableSection
        title={TABLE_NAME}
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
          mobileColumns={['category', 'range', 'status']}
          caption={TABLE_NAME}
          empty="Henüz izin bildirimi yok."
          loading={records.isPending}
          fetching={records.isFetching && !records.isPending}
          error={
            records.error ? (
              <QueryError error={records.error} onRetry={() => void records.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openRecord(row.id)}
        />
      </TableSection>
      <AbsencePanel recordId={panel.selectedId} onClose={panel.close} />
      <AbsenceFormPanel open={form.selectedId === NEW_NOTICE} onClose={form.close} />
    </>
  )
}
