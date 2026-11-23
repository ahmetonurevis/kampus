import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import { useMealMenuSettings } from '@kampus/react-shared/use-finance-meal-menus.ts'
import {
  useArchiveMealSubscription,
  useCancelMealDays,
  useCreateMealSubscription,
  useMealCutoffSettings,
  useMealDailyCount,
  useMealMonthlySummary,
  useMealSubscription,
  useMealSubscriptions,
  useRestoreMealDay,
  useSetMealCutoff,
  useUpdateMealSubscription,
  type MealCutoffSettings,
  type MealDailyCount,
  type MealSubscriptionDetail,
  type MealSubscriptionRow,
} from '@kampus/react-shared/use-finance-meal-subscriptions.ts'
import {
  MEAL_KIND_LABELS,
  MEAL_KINDS,
  type MealKind,
} from '@kampus/school-core/lib/finance-meal-menus.ts'
import {
  MEAL_CANCELLED_BY_LABELS,
  MEAL_DIET_TYPE_LABELS,
  MEAL_DIET_TYPES,
  MEAL_SUBSCRIPTION_STATUS_LABELS,
  MEAL_SUBSCRIPTION_STATUSES,
  MEAL_WEEKDAY_LABELS,
  MEAL_WEEKDAYS,
  mealCutoffText,
  type MealDietType,
  type MealSubscriptionStatus,
} from '@kampus/school-core/lib/finance-meal-subscriptions.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  cancelledText,
  classMealTotal,
  countMealKinds,
  cutoffBody,
  cutoffFormSchema,
  dayStatusText,
  dietCountsText,
  dietText,
  longDate,
  mealKindText,
  monthText,
  onlyEndDate,
  periodText,
  shiftMonth,
  subscriptionCreateBody,
  subscriptionDefaults,
  subscriptionFormField,
  subscriptionFormSchema,
  subscriptionStatusText,
  subscriptionUpdateBody,
  type CutoffFormValues,
  type SubscriptionFormValues,
} from './finance-meal-subscription-forms.ts'
import { dayHeading } from './finance-meal-menu-forms.ts'
import { FinanceStudentSearch } from './FinanceStudentSearch.tsx'

const NO_SORT: readonly string[] = []
const DEFAULT_KINDS: readonly MealKind[] = ['lunch']
const VIEW_PARAM = 'yemek_sekme'
const VIEWS = [
  { value: 'abonelikler', label: 'Abonelikler' },
  { value: 'gunluk', label: 'Günlük sayım' },
  { value: 'aylik', label: 'Aylık özet' },
] as const
type MealView = (typeof VIEWS)[number]['value']

const STATUS_OPTIONS = MEAL_SUBSCRIPTION_STATUSES.map((value) => ({
  value,
  label: MEAL_SUBSCRIPTION_STATUS_LABELS[value],
}))
const MEAL_OPTIONS = MEAL_KINDS.map((value) => ({ value, label: MEAL_KIND_LABELS[value] }))
const DIET_OPTIONS = MEAL_DIET_TYPES.map((value) => ({
  value,
  label: MEAL_DIET_TYPE_LABELS[value],
}))
const LIST_FILTERS = [
  { key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS },
  { key: 'mealKind', label: 'Öğün', type: 'select' as const, options: MEAL_OPTIONS },
  { key: 'dietType', label: 'Diyet', type: 'select' as const, options: DIET_OPTIONS },
]
const MONTHLY_FILTERS = [
  { key: 'mealKind', label: 'Öğün', type: 'select' as const, options: MEAL_OPTIONS },
]
const STATUS_TONES = {
  upcoming: 'gray',
  active: 'green',
  ended: 'gray',
} as const satisfies Record<MealSubscriptionStatus, 'green' | 'gray'>

const pick = <T extends string>(value: unknown, values: readonly T[]): T | undefined =>
  values.find((item) => item === value)

