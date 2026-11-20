import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  useChangePerformancePeriodStatus,
  useCreatePerformancePeriod,
  useCreatePerformanceReview,
  usePerformancePeriods,
  usePerformanceReviews,
  useUpdatePerformanceReview,
  type PerformancePeriod,
  type PerformanceReview,
} from '@kampus/react-shared/use-finance-performance.ts'
import {
  nextPerformanceStatus,
  PERFORMANCE_GOALS_MAX,
  PERFORMANCE_PERIOD_STATUS_LABELS,
  PERFORMANCE_PERIOD_STATUSES,
  performanceGoalsSchema,
  performancePeriodInputSchema,
  type PerformancePeriodStatus,
} from '@kampus/school-core/lib/finance-performance.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { z } from 'zod'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { PerformanceReportPanel } from './FinancePerformanceReportSection.tsx'
import { SelfEvaluationPanel } from './FinanceSelfEvaluationSection.tsx'
import { StaffFeedbackPanel } from './FinanceStaffFeedbackSection.tsx'
import { staffOptionText } from './finance-staff-certificate-forms.ts'
import {
  emptyGoal,
  goalWeightTotal,
  overallScoreText,
  performanceEditable,
  performanceReviewDefaults,
  performanceReviewFormSchema,
  performanceReviewUpdateBody,
  SCORE_OPTIONS,
  type PerformanceGoalFormValue,
  type PerformanceReviewFormValues,
} from './finance-performance-forms.ts'

const NO_SORT: readonly string[] = []
const PERIOD_MOBILE = ['name', 'status']
const REVIEW_MOBILE = ['staffName', 'overall']
const STAFF_PAGE = { page: 1, pageSize: 100 } as const
const FILTERS = [
  {
    key: 'status',
    label: 'Aşama',
    type: 'select' as const,
    options: PERFORMANCE_PERIOD_STATUSES.map((value) => ({
      value,
      label: PERFORMANCE_PERIOD_STATUS_LABELS[value],
    })),
  },
]
const TONES = {
  planning: 'gray',
  active: 'purple',
  interim: 'amber',
  evaluation: 'amber',
  closed: 'green',
} as const satisfies Record<PerformancePeriodStatus, BadgeTone>
const isStatus = (value: unknown): value is PerformancePeriodStatus =>
  (PERFORMANCE_PERIOD_STATUSES as readonly unknown[]).includes(value)
const day = (value: string) => dateLabel(`${value}T09:00:00.000Z`, { year: 'numeric' })

type PeriodRow = {
  id: string
  name: string
  dates: string
  progress: string
  period: PerformancePeriod
}
type ReviewRow = {
  id: string
  staffName: string
  goals: string
  interim: string
  overall: string
  review: PerformanceReview
}

/**
 * Performans dönemleri (DOM-FIN-124; ON-211): Finans "Performans" sekmesi, yalnız yönetici (K-429).
 * Üstte dönemler (aşama, ilerleme, sıradaki aşamaya geçiş); dönem seçilince personel kayıtları
 * (hedefler, ara görüşme, puan, genel puan). Kayıt düzenleme formu yalnız dönemin aşamasında açık
 * alanları gösterir (K-428); kapanmış dönem salt okunur. Kayıt listesi açılışı denetime yazılır.
 * Seçili dönemin altında öz değerlendirme bölümü (DOM-FIN-131; ON-210).
 */
