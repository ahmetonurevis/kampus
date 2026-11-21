import { useMemo } from 'react'
import { Link } from 'react-router'
import { useDocumentGaps } from '@kampus/react-shared/use-prospect-documents.ts'
import { prospectStageLabel } from '@kampus/school-core/lib/prospects.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { gapBadgeLabel, missingLabel } from './prospect-documents.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'missingCount']

type GapRow = {
  id: string
  name: string
  stageLabel: string
  branch: string
  missing: string
  missingCount: string
  awaiting: string
}

/**
 * "Eksik belgeler" görünümü (DOM-KAY-043, K-321): aşaması gelmiş zorunlu belgesi eksik olan açık
 * adaylar, ad sırasıyla. Süzgeç sunucudadır (`GET /prospects/document-gaps`); hatırlatma aday
 * detayındaki "Hatırlat" ile not olarak düşer (K-323).
 */
export function ProspectDocumentGapsSection({
  role,
  type,
}: {
  role: string
  type: InstitutionType
}) {
  const list = useListState('eksik-belgeler', { urlPrefix: 'belge_' })
  const gaps = useDocumentGaps({ page: list.state.page, pageSize: list.state.pageSize })
  const branches = useCoreAll('branches')
  const branchNames = useMemo(
    () => new Map((branches.data ?? []).map((item) => [item.record.id, item.record.name])),
    [branches.data],
  )
  const rows = useMemo<GapRow[] | undefined>(
    () =>
      gaps.data?.data.map((row) => ({
        id: row.prospectId,
        name: row.name,
        stageLabel: prospectStageLabel(row.stage, type),
        branch: (row.branchId ? branchNames.get(row.branchId) : undefined) ?? '—',
        missing: missingLabel(row.missing),
        missingCount: gapBadgeLabel(row.missing.length) ?? '',
        awaiting: row.awaitingReview > 0 ? `${row.awaitingReview} inceleme bekliyor` : '—',
      })),
    [gaps.data, branchNames, type],
  )
  const columns = useMemo<DataColumn<GapRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Aday',
        cell: (row) => (
          <Link
            to={`/${role}/aday/${encodeURIComponent(row.id)}`}
            className="record-link font-medium text-primary hover:underline"
          >
            {row.name}
          </Link>
        ),
      },
      { key: 'stageLabel', label: 'Aşama' },
      { key: 'branch', label: 'Kampüs' },
      {
        key: 'missingCount',
        label: 'Eksik',
        cell: (row) => <StatusBadge text={row.missingCount} tone="amber" />,
      },
      { key: 'missing', label: 'Eksik belgeler' },
      { key: 'awaiting', label: 'İnceleme' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button variant="secondary" size="sm" asChild>
            <Link
              to={`/${role}/aday/${encodeURIComponent(row.id)}`}
              aria-label={`${row.name} belgelerini aç`}
            >
              <Icon name="ArrowUpRight" size={15} aria-hidden="true" />
              Belgeler
            </Link>
          </Button>
        ),
      },
    ],
    [role],
  )

  return (
    <section
      aria-labelledby="eksik-belgeler"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="eksik-belgeler" className="text-lg font-semibold">
          Eksik belgesi olan adaylar
        </h2>
        <p className="text-sm text-muted-foreground">
          {gaps.data?.meta.total ?? 0} aday · ön başvuru belgeleri aday açıkken, kesin kayıt
          belgeleri teklif aşamasında istenir
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={gaps.data?.meta.total ?? 0}
        sortable={NO_SORT}
        search={false}
        columns={columns}
        filters={[]}
        mobileColumns={MOBILE}
        caption="Eksik belgesi olan adaylar"
        empty="Eksik belgesi olan aday yok."
        loading={gaps.isPending}
        fetching={gaps.isFetching && !gaps.isPending}
        error={
          gaps.error ? (
            <QueryError error={gaps.error} onRetry={() => void gaps.refetch()} />
          ) : undefined
        }
      />
    </section>
  )
}
