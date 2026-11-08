import { useMemo, useState } from 'react'
import {
  useBudgetItems,
  useBudgetPeriods,
  useCostCenters,
  useUpdateBudgetItem,
  useUpdateCostCenter,
  type BudgetItem,
  type BudgetPeriod,
  type CostCenter,
} from '@kampus/react-shared/use-finance-budget.ts'
import { FEE_ITEM_KIND_LABELS } from '@kampus/school-core/lib/fee-tariffs.ts'
import {
  BUDGET_ITEM_KIND_LABELS,
  BUDGET_ITEM_KINDS,
  BUDGET_PERIOD_STATUSES,
  type BudgetItemKind,
  type BudgetPeriodStatus,
} from '@kampus/school-core/lib/finance-budget.ts'
import {
  COST_CENTER_TYPE_LABELS,
  COST_CENTER_TYPES,
  type CostCenterType,
} from '@kampus/school-core/lib/finance-cost-centers.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { FinanceBudgetPeriodPanel } from './FinanceBudgetPeriodPanel.tsx'
import {
  BudgetItemFormModal,
  BudgetPeriodFormModal,
  CostCenterFormModal,
} from './FinanceBudgetForms.tsx'
import { PERIOD_STATUS_VIEW } from './finance-budget-forms.ts'

const NO_SORT: readonly string[] = []
const ACTIVE_OPTIONS = [
  { value: 'active', label: 'Etkin' },
  { value: 'inactive', label: 'Pasif' },
]
const filterText = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const oneOf = <T extends string>(values: readonly T[], value: string | null): T | undefined =>
  values.find((item) => item === value)
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const activeStatus = (value: string | null) => oneOf(['active', 'inactive'] as const, value)
const searchOf = (text: string) => (text.length >= 2 ? { q: text } : {})

