import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useFixedAssetCounts,
  useFixedAssetPlaces,
  useStartFixedAssetCount,
} from '@kampus/react-shared/use-finance-fixed-asset-counts.ts'
import {
  FIXED_ASSET_COUNT_SCOPE_TYPE_LABELS,
  FIXED_ASSET_COUNT_SCOPE_TYPES,
  FIXED_ASSET_COUNT_STATUS_LABELS,
  FIXED_ASSET_COUNT_STATUSES,
  fixedAssetCountScopeLabel,
  type FixedAssetCountStatus,
} from '@kampus/school-core/lib/finance-fixed-asset-counts.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { FixedAssetCountDetail } from './FinanceFixedAssetCountDetail.tsx'
import {
  COUNT_FORM_DEFAULTS,
  COUNT_STATUS_TONES,
  countBody,
  countFormSchema,
  type CountFormValues,
} from './finance-fixed-asset-count-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['scope', 'status', 'progress']
const PLACE_PAGE = { page: 1, pageSize: 100 } as const
const STATUS_OPTIONS = FIXED_ASSET_COUNT_STATUSES.map((value) => ({
  value,
  label: FIXED_ASSET_COUNT_STATUS_LABELS[value],
}))
const isStatus = (value: unknown): value is FixedAssetCountStatus =>
  FIXED_ASSET_COUNT_STATUSES.some((status) => status === value)
const when = (iso: string | null) =>
  iso === null ? '—' : `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

type Row = {
  id: string
  scope: string
  startedAt: string
  status: FixedAssetCountStatus
  progress: string
  misplaced: number
  missing: string
}

/**
 * Demirbaş sayımları (DOM-FIN-087; ON-237). Yönetici kapsam seçip sayım başlatır; ayrıntı panelinde
 * (`?sayim=`) karekod okuyucu ya da klavyeyle kod okutur (Enter işaretler), sayımı tamamlar ya da
 * iptal eder, sonuç raporunu CSV ve PDF olarak alır ve yanlış konumdaki demirbaşın kaydını tek
 * tıkla düzeltir (K-235). Tamamlama demirbaş kaydını değiştirmez.
 */
export function FinanceFixedAssetCountsSection() {
  const list = useListState('demirbas-sayimlari', { urlPrefix: 'sayim_' })
  const status = list.state.filters.status
  const counts = useFixedAssetCounts({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(isStatus(status) ? { status } : {}),
  })
  const panel = useDetailPanel('sayim')
  const openCount = panel.open
  const [starting, setStarting] = useState(false)
  const filters = useMemo(
    () => [{ key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS }],
    [],
  )
  const rows = useMemo(
    () =>
      counts.data?.data.map((count): Row => ({
        id: count.id,
        scope: fixedAssetCountScopeLabel(count),
        startedAt: when(count.startedAt),
        status: count.status,
        progress: `${String(count.summary.expected - count.summary.pending)} / ${String(count.summary.expected)}`,
        misplaced: count.summary.misplaced,
        missing:
          count.status === 'completed'
            ? String(count.summary.pending)
            : `${String(count.summary.pending)} (okunmadı)`,
      })),
    [counts.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'scope', label: 'Kapsam' },
      { key: 'startedAt', label: 'Başlangıç' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={FIXED_ASSET_COUNT_STATUS_LABELS[row.status]}
            tone={COUNT_STATUS_TONES[row.status]}
          />
        ),
      },
      { key: 'progress', label: 'Okunan / beklenen' },
      { key: 'misplaced', label: 'Yanlış konumda' },
      { key: 'missing', label: 'Bulunamadı' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.scope} sayımını aç`}
            onClick={() => openCount(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [openCount],
  )

  return (
    <section
      aria-labelledby="demirbas-sayimlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="demirbas-sayimlari" className="text-lg font-semibold">
            Demirbaş sayımları
          </h2>
          <p className="text-sm text-muted-foreground">
            Karekodlu etiketleri okutarak sayın; tamamlama demirbaş kayıtlarını kendiliğinden
            değiştirmez.
          </p>
        </div>
        <Button onClick={() => setStarting(true)}>Yeni sayım</Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={counts.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        search={false}
        mobileColumns={MOBILE}
        caption="Demirbaş sayımları"
        empty="Henüz sayım yok."
        emptyFiltered="Bu durumda sayım yok."
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
            openCount(id)
          }}
        />
      ) : null}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Demirbaş sayımı"
      >
        {panel.selectedId ? <FixedAssetCountDetail countId={panel.selectedId} /> : null}
      </SidePanel>
    </section>
  )
}

