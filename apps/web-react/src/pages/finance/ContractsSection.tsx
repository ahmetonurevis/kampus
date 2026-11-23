import { useMemo } from 'react'
import { contractStatus, type ContractStatus } from '@kampus/school-core/lib/contract-status.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import type { ContractRecord } from '@kampus/react-shared/contract-model.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import {
  collectionQueryFromList,
  sortableColumns,
  type CollectionListConfig,
} from '@/lib/collection-list.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { ContractPanel } from './ContractPanel.tsx'
import { ContractStatusBadge, contractVersionLabel } from './ContractParts.tsx'

const CONTRACT_LIST = {
  sortFields: { studentName: 'studentName', title: 'title', date: 'date', amount: 'amount' },
  // En yeni sürüm önce; eşitlikte kimlik (sayfalar arası kararlı sıra).
  defaultSort: ['-date', 'id'],
} satisfies CollectionListConfig
const SORTABLE = sortableColumns(CONTRACT_LIST)
const MOBILE_COLUMNS = ['studentName', 'title', 'status']
export const CONTRACT_PANEL_PARAM = 'sozlesme'

type ContractRow = {
  id: string
  studentName: string
  title: string
  versionLabel: string
  date: string
  amount: number
  /** Öğrencinin öteki sürümleri gelene kadar `null` (durum türetilemez). */
  status: ContractStatus | null
}

/**
 * Sözleşmeler (yönetici `/finans?gorunum=sozlesmeler`, ön büro `/tahsilat-takip`; IST-092): kurumun
 * sözleşme sürümleri sunucu sayfalı; öğrenci adı araması, öğrenci/başlık/tarih/tutar sıralaması
 * sunucuda. Durum saklanmaz (core `contractStatus`): sayfadaki öğrencilerin bütün sürümleri ikinci
 * sorguyla okunur, çünkü bir sürümün yerini alan ek protokol başka sayfada olabilir. Satır sağ
 * panelde ayrıntıyı ve işlemleri açar (`?sozlesme=`).
 */
export function ContractsSection() {
  const learner = useEnrollmentLearner()
  const list = useListState('sozlesmeler')
  const search = useDebouncedValue(list.state.query)
  const query = useMemo(
    () => collectionQueryFromList(list.state, CONTRACT_LIST, search),
    [list.state, search],
  )
  const page = useCoreList('contracts', query)
  const studentIds = useMemo(
    () => [...new Set((page.data?.rows ?? []).map((row) => row.record.studentId))].sort(),
    [page.data],
  )
  const versions = useCoreAll(
    'contracts',
    { filters: { studentId: studentIds } },
    { enabled: studentIds.length > 0 },
  )
  const panel = useDetailPanel(CONTRACT_PANEL_PARAM)
  const openContract = panel.open

  const rows = useMemo(() => {
    const byStudent = new Map<string, ContractRecord[]>()
    for (const { record } of versions.data ?? [])
      byStudent.set(record.studentId, [...(byStudent.get(record.studentId) ?? []), record])
    return page.data?.rows.map(({ record, joined }): ContractRow => ({
      id: record.id,
      studentName: joined?.studentName ?? '—',
      title: record.title,
      versionLabel: contractVersionLabel(record),
      date: record.date,
      amount: record.amount,
      status: versions.data
        ? contractStatus(record, byStudent.get(record.studentId) ?? [record])
        : null,
    }))
  }, [page.data, versions.data])

  const columns = useMemo<DataColumn<ContractRow>[]>(
    () => [
      { key: 'studentName', label: learner.title },
      {
        key: 'title',
        label: 'Sözleşme',
        cell: (row) => (
          <span className="grid min-w-0">
            <strong className="font-medium">{row.title}</strong>
            <small className="text-xs text-muted-foreground">{row.versionLabel}</small>
          </span>
        ),
      },
      { key: 'date', label: 'Tarih', cell: (row) => dateLabel(row.date, { year: 'numeric' }) },
      { key: 'amount', label: 'Eğitim bedeli', cell: (row) => money(row.amount) },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (row.status ? <ContractStatusBadge status={row.status} /> : '…'),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.studentName} ${row.versionLabel} sözleşme ayrıntısını aç`}
            onClick={() => openContract(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openContract, learner],
  )

  return (
    <section
      aria-labelledby="sozlesme-tablosu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="sozlesme-tablosu" className="text-lg font-semibold">
          Sözleşmeler
        </h2>
        <p className="text-sm text-muted-foreground">
          Onaylanan sözleşme değişmez; değişiklik ek protokolle yeni sürüm olarak yapılır.
        </p>
      </header>
      {versions.error ? (
        <div className="px-6">
          <QueryError error={versions.error} onRetry={() => void versions.refetch()} />
        </div>
      ) : null}
      <ServerDataTable
        list={list}
        rows={rows}
        total={page.data?.total ?? 0}
        sortable={SORTABLE}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Sözleşmeler"
        loading={page.isPending}
        fetching={page.isFetching && !page.isPending}
        error={
          page.error ? (
            <QueryError error={page.error} onRetry={() => void page.refetch()} />
          ) : undefined
        }
        onRowClick={(row) => openContract(row.id)}
      />
      <ContractPanel contractId={panel.selectedId} onClose={panel.close} onOpen={openContract} />
    </section>
  )
}