/**
 * Yazdırma: yalnız günlük sayım kâğıda çıkar (gezinme, seçim ve düğmeler gizli). Kural bileşen
 * açıkken geçerlidir; ortak stil dosyasına girmez.
 */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  [data-yemek-sayim-yazdir], [data-yemek-sayim-yazdir] * { visibility: visible !important; }
  [data-yemek-sayim-yazdir] { position: absolute; top: 0; left: 0; width: 100%; padding: 0; }
  [data-yemek-sayim-gizle] { display: none !important; }
}`

function useMealView(): [MealView, (next: MealView) => void] {
  const [params, setParams] = useSearchParams()
  const view: MealView =
    pick(
      params.get(VIEW_PARAM),
      VIEWS.map((item) => item.value),
    ) ?? 'abonelikler'
  const setView = (next: MealView) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (next === 'abonelikler') copy.delete(VIEW_PARAM)
        else copy.set(VIEW_PARAM, next)
        return copy
      },
      { replace: true },
    )
  return [view, setView]
}

/**
 * Yemek aboneliği (DOM-FIN-164; ON-150; IST-099; K-547…K-549): Finans "Yemek aboneliği" sekmesi,
 * yönetici ve ön büro. "Abonelikler" listesi (öğrenci, öğün, dönem, diyet, durum), abonelik formu
 * ve sağ panelde 28 günlük yemek takvimiyle gün iptali; "Günlük sayım" mutfak için öğün × diyet ve
 * sınıf kırılımı (yazdırılabilir); "Aylık özet" iade/mahsup gün sayısı. Kesim ayarı yöneticide.
 * Velinin abonelik ve gün iptali ekranı platform kabuğundadır (uç `…/meal-subscriptions/my`).
 */
export function FinanceMealSubscriptionsSection() {
  const { session } = useAuth()
  if (session?.modules.meals !== true)
    return (
      <EmptyState
        icon="Utensils"
        title="Yemek menüsü modülü kapalı"
        description="Yemek aboneliği yemek modülüne bağlıdır. Kurum ayarlarından Yemek Menüsü modülünü açın."
      />
    )
  return <MealViews isManager={session.role === 'yonetici'} />
}

function MealViews({ isManager }: { isManager: boolean }) {
  const [view, setView] = useMealView()
  return (
    <div className="grid gap-4">
      <LineTabs label="Yemek aboneliği görünümü" value={view} options={VIEWS} onChange={setView} />
      {view === 'gunluk' ? <DailyCountView /> : null}
      {view === 'aylik' ? <MonthlySummaryView /> : null}
      {view === 'abonelikler' ? <SubscriptionList isManager={isManager} /> : null}
    </div>
  )
}

// --- Abonelikler ---------------------------------------------------------------------------------

type SubscriptionTableRow = {
  id: string
  row: MealSubscriptionRow
  student: string
  className: string
  meal: string
  period: string
  diet: string
  status: string
}

function SubscriptionList({ isManager }: { isManager: boolean }) {
  const list = useListState('yemek-abonelikleri', { urlPrefix: 'abone_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = pick(list.state.filters.status, MEAL_SUBSCRIPTION_STATUSES)
  const mealKind = pick(list.state.filters.mealKind, MEAL_KINDS)
  const dietType = pick(list.state.filters.dietType, MEAL_DIET_TYPES)
  const subscriptions = useMealSubscriptions({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === undefined ? {} : { status }),
    ...(mealKind === undefined ? {} : { mealKind }),
    ...(dietType === undefined ? {} : { dietType }),
  })
  const cutoff = useMealCutoffSettings()
  const panel = useDetailPanel('abonelik')
  const [editing, setEditing] = useState<MealSubscriptionRow | 'new' | null>(null)
  const [cutoffOpen, setCutoffOpen] = useState(false)
  const rows = useMemo(
    () =>
      subscriptions.data?.data.map((row): SubscriptionTableRow => ({
        id: row.id,
        row,
        student: row.studentName,
        className: row.className ?? '—',
        meal: mealKindText(row.mealKind),
        period: periodText(row),
        diet: dietText(row),
        status: subscriptionStatusText(row.status),
      })),
    [subscriptions.data],
  )
  const columns = useMemo<DataColumn<SubscriptionTableRow>[]>(
    () => [
      { key: 'student', label: 'Öğrenci' },
      { key: 'className', label: 'Sınıf' },
      { key: 'meal', label: 'Öğün' },
      { key: 'period', label: 'Dönem ve günler' },
      { key: 'diet', label: 'Diyet' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={STATUS_TONES[row.row.status]} />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              variant="secondary"
              aria-label={`${row.student} aboneliğini düzenle`}
              disabled={row.row.status === 'ended'}
              onClick={() => setEditing(row.row)}
            >
              Düzenle
            </Button>
            <Button
              className="min-h-11"
              variant="ghost"
              aria-label={`${row.student} aboneliğini aç`}
              onClick={() => panel.open(row.id)}
            >
              Aç
            </Button>
          </span>
        ),
      },
    ],
    [panel],
  )
  const cutoffData = cutoff.data?.data
  return (
    <section
      aria-labelledby="yemek-abonelikleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="yemek-abonelikleri" className="text-lg font-semibold">
            Yemek aboneliği
          </h2>
          <p className="text-sm text-muted-foreground">
            {cutoffData === undefined
              ? 'Öğrencinin öğün aboneliği, diyet türü ve gün iptali.'
              : `Öğrencinin öğün aboneliği, diyet türü ve gün iptali. Veli iptali kesimi: ${mealCutoffText(cutoffData)}.`}
          </p>
        </div>
        <span className="flex flex-wrap gap-2">
          {isManager ? (
            <Button
              variant="secondary"
              className="min-h-11"
              disabled={cutoffData === undefined}
              onClick={() => setCutoffOpen(true)}
            >
              Kesim ayarı
            </Button>
          ) : null}
          <Button className="min-h-11" onClick={() => setEditing('new')}>
            Abonelik ekle
          </Button>
        </span>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={subscriptions.data?.meta.total ?? 0}
        sortable={NO_SORT}
        filters={LIST_FILTERS}
        columns={columns}
        mobileColumns={['student', 'meal', ACTIONS_KEY]}
        caption="Yemek abonelikleri"
        empty="Henüz yemek aboneliği yok."
        emptyFiltered="Bu arama ya da süzgeçle eşleşen abonelik yok."
        loading={subscriptions.isPending}
        fetching={subscriptions.isFetching && !subscriptions.isPending}
        error={
          subscriptions.error ? (
            <QueryError error={subscriptions.error} onRetry={() => void subscriptions.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Yemek aboneliği"
      >
        {panel.selectedId ? (
          <SubscriptionPanel
            subscriptionId={panel.selectedId}
            onEdit={(row) => setEditing(row)}
            onClose={panel.close}
          />
        ) : null}
      </SidePanel>
      <Modal
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title={editing === 'new' ? 'Abonelik ekle' : 'Aboneliği düzenle'}
      >
        {editing === null ? null : (
          <SubscriptionForm
            row={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal open={cutoffOpen} onOpenChange={setCutoffOpen} title="Kesim ayarı">
        {cutoffOpen && cutoffData !== undefined ? (
          <CutoffForm settings={cutoffData} onDone={() => setCutoffOpen(false)} />
        ) : null}
      </Modal>
    </section>
  )
}

function SubscriptionPanel({
  subscriptionId,
  onEdit,
  onClose,
}: {
  subscriptionId: string
  onEdit: (row: MealSubscriptionRow) => void
  onClose: () => void
}) {
  const subscription = useMealSubscription(subscriptionId)
  if (subscription.error)
    return <QueryError error={subscription.error} onRetry={() => void subscription.refetch()} />
  const detail = subscription.data?.data
  if (!detail) return <SummaryLoading />
  return (
    <SubscriptionDetails key={detail.version} detail={detail} onEdit={onEdit} onClose={onClose} />
  )
}

function SubscriptionDetails({
  detail,
  onEdit,
  onClose,
}: {
  detail: MealSubscriptionDetail
  onEdit: (row: MealSubscriptionRow) => void
  onClose: () => void
}) {
  const cancel = useCancelMealDays()
  const restore = useRestoreMealDay()
  const archive = useArchiveMealSubscription()
  const [selected, setSelected] = useState<string[]>([])
  const busy = cancel.isPending || restore.isPending || archive.isPending
  const cancelSelected = async () => {
    const outcome = await cancel.submit({ subscriptionId: detail.id, dates: [...selected].sort() })
    if (outcome.status !== 'success') return
    const late = outcome.data.data.cancellations.filter((row) => row.late).length
    notify.success(
      late > 0
        ? `${String(selected.length)} gün iptal edildi; ${String(late)} gün kesimden sonra (geç iptal).`
        : `${String(selected.length)} gün iptal edildi.`,
    )
    setSelected([])
  }
  const archiveSubscription = async () => {
    const outcome = await archive.submit({ subscriptionId: detail.id, version: detail.version })
    if (outcome.status !== 'success') return
    notify.success('Abonelik silindi.')
    onClose()
  }
  return (
    <div className="grid gap-5">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Öğrenci</dt>
        <dd>{detail.studentName}</dd>
        <dt className="text-muted-foreground">Sınıf</dt>
        <dd>{detail.className ?? '—'}</dd>
        <dt className="text-muted-foreground">Öğün</dt>
        <dd>{mealKindText(detail.mealKind)}</dd>
        <dt className="text-muted-foreground">Dönem ve günler</dt>
        <dd>{periodText(detail)}</dd>
        <dt className="text-muted-foreground">Diyet</dt>
        <dd>{dietText(detail)}</dd>
        <dt className="text-muted-foreground">Durum</dt>
        <dd>{subscriptionStatusText(detail.status)}</dd>
        <dt className="text-muted-foreground">Veli iptali kesimi</dt>
        <dd>{mealCutoffText(detail.cutoff)}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        {detail.status === 'ended' ? null : (
          <Button variant="secondary" className="min-h-11" onClick={() => onEdit(detail)}>
            Düzenle
          </Button>
        )}
        {detail.status === 'upcoming' ? (
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={busy}
            onClick={() => void archiveSubscription()}
          >
            Aboneliği sil
          </Button>
        ) : null}
      </div>
      <section aria-labelledby="yemek-gunleri" className="grid gap-2">
        <h3 id="yemek-gunleri" className="font-semibold">
          Önümüzdeki yemek günleri
        </h3>
        <p className="text-sm text-muted-foreground">
          Kesimden sonra okulun iptali geç iptal olarak yazılır ve iade/mahsup gününe girmez.
        </p>
        {detail.days.length === 0 ? (
          <p className="text-sm text-muted-foreground">Önümüzdeki 28 günde yemek günü yok.</p>
        ) : (
          <ul aria-label="Yemek günleri" className="grid gap-1 text-sm">
            {detail.days.map((day) => {
              const id = `yemek-gun-${day.mealDate}`
              const cancellation = day.cancellation
              return (
                <li
                  key={day.mealDate}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b py-1"
                >
                  <span className="flex items-center gap-2">
                    {day.canCancel ? (
                      <Checkbox
                        id={id}
                        checked={selected.includes(day.mealDate)}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          setSelected((current) =>
                            checked === true
                              ? [...current, day.mealDate]
                              : current.filter((item) => item !== day.mealDate),
                          )
                        }
                      />
                    ) : null}
                    <Label htmlFor={day.canCancel ? id : undefined}>
                      {dayHeading(day.mealDate)}
                    </Label>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">{dayStatusText(day)}</span>
                    {day.canRestore && cancellation !== null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-11"
                        disabled={busy}
                        aria-label={`${dayHeading(day.mealDate)} iptalini geri al`}
                        onClick={() =>
                          void restore
                            .submit({
                              subscriptionId: detail.id,
                              cancellationId: cancellation.id,
                              version: cancellation.version,
                            })
                            .then((outcome) => {
                              if (outcome.status === 'success')
                                notify.success('İptal geri alındı; gün yeniden yemek günü.')
                            })
                        }
                      >
                        Geri al
                      </Button>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <div>
          <Button
            className="min-h-11"
            disabled={selected.length === 0 || busy}
            aria-busy={cancel.isPending || undefined}
            onClick={() => void cancelSelected()}
          >
            Seçili günleri iptal et
          </Button>
        </div>
      </section>
      <section aria-labelledby="yemek-iptalleri" className="grid gap-2">
        <h3 id="yemek-iptalleri" className="font-semibold">
          İptaller
        </h3>
        {detail.cancellations.length === 0 ? (
          <p className="text-sm text-muted-foreground">İptal edilmiş gün yok.</p>
        ) : (
          <ul aria-label="İptal edilen günler" className="grid gap-1 text-sm">
            {detail.cancellations.map((row) => (
              <li key={row.id} className="flex justify-between gap-2 border-b py-1">
                <span>{longDate(row.mealDate)}</span>
                <span className="text-muted-foreground">
                  {`${MEAL_CANCELLED_BY_LABELS[row.cancelledBy]}${row.late ? ' · geç iptal' : ''}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SubscriptionForm({ row, onDone }: { row?: MealSubscriptionRow; onDone: () => void }) {
  const today = dayKey()
  const settings = useMealMenuSettings()
  const enabled = settings.data?.data.mealKinds ?? DEFAULT_KINDS
  const create = useCreateMealSubscription()
  const update = useUpdateMealSubscription()
  const form = useForm<SubscriptionFormValues>({
    resolver: zodResolver(subscriptionFormSchema),
    defaultValues: subscriptionDefaults(today, enabled, row),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const locked = row !== undefined && onlyEndDate(row, today)
  const dietType = useWatch({ control: form.control, name: 'dietType' })
  const kinds: readonly MealKind[] =
    row === undefined ? enabled : MEAL_KINDS.filter((kind) => kind === row.mealKind)
  const setServerError = (name: string, error: { type: string; message: string }) => {
    const field = subscriptionFormField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (row === undefined) {
      const outcome = await create.submit(subscriptionCreateBody(values), {
        setError: setServerError,
      })
      if (outcome.status !== 'success') return
      notify.success(`${outcome.data.data.studentName} için abonelik açıldı.`)
      onDone()
      return
    }
    const body = subscriptionUpdateBody(values, row, today)
    if (body === null) {
      onDone()
      return
    }
    const outcome = await update.submit(
      { subscriptionId: row.id, version: row.version, body },
      { setError: setServerError },
    )
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.studentName} aboneliği güncellendi.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label={row === undefined ? 'Abonelik ekle' : 'Aboneliği düzenle'}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        {row === undefined ? (
          <Controller
            control={form.control}
            name="studentId"
            render={({ field }) => (
              <FinanceStudentSearch
                label="Öğrenci"
                value={field.value}
                onChange={field.onChange}
                error={errors.studentId?.message}
                disabled={busy}
              />
            )}
          />
        ) : (
          <p className="text-sm">{`Öğrenci: ${row.studentName}`}</p>
        )}
      </div>
      {locked ? (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          Abonelik başladı; yalnız bitiş günü değişir. Diyet ya da gün değişikliği için aboneliği
          bitirip yenisini açın.
        </p>
      ) : null}
      <FormField id="abonelik-ogun" label="Öğün" error={errors.mealKind}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('mealKind')}
            className="w-full"
            disabled={busy || row !== undefined}
          >
            {kinds.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {MEAL_KIND_LABELS[kind]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="abonelik-diyet" label="Diyet türü" error={errors.dietType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('dietType')}
            className="w-full"
            disabled={busy || locked}
          >
            {MEAL_DIET_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {MEAL_DIET_TYPE_LABELS[type]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {dietType === 'other' ? (
        <div className="sm:col-span-2">
          <FormField
            id="abonelik-diyet-aciklama"
            label="Diyet açıklaması"
            description="Kısa tür açıklaması (ör. domuz eti içermeyen). Tıbbi ayrıntı yazmayın; sağlık bilgisi sağlık profilinde tutulur."
            error={errors.dietNote}
          >
            {(control) => (
              <Input {...control} {...form.register('dietNote')} disabled={busy || locked} />
            )}
          </FormField>
        </div>
      ) : null}
      <FormField id="abonelik-baslangic" label="Başlangıç" error={errors.startDate}>
        {(control) => (
          <Input
            {...control}
            type="date"
            min={today}
            {...form.register('startDate')}
            disabled={busy || locked}
          />
        )}
      </FormField>
      <FormField id="abonelik-bitis" label="Bitiş" error={errors.endDate}>
        {(control) => (
          <Input
            {...control}
            type="date"
            min={today}
            {...form.register('endDate')}
            disabled={busy}
          />
        )}
      </FormField>
      <Controller
        control={form.control}
        name="weekdays"
        render={({ field }) => (
          <fieldset className="grid gap-1 sm:col-span-2" aria-describedby="abonelik-gunler-hata">
            <legend className="mb-1 text-sm font-medium">Yemek günleri</legend>
            <div className="flex flex-wrap gap-x-4">
              {MEAL_WEEKDAYS.map((day) => (
                <div key={day} className="flex min-h-11 items-center gap-2">
                  <Checkbox
                    id={`abonelik-gun-${String(day)}`}
                    checked={field.value.includes(day)}
                    disabled={busy || locked}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked === true
                          ? MEAL_WEEKDAYS.filter(
                              (item) => item === day || field.value.includes(item),
                            )
                          : field.value.filter((item) => item !== day),
                      )
                    }
                  />
                  <Label htmlFor={`abonelik-gun-${String(day)}`}>{MEAL_WEEKDAY_LABELS[day]}</Label>
                </div>
              ))}
            </div>
            <p id="abonelik-gunler-hata" className="text-sm text-danger">
              {errors.weekdays?.message ?? ''}
            </p>
          </fieldset>
        )}
      />
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          {row === undefined ? 'Aboneliği kaydet' : 'Değişiklikleri kaydet'}
        </Button>
      </div>
    </form>
  )
}

function CutoffForm({ settings, onDone }: { settings: MealCutoffSettings; onDone: () => void }) {
  const save = useSetMealCutoff()
  const form = useForm<CutoffFormValues>({
    resolver: zodResolver(cutoffFormSchema),
    defaultValues: {
      cutoffDaysBefore: String(settings.cutoffDaysBefore),
      cutoffTime: settings.cutoffTime,
    },
  })
  const errors = form.formState.errors
  const busy = save.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await save.submit(
      { version: settings.version, body: cutoffBody(values) },
      {
        setError: (name, error) =>
          name === 'cutoffDaysBefore' || name === 'cutoffTime'
            ? form.setError(name, error)
            : form.setError('root.server', error),
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`Kesim kaydedildi: ${mealCutoffText(outcome.data.data)}.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Kesim ayarı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted-foreground sm:col-span-2">
        Veli, yemek gününden bu kadar gün önce, bu saate kadar iptal eder (İstanbul saati). Sonra
        yalnız okul iptal eder ve iptal geç iptal olarak yazılır.
      </p>
      <FormField id="kesim-gun" label="Kaç gün önce" error={errors.cutoffDaysBefore}>
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            {...form.register('cutoffDaysBefore')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="kesim-saat" label="Saat" error={errors.cutoffTime}>
        {(control) => (
          <Input {...control} type="time" {...form.register('cutoffTime')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          Kesimi kaydet
        </Button>
      </div>
    </form>
  )
}

// --- Günlük sayım --------------------------------------------------------------------------------

function DailyCountView() {
  const [date, setDate] = useState(() => dayKey())
  const count = useMealDailyCount(date)
  const data = count.data?.data
  return (
    <section
      aria-labelledby="yemek-sayim"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <style>{PRINT_CSS}</style>
      <header className="panel-heading grid gap-1 px-6 pt-6 pb-2" data-yemek-sayim-gizle="">
        <h2 id="yemek-sayim" className="text-lg font-semibold">
          Günlük yemek sayısı
        </h2>
        <p className="text-sm text-muted-foreground">
          Mutfak için öğün ve diyet türüne göre yemek sayısı; iptaller düşülmüştür. Öğrenci adı
          gösterilmez.
        </p>
      </header>
      <div className="grid gap-6 px-6 pb-6">
        <div className="flex flex-wrap items-end gap-3" data-yemek-sayim-gizle="">
          <div className="grid gap-2">
            <Label htmlFor="yemek-sayim-gun">Gün</Label>
            <Input
              id="yemek-sayim-gun"
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value !== '') setDate(event.target.value)
              }}
            />
          </div>
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={data === undefined}
            onClick={() => window.print()}
          >
            <Icon name="Printer" size={17} aria-hidden="true" />
            Yazdır
          </Button>
        </div>
        {count.error ? (
          <QueryError error={count.error} onRetry={() => void count.refetch()} />
        ) : data === undefined ? (
          <SummaryLoading />
        ) : (
          <DailyCountSheet count={data} />
        )}
      </div>
    </section>
  )
}

function DailyCountSheet({ count }: { count: MealDailyCount }) {
  const kinds = countMealKinds(count)
  return (
    <div className="grid gap-4" data-yemek-sayim-yazdir="">
      <h3 className="text-base font-semibold">{`${dayHeading(count.date)} yemek sayısı`}</h3>
      {count.holidayTitle === null ? null : (
        <p className="text-sm">{`Tatil: ${count.holidayTitle}. Bu gün yemek verilmez.`}</p>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableCaption className="sr-only">Öğün ve diyet sayısı</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Öğün</TableHead>
              <TableHead scope="col">Toplam</TableHead>
              {MEAL_DIET_TYPES.map((type) => (
                <TableHead key={type} scope="col">
                  {MEAL_DIET_TYPE_LABELS[type]}
                </TableHead>
              ))}
              <TableHead scope="col">İptal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {count.meals.map((row) => (
              <TableRow key={row.mealKind}>
                <TableHead scope="row">{mealKindText(row.mealKind)}</TableHead>
                <TableCell className="font-semibold">{row.total}</TableCell>
                {MEAL_DIET_TYPES.map((type) => (
                  <TableCell key={type}>{dietCount(row.diets, type)}</TableCell>
                ))}
                <TableCell>{cancelledText(row) || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <h3 className="text-base font-semibold">Sınıf kırılımı</h3>
      {count.classes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu gün yemek alan öğrenci yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">Sınıf kırılımı</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Sınıf</TableHead>
                {kinds.map((kind) => (
                  <TableHead key={kind} scope="col">
                    {mealKindText(kind)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {count.classes.map((entry) => (
                <TableRow key={entry.classId ?? 'sinifsiz'}>
                  <TableHead scope="row">{entry.className ?? 'Sınıfsız'}</TableHead>
                  {kinds.map((kind) => {
                    const meal = entry.meals.find((item) => item.mealKind === kind)
                    return (
                      <TableCell key={kind}>
                        <span className="font-semibold">{classMealTotal(entry, kind)}</span>
                        {meal === undefined ? null : (
                          <span className="block text-xs text-muted-foreground">
                            {dietCountsText(meal.diets)}
                          </span>
                        )}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

const dietCount = (
  diets: readonly { dietType: MealDietType; count: number }[],
  type: MealDietType,
) => diets.find((item) => item.dietType === type)?.count ?? 0

// --- Aylık özet ----------------------------------------------------------------------------------

type MonthlyTableRow = {
  id: string
  student: string
  className: string
  meal: string
  subscribedDays: number
  holidayDays: number
  cancelledDays: number
  lateCancelledDays: number
  mealDays: number
  refundableDays: number
}

function MonthlySummaryView() {
  const [month, setMonth] = useState(() => dayKey().slice(0, 7))
  const list = useListState('yemek-aylik', { urlPrefix: 'yemek_ay_', resetKey: month })
  const search = useDebouncedValue(list.state.query).trim()
  const mealKind = pick(list.state.filters.mealKind, MEAL_KINDS)
  const summary = useMealMonthlySummary({
    month,
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(mealKind === undefined ? {} : { mealKind }),
  })
  const rows = useMemo(
    () =>
      summary.data?.data.map((row): MonthlyTableRow => ({
        id: row.subscriptionId,
        student: row.studentName,
        className: row.className ?? '—',
        meal: mealKindText(row.mealKind),
        subscribedDays: row.subscribedDays,
        holidayDays: row.holidayDays,
        cancelledDays: row.cancelledDays,
        lateCancelledDays: row.lateCancelledDays,
        mealDays: row.mealDays,
        refundableDays: row.refundableDays,
      })),
    [summary.data],
  )
  const columns = useMemo<DataColumn<MonthlyTableRow>[]>(
    () => [
      { key: 'student', label: 'Öğrenci' },
      { key: 'className', label: 'Sınıf' },
      { key: 'meal', label: 'Öğün' },
      { key: 'subscribedDays', label: 'Abone gün' },
      { key: 'holidayDays', label: 'Tatil' },
      { key: 'cancelledDays', label: 'İptal' },
      { key: 'lateCancelledDays', label: 'Geç iptal' },
      { key: 'mealDays', label: 'Yemek günü' },
      { key: 'refundableDays', label: 'İade/mahsup günü' },
    ],
    [],
  )
  return (
    <section
      aria-labelledby="yemek-aylik"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="yemek-aylik" className="text-lg font-semibold">
            {`Aylık yemek özeti: ${monthText(month)}`}
          </h2>
          <p className="text-sm text-muted-foreground">
            Öğrenci başına abone olunan, iptal edilen ve iade/mahsup için gün sayısı. Tatil abone
            günü sayılmaz; geç iptal iadeye girmez. Tutar, ek hizmet ücreti bağlanınca hesaplanır.
          </p>
        </div>
        <span className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            Önceki ay
          </Button>
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => setMonth(dayKey().slice(0, 7))}
          >
            Bu ay
          </Button>
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            Sonraki ay
          </Button>
        </span>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={summary.data?.meta.total ?? 0}
        sortable={NO_SORT}
        filters={MONTHLY_FILTERS}
        columns={columns}
        mobileColumns={['student', 'mealDays', 'refundableDays']}
        caption={`Aylık yemek özeti ${monthText(month)}`}
        empty="Bu ay yemek günü olan abonelik yok."
        emptyFiltered="Bu arama ya da süzgeçle eşleşen abonelik yok."
        loading={summary.isPending}
        fetching={summary.isFetching && !summary.isPending}
        error={
          summary.error ? (
            <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
          ) : undefined
        }
      />
    </section>
  )
}
