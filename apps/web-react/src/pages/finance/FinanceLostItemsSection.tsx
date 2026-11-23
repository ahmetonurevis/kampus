import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  useAddLostItemPhoto,
  useCloseLostReport,
  useCreateLostItem,
  useDisposeLostItems,
  useHandOverLostItem,
  useLostItem,
  useLostItemFinders,
  useLostItemRecipients,
  useLostItemRetention,
  useLostItems,
  useLostItemSettings,
  useLostItemSummary,
  useLostReports,
  useMatchLostReport,
  useRemoveLostItemPhoto,
  useSetLostItemSettings,
  useUnmatchLostReport,
  type LostItemDetail,
  type LostItemRow,
  type LostItemSettingsData,
  type LostItemSummary,
  type LostReportRow,
} from '@kampus/react-shared/use-finance-lost-items.ts'
import {
  LOST_ITEM_CATEGORIES,
  LOST_ITEM_CATEGORY_LABELS,
  LOST_ITEM_DISPOSAL_OUTCOMES,
  LOST_ITEM_PHOTO_MAX,
  LOST_ITEM_PHOTO_PURPOSE,
  LOST_ITEM_RECIPIENT_TYPE_LABELS,
  LOST_ITEM_RECIPIENT_TYPES,
  LOST_ITEM_STATUS_LABELS,
  LOST_ITEM_STATUSES,
} from '@kampus/school-core/lib/finance-lost-items.ts'
import { GUARDIAN_RELATIONSHIPS } from '@kampus/school-core/lib/guardianship.ts'
import { dayKey, timeLabel, dateLabel } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  canUploadLostItemPhotos,
  categoryText,
  DISPOSAL_OUTCOME_LABELS,
  dayText,
  disposalFormSchema,
  handoverBody,
  handoverDefaults,
  handoverFormSchema,
  lostItemStatusBadge,
  lostReportStatusBadge,
  recordBody,
  recordDefaults,
  recordFormField,
  recordFormSchema,
  settingsBody,
  settingsDefaults,
  settingsFormSchema,
  type DisposalFormValues,
  type HandoverFormValues,
  type RecordFormValues,
  type SettingsFormValues,
} from './finance-lost-item-forms.ts'

const NO_SORT: readonly string[] = []
const TAB_PARAM = 'kayip_sekme'
const STAFF_TABS = [
  { value: 'bekleyen', label: 'Bekleyen eşyalar' },
  { value: 'bildirimler', label: 'Kayıp bildirimleri' },
  { value: 'tumu', label: 'Bütün kayıtlar' },
] as const
const MANAGER_TABS = [...STAFF_TABS, { value: 'saklama', label: 'Ayar ve saklama' }] as const
type Tab = (typeof MANAGER_TABS)[number]['value']
const CATEGORY_OPTIONS = LOST_ITEM_CATEGORIES.map((value) => ({
  value,
  label: LOST_ITEM_CATEGORY_LABELS[value],
}))
const ITEM_FILTERS = [
  { key: 'category', label: 'Kategori', type: 'select' as const, options: CATEGORY_OPTIONS },
]
const ALL_FILTERS = [
  ...ITEM_FILTERS,
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: LOST_ITEM_STATUSES.map((value) => ({ value, label: LOST_ITEM_STATUS_LABELS[value] })),
  },
]
const FINDER_QUERY = { page: 1, pageSize: 100 } as const
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

/**
 * Kayıp eşya (DOM-FIN-145; ON-171): Finans "Kayıp eşya" sekmesi, yönetici ve ön büro (K-490).
 * "Eşya kaydet" dar ekranda tek sütunlu hızlı formdur (bugün, son saklama yeri önerilir).
 * "Bekleyen eşyalar" teslim bekleyenler, "Kayıp bildirimleri" veli ve öğrenci bildirimleri ve
 * eşleme (K-491); yönetici "Ayar ve saklama"da süreyi, aile galerisini ve süresi dolan eşyaların
 * gerekçeli toplu bağış/imhasını yönetir (K-492). Ayrıntı ve teslim sağ paneldedir.
 */
