import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  useCriticalStockItems,
  useStockItem,
  useStockItems,
  useStockMovements,
  useStockWarehouses,
  useUpdateStockItem,
  useUpdateStockWarehouse,
  type StockMovementRow,
  type StockWarehouseRow,
} from '@kampus/react-shared/use-finance-inventory.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  STOCK_CATEGORIES,
  STOCK_ENTRY_REASON_LABELS,
  STOCK_ISSUE_REASON_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  STOCK_MOVEMENT_TYPES,
  STOCK_UNIT_LABELS,
  stockActions,
  type StockCategory,
  type StockMovementType,
} from '@kampus/school-core/lib/finance-inventory.ts'
import { PURCHASE_REQUEST_ROLES } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { SUPPLIER_CATEGORY_LABELS } from '@kampus/school-core/lib/finance-suppliers.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
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
import { FinanceCriticalStockPanel } from './FinanceCriticalStockPanel.tsx'
import {
  CancelStockMovementModal,
  StockItemFormModal,
  StockMovementFormModal,
  StockWarehouseFormModal,
} from './FinanceInventoryForms.tsx'
import { FinanceStockCountsPanel } from './FinanceStockCountsPanel.tsx'
import { MOVEMENT_TYPE_VIEW, signedQuantity, type MovementKind } from './finance-inventory-forms.ts'

const NO_SORT: readonly string[] = []
const SUB_PARAM = 'stok'
const SUBVIEWS = [
  { value: 'items', label: 'Stok kartları', param: '' },
  { value: 'critical', label: 'Kritik stok', param: 'kritik' },
  { value: 'movements', label: 'Hareketler', param: 'hareket' },
  { value: 'warehouses', label: 'Depolar', param: 'depo' },
  { value: 'counts', label: 'Sayımlar', param: 'sayim' },
] as const
type SubView = (typeof SUBVIEWS)[number]['value']
const STATUS_OPTIONS = [
  { value: 'active', label: 'Etkin' },
  { value: 'inactive', label: 'Pasif' },
]
const CATEGORY_OPTIONS = STOCK_CATEGORIES.map((value) => ({
  value,
  label: SUPPLIER_CATEGORY_LABELS[value],
}))
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is 'active' | 'inactive' =>
  value === 'active' || value === 'inactive'
const isCategory = (value: string | null): value is StockCategory =>
  STOCK_CATEGORIES.some((category) => category === value)
const isType = (value: string | null): value is StockMovementType =>
  STOCK_MOVEMENT_TYPES.some((type) => type === value)
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const reasonText = (row: StockMovementRow) => {
  const reason =
    row.reason === null
      ? null
      : row.type === 'in'
        ? STOCK_ENTRY_REASON_LABELS[row.reason as keyof typeof STOCK_ENTRY_REASON_LABELS]
        : STOCK_ISSUE_REASON_LABELS[row.reason as keyof typeof STOCK_ISSUE_REASON_LABELS]
  const source =
    row.countId !== null
      ? 'Stok sayımı'
      : row.orderNumber !== null
        ? `Sipariş ${row.orderNumber}`
        : row.counterpartWarehouseName !== null
          ? `${row.type === 'transfer_out' ? 'Giriş' : 'Çıkış'} deposu ${row.counterpartWarehouseName}`
          : null
  return [reason, source, row.note].filter(Boolean).join(' · ') || '—'
}

type Dialog =
  | { kind: 'item' }
  | { kind: 'warehouse'; warehouse?: StockWarehouseRow }
  | { kind: 'movement'; movement: MovementKind; itemId?: string }
  | { kind: 'cancel'; movement: StockMovementRow }
  | null

/**
 * Stok (`?gorunum=stok`; DOM-FIN-077, DOM-FIN-078; ON-228, ON-229): stok kartları ve depo başına
 * miktar, hareketler, depolar. Yönetici kart ve depo açar, giriş ve transfer yazar, hareketi iptal
 * eder; ön büro okur ve çıkış yazar (K-180). Miktar hareketlerden türetilir; satın alınan ürün mal
 * kabulle girer (K-184). "Kritik stok" görünümü kritik seviyedeki ürünleri ve talep önerisini
 * gösterir (DOM-FIN-079); stok kartları listesi kritik ürün sayısını duyurur (K-204). "Sayımlar"
 * görünümü depo sayımını, okutmayı ve fark raporunu taşır (DOM-FIN-081); sayım düzeltmesi hareket
 * listesinde sayıma bağlantı verir.
 */
