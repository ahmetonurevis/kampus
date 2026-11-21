import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import type { z } from 'zod'
import { useRecordTrialResult } from '@kampus/react-shared/use-prospect-commands.ts'
import {
  prospectStageLabel,
  TRIAL_FIT_LABELS,
  TRIAL_FITS,
  TRIAL_RESULT_NOTE_MAX,
} from '@kampus/school-core/lib/prospects.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Field, FieldError, FieldLegend, FieldSet } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { useCoreItem, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError, useFocusAfterSubmit } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { fieldErrors } from './prospect-forms.ts'
import {
  trialResultBlock,
  trialResultBody,
  trialResultDefaults,
  trialResultFormSchema,
  trialLessonLabel,
  type TrialResultFormValues,
} from './prospect-trial-results.ts'

type Prospect = CoreRecord<'prospects'>
const FIELDS = ['fit', 'note'] as const

/**
 * Deneme sonucu paneli (`?deneme-sonucu=<aday>`): aday kartı tek kayıt ucundan okunur (kapsam dışı
 * aday "Kayıt bulunamadı"), dersin iptali ders programından okunur. Sonuç yeniden yazılabilir; form
 * önceki kararla açılır. `If-Match` kartın okunan sürümüdür (DOM-DIL-031, DOM-YTK-080).
 */
export function TrialResultPanel({
  prospectId,
  groups,
  type,
  now,
  onClose,
}: {
  /** `''` kapalı. */
  prospectId: string
  groups: ReadonlyMap<string, string>
  type: InstitutionType
  now: number
  onClose: () => void
}) {
  const item = useCoreItem('prospects', prospectId === '' ? null : prospectId)
  return (
    <SidePanel
      open={prospectId !== ''}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Deneme dersi sonucu"
    >
      {item.error ? (
        <QueryError error={item.error} onRetry={() => void item.refetch()} />
      ) : !item.data ? (
        <SummaryLoading />
      ) : (
        <TrialResultForm
          key={`${item.data.record.id}:${item.data.version}`}
          prospect={item.data.record}
          version={item.data.version}
          groups={groups}
          type={type}
          now={now}
          onClose={onClose}
        />
      )}
    </SidePanel>
  )
}

function TrialResultForm({
  prospect,
  version,
  groups,
  type,
  now,
  onClose,
}: {
  prospect: Prospect
  version: number
  groups: ReadonlyMap<string, string>
  type: InstitutionType
  now: number
  onClose: () => void
}) {
  const trial = prospect.trialLesson
  // Dersin iptali yalnız ders programındadır; okunamazsa karar sunucuya kalır (409).
  const lesson = useCoreItem('schedule', trial?.lessonId ?? null)
  const record = useRecordTrialResult()
  const form = useForm<TrialResultFormValues, unknown, z.output<typeof trialResultFormSchema>>({
    resolver: zodResolver(trialResultFormSchema),
    defaultValues: trialResultDefaults(trial),
  })
  const busy = record.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const errors = form.formState.errors
  const block = trialResultBlock(prospect, now, Boolean(lesson.data?.record.cancelledAt))
  const note = useWatch({ control: form.control, name: 'note' })

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await record.submit(
      { prospectId: prospect.id, version, body: trialResultBody(values) },
      { setError: fieldErrors(FIELDS, form.setError, focusAfterSubmit) },
    )
    if (outcome.status === 'success') {
      notify.success('Deneme dersi sonucu kaydedildi.')
      onClose()
    }
  })

  return (
    <form
      noValidate
      aria-label="Deneme dersi sonucu"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Aday</dt>
          <dd className="font-medium">
            {prospect.name}
            {prospect.minor !== false ? ' · 18 yaş altı' : ''}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Hedef seviye</dt>
          <dd>{prospect.interest || '—'}</dd>
        </div>
        {trial ? (
          <div className="grid gap-0.5 sm:col-span-2">
            <dt className="text-muted-foreground">Deneme dersi</dt>
            <dd>
              {trialLessonLabel(trial)}
              {groups.get(trial.classId) ? ` · ${groups.get(trial.classId)}` : ''}
            </dd>
          </div>
        ) : null}
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Aşama</dt>
          <dd>{prospectStageLabel(prospect.stage, type)}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        Sonuç adayın aşamasını değiştirmez; kesin kayıt ön büroda yapılır. Kararınızı daha sonra
        düzeltebilirsiniz.
      </p>
      {block ? (
        <p role="status" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
          {block}
        </p>
      ) : null}
      <Controller
        name="fit"
        control={form.control}
        render={({ field }) => (
          <FieldSet data-invalid={Boolean(errors.fit)} className="gap-2">
            <FieldLegend variant="label" className="text-sm font-medium">
              Seviye uygunluğu
            </FieldLegend>
            <RadioGroup
              ref={field.ref}
              name={field.name}
              value={field.value}
              onValueChange={field.onChange}
              disabled={busy || block !== null}
              aria-invalid={errors.fit ? true : undefined}
              aria-describedby={errors.fit ? 'deneme-sonucu-uygunluk-hata' : undefined}
              className="gap-1"
            >
              {TRIAL_FITS.map((fit) => (
                <label
                  key={fit}
                  htmlFor={`deneme-sonucu-${fit}`}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-field px-1 text-sm"
                >
                  <RadioGroupItem id={`deneme-sonucu-${fit}`} value={fit} />
                  {TRIAL_FIT_LABELS[fit]}
                </label>
              ))}
            </RadioGroup>
            <Field data-invalid={Boolean(errors.fit)}>
              <FieldError
                id="deneme-sonucu-uygunluk-hata"
                errors={errors.fit ? [errors.fit] : undefined}
              />
            </Field>
          </FieldSet>
        )}
      />
      <FormField
        id="deneme-sonucu-not"
        label="Kısa not (isteğe bağlı)"
        error={errors.note}
        description={`${note.length}/${TRIAL_RESULT_NOTE_MAX} karakter`}
      >
        {(control) => (
          <Textarea
            {...control}
            {...form.register('note')}
            rows={4}
            maxLength={TRIAL_RESULT_NOTE_MAX}
            placeholder="Dersteki gözleminizi kısaca yazın…"
            disabled={busy || block !== null}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <FormActions
        busy={busy}
        disabled={block !== null}
        onCancel={onClose}
        submitLabel="Sonucu kaydet"
      />
    </form>
  )
}
