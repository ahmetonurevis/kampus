import { lazy, Suspense, useMemo, useState } from 'react'
import {
  usePurchaseRequest,
  usePurchaseRequestOptions,
  usePurchaseRequests,
  useTransitionPurchaseRequest,
  type PurchaseRequestDetail,
} from '@kampus/react-shared/use-finance-procurement.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  PURCHASE_REQUEST_STATUSES,
  PURCHASE_REQUEST_STATUS_LABELS,
  PURCHASE_UNIT_LABELS,
  type PurchaseRequestStatus,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'
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
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PurchaseRequestFormModal, ReasonModal } from './FinancePurchaseRequestForms.tsx'
import { REQUEST_STATUS_VIEW } from './finance-procurement-forms.ts'

// Teklif ve sipariş (DOM-FIN-072, DOM-FIN-073) yalnız onaylı talepte açılan ayrı parçadır.
const FinancePurchaseQuotesPanel = lazy(async () => ({
  default: (await import('./FinancePurchaseQuotesPanel.tsx')).FinancePurchaseQuotesPanel,
}))

const NO_SORT: readonly string[] = []
const MOBILE = ['number', 'status', 'total']
const STATUS_OPTIONS = PURCHASE_REQUEST_STATUSES.map((value) => ({
  value,
  label: PURCHASE_REQUEST_STATUS_LABELS[value],
}))
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is PurchaseRequestStatus =>
  PURCHASE_REQUEST_STATUSES.some((status) => status === value)
const timeText = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

type Row = {
  id: string
  number: string
  costCenter: string
  budgetItem: string
  total: number
  requestedBy: string
  status: PurchaseRequestStatus
}

/**
 * Satın alma talepleri (`?gorunum=satin-alma`; DOM-FIN-071, ON-222). Yönetici ve ön büro talep açar,
 * düzeltir, gönderir ve iptal eder (ön büro yalnız kendi talebini; K-128); onay ve ret yöneticidedir
 * (K-129). Talep ayrıntısı (`?talep=`) bütçe kalanını bilgi olarak gösterir; aşım engellenmez
 * (K-131). Kademeli onay ON-223 ile gelir.
 */
