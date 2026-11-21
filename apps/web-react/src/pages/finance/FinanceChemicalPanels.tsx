import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useChemicalInventory,
  useChemicalInventoryExport,
  useChemicalLots,
  useCreateChemicalProfile,
  useUpdateChemicalProfile,
  type ChemicalInventoryRow,
  type ChemicalLotRow,
} from '@kampus/react-shared/use-finance-chemicals.ts'
import {
  useStockWarehouses,
  type StockItemDetail,
} from '@kampus/react-shared/use-finance-inventory.ts'
import { CHEMICAL_EXPIRY_STATUS_LABELS } from '@kampus/school-core/lib/finance-chemicals.ts'
import { STOCK_UNIT_LABELS } from '@kampus/school-core/lib/finance-inventory.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useChemicalInventoryPdf } from '@/hooks/use-finance-chemical-inventory-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { CHEMICAL_INVENTORY_TITLE } from '@/lib/pdf/templates/finance-chemical-inventory.ts'
import { RootError } from '../management/FormParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import {
  chemicalProfileBody,
  chemicalProfileDefaults,
  chemicalProfileFormField,
  chemicalProfileFormSchema,
  EXPIRY_TONE,
  expiryText,
  lotText,
  pictogramNames,
  PICTOGRAM_OPTIONS,
  SIGNAL_WORD_OPTIONS,
  signalWordText,
  type ChemicalProfileFormValues,
} from './finance-chemical-forms.ts'

// Laboratuvar kimyasal envanteri (DOM-FIN-090; ON-234; K-240…K-243): kart ayrıntısındaki kimyasal
// bilgisi ve partiler, "Son kullanma" uyarı listesi, "Kimyasal envanter" raporu (CSV ve PDF).

const NO_SORT: readonly string[] = []
const BOM = '\uFEFF'
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

function ExpiryBadge({ row }: { row: Pick<ChemicalLotRow, 'status'> }) {
  return (
    <StatusBadge text={CHEMICAL_EXPIRY_STATUS_LABELS[row.status]} tone={EXPIRY_TONE[row.status]} />
  )
}

// --- Kimyasal bilgisi formu ----------------------------------------------------------------------

const PROFILE_FORM = 'kimyasal-bilgi-formu'