export function FinanceInventorySection({ role }: { role: string }) {
  const actions = stockActions(role)
  const canRequest = PURCHASE_REQUEST_ROLES.some((allowed) => allowed === role)
  const [params, setParams] = useSearchParams()
  const sub: SubView =
    SUBVIEWS.find((view) => view.param !== '' && view.param === params.get(SUB_PARAM))?.value ??
    'items'
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = () => setDialog(null)
  const openMovement = (movement: MovementKind, itemId?: string) =>
    setDialog({ kind: 'movement', movement, ...(itemId === undefined ? {} : { itemId }) })
  const showSub = (next: SubView) => {
    const nextParams = new URLSearchParams(params)
    const param = SUBVIEWS.find((view) => view.value === next)?.param ?? ''
    if (param === '') nextParams.delete(SUB_PARAM)
    else nextParams.set(SUB_PARAM, param)
    // Açık sayım ekranı yalnız "Sayımlar" görünümünde anlamlıdır.
    nextParams.delete('sayim_id')
    setParams(nextParams)
  }
  return (
    <section
      aria-labelledby="stok"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="stok" className="text-lg font-semibold">
            Stok
          </h2>
          <p className="text-sm text-muted-foreground">
            Kampüs depolarındaki ürünler; miktar giriş, çıkış, transfer ve mal kabul hareketlerinden
            hesaplanır.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.entry ? (
            <Button variant="secondary" onClick={() => openMovement('entry')}>
              <Icon name="ArrowDownRight" size={17} aria-hidden="true" />
              Stok girişi
            </Button>
          ) : null}
          {actions.issue ? (
            <Button variant="secondary" onClick={() => openMovement('issue')}>
              <Icon name="ArrowUpRight" size={17} aria-hidden="true" />
              Stok çıkışı
            </Button>
          ) : null}
          {actions.transfer ? (
            <Button variant="secondary" onClick={() => openMovement('transfer')}>
              <Icon name="ArrowUpDown" size={17} aria-hidden="true" />
              Transfer
            </Button>
          ) : null}
        </div>
      </header>
      <div className="px-6">
        <LineTabs label="Stok görünümü" value={sub} options={SUBVIEWS} onChange={showSub} />
      </div>
      {sub === 'items' ? (
        <ItemsPanel
          canManage={actions.manage}
          canIssue={actions.issue}
          onCreate={() => setDialog({ kind: 'item' })}
          onIssue={(itemId) => openMovement('issue', itemId)}
          onShowCritical={() => showSub('critical')}
        />
      ) : null}
      {sub === 'critical' ? (
        <FinanceCriticalStockPanel
          canRequest={canRequest}
          onRequestSaved={(requestId) =>
            setParams(new URLSearchParams({ gorunum: 'satin-alma', talep: requestId }))
          }
        />
      ) : null}
      {sub === 'movements' ? (
        <MovementsPanel
          onCancel={(movement) => setDialog({ kind: 'cancel', movement })}
          onOpenCount={(countId) => {
            const nextParams = new URLSearchParams(params)
            nextParams.set(SUB_PARAM, 'sayim')
            nextParams.set('sayim_id', countId)
            setParams(nextParams)
          }}
        />
      ) : null}
      {sub === 'warehouses' ? (
        <WarehousesPanel
          canManage={actions.manage}
          onEdit={(warehouse) =>
            setDialog({ kind: 'warehouse', ...(warehouse === undefined ? {} : { warehouse }) })
          }
        />
      ) : null}
      {sub === 'counts' ? <FinanceStockCountsPanel role={role} /> : null}
      {dialog?.kind === 'item' ? <StockItemFormModal onClose={close} /> : null}
      {dialog?.kind === 'warehouse' ? (
        <StockWarehouseFormModal
          {...(dialog.warehouse === undefined ? {} : { warehouse: dialog.warehouse })}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'movement' ? (
        <StockMovementFormModal
          kind={dialog.movement}
          {...(dialog.itemId === undefined ? {} : { itemId: dialog.itemId })}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <CancelStockMovementModal movement={dialog.movement} onClose={close} />
      ) : null}
    </section>
  )
}

// --- Stok kartları -------------------------------------------------------------------------------

type ItemRow = {
  id: string
  code: string
  name: string
  category: string
  quantity: string
  minQuantity: string
  status: { active: boolean; low: boolean }
}
const ITEM_FILTERS = [
  { key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS },
  { key: 'category', label: 'Kategori', type: 'select' as const, options: CATEGORY_OPTIONS },
  {
    key: 'critical',
    label: 'Kritik seviye',
    type: 'select' as const,
    options: [{ value: 'true', label: 'Yalnız kritik' }],
  },
]

