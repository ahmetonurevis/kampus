import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { useFixedAssetAssignees } from '@kampus/react-shared/use-finance-fixed-asset-assignments.ts'
import {
  useArchiveMaintenancePlan,
  useCancelMaintenanceInspection,
  useCreateMaintenancePlan,
  useMaintenancePlan,
  useMaintenancePlans,
  useMaintenancePlansExport,
  useOpenRequestFromInspection,
  useRecordMaintenanceInspection,
  useUpdateMaintenancePlan,
  type MaintenanceInspectionRow,
  type MaintenancePlanDetail,
} from '@kampus/react-shared/use-finance-maintenance-plans.ts'
import { useSuppliers } from '@kampus/react-shared/use-finance-procurement.ts'
import {
  canManageMaintenancePlans,
  MAINTENANCE_INSPECTION_RESULT_LABELS,
  MAINTENANCE_INSPECTION_RESULTS,
  MAINTENANCE_PLAN_DUE_FILTERS,
  MAINTENANCE_PLAN_DUE_STATUS_LABELS,
  MAINTENANCE_PLAN_RESPONSIBLE_TYPE_LABELS,
  MAINTENANCE_PLAN_TYPE_DEFAULTS,
  MAINTENANCE_PLAN_TYPE_LABELS,
  MAINTENANCE_PLAN_TYPES,
  type MaintenancePlanDueFilter,
  type MaintenancePlanType,
} from '@kampus/school-core/lib/finance-maintenance-plans.ts'
import { MAINTENANCE_STATUS_LABELS } from '@kampus/school-core/lib/finance-maintenance-requests.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
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
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { assigneeOptionLabel } from './finance-fixed-asset-assignment-forms.ts'
import {
  dueText,
  inspectionBody,
  inspectionCancelFormSchema,
  inspectionDefaults,
  inspectionFormField,
  inspectionFormSchema,
  MAINTENANCE_INSPECTION_RESULT_VIEW,
  MAINTENANCE_PLAN_DUE_VIEW,
  planBody,
  planChanges,
  planDefaults,
  planFormField,
  planFormSchema,
  responsibleText,
  suggestedFor,
  type InspectionCancelFormValues,
  type InspectionFormValues,
  type PlanFormValues,
} from './finance-maintenance-plan-forms.ts'

/** Ayrıntı paneli adres parametresi (`?bakim=`). */
export const MAINTENANCE_PLAN_PANEL = 'bakim'

const NO_SORT: readonly string[] = []
/** Pano kartı "Tümünü gör" bağlantısı durum süzgecini adresle verir (`?bakim_durum=attention`). */
const PLAN_URL_FILTERS = { due: 'durum' } as const
const MOBILE = ['name', 'nextDue', 'status']
const OPTION_PAGE = { page: 1, pageSize: 100 } as const
const BOM = '\uFEFF'
const DUE_FILTER_LABELS: Record<MaintenancePlanDueFilter, string> = {
  attention: 'Uyarıdakiler (geciken, yaklaşan, kaydı yok)',
  ...MAINTENANCE_PLAN_DUE_STATUS_LABELS,
}
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isDue = (value: string | null): value is MaintenancePlanDueFilter =>
  MAINTENANCE_PLAN_DUE_FILTERS.some((due) => due === value)
const isType = (value: string | null): value is MaintenancePlanType =>
  MAINTENANCE_PLAN_TYPES.some((type) => type === value)
const dayText = (day: string | null) =>
  day === null ? '—' : dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

type Row = {
  id: string
  name: string
  isLegal: boolean
  type: string
  place: string
  period: string
  lastDone: string
  nextDue: string
  status: MaintenancePlanDetail['dueStatus']
  due: string
  responsible: string
}

/**
 * Periyodik bakım (`?gorunum=bakim-plani`; DOM-FIN-092, ON-240). Yönetici ve ön büro planları,
 * sonraki denetim gününü ve durumunu görür (K-253); yönetici plan açar, düzeltir, arşivler,
 * denetim kaydeder ve uygunsuz denetimden arıza talebi açar (K-254, K-255). Liste ad, yer ve
 * etikette aranır; durum ve tür süzgeçlidir, sunucu sayfalıdır. CSV ekrandaki süzgeçle iner.
 */