const START_FORM_ID = 'demirbas-sayim-baslat'

function StartCountModal({
  onClose,
  onStarted,
}: {
  onClose: () => void
  onStarted: (id: string) => void
}) {
  const start = useStartFixedAssetCount()
  const branches = useCoreAll('branches')
  const form = useForm<CountFormValues>({
    resolver: zodResolver(countFormSchema),
    defaultValues: COUNT_FORM_DEFAULTS,
  })
  const scopeType = useWatch({ control: form.control, name: 'scopeType' })
  const campusId = useWatch({ control: form.control, name: 'campusId' })
  const places = useFixedAssetPlaces(
    { ...PLACE_PAGE, ...(campusId ? { campusId } : {}) },
    scopeType === 'location',
  )
  const errors = form.formState.errors
  const busy = start.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await start.submit(countBody(values), {
      setError: (name, error) => {
        if (name === 'campusId' || name === 'location' || name === 'note')
          form.setError(name, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      const summary = outcome.data.data.summary
      notify.success(`Sayım başladı: ${String(summary.expected)} demirbaş bekleniyor.`)
      onStarted(outcome.data.data.id)
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Yeni sayım"
      description="Başlarken kapsamdaki hurdaya ayrılmamış demirbaşlar beklenen liste olarak dondurulur."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={START_FORM_ID} disabled={busy} aria-busy={busy || undefined}>
            Sayımı başlat
          </Button>
        </>
      }
    >
      <form
        id={START_FORM_ID}
        noValidate
        aria-label="Yeni sayım"
        className="grid gap-4"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="sayim-kapsam" label="Kapsam" error={errors.scopeType}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('scopeType')}
              className="w-full"
              disabled={busy}
            >
              {FIXED_ASSET_COUNT_SCOPE_TYPES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {FIXED_ASSET_COUNT_SCOPE_TYPE_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {scopeType === 'institution' ? null : (
          <FormField
            id="sayim-kampus"
            label={scopeType === 'campus' ? 'Kampüs' : 'Kampüs (isteğe bağlı)'}
            error={errors.campusId}
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('campusId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">
                  {scopeType === 'campus' ? 'Kampüs seçin' : 'Kampüs seçilmedi'}
                </NativeSelectOption>
                {(branches.data ?? []).map((item) => (
                  <NativeSelectOption key={item.record.id} value={item.record.id}>
                    {item.record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
        {scopeType === 'location' ? (
          <FormField
            id="sayim-oda"
            label="Oda / konum"
            error={errors.location}
            description="Demirbaş kayıtlarındaki konumla harf ve boşluk farkı gözetmeden eşleşir."
          >
            {(control) => (
              <>
                <Input
                  {...control}
                  {...form.register('location')}
                  list="sayim-oda-onerileri"
                  autoComplete="off"
                  disabled={busy}
                />
                <datalist id="sayim-oda-onerileri">
                  {(places.data?.data ?? []).map((place) => (
                    <option
                      key={`${place.campusId ?? '-'}:${place.location}`}
                      value={place.location}
                    >
                      {`${place.campusName ?? 'Kampüssüz'} · ${String(place.assetCount)} demirbaş`}
                    </option>
                  ))}
                </datalist>
              </>
            )}
          </FormField>
        ) : null}
        <FormField id="sayim-not" label="Açıklama (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Input {...control} {...form.register('note')} autoComplete="off" disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}
