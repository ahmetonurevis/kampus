import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import type { z } from 'zod'
import {
  useScheduleProspectMeeting,
  useScheduleTrialLesson,
} from '@kampus/react-shared/use-prospect-commands.ts'
import { MEETING_DURATION } from '@kampus/school-core/lib/prospects.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError, useFocusAfterSubmit } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  fieldErrors,
  clockNow,
  meetingBody,
  meetingDefaults,
  meetingFormSchema,
  trialBody,
  trialDefaults,
  trialFormSchema,
  trialLessonOptions,
  type MeetingFormValues,
  type TrialFormValues,
} from './prospect-forms.ts'

type Prospect = CoreRecord<'prospects'>
export type PlanKind = 'gorusme' | 'deneme'

type PanelProps = {
  /** `''` kapalı; `gorusme` tanışma görüşmesi, `deneme` deneme dersi. */
  kind: string
  prospect: Prospect
  version: number
  /** Öğretmen listesini yalnız yönetici okuyabilir (ön büro seçimi yok). */
  canPickTeacher: boolean
  onClose: () => void
}

/**
 * Planlama paneli: tanışma görüşmesi (DOM-KAY-033) ve dil okulunda deneme dersi (DOM-KAY-034)
 * kısa formlardır, sağ panelde açılır (`?planlama=gorusme|deneme`). Çakışma ve kapasite hataları
 * (`meeting_conflict`, `prospect_schedule_conflict`, `trial_lesson_full` …) toast değil alan hatasıdır.
 */
export function ProspectPlanPanel({
  kind,
  prospect,
  version,
  canPickTeacher,
  onClose,
}: PanelProps) {
  const meeting = kind === 'gorusme'
  const trial = kind === 'deneme'
  return (
    <SidePanel
      open={meeting || trial}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={trial ? 'Deneme dersi planla' : 'Tanışma görüşmesi planla'}
    >
      {meeting ? (
        <MeetingForm
          prospect={prospect}
          version={version}
          canPickTeacher={canPickTeacher}
          onClose={onClose}
        />
      ) : null}
      {trial ? <TrialForm prospect={prospect} version={version} onClose={onClose} /> : null}
    </SidePanel>
  )
}

/**
 * Tanışma görüşmesi formu (DOM-KAY-033). Aday detayındaki panel ve Tanışma Görüşmeleri'ndeki aday
 * seçmeli panel (`MeetingPlanPanel`) aynı formu kullanır.
 */
