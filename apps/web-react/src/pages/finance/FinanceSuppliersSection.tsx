import { useMemo, useState } from 'react'
import {
  useSupplier,
  useSuppliers,
  useUpdateSupplier,
  type SupplierDetail,
} from '@kampus/react-shared/use-finance-procurement.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  SUPPLIER_CATEGORIES,
  SUPPLIER_CATEGORY_LABELS,
  SUPPLIER_TYPE_LABELS,
  SUPPLIER_TYPES,
  type SupplierCategory,
  type SupplierType,
} from '@kampus/school-core/lib/finance-suppliers.ts'
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
import { SupplierFormModal } from './FinanceSupplierForm.tsx'
import { DOCUMENT_STATUS_VIEW } from './finance-procurement-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'status']
const STATUS_OPTIONS = [
  { value: 'active', label: 'Etkin' },
  { value: 'inactive', label: 'Pasif' },
]
const TYPE_OPTIONS = SUPPLIER_TYPES.map((value) => ({
  value,
  label: SUPPLIER_TYPE_LABELS[value],
}))
const CATEGORY_OPTIONS = SUPPLIER_CATEGORIES.map((value) => ({
  value,
  label: SUPPLIER_CATEGORY_LABELS[value],
}))
const FILTERS = [
  { key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS },
  { key: 'type', label: 'Tür', type: 'select' as const, options: TYPE_OPTIONS },
  { key: 'category', label: 'Kategori', type: 'select' as const, options: CATEGORY_OPTIONS },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is 'active' | 'inactive' =>
  value === 'active' || value === 'inactive'
const isType = (value: string | null): value is SupplierType =>
  SUPPLIER_TYPES.some((type) => type === value)
const isCategory = (value: string | null): value is SupplierCategory =>
  SUPPLIER_CATEGORIES.some((category) => category === value)
const categoryText = (categories: readonly SupplierCategory[]) =>
  categories.map((category) => SUPPLIER_CATEGORY_LABELS[category]).join(', ')
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

type Row = {
  id: string
  name: string
  type: string
  taxNumber: string
  categories: string
  contact: string
  documents: { expired: number; expiring: number; total: number }
  status: boolean
}

/**
 * Tedarikçiler (`?gorunum=tedarikci`; DOM-FIN-070, ON-221). Yönetici ekler, düzeltir ve
 * pasifleştirir; ön büro listeyi salt okur (K-126). Listede şahıs TCKN'si ve IBAN maskelidir; tam
 * değerler yöneticinin ayrıntı panelindedir (`?tedarikci=`). Belgeler dosyasız listedir (K-127).
 */
export function FinanceSuppliersSection({ canManage }: { canManage: boolean }) {
  const list = useListState('tedarikciler', { urlPrefix: 'tedarikci_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const type = text(list.state.filters.type)
  const category = text(list.state.filters.category)
  const suppliers = useSuppliers({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(isType(type) ? { type } : {}),
    ...(isCategory(category) ? { category } : {}),
  })
  const panel = useDetailPanel('tedarikci')
  const openSupplier = panel.open
  const [creating, setCreating] = useState(false)

  const rows = useMemo(
    () =>
      suppliers.data?.data.map((item): Row => ({
        id: item.id,
        name: item.name,
        type: SUPPLIER_TYPE_LABELS[item.type],
        taxNumber: `${item.taxOffice} / ${item.taxNumber}`,
        categories: categoryText(item.categories),
        contact: [item.contactName, item.contactPhone].filter(Boolean).join(' · ') || '—',
        documents: {
          expired: item.expiredDocumentCount,
          expiring: item.expiringDocumentCount,
          total: item.documentCount,
        },
        status: item.isActive,
      })),
    [suppliers.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'name', label: 'Tedarikçi' },
      { key: 'type', label: 'Tür' },
      { key: 'taxNumber', label: 'Vergi dairesi / numarası' },
      { key: 'categories', label: 'Kategori' },
      { key: 'contact', label: 'İletişim' },
      {
        key: 'documents',
        label: 'Belgeler',
        cell: (row) =>
          row.documents.expired > 0 ? (
            <StatusBadge
              text={`${String(row.documents.expired)} belgenin süresi geçti`}
              tone="red"
            />
          ) : row.documents.expiring > 0 ? (
            <StatusBadge
              text={`${String(row.documents.expiring)} belgenin süresi yaklaşıyor`}
              tone="amber"
            />
          ) : (
            `${String(row.documents.total)} belge`
          ),
      },
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
              cell: (row: Row) => (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${row.name} ayrıntısını aç`}
                  onClick={() => openSupplier(row.id)}
                >
                  Ayrıntı
                </Button>
              ),
            },
          ]
        : []),
    ],
    [canManage, openSupplier],
  )

  return (
    <section
      aria-labelledby="tedarikciler"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="tedarikciler" className="text-lg font-semibold">
            Tedarikçiler
          </h2>
          <p className="text-sm text-muted-foreground">
            Satın alma taleplerinde önerilen tedarikçiler; şahıs tedarikçinin kimlik numarası
            listede maskelidir.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setCreating(true)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni tedarikçi
          </Button>
        ) : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={suppliers.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Tedarikçiler"
        empty="Henüz tedarikçi yok."
        emptyFiltered="Bu seçimle eşleşen tedarikçi yok."
        loading={suppliers.isPending}
        fetching={suppliers.isFetching && !suppliers.isPending}
        error={
          suppliers.error ? (
            <QueryError error={suppliers.error} onRetry={() => void suppliers.refetch()} />
          ) : undefined
        }
      />
      {creating ? (
        <SupplierFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            openSupplier(id)
          }}
        />
      ) : null}
      {canManage ? (
        <SidePanel
          open={panel.selectedId !== ''}
          onOpenChange={(open) => (open ? undefined : panel.close())}
          title="Tedarikçi"
        >
          {panel.selectedId ? <SupplierDetailView supplierId={panel.selectedId} /> : null}
        </SidePanel>
      ) : null}
    </section>
  )
}

function SupplierDetailView({ supplierId }: { supplierId: string }) {
  const item = useSupplier(supplierId)
  const update = useUpdateSupplier()
  const [editing, setEditing] = useState(false)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const supplier = item.data?.data
  if (!supplier) return <SummaryLoading />
  const toggle = async () => {
    const outcome = await update.submit({
      supplierId: supplier.id,
      version: supplier.version,
      body: { isActive: !supplier.isActive },
    })
    if (outcome.status === 'success')
      notify.success(
        supplier.isActive
          ? `${supplier.name} pasifleştirildi.`
          : `${supplier.name} etkinleştirildi.`,
      )
  }
  return (
    <div className="grid gap-6">
      <section aria-labelledby="tedarikci-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="tedarikci-bilgileri" className="text-base font-semibold">
            {supplier.name}
          </h3>
          {supplier.isActive ? null : <StatusBadge text="Pasif" tone="gray" />}
        </div>
        <SupplierFacts supplier={supplier} />
        <div className="flex flex-wrap gap-2">
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
            {supplier.isActive ? 'Pasifleştir' : 'Etkinleştir'}
          </Button>
        </div>
      </section>
      <section aria-labelledby="tedarikci-belgeleri" className="grid gap-3">
        <h3 id="tedarikci-belgeleri" className="text-base font-semibold">
          Belgeler
        </h3>
        {supplier.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belge eklenmedi.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Tedarikçi belgeleri">
            {supplier.documents.map((document, index) => (
              <li
                key={`${document.name}-${String(index)}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{document.name}</span>
                  <span className="block text-muted-foreground">
                    {document.expiryDate
                      ? `Son geçerlilik ${dayText(document.expiryDate)}`
                      : 'Süresiz'}
                    {document.note ? ` · ${document.note}` : ''}
                  </span>
                </span>
                <StatusBadge
                  text={DOCUMENT_STATUS_VIEW[document.status].label}
                  tone={DOCUMENT_STATUS_VIEW[document.status].tone}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing ? <SupplierFormModal supplier={supplier} onClose={() => setEditing(false)} /> : null}
    </div>
  )
}

function SupplierFacts({ supplier }: { supplier: SupplierDetail }) {
  const pairs: [string, string][] = [
    ['Tür', SUPPLIER_TYPE_LABELS[supplier.type]],
    [
      supplier.type === 'company' ? 'Vergi dairesi / VKN' : 'Vergi dairesi / TCKN',
      `${supplier.taxOffice} / ${supplier.taxNumber}`,
    ],
    ['Kategori', categoryText(supplier.categories)],
    ['Yetkili', supplier.contactName ?? '—'],
    ['Telefon', supplier.contactPhone ?? '—'],
    ['E-posta', supplier.contactEmail ?? '—'],
    ['Adres', supplier.address ?? '—'],
    ['IBAN', supplier.iban ?? '—'],
  ]
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