/** Kimyasal bilgisi ekleme ve düzeltme (yalnız yönetici, K-240). */
export function ChemicalProfileFormModal({
  item,
  onClose,
}: {
  item: StockItemDetail
  onClose: () => void
}) {
  const create = useCreateChemicalProfile()
  const update = useUpdateChemicalProfile()
  const profile = item.chemical
  const form = useForm<ChemicalProfileFormValues>({
    resolver: zodResolver(chemicalProfileFormSchema),
    defaultValues: chemicalProfileDefaults(profile),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = chemicalProfileFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const body = chemicalProfileBody(values)
    const outcome = profile
      ? await update.submit({ itemId: item.id, version: profile.version, body }, fields)
      : await create.submit({ itemId: item.id, body }, fields)
    if (outcome.status === 'success') {
      notify.success(
        profile ? 'Kimyasal bilgisi güncellendi.' : `${item.name} kimyasal olarak işaretlendi.`,
      )
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  const title = profile ? 'Kimyasal bilgisini düzenle' : 'Kimyasal olarak işaretle'
  const input = (
    id: string,
    label: string,
    name: 'casNumber' | 'storageClass' | 'sdsUrl' | 'sdsDocumentNumber',
    description?: string,
  ) => (
    <FormField id={id} label={label} error={errors[name]} description={description}>
      {(control) => <Input {...control} {...form.register(name)} disabled={busy} />}
    </FormField>
  )
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description={`${item.code} · ${item.name}. Kimyasal kartın girişi parti numarası ve son kullanma tarihi ister.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={PROFILE_FORM} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={PROFILE_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <fieldset
          className="col-span-full grid gap-2"
          aria-describedby={errors.hazardPictograms ? 'kimyasal-piktogram-hata' : undefined}
        >
          <legend className="mb-2 text-sm font-medium">GHS tehlike piktogramları</legend>
          <div className="grid grid-cols-2 gap-x-5 gap-y-2 max-[650px]:grid-cols-1">
            {PICTOGRAM_OPTIONS.map((option) => (
              <label key={option.value} className="inline-flex min-h-6 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  value={option.value}
                  className="size-4 accent-primary"
                  disabled={busy}
                  {...form.register('hazardPictograms')}
                />
                {option.label}
              </label>
            ))}
          </div>
          {errors.hazardPictograms?.message ? (
            <p id="kimyasal-piktogram-hata" role="alert" className="text-sm text-destructive">
              {errors.hazardPictograms.message}
            </p>
          ) : null}
        </fieldset>
        <FormField id="kimyasal-sinyal" label="Sinyal kelimesi" error={errors.signalWord}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('signalWord')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Yok</NativeSelectOption>
              {SIGNAL_WORD_OPTIONS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {input(
          'kimyasal-cas',
          'CAS numarası (isteğe bağlı)',
          'casNumber',
          'Ör. 7647-01-0; karışımda boş bırakın.',
        )}
        {input('kimyasal-depolama', 'Depolama sınıfı (isteğe bağlı)', 'storageClass')}
        <div className="col-span-full">
          <FormField
            id="kimyasal-uyumsuzluk"
            label="Uyumsuzluk notu (isteğe bağlı)"
            error={errors.incompatibilityNote}
          >
            {(control) => (
              <Textarea
                {...control}
                {...form.register('incompatibilityNote')}
                rows={2}
                disabled={busy}
              />
            )}
          </FormField>
        </div>
        <div className="col-span-full">
          {input(
            'kimyasal-gbf-baglanti',
            'Güvenlik bilgi formu bağlantısı (isteğe bağlı)',
            'sdsUrl',
            'https:// ile başlayan adres; dosya yüklenmez.',
          )}
        </div>
        {input('kimyasal-gbf-no', 'GBF belge numarası (isteğe bağlı)', 'sdsDocumentNumber')}
        <FormField
          id="kimyasal-gbf-gun"
          label="GBF revizyon günü (isteğe bağlı)"
          error={errors.sdsRevisionDate}
        >
          {(control) => (
            <Input {...control} type="date" {...form.register('sdsRevisionDate')} disabled={busy} />
          )}
        </FormField>
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

// --- Kart ayrıntısı ------------------------------------------------------------------------------

const ITEM_LOTS = { page: 1, pageSize: 100 } as const

/** Kart ayrıntısındaki kimyasal bilgisi ve stoktaki partiler (K-240, K-242). */
export function ChemicalItemSection({
  item,
  canManage,
}: {
  item: StockItemDetail
  canManage: boolean
}) {
  const [editing, setEditing] = useState(false)
  const profile = item.chemical
  const lots = useChemicalLots({ ...ITEM_LOTS, itemId: item.id }, profile !== null)
  if (profile === null)
    return canManage ? (
      <section aria-labelledby="stok-karti-kimyasal" className="grid gap-2">
        <h3 id="stok-karti-kimyasal" className="text-base font-semibold">
          Kimyasal bilgisi
        </h3>
        <p className="text-sm text-muted-foreground">
          Laboratuvar kimyasalıysa tehlike piktogramlarını ve güvenlik bilgi formunu ekleyin;
          girişte parti ve son kullanma tarihi istenir.
        </p>
        <div>
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Kimyasal olarak işaretle
          </Button>
        </div>
        {editing ? (
          <ChemicalProfileFormModal item={item} onClose={() => setEditing(false)} />
        ) : null}
      </section>
    ) : null
  const facts: [string, string][] = [
    ['Piktogramlar', pictogramNames(profile.hazardPictograms)],
    ['Sinyal kelimesi', signalWordText(profile.signalWord)],
    ['CAS numarası', profile.casNumber ?? '—'],
    ['Depolama sınıfı', profile.storageClass ?? '—'],
    ['Uyumsuzluk', profile.incompatibilityNote ?? '—'],
    [
      'GBF',
      [
        profile.sdsDocumentNumber,
        profile.sdsRevisionDate ? `revizyon ${dayText(profile.sdsRevisionDate)}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || (profile.sdsUrl ? '' : 'Yok'),
    ],
  ]
  const unit = STOCK_UNIT_LABELS[item.unit]
  return (
    <section aria-labelledby="stok-karti-kimyasal" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="stok-karti-kimyasal" className="text-base font-semibold">
          Kimyasal bilgisi
        </h3>
        {canManage ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Kimyasal bilgisini düzenle
          </Button>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>
              {label === 'GBF' && profile.sdsUrl ? (
                <>
                  <a
                    href={profile.sdsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary underline underline-offset-2"
                  >
                    Güvenlik bilgi formunu aç
                  </a>
                  {value ? ` · ${value}` : ''}
                </>
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>
      <h4 className="text-sm font-semibold">Stoktaki partiler</h4>
      {lots.error ? (
        <QueryError error={lots.error} onRetry={() => void lots.refetch()} />
      ) : lots.data === undefined ? (
        <p className="text-sm text-muted-foreground">Partiler yükleniyor…</p>
      ) : lots.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Stokta parti yok.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Stoktaki partiler">
          {lots.data.data.map((lot) => (
            <li
              key={lot.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium">{lotText(lot)}</span>
                <span className="block text-muted-foreground">
                  {`${lot.warehouseName} · ${expiryText(lot)}`}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {lot.status === 'ok' ? null : <ExpiryBadge row={lot} />}
                <span className="font-medium tabular-nums">{`${String(lot.quantity)} ${unit}`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing ? <ChemicalProfileFormModal item={item} onClose={() => setEditing(false)} /> : null}
    </section>
  )
}

// --- Son kullanma uyarısı ------------------------------------------------------------------------

const ATTENTION_COUNT = { page: 1, pageSize: 1, status: 'attention' } as const

/** Stok kartları listesindeki duyuru (K-243): süresi geçen ya da 30 gün içinde dolan parti sayısı. */
export function ChemicalExpiryNotice({ onShow }: { onShow: () => void }) {
  const query = useChemicalLots(ATTENTION_COUNT)
  const total = query.data?.meta.total ?? 0
  if (total === 0) return null
  return (
    <div
      role="status"
      className="mx-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning px-4 py-3 text-sm"
    >
      <span>{`${String(total)} kimyasal partinin son kullanma tarihi geçti ya da 30 gün içinde doluyor.`}</span>
      <Button size="sm" variant="secondary" onClick={onShow}>
        Son kullanma listesini göster
      </Button>
    </div>
  )
}

const LOT_STATUS_OPTIONS = [
  { value: 'all', label: 'Bütün partiler' },
  { value: 'expired', label: CHEMICAL_EXPIRY_STATUS_LABELS.expired },
  { value: 'expiring', label: CHEMICAL_EXPIRY_STATUS_LABELS.expiring },
  { value: 'ok', label: CHEMICAL_EXPIRY_STATUS_LABELS.ok },
  { value: 'unknown', label: CHEMICAL_EXPIRY_STATUS_LABELS.unknown },
]
type LotStatusFilter = 'attention' | 'expired' | 'expiring' | 'ok' | 'unknown' | undefined
const lotStatusOf = (value: string | null): LotStatusFilter => {
  if (value === null) return 'attention'
  if (value === 'all') return undefined
  return value === 'expired' || value === 'expiring' || value === 'ok' || value === 'unknown'
    ? value
    : 'attention'
}

type LotTableRow = {
  id: string
  item: string
  warehouse: string
  lot: string
  expiry: string
  quantity: string
  pictograms: string
  row: ChemicalLotRow
}

/**
 * "Son kullanma" görünümü (`?stok=son-kullanma`; K-243): varsayılan olarak süresi geçen ve 30 gün
 * içinde dolan partiler, en yakın son kullanma önce; durum süzgeciyle bütün partiler.
 */
export function ChemicalExpiryPanel() {
  const list = useListState('kimyasal-partiler', { urlPrefix: 'parti_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = lotStatusOf(text(list.state.filters.status))
  const warehouses = useStockWarehouses({ page: 1, pageSize: 100 })
  const warehouseId = text(list.state.filters.warehouse)
  const lots = useChemicalLots({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(status === undefined ? {} : { status }),
    ...(warehouseId === null ? {} : { warehouseId }),
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const filters = useMemo(
    () => [
      { key: 'status', label: 'Durum', type: 'select' as const, options: LOT_STATUS_OPTIONS },
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
      lots.data?.data.map((lot): LotTableRow => ({
        id: lot.key,
        item: `${lot.code} · ${lot.name}`,
        warehouse: lot.campusName ? `${lot.warehouseName} · ${lot.campusName}` : lot.warehouseName,
        lot: lotText(lot),
        expiry: expiryText(lot),
        quantity: `${String(lot.quantity)} ${STOCK_UNIT_LABELS[lot.unit]}`,
        pictograms: lot.hazardPictograms.join(', ') || '—',
        row: lot,
      })),
    [lots.data],
  )
  const columns = useMemo<DataColumn<LotTableRow>[]>(
    () => [
      { key: 'item', label: 'Kimyasal' },
      { key: 'warehouse', label: 'Depo' },
      { key: 'lot', label: 'Parti' },
      {
        key: 'expiry',
        label: 'Son kullanma',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            <ExpiryBadge row={row.row} />
            <span>{row.expiry}</span>
          </span>
        ),
      },
      { key: 'quantity', label: 'Miktar' },
      { key: 'pictograms', label: 'Piktogram' },
    ],
    [],
  )
  return (
    <div className="grid gap-3 pt-3">
      <p className="px-6 text-sm text-muted-foreground">
        Son kullanma günü kullanılabilir son gündür. Liste süresi geçen ve 30 gün içinde dolan
        partileri gösterir; çıkış en yakın son kullanma tarihli partiden düşer.
      </p>
      <ServerDataTable
        list={list}
        rows={rows}
        total={lots.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={['item', 'expiry', 'quantity']}
        caption="Kimyasal partiler"
        empty="Süresi geçen ya da 30 gün içinde dolan parti yok."
        emptyFiltered="Bu seçimle eşleşen parti yok."
        loading={lots.isPending}
        fetching={lots.isFetching && !lots.isPending}
        error={
          lots.error ? (
            <QueryError error={lots.error} onRetry={() => void lots.refetch()} />
          ) : undefined
        }
      />
    </div>
  )
}

// --- Kimyasal envanter raporu --------------------------------------------------------------------

type InventoryTableRow = {
  id: string
  warehouse: string
  item: string
  cas: string
  hazard: string
  quantity: string
  expiry: string
  sds: string
  row: ChemicalInventoryRow
}

/**
 * "Kimyasal envanter" görünümü (`?stok=kimyasal`; DOM-FIN-090): depo × kimyasal, stokta olanlar.
 * CSV sunucudan (parti başına satır), PDF web'de üretilir; ikisi de ekrandaki süzgeçle eşleşen
 * bütün satırları verir.
 */
export function ChemicalInventoryPanel() {
  const list = useListState('kimyasal-envanter', { urlPrefix: 'kimyasal_' })
  const search = useDebouncedValue(list.state.query).trim()
  const warehouses = useStockWarehouses({ page: 1, pageSize: 100 })
  const warehouseId = text(list.state.filters.warehouse)
  const filter = {
    ...(warehouseId === null ? {} : { warehouseId }),
    ...(search.length >= 2 ? { q: search } : {}),
  }
  const report = useChemicalInventory({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...filter,
  })
  const exporter = useChemicalInventoryExport()
  const warehouseName = warehouses.data?.data.find(
    (warehouse) => warehouse.id === warehouseId,
  )?.name
  const scope = warehouseName ?? 'Bütün depolar'
  const filters = useMemo(
    () => [
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
  async function download() {
    const outcome = await exporter.submit(filter)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }), 'kimyasal-envanter.csv')
    notify.success('Dosya indirildi.')
  }
  const rows = useMemo(
    () =>
      report.data?.data.map((row): InventoryTableRow => ({
        id: row.key,
        warehouse: row.campusName ? `${row.warehouseName} · ${row.campusName}` : row.warehouseName,
        item: `${row.code} · ${row.name}`,
        cas: row.casNumber ?? '—',
        hazard:
          [
            row.hazardPictograms.join(', '),
            row.signalWord === null ? '' : signalWordText(row.signalWord),
          ]
            .filter(Boolean)
            .join(' · ') || '—',
        quantity: `${String(row.quantity)} ${STOCK_UNIT_LABELS[row.unit]}`,
        expiry: row.nearestExpiryDate === null ? '—' : dayText(row.nearestExpiryDate),
        sds: row.hasSds ? 'Var' : 'Yok',
        row,
      })),
    [report.data],
  )
  const columns = useMemo<DataColumn<InventoryTableRow>[]>(
    () => [
      { key: 'warehouse', label: 'Depo' },
      { key: 'item', label: 'Kimyasal' },
      { key: 'cas', label: 'CAS' },
      { key: 'hazard', label: 'Tehlike' },
      { key: 'quantity', label: 'Miktar' },
      {
        key: 'expiry',
        label: 'En yakın son kullanma',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            <span>{row.expiry}</span>
            {row.row.expiredQuantity > 0 ? (
              <StatusBadge text={`${String(row.row.expiredQuantity)} süresi geçti`} tone="red" />
            ) : null}
            {row.row.expiringQuantity > 0 ? (
              <StatusBadge text={`${String(row.row.expiringQuantity)} yaklaşıyor`} tone="amber" />
            ) : null}
          </span>
        ),
      },
      {
        key: 'sds',
        label: 'GBF',
        cell: (row) =>
          row.row.hasSds ? (
            <StatusBadge text="Var" tone="green" />
          ) : (
            <StatusBadge text="Yok" tone="amber" />
          ),
      },
    ],
    [],
  )
  return (
    <div className="grid gap-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6">
        <p className="text-sm text-muted-foreground">
          Depolardaki kimyasallar, tehlike piktogramları ve partileriyle.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={exporter.isPending}
            aria-busy={exporter.isPending || undefined}
            onClick={() => void download()}
          >
            <Icon name="Download" size={16} aria-hidden="true" />
            CSV indir
          </Button>
          <PdfDialogButton
            label="PDF"
            title={CHEMICAL_INVENTORY_TITLE}
            accessibleName="Kimyasal envanter PDF"
            id={{ ...filter, scope }}
            usePdf={useChemicalInventoryPdf}
          />
        </div>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={report.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={['item', 'quantity', 'expiry']}
        caption="Kimyasal envanter"
        empty="Stokta kimyasal yok."
        emptyFiltered="Bu seçimle eşleşen kimyasal yok."
        loading={report.isPending}
        fetching={report.isFetching && !report.isPending}
        error={
          report.error ? (
            <QueryError error={report.error} onRetry={() => void report.refetch()} />
          ) : undefined
        }
      />
    </div>
  )
}