export function FinancePurchaseRequestsSection() {
  const list = useListState('satin-alma-talepleri', { urlPrefix: 'talep_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const costCenterId = text(list.state.filters.costCenterId)
  const periodId = text(list.state.filters.periodId)
  const requests = usePurchaseRequests({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(costCenterId ? { costCenterId } : {}),
    ...(periodId ? { periodId } : {}),
  })
  const options = usePurchaseRequestOptions()
  const panel = useDetailPanel('talep')
  const openRequest = panel.open
  const [creating, setCreating] = useState(false)

  const rows = useMemo(
    () =>
      requests.data?.data.map((item): Row => ({
        id: item.id,
        number: item.number,
        costCenter: item.costCenter.name,
        budgetItem: `${item.budgetItem.code} · ${item.budgetItem.name}`,
        total: item.totalCents,
        requestedBy: item.requestedByName ?? '—',
        status: item.status,
      })),
    [requests.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'number', label: 'Numara' },
      { key: 'costCenter', label: 'Talep eden birim' },
      { key: 'budgetItem', label: 'Gider kalemi' },
      { key: 'total', label: 'Tahmini toplam', cell: (row) => money(row.total) },
      { key: 'requestedBy', label: 'Açan' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={REQUEST_STATUS_VIEW[row.status].label}
            tone={REQUEST_STATUS_VIEW[row.status].tone}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.number} talebini aç`}
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
        key: 'costCenterId',
        label: 'Birim',
        type: 'select' as const,
        options: (options.data?.data.costCenters ?? []).map((item) => ({
          value: item.id,
          label: item.name,
        })),
      },
      {
        key: 'periodId',
        label: 'Bütçe dönemi',
        type: 'select' as const,
        options: (options.data?.data.periods ?? []).map((item) => ({
          value: item.id,
          label: item.name,
        })),
      },
    ],
    [options.data],
  )

  return (
    <section
      aria-labelledby="satin-alma-talepleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="satin-alma-talepleri" className="text-lg font-semibold">
            Satın alma talepleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Birimlerin gerekçeli ihtiyaçları; talep bir gider kalemine yazılır, onayı yönetici
            verir.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni talep
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
        caption="Satın alma talepleri"
        empty="Henüz satın alma talebi yok."
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
        <PurchaseRequestFormModal
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
        title="Satın alma talebi"
      >
        {panel.selectedId ? <RequestDetail requestId={panel.selectedId} /> : null}
      </SidePanel>
    </section>
  )
}

type Dialog = 'edit' | 'approve' | 'reject' | 'cancel' | null

function RequestDetail({ requestId }: { requestId: string }) {
  const item = usePurchaseRequest(requestId)
  const transition = useTransitionPurchaseRequest()
  const [dialog, setDialog] = useState<Dialog>(null)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const request = item.data?.data
  if (!request) return <SummaryLoading />
  const view = REQUEST_STATUS_VIEW[request.status]
  const busy = transition.isPending
  const submit = async () => {
    const outcome = await transition.submit({
      requestId: request.id,
      version: request.version,
      action: 'submit',
    })
    if (outcome.status === 'success') notify.success(`${request.number} onaya gönderildi.`)
  }
  return (
    <div className="grid gap-6">
      <section aria-labelledby="talep-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="talep-bilgileri" className="text-base font-semibold">
            {request.number}
          </h3>
          <StatusBadge text={view.label} tone={view.tone} />
        </div>
        <Facts request={request} />
        <div className="flex flex-wrap gap-2">
          {request.actions.edit ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setDialog('edit')}
            >
              Düzenle
            </Button>
          ) : null}
          {request.actions.submit ? (
            <Button
              type="button"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => void submit()}
            >
              <Icon name="Send" size={16} aria-hidden="true" />
              Onaya gönder
            </Button>
          ) : null}
          {request.actions.decide ? (
            <>
              <Button type="button" disabled={busy} onClick={() => setDialog('approve')}>
                Onayla
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setDialog('reject')}
              >
                Reddet
              </Button>
            </>
          ) : null}
          {request.actions.cancel ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setDialog('cancel')}
            >
              Talebi iptal et
            </Button>
          ) : null}
        </div>
      </section>
      <BudgetInfo request={request} />
      <section aria-labelledby="talep-kalemleri" className="grid gap-3">
        <h3 id="talep-kalemleri" className="text-base font-semibold">
          Kalemler
        </h3>
        <ul className="grid gap-2" aria-label="Talep kalemleri">
          {request.items.map((line) => (
            <li
              key={line.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium">{line.name}</span>
                <span className="block text-muted-foreground">
                  {`${String(line.quantity)} ${PURCHASE_UNIT_LABELS[line.unit]} × ${money(line.estimatedUnitPriceCents)}`}
                </span>
              </span>
              <span className="font-medium tabular-nums">{money(line.totalCents)}</span>
            </li>
          ))}
        </ul>
        <p className="text-right text-sm font-semibold">
          Tahmini toplam: <span className="tabular-nums">{money(request.totalCents)}</span>
        </p>
      </section>
      {request.status === 'approved' ? (
        <Suspense fallback={<SummaryLoading />}>
          <FinancePurchaseQuotesPanel requestId={request.id} />
        </Suspense>
      ) : null}
      <History request={request} />
      {dialog === 'edit' ? (
        <PurchaseRequestFormModal request={request} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'approve' || dialog === 'reject' || dialog === 'cancel' ? (
        <ReasonModal request={request} action={dialog} onClose={() => setDialog(null)} />
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

function Facts({ request }: { request: PurchaseRequestDetail }) {
  return (
    <Pairs
      pairs={[
        ['Talep eden birim', `${request.costCenter.code} · ${request.costCenter.name}`],
        ['Bütçe dönemi', request.period.name],
        ['Gider kalemi', `${request.budgetItem.code} · ${request.budgetItem.name}`],
        ['Önerilen tedarikçi', request.supplier?.name ?? '—'],
        ['Gerekçe', request.justification],
        ['Açan', request.requestedByName ?? '—'],
      ]}
    />
  )
}

/** Bütçe kalanı bilgisi (K-131): plan, onaylanmış ve bekleyen talepler; aşım yalnız uyarıdır. */
function BudgetInfo({ request }: { request: PurchaseRequestDetail }) {
  const budget = request.budget
  return (
    <section aria-labelledby="talep-butce" className="grid gap-3">
      <h3 id="talep-butce" className="text-base font-semibold">
        Bütçe durumu
      </h3>
      {budget.plannedCents === null ? (
        <p className="text-sm text-muted-foreground">
          Bu dönemde birim ve gider kalemi için bütçe planı yok.
        </p>
      ) : (
        <Pairs
          pairs={[
            ['Plan', money(budget.plannedCents)],
            ['Onaylanmış talepler', money(budget.approvedCents)],
            ['Kararı bekleyen talepler', money(budget.pendingCents)],
            ['Kalan', money(budget.remainingCents ?? 0)],
          ]}
        />
      )}
      {budget.exceedsRemaining ? (
        <p role="status" className="text-sm font-medium text-destructive">
          Bu talep bütçe kalanını aşıyor. Gönderim ve onay engellenmez; karar yöneticinindir.
        </p>
      ) : null}
    </section>
  )
}

function History({ request }: { request: PurchaseRequestDetail }) {
  const pairs: [string, string][] = [['Açıldı', timeText(request.createdAt)]]
  if (request.submittedAt)
    pairs.push([
      'Gönderildi',
      `${timeText(request.submittedAt)} · ${request.submittedByName ?? '—'}`,
    ])
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
  if (request.cancelledAt)
    pairs.push([
      'İptal edildi',
      `${timeText(request.cancelledAt)} · ${request.cancelledByName ?? '—'}`,
    ])
  if (request.cancelReason) pairs.push(['İptal gerekçesi', request.cancelReason])
  return (
    <section aria-labelledby="talep-gecmisi" className="grid gap-3">
      <h3 id="talep-gecmisi" className="text-base font-semibold">
        Geçmiş
      </h3>
      <Pairs pairs={pairs} />
    </section>
  )
}
