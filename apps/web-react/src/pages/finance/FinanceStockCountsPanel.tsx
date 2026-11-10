import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import { useStockWarehouses } from '@kampus/react-shared/use-finance-inventory.ts'
import {
  useCancelStockCount,
  useCompleteStockCount,
  useScanStockCount,
  useSetStockCountQuantity,
  useStartStockCount,
  useStockCount,
  useStockCounts,
  type StockCountDetail,
  type StockCountRow,
} from '@kampus/react-shared/use-finance-stock-counts.ts'
import { STOCK_UNIT_LABELS, type StockUnit } from '@kampus/school-core/lib/finance-inventory.ts'
import {
  STOCK_COUNT_STATUS_LABELS,
  STOCK_COUNT_STATUSES,
  stockCountActions,
  stockCountReportCsv,
  type StockCountStatus,
} from '@kampus/school-core/lib/finance-stock-counts.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useStockCountPdf } from '@/hooks/use-finance-stock-count-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { csvFilename } from '@/lib/csv.ts'
import { saveBlob } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { STOCK_COUNT_REPORT_TITLE } from '@/lib/pdf/templates/finance-stock-count.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import { reasonFormSchema, type ReasonFormValues } from './finance-procurement-forms.ts'
import {
  COUNT_STATUS_TONE,
  completionSummary,
  differenceTone,
  hasMovementsDuringCount,
  quantityDefaults,
  quantityFormSchema,
  scanBody,
  scanDefaults,
  scanFormSchema,
  signedDifference,
  startCountBody,
  startCountDefaults,
  startCountFormField,
  startCountFormSchema,
  stockCountCsvFilename,
  stockCountCsvItems,
  type QuantityFormValues,
  type ScanFormValues,
  type StartCountFormValues,
} from './finance-stock-count-forms.ts'

const COUNT_PARAM = 'sayim_id'
const NO_SORT: readonly string[] = []
const BOM = '﻿'
const START_FORM = 'stok-sayim-baslat-formu'
const QUANTITY_FORM = 'stok-sayim-miktar-formu'
const CANCEL_FORM = 'stok-sayim-iptal-formu'
const STATUS_OPTIONS = STOCK_COUNT_STATUSES.map((value) => ({
  value,
  label: STOCK_COUNT_STATUS_LABELS[value],
}))
const timeText = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is StockCountStatus =>
  STOCK_COUNT_STATUSES.some((status) => status === value)
const num = 'text-right tabular-nums'

/**
 * Stok sayımları (`?gorunum=stok&stok=sayim`; DOM-FIN-081, ON-231): sayım listesi ve seçilen
 * sayımın ekranı (`sayim_id`). Yönetici depoda sayım başlatır, tamamlar ve iptal eder; yönetici ve
 * ön büro kart okutur ve miktar girer (K-228). Barkod okuyucu klavye gibi yazar: kod alanı odaktadır,
 * Enter okutur (K-229). Fark raporu CSV ve PDF olarak alınır.
 */
export function FinanceStockCountsPanel({ role }: { role: string }) {
  const [params, setParams] = useSearchParams()
  const countId = params.get(COUNT_PARAM) ?? ''
  const openCount = (id: string) => {
    const next = new URLSearchParams(params)
    if (id === '') next.delete(COUNT_PARAM)
    else next.set(COUNT_PARAM, id)
    setParams(next)
  }
  return countId === '' ? (
    <CountList role={role} onOpen={openCount} />
  ) : (
    <CountScreen countId={countId} onBack={() => openCount('')} />
  )
}

// --- Liste ---------------------------------------------------------------------------------------

type CountTableRow = {
  id: string
  startedAt: string
  warehouse: string
  status: StockCountStatus
  progress: string
  adjustments: string
  startedBy: string
}

