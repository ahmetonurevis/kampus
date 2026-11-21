import { useMemo } from 'react'
import {
  useHealthAccessLogs,
  type HealthAccessLogRow,
} from '@kampus/react-shared/use-finance-health-access.ts'
import { useIncidentStaff } from '@kampus/react-shared/use-finance-incidents.ts'
import {
  HEALTH_ACCESS_REASON_CODES,
  HEALTH_ACCESS_REASON_LABELS,
  healthAccessActionLabel,
} from '@kampus/school-core/lib/finance-health-access.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { useCoreList } from '@/hooks/use-core-collection.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { FilterField } from '@/lib/list-query.ts'
import { occurredText } from './finance-incident-forms.ts'
import { healthLogQuery, healthLogReasonText } from './finance-health-access.ts'

const NO_SORT: readonly string[] = []
const STAFF_QUERY = { page: 1, pageSize: 100 } as const
const STUDENT_QUERY = { pageSize: 100 } as const

type TableRow = {
  id: string
  row: HealthAccessLogRow
  accessed: string
  actor: string
  record: string
  student: string
  reason: string
}

/**
 * Sağlık erişim günlüğü (DOM-FIN-156; ON-164; K-524): Finans "Sağlık erişim günlüğü" sekmesi,
 * yalnız yönetici. Kaza tutanağı, revir ziyareti ve ilaç listelerinin gerekçeli her açılışı: kim,
 * ne zaman, hangi kaydı, hangi gerekçeyle. Süzgeç kişi, öğrenci, gerekçe ve okuma günü. Günlük
 * sağlık değeri göstermez; kayıt yalnız türü ve öğrencisiyle anılır.
 */
export function FinanceHealthAccessLogSection() {
  const list = useListState('saglik-erisim-gunlugu', { urlPrefix: 'erisim_' })
  const staff = useIncidentStaff(STAFF_QUERY)
  const students = useCoreList('students', STUDENT_QUERY)
  const logs = useHealthAccessLogs(
    healthLogQuery(list.state.page, list.state.pageSize, list.state.filters),
  )
  const filters = useMemo<FilterField[]>(
    () => [
      {
        key: 'actor',
        label: 'Kişi',
        type: 'select',
        options: (staff.data?.data ?? []).map((item) => ({
          value: item.membershipId,
          label: item.name,
        })),
      },
      {
        key: 'student',
        label: 'Öğrenci',
        type: 'select',
        options: (students.data?.rows ?? []).map(({ record }) => ({
          value: record.id,
          label: record.name,
        })),
      },
      {
        key: 'reasonCode',
        label: 'Gerekçe',
        type: 'select',
        options: HEALTH_ACCESS_REASON_CODES.map((value) => ({
          value,
          label: HEALTH_ACCESS_REASON_LABELS[value],
        })),
      },
      { key: 'accessedAt', label: 'Okuma günü', type: 'date' },
    ],
    [staff.data, students.data],
  )
  const rows = useMemo(
    () =>
      logs.data?.data.map((item): TableRow => ({
        id: item.id,
        row: item,
        accessed: occurredText(item.accessedAt),
        actor: item.actorName ?? '—',
        record: healthAccessActionLabel(item.action),
        student: item.studentName ?? '—',
        reason: healthLogReasonText(item),
      })),
    [logs.data],
  )
  const columns = useMemo<DataColumn<TableRow>[]>(
    () => [
      { key: 'accessed', label: 'Okuma anı' },
      { key: 'actor', label: 'Kişi' },
      { key: 'record', label: 'Kayıt' },
      { key: 'student', label: 'Öğrenci' },
      { key: 'reason', label: 'Gerekçe' },
    ],
    [],
  )
  return (
    <section
      aria-labelledby="saglik-erisim-gunlugu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-1 px-6 pt-6 pb-2">
        <h2 id="saglik-erisim-gunlugu" className="text-lg font-semibold">
          Sağlık erişim günlüğü
        </h2>
        <p className="text-sm text-muted-foreground">
          Sağlık bilgisinin gerekçeyle her açılışı. Günlük sağlık bilgisi göstermez.
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={logs.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        search={false}
        mobileColumns={['accessed', 'actor', 'reason']}
        caption="Sağlık erişim günlüğü"
        empty="Henüz gerekçeli sağlık erişimi yok."
        emptyFiltered="Bu süzgeçte erişim yok."
        loading={logs.isPending}
        fetching={logs.isFetching && !logs.isPending}
        error={
          logs.error ? (
            <QueryError error={logs.error} onRetry={() => void logs.refetch()} />
          ) : undefined
        }
      />
    </section>
  )
}
