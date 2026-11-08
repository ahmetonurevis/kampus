import { useMemo, useState } from 'react'
import {
  useCriticalStockItems,
  type CriticalStockRow,
} from '@kampus/react-shared/use-finance-inventory.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { STOCK_CATEGORIES, STOCK_UNIT_LABELS } from '@kampus/school-core/lib/finance-inventory.ts'
import { PURCHASE_ITEMS_MAX } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { stockPurchaseDraft } from '@kampus/school-core/lib/finance-stock-alerts.ts'
import { SUPPLIER_CATEGORY_LABELS } from '@kampus/school-core/lib/finance-suppliers.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { notify } from '@/lib/notify.ts'
import { PurchaseRequestFormModal } from './FinancePurchaseRequestForms.tsx'
import {
  criticalQuantityText,
  suggestionLine,
  warehouseBreakdown,
} from './finance-inventory-forms.ts'
import { requestDefaultsFromDraft, type RequestFormValues } from './finance-procurement-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['select', 'item', 'quantity', 'suggested']
const CATEGORY_OPTIONS = STOCK_CATEGORIES.map((value) => ({
  value,
  label: SUPPLIER_CATEGORY_LABELS[value],
}))
const FILTERS = [
  { key: 'category', label: 'Kategori', type: 'select' as const, options: CATEGORY_OPTIONS },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isCategory = (value: string | null): value is (typeof STOCK_CATEGORIES)[number] =>
  STOCK_CATEGORIES.some((category) => category === value)

type Row = {
  id: string
  select: string
  item: string
  quantity: string
  warehouses: string
  suggested: string
  lastPrice: string
  row: CriticalStockRow
}

/**
 * Kritik stok (`?gorunum=stok&stok=kritik`; DOM-FIN-079, ON-230): kurum toplamı kritik seviyede ya
 * da altındaki etkin kartlar, aciliyet sırasında (K-200); depo kırılımı, öneri miktarı (K-201) ve son
 * alış fiyatı (K-202). Seçilen kalemlerden "Talep öner" taslak satın alma talebi formunu doldurur;
 * talep bugünkü talep kurallarıyla açılır (K-203). Seçim sayfalar arasında korunur, en çok 50 kalem.
 */
export function FinanceCriticalStockPanel({
  canRequest,
  onRequestSaved,
}: {
  canRequest: boolean
  onRequestSaved: (requestId: string) => void
}) {
  const list = useListState('kritik-stok', { urlPrefix: 'kritik_' })
  const search = useDebouncedValue(list.state.query).trim()
  const category = text(list.state.filters.category)
  const critical = useCriticalStockItems({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isCategory(category) ? { category } : {}),
  })
  // Seçim kullanıcı girdisidir: sayfa değişse de satır verisiyle birlikte tutulur.
  const [selected, setSelected] = useState<ReadonlyMap<string, CriticalStockRow>>(() => new Map())
  const [draft, setDraft] = useState<RequestFormValues | null>(null)
  const full = selected.size >= PURCHASE_ITEMS_MAX
  const toggle = (row: CriticalStockRow, checked: boolean) =>
    setSelected((current) => {
      const next = new Map(current)
      if (checked) next.set(row.id, row)
      else next.delete(row.id)
      return next
    })
  const suggest = () => {
    try {
      setDraft(
        requestDefaultsFromDraft(stockPurchaseDraft([...selected.values()].map(suggestionLine))),
      )
    } catch (error) {
      if (error instanceof DomainError) notify.error(error.message)
      else throw error
    }
  }
  const rows = useMemo(
    () =>
      critical.data?.data.map((item): Row => ({
        id: item.id,
        select: item.id,
        item: `${item.code} · ${item.name}`,
        quantity: criticalQuantityText(item),
        warehouses: warehouseBreakdown(item),
        suggested: `${String(item.suggestedQuantity)} ${STOCK_UNIT_LABELS[item.unit]}`,
        lastPrice: item.lastUnitPriceCents === null ? '—' : money(item.lastUnitPriceCents),
        row: item,
      })),
    [critical.data],
  )
  // Onay kutusunun durumu seçimle her çizimde tazelenir; sütunlar ezberlenmez.
  const columns: DataColumn<Row>[] = [
    ...(canRequest
      ? [
          {
            key: 'select',
            label: 'Seç',
            cell: (row: Row) => (
              <Checkbox
                aria-label={`${row.item} talebe ekle`}
                checked={selected.has(row.id)}
                disabled={full && !selected.has(row.id)}
                onCheckedChange={(next) => toggle(row.row, next === true)}
              />
            ),
          },
        ]
      : []),
    { key: 'item', label: 'Ürün' },
    {
      key: 'quantity',
      label: 'Toplam / kritik seviye',
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums">{row.quantity}</span>
          {row.row.quantity <= 0 ? <StatusBadge text="Tükendi" tone="red" /> : null}
        </span>
      ),
    },
    { key: 'warehouses', label: 'Depolar' },
    { key: 'suggested', label: 'Öneri' },
    { key: 'lastPrice', label: 'Son alış (KDV hariç)' },
  ]
  return (
    <div className="grid gap-3 pt-3">
      <div className="grid gap-2 px-6">
        <p className="text-sm text-muted-foreground">
          Toplam miktarı kritik seviyeye inen ürünler, en acil olan önce. Öneri stoku kritik
          seviyenin iki katına tamamlar; son alış fiyatı en son mal kabulün sipariş fiyatıdır.
        </p>
        {canRequest ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={selected.size === 0} onClick={suggest}>
              <Icon name="ClipboardCheck" size={16} aria-hidden="true" />
              {`Talep öner (${String(selected.size)})`}
            </Button>
            {selected.size > 0 ? (
              <Button variant="ghost" onClick={() => setSelected(new Map())}>
                Seçimi temizle
              </Button>
            ) : null}
            {full ? (
              <p role="status" className="text-sm text-muted-foreground">
                {`Bir talebe en çok ${String(PURCHASE_ITEMS_MAX)} ürün eklenebilir.`}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={critical.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={canRequest ? MOBILE : MOBILE.slice(1)}
        caption="Kritik stok"
        empty="Kritik seviyede ürün yok."
        emptyFiltered="Bu seçimle eşleşen kritik ürün yok."
        loading={critical.isPending}
        fetching={critical.isFetching && !critical.isPending}
        error={
          critical.error ? (
            <QueryError error={critical.error} onRetry={() => void critical.refetch()} />
          ) : undefined
        }
      />
      {draft ? (
        <PurchaseRequestFormModal
          initial={draft}
          onClose={() => setDraft(null)}
          onSaved={(id) => {
            setDraft(null)
            setSelected(new Map())
            onRequestSaved(id)
          }}
        />
      ) : null}
    </div>
  )
}
