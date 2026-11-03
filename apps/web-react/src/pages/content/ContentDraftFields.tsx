import { useEffect, useRef, useState } from 'react'
import { Controller, get, useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form'
import type { AuthorableType } from '@kampus/react-shared/resource-model.ts'
import { useLearningOutcomeList } from '@kampus/react-shared/use-learning-outcomes.ts'
import { GLOSSARY_MAX } from '@kampus/school-core/content/resource.ts'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { CheckGroup } from '../communication/CheckGroup.tsx'
import {
  CEFR_OPTIONS,
  emptyGlossaryEntry,
  glossaryFocusAfterRemove,
  glossaryTermId,
  GRADE_OPTIONS,
  LICENSE_NOTES,
  LICENSE_OPTIONS,
  MATERIAL_FILE_RULE,
  OPEN_LICENSE_OPTIONS,
  requiresAttribution,
  skillOptionsFor,
  SUBSKILL_OPTIONS,
  type DraftFormOutput,
  type DraftFormValues,
} from './content-pool-model.ts'
import {
  appendOutcomes,
  OUTCOME_COPY,
  outcomeCapacity,
  outcomePickerDefaults,
  selectedOutcomesQuery,
  selectedOutcomeViews,
} from './outcome-picker-model.ts'
import { OutcomePicker } from './OutcomePicker.tsx'
import { QuestionFields } from './QuestionFields.tsx'

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

/**
 * Dosya alanının hatası: formun kendi uyarısı (`files`), sunucunun liste ya da sıra maddesi
 * (`fileIds`, `fileIds.<sıra>`) ve içerikteki dosya (`content.fileId`), bu sırayla ilk bulunan.
 */
export function filesError(form: DraftForm): { message: string } | undefined {
  const direct = fieldError(form, 'files') ?? fieldError(form, 'fileIds')
  if (direct) return direct
  const list = get(form.formState.errors, 'fileIds') as Record<string, unknown> | undefined
  if (list && typeof list === 'object')
    for (const key of Object.keys(list)) {
      const found = fieldError(form, `fileIds.${key}`)
      if (found) return found
    }
  return fieldError(form, 'content.fileId')
}

type ContentProps = Omit<FieldsProps, 'languageSchool'> & {
  /** Dosya yüklemesi sürerken `true`; form kaydet düğmesini kilitler. */
  onUploadingChange: (uploading: boolean) => void
  /** Taranan dosya kaydı engelliyor (OG-987): yalnız kaydet kilitlenir. */
  onScanBlockedChange: (blocked: boolean) => void
}

/**
 * İçerik gövdesi: okuma metni ve sözlükçesi, soru (altı tür, IST-033; `QuestionFields`) ya da
 * materyal dosyaları.
 */
export function ContentFields({
  form,
  type,
  busy,
  onUploadingChange,
  onScanBlockedChange,
}: ContentProps) {
  return (
    <div className="grid gap-5">
      {type === 'reading_passage' ? (
        <>
          <FormField id="icerik-metin" label="Okuma metni" error={fieldError(form, 'content.body')}>
            {(control) => (
              <Textarea {...control} {...form.register('content.body')} rows={10} disabled={busy} />
            )}
          </FormField>
          <GlossaryFields form={form} busy={busy} />
        </>
      ) : type === 'file' ? (
        <MaterialFileFields
          form={form}
          busy={busy}
          onUploadingChange={onUploadingChange}
          onScanBlockedChange={onScanBlockedChange}
        />
      ) : (
        <QuestionFields form={form} busy={busy} />
      )}
    </div>
  )
}

/**
 * Okuma parçasının sözlükçesi (DOM-BEC-006, IST-042): kelime, Türkçe anlamı ve isteğe bağlı örnek
 * cümle. Kural core `glossaryEntrySchema`'dadır (uzunluk, en çok `GLOSSARY_MAX` kelime, aynı kelime
 * bir kez); hata alanın ya da listenin altında yazılır. Kursiyer metnin altında görür.
 */
function GlossaryFields({ form, busy }: { form: DraftForm; busy: boolean }) {
  const entries = useFieldArray({ control: form.control, name: 'content.glossary' })
  const listError = fieldError(form, 'content.glossary')
  const addButton = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<ReturnType<typeof glossaryFocusAfterRemove> | null>(null)
  // Silinen satırın düğmesi kalkınca odak `body`'ye düşer; satırlar çizildikten sonra taşınır.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    if (target.kind === 'add') addButton.current?.focus()
    else document.getElementById(glossaryTermId(target.index))?.focus()
  }, [entries.fields.length])
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">Sözlükçe</legend>
      <p className="text-xs text-muted-foreground">
        Öğrencinin metinde zorlanabileceği kelimeleri anlamıyla ekleyin; öğrenci metnin altında
        görür.
      </p>
      {entries.fields.map((field, index) => (
        <div key={field.id} className="grid gap-3 rounded-card border p-3 sm:grid-cols-2">
          <FormField
            id={glossaryTermId(index)}
            label={`${index + 1}. kelime`}
            error={fieldError(form, `content.glossary.${index}.term`)}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register(`content.glossary.${index}.term`)}
                lang="en"
                disabled={busy}
              />
            )}
          </FormField>
          <FormField
            id={`icerik-sozluk-anlam-${index}`}
            label={`${index + 1}. kelimenin anlamı`}
            error={fieldError(form, `content.glossary.${index}.meaning`)}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register(`content.glossary.${index}.meaning`)}
                disabled={busy}
              />
            )}
          </FormField>
          <div className="sm:col-span-2">
            <FormField
              id={`icerik-sozluk-ornek-${index}`}
              label={`${index + 1}. örnek cümle (isteğe bağlı)`}
              error={fieldError(form, `content.glossary.${index}.example`)}
            >
              {(control) => (
                <Input
                  {...control}
                  {...form.register(`content.glossary.${index}.example`)}
                  lang="en"
                  disabled={busy}
                />
              )}
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`${index + 1}. kelimeyi sil`}
              onClick={() => {
                pendingFocus.current = glossaryFocusAfterRemove(index, entries.fields.length)
                entries.remove(index)
              }}
              disabled={busy}
            >
              <Icon name="Trash2" size={15} aria-hidden="true" />
              Kelimeyi sil
            </Button>
          </div>
        </div>
      ))}
      {listError ? (
        <p role="alert" className="text-sm text-destructive">
          {listError.message}
        </p>
      ) : null}
      <div>
        <Button
          ref={addButton}
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            form.clearErrors('content.glossary')
            entries.append(emptyGlossaryEntry())
          }}
          disabled={busy || entries.fields.length >= GLOSSARY_MAX}
        >
          <Icon name="Plus" size={15} aria-hidden="true" />
          Kelime ekle
        </Button>
      </div>
    </fieldset>
  )
}

