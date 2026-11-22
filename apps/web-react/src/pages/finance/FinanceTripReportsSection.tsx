import { useMemo } from 'react'
import { useTripReports } from '@kampus/react-shared/use-finance-trip-reports.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  TRIP_REPORT_LIST_STATUSES,
  type TripReportListStatus,
} from '@kampus/school-core/lib/finance-trip-reports.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { FinanceTripReportView } from './FinanceTripReportSection.tsx'
import { REPORT_STATUS_VIEW } from './finance-trip-report-forms.ts'

/** Ayrıntı paneli adres parametresi (`?gezi_rapor=<plan>`). */
const PANEL = 'gezi_rapor'
const NO_SORT: readonly string[] = []
const MOBILE = ['number', 'name', 'status']
const isStatus = (value: unknown): value is TripReportListStatus =>
  TRIP_REPORT_LIST_STATUSES.some((status) => status === value)

type Row = {
  id: string
  number: string
  name: string
  returned: string
  author: string
  photos: string
  responses: string
  status: TripReportListStatus
}

/**
 * Gezi raporları (`?gorunum=gezi-raporlari`; DOM-FIN-158, ON-158). Biten gezilerin rapor durumu:
 * yazılmadı, taslak, onay bekliyor, onaylandı, iade edildi; onay bekleyenler önce. Yönetici
 * ayrıntı panelinde raporu onaylar ya da gerekçeyle iade eder; ön büro okur (K-529).
 */
export function FinanceTripReportsSection() {
  const list = useListState('gezi-raporlari', { urlPrefix: 'gezi_rapor_' })
  const status = list.state.filters.status
  const reports = useTripReports({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(isStatus(status) ? { status } : {}),
  })
  const panel = useDetailPanel(PANEL)
  const open = panel.open
  const filters = useMemo(
    () => [
      {
        key: 'status',
        label: 'Durum',
        type: 'select' as const,
        options: TRIP_REPORT_LIST_STATUSES.map((value) => ({
          value,
          label: REPORT_STATUS_VIEW[value].label,
        })),
      },
    ],
    [],
  )
  const rows = useMemo(
    () =>
      reports.data?.data.map((item): Row => ({
        id: item.planId,
        number: item.planNumber,
        name: item.planName,
        returned: dateLabel(item.returnAt, { year: 'numeric' }),
        author: item.authorName ?? '—',
        photos: String(item.photoCount),
        responses: String(item.responseCount),
        status: item.status,
      })),
    [reports.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'number', label: 'No' },
      { key: 'name', label: 'Gezi' },
      { key: 'returned', label: 'Dönüş' },
      { key: 'author', label: 'Yazan' },
      { key: 'photos', label: 'Fotoğraf' },
      { key: 'responses', label: 'Değerlendirme' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={REPORT_STATUS_VIEW[row.status].label}
            tone={REPORT_STATUS_VIEW[row.status].tone}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.number} raporunu aç`}
            onClick={() => open(row.id)}
          >
            Rapor
          </Button>
        ),
      },
    ],
    [open],
  )
  return (
    <section
      aria-labelledby="gezi-raporlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="gezi-raporlari" className="text-lg font-semibold">
          Gezi raporları
        </h2>
        <p className="text-sm text-muted-foreground">
          Biten gezilerin raporu, rızalı fotoğrafları ve katılımcı değerlendirmesi; raporu planın
          görevlisi öğretmen yazar, yönetici onaylar.
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={reports.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={MOBILE}
        caption="Gezi raporları"
        empty="Biten gezi yok."
        emptyFiltered="Bu durumda rapor yok."
        loading={reports.isPending}
        fetching={reports.isFetching && !reports.isPending}
        error={
          reports.error ? (
            <QueryError error={reports.error} onRetry={() => void reports.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(value) => (value ? undefined : panel.close())}
        title="Gezi raporu"
      >
        {panel.selectedId ? <FinanceTripReportView planId={panel.selectedId} /> : null}
      </SidePanel>
    </section>
  )
}
