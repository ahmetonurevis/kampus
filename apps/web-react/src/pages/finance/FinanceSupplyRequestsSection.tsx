import { useMemo, useState } from 'react'
import {
  useSupplyRequest,
  useSupplyRequests,
  useSupplyStockCards,
  type SupplyRequestDetail,
} from '@kampus/react-shared/use-finance-supply-requests.ts'
import { STOCK_UNIT_LABELS } from '@kampus/school-core/lib/finance-inventory.ts'
import { PURCHASE_REQUEST_STATUS_LABELS } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import {
  SUPPLY_REQUEST_STATUSES,
  type SupplyRequestStatus,
} from '@kampus/school-core/lib/finance-supply-requests.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  SupplyConvertModal,
  SupplyDecisionModal,
  SupplyFulfillModal,
  SupplyRequestFormModal,
} from './FinanceSupplyRequestForms.tsx'
import { SUPPLY_STATUS_VIEW } from './finance-supply-request-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['number', 'requestedBy', 'status']
const STATUS_OPTIONS = SUPPLY_REQUEST_STATUSES.map((value) => ({
  value,
  label: SUPPLY_STATUS_VIEW[value].label,
}))
const SCOPE_OPTIONS = [{ value: 'true', label: 'Yalnız benim taleplerim' }]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is SupplyRequestStatus =>
  SUPPLY_REQUEST_STATUSES.some((status) => status === value)
const dayText = (value: string) => dateLabel(`${value}T12:00:00Z`, { year: 'numeric' })
const timeText = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
const summarize = (names: readonly string[]) =>
  names.length <= 2
    ? names.join(', ')
    : `${names.slice(0, 2).join(', ')} ve ${String(names.length - 2)} kalem daha`

type Row = {
  id: string
  number: string
  requestedBy: string
  items: string
  neededDate: string
  status: SupplyRequestStatus
  partial: boolean
  purchase: string | null
}

/**
 * Sarf talepleri (`?gorunum=sarf`; DOM-FIN-091, ON-233). Yönetici ve ön büro (depo sorumlusu)
 * kurumun bütün taleplerini süzer; kendi adlarına talep açar. Yönetici onaylar ya da reddeder;
 * onaylı talep depodan karşılanır, kalan satın alma talebine dönüştürülür (K-244…K-246). Öğretmenin
 * kendi ekranı öğretmen sayfalarındadır; aynı kancaları kullanır.
 */
