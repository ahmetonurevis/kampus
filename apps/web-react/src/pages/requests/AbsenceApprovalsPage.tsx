import { useMemo } from 'react'
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
import {
  collectionQueryFromList,
  exportQueryFromList,
  sortableColumns,
} from '@/lib/collection-list.ts'
import type { UrlFilters } from '@/lib/list-url.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { TableSection } from '../academic/AcademicParts.tsx'
import { AbsencePanel } from './AbsencePanel.tsx'
import {
  ABSENCE_STAFF_LIST,
  ABSENCE_STATUS_FILTERS,
  absenceCsvRow,
  absenceRow,
  type AbsenceRow,
} from './request-rows.ts'

const SORTABLE = sortableColumns(ABSENCE_STAFF_LIST)
const ALL = 'all'
const URL_FILTERS: UrlFilters = { status: 'durum' }
const TABLE_NAME = 'Mazeret bildirimleri'
const filterValue = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * Mazeret Bildirimleri (yönetici) ve rehber öğretmen görünümü, DOM-ILT-053, Sabah kararları 71-72
 * (yalnız React): kurumun (öğretmende sınıf rehber olduğu şubelerin) izin ve mazeret bildirimleri;
 * arama, durum süzgeci (adreste), sıralama, sayfa ve CSV sunucu tarafındadır. Satırdan sağ panelde
 * ayrıntı açılır (`?bildirim=`): özür belgeleri imzalı bağlantıyla açılır. Yönetici panelde onaylar
 * ya da gerekçeyle reddeder; rehber öğretmen aynı paneli salt okur görür. Ön büro bu koleksiyonu
 * okuyamaz. Kapsamı ve yetkiyi sunucu uygular.
 */
export function AbsenceApprovalsPage({
  page,
  viewer,
}: {
  page: NavPage
  viewer: 'admin' | 'teacher'
}) {
  useDocumentTitle(page.title)
  const list = useListState('mazeret-bildirimleri', { urlFilters: URL_FILTERS })
  const status = filterValue(list.state.filters.status)
  const search = useDebouncedValue(list.state.query)
  const panel = useDetailPanel('bildirim')
  const openRecord = panel.open
  const fetchAll = useCoreFetchAll('absences')
  const csv = useCsvExport()

  const records = useCoreList(
    'absences',
    collectionQueryFromList(list.state, ABSENCE_STAFF_LIST, search),
  )
  const rows = useMemo(
    () => records.data?.rows.map((item) => absenceRow(item, 'staff')),
    [records.data],
  )

  const setStatus = (value: string) =>
    list.dispatch({ type: 'filter', key: 'status', value: value === ALL ? '' : value })

  const columns = useMemo<DataColumn<AbsenceRow>[]>(
    () => [
      {
        key: 'student',
        label: 'Öğrenci',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openRecord(row.id)}
            className="record-link person-cell flex items-center gap-2.5 text-left font-medium text-primary hover:underline"
          >
            <Avatar name={row.student} size="small" />
            {row.student || '—'}
          </button>
        ),
      },
      { key: 'className', label: 'Sınıf' },
      { key: 'category', label: 'Mazeret türü' },
      { key: 'range', label: 'Tarih aralığı' },
      {
        key: 'documents',
        label: 'Belge',
        cell: (row) => (row.fileIds.length > 0 ? String(row.fileIds.length) : '—'),
      },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={row.tone} />,
      },
      {
        key: 'sentAt',
        label: 'Gönderildi',
        cell: (row) => dateLabel(row.sentAt, { year: 'numeric' }),
      },
    ],
    [openRecord],
  )

  function download() {
    const query = exportQueryFromList(list.state, ABSENCE_STAFF_LIST, search)
    void csv.download(page.title, columns, async () =>
      (await fetchAll(query)).map((item) => absenceCsvRow(absenceRow(item, 'staff'))),
    )
  }

  const total = records.data?.total ?? 0
  const teacher = viewer === 'teacher'
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
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
          mobileColumns={['student', 'range', 'status']}
          caption={TABLE_NAME}
          empty={
            teacher
              ? 'Rehber öğretmeni olduğunuz sınıflarda mazeret bildirimi yok.'
              : 'Henüz mazeret bildirimi yok.'
          }
          loading={records.isPending}
          fetching={records.isFetching && !records.isPending}
          error={
            records.error ? (
              <QueryError error={records.error} onRetry={() => void records.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openRecord(row.id)}
          externalActive={status !== ''}
          externalLabel={
            ABSENCE_STATUS_FILTERS.find((item) => item.value === status)?.label ?? status
          }
          onReset={() => setStatus(ALL)}
          toolbar={
            <NativeSelect
              aria-label="Onay durumu"
              value={status || ALL}
              onChange={(event) => setStatus(event.target.value)}
              className="min-h-9 text-sm"
            >
              <NativeSelectOption value={ALL}>Tüm durumlar</NativeSelectOption>
              {ABSENCE_STATUS_FILTERS.map((item) => (
                <NativeSelectOption key={item.value} value={item.value}>
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          }
        />
      </TableSection>
      <AbsencePanel recordId={panel.selectedId} onClose={panel.close} viewer={viewer} />
    </>
  )
}
