import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useFixedAsset,
  useFixedAssets,
  useScrapFixedAsset,
  type FixedAssetDetail,
} from '@kampus/react-shared/use-finance-fixed-assets.ts'
import {
  DEPRECIATION_METHOD_LABELS,
  FIXED_ASSET_CATEGORIES,
  FIXED_ASSET_CATEGORY_LABELS,
  FIXED_ASSET_STATUSES,
  FIXED_ASSET_STATUS_LABELS,
  type FixedAssetCategory,
  type FixedAssetStatus,
} from '@kampus/school-core/lib/finance-fixed-assets.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { FixedAssetAssignmentSection, holderText } from './FinanceFixedAssetAssignments.tsx'
import {
  FinanceFixedAssetDepreciationSection,
  FixedAssetDepreciationSchedule,
} from './FinanceFixedAssetDepreciation.tsx'
import { FixedAssetFormModal } from './FinanceFixedAssetForm.tsx'
import { FinanceFixedAssetStaffSection } from './FinanceFixedAssetStaffSection.tsx'
import {
  FIXED_ASSET_STATUS_VIEW,
  scrapFormSchema,
  type ScrapFormValues,
} from './finance-fixed-asset-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['tagNumber', 'name', 'status']
const STATUS_OPTIONS = FIXED_ASSET_STATUSES.map((value) => ({
  value,
  label: FIXED_ASSET_STATUS_LABELS[value],
}))
const CATEGORY_OPTIONS = FIXED_ASSET_CATEGORIES.map((value) => ({
  value,
  label: FIXED_ASSET_CATEGORY_LABELS[value],
}))
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is FixedAssetStatus =>
  FIXED_ASSET_STATUSES.some((status) => status === value)
const isCategory = (value: string | null): value is FixedAssetCategory =>
  FIXED_ASSET_CATEGORIES.some((category) => category === value)
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

type Row = {
  id: string
  tagNumber: string
  name: string
  category: string
  place: string
  value: string
  acquisitionDate: string
  supplier: string
  holder: string
  status: FixedAssetStatus
}

/**
 * Demirbaşlar (`?gorunum=demirbas`; DOM-FIN-085, ON-235). Yalnız yönetici (K-189): kayıt,
 * düzeltme ve ayrıntı panelinde (`?demirbas=`) zimmet ve iade (DOM-FIN-086) ile gerekçeli hurdaya
 * ayırma (K-188). Liste etiket, ad ve konumda aranır; durum, kategori ve kampüs süzgeçlidir, sunucu
 * sayfalıdır. Altında personel zimmetleri listesi (K-214) ve amortisman ön hesabı raporu
 * (DOM-FIN-088; yönetim raporu, defter kaydı yok).
 */
export function FinanceFixedAssetsSection() {
  return (
    <div className="grid gap-6">
      <FixedAssetsList />
      <FinanceFixedAssetStaffSection />
      <FinanceFixedAssetDepreciationSection />
    </div>
  )
}

