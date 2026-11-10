import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import {
  useCancelFixedAssetCount,
  useCompleteFixedAssetCount,
  useFixedAssetCount,
  useFixedAssetCountItems,
  useFixedAssetPlaces,
  useRelocateFixedAssetCountItem,
  useScanFixedAssetCount,
  type FixedAssetCount,
  type FixedAssetCountItem,
  type FixedAssetScan,
} from '@kampus/react-shared/use-finance-fixed-asset-counts.ts'
import {
  FIXED_ASSET_COUNT_OUTCOME_LABELS,
  FIXED_ASSET_COUNT_STATUS_LABELS,
  fixedAssetCountCsv,
  fixedAssetCountScopeLabel,
  type FixedAssetCountItemResult,
} from '@kampus/school-core/lib/finance-fixed-asset-counts.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Pagination } from '@/components/Pagination.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import {
  loadFixedAssetCountReport,
  useFixedAssetCountPdf,
} from '@/hooks/use-finance-fixed-asset-count-pdf.ts'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { FIXED_ASSET_COUNT_TITLE } from '@/lib/pdf/templates/finance-fixed-asset-count.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import {
  COUNT_OUTCOME_TONES,
  COUNT_STATUS_TONES,
  itemFilterOptions,
  itemOutcome,
  scanBody,
  scanFeedback,
  scanFormField,
  scanFormSchema,
  type ScanFormValues,
} from './finance-fixed-asset-count-forms.ts'

const PLACE_PAGE = { page: 1, pageSize: 100 } as const
const ITEM_PAGE_SIZE = 50
const ITEM_PAGE_SIZES = [25, 50, 100] as const
const RECENT_LIMIT = 8
const when = (iso: string | null) =>
  iso === null ? '—' : `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`
const placeText = (campusName: string | null, location: string | null) =>
  location === null ? '—' : campusName ? `${campusName} · ${location}` : location

/**
 * Sayım ayrıntısı (DOM-FIN-087; ON-237): özet, açık sayımda etiket okutma, tamamlama ve iptal,
 * tutanak PDF'i ve CSV, sonuç satırları ve yanlış konumdaki demirbaş için konum düzeltmesi (K-235).
 */
