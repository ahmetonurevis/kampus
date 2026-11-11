import {
  Controller,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form'
import type { RubricVersion } from '@kampus/react-shared/use-rubrics.ts'
import { bandMeaning } from '@kampus/school-core/skills/rubric.ts'
import { FormField } from '@/components/FormField.tsx'
import { Textarea } from '@/components/ui/textarea'
import {
  aspectLabel,
  bandMeaningLabel,
  bandNeedsComment,
  type ScoreFormValues,
} from './task-model.ts'

type Props = {
  control: Control<ScoreFormValues>
  register: UseFormRegister<ScoreFormValues>
  errors: FieldErrors<ScoreFormValues>
  rubric: RubricVersion
  busy: boolean
}

/**
 * Rubrik puanının ortak alanları (DOM-BEC-020…023): her kritere bir bant (0–5) ve gerekirse
 * yorum, genel geri bildirim. İlk puan, son puan ve itiraz kararındaki yeni puan aynı alanları
 * kullanır; form durumu ve gönderim çağıran formdadır.
 */
export function RubricCriteriaFields({ control, register, errors, rubric, busy }: Props) {
  const watched = useWatch({ control, name: 'criteria' })
  return (
    <>
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
              control={control}
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
              {(field) => (
                <Textarea
                  {...field}
                  {...register(`criteria.${index}.comment`)}
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
        {(field) => (
          <Textarea
            {...field}
            {...register('overallComment')}
            maxLength={5000}
            disabled={busy}
            rows={4}
          />
        )}
      </FormField>
    </>
  )
}