/**
 * Materyal dosyaları (DOM-KYN-006): yüklenen dosya listeye eklenir, sıra yükleme sırasıdır; ilk
 * dosya içeriğin ana dosyasıdır. Liste bütün olarak gönderilir: çıkarılan dosyanın bağını sunucu
 * kaldırır, sunucudaki kayıt başka kayda bağlanmazsa kendiliğinden temizlenir.
 */
function MaterialFileFields({
  form,
  busy,
  onUploadingChange,
  onScanBlockedChange,
}: {
  form: DraftForm
  busy: boolean
  onUploadingChange: (uploading: boolean) => void
  onScanBlockedChange: (blocked: boolean) => void
}) {
  const files = useWatch({ control: form.control, name: 'files' }) ?? []
  const clear = () => {
    for (const path of ['files', 'fileIds', 'content.fileId'] as const) form.clearErrors(path)
  }
  function add(item: FileUploadItem) {
    clear()
    form.setValue('files', [...form.getValues('files'), item], { shouldDirty: true })
  }
  function remove(id: string) {
    clear()
    form.setValue(
      'files',
      form.getValues('files').filter((file) => file.id !== id),
      { shouldDirty: true },
    )
  }
  return (
    <FileUploadField
      id="icerik-dosya"
      label="Materyal dosyaları"
      purpose="material"
      multiple
      maxFiles={MATERIAL_FILE_RULE.maxFiles}
      description={`PDF, Word, PowerPoint, Excel, görsel, ses ya da video; en çok ${MATERIAL_FILE_RULE.maxFiles} dosya. İlk dosya materyalin ana dosyasıdır.`}
      listLabel="Materyal dosyaları"
      items={files}
      error={filesError(form)}
      disabled={busy}
      onUploaded={add}
      onRemoved={remove}
      onBusyChange={(uploading) => {
        onUploadingChange(uploading)
        if (uploading) clear()
      }}
      onBlockedChange={onScanBlockedChange}
    />
  )
}

