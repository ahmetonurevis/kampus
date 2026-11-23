import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import {
  useMaintenanceRequests,
  useReportMaintenance,
} from '@kampus/react-shared/use-finance-maintenance-requests.ts'
import {
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_STATES,
  MAINTENANCE_STATUSES,
  MAINTENANCE_STATUS_LABELS,
  type MaintenancePriority,
  type MaintenanceState,
  type MaintenanceStatus,
} from '@kampus/school-core/lib/finance-maintenance-requests.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { MaintenanceDetailView } from './FinanceMaintenanceDetail.tsx'
import {
  assigneeText,
  MAINTENANCE_PRIORITY_VIEW,
  MAINTENANCE_STATUS_VIEW,
  reportBody,
  reportDefaults,
  reportFormField,
  reportFormSchema,
  type ReportFormValues,
} from './finance-maintenance-forms.ts'

/** Ayrıntı paneli adres parametresi (`?ariza=`); demirbaş ayrıntısı da buna bağlanır. */
export const MAINTENANCE_PANEL = 'ariza'

const NO_SORT: readonly string[] = []
const MOBILE = ['number', 'title', 'status']
const STATE_LABELS: Record<MaintenanceState, string> = {
  active: 'Sürenler (kapatılmamış)',
  done: 'Kapatılan ve iptal edilen',
}
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is MaintenanceStatus =>
  MAINTENANCE_STATUSES.some((status) => status === value)
const isState = (value: string | null): value is MaintenanceState =>
  MAINTENANCE_STATES.some((state) => state === value)
const isPriority = (value: string | null): value is MaintenancePriority =>
  MAINTENANCE_PRIORITIES.some((priority) => priority === value)

type Row = {
  id: string
  number: string
  title: string
  place: string
  asset: string
  priority: MaintenancePriority
  status: MaintenanceStatus
  assignee: string
  reportedAt: string
}

/**
 * Arıza ve bakım (`?gorunum=ariza`; DOM-FIN-089, ON-239). Yönetici ve ön büro arıza bildirir ve
 * listeyi görür (K-236, K-238); ayrıntı panelinde (`?ariza=`) iş emri geçmişi, yöneticiye atama,
 * başlatma, çözüm ve kapatma, bildirene kendi atanmamış talebinin iptali ve iş emri PDF'i. Liste
 * başlık, yer, etiket ve numarada aranır; durum, dönem ve öncelik süzgeçlidir, sunucu sayfalıdır.
 */
