import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import {
  useCreateTeacherFeedbackSurvey,
  useUpdateTeacherFeedbackSurvey,
  type TeacherFeedbackDetail,
} from '@kampus/react-shared/use-finance-teacher-feedback.ts'
import {
  TEACHER_FEEDBACK_QUESTION_KIND_LABELS,
  TEACHER_FEEDBACK_QUESTION_KINDS,
  TEACHER_FEEDBACK_QUESTIONS_MAX,
  TEACHER_FEEDBACK_RESPONDENT_LABELS,
  TEACHER_FEEDBACK_RESPONDENT_ROLES,
} from '@kampus/school-core/lib/finance-teacher-feedback.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  emptyTeacherFeedback,
  emptyTeacherFeedbackQuestion,
  TEACHER_FEEDBACK_THRESHOLD_OPTIONS,
  teacherFeedbackCreateBody,
  teacherFeedbackFormSchema,
  teacherFeedbackUpdateBody,
  teacherFeedbackValues,
  type TeacherFeedbackFormValues,
} from './finance-teacher-feedback-forms.ts'

// Öğretmen geri bildirim anketi formu (DOM-FIN-159; ON-213): yeni taslak ve taslak düzeltmesi.
// Kural doğrulaması sunucudadır; form yalnız biçimi denetler. Eşik 5'in altına seçilemez (K-532).

function toggle<T>(list: readonly T[], value: T, on: boolean): T[] {
  return on ? [...list, value] : list.filter((item) => item !== value)
}

