import { useMemo, useState } from 'react'
import {
  useBudgetLines,
  useBudgetPeriod,
  useChangeBudgetPeriodStatus,
  useRemoveBudgetLine,
  type BudgetLine,
  type BudgetPeriod,
} from '@kampus/react-shared/use-finance-budget.ts'
import {
  BUDGET_ITEM_KIND_LABELS,
  BUDGET_ITEM_KINDS,
} from '@kampus/school-core/lib/finance-budget.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading, SummaryMetrics } from '../management/SummaryParts.tsx'
import { BudgetLineFormModal, BudgetPeriodFormModal } from './FinanceBudgetForms.tsx'
import { monthLabel, PERIOD_STATUS_VIEW } from './finance-budget-forms.ts'

const NO_SORT: readonly string[] = []
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const filterText = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

/**
 * Bütçe dönemi paneli (`?butce-donemi=`; DOM-FIN-062): toplamlar, durum geçişi (taslak → açık →
 * kapalı, yalnız yönetici; K-61) ve planlanan tutar satırları. Kapalı dönemde düzenleme düğmesi
 * çizilmez; sunucu da reddeder.
 */
export function FinanceBudgetPeriodPanel({
  periodId,
  academicYear,
  onClose,
}: {
  periodId: string
  academicYear: number
  onClose: () => void
}) {
  const period = useBudgetPeriod(periodId)
  const data = period.data?.data
  return (
    <SidePanel
      open={periodId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={data?.name ?? 'Bütçe dönemi'}
      description="Planlanan gelir ve gider, maliyet merkezi ve kalem bazında."
    >
      {period.error ? (
        <QueryError error={period.error} onRetry={() => void period.refetch()} />
      ) : data ? (
        <PeriodDetail period={data} academicYear={academicYear} />
      ) : (
        <SummaryLoading />
      )}
    </SidePanel>
  )
}

function PeriodDetail({ period, academicYear }: { period: BudgetPeriod; academicYear: number }) {
  const status = useChangeBudgetPeriodStatus()
  const [editing, setEditing] = useState(false)
  const writable = period.status !== 'closed'
  const view = PERIOD_STATUS_VIEW[period.status]
  const change = (action: 'open' | 'close') =>
    void status.submit({ periodId: period.id, version: period.version, action }).then((outcome) => {
      if (outcome.status === 'success')
        notify.success(action === 'open' ? 'Bütçe dönemi açıldı.' : 'Bütçe dönemi kapatıldı.')
    })
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge text={view.label} tone={view.tone} />
        <span className="text-sm text-muted-foreground">
          {dayText(period.startDate)} – {dayText(period.endDate)}
        </span>
      </div>
      <SummaryMetrics
        items={[
          { label: 'Planlanan gelir', value: money(period.incomeCents) },
          { label: 'Planlanan gider', value: money(period.expenseCents) },
          { label: 'Fark', value: money(period.balanceCents) },
          { label: 'Satır', value: period.lineCount },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {writable ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Dönemi düzenle
          </Button>
        ) : null}
        {period.status === 'draft' ? (
          <Button disabled={status.isPending} onClick={() => change('open')}>
            Dönemi aç
          </Button>
        ) : null}
        {period.status === 'open' ? (
          <Button variant="secondary" disabled={status.isPending} onClick={() => change('close')}>
            Dönemi kapat
          </Button>
        ) : null}
      </div>
      {period.status === 'open' ? (
        <p className="text-sm text-muted-foreground">
          Kapatılan dönemde satır eklenmez, düzeltilmez ve kaldırılmaz; kapanış geri alınmaz.
        </p>
      ) : null}
      <LinesTable period={period} writable={writable} />
      {editing ? (
        <BudgetPeriodFormModal
          period={period}
          academicYear={academicYear}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}

type LineRow = {
  id: string
  center: string
  item: string
  kind: string
  amount: number
  distribution: string
  line: BudgetLine
}

function LinesTable({ period, writable }: { period: BudgetPeriod; writable: boolean }) {
  const list = useListState(`butce-satirlari-${period.id}`, { urlPrefix: 'satir_' })
  const search = useDebouncedValue(list.state.query).trim()
  const kindFilter = filterText(list.state.filters.kind)
  const kind = BUDGET_ITEM_KINDS.find((value) => value === kindFilter)
  const lines = useBudgetLines(period.id, {
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(kind ? { kind } : {}),
  })
  const remove = useRemoveBudgetLine()
  const [editing, setEditing] = useState<BudgetLine | 'new' | null>(null)
  const rows = useMemo(
    () =>
      lines.data?.data.map((line): LineRow => ({
        id: line.id,
        center: `${line.costCenterCode} · ${line.costCenterName}`,
        item: `${line.itemCode} · ${line.itemName}`,
        kind: BUDGET_ITEM_KIND_LABELS[line.itemKind],
        amount: line.amountCents,
        distribution:
          line.monthlyCents === null
            ? 'Yok'
            : `${monthLabel(period.months[0] ?? '')} – ${monthLabel(period.months.at(-1) ?? '')}`,
        line,
      })),
    [lines.data, period.months],
  )
  const columns = useMemo<DataColumn<LineRow>[]>(
    () => [
      { key: 'center', label: 'Maliyet merkezi' },
      { key: 'item', label: 'Kalem' },
      { key: 'kind', label: 'Tür' },
      { key: 'amount', label: 'Planlanan', cell: (row) => money(row.amount) },
      { key: 'distribution', label: 'Aylık dağılım' },
      ...(writable
        ? [
            {
              key: ACTIONS_KEY,
              label: 'İşlemler',
              cell: (row: LineRow) => (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`${row.item} satırını düzenle`}
                    onClick={() => setEditing(row.line)}
                  >
                    Düzenle
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    aria-label={`${row.item} satırını kaldır`}
                    onClick={() =>
                      void remove
                        .submit({ periodId: period.id, lineId: row.id, version: row.line.version })
                        .then((outcome) => {
                          if (outcome.status === 'success')
                            notify.success('Bütçe satırı kaldırıldı.')
                        })
                    }
                  >
                    Kaldır
                  </Button>
                </div>
              ),
            },
          ]
        : []),
    ],
    [period.id, remove, writable],
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
    ],
    [],
  )
  return (
    <section aria-labelledby="butce-satirlari" className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="butce-satirlari" className="text-md font-semibold">
          Bütçe satırları
        </h3>
        {writable ? (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Icon name="Plus" size={16} aria-hidden="true" />
            Satır ekle
          </Button>
        ) : null}
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={lines.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={['center', 'item', 'amount']}
        caption="Bütçe satırları"
        empty="Bu dönemde henüz satır yok."
        emptyFiltered="Bu aramayla eşleşen satır yok."
        loading={lines.isPending}
        fetching={lines.isFetching && !lines.isPending}
        error={
          lines.error ? (
            <QueryError error={lines.error} onRetry={() => void lines.refetch()} />
          ) : undefined
        }
      />
      {editing ? (
        <BudgetLineFormModal
          period={period}
          {...(editing === 'new' ? {} : { line: editing })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  )
}