export function FinanceMaintenanceSection() {
  const list = useListState('ariza-talepleri', { urlPrefix: 'ariza_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const state = text(list.state.filters.state)
  const priority = text(list.state.filters.priority)
  const requests = useMaintenanceRequests({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(isState(state) ? { state } : {}),
    ...(isPriority(priority) ? { priority } : {}),
  })
  const panel = useDetailPanel(MAINTENANCE_PANEL)
  const openRequest = panel.open
  const [reporting, setReporting] = useState(false)

  const filters = useMemo(
    () => [
      {
        key: 'state',
        label: 'Dönem',
        type: 'select' as const,
        options: MAINTENANCE_STATES.map((value) => ({ value, label: STATE_LABELS[value] })),
      },
      {
        key: 'status',
        label: 'Durum',
        type: 'select' as const,
        options: MAINTENANCE_STATUSES.map((value) => ({
          value,
          label: MAINTENANCE_STATUS_LABELS[value],
        })),
      },
      {
        key: 'priority',
        label: 'Öncelik',
        type: 'select' as const,
        options: MAINTENANCE_PRIORITIES.map((value) => ({
          value,
          label: MAINTENANCE_PRIORITY_LABELS[value],
        })),
      },
    ],
    [],
  )
  const rows = useMemo(
    () =>
      requests.data?.data.map((item): Row => ({
        id: item.id,
        number: item.number,
        title: item.title,
        place: item.campusName ? `${item.campusName} · ${item.location}` : item.location,
        asset: item.asset ? `${item.asset.tagNumber} · ${item.asset.name}` : '—',
        priority: item.priority,
        status: item.status,
        assignee: assigneeText(item.assignee),
        reportedAt: dateLabel(item.reportedAt, { year: 'numeric' }),
      })),
    [requests.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'number', label: 'No' },
      { key: 'title', label: 'Arıza' },
      { key: 'place', label: 'Yer' },
      { key: 'asset', label: 'Demirbaş' },
      {
        key: 'priority',
        label: 'Öncelik',
        cell: (row) => (
          <StatusBadge
            text={MAINTENANCE_PRIORITY_VIEW[row.priority].label}
            tone={MAINTENANCE_PRIORITY_VIEW[row.priority].tone}
          />
        ),
      },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={MAINTENANCE_STATUS_VIEW[row.status].label}
            tone={MAINTENANCE_STATUS_VIEW[row.status].tone}
          />
        ),
      },
      { key: 'assignee', label: 'Sorumlu' },
      { key: 'reportedAt', label: 'Bildirim' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.number} ayrıntısını aç`}
            onClick={() => openRequest(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openRequest],
  )

  return (
    <section
      aria-labelledby="ariza-talepleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="ariza-talepleri" className="text-lg font-semibold">
            Arıza ve bakım
          </h2>
          <p className="text-sm text-muted-foreground">
            Bildirilen arızalar ve iş emirleri; acil ve süren talepler önce gelir.
          </p>
        </div>
        <Button onClick={() => setReporting(true)}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Arıza bildir
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
        caption="Arıza ve bakım talepleri"
        empty="Henüz arıza bildirilmedi."
        emptyFiltered="Bu seçimle eşleşen talep yok."
        loading={requests.isPending}
        fetching={requests.isFetching && !requests.isPending}
        error={
          requests.error ? (
            <QueryError error={requests.error} onRetry={() => void requests.refetch()} />
          ) : undefined
        }
      />
      {reporting ? (
        <MaintenanceReportModal
          onClose={() => setReporting(false)}
          onSaved={(id) => {
            setReporting(false)
            openRequest(id)
          }}
        />
      ) : null}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Arıza talebi"
      >
        {panel.selectedId ? <MaintenanceDetailView requestId={panel.selectedId} /> : null}
      </SidePanel>
    </section>
  )
}

const FORM_ID = 'ariza-bildir'

/**
 * Arıza bildirimi (K-236): başlık, açıklama, kampüs, yer, isteğe bağlı demirbaş etiketi (etiketin
 * üzerindeki numara) ve öncelik. Demirbaş ayrıntısından açılınca etiket ve yer önerilir.
 */
export function MaintenanceReportModal({
  asset,
  onClose,
  onSaved,
}: {
  asset?: { tagNumber: string; campusId: string | null; location: string } | undefined
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const reportRequest = useReportMaintenance()
  const branches = useCoreAll('branches')
  const form = useForm<ReportFormValues>({
    resolver: zodResolver(reportFormSchema),
    defaultValues: reportDefaults(asset),
  })
  const errors = form.formState.errors
  const busy = reportRequest.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await reportRequest.submit(reportBody(values), {
      setError: (name, error) => {
        const field = reportFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.number} numaralı arıza bildirildi.`)
      onSaved(outcome.data.data.id)
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Arıza bildir"
      description="Yönetici talebi bir personele ya da tedarikçiye atar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={FORM_ID} disabled={busy} aria-busy={busy || undefined}>
            Bildir
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        aria-label="Arıza bildir"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField
          id="ariza-baslik"
          label="Başlık"
          error={errors.title}
          description="Ör. Projektör açılmıyor."
        >
          {(control) => <Input {...control} {...form.register('title')} disabled={busy} />}
        </FormField>
        <FormField id="ariza-aciklama" label="Açıklama" error={errors.description}>
          {(control) => (
            <Textarea {...control} {...form.register('description')} rows={3} disabled={busy} />
          )}
        </FormField>
        <FormField id="ariza-kampus" label="Kampüs (isteğe bağlı)" error={errors.campusId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('campusId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Kampüs seçilmedi</NativeSelectOption>
              {(branches.data ?? []).map((item) => (
                <NativeSelectOption key={item.record.id} value={item.record.id}>
                  {item.record.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="ariza-yer"
          label="Oda ya da yer"
          error={errors.location}
          description="Ör. 2. kat 5-A sınıfı."
        >
          {(control) => <Input {...control} {...form.register('location')} disabled={busy} />}
        </FormField>
        <FormField
          id="ariza-etiket"
          label="Demirbaş etiketi (isteğe bağlı)"
          error={errors.assetTagNumber}
          description="Demirbaşın üzerindeki etiket numarası, ör. DB-2026-0001."
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('assetTagNumber')}
              autoCapitalize="characters"
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="ariza-oncelik" label="Öncelik" error={errors.priority}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('priority')}
              className="w-full"
              disabled={busy}
            >
              {MAINTENANCE_PRIORITIES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {MAINTENANCE_PRIORITY_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

const ASSET_HISTORY = { page: 1, pageSize: 20 } as const

/**
 * Demirbaş ayrıntısındaki arıza geçmişi (DOM-FIN-089, K-239): demirbaşa bağlı talepler, süren
 * önce; "Arıza bildir" etiketi ve yeri önerir. Talep satırı "Arıza ve bakım" görünümünde açılır.
 */
export function FixedAssetMaintenanceSection({
  asset,
}: {
  asset: {
    id: string
    tagNumber: string
    campusId: string | null
    location: string
    status: string
  }
}) {
  const history = useMaintenanceRequests({ assetId: asset.id, ...ASSET_HISTORY })
  const [reporting, setReporting] = useState(false)
  if (history.error)
    return <QueryError error={history.error} onRetry={() => void history.refetch()} />
  const items = history.data?.data
  if (!items) return null
  const total = history.data?.meta.total ?? items.length
  return (
    <section aria-labelledby="demirbas-ariza" className="grid gap-3 border-t pt-4">
      <h3 id="demirbas-ariza" className="text-base font-semibold">
        Arıza geçmişi
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu demirbaşa arıza bildirilmedi.</p>
      ) : (
        <ul aria-label="Arıza geçmişi" className="grid gap-2 text-sm">
          {items.map((item) => (
            <li key={item.id} className="grid gap-1 rounded-sm border px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className="font-medium underline-offset-4 hover:underline [overflow-wrap:anywhere]"
                  to={{ search: `?gorunum=ariza&${MAINTENANCE_PANEL}=${item.id}` }}
                >
                  {item.number} · {item.title}
                </Link>
                <StatusBadge
                  text={MAINTENANCE_STATUS_VIEW[item.status].label}
                  tone={MAINTENANCE_STATUS_VIEW[item.status].tone}
                />
              </div>
              <span className="text-muted-foreground">
                {dateLabel(item.reportedAt, { year: 'numeric' })} · {assigneeText(item.assignee)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {total > items.length ? (
        <p className="text-sm text-muted-foreground">
          Son {String(items.length)} talep gösteriliyor (toplam {String(total)}).
        </p>
      ) : null}
      {asset.status === 'scrapped' ? null : (
        <div>
          <Button type="button" variant="secondary" onClick={() => setReporting(true)}>
            Arıza bildir
          </Button>
        </div>
      )}
      {reporting ? (
        <MaintenanceReportModal
          asset={asset}
          onClose={() => setReporting(false)}
          onSaved={() => setReporting(false)}
        />
      ) : null}
    </section>
  )
}
