import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCreateDevelopmentGoal,
  useFollowUpDevelopmentGoal,
  useUpdateDevelopmentGoal,
  type DevelopmentGoalDetail,
} from '@kampus/react-shared/use-finance-development-goals.ts'
import { usePerformancePeriods } from '@kampus/react-shared/use-finance-performance.ts'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  emptyFollowUp,
  emptyGoal,
  followUpBody,
  followUpFormSchema,
  goalCreateBody,
  goalFormSchema,
  goalStatusLabel,
  goalUpdateBody,
  goalValues,
  nextStatuses,
  type FollowUpFormValues,
  type GoalFormValues,
} from './finance-development-goal-forms.ts'

// Gelişim hedefi formları (DOM-FIN-133; ON-209; K-455): yeni hedef (gözlem görüşmesinden ya da
// doğrudan), hedef düzeltmesi ve takip notu. Görüşme bölümü ve "Gelişim hedefleri" görünümü
// aynı formları kullanır.

const OPTIONS_PAGE = { page: 1, pageSize: 100 } as const

function PeriodSelect({
  id,
  value,
  register,
  disabled,
  error,
}: {
  id: string
  value: string
  register: ReturnType<ReturnType<typeof useForm<GoalFormValues>>['register']>
  disabled: boolean
  error: { message?: string } | undefined
}) {
  const periods = usePerformancePeriods(OPTIONS_PAGE)
  const options = (periods.data?.data ?? []).filter(
    (period) => period.status !== 'closed' || period.id === value,
  )
  return (
    <FormField id={id} label="Performans dönemi (isteğe bağlı)" error={error}>
      {(control) => (
        <NativeSelect {...control} {...register} className="w-full" disabled={disabled}>
          <NativeSelectOption value="">Döneme bağlama</NativeSelectOption>
          {options.map((period) => (
            <NativeSelectOption key={period.id} value={period.id}>
              {period.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}

/** Yeni hedef: `debriefId` verilirse öğretmen gözlemden gelir, yoksa öğretmen seçilir. */
export function GoalCreateForm({
  debriefId,
  teacherName,
  onDone,
}: {
  debriefId: string | null
  teacherName?: string
  onDone: () => void
}) {
  const create = useCreateDevelopmentGoal()
  const staff = useCertificateStaff(OPTIONS_PAGE, debriefId === null)
  const form = useForm<GoalFormValues>({
    resolver: zodResolver(
      debriefId === null
        ? goalFormSchema.refine((values) => values.teacherMembershipId !== '', {
            message: 'Öğretmeni seçin.',
            path: ['teacherMembershipId'],
          })
        : goalFormSchema,
    ),
    defaultValues: emptyGoal(dayKey()),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const teachers = (staff.data?.data ?? []).filter((row) => row.active && row.role === 'ogretmen')
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(goalCreateBody(values, debriefId), {
      setError: form.setError,
    })
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.teacherName} için gelişim hedefi açıldı.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Yeni gelişim hedefi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      {debriefId === null ? (
        <FormField id="gh-ogretmen" label="Öğretmen" error={errors.teacherMembershipId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('teacherMembershipId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">
                {staff.isPending ? 'Personel yükleniyor…' : 'Öğretmen seçin'}
              </NativeSelectOption>
              {teachers.map((row) => (
                <NativeSelectOption key={row.membershipId} value={row.membershipId}>
                  {row.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : (
        <p className="text-sm sm:col-span-2">
          Öğretmen: {teacherName ?? '—'} (gözlem görüşmesinden)
        </p>
      )}
      <FormField id="gh-hedef" label="Hedef" error={errors.title}>
        {(control) => <Input {...control} {...form.register('title')} disabled={busy} />}
      </FormField>
      <FormField id="gh-olcut" label="Ölçüt" error={errors.successCriterion}>
        {(control) => (
          <Textarea {...control} rows={2} {...form.register('successCriterion')} disabled={busy} />
        )}
      </FormField>
      <FormField id="gh-takip" label="Takip tarihi" error={errors.followUpDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('followUpDate')} disabled={busy} />
        )}
      </FormField>
      <PeriodSelect
        id="gh-donem"
        value=""
        register={form.register('performancePeriodId')}
        disabled={busy}
        error={errors.performancePeriodId}
      />
      {staff.error ? (
        <div className="sm:col-span-2">
          <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Hedefi aç
        </Button>
      </div>
    </form>
  )
}

/** Süren hedefin düzeltmesi (K-455); yalnız değişen alanlar gönderilir. */
export function GoalEditForm({
  goal,
  onDone,
}: {
  goal: DevelopmentGoalDetail
  onDone: () => void
}) {
  const update = useUpdateDevelopmentGoal()
  const form = useForm<GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: goalValues(goal),
  })
  const errors = form.formState.errors
  const busy = update.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const body = goalUpdateBody(goal, values)
    if (body === null) {
      onDone()
      return
    }
    const outcome = await update.submit(
      { goalId: goal.id, version: goal.version, body },
      { setError: form.setError },
    )
    if (outcome.status === 'success') {
      notify.success('Gelişim hedefi güncellendi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Gelişim hedefini düzenle"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="ghd-hedef" label="Hedef" error={errors.title}>
        {(control) => <Input {...control} {...form.register('title')} disabled={busy} />}
      </FormField>
      <FormField id="ghd-olcut" label="Ölçüt" error={errors.successCriterion}>
        {(control) => (
          <Textarea {...control} rows={2} {...form.register('successCriterion')} disabled={busy} />
        )}
      </FormField>
      <FormField id="ghd-takip" label="Takip tarihi" error={errors.followUpDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('followUpDate')} disabled={busy} />
        )}
      </FormField>
      <PeriodSelect
        id="ghd-donem"
        value={goal.performancePeriodId ?? ''}
        register={form.register('performancePeriodId')}
        disabled={busy}
        error={errors.performancePeriodId}
      />
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/** Takip notu (K-455): not zorunlu; durum yalnız ileri, kapanan hedefe tarih verilmez. */
export function FollowUpForm({
  goal,
  onDone,
}: {
  goal: DevelopmentGoalDetail
  onDone: () => void
}) {
  const followUp = useFollowUpDevelopmentGoal()
  const form = useForm<FollowUpFormValues>({
    resolver: zodResolver(followUpFormSchema),
    defaultValues: emptyFollowUp(),
  })
  const errors = form.formState.errors
  const busy = followUp.isPending || form.formState.isSubmitting
  const status = useWatch({ control: form.control, name: 'status' })
  const closing = status === 'achieved' || status === 'dropped'
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await followUp.submit(
      {
        goalId: goal.id,
        version: goal.version,
        body: followUpBody(closing ? { ...values, nextFollowUpDate: '' } : values),
      },
      { setError: form.setError },
    )
    if (outcome.status === 'success') {
      notify.success('Takip notu kaydedildi.')
      form.reset(emptyFollowUp())
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Takip notu"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="gt-not" label="Takip notu" error={errors.note}>
          {(control) => (
            <Textarea {...control} rows={2} {...form.register('note')} disabled={busy} />
          )}
        </FormField>
      </div>
      <FormField id="gt-durum" label="Yeni durum" error={errors.status}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('status')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Durum değişmesin</NativeSelectOption>
            {nextStatuses(goal.status).map((value) => (
              <NativeSelectOption key={value} value={value}>
                {goalStatusLabel(value)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {closing ? null : (
        <FormField id="gt-sonraki" label="Sonraki takip tarihi" error={errors.nextFollowUpDate}>
          {(control) => (
            <Input
              {...control}
              type="date"
              {...form.register('nextFollowUpDate')}
              disabled={busy}
            />
          )}
        </FormField>
      )}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Notu kaydet
        </Button>
      </div>
    </form>
  )
}
