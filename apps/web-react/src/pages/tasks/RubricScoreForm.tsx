import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch, type Resolver } from 'react-hook-form'
import { useScoreTaskSubmission } from '@kampus/react-shared/use-task-grading.ts'
import type { RubricVersion } from '@kampus/react-shared/use-rubrics.ts'
import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import { bandMeaning } from '@kampus/school-core/skills/rubric.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  aspectLabel,
  bandMeaningLabel,
  bandNeedsComment,
  showsStaleNotice,
  scoreBody,
  scoreFormSchema,
  type ScoreFormValues,
} from './task-model.ts'

type Props = {
  submission: TaskSubmissionDetail
  rubric: RubricVersion
  /** Puanlanan sürüm (son sürüm) numarası. */
  versionNumber: number
  onScored?: () => void
  /** Teslim eskidi: uyarıyı pencere gösterir (hata tek yerde). */
  onStaleChange: (stale: boolean) => void
}

const SCORE_FIELD = /^(criteria\.\d+\.(band|comment)|overallComment)$/

/**
 * Rubrik puanı formu (DOM-BEC-020…023): her kritere bir bant (0–5) ve gerekirse yorum, genel
 * geri bildirim. Toplam ve yüzde sunucuda hesaplanır; istemci toplam göndermez. Hedefin altındaki
 * bantta (0–2) kriter yorumu zorunludur. 409'da (başka puan, yeni sürüm, sürüm çakışması) ekran
 * güncel teslimi yükler; uyarıyı pencere gösterir ve yazılan yorumlar korunur.
 */
export function RubricScoreForm({
  submission,
  rubric,
  versionNumber,
  onScored,
  onStaleChange,
}: Props) {
  const score = useScoreTaskSubmission()
  const form = useForm<ScoreFormValues>({
    resolver: zodResolver(scoreFormSchema) as unknown as Resolver<ScoreFormValues>,
    defaultValues: {
      criteria: rubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        band: null,
        comment: '',
      })),
      overallComment: '',
    },
  })
  const watched = useWatch({ control: form.control, name: 'criteria' })
  const busy = score.isPending || form.formState.isSubmitting
  const version = submission.rowVersion
  const errors = form.formState.errors

  const submit = form.handleSubmit(async (values) => {
    if (version === null) return
    onStaleChange(false)
    const outcome = await score.submit(
      { submissionId: submission.id, version, score: scoreBody(values, versionNumber) },
      {
        silent: showsStaleNotice,
        setError: (name, error) =>
          form.setError((SCORE_FIELD.test(name) ? name : 'root.server') as 'overallComment', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Puan kaydedildi.')
      onScored?.()
    } else if (outcome.status === 'failed' && showsStaleNotice(outcome.error)) {
      onStaleChange(true)
    }
  })

  return (
    <form
      noValidate
      aria-label="Rubrik puanı"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(event)
      }}
      className="grid gap-5"
    >
      {rubric.criteria.map((criterion, index) => {
        const band = watched[index]?.band ?? null
        const bandError = errors.criteria?.[index]?.band
        const commentError = errors.criteria?.[index]?.comment
        return (
          <fieldset
            key={criterion.id}
            className="grid gap-3 rounded-card border p-4"
            aria-describedby={bandError ? `kriter-${index}-bant-hata` : undefined}
          >
            <legend className="px-1 text-sm font-semibold">
              {aspectLabel(criterion.aspect)}
              <span className="ml-2 font-normal text-muted-foreground">
                ağırlık {criterion.weight}
              </span>
            </legend>
            <Controller
              control={form.control}
              name={`criteria.${index}.band`}
              render={({ field }) => (
                <div role="radiogroup" aria-label={`${aspectLabel(criterion.aspect)} bandı`}>
                  <ul className="grid gap-1.5">
                    {[...criterion.bands]
                      .sort((a, b) => b.band - a.band)
                      .map((item) => {
                        const id = `kriter-${index}-bant-${item.band}`
                        return (
                          <li key={item.band}>
                            <label
                              htmlFor={id}
                              className="flex min-h-9 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                            >
                              <input
                                id={id}
                                type="radio"
                                name={`kriter-${index}`}
                                value={item.band}
                                checked={field.value === item.band}
                                onChange={() => field.onChange(item.band)}
                                onBlur={field.onBlur}
                                disabled={busy}
                                className="mt-1 accent-primary"
                              />
                              <span>
                                <span className="font-medium">
                                  {item.band} · {bandMeaningLabel(bandMeaning(item.band))}
                                </span>
                                <span className="block text-muted-foreground">
                                  {item.description}
                                </span>
                              </span>
                            </label>
                          </li>
                        )
                      })}
                  </ul>
                </div>
              )}
            />
            {bandError?.message ? (
              <p id={`kriter-${index}-bant-hata`} role="alert" className="text-sm text-destructive">
                {bandError.message}
              </p>
            ) : null}
            <FormField
              id={`kriter-${index}-yorum`}
              label={
                band !== null && bandNeedsComment(band)
                  ? 'Kriter yorumu (zorunlu)'
                  : 'Kriter yorumu'
              }
              error={commentError}
            >
              {(control) => (
                <Textarea
                  {...control}
                  {...form.register(`criteria.${index}.comment`)}
                  maxLength={2000}
                  disabled={busy}
                  rows={2}
                />
              )}
            </FormField>
          </fieldset>
        )
      })}
      <FormField id="genel-yorum" label="Genel geri bildirim" error={errors.overallComment}>
        {(control) => (
          <Textarea
            {...control}
            {...form.register('overallComment')}
            maxLength={5000}
            disabled={busy}
            rows={4}
          />
        )}
      </FormField>
      <p className="text-sm text-muted-foreground">
        Toplam puan kayıtta sunucuda hesaplanır; puan kesinleşince geri bildirim öğrenciye ve
        velisine açılır.
      </p>
      <RootError message={errors.root?.server?.message} />
      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={busy || version === null} aria-busy={busy || undefined}>
          <Icon name="Check" size={17} aria-hidden="true" />
          Puanı kaydet
        </Button>
      </div>
    </form>
  )
}