export function FinanceMaintenancePlansSection({ role }: { role: string }) {
  const canManage = canManageMaintenancePlans(role)
  const list = useListState('bakim-planlari', {
    urlPrefix: 'bakim_',
    urlFilters: PLAN_URL_FILTERS,
  })
  const search = useDebouncedValue(list.state.query).trim()
  const due = text(list.state.filters.due)
  const type = text(list.state.filters.type)
  const filter = {
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isDue(due) ? { due } : {}),
    ...(isType(type) ? { type } : {}),
  }
  const plans = useMaintenancePlans({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...filter,
  })
  const exporter = useMaintenancePlansExport()
  const panel = useDetailPanel(MAINTENANCE_PLAN_PANEL)
  const openPlan = panel.open
  const [creating, setCreating] = useState(false)

  async function download() {
    const outcome = await exporter.submit(filter)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }), 'bakim-plani.csv')
    notify.success('Dosya indirildi.')
  }

  const filters = useMemo(
    () => [
      {
        key: 'due',
        label: 'Durum',
        type: 'select' as const,
        options: MAINTENANCE_PLAN_DUE_FILTERS.map((value) => ({
          value,
          label: DUE_FILTER_LABELS[value],
        })),
      },
      {
        key: 'type',
        label: 'Tür',
        type: 'select' as const,
        options: MAINTENANCE_PLAN_TYPES.map((value) => ({
          value,
          label: MAINTENANCE_PLAN_TYPE_LABELS[value],
        })),
      },
    ],
    [],
  )
  const rows = useMemo(
    () =>
      plans.data?.data.map((item): Row => ({
        id: item.id,
        name: item.name,
        isLegal: item.isLegal,
        type: MAINTENANCE_PLAN_TYPE_LABELS[item.type],
        place: item.campusName ? `${item.campusName} · ${item.location}` : item.location,
        period: `${String(item.periodMonths)} ay`,
        lastDone: dayText(item.lastDoneDate),
        nextDue: dayText(item.nextDueDate),
        status: item.dueStatus,
        due: dueText(item),
        responsible: responsibleText(item.responsible),
      })),
    [plans.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: 'name',
        label: 'Plan',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            {row.name}
            {row.isLegal ? <StatusBadge text="Yasal" tone="purple" /> : null}
          </span>
        ),
      },
      { key: 'type', label: 'Tür' },
      { key: 'place', label: 'Yer' },
      { key: 'period', label: 'Periyot' },
      { key: 'lastDone', label: 'Son denetim' },
      { key: 'nextDue', label: 'Sonraki denetim' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge
              text={MAINTENANCE_PLAN_DUE_VIEW[row.status].label}
              tone={MAINTENANCE_PLAN_DUE_VIEW[row.status].tone}
            />
            {row.status === 'never' ? null : (
              <span className="text-sm text-muted-foreground">{row.due}</span>
            )}
          </span>
        ),
      },
      { key: 'responsible', label: 'Sorumlu' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} ayrıntısını aç`}
            onClick={() => openPlan(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openPlan],
  )

  return (
    <section
      aria-labelledby="bakim-planlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="bakim-planlari" className="text-lg font-semibold">
            Periyodik bakım
          </h2>
          <p className="text-sm text-muted-foreground">
            Asansör, yangın söndürücü, jeneratör ve benzeri denetimler; geciken ve 30 gün içinde
            yaklaşanlar önce gelir.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void download()}
            disabled={exporter.isPending}
            aria-busy={exporter.isPending || undefined}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
          {canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Plan ekle
            </Button>
          ) : null}
        </div>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={plans.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={MOBILE}
        caption="Periyodik bakım planları"
        empty="Henüz bakım planı yok."
        emptyFiltered="Bu seçimle eşleşen plan yok."
        loading={plans.isPending}
        fetching={plans.isFetching && !plans.isPending}
        error={
          plans.error ? (
            <QueryError error={plans.error} onRetry={() => void plans.refetch()} />
          ) : undefined
        }
      />
      {creating ? (
        <PlanFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            openPlan(id)
          }}
        />
      ) : null}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Bakım planı"
      >
        {panel.selectedId ? (
          <PlanDetailView
            planId={panel.selectedId}
            canManage={canManage}
            onArchived={panel.close}
          />
        ) : null}
      </SidePanel>
    </section>
  )
}

const PLAN_FORM_ID = 'bakim-plani-formu'

/**
 * Plan formu (K-252): açılışta ve düzeltmede aynı alanlar. Tür değişince periyoda ve yasal işarete
 * dokunulmadıysa türün önerisi yazılır; öneri açıklaması formda görünür.
 */
function PlanFormModal({
  plan,
  onClose,
  onSaved,
}: {
  plan?: MaintenancePlanDetail
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const createPlan = useCreateMaintenancePlan()
  const updatePlan = useUpdateMaintenancePlan()
  const branches = useCoreAll('branches')
  const staff = useFixedAssetAssignees({ ...OPTION_PAGE, status: 'active' })
  const suppliers = useSuppliers({ ...OPTION_PAGE, status: 'active' })
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: planDefaults(plan),
  })
  const errors = form.formState.errors
  const busy = createPlan.isPending || updatePlan.isPending || form.formState.isSubmitting
  const type = useWatch({ control: form.control, name: 'type' })
  const responsibleType = useWatch({ control: form.control, name: 'responsibleType' })
  const setError = (name: string, error: { message: string }) => {
    const field = planFormField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (plan) {
      const changes = planChanges(values, plan)
      if (Object.keys(changes).length === 0) {
        form.setError('root.server', { message: 'Planda değişen bir alan yok.' })
        return
      }
      const outcome = await updatePlan.submit(
        { planId: plan.id, version: plan.version, body: changes },
        { setError },
      )
      if (outcome.status === 'success') {
        notify.success('Plan güncellendi.')
        onSaved(plan.id)
      }
      return
    }
    const outcome = await createPlan.submit(planBody(values), { setError })
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.name} planı açıldı.`)
      onSaved(outcome.data.data.id)
    }
  })
  const typeField = form.register('type')
  const title = plan ? 'Planı düzelt' : 'Bakım planı ekle'
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Sonraki denetim günü son denetimden periyotla hesaplanır."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={PLAN_FORM_ID} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={PLAN_FORM_ID}
        noValidate
        aria-label={title}
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="bakim-ad" label="Ad" error={errors.name} description="Ör. A blok asansörü.">
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
        <FormField
          id="bakim-tur"
          label="Tür"
          error={errors.type}
          description={MAINTENANCE_PLAN_TYPE_DEFAULTS[type].hint}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...typeField}
              onChange={(event) => {
                void typeField.onChange(event)
                const next = event.target.value as MaintenancePlanType
                const suggested = suggestedFor(next)
                if (!form.getFieldState('periodMonths').isDirty)
                  form.setValue('periodMonths', suggested.periodMonths)
                if (!form.getFieldState('isLegal').isDirty)
                  form.setValue('isLegal', suggested.isLegal)
              }}
              className="w-full"
              disabled={busy}
            >
              {MAINTENANCE_PLAN_TYPES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {MAINTENANCE_PLAN_TYPE_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="bakim-periyot"
          label="Periyot (ay)"
          error={errors.periodMonths}
          description="Önerilen periyot türden gelir; mevzuat ve bakım talimatına göre değiştirin."
        >
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              {...form.register('periodMonths')}
              disabled={busy}
            />
          )}
        </FormField>
        <Controller
          control={form.control}
          name="isLegal"
          render={({ field }) => (
            <div className="flex min-h-11 items-center gap-2">
              <Checkbox
                id="bakim-yasal"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                disabled={busy}
              />
              <Label htmlFor="bakim-yasal">Yasal zorunlu denetim</Label>
            </div>
          )}
        />
        <FormField id="bakim-kampus" label="Kampüs (isteğe bağlı)" error={errors.campusId}>
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
          id="bakim-yer"
          label="Yer"
          error={errors.location}
          description="Ör. Bodrum kat kazan dairesi."
        >
          {(control) => <Input {...control} {...form.register('location')} disabled={busy} />}
        </FormField>
        <FormField
          id="bakim-etiket"
          label="Demirbaş etiketi (isteğe bağlı)"
          error={errors.assetTagNumber}
          description="Donanım demirbaş olarak kayıtlıysa etiket numarası, ör. DB-2026-0001."
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
        <FormField
          id="bakim-son"
          label="Son denetim günü (isteğe bağlı)"
          error={errors.lastDoneDate}
          description="Sistemden önce yapılan son denetim; bilinmiyorsa boş bırakın."
        >
          {(control) => (
            <Input {...control} type="date" {...form.register('lastDoneDate')} disabled={busy} />
          )}
        </FormField>
        <FormField id="bakim-sorumlu-tur" label="Sorumlu" error={errors.responsibleType}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('responsibleType')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Sorumlu yok</NativeSelectOption>
              <NativeSelectOption value="staff">
                {MAINTENANCE_PLAN_RESPONSIBLE_TYPE_LABELS.staff}
              </NativeSelectOption>
              <NativeSelectOption value="supplier">
                {MAINTENANCE_PLAN_RESPONSIBLE_TYPE_LABELS.supplier}
              </NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
        {responsibleType === 'staff' ? (
          <FormField id="bakim-personel" label="Sorumlu personel" error={errors.membershipId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('membershipId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">
                  {staff.isPending ? 'Personel yükleniyor…' : 'Personel seçin'}
                </NativeSelectOption>
                {(staff.data?.data ?? []).map((item) => (
                  <NativeSelectOption key={item.membershipId} value={item.membershipId}>
                    {assigneeOptionLabel(item)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        {responsibleType === 'supplier' ? (
          <FormField id="bakim-tedarikci" label="Sorumlu tedarikçi" error={errors.supplierId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('supplierId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">
                  {suppliers.isPending ? 'Tedarikçiler yükleniyor…' : 'Tedarikçi seçin'}
                </NativeSelectOption>
                {(suppliers.data?.data ?? []).map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

/** Planın ayrıntısı: bilgiler, takvim, yönetici işlemleri ve denetim kayıtları. */
function PlanDetailView({
  planId,
  canManage,
  onArchived,
}: {
  planId: string
  canManage: boolean
  onArchived: () => void
}) {
  const item = useMaintenancePlan(planId)
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const plan = item.data?.data
  if (!plan) return <SummaryLoading />
  const view = MAINTENANCE_PLAN_DUE_VIEW[plan.dueStatus]
  const pairs: [string, string][] = [
    ['Tür', MAINTENANCE_PLAN_TYPE_LABELS[plan.type]],
    ['Yasal zorunluluk', plan.isLegal ? 'Evet' : 'Hayır'],
    ['Kampüs', plan.campusName ?? '—'],
    ['Yer', plan.location],
    ['Demirbaş', plan.asset ? `${plan.asset.tagNumber} · ${plan.asset.name}` : '—'],
    ['Periyot', `${String(plan.periodMonths)} ay`],
    ['Sorumlu', responsibleText(plan.responsible)],
    ['Son denetim', dayText(plan.lastDoneDate)],
    ['Sonraki denetim', dayText(plan.nextDueDate)],
  ]
  return (
    <div className="grid gap-6">
      <section aria-labelledby="bakim-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="bakim-bilgileri" className="text-base font-semibold [overflow-wrap:anywhere]">
            {plan.name}
          </h3>
          <StatusBadge text={view.label} tone={view.tone} />
          {plan.dueStatus === 'never' ? null : (
            <span className="text-sm text-muted-foreground">{dueText(plan)}</span>
          )}
        </div>
        <dl className="grid gap-2 text-sm">
          {pairs.map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2 max-[480px]:grid-cols-1"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="[overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Düzelt
            </Button>
            <Button variant="secondary" onClick={() => setArchiving(true)}>
              Arşivle
            </Button>
          </div>
        ) : null}
      </section>
      {canManage ? <InspectionForm key={plan.version} plan={plan} /> : null}
      <InspectionHistory plan={plan} canManage={canManage} />
      {editing ? (
        <PlanFormModal
          plan={plan}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
      {archiving ? (
        <ArchiveModal
          plan={plan}
          onClose={() => setArchiving(false)}
          onArchived={() => {
            setArchiving(false)
            onArchived()
          }}
        />
      ) : null}
    </div>
  )
}

function ArchiveModal({
  plan,
  onClose,
  onArchived,
}: {
  plan: MaintenancePlanDetail
  onClose: () => void
  onArchived: () => void
}) {
  const archive = useArchiveMaintenancePlan()
  async function confirm() {
    const outcome = await archive.submit({ planId: plan.id, version: plan.version })
    if (outcome.status === 'success') {
      notify.success(`${plan.name} planı arşivlendi.`)
      onArchived()
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Planı arşivle"
      description="Arşivlenen plan listede ve uyarılarda görünmez; denetim kayıtları kalır."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={archive.isPending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={archive.isPending}
            aria-busy={archive.isPending || undefined}
          >
            Arşivle
          </Button>
        </>
      }
    >
      <p className="text-sm">{plan.name}</p>
    </Modal>
  )
}

/** Denetim kaydı (K-254): uygunsuz ve kısmen uygun sonuçta not zorunlu. */
function InspectionForm({ plan }: { plan: MaintenancePlanDetail }) {
  const record = useRecordMaintenanceInspection()
  const form = useForm<InspectionFormValues>({
    resolver: zodResolver(inspectionFormSchema),
    defaultValues: inspectionDefaults(dayKey(), plan.responsible),
  })
  const errors = form.formState.errors
  const busy = record.isPending || form.formState.isSubmitting
  const result = useWatch({ control: form.control, name: 'result' })
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await record.submit(
      { planId: plan.id, body: inspectionBody(values) },
      {
        setError: (name, error) => {
          const field = inspectionFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Denetim kaydedildi.')
      form.reset(inspectionDefaults(dayKey(), plan.responsible))
    }
  })
  return (
    <section aria-labelledby="bakim-denetim" className="grid gap-3 border-t pt-4">
      <h3 id="bakim-denetim" className="text-base font-semibold">
        Denetim kaydet
      </h3>
      <form
        noValidate
        aria-label="Denetim kaydet"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="bakim-denetim-gun" label="Denetim günü" error={errors.doneDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('doneDate')} disabled={busy} />
          )}
        </FormField>
        <FormField
          id="bakim-denetim-yapan"
          label="Denetimi yapan"
          error={errors.performedBy}
          description="Kişi ya da kuruluş."
        >
          {(control) => <Input {...control} {...form.register('performedBy')} disabled={busy} />}
        </FormField>
        <FormField id="bakim-denetim-sonuc" label="Sonuç" error={errors.result}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('result')}
              className="w-full"
              disabled={busy}
            >
              {MAINTENANCE_INSPECTION_RESULTS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {MAINTENANCE_INSPECTION_RESULT_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="bakim-denetim-belge"
          label="Belge no (isteğe bağlı)"
          error={errors.documentNumber}
        >
          {(control) => <Input {...control} {...form.register('documentNumber')} disabled={busy} />}
        </FormField>
        <FormField
          id="bakim-denetim-not"
          label={result === 'pass' ? 'Not (isteğe bağlı)' : 'Uygunsuzluk notu'}
          error={errors.note}
        >
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Denetimi kaydet
          </Button>
        </div>
      </form>
    </section>
  )
}

function InspectionHistory({
  plan,
  canManage,
}: {
  plan: MaintenancePlanDetail
  canManage: boolean
}) {
  return (
    <section aria-labelledby="bakim-gecmis" className="grid gap-2 border-t pt-4">
      <h3 id="bakim-gecmis" className="text-base font-semibold">
        Denetim kayıtları
      </h3>
      {plan.inspections.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz denetim kaydı yok.</p>
      ) : (
        <ol aria-label="Denetim kayıtları" className="grid gap-2 text-sm">
          {plan.inspections.map((inspection) => (
            <InspectionItem
              key={inspection.id}
              plan={plan}
              inspection={inspection}
              canManage={canManage}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

function InspectionItem({
  plan,
  inspection,
  canManage,
}: {
  plan: MaintenancePlanDetail
  inspection: MaintenanceInspectionRow
  canManage: boolean
}) {
  const openRequest = useOpenRequestFromInspection()
  const [cancelling, setCancelling] = useState(false)
  const cancelled = inspection.cancelledAt !== null
  const view = MAINTENANCE_INSPECTION_RESULT_VIEW[inspection.result]
  const label = `${dayText(inspection.doneDate)} denetimi`
  async function open() {
    const outcome = await openRequest.submit({
      planId: plan.id,
      inspectionId: inspection.id,
      version: inspection.version,
    })
    if (outcome.status !== 'success') return
    const opened = outcome.data.data.inspections.find(
      (item) => item.id === inspection.id,
    )?.maintenanceRequest
    notify.success(
      opened ? `${opened.number} numaralı arıza talebi açıldı.` : 'Arıza talebi açıldı.',
    )
  }
  return (
    <li className="grid gap-1 rounded-sm border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{dayText(inspection.doneDate)}</span>
        <StatusBadge text={view.label} tone={view.tone} />
        {cancelled ? <StatusBadge text="İptal edildi" tone="gray" /> : null}
      </div>
      <span className="text-muted-foreground [overflow-wrap:anywhere]">
        {inspection.performedBy}
        {inspection.documentNumber ? ` · belge no ${inspection.documentNumber}` : ''}
        {inspection.recordedByName ? ` · kaydeden ${inspection.recordedByName}` : ''}
      </span>
      {inspection.note ? (
        <span className="[overflow-wrap:anywhere] whitespace-pre-line">{inspection.note}</span>
      ) : null}
      {inspection.cancelReason ? (
        <span className="text-muted-foreground [overflow-wrap:anywhere]">
          İptal gerekçesi: {inspection.cancelReason}
        </span>
      ) : null}
      {inspection.maintenanceRequest ? (
        <span>
          Arıza talebi:{' '}
          <Link
            className="font-medium underline-offset-4 hover:underline"
            to={{ search: `?gorunum=ariza&ariza=${inspection.maintenanceRequest.id}` }}
          >
            {inspection.maintenanceRequest.number}
          </Link>
          {inspection.maintenanceRequest.status
            ? ` · ${MAINTENANCE_STATUS_LABELS[inspection.maintenanceRequest.status]}`
            : ''}
        </span>
      ) : null}
      {canManage && !cancelled ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {inspection.result !== 'pass' && inspection.maintenanceRequest === null ? (
            <Button
              size="sm"
              onClick={() => void open()}
              disabled={openRequest.isPending}
              aria-busy={openRequest.isPending || undefined}
              aria-label={`${label} için arıza talebi aç`}
            >
              Arıza talebi aç
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCancelling((value) => !value)}
            aria-expanded={cancelling}
            aria-label={`${label} kaydını iptal et`}
          >
            Kaydı iptal et
          </Button>
        </div>
      ) : null}
      {cancelling && !cancelled ? (
        <InspectionCancelForm
          plan={plan}
          inspection={inspection}
          onDone={() => setCancelling(false)}
        />
      ) : null}
    </li>
  )
}

function InspectionCancelForm({
  plan,
  inspection,
  onDone,
}: {
  plan: MaintenancePlanDetail
  inspection: MaintenanceInspectionRow
  onDone: () => void
}) {
  const cancel = useCancelMaintenanceInspection()
  const form = useForm<InspectionCancelFormValues>({
    resolver: zodResolver(inspectionCancelFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const id = `bakim-iptal-${inspection.id}`
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      {
        planId: plan.id,
        inspectionId: inspection.id,
        version: inspection.version,
        body: { reason: values.reason.trim() },
      },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Denetim kaydı iptal edildi.')
      onDone()
    }
  })
  return (
    <form
      noValidate
      aria-label="Denetim kaydını iptal et"
      className="grid gap-2 pt-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id={id} label="İptal gerekçesi" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          disabled={busy}
          aria-busy={busy || undefined}
        >
          İptal et
        </Button>
      </div>
    </form>
  )
}