function CountList({ role, onOpen }: { role: string; onOpen: (id: string) => void }) {
  const canStart = stockCountActions(role).start
  const [starting, setStarting] = useState(false)
  const list = useListState('stok-sayimlari', { urlPrefix: 'sayim_' })
  const warehouses = useStockWarehouses({ page: 1, pageSize: 100 })
  const status = text(list.state.filters.status)
  const warehouseId = text(list.state.filters.warehouse)
  const counts = useStockCounts({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(isStatus(status) ? { status } : {}),
    ...(warehouseId === null ? {} : { warehouseId }),
  })
  const filters = useMemo(
    () => [
      { key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS },
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
      counts.data?.data.map((count: StockCountRow): CountTableRow => ({
        id: count.id,
        startedAt: timeText(count.startedAt),
        warehouse: count.campusName
          ? `${count.warehouseName} · ${count.campusName}`
          : count.warehouseName,
        status: count.status,
        progress: `${String(count.countedCount)} / ${String(count.lineCount)}`,
        adjustments: count.status === 'completed' ? String(count.adjustmentCount) : '—',
        startedBy: count.startedByName ?? '—',
      })),
    [counts.data],
  )
  const columns = useMemo<DataColumn<CountTableRow>[]>(
    () => [
      { key: 'startedAt', label: 'Başlangıç' },
      { key: 'warehouse', label: 'Depo' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={STOCK_COUNT_STATUS_LABELS[row.status]}
            tone={COUNT_STATUS_TONE[row.status]}
          />
        ),
      },
      { key: 'progress', label: 'Sayılan / kalem' },
      { key: 'adjustments', label: 'Düzeltme' },
      { key: 'startedBy', label: 'Başlatan' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.warehouse} sayımını aç (${row.startedAt})`}
            onClick={() => onOpen(row.id)}
          >
            {row.status === 'open' ? 'Sayıma devam et' : 'Raporu aç'}
          </Button>
        ),
      },
    ],
    [onOpen],
  )
  return (
    <div className="grid gap-3 pt-3">
      <p className="px-6 text-sm text-muted-foreground">
        Sayım başlarken depodaki miktarlar anlık görüntü olarak saklanır. Tamamlanınca farklar sayım
        düzeltmesi olarak stoka yazılır; sayılmayan ürünler değişmez.
      </p>
      {canStart ? (
        <div className="flex justify-end px-6">
          <Button onClick={() => setStarting(true)}>
            <Icon name="ClipboardCheck" size={17} aria-hidden="true" />
            Sayım başlat
          </Button>
        </div>
      ) : null}
      <ServerDataTable
        list={list}
        rows={rows}
        total={counts.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={['warehouse', 'status']}
        caption="Stok sayımları"
        empty="Henüz stok sayımı yok."
        emptyFiltered="Bu seçimle eşleşen sayım yok."
        loading={counts.isPending}
        fetching={counts.isFetching && !counts.isPending}
        error={
          counts.error ? (
            <QueryError error={counts.error} onRetry={() => void counts.refetch()} />
          ) : undefined
        }
      />
      {starting ? (
        <StartCountModal
          onClose={() => setStarting(false)}
          onStarted={(id) => {
            setStarting(false)
            onOpen(id)
          }}
        />
      ) : null}
    </div>
  )
}

function StartCountModal({
  onClose,
  onStarted,
}: {
  onClose: () => void
  onStarted: (id: string) => void
}) {
  const start = useStartStockCount()
  const warehouses = useStockWarehouses({ page: 1, pageSize: 100, status: 'active' })
  const form = useForm<StartCountFormValues>({
    resolver: zodResolver(startCountFormSchema),
    defaultValues: startCountDefaults(),
  })
  const busy = start.isPending || form.formState.isSubmitting
  const { errors } = form.formState
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await start.submit(startCountBody(values), {
      setError: (name: string, error: { type: string; message: string }) => {
        const field = startCountFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.warehouseName} sayımı başladı.`)
      onStarted(outcome.data.data.id)
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Sayım başlat"
      description="Depodaki miktarlar bu anda anlık görüntü olarak saklanır."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={START_FORM} disabled={busy} aria-busy={busy || undefined}>
            Sayımı başlat
          </Button>
        </>
      }
    >
      <form
        id={START_FORM}
        noValidate
        aria-label="Sayım başlat"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="sayim-depo" label="Depo" error={errors.warehouseId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('warehouseId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Depo seçin</NativeSelectOption>
              {(warehouses.data?.data ?? []).map((warehouse) => (
                <NativeSelectOption key={warehouse.id} value={warehouse.id}>
                  {warehouse.campusName
                    ? `${warehouse.name} · ${warehouse.campusName}`
                    : warehouse.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="sayim-not" label="Not (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

// --- Sayım ekranı --------------------------------------------------------------------------------

type QuantityTarget = {
  itemId: string
  itemName: string
  unit: StockUnit
  countedQuantity: number | null
}

function CountScreen({ countId, onBack }: { countId: string; onBack: () => void }) {
  const query = useStockCount(countId)
  const [editing, setEditing] = useState<QuantityTarget | null>(null)
  const [dialog, setDialog] = useState<'complete' | 'cancel' | null>(null)
  if (query.error)
    return (
      <div className="grid gap-3 px-6 pt-3 pb-6">
        <BackButton onBack={onBack} />
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      </div>
    )
  const count = query.data?.data
  if (!count)
    return (
      <div className="px-6 pt-3 pb-6">
        <SummaryLoading />
      </div>
    )
  const downloadCsv = () => {
    const csv = stockCountReportCsv(count, stockCountCsvItems(count))
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      csvFilename(stockCountCsvFilename(count)),
    )
    notify.success('Dosya indirildi.')
  }
  const unitOf = (unit: StockUnit) => STOCK_UNIT_LABELS[unit]
  return (
    <div className="grid gap-5 px-6 pt-3 pb-6">
      <BackButton onBack={onBack} />
      <section aria-labelledby="sayim-baslik" className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="sayim-baslik" className="text-base font-semibold">
            {`${count.warehouseName} sayımı`}
          </h3>
          <StatusBadge
            text={STOCK_COUNT_STATUS_LABELS[count.status]}
            tone={COUNT_STATUS_TONE[count.status]}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {[
            count.campusName,
            `Başlatan ${count.startedByName ?? '—'} · ${timeText(count.startedAt)}`,
            count.completedAt ? `Tamamlandı ${timeText(count.completedAt)}` : null,
            count.cancelledAt
              ? `İptal edildi ${timeText(count.cancelledAt)}: ${count.cancelReason ?? ''}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {count.note ? <p className="text-sm">{count.note}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={downloadCsv}>
            <Icon name="Download" size={16} aria-hidden="true" />
            Fark raporu CSV
          </Button>
          <PdfDialogButton
            label="Fark raporu PDF"
            title={STOCK_COUNT_REPORT_TITLE}
            id={count.id}
            usePdf={useStockCountPdf}
          />
          {count.actions.complete ? (
            <Button type="button" onClick={() => setDialog('complete')}>
              Sayımı tamamla
            </Button>
          ) : null}
          {count.actions.cancel ? (
            <Button type="button" variant="ghost" onClick={() => setDialog('cancel')}>
              Sayımı iptal et
            </Button>
          ) : null}
        </div>
      </section>
      {count.actions.count ? <ScanForm countId={count.id} /> : null}
      <Totals count={count} />
      {hasMovementsDuringCount(count) ? (
        <p role="note" className="rounded-lg border px-4 py-3 text-sm">
          Sayım sürerken depoda hareket yazıldı. Beklenen miktar, anlık görüntüye kart sayılana
          kadar yazılan hareketler eklenerek bulunur; kart sayıldıktan sonraki hareketler farka
          girmez.
        </p>
      ) : null}
      <section aria-labelledby="sayilan-kalemler" className="grid gap-2">
        <h3 id="sayilan-kalemler" className="text-base font-semibold">
          Sayılan ürünler
        </h3>
        {count.counted.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz ürün sayılmadı.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table aria-label="Sayılan ürünler">
              <TableHeader>
                <TableRow>
                  <TableHead>Ürün</TableHead>
                  <TableHead className={num}>Sistem</TableHead>
                  <TableHead className={num}>Sayım sırasında hareket</TableHead>
                  <TableHead className={num}>Beklenen</TableHead>
                  <TableHead className={num}>Sayılan</TableHead>
                  <TableHead className={num}>Fark</TableHead>
                  <TableHead className={num}>Fark tutarı</TableHead>
                  {count.actions.count ? <TableHead>İşlemler</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {count.counted.map((row) => (
                  <TableRow key={row.itemId}>
                    <TableCell>
                      <span className="font-medium">{row.itemName}</span>
                      <span className="block text-xs text-muted-foreground">{row.itemCode}</span>
                    </TableCell>
                    <TableCell className={num}>
                      {`${String(row.systemQuantity)} ${unitOf(row.unit)}`}
                    </TableCell>
                    <TableCell className={num}>
                      {row.movementQuantity === 0 ? '—' : signedDifference(row.movementQuantity)}
                    </TableCell>
                    <TableCell className={num}>{String(row.expectedQuantity)}</TableCell>
                    <TableCell className={num}>{String(row.countedQuantity)}</TableCell>
                    <TableCell className={num}>
                      <StatusBadge
                        text={signedDifference(row.difference)}
                        tone={differenceTone(row.difference)}
                      />
                    </TableCell>
                    <TableCell className={num}>
                      {row.differenceCents === null
                        ? row.difference === 0
                          ? '—'
                          : 'Fiyat yok'
                        : money(row.differenceCents)}
                    </TableCell>
                    {count.actions.count ? (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`${row.itemName} sayılan miktarını düzelt`}
                          onClick={() => setEditing(row)}
                        >
                          Düzelt
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      <section aria-labelledby="sayilmayan-kalemler" className="grid gap-2">
        <h3 id="sayilmayan-kalemler" className="text-base font-semibold">
          Sayılmayan ürünler
        </h3>
        <p className="text-sm text-muted-foreground">
          Sayılmayan ürünün miktarı tamamlamada değişmez; sıfıra çekilmez.
        </p>
        {count.uncounted.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sayılmayan ürün yok.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Sayılmayan ürünler">
            {count.uncounted.map((row) => (
              <li
                key={row.itemId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{row.itemName}</span>
                  <span className="block text-muted-foreground">{`${row.itemCode} · sistemde ${String(row.systemQuantity)} ${unitOf(row.unit)}`}</span>
                </span>
                {count.actions.count ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`${row.itemName} miktarını gir`}
                    onClick={() => setEditing({ ...row, countedQuantity: null })}
                  >
                    Miktar gir
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing ? (
        <QuantityModal countId={count.id} target={editing} onClose={() => setEditing(null)} />
      ) : null}
      {dialog === 'complete' ? (
        <CompleteCountModal count={count} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'cancel' ? (
        <CancelCountModal count={count} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <Icon name="ArrowLeft" size={16} aria-hidden="true" />
        Sayımlara dön
      </Button>
    </div>
  )
}

function Totals({ count }: { count: StockCountDetail }) {
  const { totals } = count
  const items: [string, string][] = [
    ['Sayılan ürün', String(totals.countedItems)],
    ['Sayılmayan ürün', String(totals.uncountedItems)],
    ['Farklı ürün', String(totals.differenceItems)],
    ['Net fark tutarı', money(totals.netCents)],
  ]
  return (
    <section aria-label="Sayım özeti" className="grid gap-2">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-lg border px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-base font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {totals.unpricedDifferenceItems > 0 ? (
        <p className="text-sm text-muted-foreground">
          {`${String(totals.unpricedDifferenceItems)} farklı ürünün son alış fiyatı yok; tutara girmedi.`}
        </p>
      ) : null}
    </section>
  )
}

/**
 * Okutma formu (K-229): kod alanı açılışta ve her okutmadan sonra odaktadır. Gönderim sürerken
 * Enter yok sayılır ve yazılan kod alanda kalır; böylece hızlı okutmada kod kaybolmaz.
 */
function ScanForm({ countId }: { countId: string }) {
  const scan = useScanStockCount()
  const [last, setLast] = useState('')
  const form = useForm<ScanFormValues>({
    resolver: zodResolver(scanFormSchema),
    defaultValues: scanDefaults(),
  })
  const { errors } = form.formState
  const onSubmit = form.handleSubmit(async (values) => {
    if (scan.isPending) return
    form.setValue('code', '')
    const outcome = await scan.submit({ countId, ...scanBody(values) })
    if (outcome.status === 'success') {
      const line = outcome.data.data
      setLast(
        `${line.itemName} (${line.itemCode}): ${String(line.countedQuantity ?? 0)} ${STOCK_UNIT_LABELS[line.unit]} sayıldı.`,
      )
      form.setValue('quantity', '1')
    } else if (outcome.status === 'failed') setLast(outcome.error.message)
    form.setFocus('code')
  })
  return (
    <section aria-labelledby="sayim-okut" className="grid gap-2 rounded-lg border px-4 py-3">
      <h3 id="sayim-okut" className="text-base font-semibold">
        Ürün okut
      </h3>
      <form
        noValidate
        aria-label="Ürün okut"
        onSubmit={(event) => void onSubmit(event)}
        className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
      >
        <FormField
          id="sayim-kod"
          label="Kart kodu ya da barkod"
          error={errors.code}
          description="Barkod okuyucuyla okutun ya da kodu yazıp Enter'a basın."
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('code')}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </FormField>
        <FormField id="sayim-adet" label="Eklenecek miktar" error={errors.quantity}>
          {(control) => <Input {...control} {...form.register('quantity')} inputMode="numeric" />}
        </FormField>
        <Button type="submit" aria-busy={scan.isPending || undefined}>
          Ekle
        </Button>
      </form>
      <p role="status" aria-live="polite" className="min-h-6 text-sm">
        {last}
      </p>
    </section>
  )
}

function QuantityModal({
  countId,
  target,
  onClose,
}: {
  countId: string
  target: QuantityTarget
  onClose: () => void
}) {
  const setQuantity = useSetStockCountQuantity()
  const form = useForm<QuantityFormValues>({
    resolver: zodResolver(quantityFormSchema),
    defaultValues: quantityDefaults(target.countedQuantity),
  })
  const busy = setQuantity.isPending || form.formState.isSubmitting
  const { errors } = form.formState
  const write = async (countedQuantity: number | null) => {
    const outcome = await setQuantity.submit(
      { countId, itemId: target.itemId, countedQuantity },
      {
        setError: (name: string, error: { type: string; message: string }) =>
          name === 'countedQuantity'
            ? form.setError('countedQuantity', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success(
        countedQuantity === null
          ? `${target.itemName} sayılmadı olarak işaretlendi.`
          : `${target.itemName}: ${String(countedQuantity)} ${STOCK_UNIT_LABELS[target.unit]} yazıldı.`,
      )
      onClose()
    }
  }
  const onSubmit = form.handleSubmit((values) => write(Number(values.countedQuantity.trim())))
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Sayılan miktar"
      description={target.itemName}
      footer={
        <>
          {target.countedQuantity !== null ? (
            <Button
              variant="ghost"
              onClick={() => void write(null)}
              disabled={busy}
              className="mr-auto"
            >
              Sayılmadı yap
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={QUANTITY_FORM} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={QUANTITY_FORM}
        noValidate
        aria-label="Sayılan miktar"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <FormField
          id="sayim-miktar"
          label={`Sayılan miktar (${STOCK_UNIT_LABELS[target.unit]})`}
          error={errors.countedQuantity}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('countedQuantity')}
              inputMode="numeric"
              disabled={busy}
            />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

function CompleteCountModal({ count, onClose }: { count: StockCountDetail; onClose: () => void }) {
  const complete = useCompleteStockCount()
  const busy = complete.isPending
  const onConfirm = async () => {
    const outcome = await complete.submit({ countId: count.id, version: count.version })
    if (outcome.status === 'success') {
      notify.success('Sayım tamamlandı; farklar stoka yazıldı.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Sayımı tamamla"
      description={`${count.warehouseName} · ${timeText(count.startedAt)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void onConfirm()} disabled={busy} aria-busy={busy || undefined}>
            Tamamla
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-sm">
        <p>{completionSummary(count)}</p>
        <p>
          Düzeltmeler bugünün tarihiyle yazılır ve iptal edilmez; tamamlanan sayım değiştirilemez.
        </p>
      </div>
    </Modal>
  )
}

function CancelCountModal({ count, onClose }: { count: StockCountDetail; onClose: () => void }) {
  const cancel = useCancelStockCount()
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { countId: count.id, version: count.version, reason: values.reason.trim() },
      {
        setError: (name: string, error: { type: string; message: string }) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Sayım iptal edildi; stok değişmedi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Sayımı iptal et"
      description={`${count.warehouseName} · ${timeText(count.startedAt)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={CANCEL_FORM} disabled={busy} aria-busy={busy || undefined}>
            İptal et
          </Button>
        </>
      }
    >
      <form
        id={CANCEL_FORM}
        noValidate
        aria-label="Sayımı iptal et"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <p className="text-sm">İptal edilen sayım stok hareketi yazmaz.</p>
        <FormField
          id="stok-sayim-iptal-gerekce"
          label="İptal gerekçesi"
          error={form.formState.errors.reason}
        >
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}
