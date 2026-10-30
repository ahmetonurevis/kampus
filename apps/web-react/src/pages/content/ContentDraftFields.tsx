import { Controller, get, useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form'
import type { AuthorableType } from '@kampus/react-shared/resource-model.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { CheckGroup } from '../communication/CheckGroup.tsx'
import {
  CEFR_OPTIONS,
  GRADE_OPTIONS,
  LICENSE_NOTES,
  LICENSE_OPTIONS,
  MAX_OPTIONS,
  MIN_OPTIONS,
  nextOptionId,
  OPEN_LICENSE_OPTIONS,
  OUTCOME_SOURCE_OPTIONS,
  requiresAttribution,
  skillOptionsFor,
  type DraftFormOutput,
  type DraftFormValues,
} from './content-pool-model.ts'

export type DraftForm = UseFormReturn<DraftFormValues, unknown, DraftFormOutput>

type FieldsProps = {
  form: DraftForm
  type: AuthorableType
  /** Dil okulunda ders, sınıf düzeyi ve kazanım yoktur; CEFR ve beceri vardır. */
  languageSchool: boolean
  busy: boolean
}

/**
 * Hata metni: alan yolundan (`content.body`); dizi düzeyi hata (`options`, `outcomes`) `root`
 * altında olabilir. Yol birleşim tipine bağlı olmasın diye `get` ile okunur.
 */
export function fieldError(form: DraftForm, path: string): { message: string } | undefined {
  const entry = get(form.formState.errors, path) as
    { message?: unknown; root?: { message?: unknown } } | undefined
  const message = entry?.message ?? entry?.root?.message
  return typeof message === 'string' && message !== '' ? { message } : undefined
}

const nullable = (value: string) => (value === '' ? null : value)

/** İçerik gövdesi: okuma metni ya da çoktan seçmeli soru (kök, seçenekler, doğru cevap, çözüm). */
export function ContentFields({ form, type, busy }: Omit<FieldsProps, 'languageSchool'>) {
  return (
    <div className="grid gap-5">
      {type === 'reading_passage' ? (
        <FormField id="icerik-metin" label="Okuma metni" error={fieldError(form, 'content.body')}>
          {(control) => (
            <Textarea {...control} {...form.register('content.body')} rows={10} disabled={busy} />
          )}
        </FormField>
      ) : (
        <QuestionFields form={form} busy={busy} />
      )}
    </div>
  )
}

function QuestionFields({ form, busy }: { form: DraftForm; busy: boolean }) {
  const options = useFieldArray({ control: form.control, name: 'content.question.options' })
  const watched = useWatch({ control: form.control, name: 'content.question.options' }) ?? []
  const correct = useWatch({ control: form.control, name: 'answerKey.correctOptionId' })
  const ids = watched.map((option) => option.id)

  function remove(index: number) {
    const removed = ids[index]
    options.remove(index)
    // Silinen seçenek doğru cevapsa işaret ilk kalan seçeneğe geçer (geçerli kalsın).
    if (removed === correct) {
      const rest = ids.filter((_, position) => position !== index)
      form.setValue('answerKey.correctOptionId', rest[0] ?? 'a')
    }
  }
  function add() {
    const id = nextOptionId(ids)
    if (id) options.append({ id, text: '' })
  }
  return (
    <>
      <FormField
        id="icerik-kok"
        label="Soru kökü"
        error={fieldError(form, 'content.question.stem')}
      >
        {(control) => (
          <Textarea
            {...control}
            {...form.register('content.question.stem')}
            rows={3}
            disabled={busy}
          />
        )}
      </FormField>
      <fieldset className="grid gap-2" aria-describedby="icerik-secenek-ipucu">
        <legend className="mb-1 text-sm font-medium">Seçenekler</legend>
        <p id="icerik-secenek-ipucu" className="text-xs text-muted-foreground">
          En az {MIN_OPTIONS}, en çok {MAX_OPTIONS} seçenek girin; doğru cevabı işaretleyin.
        </p>
        {options.fields.map((field, index) => {
          const id = ids[index] ?? ''
          const letter = id.toLocaleUpperCase('en')
          return (
            <div key={field.id} className="flex items-start gap-2">
              <input
                type="radio"
                value={id}
                aria-label={`${letter} seçeneği doğru cevap`}
                {...form.register('answerKey.correctOptionId')}
                disabled={busy}
                className="mt-3 size-5 accent-primary"
              />
              <div className="min-w-0 flex-1">
                <FormField
                  id={`icerik-secenek-${index}`}
                  label={`${letter} seçeneği`}
                  error={fieldError(form, `content.question.options.${index}.text`)}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`content.question.options.${index}.text`)}
                      disabled={busy}
                    />
                  )}
                </FormField>
              </div>
              {options.fields.length > MIN_OPTIONS ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="mt-7"
                  aria-label={`${letter} seçeneğini sil`}
                  onClick={() => remove(index)}
                  disabled={busy}
                >
                  <Icon name="Trash2" size={16} aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          )
        })}
        {fieldError(form, 'content.question.options') ? (
          <p role="alert" className="text-sm text-destructive">
            {fieldError(form, 'content.question.options')?.message}
          </p>
        ) : null}
        {fieldError(form, 'answerKey.correctOptionId') ? (
          <p role="alert" className="text-sm text-destructive">
            {fieldError(form, 'answerKey.correctOptionId')?.message}
          </p>
        ) : null}
        {options.fields.length < MAX_OPTIONS ? (
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={add} disabled={busy}>
              <Icon name="Plus" size={15} aria-hidden="true" />
              Seçenek ekle
            </Button>
          </div>
        ) : null}
      </fieldset>
      <FormField
        id="icerik-cozum"
        label="Çözüm açıklaması"
        error={fieldError(form, 'answerKey.explanation')}
      >
        {(control) => (
          <Textarea
            {...control}
            {...form.register('answerKey.explanation')}
            rows={3}
            disabled={busy}
          />
        )}
      </FormField>
    </>
  )
}

