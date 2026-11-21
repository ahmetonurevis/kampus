import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLessonObservationTemplates } from '@kampus/react-shared/use-finance-lesson-observations.ts'
import {
  useCancelObservationPlan,
  useCreateObservationPlan,
  useObservationPlan,
  useObservationPlans,
  usePostponeObservationPlan,
  useStartObservationPlan,
  useUpdateObservationPlan,
  type ObservationPlan,
} from '@kampus/react-shared/use-finance-observation-plans.ts'
import { usePerformancePeriods } from '@kampus/react-shared/use-finance-performance.ts'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  OBSERVATION_PLAN_DURATION_MAX,
  OBSERVATION_PLAN_DURATION_MIN,
  OBSERVATION_PLAN_NOTICE_KIND_LABELS,
  OBSERVATION_PLAN_NOTICE_STATUS_LABELS,
  OBSERVATION_PLAN_STATUS_LABELS,
  OBSERVATION_PLANS_PER_PERIOD_MAX,
} from '@kampus/school-core/lib/finance-observation-plans.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  CALENDAR_MODES,
  calendarRange,
  dayLongText,
  periodTitle,
  shiftAnchor,
  type CalendarMode,
} from './finance-leave-calendar-view.ts'
import {
  cancelFormSchema,
  canStartPlan,
  emptyPlanForm,
  isOpenPlan,
  PLAN_STATUS_TONES,
  planCreateBody,
  planFormSchema,
  planFormValues,
  plansByDay,
  planTimeText,
  planUpdateBody,
  postponeBody,
  postponeFormSchema,
  postponeFormValues,
  type PlanFormValues,
  type PostponeFormValues,
} from './finance-observation-plan-forms.ts'

const OPTIONS_PAGE = { page: 1, pageSize: 100 } as const
const OVERDUE_QUERY = { page: 1, pageSize: 100, overdue: 'true' } as const

type Dialog =
  { kind: 'create' } | { kind: 'edit' | 'postpone' | 'cancel' | 'notices'; plan: ObservationPlan }

/**
 * Gözlem planı (DOM-FIN-139; ON-207): "Ders gözlemleri" sekmesinin "Plan" görünümü, yalnız
 * yönetici. Hafta ya da ay aralığındaki planlar gün gün listelenir (takvim kütüphanesi yok),
 * gözlemciye ve öğretmene göre süzülür; günü geçmiş açık planlar "Geciken planlar"dadır (K-473).
 * Plan açılır, düzeltilir, ertelenir ve gerekçeyle iptal edilir (K-472); günü gelen plandan gözlem
 * başlatılır ve gözlem penceresi açılır. Öğretmen bildirimi "gönderilecek" kaydıdır (K-474).
 */