export function FixedAssetCountDetail({ countId }: { countId: string }) {
  const item = useFixedAssetCount(countId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const count = item.data?.data
  if (!count) return <SummaryLoading />
  return (
    <div className="grid gap-6">
      <section aria-labelledby="sayim-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="sayim-bilgileri" className="text-base font-semibold [overflow-wrap:anywhere]">
            {fixedAssetCountScopeLabel(count)}
          </h3>
          <StatusBadge
            text={FIXED_ASSET_COUNT_STATUS_LABELS[count.status]}
            tone={COUNT_STATUS_TONES[count.status]}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Başlangıç {when(count.startedAt)}
          {count.completedAt ? ` · tamamlandı ${when(count.completedAt)}` : ''}
          {count.cancelledAt ? ` · iptal edildi ${when(count.cancelledAt)}` : ''}
          {count.note ? ` · ${count.note}` : ''}
        </p>
        <CountSummary count={count} />
      </section>
      {count.status === 'open' ? <ScanForm count={count} /> : null}
      {count.status === 'open' ? <CloseActions count={count} /> : null}
      <ReportActions count={count} />
      <CountItems count={count} />
    </div>
  )
}

function CountSummary({ count }: { count: FixedAssetCount }) {
  const { summary } = count
  const pairs: [string, number][] = [
    ['Beklenen', summary.expected],
    ['Bulundu', summary.found],
    ['Yanlış konumda', summary.misplaced],
    [count.status === 'completed' ? 'Bulunamadı' : 'Okunmadı', summary.pending],
    ['Listede yoktu', summary.extra],
  ]
  return (
    <dl aria-label="Sayım özeti" className="grid grid-cols-5 gap-2 text-sm max-[480px]:grid-cols-2">
      {pairs.map(([label, value]) => (
        <div key={label} className="grid gap-1 rounded-sm border px-3 py-2">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Okutma formu (K-233). Karekod okuyucu klavye gibi yazar ve Enter gönderir; kod alanı her
 * okutmadan sonra boşalır ve odakta kalır. Kurum ve kampüs sayımında sayılan oda formda kalır.
 */
function ScanForm({ count }: { count: FixedAssetCount }) {
  const scan = useScanFixedAssetCount()
  const branches = useCoreAll('branches')
  const schema = useMemo(() => scanFormSchema(count.scopeType), [count.scopeType])
  const form = useForm<ScanFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', campusId: count.campusId ?? '', location: '' },
  })
  const campusId = useWatch({ control: form.control, name: 'campusId' })
  const places = useFixedAssetPlaces(
    { ...PLACE_PAGE, ...(campusId ? { campusId } : {}) },
    count.scopeType !== 'location',
  )
  const [recent, setRecent] = useState<FixedAssetScan[]>([])
  const errors = form.formState.errors
  const busy = scan.isPending
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await scan.submit(
      { countId: count.id, body: scanBody(count.scopeType, values) },
      {
        setError: (name, error) => form.setError(scanFormField(name), error),
      },
    )
    if (outcome.status === 'success') {
      setRecent((previous) => [outcome.data.data, ...previous].slice(0, RECENT_LIMIT))
      form.setValue('code', '')
    }
    // Okuyucu bir sonraki kodu yine bu alana yazar; hata olsa da kod seçili kalır.
    form.setFocus('code', { shouldSelect: true })
  })
  const [latest] = recent
  const feedback = latest ? scanFeedback(latest) : null
  return (
    <section aria-labelledby="sayim-okut" className="grid gap-3 border-t pt-4">
      <h3 id="sayim-okut" className="text-base font-semibold">
        Etiket okut
      </h3>
      <form
        noValidate
        aria-label="Etiket okutma"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        {count.scopeType === 'institution' ? (
          <FormField id="okut-kampus" label="Sayılan kampüs (isteğe bağlı)" error={errors.campusId}>
            {(control) => (
              <NativeSelect {...control} {...form.register('campusId')} className="w-full">
                <NativeSelectOption value="">Kampüs seçilmedi</NativeSelectOption>
                {(branches.data ?? []).map((item) => (
                  <NativeSelectOption key={item.record.id} value={item.record.id}>
                    {item.record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        {count.scopeType === 'location' ? (
          <p className="text-sm text-muted-foreground">
            Sayılan yer: {placeText(count.campusName, count.location)}
          </p>
        ) : (
          <FormField
            id="okut-oda"
            label="Sayılan oda / konum"
            error={errors.location}
            description="Odayı değiştirince yeni odayı yazın; okutulan demirbaş bu yerle karşılaştırılır."
          >
            {(control) => (
              <>
                <Input
                  {...control}
                  {...form.register('location')}
                  list="okut-oda-onerileri"
                  autoComplete="off"
                />
                <datalist id="okut-oda-onerileri">
                  {(places.data?.data ?? []).map((place) => (
                    <option
                      key={`${place.campusId ?? '-'}:${place.location}`}
                      value={place.location}
                    >
                      {place.campusName ?? 'Kampüssüz'}
                    </option>
                  ))}
                </datalist>
              </>
            )}
          </FormField>
        )}
        <FormField
          id="okut-kod"
          label="Demirbaş kodu"
          error={errors.code}
          description="Karekodu okutun ya da etiket numarasını yazıp Enter'a basın."
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('code')}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-busy={busy || undefined}
            />
          )}
        </FormField>
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            İşaretle
          </Button>
        </div>
      </form>
      <p role="status" aria-live="polite" className="text-sm empty:hidden">
        {feedback ? (
          <StatusBadge text={feedback.text} tone={feedback.tone} className="whitespace-normal" />
        ) : null}
      </p>
      {recent.length > 1 ? (
        <div className="grid gap-1">
          <h4 className="text-sm font-semibold">Son okutmalar</h4>
          <ul aria-label="Son okutmalar" className="grid gap-1 text-sm">
            {recent.slice(1).map((entry) => (
              <li key={`${entry.item.id}-${entry.outcome}`} className="[overflow-wrap:anywhere]">
                {scanFeedback(entry).text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

/** Tamamlama ve iptal: ikisi de onay ister; tamamlama okunmayanları "bulunamadı" sayar. */
function CloseActions({ count }: { count: FixedAssetCount }) {
  const complete = useCompleteFixedAssetCount()
  const cancel = useCancelFixedAssetCount()
  const [asking, setAsking] = useState<'complete' | 'cancel' | null>(null)
  const busy = complete.isPending || cancel.isPending
  const run = async (verb: 'complete' | 'cancel') => {
    const command = verb === 'complete' ? complete : cancel
    const outcome = await command.submit({ countId: count.id, version: count.version })
    setAsking(null)
    if (outcome.status === 'success')
      notify.success(verb === 'complete' ? 'Sayım tamamlandı.' : 'Sayım iptal edildi.')
  }
  if (asking !== null)
    return (
      <section
        aria-label={asking === 'complete' ? 'Tamamlama onayı' : 'İptal onayı'}
        className="grid gap-3 rounded-sm border px-4 py-3"
      >
        <p className="text-sm">
          {asking === 'complete'
            ? `Okunmayan ${String(count.summary.pending)} demirbaş bulunamadı olarak raporlanacak. Demirbaş kayıtları değişmez, hurdaya ayrılmaz. Sayım yeniden açılamaz.`
            : 'Okutmalar saklanır, sayım iptal görünür ve yeniden açılamaz. Aynı kapsamda yeni sayım başlatabilirsiniz.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={asking === 'complete' ? 'default' : 'destructive'}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void run(asking)}
          >
            {asking === 'complete' ? 'Evet, tamamla' : 'Evet, iptal et'}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setAsking(null)}>
            Vazgeç
          </Button>
        </div>
      </section>
    )
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={() => setAsking('complete')}>
        Sayımı tamamla
      </Button>
      <Button type="button" variant="secondary" onClick={() => setAsking('cancel')}>
        Sayımı iptal et
      </Button>
    </div>
  )
}

function ReportActions({ count }: { count: FixedAssetCount }) {
  const client = useKampusClient()
  const [exporting, setExporting] = useState(false)
  const exportCsv = async () => {
    setExporting(true)
    try {
      const report = await loadFixedAssetCountReport(client, count.id)
      const csv = fixedAssetCountCsv(report.count.status, report.items)
      saveBlob(
        new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }),
        `demirbas-sayimi-${count.startedAt.slice(0, 10)}-${count.status}.csv`,
      )
      notify.success('Sayım sonucu indirildi.')
    } catch (error) {
      notify.error('Sayım sonucu indirilemedi. Yeniden deneyin.', error)
    } finally {
      setExporting(false)
    }
  }
  return (
    <div className="flex flex-wrap gap-2 border-t pt-4">
      <PdfDialogButton
        label="Sayım tutanağı PDF"
        title={FIXED_ASSET_COUNT_TITLE}
        id={count.id}
        usePdf={useFixedAssetCountPdf}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={exporting}
        aria-busy={exporting || undefined}
        onClick={() => void exportCsv()}
      >
        Sonucu CSV indir
      </Button>
    </div>
  )
}

const isResult = (value: string): value is FixedAssetCountItemResult =>
  value === 'pending' || value === 'found' || value === 'misplaced'

/** Sonuç raporu satırları: sonuca göre süzülür, 50'şer sayfalanır, etiket sırasıyla. */
function CountItems({ count }: { count: FixedAssetCount }) {
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(ITEM_PAGE_SIZE)
  const items = useFixedAssetCountItems(count.id, {
    page,
    pageSize,
    ...(isResult(filter) ? { result: filter } : {}),
  })
  const total = items.data?.meta.total ?? 0
  return (
    <section aria-labelledby="sayim-satirlari" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 id="sayim-satirlari" className="text-base font-semibold">
          Sonuç
        </h3>
        <label className="grid gap-1 text-sm" htmlFor="sayim-sonuc-suzgeci">
          Sonuç süzgeci
          <NativeSelect
            id="sayim-sonuc-suzgeci"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value)
              setPage(1)
            }}
          >
            {itemFilterOptions(count.status).map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      {items.error ? (
        <QueryError error={items.error} onRetry={() => void items.refetch()} />
      ) : !items.data ? (
        <SummaryLoading />
      ) : items.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu süzgeçle satır yok.</p>
      ) : (
        <ul aria-label="Sayım satırları" className="grid gap-2 text-sm">
          {items.data.data.map((item) => (
            <CountItemRow key={item.id} count={count} item={item} />
          ))}
        </ul>
      )}
      {total > ITEM_PAGE_SIZES[0] ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          sizes={ITEM_PAGE_SIZES}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
        />
      ) : null}
    </section>
  )
}

function CountItemRow({ count, item }: { count: FixedAssetCount; item: FixedAssetCountItem }) {
  const outcome = itemOutcome(item, count)
  return (
    <li className="grid gap-1 rounded-sm border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium [overflow-wrap:anywhere]">
          {item.tagNumber} · {item.assetName}
        </span>
        <StatusBadge
          text={FIXED_ASSET_COUNT_OUTCOME_LABELS[outcome]}
          tone={COUNT_OUTCOME_TONES[outcome]}
        />
        {item.inScope ? null : <StatusBadge text="Listede yoktu" tone="gray" />}
      </div>
      <span className="text-muted-foreground [overflow-wrap:anywhere]">
        Kayıtlı yer: {placeText(item.recordedCampusName, item.recordedLocation)}
        {item.observedLocation === null
          ? ''
          : ` · sayılan yer: ${placeText(item.observedCampusName, item.observedLocation)}`}
      </span>
      {item.result === 'misplaced' && count.status === 'completed' ? (
        <RelocateAction count={count} item={item} />
      ) : null}
    </li>
  )
}

/** Konum düzeltmesi önerisi (K-235): demirbaş kaydı yalnız bu onayla sayılan yere taşınır. */
function RelocateAction({ count, item }: { count: FixedAssetCount; item: FixedAssetCountItem }) {
  const relocate = useRelocateFixedAssetCountItem()
  if (item.relocatedAt !== null)
    return <span className="text-muted-foreground">Kayıt sayılan yere taşındı.</span>
  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={relocate.isPending}
        aria-busy={relocate.isPending || undefined}
        aria-label={`${item.tagNumber} konumunu sayılan yere düzelt`}
        onClick={() =>
          void relocate
            .submit({ countId: count.id, itemId: item.id, version: item.version })
            .then((outcome) => {
              if (outcome.status === 'success')
                notify.success(`${item.tagNumber} kaydı sayılan yere taşındı.`)
            })
        }
      >
        Konumu düzelt
      </Button>
    </div>
  )
}