export function FinancePerformanceSection() {
  const list = useListState('performans', { urlPrefix: 'perf_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = list.state.filters.status
  const periods = usePerformancePeriods({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
  })
  const [creating, setCreating] = useState(false)
  const [advancing, setAdvancing] = useState<PerformancePeriod | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = periods.data?.data.find((period) => period.id === selectedId) ?? null
  const rows = useMemo(
    () =>
      periods.data?.data.map((period): PeriodRow => ({
        id: period.id,
        name: period.name,
        dates: `${day(period.startDate)} – ${day(period.endDate)}`,
        progress: `${String(period.scoredCount)} / ${String(period.reviewCount)} puanlandı`,
        period,
      })),
    [periods.data],
  )
  const columns = useMemo<DataColumn<PeriodRow>[]>(
    () => [
      { key: 'name', label: 'Dönem' },
      { key: 'dates', label: 'Tarih aralığı' },
      {
        key: 'status',
        label: 'Aşama',
        cell: (row) => (
          <StatusBadge
            text={PERFORMANCE_PERIOD_STATUS_LABELS[row.period.status]}
            tone={TONES[row.period.status]}
          />
        ),
      },
      { key: 'progress', label: 'Değerlendirme' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => {
          const next = nextPerformanceStatus(row.period.status)
          return (
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={row.id === selectedId ? 'default' : 'outline'}
                aria-label={`${row.name} kayıtları`}
                aria-pressed={row.id === selectedId}
                onClick={() => setSelectedId(row.id)}
              >
                Kayıtlar
              </Button>
              {next === null ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`${row.name} dönemini ${PERFORMANCE_PERIOD_STATUS_LABELS[next]} aşamasına geçir`}
                  onClick={() => setAdvancing(row.period)}
                >
                  {PERFORMANCE_PERIOD_STATUS_LABELS[next]} aşamasına geç
                </Button>
              )}
            </span>
          )
        },
      },
    ],
    [selectedId],
  )
  return (
    <div className="grid gap-6">
      <section
        aria-labelledby="performans-donemleri"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div className="grid gap-1">
            <h2 id="performans-donemleri" className="text-lg font-semibold">
              Performans dönemleri
            </h2>
            <p className="text-sm text-muted-foreground">
              Hedef belirleme, ara görüşme ve dönem sonu değerlendirme. Dönem sırayla ilerler;
              kapanınca kayıtlar değiştirilemez. Kayıtların açılışı denetim kaydına yazılır.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>Yeni dönem</Button>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={periods.data?.meta.total ?? 0}
          sortable={NO_SORT}
          columns={columns}
          filters={FILTERS}
          mobileColumns={PERIOD_MOBILE}
          caption="Performans dönemleri"
          empty="Henüz performans dönemi açılmadı."
          emptyFiltered="Bu seçimle eşleşen dönem yok."
          loading={periods.isPending}
          fetching={periods.isFetching && !periods.isPending}
          error={
            periods.error ? (
              <QueryError error={periods.error} onRetry={() => void periods.refetch()} />
            ) : undefined
          }
        />
      </section>
      {selected ? <ReviewsPanel key={selected.id} period={selected} /> : null}
      {selected ? <SelfEvaluationPanel key={selected.id} period={selected} /> : null}
      {selected ? <StaffFeedbackPanel key={selected.id} period={selected} /> : null}
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni performans dönemi"
        description="Dönem planlama aşamasında açılır; personel ve hedefler planlama ya da yürürlük aşamasında eklenir."
      >
        {creating ? <PeriodForm onDone={() => setCreating(false)} /> : null}
      </Modal>
      <Modal
        open={advancing !== null}
        onOpenChange={(open) => (open ? undefined : setAdvancing(null))}
        title="Dönemin aşamasını ilerlet"
      >
        {advancing ? <AdvanceForm period={advancing} onDone={() => setAdvancing(null)} /> : null}
      </Modal>
      {selected ? <PerformanceReportPanel key={selected.id} period={selected} /> : null}
    </div>
  )
}

const periodFormSchema = performancePeriodInputSchema