export function FinanceLostItemsSection({ isManager }: { isManager: boolean }) {
  const { session } = useAuth()
  const canUpload = canUploadLostItemPhotos(session?.role)
  const [params, setParams] = useSearchParams()
  const tabs = isManager ? MANAGER_TABS : STAFF_TABS
  const requested = params.get(TAB_PARAM)
  const tab: Tab = tabs.find((item) => item.value === requested)?.value ?? 'bekleyen'
  const panel = useDetailPanel('kayip')
  const summary = useLostItemSummary()
  const [recording, setRecording] = useState(false)
  const [lastStorage, setLastStorage] = useState('')
  const setTab = (next: Tab) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (next === 'bekleyen') copy.delete(TAB_PARAM)
        else copy.set(TAB_PARAM, next)
        return copy
      },
      { replace: true },
    )
  return (
    <section
      aria-labelledby="kayip-esya"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="kayip-esya" className="text-lg font-semibold">
            Kayıp eşya
          </h2>
          <p className="text-sm text-muted-foreground">
            Bulunan eşyayı fotoğrafıyla kaydedin, velinin bildirimiyle eşleyin, teslim alanı yazın.
            Teslim edilen kayıt değişmez.
          </p>
          <SummaryLine summary={summary.data?.data} />
        </div>
        <Button className="min-h-11" onClick={() => setRecording(true)}>
          Eşya kaydet
        </Button>
      </header>
      {summary.error ? (
        <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
      ) : null}
      <div className="px-6">
        <LineTabs label="Kayıp eşya görünümü" value={tab} options={tabs} onChange={setTab} />
      </div>
      {tab === 'bekleyen' ? <ItemList mode="pending" onOpen={panel.open} /> : null}
      {tab === 'bildirimler' ? <ReportList /> : null}
      {tab === 'tumu' ? <ItemList mode="all" onOpen={panel.open} /> : null}
      {tab === 'saklama' && isManager ? <RetentionView onOpen={panel.open} /> : null}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Bulunan eşya"
      >
        {panel.selectedId ? <ItemPanel itemId={panel.selectedId} canUpload={canUpload} /> : null}
      </SidePanel>
      <Modal
        open={recording}
        onOpenChange={setRecording}
        title="Bulunan eşyayı kaydet"
        description="Tanım, yer ve saklama yeri yeterli; fotoğraf isteğe bağlıdır."
      >
        {recording ? (
          <RecordForm
            canUpload={canUpload}
            storageLocation={lastStorage}
            onDone={(storage) => {
              setLastStorage(storage)
              setRecording(false)
              setTab('bekleyen')
            }}
          />
        ) : null}
      </Modal>
    </section>
  )
}

function SummaryLine({ summary }: { summary: LostItemSummary | undefined }) {
  if (!summary) return null
  return (
    <p className="text-sm" aria-live="polite">
      {`Bekleyen ${String(summary.pending)} eşya · aranan ${String(summary.openReports)} bildirim · teslim bekleyen eşleşme ${String(summary.matchedReports)}`}
      {summary.retentionDue > 0 ? (
        <span className="font-medium text-danger">{` · saklama süresi dolan ${String(summary.retentionDue)}`}</span>
      ) : null}
    </p>
  )
}

// --- Eşya listeleri ------------------------------------------------------------------------------

type ItemTableRow = {
  id: string
  row: LostItemRow
  description: string
  category: string
  found: string
  storage: string
}
const toItemRow = (item: LostItemRow): ItemTableRow => ({
  id: item.id,
  row: item,
  description: item.description,
  category: categoryText(item.category),
  found: `${dayText(item.foundOn)} · ${item.foundLocation}`,
  storage: item.storageLocation,
})
const itemStatusColumn: DataColumn<ItemTableRow> = {
  key: 'status',
  label: 'Durum',
  cell: (row) => {
    const badge = lostItemStatusBadge(row.row)
    return <StatusBadge text={badge.text} tone={badge.tone} />
  },
}
const openColumn = (onOpen: (id: string) => void): DataColumn<ItemTableRow> => ({
  key: ACTIONS_KEY,
  label: 'İşlemler',
  cell: (row) => (
    <Button
      className="min-h-11"
      variant="secondary"
      aria-label={`${row.description} kaydını aç`}
      onClick={() => onOpen(row.id)}
    >
      Aç
    </Button>
  ),
})