export function TeacherFeedbackForm({
  survey,
  onDone,
}: {
  survey?: TeacherFeedbackDetail
  onDone: (surveyId: string) => void
}) {
  const create = useCreateTeacherFeedbackSurvey()
  const update = useUpdateTeacherFeedbackSurvey()
  const classes = useCoreAll('classes')
  const form = useForm<TeacherFeedbackFormValues>({
    resolver: zodResolver(teacherFeedbackFormSchema),
    defaultValues:
      survey === undefined ? emptyTeacherFeedback(dayKey()) : teacherFeedbackValues(survey),
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'questions' })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const classOptions = useMemo(
    () =>
      (classes.data ?? [])
        .map((row) => row.record)
        .filter(
          (record) =>
            record.isActive !== false || survey?.audience.classIds.includes(record.id) === true,
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true })),
    [classes.data, survey],
  )
  const listError = errors.questions?.root?.message ?? errors.questions?.message
  const onSubmit = form.handleSubmit(async (values) => {
    const setError = (_name: string, error: { message: string }) =>
      form.setError('root.server', error)
    if (survey === undefined) {
      const outcome = await create.submit(teacherFeedbackCreateBody(values), { setError })
      if (outcome.status !== 'success') return
      notify.success('Geri bildirim anketi taslağı açıldı.')
      onDone(outcome.data.data.id)
      return
    }
    const body = teacherFeedbackUpdateBody(survey, values)
    if (body === null) {
      onDone(survey.id)
      return
    }
    const outcome = await update.submit(
      { surveyId: survey.id, version: survey.version, body },
      { setError },
    )
    if (outcome.status === 'success') {
      notify.success('Anket taslağı kaydedildi.')
      onDone(survey.id)
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict')
      onDone(survey.id)
  })
  return (
    <form
      noValidate
      aria-label={survey === undefined ? 'Yeni öğretmen geri bildirim anketi' : 'Anket taslağı'}
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="og-baslik" label="Anket başlığı" error={errors.title}>
          {(control) => (
            <Input {...control} autoComplete="off" {...form.register('title')} disabled={busy} />
          )}
        </FormField>
        <FormField id="og-donem" label="Dönem" error={errors.term}>
          {(control) => (
            <Input
              {...control}
              autoComplete="off"
              placeholder="Örn. 2026–2027 1. dönem"
              {...form.register('term')}
              disabled={busy}
            />
          )}
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="og-acilis" label="Açılış günü" error={errors.openDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('openDate')} disabled={busy} />
          )}
        </FormField>
        <FormField id="og-kapanis" label="Kapanış günü" error={errors.closeDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('closeDate')} disabled={busy} />
          )}
        </FormField>
        <FormField id="og-esik" label="Anonimlik eşiği" error={errors.anonymityThreshold}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('anonymityThreshold')}
              className="w-full"
              disabled={busy}
            >
              {TEACHER_FEEDBACK_THRESHOLD_OPTIONS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  Öğretmen başına en az {value} yanıt
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Yanıtlayanlar</legend>
        <Controller
          control={form.control}
          name="respondents"
          render={({ field }) => (
            <div className="flex flex-wrap gap-4">
              {TEACHER_FEEDBACK_RESPONDENT_ROLES.map((role) => (
                <div key={role} className="flex min-h-11 items-center gap-2">
                  <Checkbox
                    id={`og-yanitlayan-${role}`}
                    checked={field.value.includes(role)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      field.onChange(toggle(field.value, role, checked === true))
                    }
                  />
                  <Label htmlFor={`og-yanitlayan-${role}`}>
                    {TEACHER_FEEDBACK_RESPONDENT_LABELS[role]}
                  </Label>
                </div>
              ))}
            </div>
          )}
        />
        {errors.respondents?.message ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.respondents.message}
          </p>
        ) : null}
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Sınıflar (boş = bütün sınıflar)</legend>
        {classes.error ? (
          <QueryError error={classes.error} onRetry={() => void classes.refetch()} />
        ) : classOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {classes.isPending ? 'Sınıflar yükleniyor…' : 'Kurumda sınıf tanımlı değil.'}
          </p>
        ) : (
          <Controller
            control={form.control}
            name="classIds"
            render={({ field }) => (
              <div className="flex flex-wrap gap-4">
                {classOptions.map((row) => (
                  <div key={row.id} className="flex min-h-11 items-center gap-2">
                    <Checkbox
                      id={`og-sinif-${row.id}`}
                      checked={field.value.includes(row.id)}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        field.onChange(toggle(field.value, row.id, checked === true))
                      }
                    />
                    <Label htmlFor={`og-sinif-${row.id}`}>{row.name}</Label>
                  </div>
                ))}
              </div>
            )}
          />
        )}
      </fieldset>
      {fields.map((field, index) => {
        const number = String(index + 1)
        return (
          <fieldset key={field.id} className="grid gap-2 border-b pb-3 sm:grid-cols-[3fr_1fr]">
            <legend className="sr-only">{number}. soru</legend>
            <FormField
              id={`og-soru-${number}`}
              label={`${number}. soru`}
              error={errors.questions?.[index]?.text}
            >
              {(props) => (
                <Input
                  {...props}
                  autoComplete="off"
                  {...form.register(`questions.${index}.text`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField id={`og-soru-turu-${number}`} label={`${number}. soru türü`}>
              {(props) => (
                <NativeSelect
                  {...props}
                  {...form.register(`questions.${index}.kind`)}
                  className="w-full"
                  disabled={busy}
                >
                  {TEACHER_FEEDBACK_QUESTION_KINDS.map((kind) => (
                    <NativeSelectOption key={kind} value={kind}>
                      {TEACHER_FEEDBACK_QUESTION_KIND_LABELS[kind]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
              <div className="flex min-h-11 items-center gap-2">
                <Controller
                  control={form.control}
                  name={`questions.${index}.required`}
                  render={({ field: control }) => (
                    <Checkbox
                      id={`og-zorunlu-${number}`}
                      checked={control.value}
                      disabled={busy}
                      onCheckedChange={(checked) => control.onChange(checked === true)}
                    />
                  )}
                />
                <Label htmlFor={`og-zorunlu-${number}`}>{number}. soru zorunlu</Label>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                aria-label={`${number}. soruyu kaldır`}
                disabled={busy || fields.length === 1}
                onClick={() => remove(index)}
              >
                Kaldır
              </Button>
            </div>
          </fieldset>
        )
      })}
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={busy || fields.length >= TEACHER_FEEDBACK_QUESTIONS_MAX}
          onClick={() => append(emptyTeacherFeedbackQuestion())}
        >
          Soru ekle
        </Button>
      </div>
      {listError ? (
        <p role="alert" className="text-sm text-destructive">
          {listError}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Yanıtlayan yalnız kendi (velide çocuğunun) sınıfının öğretmenlerini, her öğretmeni bir kez
        değerlendirir. Yayımlandıktan sonra sorular, tarihler, hedef kitle ve eşik değişmez.
      </p>
      <div>
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Taslağı kaydet
        </Button>
      </div>
    </form>
  )
}