function PeriodForm({ onDone }: { onDone: () => void }) {
  const create = useCreatePerformancePeriod()
  const form = useForm<z.input<typeof periodFormSchema>>({
    resolver: zodResolver(periodFormSchema),
    defaultValues: { name: '', startDate: '', endDate: '' },
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(values, {
      setError: (name, error) => {
        if (name === 'name' || name === 'startDate' || name === 'endDate')
          form.setError(name, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.name} dönemi açıldı.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Performans dönemi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="perf-ad" label="Dönem adı" error={errors.name}>
          {(control) => (
            <Input {...control} autoComplete="off" {...form.register('name')} disabled={busy} />
          )}
        </FormField>
      </div>
      <FormField id="perf-baslangic" label="Başlangıç günü" error={errors.startDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="perf-bitis" label="Bitiş günü" error={errors.endDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('endDate')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Dönemi aç
        </Button>
      </div>
    </form>
  )
}

/** Sıradaki aşamaya geçiş onayı (K-427); kapanış geri alınamaz. */
function AdvanceForm({ period, onDone }: { period: PerformancePeriod; onDone: () => void }) {
  const change = useChangePerformancePeriodStatus()
  const next = nextPerformanceStatus(period.status)
  const [error, setError] = useState<string | undefined>()
  if (next === null) return null
  const confirm = async () => {
    const outcome = await change.submit(
      { periodId: period.id, version: period.version, status: next },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success(`${period.name}: ${PERFORMANCE_PERIOD_STATUS_LABELS[next]} aşamasına geçildi.`)
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        {period.name}: {PERFORMANCE_PERIOD_STATUS_LABELS[period.status]} →{' '}
        {PERFORMANCE_PERIOD_STATUS_LABELS[next]}
      </p>
      {next === 'closed' ? (
        <p className="text-sm text-muted-foreground">
          Dönem kapanınca hedef, puan ve görüşler değiştirilemez. Bütün hedefler puanlanmış olmalı.
        </p>
      ) : null}
      <RootError message={error} />
      <div>
        <Button
          onClick={() => void confirm()}
          disabled={change.isPending}
          aria-busy={change.isPending || undefined}
        >
          {PERFORMANCE_PERIOD_STATUS_LABELS[next]} aşamasına geç
        </Button>
      </div>
    </div>
  )
}

function ReviewsPanel({ period }: { period: PerformancePeriod }) {
  const list = useListState('performans-kayit', { urlPrefix: 'perfk_' })
  const search = useDebouncedValue(list.state.query).trim()
  const reviews = usePerformanceReviews(period.id, {
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const editable = performanceEditable(period.status)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<PerformanceReview | null>(null)
  const rows = useMemo(
    () =>
      reviews.data?.data.map((review): ReviewRow => ({
        id: review.id,
        staffName: review.staffName,
        goals: review.goals.map((goal) => `${goal.title} (%${String(goal.weight)})`).join(', '),
        interim: review.interimDate === null ? '—' : day(review.interimDate),
        overall: overallScoreText(review.overallScore),
        review,
      })),
    [reviews.data],
  )
  const closed = period.status === 'closed'
  const columns = useMemo<DataColumn<ReviewRow>[]>(
    () => [
      { key: 'staffName', label: 'Personel' },
      { key: 'goals', label: 'Hedefler' },
      { key: 'interim', label: 'Ara görüşme' },
      { key: 'overall', label: 'Genel puan' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="outline"
            aria-label={`${row.staffName} kaydını ${closed ? 'görüntüle' : 'düzenle'}`}
            onClick={() => setEditing(row.review)}
          >
            {closed ? 'Görüntüle' : 'Düzenle'}
          </Button>
        ),
      },
    ],
    [closed],
  )
  return (
    <section
      aria-labelledby="performans-kayitlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="performans-kayitlari" className="text-lg font-semibold">
            {period.name} · personel kayıtları
          </h2>
          <p className="text-sm text-muted-foreground">
            Aşama: {PERFORMANCE_PERIOD_STATUS_LABELS[period.status]}. Genel puan, hedef puanlarının
            ağırlıklı ortalamasıdır.
          </p>
        </div>
        {editable.enroll ? <Button onClick={() => setAdding(true)}>Personel ekle</Button> : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={reviews.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={REVIEW_MOBILE}
        caption={`${period.name} personel kayıtları`}
        empty="Bu döneme henüz personel eklenmedi."
        emptyFiltered="Aramayla eşleşen kayıt yok."
        loading={reviews.isPending}
        fetching={reviews.isFetching && !reviews.isPending}
        error={
          reviews.error ? (
            <QueryError error={reviews.error} onRetry={() => void reviews.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={adding}
        onOpenChange={setAdding}
        title="Döneme personel ekle"
        description="Hedeflerin ağırlıkları toplamı %100 olmalı."
      >
        {adding ? <EnrollForm period={period} onDone={() => setAdding(false)} /> : null}
      </Modal>
      <Modal
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title={editing ? `${editing.staffName} · performans kaydı` : 'Performans kaydı'}
      >
        {editing ? (
          <ReviewForm period={period} review={editing} onDone={() => setEditing(null)} />
        ) : null}
      </Modal>
    </section>
  )
}

type GoalValues = { goals: PerformanceGoalFormValue[] }

/** Hedef satırları (başlık, ölçüt, ağırlık) ve canlı ağırlık toplamı. */
function GoalsEditor<T extends GoalValues>({
  control,
  register,
  errors,
  busy,
}: {
  control: Control<T>
  register: UseFormRegister<T>
  errors: FieldErrors<T>
  busy: boolean
}) {
  // Genel bileşen: react-hook-form yol tipleri `goals` alanına daraltılır.
  const typedControl = control as unknown as Control<GoalValues>
  const typedRegister = register as unknown as UseFormRegister<GoalValues>
  const goalErrors = (errors as FieldErrors<GoalValues>).goals
  const { fields, append, remove } = useFieldArray({ control: typedControl, name: 'goals' })
  const goals = useWatch({ control: typedControl, name: 'goals' })
  const total = goalWeightTotal(goals)
  const listError = goalErrors?.root?.message ?? goalErrors?.message
  return (
    <fieldset className="grid gap-3 sm:col-span-2">
      <legend className="text-sm font-medium">Hedefler</legend>
      {fields.map((field, index) => (
        <div key={field.id} className="grid gap-2 border-b pb-3 sm:grid-cols-[2fr_3fr_1fr_auto]">
          <FormField
            id={`perf-hedef-${String(index)}`}
            label={`${String(index + 1)}. hedef`}
            error={goalErrors?.[index]?.title}
          >
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                {...typedRegister(`goals.${index}.title`)}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField
            id={`perf-olcut-${String(index)}`}
            label={`${String(index + 1)}. ölçüt`}
            error={goalErrors?.[index]?.criterion}
          >
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                {...typedRegister(`goals.${index}.criterion`)}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField
            id={`perf-agirlik-${String(index)}`}
            label={`${String(index + 1)}. ağırlık (%)`}
            error={goalErrors?.[index]?.weight}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                {...typedRegister(`goals.${index}.weight`, { valueAsNumber: true })}
                disabled={busy}
              />
            )}
          </FormField>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              aria-label={`${String(index + 1)}. hedefi kaldır`}
              disabled={busy || fields.length === 1}
              onClick={() => remove(index)}
            >
              Kaldır
            </Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy || fields.length >= PERFORMANCE_GOALS_MAX}
          onClick={() => append(emptyGoal(Math.max(0, 100 - total)))}
        >
          Hedef ekle
        </Button>
        <p className="text-sm" aria-live="polite">
          Toplam ağırlık: %{String(total)}
        </p>
      </div>
      {listError ? (
        <p role="alert" className="text-sm text-destructive">
          {listError}
        </p>
      ) : null}
    </fieldset>
  )
}

const enrollFormSchema = z.object({
  membershipId: z.string().trim().min(1, 'Personel seçin.'),
  goals: performanceGoalsSchema,
})
type EnrollValues = z.input<typeof enrollFormSchema>

function EnrollForm({ period, onDone }: { period: PerformancePeriod; onDone: () => void }) {
  const create = useCreatePerformanceReview()
  const [staffSearch, setStaffSearch] = useState('')
  const staffQuery = useDebouncedValue(staffSearch).trim()
  const staff = useCertificateStaff({
    ...STAFF_PAGE,
    ...(staffQuery.length >= 2 ? { q: staffQuery } : {}),
  })
  const form = useForm<EnrollValues>({
    resolver: zodResolver(enrollFormSchema),
    defaultValues: { membershipId: '', goals: [emptyGoal()] },
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const options = (staff.data?.data ?? []).filter((row) => row.active)
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(
      { periodId: period.id, body: values },
      {
        setError: (name, error) => {
          if (name === 'membershipId') form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.staffName} döneme eklendi.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Döneme personel ekle"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="perf-personel-ara" label="Personel ara" description="En az 2 harf.">
        {(control) => (
          <Input
            {...control}
            type="search"
            autoComplete="off"
            value={staffSearch}
            onChange={(event) => setStaffSearch(event.target.value)}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="perf-personel" label="Personel" error={errors.membershipId}>
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
            {options.map((row) => (
              <NativeSelectOption key={row.membershipId} value={row.membershipId}>
                {staffOptionText(row)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {staff.error ? (
        <div className="sm:col-span-2">
          <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
        </div>
      ) : null}
      <GoalsEditor control={form.control} register={form.register} errors={errors} busy={busy} />
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Personeli ekle
        </Button>
      </div>
    </form>
  )
}

/** Kayıt düzenleme (K-428): yalnız aşamada açık alanlar; kapanmış dönemde salt okunur özet. */
function ReviewForm({
  period,
  review,
  onDone,
}: {
  period: PerformancePeriod
  review: PerformanceReview
  onDone: () => void
}) {
  const update = useUpdatePerformanceReview()
  const editable = performanceEditable(period.status)
  const form = useForm<PerformanceReviewFormValues>({
    resolver: zodResolver(performanceReviewFormSchema),
    defaultValues: performanceReviewDefaults(review),
  })
  const errors = form.formState.errors
  const busy = update.isPending || form.formState.isSubmitting
  const anyEditable = editable.goals || editable.interim || editable.evaluation
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await update.submit(
      {
        reviewId: review.id,
        version: review.version,
        body: performanceReviewUpdateBody(period.status, values),
      },
      {
        setError: (name, error) => {
          if (name === 'interimNote' || name === 'interimDate' || name === 'staffComment')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${review.staffName} kaydı kaydedildi.`)
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Performans kaydı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm sm:col-span-2">
        Genel puan: {overallScoreText(review.overallScore)}
        {review.evaluatorName === null ? '' : ` · Değerlendiren: ${review.evaluatorName}`}
      </p>
      {editable.goals ? (
        <GoalsEditor control={form.control} register={form.register} errors={errors} busy={busy} />
      ) : (
        <fieldset className="grid gap-2 sm:col-span-2">
          <legend className="text-sm font-medium">Hedefler ve puanlar</legend>
          {review.goals.map((goal, index) => (
            <div
              key={`${goal.title}-${String(index)}`}
              className="grid items-end gap-2 sm:grid-cols-[3fr_1fr]"
            >
              <p className="text-sm">
                <span className="font-medium">{goal.title}</span> · {goal.criterion} · %
                {String(goal.weight)}
              </p>
              {editable.evaluation ? (
                <FormField id={`perf-puan-${String(index)}`} label={`${goal.title} puanı`}>
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`scores.${index}`)}
                      className="w-full"
                      disabled={busy}
                    >
                      <NativeSelectOption value="">Girilmedi</NativeSelectOption>
                      {SCORE_OPTIONS.map((score) => (
                        <NativeSelectOption key={score} value={score}>
                          {score}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              ) : (
                <p className="text-sm">Puan: {goal.score === null ? '—' : String(goal.score)}</p>
              )}
            </div>
          ))}
        </fieldset>
      )}
      {editable.interim ? (
        <>
          <FormField id="perf-ara-gun" label="Ara görüşme günü" error={errors.interimDate}>
            {(control) => (
              <Input {...control} type="date" {...form.register('interimDate')} disabled={busy} />
            )}
          </FormField>
          <div className="sm:col-span-2">
            <FormField id="perf-ara-not" label="Ara görüşme notu" error={errors.interimNote}>
              {(control) => (
                <Textarea {...control} rows={3} {...form.register('interimNote')} disabled={busy} />
              )}
            </FormField>
          </div>
        </>
      ) : review.interimDate !== null || review.interimNote !== null ? (
        <p className="text-sm sm:col-span-2">
          Ara görüşme: {review.interimDate === null ? '—' : day(review.interimDate)}
          {review.interimNote === null ? '' : ` · ${review.interimNote}`}
        </p>
      ) : null}
      {editable.evaluation ? (
        <div className="sm:col-span-2">
          <FormField
            id="perf-gorus"
            label="Personelin görüşü"
            description="Personelin değerlendirmeye görüşünü onun adına girin."
            error={errors.staffComment}
          >
            {(control) => (
              <Textarea {...control} rows={3} {...form.register('staffComment')} disabled={busy} />
            )}
          </FormField>
        </div>
      ) : review.staffComment !== null ? (
        <p className="text-sm sm:col-span-2">Personelin görüşü: {review.staffComment}</p>
      ) : null}
      {anyEditable ? (
        <div className="sm:col-span-2">
          <RootError message={errors.root?.server?.message} />
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          {period.status === 'closed'
            ? 'Dönem kapandı; kayıt değiştirilemez.'
            : 'Bu aşamada değiştirilecek alan yok.'}
        </p>
      )}
    </form>
  )
}