/** Etiketler: ders, sınıf düzeyi, CEFR, beceri, kazanım kodları (okul kurumunda ders/düzey/kazanım). */
export function TagFields({ form, type, languageSchool, busy }: FieldsProps) {
  const subjects = useCoreAll('subjects', {}, { enabled: !languageSchool })
  const outcomes = useFieldArray({ control: form.control, name: 'tags.outcomes' })
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {!languageSchool ? (
        <>
          <Controller
            control={form.control}
            name="tags.subjectId"
            render={({ field }) => (
              <FormField id="icerik-ders" label="Ders" error={fieldError(form, 'tags.subjectId')}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    value={field.value ?? ''}
                    onChange={(event) => field.onChange(nullable(event.target.value))}
                    className="w-full"
                    disabled={busy}
                  >
                    <NativeSelectOption value="">Seçilmedi</NativeSelectOption>
                    {(subjects.data ?? []).map(({ record }) => (
                      <NativeSelectOption key={record.id} value={record.id}>
                        {record.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            )}
          />
          <Controller
            control={form.control}
            name="tags.gradeLevels"
            render={({ field }) => (
              <div className="sm:col-span-2">
                <CheckGroup
                  legend="Sınıf düzeyi"
                  options={GRADE_OPTIONS}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  disabled={busy}
                  error={fieldError(form, 'tags.gradeLevels')?.message}
                />
              </div>
            )}
          />
        </>
      ) : null}
      <Controller
        control={form.control}
        name="tags.cefrLevel"
        render={({ field }) => (
          <FormField
            id="icerik-cefr"
            label="CEFR düzeyi"
            error={fieldError(form, 'tags.cefrLevel')}
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={field.value ?? ''}
                onChange={(event) =>
                  field.onChange(
                    CEFR_OPTIONS.find((option) => option.value === event.target.value)?.value ??
                      null,
                  )
                }
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Seçilmedi</NativeSelectOption>
                {CEFR_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
      />
      <Controller
        control={form.control}
        name="tags.primarySkill"
        render={({ field }) => (
          <FormField
            id="icerik-beceri"
            label="Birincil beceri"
            error={fieldError(form, 'tags.primarySkill')}
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={field.value ?? ''}
                onChange={(event) =>
                  field.onChange(
                    skillOptionsFor(type).find((option) => option.value === event.target.value)
                      ?.value ?? null,
                  )
                }
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Seçilmedi</NativeSelectOption>
                {skillOptionsFor(type).map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
      />
      {!languageSchool ? (
        // TODO(katalog): kazanım kataloğu gelince kod yerine katalogdan seçim yapılır.
        <fieldset className="grid gap-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Kazanım kodları</legend>
          <p className="text-xs text-muted-foreground">
            Okul içeriğinin yayımı için en az bir kazanım gerekir. Kodu elle yazın.
          </p>
          {outcomes.fields.map((field, index) => (
            <div key={field.id} className="flex flex-wrap items-start gap-2">
              <div className="min-w-[160px] flex-1">
                <FormField
                  id={`icerik-kazanim-${index}`}
                  label={`${index + 1}. kazanım kodu`}
                  error={fieldError(form, `tags.outcomes.${index}.outcomeId`)}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`tags.outcomes.${index}.outcomeId`)}
                      maxLength={200}
                      disabled={busy}
                    />
                  )}
                </FormField>
              </div>
              <div className="min-w-[160px]">
                <FormField id={`icerik-kazanim-kaynak-${index}`} label="Kaynak">
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`tags.outcomes.${index}.outcomeSource`)}
                      className="w-full"
                      disabled={busy}
                    >
                      {OUTCOME_SOURCE_OPTIONS.map((option) => (
                        <NativeSelectOption key={option.value} value={option.value}>
                          {option.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="mt-7"
                aria-label={`${index + 1}. kazanımı sil`}
                onClick={() => outcomes.remove(index)}
                disabled={busy}
              >
                <Icon name="Trash2" size={16} aria-hidden="true" />
              </Button>
            </div>
          ))}
          {fieldError(form, 'tags.outcomes') ? (
            <p role="alert" className="text-sm text-destructive">
              {fieldError(form, 'tags.outcomes')?.message}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => outcomes.append({ outcomeId: '', outcomeSource: 'institution' })}
              disabled={busy}
            >
              <Icon name="Plus" size={15} aria-hidden="true" />
              Kazanım ekle
            </Button>
          </div>
        </fieldset>
      ) : null}
    </div>
  )
}

function licenseFor(kind: string): DraftFormValues['license'] {
  switch (kind) {
    case 'institution_original':
      return { kind: 'institution_original' }
    case 'contains_quotation':
      return { kind: 'contains_quotation' }
    case 'open_license':
      return { kind: 'open_license', license: 'CC-BY-4.0' }
    case 'public_domain':
      return { kind: 'public_domain', basisNote: '' }
    default:
      return null
  }
}

/** Menşe ve lisans, kaynak gösterimi satırları (DOM-KYN-020, 022, 024). */
export function LicenseFields({ form, busy }: Omit<FieldsProps, 'languageSchool' | 'type'>) {
  const license = useWatch({ control: form.control, name: 'license' })
  const attributions = useFieldArray({ control: form.control, name: 'attributions' })
  const kind = license?.kind
  const note =
    kind && kind in LICENSE_NOTES ? LICENSE_NOTES[kind as keyof typeof LICENSE_NOTES] : ''
  return (
    <div className="grid gap-5">
      <Controller
        control={form.control}
        name="license"
        render={({ field }) => (
          <FormField
            id="icerik-lisans"
            label="Menşe ve lisans"
            error={fieldError(form, 'license')}
            description={note}
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={field.value?.kind ?? ''}
                onChange={(event) => {
                  const next = licenseFor(event.target.value)
                  field.onChange(next)
                  // Kaynak gösterimi gerektirmeyen lisansta satırlar kalkar; gerektirende boş bir satır açılır.
                  if (!requiresAttribution(next?.kind)) attributions.replace([])
                  else if (attributions.fields.length === 0)
                    attributions.append({ work: '', author: '', source: '', year: null })
                }}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Seçin</NativeSelectOption>
                {LICENSE_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
      />
      {license?.kind === 'open_license' ? (
        <Controller
          control={form.control}
          name="license"
          render={({ field }) => (
            <FormField
              id="icerik-acik-lisans"
              label="Açık lisans"
              error={fieldError(form, 'license.license')}
            >
              {(control) => (
                <NativeSelect
                  {...control}
                  value={field.value?.kind === 'open_license' ? field.value.license : ''}
                  onChange={(event) => {
                    const chosen = OPEN_LICENSE_OPTIONS.find(
                      (option) => option.value === event.target.value,
                    )
                    if (chosen) field.onChange({ kind: 'open_license', license: chosen.value })
                  }}
                  className="w-full"
                  disabled={busy}
                >
                  {OPEN_LICENSE_OPTIONS.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          )}
        />
      ) : null}
      {license?.kind === 'public_domain' ? (
        <Controller
          control={form.control}
          name="license"
          render={({ field }) => (
            <FormField
              id="icerik-kamu-mali"
              label="Kamu malı dayanağı"
              error={fieldError(form, 'license.basisNote')}
              description="Eserin koruma süresinin neden dolduğunu kısaca yazın."
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={2}
                  value={field.value?.kind === 'public_domain' ? field.value.basisNote : ''}
                  onChange={(event) =>
                    field.onChange({ kind: 'public_domain', basisNote: event.target.value })
                  }
                  disabled={busy}
                />
              )}
            </FormField>
          )}
        />
      ) : null}
      {requiresAttribution(kind) ? (
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">Kaynak gösterimi</legend>
          <p className="text-xs text-muted-foreground">
            Eser adı, eser sahibi ve alındığı yer yayım için zorunludur.
          </p>
          {attributions.fields.map((field, index) => (
            <div key={field.id} className="grid gap-3 rounded-card border p-3 sm:grid-cols-2">
              <FormField
                id={`icerik-kaynak-eser-${index}`}
                label="Eser adı"
                error={fieldError(form, `attributions.${index}.work`)}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`attributions.${index}.work`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField
                id={`icerik-kaynak-yazar-${index}`}
                label="Eser sahibi"
                error={fieldError(form, `attributions.${index}.author`)}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`attributions.${index}.author`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField
                id={`icerik-kaynak-yer-${index}`}
                label="Alındığı yer (yayın, sayfa veya adres)"
                error={fieldError(form, `attributions.${index}.source`)}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`attributions.${index}.source`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField
                id={`icerik-kaynak-yil-${index}`}
                label="Yıl (isteğe bağlı)"
                error={fieldError(form, `attributions.${index}.year`)}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`attributions.${index}.year`, {
                      setValueAs: (value: unknown) =>
                        value === '' || value == null ? null : Number(value),
                    })}
                    type="number"
                    inputMode="numeric"
                    disabled={busy}
                  />
                )}
              </FormField>
              {attributions.fields.length > 1 ? (
                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => attributions.remove(index)}
                    disabled={busy}
                  >
                    <Icon name="Trash2" size={15} aria-hidden="true" />
                    Kaynağı sil
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {fieldError(form, 'attributions') ? (
            <p role="alert" className="text-sm text-destructive">
              {fieldError(form, 'attributions')?.message}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => attributions.append({ work: '', author: '', source: '', year: null })}
              disabled={busy}
            >
              <Icon name="Plus" size={15} aria-hidden="true" />
              Kaynak ekle
            </Button>
          </div>
        </fieldset>
      ) : null}
    </div>
  )
}