function ItemList({ mode, onOpen }: { mode: 'pending' | 'all'; onOpen: (id: string) => void }) {
  const list = useListState(`kayip-${mode}`, {
    urlPrefix: mode === 'pending' ? 'bekleyen_' : 'tumu_',
  })
  const search = useDebouncedValue(list.state.query).trim()
  const category = LOST_ITEM_CATEGORIES.find((value) => value === text(list.state.filters.category))
  const status =
    mode === 'pending'
      ? 'pending'
      : LOST_ITEM_STATUSES.find((value) => value === text(list.state.filters.status))
  const items = useLostItems({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(status === undefined ? {} : { status }),
    ...(category === undefined ? {} : { category }),
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const rows = useMemo(() => items.data?.data.map(toItemRow), [items.data])
  const columns = useMemo<DataColumn<ItemTableRow>[]>(
    () => [
      { key: 'description', label: 'Eşya' },
      { key: 'category', label: 'Kategori' },
      { key: 'found', label: 'Bulunduğu' },
      { key: 'storage', label: 'Saklama yeri' },
      itemStatusColumn,
      openColumn(onOpen),
    ],
    [onOpen],
  )
  return (
    <ServerDataTable
      list={list}
      rows={rows}
      total={items.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      filters={mode === 'pending' ? ITEM_FILTERS : ALL_FILTERS}
      mobileColumns={['description', ACTIONS_KEY]}
      caption={mode === 'pending' ? 'Bekleyen eşyalar' : 'Bütün eşya kayıtları'}
      empty={mode === 'pending' ? 'Bekleyen eşya yok.' : 'Henüz eşya kaydı yok.'}
      emptyFiltered="Bu aramayla eşleşen eşya yok."
      loading={items.isPending}
      fetching={items.isFetching && !items.isPending}
      error={
        items.error ? (
          <QueryError error={items.error} onRetry={() => void items.refetch()} />
        ) : undefined
      }
    />
  )
}

// --- Hızlı kayıt ---------------------------------------------------------------------------------

function RecordForm({
  canUpload,
  storageLocation,
  onDone,
}: {
  canUpload: boolean
  storageLocation: string
  onDone: (storageLocation: string) => void
}) {
  const finders = useLostItemFinders(FINDER_QUERY)
  const create = useCreateLostItem()
  const [photos, setPhotos] = useState<FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [scanBlocked, setScanBlocked] = useState(false)
  const form = useForm<RecordFormValues>({
    resolver: zodResolver(recordFormSchema),
    defaultValues: recordDefaults(dayKey(), storageLocation),
  })
  const errors = form.formState.errors
  const saving = create.isPending || form.formState.isSubmitting
  const busy = saving || uploading
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(
      recordBody(
        values,
        photos.map((photo) => photo.id),
      ),
      {
        setError: (name, error) => {
          const field = recordFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Eşya kaydedildi.')
    onDone(values.storageLocation.trim())
  })
  return (
    <form
      noValidate
      aria-label="Bulunan eşyayı kaydet"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="kayip-tanim" label="Eşyanın tanımı" error={errors.description}>
          {(control) => (
            <Input
              {...control}
              autoComplete="off"
              {...form.register('description')}
              disabled={saving}
            />
          )}
        </FormField>
      </div>
      <FormField id="kayip-kategori" label="Kategori" error={errors.category}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('category')}
            className="w-full"
            disabled={saving}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="kayip-gun" label="Bulunduğu gün" error={errors.foundOn}>
        {(control) => (
          <Input {...control} type="date" {...form.register('foundOn')} disabled={saving} />
        )}
      </FormField>
      <FormField id="kayip-yer" label="Bulunduğu yer" error={errors.foundLocation}>
        {(control) => <Input {...control} {...form.register('foundLocation')} disabled={saving} />}
      </FormField>
      <FormField id="kayip-saklama" label="Saklama yeri" error={errors.storageLocation}>
        {(control) => (
          <Input {...control} {...form.register('storageLocation')} disabled={saving} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          id="kayip-bulan"
          label="Bulan ya da getiren personel (isteğe bağlı)"
          error={errors.finderMembershipId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('finderMembershipId')}
              className="w-full"
              disabled={saving || finders.isPending}
            >
              <NativeSelectOption value="">Seçilmedi</NativeSelectOption>
              {(finders.data?.data ?? []).map((finder) => (
                <NativeSelectOption key={finder.membershipId} value={finder.membershipId}>
                  {finder.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      {canUpload ? (
        <div className="sm:col-span-2">
          <FileUploadField
            id="kayip-fotograf"
            label="Fotoğraf (isteğe bağlı)"
            purpose={LOST_ITEM_PHOTO_PURPOSE}
            description={`En çok ${String(LOST_ITEM_PHOTO_MAX)} fotoğraf; jpg, png ya da webp. Üzerinde ad yazıyorsa adı görünmeyecek açıdan çekin.`}
            listLabel="Eşya fotoğrafları"
            items={photos}
            multiple
            maxFiles={LOST_ITEM_PHOTO_MAX}
            disabled={saving}
            onUploaded={(item) => setPhotos((current) => [...current, item])}
            onRemoved={(fileId) =>
              setPhotos((current) => current.filter((photo) => photo.id !== fileId))
            }
            onBusyChange={setUploading}
            onBlockedChange={setScanBlocked}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          Fotoğrafı yönetici ekler; kaydı fotoğrafsız açabilirsiniz.
        </p>
      )}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button
          type="submit"
          className="min-h-11 w-full sm:w-auto"
          disabled={busy || scanBlocked}
          aria-busy={saving || undefined}
        >
          Kaydet
        </Button>
      </div>
    </form>
  )
}

// --- Ayrıntı ve teslim ---------------------------------------------------------------------------

function ItemPanel({ itemId, canUpload }: { itemId: string; canUpload: boolean }) {
  const item = useLostItem(itemId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const detail = item.data?.data
  if (!detail) return <SummaryLoading />
  return <ItemDetails key={detail.version} detail={detail} canUpload={canUpload} />
}

function recipientText(detail: LostItemDetail) {
  if (detail.recipientType === null) return null
  return `${detail.recipientName ?? '—'} (${LOST_ITEM_RECIPIENT_TYPE_LABELS[detail.recipientType]})`
}

function ItemDetails({ detail, canUpload }: { detail: LostItemDetail; canUpload: boolean }) {
  const [handing, setHanding] = useState(false)
  const status = lostItemStatusBadge(detail)
  const recipient = recipientText(detail)
  const items: [string, string][] = [
    ['Kategori', categoryText(detail.category)],
    ['Bulunduğu', `${dayText(detail.foundOn)} · ${detail.foundLocation}`],
    ['Saklama yeri', detail.storageLocation],
    ['Bulan', detail.finderName ?? '—'],
    ...(detail.matchedReport
      ? ([['Bildirim', detail.matchedReport.studentName ?? 'Öğrenci']] as [string, string][])
      : []),
    ...(detail.status === 'pending'
      ? ([['Saklama sonu', dayText(detail.retentionDueOn)]] as [string, string][])
      : []),
    ...(recipient && detail.handedOverAt
      ? ([
          ['Teslim alan', recipient],
          [
            'Teslim',
            `${dateLabel(detail.handedOverAt)} ${timeLabel(detail.handedOverAt)} · ${detail.handedOverByName ?? '—'}`,
          ],
        ] as [string, string][])
      : []),
    ...(detail.disposedAt
      ? ([
          [
            'Kapanış',
            `${LOST_ITEM_STATUS_LABELS[detail.status]} · ${dateLabel(detail.disposedAt)}`,
          ],
          ['Gerekçe', detail.disposalReason ?? '—'],
        ] as [string, string][])
      : []),
  ]
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{detail.description}</h3>
        <StatusBadge text={status.text} tone={status.tone} />
      </div>
      <PhotoStrip detail={detail} canUpload={canUpload} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {detail.status === 'pending' && !handing ? (
        <div>
          <Button className="min-h-11" onClick={() => setHanding(true)}>
            Teslim et
          </Button>
        </div>
      ) : null}
      {detail.status === 'pending' && handing ? (
        <HandoverForm detail={detail} onCancel={() => setHanding(false)} />
      ) : null}
    </div>
  )
}

function PhotoStrip({ detail, canUpload }: { detail: LostItemDetail; canUpload: boolean }) {
  const add = useAddLostItemPhoto()
  const remove = useRemoveLostItemPhoto()
  const [uploads, setUploads] = useState<FileUploadItem[]>([])
  const editable = detail.status === 'pending' && canUpload
  const busy = add.isPending || remove.isPending
  return (
    <div className="grid gap-2">
      {detail.photos.length > 0 ? (
        <ul aria-label="Eşya fotoğrafları" className="flex flex-wrap gap-2">
          {detail.photos.map((photo, index) => (
            <li key={photo.fileId} className="grid gap-1">
              {photo.url ? (
                <img
                  src={photo.url}
                  alt={`${detail.description} fotoğrafı ${String(index + 1)}`}
                  className="h-28 w-28 rounded-md border object-cover"
                />
              ) : (
                <span className="flex h-28 w-28 items-center justify-center rounded-md border text-xs text-muted-foreground">
                  Fotoğraf açılamadı
                </span>
              )}
              {editable ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Fotoğraf ${String(index + 1)} kaldır`}
                  onClick={() =>
                    void remove
                      .submit({ itemId: detail.id, version: detail.version, fileId: photo.fileId })
                      .then((outcome) => {
                        if (outcome.status === 'success') notify.success('Fotoğraf kaldırıldı.')
                      })
                  }
                >
                  Kaldır
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Fotoğraf yok.</p>
      )}
      {editable && detail.photos.length < LOST_ITEM_PHOTO_MAX ? (
        <FileUploadField
          id="kayip-fotograf-ekle"
          label="Fotoğraf ekle"
          purpose={LOST_ITEM_PHOTO_PURPOSE}
          listLabel="Eklenecek fotoğraf"
          items={uploads}
          disabled={busy}
          onUploaded={(item) => {
            setUploads([item])
            void add
              .submit({ itemId: detail.id, version: detail.version, fileId: item.id })
              .then((outcome) => {
                setUploads([])
                if (outcome.status === 'success') notify.success('Fotoğraf eklendi.')
              })
          }}
          onRemoved={() => setUploads([])}
        />
      ) : null}
    </div>
  )
}

function HandoverForm({ detail, onCancel }: { detail: LostItemDetail; onCancel: () => void }) {
  const handover = useHandOverLostItem()
  const form = useForm<HandoverFormValues>({
    resolver: zodResolver(handoverFormSchema),
    defaultValues: handoverDefaults(detail.matchedReport?.studentId ?? null),
  })
  const [recipientType, studentId] = useWatch({
    control: form.control,
    name: ['recipientType', 'studentId'],
  })
  const recipients = useLostItemRecipients(studentId, recipientType === 'guardian')
  const errors = form.formState.errors
  const busy = handover.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await handover.submit(
      { itemId: detail.id, version: detail.version, body: handoverBody(values) },
      {
        setError: (name, error) => {
          if (name === 'studentId' || name === 'guardianLinkId' || name === 'recipientName')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success('Eşya teslim edildi.')
  })
  return (
    <form
      noValidate
      aria-label="Eşyayı teslim et"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="teslim-tur" label="Teslim alan" error={errors.recipientType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('recipientType')}
            className="w-full"
            disabled={busy}
          >
            {LOST_ITEM_RECIPIENT_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {LOST_ITEM_RECIPIENT_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {recipientType === 'other' ? (
        <FormField id="teslim-ad" label="Teslim alanın adı" error={errors.recipientName}>
          {(control) => <Input {...control} {...form.register('recipientName')} disabled={busy} />}
        </FormField>
      ) : (
        <Controller
          control={form.control}
          name="studentId"
          render={({ field }) => (
            <StudentChoice
              value={field.value}
              preset={detail.matchedReport?.studentName ?? null}
              onChange={(value) => {
                field.onChange(value)
                form.setValue('guardianLinkId', '')
              }}
              error={errors.studentId?.message}
              disabled={busy}
            />
          )}
        />
      )}
      {recipientType === 'guardian' && studentId !== '' ? (
        <FormField id="teslim-veli" label="Veli" error={errors.guardianLinkId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('guardianLinkId')}
              className="w-full"
              disabled={busy || recipients.isPending}
            >
              <NativeSelectOption value="">Veliyi seçin</NativeSelectOption>
              {(recipients.data?.data.guardians ?? []).map((guardian) => (
                <NativeSelectOption
                  key={guardian.guardianLinkId}
                  value={guardian.guardianLinkId}
                  disabled={!guardian.canReceive}
                >
                  {`${guardian.name ?? 'Veli'} · ${GUARDIAN_RELATIONSHIPS[guardian.relationship].label}${guardian.canReceive ? '' : ' (teslim alamaz)'}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          Teslimi kaydet
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={busy}
          onClick={onCancel}
        >
          Vazgeç
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Teslimden sonra kayıt değiştirilemez.</p>
    </form>
  )
}

/** Eşyanın sahibi öğrenci: ad ya da numarayla arama (en az 2 karakter). */
function StudentChoice({
  value,
  preset,
  onChange,
  error,
  disabled,
}: {
  value: string
  preset: string | null
  onChange: (value: string) => void
  error: string | undefined
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(preset ?? '')
  const search = useDebouncedValue(query).trim()
  const students = useCoreList(
    'students',
    { q: search, pageSize: 5 },
    { enabled: search.length >= 2 },
  )
  const id = useId()
  if (value !== '')
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{`Öğrenci: ${picked || value}`}</span>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={disabled}
          onClick={() => onChange('')}
        >
          Öğrenciyi değiştir
        </Button>
      </div>
    )
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Eşyanın sahibi öğrenci</Label>
      <Input
        id={id}
        value={query}
        placeholder="Ad ya da numara (en az 2 karakter)"
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {search.length >= 2 ? (
        <ul aria-label="Öğrenci arama sonuçları" className="grid gap-1">
          {(students.data?.rows ?? []).map(({ record }) => (
            <li key={record.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPicked(record.name)
                  setQuery('')
                  onChange(record.id)
                }}
              >
                {record.name}
                {record.number ? ` · ${record.number}` : ''}
              </Button>
            </li>
          ))}
          {students.isSuccess && students.data.rows.length === 0 ? (
            <li className="text-sm text-muted-foreground">Sonuç yok.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

// --- Kayıp bildirimleri --------------------------------------------------------------------------

type ReportTableRow = {
  id: string
  row: LostReportRow
  student: string
  description: string
  lost: string
}
const toReportRow = (report: LostReportRow): ReportTableRow => ({
  id: report.id,
  row: report,
  student: report.studentName ?? '—',
  description: report.description,
  lost: `${dayText(report.lostOn)} · ${categoryText(report.category)}`,
})

function ReportList() {
  const list = useListState('kayip-bildirimler', { urlPrefix: 'bildirim_' })
  const search = useDebouncedValue(list.state.query).trim()
  const reports = useLostReports({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const unmatch = useUnmatchLostReport()
  const close = useCloseLostReport()
  const [matching, setMatching] = useState<LostReportRow | null>(null)
  const rows = useMemo(() => reports.data?.data.map(toReportRow), [reports.data])
  const columns = useMemo<DataColumn<ReportTableRow>[]>(() => {
    const run = async (kind: 'unmatch' | 'close', row: LostReportRow) => {
      const command = kind === 'unmatch' ? unmatch : close
      const outcome = await command.submit({ reportId: row.id, version: row.version })
      if (outcome.status === 'success')
        notify.success(kind === 'unmatch' ? 'Eşleme kaldırıldı.' : 'Bildirim kapatıldı.')
    }
    return [
      { key: 'student', label: 'Öğrenci' },
      { key: 'description', label: 'Kaybolan' },
      { key: 'lost', label: 'Gün ve kategori' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => {
          const badge = lostReportStatusBadge(row.row)
          return (
            <span className="grid gap-1">
              <StatusBadge text={badge.text} tone={badge.tone} />
              {row.row.matchedItem ? (
                <span className="text-xs text-muted-foreground">{`${row.row.matchedItem.description} · ${row.row.matchedItem.storageLocation}`}</span>
              ) : null}
            </span>
          )
        },
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            {row.row.status === 'open' ? (
              <Button
                className="min-h-11"
                variant="secondary"
                aria-label={`${row.student} bildirimini eşle`}
                onClick={() => setMatching(row.row)}
              >
                Eşle
              </Button>
            ) : null}
            {row.row.status === 'matched' ? (
              <Button
                className="min-h-11"
                variant="ghost"
                disabled={unmatch.isPending}
                onClick={() => void run('unmatch', row.row)}
              >
                Eşlemeyi kaldır
              </Button>
            ) : null}
            {row.row.status === 'open' || row.row.status === 'matched' ? (
              <Button
                className="min-h-11"
                variant="ghost"
                aria-label={`${row.student} bildirimini kapat`}
                disabled={close.isPending}
                onClick={() => void run('close', row.row)}
              >
                Kapat
              </Button>
            ) : null}
          </span>
        ),
      },
    ]
  }, [close, unmatch])
  return (
    <>
      <ServerDataTable
        list={list}
        rows={rows}
        total={reports.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['student', ACTIONS_KEY]}
        caption="Kayıp bildirimleri"
        empty="Kayıp bildirimi yok."
        emptyFiltered="Bu aramayla eşleşen bildirim yok."
        loading={reports.isPending}
        fetching={reports.isFetching && !reports.isPending}
        error={
          reports.error ? (
            <QueryError error={reports.error} onRetry={() => void reports.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={matching !== null}
        onOpenChange={(open) => (open ? undefined : setMatching(null))}
        title="Bildirimi bulunan eşyayla eşle"
        description="Eşleme teslim değildir; teslimi eşyanın panelinden kaydedin."
      >
        {matching ? <MatchChoice report={matching} onDone={() => setMatching(null)} /> : null}
      </Modal>
    </>
  )
}

function MatchChoice({ report, onDone }: { report: LostReportRow; onDone: () => void }) {
  const match = useMatchLostReport()
  const items = useLostItems({
    page: 1,
    pageSize: 50,
    status: 'pending',
    ...(report.category === null ? {} : { category: report.category }),
  })
  const free = (items.data?.data ?? []).filter((item) => item.matchedReport === null)
  const submit = async (itemId: string) => {
    const outcome = await match.submit({ reportId: report.id, version: report.version, itemId })
    if (outcome.status === 'success') notify.success('Bildirim eşyayla eşlendi.')
    if (outcome.status !== 'busy') onDone()
  }
  if (items.error) return <QueryError error={items.error} onRetry={() => void items.refetch()} />
  return (
    <div className="grid gap-3">
      <p className="text-sm">{`${report.studentName ?? 'Öğrenci'} · ${report.description}`}</p>
      {items.isPending ? <SummaryLoading /> : null}
      {items.isSuccess && free.length === 0 ? (
        <p className="text-sm text-muted-foreground">Eşlenebilecek bekleyen eşya yok.</p>
      ) : null}
      <ul aria-label="Bekleyen eşyalar" className="grid gap-2">
        {free.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">{`${item.description} · ${dayText(item.foundOn)} · ${item.storageLocation}`}</span>
            <Button
              className="min-h-11"
              variant="secondary"
              disabled={match.isPending}
              aria-label={`${item.description} ile eşle`}
              onClick={() => void submit(item.id)}
            >
              Bu eşya
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// --- Ayar ve saklama -----------------------------------------------------------------------------

function RetentionView({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('kayip-saklama', { urlPrefix: 'saklama_' })
  const due = useLostItemRetention({ page: list.state.page, pageSize: list.state.pageSize })
  const [target, setTarget] = useState<{ ids: string[]; description: string } | null>(null)
  const rows = useMemo(() => due.data?.data.map(toItemRow), [due.data])
  const columns = useMemo<DataColumn<ItemTableRow>[]>(
    () => [
      { key: 'description', label: 'Eşya' },
      { key: 'category', label: 'Kategori' },
      { key: 'retention', label: 'Saklama sonu', cell: (row) => dayText(row.row.retentionDueOn) },
      itemStatusColumn,
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${row.description} kaydını aç`}
              onClick={() => onOpen(row.id)}
            >
              Aç
            </Button>
            {row.row.matchedReport === null ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.description} için bağış ya da imha`}
                onClick={() => setTarget({ ids: [row.id], description: row.description })}
              >
                Bağış / imha
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [onOpen],
  )
  const pageIds = (due.data?.data ?? [])
    .filter((item) => item.matchedReport === null)
    .map((item) => item.id)
  return (
    <div className="grid gap-4 pb-6">
      <SettingsCard />
      <div className="flex flex-wrap items-center justify-between gap-2 px-6">
        <p className="text-sm text-muted-foreground">
          {due.data
            ? `Saklama süresi ${String(due.data.meta.retentionDays)} gün; süresi dolan ${String(due.data.meta.total)} eşya. Sahibiyle eşlenmiş eşya kapatılmaz.`
            : 'Süresi dolan eşyalar yükleniyor.'}
        </p>
        {pageIds.length > 1 ? (
          <Button
            variant="secondary"
            onClick={() =>
              setTarget({
                ids: pageIds,
                description: `Bu sayfadaki ${String(pageIds.length)} eşya`,
              })
            }
          >
            Bu sayfadakileri kapat
          </Button>
        ) : null}
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={due.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['description', 'retention']}
        caption="Saklama süresi dolan eşyalar"
        empty="Saklama süresi dolan eşya yok."
        emptyFiltered="Saklama süresi dolan eşya yok."
        loading={due.isPending}
        fetching={due.isFetching && !due.isPending}
        error={
          due.error ? (
            <QueryError error={due.error} onRetry={() => void due.refetch()} />
          ) : undefined
        }
      />
      {target ? (
        <DisposalDialog
          ids={target.ids}
          description={target.description}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </div>
  )
}

function SettingsCard() {
  const settings = useLostItemSettings()
  if (settings.error)
    return <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  const current = settings.data?.data
  if (!current) return <SummaryLoading />
  return <SettingsForm key={current.version} current={current} />
}

function SettingsForm({ current }: { current: LostItemSettingsData }) {
  const save = useSetLostItemSettings()
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: settingsDefaults(current),
  })
  const errors = form.formState.errors
  const busy = save.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const body = settingsBody(current, values)
    if (body === null) {
      notify.success('Ayarda değişiklik yok.')
      return
    }
    const outcome = await save.submit(
      { version: current.version, body },
      {
        setError: (name, error) => {
          if (name === 'retentionDays') form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success('Ayar kaydedildi.')
  })
  return (
    <form
      noValidate
      aria-label="Kayıp eşya ayarı"
      className="grid gap-3 px-6 pt-4 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="kayip-saklama-gun" label="Saklama süresi (gün)" error={errors.retentionDays}>
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            {...form.register('retentionDays')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="flex min-h-11 items-center gap-2 self-end">
        <Controller
          control={form.control}
          name="familyGalleryEnabled"
          render={({ field }) => (
            <Checkbox
              id="kayip-galeri"
              checked={field.value}
              disabled={busy}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          )}
        />
        <Label htmlFor="kayip-galeri">Veli ve öğrenci bekleyen eşyaların fotoğrafını görsün</Label>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Ayarı kaydet
        </Button>
      </div>
    </form>
  )
}

/** Toplu bağış/imha onayı (K-492): sonuç, zorunlu gerekçe, taze oturum, tek seferlik anahtar. */
function DisposalDialog({
  ids,
  description,
  onClose,
}: {
  ids: readonly string[]
  description: string
  onClose: () => void
}) {
  const dispose = useDisposeLostItems()
  const { run, reauthModal } = useReauthRetry()
  const form = useForm<DisposalFormValues>({
    resolver: zodResolver(disposalFormSchema),
    defaultValues: { outcome: 'donated', reason: '' },
  })
  const errors = form.formState.errors
  const busy = dispose.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await run(() =>
      dispose.submit(
        { itemIds: [...ids], outcome: values.outcome, reason: values.reason.trim() },
        {
          silent: isReauthenticationRequired,
          setError: (name, problem) => {
            if (name === 'reason') form.setError('reason', problem, { shouldFocus: true })
            else form.setError('root.server', problem)
          },
        },
      ),
    )
    if (outcome.status !== 'done' || outcome.result.status !== 'success') return
    notify.success(`${String(outcome.result.data.data.disposedCount)} eşya kapatıldı.`)
    onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Süresi dolan eşyayı kapat"
    >
      <form
        noValidate
        aria-label="Bağış ya da imha"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <p className="text-sm">{`${description} bağışlandı ya da imha edildi olarak kapatılacak; fotoğrafları silinir. Geri alınamaz.`}</p>
        <FormField id="kayip-imha-sonuc" label="Sonuç" error={errors.outcome}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('outcome')}
              className="w-full"
              disabled={busy}
            >
              {LOST_ITEM_DISPOSAL_OUTCOMES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {DISPOSAL_OUTCOME_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="kayip-imha-gerekce"
          label="Gerekçe"
          description="Örn. bağış yapılan kurum ya da imha nedeni."
          error={errors.reason}
        >
          {(control) => (
            <Textarea {...control} rows={2} {...form.register('reason')} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
            Kapat
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
        </div>
      </form>
      {reauthModal}
    </Modal>
  )
}