function FixedAssetsList() {
  const list = useListState('demirbaslar', { urlPrefix: 'demirbas_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const category = text(list.state.filters.category)
  const campusId = text(list.state.filters.campusId)
  const branches = useCoreAll('branches')
  const assets = useFixedAssets({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(isCategory(category) ? { category } : {}),
    ...(campusId ? { campusId } : {}),
  })
  const panel = useDetailPanel('demirbas')
  const openAsset = panel.open
  const [creating, setCreating] = useState(false)

  const filters = useMemo(
    () => [
      { key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS },
      { key: 'category', label: 'Kategori', type: 'select' as const, options: CATEGORY_OPTIONS },
      {
        key: 'campusId',
        label: 'Kampüs',
        type: 'select' as const,
        options: (branches.data ?? []).map((item) => ({
          value: item.record.id,
          label: item.record.name,
        })),
      },
    ],
    [branches.data],
  )
  const rows = useMemo(
    () =>
      assets.data?.data.map((item): Row => ({
        id: item.id,
        tagNumber: item.tagNumber,
        name: item.name,
        category: FIXED_ASSET_CATEGORY_LABELS[item.category],
        place: item.campusName ? `${item.campusName} · ${item.location}` : item.location,
        value: money(item.acquisitionValueCents),
        acquisitionDate: dayText(item.acquisitionDate),
        supplier: item.supplierName ?? '—',
        holder: item.assignment ? holderText(item.assignment) : '—',
        status: item.status,
      })),
    [assets.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'tagNumber', label: 'Etiket' },
      { key: 'name', label: 'Ad' },
      { key: 'category', label: 'Kategori' },
      { key: 'place', label: 'Kampüs / konum' },
      { key: 'value', label: 'Alım değeri' },
      { key: 'acquisitionDate', label: 'Alım günü' },
      { key: 'supplier', label: 'Tedarikçi' },
      { key: 'holder', label: 'Zimmet' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={FIXED_ASSET_STATUS_VIEW[row.status].label}
            tone={FIXED_ASSET_STATUS_VIEW[row.status].tone}
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
            aria-label={`${row.tagNumber} ayrıntısını aç`}
            onClick={() => openAsset(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openAsset],
  )

  return (
    <section
      aria-labelledby="demirbaslar"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="demirbaslar" className="text-lg font-semibold">
            Demirbaşlar
          </h2>
          <p className="text-sm text-muted-foreground">
            Etiketli varlıklar; hurdaya ayrılanlar silinmez, listenin sonunda kalır.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni demirbaş
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={assets.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={MOBILE}
        caption="Demirbaşlar"
        empty="Henüz demirbaş yok."
        emptyFiltered="Bu seçimle eşleşen demirbaş yok."
        loading={assets.isPending}
        fetching={assets.isFetching && !assets.isPending}
        error={
          assets.error ? (
            <QueryError error={assets.error} onRetry={() => void assets.refetch()} />
          ) : undefined
        }
      />
      {creating ? (
        <FixedAssetFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            openAsset(id)
          }}
        />
      ) : null}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Demirbaş"
      >
        {panel.selectedId ? <FixedAssetDetailView assetId={panel.selectedId} /> : null}
      </SidePanel>
    </section>
  )
}

function FixedAssetDetailView({ assetId }: { assetId: string }) {
  const item = useFixedAsset(assetId)
  const [editing, setEditing] = useState(false)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const asset = item.data?.data
  if (!asset) return <SummaryLoading />
  const scrapped = asset.status === 'scrapped'
  return (
    <div className="grid gap-6">
      <section aria-labelledby="demirbas-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="demirbas-bilgileri" className="text-base font-semibold">
            {asset.tagNumber} · {asset.name}
          </h3>
          <StatusBadge
            text={FIXED_ASSET_STATUS_VIEW[asset.status].label}
            tone={FIXED_ASSET_STATUS_VIEW[asset.status].tone}
          />
        </div>
        <FixedAssetFacts asset={asset} />
        {scrapped ? null : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Düzenle
            </Button>
          </div>
        )}
      </section>
      <FixedAssetAssignmentSection asset={asset} />
      <FixedAssetDepreciationSchedule asset={asset} />
      {scrapped || asset.assignment ? null : <ScrapForm asset={asset} />}
      {editing ? <FixedAssetFormModal asset={asset} onClose={() => setEditing(false)} /> : null}
    </div>
  )
}

function FixedAssetFacts({ asset }: { asset: FixedAssetDetail }) {
  const receipt = asset.receipt
  const pairs: [string, string][] = [
    ['Kategori', FIXED_ASSET_CATEGORY_LABELS[asset.category]],
    ['Kampüs', asset.campusName ?? '—'],
    ['Konum', asset.location],
    ['Alım değeri (KDV hariç)', money(asset.acquisitionValueCents)],
    ['Alım günü', dayText(asset.acquisitionDate)],
    [
      'Amortisman',
      `${DEPRECIATION_METHOD_LABELS[asset.depreciationMethod]} · ${String(asset.usefulLifeYears)} yıl`,
    ],
    ['Tedarikçi', asset.supplierName ?? '—'],
    [
      'Mal kabul',
      receipt
        ? `${receipt.orderNumber} · ${receipt.itemName} · ${dayText(receipt.receiptDate)}${
            receipt.receiptCancelled ? ' (kabul iptal edildi)' : ''
          }`
        : '—',
    ],
    ...(asset.status === 'scrapped'
      ? ([
          ['Hurdaya ayırma günü', asset.scrapDate ? dayText(asset.scrapDate) : '—'],
          ['Gerekçe', asset.scrapReason ?? '—'],
        ] as [string, string][])
      : []),
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

/** Hurdaya ayırma (K-188): gerekçe ve gün; geri alınmaz, onay metni bunu söyler. */
function ScrapForm({ asset }: { asset: FixedAssetDetail }) {
  const scrap = useScrapFixedAsset()
  const form = useForm<ScrapFormValues>({
    resolver: zodResolver(scrapFormSchema),
    defaultValues: { reason: '', scrapDate: dayKey() },
  })
  const errors = form.formState.errors
  const busy = scrap.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await scrap.submit(
      { assetId: asset.id, version: asset.version, body: values },
      {
        setError: (name, error) => {
          if (name === 'reason' || name === 'scrapDate')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success(`${asset.tagNumber} hurdaya ayrıldı.`)
  })
  return (
    <section aria-labelledby="demirbas-hurda" className="grid gap-3 border-t pt-4">
      <h3 id="demirbas-hurda" className="text-base font-semibold">
        Hurdaya ayır
      </h3>
      <p className="text-sm text-muted-foreground">
        Kayıt silinmez ve geri alınamaz; demirbaş bundan sonra düzenlenemez.
      </p>
      <form
        noValidate
        aria-label="Hurdaya ayırma"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="hurda-gerekce" label="Gerekçe" error={errors.reason}>
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
          )}
        </FormField>
        <FormField id="hurda-gun" label="Hurdaya ayırma günü" error={errors.scrapDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('scrapDate')} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div>
          <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
            Hurdaya ayır
          </Button>
        </div>
      </form>
    </section>
  )
}