/** Etiketler: ders, sınıf düzeyi, CEFR, beceri, kazanım kodları (okul kurumunda ders/düzey/kazanım). */
export function TagFields({ form, type, languageSchool, busy }: FieldsProps) {
  const subjects = useCoreAll('subjects', {}, { enabled: !languageSchool })
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
      {type === 'question' ? (
        <Controller
          control={form.control}
          name="tags.subskill"
          render={({ field }) => (
            <FormField
              id="icerik-alt-beceri"
              label="Alt beceri"
              error={fieldError(form, 'tags.subskill')}
              description="Okuma-anlama sorusunda sonuç dökümü bu etikete göre çıkar."
            >
              {(control) => (
                <NativeSelect
                  {...control}
                  value={field.value ?? ''}
                  onChange={(event) =>
                    field.onChange(
                      SUBSKILL_OPTIONS.find((option) => option.value === event.target.value)
                        ?.value ?? null,
                    )
                  }
                  className="w-full"
                  disabled={busy}
                >
                  <NativeSelectOption value="">Seçilmedi</NativeSelectOption>
                  {SUBSKILL_OPTIONS.map((option) => (
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
      {!languageSchool ? (
        <OutcomeFields
          form={form}
          busy={busy}
          subjectOptions={(subjects.data ?? []).map(({ record }) => ({
            value: record.id,
            label: record.name,
          }))}
        />
      ) : null}
    </div>
  )
}

/**
 * Kazanımlar (OG-067; DOM-KYN-011, IST-030): katalogdan seçilir, kod elle yazılmaz. Seçili
 * kazanımın adı ve arşiv durumu `codes` sorgusuyla çözülür; arşivli kod içerikte etiketle kalır
 * (sunucu korur) ama seçicide çıkmaz. Silmeden sonra odak sonraki satırın sil düğmesine, yoksa
 * "Kazanım ekle"ye geçer.
 */
function OutcomeFields({
  form,
  busy,
  subjectOptions,
}: {
  form: DraftForm
  busy: boolean
  subjectOptions: readonly { value: string; label: string }[]
}) {
  const outcomes = useFieldArray({ control: form.control, name: 'tags.outcomes' })
  const selected = useWatch({ control: form.control, name: 'tags.outcomes' }) ?? []
  const subjectId = useWatch({ control: form.control, name: 'tags.subjectId' })
  const gradeLevels = useWatch({ control: form.control, name: 'tags.gradeLevels' })
  const [open, setOpen] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  const removeButtons = useRef(new Map<number, HTMLButtonElement>())
  const pendingFocus = useRef<number | null>(null)
  const lookupQuery = selectedOutcomesQuery(selected)
  const lookup = useLearningOutcomeList(lookupQuery ?? { page: 1, pageSize: 1 }, {
    enabled: lookupQuery !== null,
  })
  const views = selectedOutcomeViews(selected, lookupQuery === null ? [] : lookup.data?.data)
  const full = outcomeCapacity(selected) === 0

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    ;(removeButtons.current.get(target) ?? addButton.current)?.focus()
  })

  return (
    <fieldset className="grid gap-2 sm:col-span-2" aria-describedby="icerik-kazanim-not">
      <legend className="mb-1 text-sm font-medium">Kazanımlar</legend>
      <p id="icerik-kazanim-not" className="text-xs text-muted-foreground">
        Okul içeriğinin yayımı için en az bir kazanım gerekir. Kazanımı katalogdan seçin.
      </p>
      {outcomes.fields.length > 0 ? (
        <ul aria-label="Seçili kazanımlar" className="grid gap-2">
          {outcomes.fields.map((field, index) => {
            const view = views[index]
            const error = fieldError(form, `tags.outcomes.${index}.outcomeId`)
            const errorId = `icerik-kazanim-${String(index)}-hata`
            const noteId = `icerik-kazanim-${String(index)}-not`
            const note =
              view?.state === 'archived'
                ? OUTCOME_COPY.archivedNote
                : view?.state === 'missing'
                  ? OUTCOME_COPY.missingNote
                  : null
            return (
              <li
                key={field.id}
                className="flex items-start gap-3 rounded-card border bg-surface px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">
                    {view?.code ?? field.outcomeId}
                    {view?.name ? ` · ${view.name}` : ''}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StatusBadge text={view?.source ?? ''} tone="gray" />
                    {view?.state === 'archived' ? (
                      <StatusBadge text={OUTCOME_COPY.archived} tone="amber" />
                    ) : null}
                    {view?.state === 'missing' ? (
                      <StatusBadge text={OUTCOME_COPY.missing} tone="red" />
                    ) : null}
                  </div>
                  {note ? (
                    <p id={noteId} className="mt-1 text-xs text-muted-foreground">
                      {note}
                    </p>
                  ) : null}
                  {error ? (
                    <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">
                      {error.message}
                    </p>
                  ) : null}
                </div>
                <Button
                  ref={(element) => {
                    if (element) removeButtons.current.set(index, element)
                    else removeButtons.current.delete(index)
                  }}
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`${String(index + 1)}. kazanımı sil`}
                  aria-describedby={
                    [note ? noteId : null, error ? errorId : null].filter(Boolean).join(' ') ||
                    undefined
                  }
                  onClick={() => {
                    pendingFocus.current = index < outcomes.fields.length - 1 ? index : -1
                    outcomes.remove(index)
                  }}
                  disabled={busy}
                >
                  <Icon name="Trash2" size={16} aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {fieldError(form, 'tags.outcomes') ? (
        <p role="alert" className="text-sm text-destructive">
          {fieldError(form, 'tags.outcomes')?.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={addButton}
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={busy || full}
        >
          <Icon name="Plus" size={15} aria-hidden="true" />
          Kazanım ekle
        </Button>
        {full ? <span className="text-xs text-muted-foreground">{OUTCOME_COPY.full}</span> : null}
      </div>
      <OutcomePicker
        open={open}
        onOpenChange={setOpen}
        selected={selected}
        defaults={outcomePickerDefaults({ subjectId, gradeLevels })}
        subjectOptions={subjectOptions}
        onPick={(picked) => {
          const fresh = appendOutcomes(selected, picked)
          if (fresh.length > 0) outcomes.append(fresh, { shouldFocus: false })
        }}
      />
    </fieldset>
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