export function FinanceObservationPlansPanel({
  onOpenObservation,
}: {
  onOpenObservation: (id: string) => void
}) {
  const today = dayKey()
  const [mode, setMode] = useState<CalendarMode>('week')
  const [anchor, setAnchor] = useState(today)
  const [observer, setObserver] = useState('')
  const [teacher, setTeacher] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const range = calendarRange(mode, anchor)
  const people = {
    ...(observer === '' ? {} : { observerMembershipId: observer }),
    ...(teacher === '' ? {} : { teacherMembershipId: teacher }),
  }
  const plans = useObservationPlans({
    page: 1,
    pageSize: 100,
    from: range.startDate,
    to: range.endDate,
    ...people,
  })
  const overdue = useObservationPlans({ ...OVERDUE_QUERY, ...people })
  const staff = useCertificateStaff(OPTIONS_PAGE)
  const active = (staff.data?.data ?? []).filter((row) => row.active)
  const title = periodTitle(mode, anchor)
  const overdueItems = overdue.data?.data ?? []
  const items = plans.data?.data ?? []
  const total = plans.data?.meta.total ?? 0
  const actions = {
    today,
    onDialog: setDialog,
    onOpenObservation,
  }
  return (
    <section
      aria-labelledby="gozlem-plani"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="gozlem-plani" className="text-lg font-semibold">
            Gözlem planı
          </h2>
          <p className="text-sm text-muted-foreground">
            Gözlemci ve öğretmen aynı saatte iki planda olamaz; geçmiş güne plan açılmaz, öğretmene
            dönemde en çok {OBSERVATION_PLANS_PER_PERIOD_MAX} plan. Saatler elle girilir, ders
            programıyla karşılaştırılmaz. Öğretmen bildirimleri gönderilecek olarak kaydedilir.
          </p>
        </div>
        <Button onClick={() => setDialog({ kind: 'create' })}>Yeni plan</Button>
      </header>
      <div className="grid gap-3 px-6 pb-6">
        <div className="flex flex-wrap items-end gap-2">
          <LineTabs
            label="Plan takvimi görünümü"
            value={mode}
            options={CALENDAR_MODES}
            onChange={(next) => setMode(next)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAnchor(shiftAnchor(mode, anchor, -1))}
            >
              {mode === 'month' ? 'Önceki ay' : 'Önceki hafta'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAnchor(today)}>
              Bugün
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAnchor(shiftAnchor(mode, anchor, 1))}
            >
              {mode === 'month' ? 'Sonraki ay' : 'Sonraki hafta'}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="gp-suzgec-gozlemci" label="Gözlemciye göre">
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={observer}
                onChange={(event) => setObserver(event.target.value)}
              >
                <NativeSelectOption value="">Tüm gözlemciler</NativeSelectOption>
                {active
                  .filter((row) => row.role === 'yonetici' || row.role === 'ogretmen')
                  .map((row) => (
                    <NativeSelectOption key={row.membershipId} value={row.membershipId}>
                      {row.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="gp-suzgec-ogretmen" label="Öğretmene göre">
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={teacher}
                onChange={(event) => setTeacher(event.target.value)}
              >
                <NativeSelectOption value="">Tüm öğretmenler</NativeSelectOption>
                {active
                  .filter((row) => row.role === 'ogretmen')
                  .map((row) => (
                    <NativeSelectOption key={row.membershipId} value={row.membershipId}>
                      {row.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
        {overdue.error ? (
          <QueryError error={overdue.error} onRetry={() => void overdue.refetch()} />
        ) : overdueItems.length > 0 ? (
          <section aria-labelledby="geciken-planlar" className="grid gap-2">
            <h3 id="geciken-planlar" className="text-base font-semibold">
              Geciken planlar ({overdue.data?.meta.total ?? overdueItems.length})
            </h3>
            <ul className="grid gap-2">
              {overdueItems.map((plan) => (
                <PlanItem key={plan.id} plan={plan} showDay {...actions} />
              ))}
            </ul>
          </section>
        ) : null}
        <section aria-labelledby="plan-takvimi" className="grid gap-2">
          <h3 id="plan-takvimi" className="text-base font-semibold">
            Planlar: {title}
          </h3>
          {plans.error ? (
            <QueryError error={plans.error} onRetry={() => void plans.refetch()} />
          ) : plans.data === undefined ? (
            <SummaryLoading />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu aralıkta gözlem planı yok.</p>
          ) : (
            <>
              {total > items.length ? (
                <p className="text-sm text-muted-foreground">
                  Bu aralıkta {total} plan var; ilk {items.length} plan gösteriliyor. Gözlemci ya da
                  öğretmen seçerek daraltın.
                </p>
              ) : null}
              {plansByDay(items).map((group) => (
                <section
                  key={group.day}
                  aria-label={dayLongText(group.day)}
                  className="grid gap-2 border-t pt-2"
                >
                  <h4 className="text-sm font-semibold">
                    {dayLongText(group.day)}
                    {group.day === today ? ' · Bugün' : ''}
                  </h4>
                  <ul className="grid gap-2">
                    {group.plans.map((plan) => (
                      <PlanItem key={plan.id} plan={plan} showDay={false} {...actions} />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </section>
      </div>
      <Modal
        open={dialog?.kind === 'create' || dialog?.kind === 'edit'}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        title={dialog?.kind === 'edit' ? 'Gözlem planını düzenle' : 'Yeni gözlem planı'}
        description="Öğretmene plan bildirimi gönderilecek olarak kaydedilir."
        size="wide"
      >
        {dialog?.kind === 'create' ? (
          <PlanForm plan={null} onDone={() => setDialog(null)} />
        ) : dialog?.kind === 'edit' ? (
          <PlanForm key={dialog.plan.id} plan={dialog.plan} onDone={() => setDialog(null)} />
        ) : null}
      </Modal>
      <Modal
        open={dialog?.kind === 'postpone'}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        title="Gözlem planını ertele"
      >
        {dialog?.kind === 'postpone' ? (
          <PostponeForm plan={dialog.plan} onDone={() => setDialog(null)} />
        ) : null}
      </Modal>
      <Modal
        open={dialog?.kind === 'cancel'}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        title="Gözlem planını iptal et"
      >
        {dialog?.kind === 'cancel' ? (
          <CancelForm plan={dialog.plan} onDone={() => setDialog(null)} />
        ) : null}
      </Modal>
      <Modal
        open={dialog?.kind === 'notices'}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        title="Öğretmen bildirimleri"
      >
        {dialog?.kind === 'notices' ? <PlanNotices planId={dialog.plan.id} /> : null}
      </Modal>
    </section>
  )
}

function PlanItem({
  plan,
  showDay,
  today,
  onDialog,
  onOpenObservation,
}: {
  plan: ObservationPlan
  showDay: boolean
  today: string
  onDialog: (dialog: Dialog) => void
  onOpenObservation: (id: string) => void
}) {
  const start = useStartObservationPlan()
  const open = isOpenPlan(plan) && plan.observationId === null
  const label = `${plan.teacherName} ${dayLongText(plan.plannedDate)} ${plan.startTime}`
  const lesson = [plan.className, plan.subjectName].filter((part) => part !== null).join(' · ')
  const begin = async () => {
    const outcome = await start.submit({ planId: plan.id, version: plan.version })
    if (outcome.status !== 'success') return
    const observationId = outcome.data.data.observationId
    notify.success(`${plan.teacherName} için gözlem taslağı açıldı.`)
    if (observationId !== null) onOpenObservation(observationId)
  }
  return (
    <li
      aria-label={`${plan.teacherName} gözlem planı`}
      className="grid gap-2 rounded-md border px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-start"
    >
      <div className="grid gap-1 text-sm">
        <p className="font-medium">
          {showDay ? `${dayLongText(plan.plannedDate)} · ` : ''}
          {planTimeText(plan)} · {plan.teacherName}
        </p>
        <p className="text-muted-foreground">
          Gözlemci {plan.observerName}
          {lesson === '' ? '' : ` · ${lesson}`} · {plan.templateName} (sürüm{' '}
          {plan.templateVersionNumber})
          {plan.performancePeriodName === null ? '' : ` · ${plan.performancePeriodName}`}
        </p>
        {plan.note === null ? null : <p>Odak: {plan.note}</p>}
        {plan.status === 'postponed' && plan.postponeReason !== null ? (
          <p className="text-muted-foreground">
            Ertelendi ({plan.postponeCount}): {plan.postponeReason}
          </p>
        ) : null}
        {plan.status === 'cancelled' && plan.cancelReason !== null ? (
          <p className="text-muted-foreground">İptal gerekçesi: {plan.cancelReason}</p>
        ) : null}
        <span className="flex flex-wrap gap-1">
          <StatusBadge
            text={OBSERVATION_PLAN_STATUS_LABELS[plan.status]}
            tone={PLAN_STATUS_TONES[plan.status]}
          />
          {plan.overdue ? <StatusBadge text="Gecikti" tone="red" /> : null}
          {plan.observationStatus === 'draft' ? (
            <StatusBadge text="Gözlem sürüyor" tone="amber" />
          ) : null}
          {plan.pendingNoticeCount > 0 ? (
            <StatusBadge text={`${plan.pendingNoticeCount} bildirim gönderilecek`} tone="gray" />
          ) : null}
        </span>
      </div>
      <span className="flex flex-wrap gap-2 sm:justify-end">
        {canStartPlan(plan, today) ? (
          <Button
            size="sm"
            onClick={() => void begin()}
            disabled={start.isPending}
            aria-busy={start.isPending || undefined}
            aria-label={`${label} planından gözlemi başlat`}
          >
            Gözlemi başlat
          </Button>
        ) : null}
        {plan.observationId === null ? null : (
          <Button
            size="sm"
            variant="outline"
            aria-label={`${label} planının gözlemini aç`}
            onClick={() => onOpenObservation(plan.observationId ?? '')}
          >
            Gözlemi aç
          </Button>
        )}
        {open ? (
          <>
            <Button
              size="sm"
              variant="outline"
              aria-label={`${label} planını düzenle`}
              onClick={() => onDialog({ kind: 'edit', plan })}
            >
              Düzenle
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label={`${label} planını ertele`}
              onClick={() => onDialog({ kind: 'postpone', plan })}
            >
              Ertele
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label={`${label} planını iptal et`}
              onClick={() => onDialog({ kind: 'cancel', plan })}
            >
              İptal et
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          aria-label={`${label} planının bildirimleri`}
          onClick={() => onDialog({ kind: 'notices', plan })}
        >
          Bildirimler
        </Button>
      </span>
    </li>
  )
}

function PlanForm({ plan, onDone }: { plan: ObservationPlan | null; onDone: () => void }) {
  const create = useCreateObservationPlan()
  const update = useUpdateObservationPlan()
  const templates = useLessonObservationTemplates(OPTIONS_PAGE)
  const staff = useCertificateStaff(OPTIONS_PAGE)
  const periods = usePerformancePeriods(OPTIONS_PAGE)
  const classes = useCoreAll('classes')
  const subjects = useCoreAll('subjects')
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: plan === null ? emptyPlanForm(dayKey()) : planFormValues(plan),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const active = (staff.data?.data ?? []).filter((row) => row.active)
  const teachers = active.filter((row) => row.role === 'ogretmen')
  const observers = active.filter((row) => row.role === 'yonetici' || row.role === 'ogretmen')
  const openPeriods = (periods.data?.data ?? []).filter(
    (period) => period.status !== 'closed' || period.id === plan?.performancePeriodId,
  )
  const templateOptions = (templates.data?.data ?? []).map((t) => ({
    value: t.id,
    label: `${t.name} (sürüm ${String(t.versionNumber)})`,
  }))
  if (plan !== null && !templateOptions.some((option) => option.value === plan.templateId))
    templateOptions.unshift({
      value: plan.templateId,
      label: `${plan.templateName} (sürüm ${String(plan.templateVersionNumber)})`,
    })
  const classOptions = (classes.data ?? [])
    .map((row) => row.record)
    .filter((record) => record.isActive !== false || record.id === plan?.classId)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }))
  const subjectOptions = (subjects.data ?? [])
    .map((row) => row.record)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  const onSubmit = form.handleSubmit(async (values) => {
    if (plan === null) {
      const outcome = await create.submit(planCreateBody(values), { setError: form.setError })
      if (outcome.status !== 'success') return
      notify.success(`${outcome.data.data.teacherName} için gözlem planlandı.`)
      onDone()
      return
    }
    const body = planUpdateBody(values, plan)
    if (body === null) {
      onDone()
      return
    }
    const outcome = await update.submit(
      { planId: plan.id, version: plan.version, body },
      { setError: form.setError },
    )
    if (outcome.status === 'success') {
      notify.success('Gözlem planı güncellendi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  const select = (
    name: keyof PlanFormValues,
    label: string,
    empty: string,
    options: readonly { value: string; label: string }[],
    disabled = false,
  ) => (
    <FormField id={`gp-${name}`} label={label} error={errors[name]}>
      {(control) => (
        <NativeSelect
          {...control}
          {...form.register(name)}
          className="w-full"
          disabled={busy || disabled}
        >
          <NativeSelectOption value="">{empty}</NativeSelectOption>
          {options.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
  const teacherOptions = teachers.map((row) => ({ value: row.membershipId, label: row.name }))
  if (plan !== null && !teacherOptions.some((o) => o.value === plan.teacherMembershipId))
    teacherOptions.unshift({ value: plan.teacherMembershipId, label: plan.teacherName })
  return (
    <form
      noValidate
      aria-label={plan === null ? 'Yeni gözlem planı' : 'Gözlem planını düzenle'}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      {select(
        'templateId',
        'Gözlem formu',
        templates.isPending ? 'Formlar yükleniyor…' : 'Form seçin',
        templateOptions,
      )}
      {select(
        'teacherMembershipId',
        'Öğretmen',
        staff.isPending ? 'Personel yükleniyor…' : 'Öğretmen seçin',
        teacherOptions,
        plan !== null,
      )}
      {select(
        'observerMembershipId',
        'Gözlemci',
        staff.isPending ? 'Personel yükleniyor…' : 'Gözlemci seçin',
        observers.map((row) => ({ value: row.membershipId, label: row.name })),
      )}
      <FormField id="gp-gun" label="Plan günü" error={errors.plannedDate}>
        {(control) => (
          <Input
            {...control}
            type="date"
            min={plan === null ? dayKey() : undefined}
            {...form.register('plannedDate')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="gp-saat" label="Başlangıç saati" error={errors.startTime}>
        {(control) => (
          <Input {...control} type="time" {...form.register('startTime')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="gp-sure"
        label="Süre (dakika)"
        error={errors.durationMinutes}
        description={`${String(OBSERVATION_PLAN_DURATION_MIN)}–${String(OBSERVATION_PLAN_DURATION_MAX)} dakika; bir ders saati 40.`}
      >
        {(control) => (
          <Input
            {...control}
            type="number"
            inputMode="numeric"
            min={OBSERVATION_PLAN_DURATION_MIN}
            max={OBSERVATION_PLAN_DURATION_MAX}
            {...form.register('durationMinutes')}
            disabled={busy}
          />
        )}
      </FormField>
      {select(
        'classId',
        'Sınıf (isteğe bağlı)',
        'Sınıf yok',
        classOptions.map((record) => ({ value: record.id, label: record.name })),
      )}
      {select(
        'subjectId',
        'Ders (isteğe bağlı)',
        'Ders yok',
        subjectOptions.map((record) => ({ value: record.id, label: record.name })),
      )}
      {select(
        'performancePeriodId',
        'Performans dönemi (isteğe bağlı)',
        'Döneme bağlama',
        openPeriods.map((period) => ({ value: period.id, label: period.name })),
      )}
      <div className="sm:col-span-2">
        <FormField id="gp-not" label="Gözlemin odağı (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Textarea {...control} rows={2} {...form.register('note')} disabled={busy} />
          )}
        </FormField>
      </div>
      {staff.error || templates.error ? (
        <div className="sm:col-span-2">
          <QueryError
            error={staff.error ?? templates.error}
            onRetry={() => void Promise.all([staff.refetch(), templates.refetch()])}
          />
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {plan === null ? 'Planı kaydet' : 'Değişiklikleri kaydet'}
        </Button>
      </div>
    </form>
  )
}

function PostponeForm({ plan, onDone }: { plan: ObservationPlan; onDone: () => void }) {
  const postpone = usePostponeObservationPlan()
  const form = useForm<PostponeFormValues>({
    resolver: zodResolver(postponeFormSchema),
    defaultValues: postponeFormValues(plan),
  })
  const errors = form.formState.errors
  const busy = postpone.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await postpone.submit(
      { planId: plan.id, version: plan.version, body: postponeBody(values) },
      { setError: form.setError },
    )
    if (outcome.status === 'success') {
      notify.success('Gözlem ertelendi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Gözlem planını ertele"
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm sm:col-span-3">
        {plan.teacherName} · {dayLongText(plan.plannedDate)} {planTimeText(plan)}
      </p>
      <FormField id="gp-ertele-gun" label="Yeni gün" error={errors.plannedDate}>
        {(control) => (
          <Input
            {...control}
            type="date"
            min={dayKey()}
            {...form.register('plannedDate')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="gp-ertele-saat" label="Yeni saat" error={errors.startTime}>
        {(control) => (
          <Input {...control} type="time" {...form.register('startTime')} disabled={busy} />
        )}
      </FormField>
      <FormField id="gp-ertele-sure" label="Süre (dakika)" error={errors.durationMinutes}>
        {(control) => (
          <Input
            {...control}
            type="number"
            inputMode="numeric"
            {...form.register('durationMinutes')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="sm:col-span-3">
        <FormField id="gp-ertele-gerekce" label="Erteleme gerekçesi" error={errors.reason}>
          {(control) => (
            <Textarea {...control} rows={2} {...form.register('reason')} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-3">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Ertele
        </Button>
      </div>
    </form>
  )
}

function CancelForm({ plan, onDone }: { plan: ObservationPlan; onDone: () => void }) {
  const cancel = useCancelObservationPlan()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(cancelFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { planId: plan.id, version: plan.version, body: values },
      { setError: form.setError },
    )
    if (outcome.status === 'success') {
      notify.success('Gözlem planı iptal edildi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Gözlem planını iptal et"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">
        {plan.teacherName} · {dayLongText(plan.plannedDate)} {planTimeText(plan)} planı iptal
        edilir; dönem sınırında sayılmaz.
      </p>
      <FormField id="gp-iptal-gerekce" label="İptal gerekçesi" error={errors.reason}>
        {(control) => (
          <Textarea {...control} rows={2} {...form.register('reason')} disabled={busy} />
        )}
      </FormField>
      <div>
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Planı iptal et
        </Button>
      </div>
    </form>
  )
}

function PlanNotices({ planId }: { planId: string }) {
  const detail = useObservationPlan(planId)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (detail.data === undefined) return <p className="text-sm">Bildirimler yükleniyor…</p>
  const plan = detail.data.data
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        {plan.teacherName} için. Personel bildirim kanalı henüz yok; kayıtlar gönderilecek olarak
        bekler.
      </p>
      {plan.notices.length === 0 ? (
        <p className="text-sm">Bildirim yok.</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {plan.notices.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              <span>
                {OBSERVATION_PLAN_NOTICE_KIND_LABELS[item.kind]} · {dayLongText(item.plannedDate)}{' '}
                {item.startTime}
              </span>
              <StatusBadge text={OBSERVATION_PLAN_NOTICE_STATUS_LABELS[item.status]} tone="gray" />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
