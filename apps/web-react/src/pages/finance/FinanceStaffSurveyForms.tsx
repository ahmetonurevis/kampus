import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { useOrgChart } from '@kampus/react-shared/use-finance-org-chart.ts'
import {
  useCreateStaffSurvey,
  useRespondStaffSurvey,
  useUpdateStaffSurvey,
  type AssignedStaffSurvey,
  type StaffSurveyDetail,
} from '@kampus/react-shared/use-finance-staff-surveys.ts'
import {
  STAFF_SURVEY_QUESTION_KIND_LABELS,
  STAFF_SURVEY_QUESTION_KINDS,
  STAFF_SURVEY_QUESTIONS_MAX,
  STAFF_SURVEY_ROLE_LABELS,
} from '@kampus/school-core/lib/finance-staff-surveys.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { STAFF_ROLES, type StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  emptyStaffSurvey,
  emptyStaffSurveyQuestion,
  STAFF_SURVEY_THRESHOLD_OPTIONS,
  staffSurveyAnswerDefaults,
  staffSurveyAnswerFormSchema,
  staffSurveyAnswersBody,
  staffSurveyCreateBody,
  staffSurveyFormSchema,
  staffSurveyScaleOptions,
  staffSurveyUpdateBody,
  staffSurveyValues,
  type StaffSurveyAnswerFormValues,
  type StaffSurveyFormValues,
} from './finance-staff-survey-forms.ts'

// Personel memnuniyet anketi formları (DOM-FIN-143; ON-191): anket taslağı (yeni ve düzeltme;
// K-484) ve personelin kendi yanıtı (K-485). Kural doğrulaması sunucudadır; form yalnız biçimi
// denetler.

function toggle<T>(list: readonly T[], value: T, on: boolean): T[] {
  return on ? [...list, value] : list.filter((item) => item !== value)
}