export function FinanceSupplyRequestsSection({ role }: { role: string }) {
  const list = useListState('sarf-talepleri', { urlPrefix: 'sarf_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const stockItemId = text(list.state.filters.stockItemId)
  const mine = text(list.state.filters.mine) === 'true'
  const requests = useSupplyRequests({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(stockItemId ? { stockItemId } : {}),
    ...(mine ? { mine: 'true' as const } : {}),
  })
  const cards = useSupplyStockCards({ page: 1, pageSize: 100 })
  const panel = useDetailPanel('sarf')
  const openRequest = panel.open
  const [creating, setCreating] = useState(false)

  const rows = useMemo(
    () =>
      requests.data?.data.map((item): Row => ({
        id: item.id,
        number: item.number,
        requestedBy: item.requestedByName ?? '—',
        items: summarize(item.itemSummary),
        neededDate: item.neededDate,
        status: item.status,
        partial: item.status === 'fulfilled' && !item.fullyFulfilled,
        purchase: item.purchaseRequest?.number ?? null,
      })),
    [requests.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'number', label: 'Numara' },
      { key: 'requestedBy', label: 'Talep eden' },
      { key: 'items', label: 'Kalemler' },
      { key: 'neededDate', label: 'İstenen gün', cell: (row) => dayText(row.neededDate) },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-1">
            <StatusBadge
              text={row.partial ? 'Kısmen karşılandı' : SUPPLY_STATUS_VIEW[row.status].label}
              tone={row.partial ? 'amber' : SUPPLY_STATUS_VIEW[row.status].tone}
            />
            {row.purchase ? (
              <span className="text-xs text-muted-foreground">{`Satın alma ${row.purchase}`}</span>
            ) : null}
          </span>
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.number} sarf talebini aç`}
            onClick={() => openRequest(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openRequest],
  )
  const filters = useMemo(
    () => [
      { key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS },
      {
        key: 'stockItemId',
        label: 'Stok kartı',
        type: 'select' as const,
        options: (cards.data?.data ?? []).map((card) => ({
          value: card.id,
          label: `${card.code} · ${card.name}`,
        })),
      },
      { key: 'mine', label: 'Talep eden', type: 'select' as const, options: SCOPE_OPTIONS },
    ],
    [cards.data],
  )

  return (
    <section
      aria-labelledby="sarf-talepleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="sarf-talepleri" className="text-lg font-semibold">
            Sarf talepleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Personelin kırtasiye ve laboratuvar malzemesi talepleri; onaylanan talep depodan
            karşılanır, stokta olmayan kalan satın almaya dönüşür.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni sarf talebi
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={requests.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={MOBILE}
        caption="Sarf talepleri"
        empty="Henüz sarf talebi yok."
        emptyFiltered="Bu seçimle eşleşen talep yok."
        loading={requests.isPending}
        fetching={requests.isFetching && !requests.isPending}
        error={
          requests.error ? (
            <QueryError error={requests.error} onRetry={() => void requests.refetch()} />
          ) : undefined
        }
      />
      {creating ? (
        <SupplyRequestFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            openRequest(id)
          }}
        />
      ) : null}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Sarf talebi"
      >
        {panel.selectedId ? <SupplyDetail requestId={panel.selectedId} role={role} /> : null}
      </SidePanel>
    </section>
  )
}

type Dialog = 'approve' | 'reject' | 'cancel' | 'fulfill' | 'convert' | null

function SupplyDetail({ requestId, role }: { requestId: string; role: string }) {
  const item = useSupplyRequest(requestId)
  const [dialog, setDialog] = useState<Dialog>(null)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const request = item.data?.data
  if (!request) return <SummaryLoading />
  const partial = request.status === 'fulfilled' && !request.fullyFulfilled
  const view = partial
    ? { label: 'Kısmen karşılandı', tone: 'amber' as const }
    : SUPPLY_STATUS_VIEW[request.status]
  const purchase = request.purchaseRequest
  return (
    <div className="grid gap-6">
      <section aria-labelledby="sarf-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="sarf-bilgileri" className="text-base font-semibold">
            {request.number}
          </h3>
          <StatusBadge text={view.label} tone={view.tone} />
        </div>
        <Pairs
          pairs={[
            ['Talep eden', request.requestedByName ?? '—'],
            ['İstenen gün', dayText(request.neededDate)],
            ['Gerekçe', request.justification],
            ...(purchase
              ? ([
                  [
                    'Satın alma talebi',
                    `${purchase.number} · ${PURCHASE_REQUEST_STATUS_LABELS[purchase.status]}`,
                  ],
                ] as [string, string][])
              : []),
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {request.actions.decide ? (
            <>
              <Button type="button" onClick={() => setDialog('approve')}>
                Onayla
              </Button>
              <Button type="button" variant="outline" onClick={() => setDialog('reject')}>
                Reddet
              </Button>
            </>
          ) : null}
          {request.actions.fulfill ? (
            <Button type="button" onClick={() => setDialog('fulfill')}>
              Depodan karşıla
            </Button>
          ) : null}
          {request.actions.convert ? (
            <Button type="button" variant="secondary" onClick={() => setDialog('convert')}>
              Satın alma talebine dönüştür
            </Button>
          ) : null}
          {request.actions.cancel ? (
            <Button type="button" variant="ghost" onClick={() => setDialog('cancel')}>
              Talebi iptal et
            </Button>
          ) : null}
        </div>
      </section>
      <Items request={request} showStock={role === 'yonetici' || role === 'onburo'} />
      <Issues request={request} />
      <History request={request} />
      {dialog === 'approve' || dialog === 'reject' || dialog === 'cancel' ? (
        <SupplyDecisionModal request={request} action={dialog} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'fulfill' ? (
        <SupplyFulfillModal request={request} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'convert' ? (
        <SupplyConvertModal
          request={request}
          onClose={() => setDialog(null)}
          onConverted={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}

function Pairs({ pairs }: { pairs: readonly [string, string][] }) {
  return (
    <dl className="grid gap-2 text-sm">
      {pairs.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[minmax(0,11rem)_1fr] gap-2 max-[480px]:grid-cols-1"
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="[overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Items({ request, showStock }: { request: SupplyRequestDetail; showStock: boolean }) {
  return (
    <section aria-labelledby="sarf-kalemleri" className="grid gap-3">
      <h3 id="sarf-kalemleri" className="text-base font-semibold">
        Kalemler
      </h3>
      <ul className="grid gap-2" aria-label="Sarf talebi kalemleri">
        {request.items.map((line) => {
          const unit = STOCK_UNIT_LABELS[line.unit]
          const stock = (line.stock ?? [])
            .map((row) => `${row.warehouseName} ${String(row.quantity)}`)
            .join(', ')
          return (
            <li key={line.id} className="grid gap-1 rounded-lg border px-3 py-2 text-sm">
              <span className="font-medium">{`${line.stockItem.code} · ${line.stockItem.name}`}</span>
              <span className="text-muted-foreground">
                {`İstenen ${String(line.quantity)} ${unit} · karşılanan ${String(line.fulfilledQuantity)} · kalan ${String(line.remainingQuantity)}`}
              </span>
              {showStock && line.remainingQuantity > 0 ? (
                <span className="text-muted-foreground">
                  {stock === '' ? 'Etkin depolarda stok yok' : `Depoda: ${stock}`}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Issues({ request }: { request: SupplyRequestDetail }) {
  if (request.issues.length === 0) return null
  return (
    <section aria-labelledby="sarf-karsilamalar" className="grid gap-3">
      <h3 id="sarf-karsilamalar" className="text-base font-semibold">
        Karşılamalar
      </h3>
      <ul className="grid gap-2 text-sm" aria-label="Karşılama geçmişi">
        {request.issues.map((issue) => (
          <li key={issue.movementId} className="rounded-lg border px-3 py-2">
            {`${dayText(issue.movementDate)} · ${issue.itemName} · ${String(issue.quantity)} · ${issue.warehouseName} · ${issue.createdByName ?? '—'}`}
          </li>
        ))}
      </ul>
    </section>
  )
}

function History({ request }: { request: SupplyRequestDetail }) {
  const pairs: [string, string][] = [['Açıldı', timeText(request.createdAt)]]
  if (request.decidedAt)
    pairs.push([
      request.status === 'rejected' ? 'Reddedildi' : 'Onaylandı',
      `${timeText(request.decidedAt)} · ${request.decidedByName ?? '—'}`,
    ])
  if (request.decisionNote)
    pairs.push([
      request.status === 'rejected' ? 'Ret gerekçesi' : 'Onay notu',
      request.decisionNote,
    ])
  if (request.fulfilledAt)
    pairs.push([
      'Karşılandı',
      `${timeText(request.fulfilledAt)} · ${request.fulfilledByName ?? '—'}`,
    ])
  if (request.fulfillmentNote) pairs.push(['Kapatma açıklaması', request.fulfillmentNote])
  if (request.cancelledAt)
    pairs.push([
      'İptal edildi',
      `${timeText(request.cancelledAt)} · ${request.cancelledByName ?? '—'}`,
    ])
  if (request.cancelReason) pairs.push(['İptal gerekçesi', request.cancelReason])
  return (
    <section aria-labelledby="sarf-gecmisi" className="grid gap-3">
      <h3 id="sarf-gecmisi" className="text-base font-semibold">
        Geçmiş
      </h3>
      <Pairs pairs={pairs} />
    </section>
  )
}