function ItemsPanel({
  canManage,
  canIssue,
  onCreate,
  onIssue,
  onShowCritical,
}: {
  canManage: boolean
  canIssue: boolean
  onCreate: () => void
  onIssue: (itemId: string) => void
  onShowCritical: () => void
}) {
  // Kritik ürün duyurusu (K-204): yalnız sayı okunur.
  const critical = useCriticalStockItems({ page: 1, pageSize: 1 })
  const criticalCount = critical.data?.meta.total ?? 0
  const list = useListState('stok-kartlari', { urlPrefix: 'stok_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const category = text(list.state.filters.category)
  const items = useStockItems({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(isCategory(category) ? { category } : {}),
    ...(text(list.state.filters.critical) === 'true' ? { critical: 'true' as const } : {}),
  })
  const panel = useDetailPanel('stok_karti')
  const openItem = panel.open
  const rows = useMemo(
    () =>
      items.data?.data.map((item): ItemRow => ({
        id: item.id,
        code: item.code,
        name: item.name,
        category: SUPPLIER_CATEGORY_LABELS[item.category],
        quantity: `${String(item.quantity)} ${STOCK_UNIT_LABELS[item.unit]}`,
        minQuantity: item.minQuantity === null ? '—' : String(item.minQuantity),
        status: { active: item.isActive, low: item.isBelowMinimum },
      })),
    [items.data],
  )
  const columns = useMemo<DataColumn<ItemRow>[]>(
    () => [
      { key: 'code', label: 'Kod' },
      { key: 'name', label: 'Ürün' },
      { key: 'category', label: 'Kategori' },
      { key: 'quantity', label: 'Miktar' },
      { key: 'minQuantity', label: 'Kritik seviye' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) =>
          !row.status.active ? (
            <StatusBadge text="Pasif" tone="gray" />
          ) : row.status.low ? (
            <StatusBadge text="Kritik" tone="amber" />
          ) : (
            <StatusBadge text="Etkin" tone="green" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} ayrıntısını aç`}
            onClick={() => openItem(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openItem],
  )
  return (
    <div className="grid gap-3 pt-3">
      {criticalCount > 0 ? (
        <div
          role="status"
          className="mx-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning px-4 py-3 text-sm"
        >
          <span>{`${String(criticalCount)} ürün kritik seviyede ya da altında.`}</span>
          <Button size="sm" variant="secondary" onClick={onShowCritical}>
            Kritik stoku göster
          </Button>
        </div>
      ) : null}
      {canManage ? (
        <div className="flex justify-end px-6">
          <Button onClick={onCreate}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni stok kartı
          </Button>
        </div>
      ) : null}
      <ServerDataTable
        list={list}
        rows={rows}
        total={items.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={ITEM_FILTERS}
        mobileColumns={['name', 'quantity']}
        caption="Stok kartları"
        empty="Henüz stok kartı yok."
        emptyFiltered="Bu seçimle eşleşen stok kartı yok."
        loading={items.isPending}
        fetching={items.isFetching && !items.isPending}
        error={
          items.error ? (
            <QueryError error={items.error} onRetry={() => void items.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Stok kartı"
      >
        {panel.selectedId ? (
          <ItemDetail
            itemId={panel.selectedId}
            canManage={canManage}
            canIssue={canIssue}
            onIssue={onIssue}
          />
        ) : null}
      </SidePanel>
    </div>
  )
}

function ItemDetail({
  itemId,
  canManage,
  canIssue,
  onIssue,
}: {
  itemId: string
  canManage: boolean
  canIssue: boolean
  onIssue: (itemId: string) => void
}) {
  const query = useStockItem(itemId)
  const update = useUpdateStockItem()
  const [editing, setEditing] = useState(false)
  if (query.error) return <QueryError error={query.error} onRetry={() => void query.refetch()} />
  const item = query.data?.data
  if (!item) return <SummaryLoading />
  const unit = STOCK_UNIT_LABELS[item.unit]
  const toggle = async () => {
    const outcome = await update.submit({
      itemId: item.id,
      version: item.version,
      body: { isActive: !item.isActive },
    })
    if (outcome.status === 'success')
      notify.success(
        item.isActive ? `${item.name} pasifleştirildi.` : `${item.name} etkinleştirildi.`,
      )
  }
  return (
    <div className="grid gap-5">
      <section aria-labelledby="stok-karti-bilgi" className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="stok-karti-bilgi" className="text-base font-semibold">
            {`${item.code} · ${item.name}`}
          </h3>
          {!item.isActive ? (
            <StatusBadge text="Pasif" tone="gray" />
          ) : item.isBelowMinimum ? (
            <StatusBadge text="Kritik" tone="amber" />
          ) : null}
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground">Toplam miktar: </span>
          <span className="font-semibold tabular-nums">{`${String(item.quantity)} ${unit}`}</span>
          {item.minQuantity === null ? '' : ` · kritik seviye ${String(item.minQuantity)}`}
        </p>
        <p className="text-sm text-muted-foreground">{SUPPLIER_CATEGORY_LABELS[item.category]}</p>
        <div className="flex flex-wrap gap-2">
          {canIssue && item.isActive ? (
            <Button type="button" variant="secondary" onClick={() => onIssue(item.id)}>
              Çıkış yaz
            </Button>
          ) : null}
          {canManage ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                Düzenle
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={update.isPending}
                aria-busy={update.isPending || undefined}
                onClick={() => void toggle()}
              >
                {item.isActive ? 'Pasifleştir' : 'Etkinleştir'}
              </Button>
            </>
          ) : null}
        </div>
      </section>
      <section aria-labelledby="stok-karti-depolar" className="grid gap-2">
        <h3 id="stok-karti-depolar" className="text-base font-semibold">
          Depolardaki miktar
        </h3>
        {item.balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz depo yok.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Depolardaki miktar">
            {item.balances.map((balance) => (
              <li
                key={balance.warehouseId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{balance.warehouseName}</span>
                  <span className="block text-muted-foreground">
                    {balance.campusName ?? 'Kampüs arşivlenmiş'}
                    {balance.isActive ? '' : ' · pasif depo'}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{`${String(balance.quantity)} ${unit}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing ? <StockItemFormModal item={item} onClose={() => setEditing(false)} /> : null}
    </div>
  )
}

// --- Hareketler ----------------------------------------------------------------------------------

type MovementTableRow = {
  id: string
  date: string
  type: StockMovementType
  item: string
  warehouse: string
  quantity: string
  detail: string
  createdBy: string
  movement: StockMovementRow
}
const TYPE_OPTIONS = STOCK_MOVEMENT_TYPES.map((value) => ({
  value,
  label: STOCK_MOVEMENT_TYPE_LABELS[value],
}))

function MovementsPanel({
  onCancel,
  onOpenCount,
}: {
  onCancel: (movement: StockMovementRow) => void
  onOpenCount: (countId: string) => void
}) {
  const list = useListState('stok-hareketleri', { urlPrefix: 'hareket_' })
  const warehouses = useStockWarehouses({ page: 1, pageSize: 100 })
  const type = text(list.state.filters.type)
  const warehouseId = text(list.state.filters.warehouse)
  const movements = useStockMovements({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(isType(type) ? { type } : {}),
    ...(warehouseId === null ? {} : { warehouseId }),
  })
  const filters = useMemo(
    () => [
      { key: 'type', label: 'Tür', type: 'select' as const, options: TYPE_OPTIONS },
      {
        key: 'warehouse',
        label: 'Depo',
        type: 'select' as const,
        options: (warehouses.data?.data ?? []).map((warehouse) => ({
          value: warehouse.id,
          label: warehouse.name,
        })),
      },
    ],
    [warehouses.data],
  )
  const rows = useMemo(
    () =>
      movements.data?.data.map((movement): MovementTableRow => ({
        id: movement.id,
        date: dayText(movement.movementDate),
        type: movement.type,
        item: `${movement.itemCode} · ${movement.itemName}`,
        warehouse: movement.campusName
          ? `${movement.warehouseName} · ${movement.campusName}`
          : movement.warehouseName,
        quantity: signedQuantity(
          movement.type,
          movement.quantity,
          STOCK_UNIT_LABELS[movement.unit],
        ),
        detail: reasonText(movement),
        createdBy: movement.createdByName ?? '—',
        movement,
      })),
    [movements.data],
  )
  const columns = useMemo<DataColumn<MovementTableRow>[]>(
    () => [
      { key: 'date', label: 'Gün' },
      {
        key: 'type',
        label: 'Tür',
        cell: (row) => (
          <span className="flex flex-wrap gap-1">
            <StatusBadge
              text={MOVEMENT_TYPE_VIEW[row.type].label}
              tone={MOVEMENT_TYPE_VIEW[row.type].tone}
            />
            {row.movement.cancelledAt ? <StatusBadge text="İptal edildi" tone="red" /> : null}
          </span>
        ),
      },
      { key: 'item', label: 'Ürün' },
      { key: 'warehouse', label: 'Depo' },
      { key: 'quantity', label: 'Miktar' },
      {
        key: 'detail',
        label: 'Neden ve açıklama',
        cell: (row) =>
          row.movement.cancelledAt
            ? `${row.detail} · iptal: ${row.movement.cancelReason ?? ''}`
            : row.detail,
      },
      { key: 'createdBy', label: 'Kaydeden' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => {
          const { countId } = row.movement
          if (countId !== null)
            return (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${row.date} ${row.item} düzeltmesinin sayımını aç`}
                onClick={() => onOpenCount(countId)}
              >
                Sayımı aç
              </Button>
            )
          return row.movement.actions.cancel ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${row.date} ${row.item} hareketini iptal et`}
              onClick={() => onCancel(row.movement)}
            >
              İptal et
            </Button>
          ) : null
        },
      },
    ],
    [onCancel, onOpenCount],
  )
  return (
    <div className="pt-3">
      <ServerDataTable
        list={list}
        rows={rows}
        total={movements.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={['item', 'quantity']}
        caption="Stok hareketleri"
        empty="Henüz stok hareketi yok."
        emptyFiltered="Bu seçimle eşleşen hareket yok."
        loading={movements.isPending}
        fetching={movements.isFetching && !movements.isPending}
        error={
          movements.error ? (
            <QueryError error={movements.error} onRetry={() => void movements.refetch()} />
          ) : undefined
        }
      />
    </div>
  )
}

// --- Depolar -------------------------------------------------------------------------------------

type WarehouseTableRow = {
  id: string
  name: string
  campus: string
  itemCount: string
  status: boolean
  warehouse: StockWarehouseRow
}

function WarehousesPanel({
  canManage,
  onEdit,
}: {
  canManage: boolean
  onEdit: (warehouse?: StockWarehouseRow) => void
}) {
  const list = useListState('stok-depolari', { urlPrefix: 'depo_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const warehouses = useStockWarehouses({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
  })
  const update = useUpdateStockWarehouse()
  const toggle = async (warehouse: StockWarehouseRow) => {
    const outcome = await update.submit({
      warehouseId: warehouse.id,
      version: warehouse.version,
      body: { isActive: !warehouse.isActive },
    })
    if (outcome.status === 'success')
      notify.success(
        warehouse.isActive
          ? `${warehouse.name} pasifleştirildi.`
          : `${warehouse.name} etkinleştirildi.`,
      )
  }
  const rows = useMemo(
    () =>
      warehouses.data?.data.map((warehouse): WarehouseTableRow => ({
        id: warehouse.id,
        name: warehouse.name,
        campus: warehouse.campusName ?? 'Kampüs arşivlenmiş',
        itemCount: `${String(warehouse.itemCount)} ürün`,
        status: warehouse.isActive,
        warehouse,
      })),
    [warehouses.data],
  )
  // Düğme durumu `update.isPending` ile her çizimde tazelenir; sütunlar ezberlenmez.
  const columns: DataColumn<WarehouseTableRow>[] = [
    { key: 'name', label: 'Depo' },
    { key: 'campus', label: 'Kampüs' },
    { key: 'itemCount', label: 'Stoklu ürün' },
    {
      key: 'status',
      label: 'Durum',
      cell: (row) =>
        row.status ? (
          <StatusBadge text="Etkin" tone="green" />
        ) : (
          <StatusBadge text="Pasif" tone="gray" />
        ),
    },
    ...(canManage
      ? [
          {
            key: ACTIONS_KEY,
            label: 'İşlemler',
            cell: (row: WarehouseTableRow) => (
              <span className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${row.name} deposunu düzenle`}
                  onClick={() => onEdit(row.warehouse)}
                >
                  Düzenle
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={update.isPending}
                  aria-label={`${row.name} deposunu ${row.status ? 'pasifleştir' : 'etkinleştir'}`}
                  onClick={() => void toggle(row.warehouse)}
                >
                  {row.status ? 'Pasifleştir' : 'Etkinleştir'}
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ]
  return (
    <div className="grid gap-3 pt-3">
      {canManage ? (
        <div className="flex justify-end px-6">
          <Button onClick={() => onEdit()}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni depo
          </Button>
        </div>
      ) : null}
      <ServerDataTable
        list={list}
        rows={rows}
        total={warehouses.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={[
          { key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS },
        ]}
        mobileColumns={['name', 'campus']}
        caption="Depolar"
        empty="Henüz depo yok."
        emptyFiltered="Bu seçimle eşleşen depo yok."
        loading={warehouses.isPending}
        fetching={warehouses.isFetching && !warehouses.isPending}
        error={
          warehouses.error ? (
            <QueryError error={warehouses.error} onRetry={() => void warehouses.refetch()} />
          ) : undefined
        }
      />
    </div>
  )
}