/** Yeni taslak (`survey` yok) ya da taslak düzeltmesi. */
export function StaffSurveyForm({
  survey,
  onDone,
}: {
  survey?: StaffSurveyDetail
  onDone: (surveyId: string) => void
}) {
  const create = useCreateStaffSurvey()
  const update = useUpdateStaffSurvey()
  const chart = useOrgChart()
  const form = useForm<StaffSurveyFormValues>({
    resolver: zodResolver(staffSurveyFormSchema),
    defaultValues: survey === undefined ? emptyStaffSurvey(dayKey()) : staffSurveyValues(survey),
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'questions' })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const units = (chart.data?.data.units ?? []).filter(
    (unit) => unit.isActive || survey?.audience.unitIds.includes(unit.id) === true,
  )
  const listError = errors.questions?.root?.message ?? errors.questions?.message
  const onSubmit = form.handleSubmit(async (values) => {
    const setError = (_name: string, error: { message: string }) =>
      form.setError('root.server', error)
    if (survey === undefined) {
      const outcome = await create.submit(staffSurveyCreateBody(values), { setError })
      if (outcome.status !== 'success') return
      notify.success('Anket taslağı açıldı.')
      onDone(outcome.data.data.id)
      return
    }
    const body = staffSurveyUpdateBody(survey, values)
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
      aria-label={survey === undefined ? 'Yeni personel anketi' : 'Anket taslağı'}
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="pa-baslik" label="Anket başlığı" error={errors.title}>
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('title')} disabled={busy} />
        )}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="pa-acilis" label="Açılış günü" error={errors.openDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('openDate')} disabled={busy} />
          )}
        </FormField>
        <FormField id="pa-kapanis" label="Kapanış günü" error={errors.closeDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('closeDate')} disabled={busy} />
          )}
        </FormField>
        <FormField id="pa-esik" label="Anonimlik eşiği" error={errors.anonymityThreshold}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('anonymityThreshold')}
              className="w-full"
              disabled={busy}
            >
              {survey === undefined ? (
                <NativeSelectOption value="">Kurum ayarı</NativeSelectOption>
              ) : null}
              {STAFF_SURVEY_THRESHOLD_OPTIONS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  En az {value} yanıt
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Hedef kitle: roller (boş = bütün personel)</legend>
        <Controller
          control={form.control}
          name="roles"
          render={({ field }) => (
            <div className="flex flex-wrap gap-4">
              {STAFF_ROLES.map((role: StaffRole) => (
                <div key={role} className="flex min-h-11 items-center gap-2">
                  <Checkbox
                    id={`pa-rol-${role}`}
                    checked={field.value.includes(role)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      field.onChange(toggle(field.value, role, checked === true))
                    }
                  />
                  <Label htmlFor={`pa-rol-${role}`}>{STAFF_SURVEY_ROLE_LABELS[role]}</Label>
                </div>
              ))}
            </div>
          )}
        />
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">
          Hedef kitle: birimler (boş = birim süzgeci yok; alt birimler ayrıca seçilir)
        </legend>
        {chart.error ? (
          <QueryError error={chart.error} onRetry={() => void chart.refetch()} />
        ) : units.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {chart.isPending ? 'Birimler yükleniyor…' : 'Organizasyonda birim tanımlı değil.'}
          </p>
        ) : (
          <Controller
            control={form.control}
            name="unitIds"
            render={({ field }) => (
              <div className="flex flex-wrap gap-4">
                {units.map((unit) => (
                  <div key={unit.id} className="flex min-h-11 items-center gap-2">
                    <Checkbox
                      id={`pa-birim-${unit.id}`}
                      checked={field.value.includes(unit.id)}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        field.onChange(toggle(field.value, unit.id, checked === true))
                      }
                    />
                    <Label htmlFor={`pa-birim-${unit.id}`}>{unit.name}</Label>
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
              id={`pa-soru-${number}`}
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
            <FormField id={`pa-soru-turu-${number}`} label={`${number}. soru türü`}>
              {(props) => (
                <NativeSelect
                  {...props}
                  {...form.register(`questions.${index}.kind`)}
                  className="w-full"
                  disabled={busy}
                >
                  {STAFF_SURVEY_QUESTION_KINDS.map((kind) => (
                    <NativeSelectOption key={kind} value={kind}>
                      {STAFF_SURVEY_QUESTION_KIND_LABELS[kind]}
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
                      id={`pa-zorunlu-${number}`}
                      checked={control.value}
                      disabled={busy}
                      onCheckedChange={(checked) => control.onChange(checked === true)}
                    />
                  )}
                />
                <Label htmlFor={`pa-zorunlu-${number}`}>{number}. soru zorunlu</Label>
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
          disabled={busy || fields.length >= STAFF_SURVEY_QUESTIONS_MAX}
          onClick={() => append(emptyStaffSurveyQuestion())}
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
        Yayımlandıktan sonra sorular, tarihler, hedef kitle ve eşik değişmez; değişiklik için yeni
        sürüm açılır.
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

/** Personelin kendi yanıtı (K-485): bir kez gönderilir, sonra değiştirilemez. */
export function StaffSurveyAnswerForm({
  survey,
  onDone,
}: {
  survey: AssignedStaffSurvey
  onDone: () => void
}) {
  const respond = useRespondStaffSurvey()
  const form = useForm<StaffSurveyAnswerFormValues>({
    resolver: zodResolver(staffSurveyAnswerFormSchema(survey.questions)),
    defaultValues: staffSurveyAnswerDefaults(survey.questions),
  })
  const errors = form.formState.errors
  const busy = respond.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await respond.submit(
      { surveyId: survey.id, body: staffSurveyAnswersBody(survey.questions, values) },
      { setError: (_name, error) => form.setError('root.server', error) },
    )
    if (outcome.status !== 'success') return
    notify.success('Yanıtınız alındı. Teşekkürler.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label={`${survey.title} yanıtı`}
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted-foreground">
        Yanıtınız adınızla saklanmaz; yalnız yanıt verdiğiniz işaretlenir. Sonuçlar anket kapanınca
        ve en az {String(survey.anonymityThreshold)} yanıtla toplu gösterilir. Gönderdikten sonra
        yanıt değiştirilemez.
      </p>
      {survey.questions.map((question, index) => {
        const id = `pa-cevap-${String(index + 1)}`
        const label = `${question.text}${question.required ? '' : ' (isteğe bağlı)'}`
        return question.kind === 'open' ? (
          <FormField key={id} id={id} label={label} error={errors.answers?.[index]?.text}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                {...form.register(`answers.${index}.text`)}
                disabled={busy}
              />
            )}
          </FormField>
        ) : (
          <FormField key={id} id={id} label={label} error={errors.answers?.[index]?.value}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register(`answers.${index}.value`)}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Seçin</NativeSelectOption>
                {staffSurveyScaleOptions(question.kind).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {question.kind === 'likert'
                      ? `${value}${value === '1' ? ' (hiç katılmıyorum)' : value === '5' ? ' (tamamen katılıyorum)' : ''}`
                      : `${value}${value === '0' ? ' (hiç)' : value === '10' ? ' (kesinlikle)' : ''}`}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )
      })}
      <div>
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Yanıtı gönder
        </Button>
      </div>
    </form>
  )
}