export function MeetingForm({
  prospect,
  version,
  canPickTeacher,
  onClose,
}: Omit<PanelProps, 'kind'>) {
  const schedule = useScheduleProspectMeeting()
  const teachers = useCoreAll('teachers', {}, { enabled: canPickTeacher })
  const [today] = useState(() => dayKey(Date.now()))
  const form = useForm<MeetingFormValues, unknown, z.output<typeof meetingFormSchema>>({
    resolver: zodResolver(meetingFormSchema),
    defaultValues: meetingDefaults(),
  })
  const busy = schedule.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const errors = form.formState.errors
  const campusTeachers = (teachers.data ?? []).filter(
    (item) => item.record.isActive && item.record.branchId === prospect.branchId,
  )

  const onSubmit = form.handleSubmit(async (values) => {
    const result = meetingBody(values, clockNow())
    if (!result.ok) {
      form.setError(result.field, { type: 'manual', message: result.message })
      focusAfterSubmit(result.field)
      return
    }
    const outcome = await schedule.submit(
      { prospectId: prospect.id, version, body: result.body },
      {
        setError: fieldErrors(
          ['date', 'time', 'duration', 'room', 'teacherId'],
          form.setError,
          focusAfterSubmit,
        ),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Tanışma görüşmesi planlandı.')
      onClose()
    }
  })

  return (
    <form
      noValidate
      aria-label="Tanışma görüşmesi planla"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">
        Görüşme adayın kampüsünde, gelecek bir anda yapılır; aynı oda veya öğretmen için süre
        örtüşemez. Yeniden planlama öncekinin yerini alır.
      </p>
      <FormField id="gorusme-gun" label="Görüşme günü" error={errors.date}>
        {(control) => (
          <Input {...control} {...form.register('date')} type="date" min={today} disabled={busy} />
        )}
      </FormField>
      <FormField id="gorusme-saat" label="Başlangıç saati" error={errors.time}>
        {(control) => (
          <Input {...control} {...form.register('time')} type="time" step={300} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="gorusme-sure"
        label="Süre (dakika)"
        description={`${MEETING_DURATION.min}–${MEETING_DURATION.max} dakika.`}
        error={errors.duration}
      >
        {(control) => (
          <Input
            {...control}
            {...form.register('duration')}
            type="number"
            inputMode="numeric"
            min={MEETING_DURATION.min}
            max={MEETING_DURATION.max}
            step={5}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="gorusme-oda" label="Görüşme odası" error={errors.room}>
        {(control) => (
          <Input {...control} {...form.register('room')} maxLength={40} disabled={busy} />
        )}
      </FormField>
      {canPickTeacher ? (
        <FormField
          id="gorusme-ogretmen"
          label="Görevli öğretmen (isteğe bağlı)"
          error={errors.teacherId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('teacherId')}
              className="w-full"
              disabled={busy || !teachers.data}
            >
              <NativeSelectOption value="">
                {teachers.data ? 'Öğretmen yok' : 'Öğretmenler yükleniyor…'}
              </NativeSelectOption>
              {campusTeachers.map((item) => (
                <NativeSelectOption key={item.record.id} value={item.record.id}>
                  {item.record.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onClose} submitLabel="Planla" />
    </form>
  )
}

function TrialForm({ prospect, version, onClose }: Omit<PanelProps, 'kind' | 'canPickTeacher'>) {
  const schedule = useScheduleTrialLesson()
  const [now] = useState(() => Date.now())
  const classes = useCoreAll('classes', { filters: { branchId: prospect.branchId } })
  const groups = useMemo(
    () =>
      new Map(
        (classes.data ?? [])
          .filter((item) => item.record.isActive)
          .map((item) => [item.record.id, item.record.name]),
      ),
    [classes.data],
  )
  const groupIds = [...groups.keys()]
  // Sınıf süzgeci gönderilmez: API `classId` için en çok 20 değer alır ve tek sayfa 100 kayıttır.
  // 3 haftalık iptal edilmemiş dersler bütün sayfalarıyla okunur; adayın kampüsündeki açık
  // gruplara süzme `trialLessonOptions` içinde yapılır.
  const lessons = useCoreAll(
    'schedule',
    {
      sort: ['date'],
      filters: {
        cancelled: 'false',
        dateFrom: dayKey(now),
        dateTo: dayKey(now + 21 * 86_400_000),
      },
    },
    { enabled: groupIds.length > 0 },
  )
  const options = useMemo(
    () =>
      trialLessonOptions(
        (lessons.data ?? []).map((item) => item.record),
        groups,
        now,
      ),
    [lessons.data, groups, now],
  )
  const minor = prospect.minor !== false
  const form = useForm<TrialFormValues, unknown, z.output<typeof trialFormSchema>>({
    resolver: zodResolver(trialFormSchema),
    defaultValues: trialDefaults(),
  })
  const busy = schedule.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await schedule.submit(
      { prospectId: prospect.id, version, body: trialBody(values, minor) },
      { setError: fieldErrors(['lessonId', 'guardianConsent'], form.setError, focusAfterSubmit) },
    )
    if (outcome.status === 'success') {
      notify.success('Deneme dersi planlandı.')
      onClose()
    }
  })

  if (classes.error)
    return <QueryError error={classes.error} onRetry={() => void classes.refetch()} />
  if (lessons.error)
    return <QueryError error={lessons.error} onRetry={() => void lessons.refetch()} />
  if (!classes.data || (groupIds.length > 0 && lessons.isPending)) return <SummaryLoading />

  return (
    <form
      noValidate
      aria-label="Deneme dersi planla"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">
        Aday, kendi kampüsündeki açık grupların önümüzdeki üç haftadaki derslerine deneme
        katılımcısı olarak yazılır. Bir derse en çok iki deneme katılımcısı alınır.
      </p>
      {options.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Bu kampüste önümüzdeki üç haftada seçilebilir ders yok.
        </p>
      ) : (
        <FormField id="deneme-ders" label="Deneme dersi" error={errors.lessonId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('lessonId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Ders seçin</NativeSelectOption>
              {options.map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      )}
      {minor ? (
        <div className="grid gap-2">
          <Controller
            name="guardianConsent"
            control={form.control}
            render={({ field }) => (
              <div className="flex items-center gap-2.5">
                <Checkbox
                  id="deneme-veli-onayi"
                  checked={field.value === true}
                  onCheckedChange={(value) => field.onChange(value === true)}
                  disabled={busy}
                  aria-invalid={errors.guardianConsent ? true : undefined}
                  aria-describedby={errors.guardianConsent ? 'deneme-veli-onayi-hata' : undefined}
                />
                <Label htmlFor="deneme-veli-onayi" className="font-normal">
                  Velinin deneme dersi için onay verdiğini kaydediyorum
                </Label>
              </div>
            )}
          />
          <Field data-invalid={Boolean(errors.guardianConsent)}>
            <FieldError
              id="deneme-veli-onayi-hata"
              errors={errors.guardianConsent ? [errors.guardianConsent] : undefined}
            />
          </Field>
        </div>
      ) : null}
      <RootError message={errors.root?.server?.message} />
      <FormActions
        busy={busy}
        disabled={options.length === 0}
        onCancel={onClose}
        submitLabel="Planla"
      />
    </form>
  )
}