function Panel({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string
  title: string
  description: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="panel overflow-hidden rounded-card border bg-surface">
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

const ActiveBadge = ({ active }: { active: boolean }) =>
  active ? <StatusBadge text="Etkin" tone="green" /> : <StatusBadge text="Pasif" tone="gray" />

/**
 * Bütçe (`?gorunum=butce`; DOM-FIN-062, ON-241, ON-242): yalnız yönetici. Bütçe dönemleri (toplamlar
 * satırlardan hesaplanır; satırlar `?butce-donemi=` sağ panelinde), maliyet merkezleri (kampüs,
 * birim, program hiyerarşisi) ve gelir/gider kalemleri. Merkez ve kalem silinmez, pasifleşir.
 */
export function FinanceBudgetSection({
  academicYear,
  institutionType,
}: {
  academicYear: number
  institutionType: string
}) {
  return (
    <div className="grid gap-6">
      <PeriodsTable academicYear={academicYear} />
      <CentersTable institutionType={institutionType} />
      <ItemsTable />
    </div>
  )
}

// --- Dönem ---------------------------------------------------------------------------------------

type PeriodRow = {
  id: string
  name: string
  range: string
  status: BudgetPeriodStatus
  income: number
  expense: number
  balance: number
}

function PeriodsTable({ academicYear }: { academicYear: number }) {
  const list = useListState('butce-donemleri', { urlPrefix: 'donem_' })
  const status = oneOf(BUDGET_PERIOD_STATUSES, filterText(list.state.filters.status))
  const periods = useBudgetPeriods({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(status ? { status } : {}),
  })
  const panel = useDetailPanel('butce-donemi')
  const openPeriod = panel.open
  const [creating, setCreating] = useState(false)
  const rows = useMemo(
    () =>
      periods.data?.data.map((item: BudgetPeriod): PeriodRow => ({
        id: item.id,
        name: item.name,
        range: `${dayText(item.startDate)} – ${dayText(item.endDate)}`,
        status: item.status,
        income: item.incomeCents,
        expense: item.expenseCents,
        balance: item.balanceCents,
      })),
    [periods.data],
  )
  const columns = useMemo<DataColumn<PeriodRow>[]>(
    () => [
      { key: 'name', label: 'Dönem' },
      { key: 'range', label: 'Aralık' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={PERIOD_STATUS_VIEW[row.status].label}
            tone={PERIOD_STATUS_VIEW[row.status].tone}
          />
        ),
      },
      { key: 'income', label: 'Gelir', cell: (row) => money(row.income) },
      { key: 'expense', label: 'Gider', cell: (row) => money(row.expense) },
      { key: 'balance', label: 'Fark', cell: (row) => money(row.balance) },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} dönemini aç`}
            onClick={() => openPeriod(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openPeriod],
  )
  const filters = useMemo(
    () => [
      {
        key: 'status',
        label: 'Durum',
        type: 'select' as const,
        options: BUDGET_PERIOD_STATUSES.map((value) => ({
          value,
          label: PERIOD_STATUS_VIEW[value].label,
        })),
      },
    ],
    [],
  )
  return (
    <Panel
      id="butce-donemleri"
      title="Bütçe dönemleri"
      description="Taslak dönem açılınca yürürlüğe girer; kapalı dönem değişmez. Açık dönemler örtüşmez."
      action={
        <Button onClick={() => setCreating(true)}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni dönem
        </Button>
      }
    >
      <ServerDataTable
        list={list}
        rows={rows}
        total={periods.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={['name', 'status', 'balance']}
        caption="Bütçe dönemleri"
        search={false}
        empty="Henüz bütçe dönemi yok."
        emptyFiltered="Bu durumda bütçe dönemi yok."
        loading={periods.isPending}
        fetching={periods.isFetching && !periods.isPending}
        error={
          periods.error ? (
            <QueryError error={periods.error} onRetry={() => void periods.refetch()} />
          ) : undefined
        }
      />
      {creating ? (
        <BudgetPeriodFormModal
          academicYear={academicYear}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            openPeriod(id)
          }}
        />
      ) : null}
      <FinanceBudgetPeriodPanel
        periodId={panel.selectedId}
        academicYear={academicYear}
        onClose={panel.close}
      />
    </Panel>
  )
}

// --- Maliyet merkezi -----------------------------------------------------------------------------

type CenterRow = {
  id: string
  path: string
  name: string
  type: string
  link: string
  active: boolean
  center: CostCenter
}

function centerLink(center: CostCenter): string {
  if (center.type === 'campus') return center.campusName ?? 'Arşivlenmiş kampüs'
  if (center.gradeLevel !== null) return `${center.gradeLevel}. sınıf`
  if (center.courseId !== null) return center.courseName ?? 'Arşivlenmiş kur'
  return '—'
}

function CentersTable({ institutionType }: { institutionType: string }) {
  const list = useListState('maliyet-merkezleri', { urlPrefix: 'merkez_' })
  const search = useDebouncedValue(list.state.query).trim()
  const type = oneOf(COST_CENTER_TYPES, filterText(list.state.filters.type))
  const status = activeStatus(filterText(list.state.filters.status))
  const centers = useCostCenters({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...searchOf(search),
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
  })
  const toggle = useUpdateCostCenter()
  const [editing, setEditing] = useState<CostCenter | 'new' | null>(null)
  const rows = useMemo(
    () =>
      centers.data?.data.map((item): CenterRow => ({
        id: item.id,
        path: item.path,
        name: item.name,
        type: COST_CENTER_TYPE_LABELS[item.type as CostCenterType],
        link: centerLink(item),
        active: item.isActive,
        center: item,
      })),
    [centers.data],
  )
  const columns = useMemo<DataColumn<CenterRow>[]>(
    () => [
      { key: 'path', label: 'Kod' },
      { key: 'name', label: 'Ad' },
      { key: 'type', label: 'Tür' },
      { key: 'link', label: 'Bağ' },
      { key: 'active', label: 'Durum', cell: (row) => <ActiveBadge active={row.active} /> },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.name} merkezini düzenle`}
              onClick={() => setEditing(row.center)}
            >
              Düzenle
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={toggle.isPending}
              aria-label={`${row.name} merkezini ${row.active ? 'pasifleştir' : 'etkinleştir'}`}
              onClick={() =>
                void toggle
                  .submit({
                    costCenterId: row.id,
                    version: row.center.version,
                    body: { isActive: !row.active },
                  })
                  .then((outcome) => {
                    if (outcome.status === 'success')
                      notify.success(row.active ? 'Merkez pasifleştirildi.' : 'Merkez etkinleşti.')
                  })
              }
            >
              {row.active ? 'Pasifleştir' : 'Etkinleştir'}
            </Button>
          </div>
        ),
      },
    ],
    [toggle],
  )
  const filters = useMemo(
    () => [
      {
        key: 'type',
        label: 'Tür',
        type: 'select' as const,
        options: COST_CENTER_TYPES.map((value) => ({
          value,
          label: COST_CENTER_TYPE_LABELS[value],
        })),
      },
      { key: 'status', label: 'Durum', type: 'select' as const, options: ACTIVE_OPTIONS },
    ],
    [],
  )
  return (
    <Panel
      id="maliyet-merkezleri"
      title="Maliyet merkezleri"
      description="Kampüs, birim ve program merkezleri en çok 4 düzeyli hiyerarşi kurar; silinmez, pasifleşir."
      action={
        <Button onClick={() => setEditing('new')}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni merkez
        </Button>
      }
    >
      <ServerDataTable
        list={list}
        rows={rows}
        total={centers.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={['path', 'name', 'active']}
        caption="Maliyet merkezleri"
        empty="Henüz maliyet merkezi yok."
        emptyFiltered="Bu aramayla eşleşen merkez yok."
        loading={centers.isPending}
        fetching={centers.isFetching && !centers.isPending}
        error={
          centers.error ? (
            <QueryError error={centers.error} onRetry={() => void centers.refetch()} />
          ) : undefined
        }
      />
      {editing ? (
        <CostCenterFormModal
          {...(editing === 'new' ? {} : { center: editing })}
          institutionType={institutionType}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Panel>
  )
}

// --- Kalem ---------------------------------------------------------------------------------------

type ItemRow = {
  id: string
  code: string
  name: string
  kind: string
  feeKind: string
  active: boolean
  item: BudgetItem
}

function ItemsTable() {
  const list = useListState('butce-kalemleri', { urlPrefix: 'kalem_' })
  const search = useDebouncedValue(list.state.query).trim()
  const kind = oneOf<BudgetItemKind>(BUDGET_ITEM_KINDS, filterText(list.state.filters.kind))
  const status = activeStatus(filterText(list.state.filters.status))
  const items = useBudgetItems({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...searchOf(search),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
  })
  const toggle = useUpdateBudgetItem()
  const [editing, setEditing] = useState<BudgetItem | 'new' | null>(null)
  const rows = useMemo(
    () =>
      items.data?.data.map((item): ItemRow => ({
        id: item.id,
        code: item.code,
        name: item.name,
        kind: BUDGET_ITEM_KIND_LABELS[item.kind],
        feeKind: item.feeKind === null ? '—' : FEE_ITEM_KIND_LABELS[item.feeKind],
        active: item.isActive,
        item,
      })),
    [items.data],
  )
  const columns = useMemo<DataColumn<ItemRow>[]>(
    () => [
      { key: 'code', label: 'Kod' },
      { key: 'name', label: 'Ad' },
      { key: 'kind', label: 'Tür' },
      { key: 'feeKind', label: 'Ücret türü' },
      { key: 'active', label: 'Durum', cell: (row) => <ActiveBadge active={row.active} /> },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.name} kalemini düzenle`}
              onClick={() => setEditing(row.item)}
            >
              Düzenle
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={toggle.isPending}
              aria-label={`${row.name} kalemini ${row.active ? 'pasifleştir' : 'etkinleştir'}`}
              onClick={() =>
                void toggle
                  .submit({
                    itemId: row.id,
                    version: row.item.version,
                    body: { isActive: !row.active },
                  })
                  .then((outcome) => {
                    if (outcome.status === 'success')
                      notify.success(row.active ? 'Kalem pasifleştirildi.' : 'Kalem etkinleşti.')
                  })
              }
            >
              {row.active ? 'Pasifleştir' : 'Etkinleştir'}
            </Button>
          </div>
        ),
      },
    ],
    [toggle],
  )
  const filters = useMemo(
    () => [
      {
        key: 'kind',
        label: 'Tür',
        type: 'select' as const,
        options: BUDGET_ITEM_KINDS.map((value) => ({
          value,
          label: BUDGET_ITEM_KIND_LABELS[value],
        })),
      },
      { key: 'status', label: 'Durum', type: 'select' as const, options: ACTIVE_OPTIONS },
    ],
    [],
  )
  return (
    <Panel
      id="butce-kalemleri"
      title="Bütçe kalemleri"
      description="Gelir ve gider kalemleri; gelir kalemi bir ücret türüne eşlenebilir."
      action={
        <Button onClick={() => setEditing('new')}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni kalem
        </Button>
      }
    >
      <ServerDataTable
        list={list}
        rows={rows}
        total={items.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={['code', 'name', 'active']}
        caption="Bütçe kalemleri"
        empty="Henüz bütçe kalemi yok."
        emptyFiltered="Bu aramayla eşleşen kalem yok."
        loading={items.isPending}
        fetching={items.isFetching && !items.isPending}
        error={
          items.error ? (
            <QueryError error={items.error} onRetry={() => void items.refetch()} />
          ) : undefined
        }
      />
      {editing ? (
        <BudgetItemFormModal
          {...(editing === 'new' ? {} : { item: editing })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Panel>
  )
}
