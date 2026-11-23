import { useMemo } from 'react'
import {
  useFixedAssetAssignees,
  useFixedAssetAssignments,
  type FixedAssetAssignee,
} from '@kampus/react-shared/use-finance-fixed-asset-assignments.ts'
import { FIXED_ASSET_CATEGORY_LABELS } from '@kampus/school-core/lib/finance-fixed-assets.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useStaffAssignmentsPdf } from '@/hooks/use-finance-fixed-asset-assignment-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { FIXED_ASSET_ASSIGNMENT_TITLE } from '@/lib/pdf/templates/finance-fixed-asset-assignment.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import { roleLabel } from './finance-fixed-asset-assignment-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'openAssignmentCount']
const STATUS_OPTIONS = [
  { value: 'active', label: 'Etkin' },
  { value: 'passive', label: 'Pasif (ayrılan)' },
]
const HOLDING_OPTIONS = [{ value: 'true', label: 'Açık zimmeti olanlar' }]
const FILTERS = [
  { key: 'status', label: 'Personel durumu', type: 'select' as const, options: STATUS_OPTIONS },
  { key: 'holding', label: 'Zimmet', type: 'select' as const, options: HOLDING_OPTIONS },
]
const PERSON_PAGE = { page: 1, pageSize: 100 } as const
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

type Row = {
  id: string
  name: string
  role: string
  active: boolean
  openAssignmentCount: number
}

/**
 * Personel zimmetleri (DOM-FIN-086, K-214): yönetici, öğretmen ve ön büro, üzerindeki açık zimmet
 * sayısıyla. Personel ayrılırken (pasif) açık zimmetleri buradan görülür, tek tutanakla iade
 * süreci başlatılır; iade demirbaş panelinden alınır. İlişik kesme süreci ON-180'dedir.
 */
export function FinanceFixedAssetStaffSection() {
  const list = useListState('demirbas-personel', { urlPrefix: 'zimmet_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const holding = text(list.state.filters.holding)
  const assignees = useFixedAssetAssignees({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === 'active' || status === 'passive' ? { status } : {}),
    ...(holding === 'true' ? { holding } : {}),
  })
  const panel = useDetailPanel('zimmet_personel')
  const openPerson = panel.open
  const rows = useMemo(
    () =>
      assignees.data?.data.map((item): Row => ({
        id: item.membershipId,
        name: item.name,
        role: roleLabel(item.role),
        active: item.active,
        openAssignmentCount: item.openAssignmentCount,
      })),
    [assignees.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'name', label: 'Ad' },
      { key: 'role', label: 'Rol' },
      {
        key: 'active',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={row.active ? 'Etkin' : 'Pasif'}
            tone={row.active ? 'green' : 'amber'}
          />
        ),
      },
      { key: 'openAssignmentCount', label: 'Açık zimmet' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} zimmetlerini aç`}
            onClick={() => openPerson(row.id)}
          >
            Zimmetler
          </Button>
        ),
      },
    ],
    [openPerson],
  )
  const selected = assignees.data?.data.find((item) => item.membershipId === panel.selectedId)
  return (
    <section
      aria-labelledby="personel-zimmetleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="personel-zimmetleri" className="text-lg font-semibold">
          Personel zimmetleri
        </h2>
        <p className="text-sm text-muted-foreground">
          Ayrılan (pasif) personelin açık zimmetleri iade alınmadan ilişik kesilmez.
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={assignees.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Personel zimmetleri"
        empty="Kurumda personel yok."
        emptyFiltered="Bu seçimle eşleşen personel yok."
        loading={assignees.isPending}
        fetching={assignees.isFetching && !assignees.isPending}
        error={
          assignees.error ? (
            <QueryError error={assignees.error} onRetry={() => void assignees.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Personel zimmeti"
      >
        {panel.selectedId ? (
          <StaffAssignments membershipId={panel.selectedId} person={selected} />
        ) : null}
      </SidePanel>
    </section>
  )
}

function StaffAssignments({
  membershipId,
  person,
}: {
  membershipId: string
  person: FixedAssetAssignee | undefined
}) {
  const assignments = useFixedAssetAssignments({ membershipId, state: 'open', ...PERSON_PAGE })
  if (assignments.error)
    return <QueryError error={assignments.error} onRetry={() => void assignments.refetch()} />
  const items = assignments.data?.data
  if (!items) return <SummaryLoading />
  const first = items[0]
  const name = person?.name ?? first?.staffName ?? 'Personel'
  const passive = person ? !person.active : first?.staffActive === false
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{name}</h3>
        <p className="text-sm text-muted-foreground">
          {roleLabel(person?.role ?? first?.staffRole ?? null)}
          {passive ? ' · pasif: açık zimmetler iade alınmalı' : ''}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Üzerinde açık zimmet yok.</p>
      ) : (
        <>
          <div>
            <PdfDialogButton
              label="Zimmet tutanağı PDF"
              title={FIXED_ASSET_ASSIGNMENT_TITLE}
              id={membershipId}
              usePdf={useStaffAssignmentsPdf}
            />
          </div>
          <ul aria-label="Açık zimmetler" className="grid gap-2 text-sm">
            {items.map((item) => (
              <li key={item.id} className="grid gap-1 rounded-sm border px-3 py-2">
                <span className="font-medium [overflow-wrap:anywhere]">
                  {item.assetTagNumber} · {item.assetName}
                </span>
                <span className="text-muted-foreground">
                  {FIXED_ASSET_CATEGORY_LABELS[item.assetCategory]} · {dayText(item.assignedDate)}
                </span>
              </li>
            ))}
          </ul>
          {(assignments.data?.meta.total ?? 0) > items.length ? (
            <p className="text-sm text-muted-foreground">
              İlk {String(items.length)} zimmet gösteriliyor; tutanak hepsini içerir.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
