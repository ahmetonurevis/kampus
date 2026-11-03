import { useEffect, useState } from 'react'
import { Controller, useFieldArray, useWatch } from 'react-hook-form'
import type { QuestionType } from '@kampus/school-core/content/taxonomy.ts'
import type { TaskAttemptAnswers } from '@kampus/react-shared/use-task-attempts.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { QuestionInput } from '../tasks/QuestionInput.tsx'
import { fieldError, type DraftForm } from './ContentDraftFields.tsx'
import { MAX_OPTIONS, MIN_OPTIONS, nextOptionId } from './content-pool-model.ts'
import {
  appendGapMarker,
  checkPreviewAnswer,
  defaultQuestion,
  gapIdsInStem,
  gapKey,
  nextRowId,
  pruneGapEntries,
  previewQuestion,
  QUESTION_TYPE_OPTIONS,
  ROW_LIMITS,
  TRUE_FALSE_OPTIONS,
  withoutQuestionImage,
  type AnswerCheck,
} from './question-form-model.ts'

type EditorProps = { form: DraftForm; busy: boolean }

/** Satır altı liste hatası (dizi düzeyi: en az/en çok, tekil kimlik). */
function ListError({ form, path }: { form: DraftForm; path: string }) {
  const error = fieldError(form, path)
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error.message}
    </p>
  ) : null
}

/**
 * Soru yazma alanları (OG-068, IST-033; DOM-KYN-002): soru türü, kök, türe göre seçenek/öncül/
 * boşluk/öğe/kabul edilen cevaplar, çözüm açıklaması ve kaydetmeden önce oynatıcı önizlemesi.
 * Tür değişince kök ve çözüm korunur, türe özgü alanlar boşalır. Doğrulama core şemasındadır
 * (`draftFormSchema`); türetilen alanların hatası onları üreten alana yazılır (`formIssuePath`).
 */
export function QuestionFields({ form, busy }: EditorProps) {
  const type = useWatch({ control: form.control, name: 'content.question.questionType' })
  const [previewing, setPreviewing] = useState(false)

  function changeType(next: QuestionType) {
    const stem = form.getValues('content.question.stem') ?? ''
    const explanation = form.getValues('answerKey.explanation') ?? ''
    const blank = defaultQuestion(next, stem)
    // Soru görseli türle birlikte bırakılır; dosya listesinde kalırsa soruya bağsız eklenti olur.
    const imageFileId = form.getValues('content.question.imageFileId')
    if (imageFileId)
      form.setValue('files', withoutQuestionImage(form.getValues('files'), imageFileId))
    form.clearErrors(['content.question', 'answerKey'])
    form.setValue('content.question', blank.question)
    form.setValue('answerKey', { ...blank.answerKey, explanation })
  }

  const gapFill = type === 'gap_fill'
  return (
    <>
      <FormField id="icerik-soru-turu" label="Soru türü">
        {(control) => (
          <NativeSelect
            {...control}
            value={type ?? 'multiple_choice'}
            onChange={(event) => {
              const chosen = QUESTION_TYPE_OPTIONS.find(
                (option) => option.value === event.target.value,
              )
              if (chosen) changeType(chosen.value)
            }}
            className="w-full"
            disabled={busy}
          >
            {QUESTION_TYPE_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="icerik-kok"
        label="Soru kökü"
        error={fieldError(form, 'content.question.stem')}
        {...(gapFill
          ? {
              description:
                'Boşlukları {{1}}, {{2}} biçiminde işaretleyin; her işaret için cevap alanı açılır.',
            }
          : {})}
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

      {/* Tür değişince alt alanlar yeniden kurulur: alan dizileri yeni türün değerinden okunur. */}
      <TypeEditor key={type} type={type ?? 'multiple_choice'} form={form} busy={busy} />
      <ListError form={form} path="answerKey" />

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
      <div>
        <Button type="button" variant="secondary" onClick={() => setPreviewing(true)}>
          <Icon name="Eye" size={16} aria-hidden="true" />
          Soruyu önizle
        </Button>
      </div>
      {previewing ? (
        <QuestionPreviewModal form={form} onClose={() => setPreviewing(false)} />
      ) : null}
    </>
  )
}

function TypeEditor({ type, form, busy }: EditorProps & { type: QuestionType }) {
  switch (type) {
    case 'multiple_choice':
      return <MultipleChoiceEditor form={form} busy={busy} />
    case 'true_false':
      return <TrueFalseEditor form={form} busy={busy} />
    case 'matching':
      return <MatchingEditor form={form} busy={busy} />
    case 'gap_fill':
      return <GapFillEditor form={form} busy={busy} />
    case 'ordering':
      return <OrderingEditor form={form} busy={busy} />
    case 'short_answer':
      return <ShortAnswerEditor form={form} busy={busy} />
    default:
      return type satisfies never
  }
}

function MultipleChoiceEditor({ form, busy }: EditorProps) {
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
      <ListError form={form} path="content.question.options" />
      <ListError form={form} path="answerKey.correctOptionId" />
      {options.fields.length < MAX_OPTIONS ? (
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={add} disabled={busy}>
            <Icon name="Plus" size={15} aria-hidden="true" />
            Seçenek ekle
          </Button>
        </div>
      ) : null}
    </fieldset>
  )
}

function TrueFalseEditor({ form, busy }: EditorProps) {
  const allowNotGiven = useWatch({ control: form.control, name: 'content.question.allowNotGiven' })
  const choices = TRUE_FALSE_OPTIONS.filter(
    (option) => option.value !== 'not_given' || allowNotGiven,
  )
  return (
    <div className="grid gap-4">
      <Controller
        control={form.control}
        name="content.question.allowNotGiven"
        render={({ field }) => (
          <Label htmlFor="icerik-dy-verilmemis" className="items-start gap-2.5 font-normal">
            <Checkbox
              id="icerik-dy-verilmemis"
              checked={field.value === true}
              onCheckedChange={(checked) => {
                field.onChange(checked === true)
                // Seçenek kapanınca "Verilmemiş" cevabı geçersizdir; işaret "Doğru"ya döner.
                if (checked !== true && form.getValues('answerKey.answer') === 'not_given')
                  form.setValue('answerKey.answer', 'true')
              }}
              disabled={busy}
              className="mt-0.5"
            />
            <span className="text-sm">"Verilmemiş" seçeneği de olsun (okuma-anlama)</span>
          </Label>
        )}
      />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Doğru cevap</legend>
        <div className="flex flex-wrap gap-4">
          {choices.map((option) => (
            <label key={option.value} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                value={option.value}
                {...form.register('answerKey.answer')}
                disabled={busy}
                className="size-5 accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}

function MatchingEditor({ form, busy }: EditorProps) {
  const prompts = useFieldArray({ control: form.control, name: 'content.question.prompts' })
  const choices = useFieldArray({ control: form.control, name: 'content.question.choices' })
  const promptIds = (
    useWatch({ control: form.control, name: 'content.question.prompts' }) ?? []
  ).map((row) => row.id)
  const choiceIds = (
    useWatch({ control: form.control, name: 'content.question.choices' }) ?? []
  ).map((row) => row.id)
  const pairCount = prompts.fields.length
  const canAddChoice = choices.fields.length < ROW_LIMITS.choices.max

  function addPair() {
    prompts.append({ id: nextRowId('p', promptIds), text: '' })
    choices.insert(pairCount, { id: nextRowId('c', choiceIds), text: '' })
  }
  function removePair(index: number) {
    prompts.remove(index)
    choices.remove(index)
  }
  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-3" aria-describedby="icerik-eslesme-ipucu">
        <legend className="mb-1 text-sm font-medium">Eşleşme çiftleri</legend>
        <p id="icerik-eslesme-ipucu" className="text-xs text-muted-foreground">
          Her öncülü doğru eşiyle aynı satıra yazın; öğrenci eşleri karışık sırada görür. En az{' '}
          {ROW_LIMITS.prompts.min} çift girin.
        </p>
        {prompts.fields.map((field, index) => (
          <div key={field.id} className="flex flex-wrap items-start gap-2">
            <div className="min-w-[160px] flex-1">
              <FormField
                id={`icerik-oncul-${index}`}
                label={`${index + 1}. öncül`}
                error={fieldError(form, `content.question.prompts.${index}.text`)}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`content.question.prompts.${index}.text`)}
                    disabled={busy}
                  />
                )}
              </FormField>
            </div>
            <div className="min-w-[160px] flex-1">
              <FormField
                id={`icerik-es-${index}`}
                label={`${index + 1}. öncülün eşi`}
                error={fieldError(form, `content.question.choices.${index}.text`)}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`content.question.choices.${index}.text`)}
                    disabled={busy}
                  />
                )}
              </FormField>
            </div>
            {pairCount > ROW_LIMITS.prompts.min ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="mt-7"
                aria-label={`${index + 1}. çifti sil`}
                onClick={() => removePair(index)}
                disabled={busy}
              >
                <Icon name="Trash2" size={16} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))}
        <ListError form={form} path="content.question.prompts" />
        {pairCount < ROW_LIMITS.prompts.max && canAddChoice ? (
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={addPair} disabled={busy}>
              <Icon name="Plus" size={15} aria-hidden="true" />
              Çift ekle
            </Button>
          </div>
        ) : null}
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Çeldiriciler (isteğe bağlı)</legend>
        {choices.fields.slice(pairCount).map((field, offset) => {
          const index = pairCount + offset
          return (
            <div key={field.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <FormField
                  id={`icerik-celdirici-${offset}`}
                  label={`${offset + 1}. çeldirici`}
                  error={fieldError(form, `content.question.choices.${index}.text`)}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`content.question.choices.${index}.text`)}
                      disabled={busy}
                    />
                  )}
                </FormField>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="mt-7"
                aria-label={`${offset + 1}. çeldiriciyi sil`}
                onClick={() => choices.remove(index)}
                disabled={busy}
              >
                <Icon name="Trash2" size={16} aria-hidden="true" />
              </Button>
            </div>
          )
        })}
        <ListError form={form} path="content.question.choices" />
        {canAddChoice ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => choices.append({ id: nextRowId('c', choiceIds), text: '' })}
              disabled={busy}
            >
              <Icon name="Plus" size={15} aria-hidden="true" />
              Çeldirici ekle
            </Button>
          </div>
        ) : null}
      </fieldset>
    </div>
  )
}

function GapFillEditor({ form, busy }: EditorProps) {
  const stem = useWatch({ control: form.control, name: 'content.question.stem' }) ?? ''
  const ids = gapIdsInStem(stem)
  // Kökten silinen işaretin cevapları atılır; aynı numara sonra yeniden kullanılırsa eski cevaplar
  // geri gelmez.
  useEffect(() => {
    const entries = form.getValues('content.question.gapEntries')
    if (!entries) return
    const pruned = pruneGapEntries(entries, stem)
    if (pruned !== entries) form.setValue('content.question.gapEntries', pruned)
  }, [form, stem])
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-sm font-medium">Boşluklar</legend>
      {ids.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Kökte boşluk işareti yok. Kökü yazıp "Boşluk ekle" ile işaret koyun.
        </p>
      ) : null}
      {ids.map((id, index) => {
        const base = `content.question.gapEntries.${gapKey(id)}` as const
        return (
          <div key={id} className="grid gap-3 rounded-card border p-3 sm:grid-cols-2">
            <p className="text-sm font-medium sm:col-span-2">
              {index + 1}. boşluk <span className="text-muted-foreground">{`{{${id}}}`}</span>
            </p>
            <FormField
              id={`icerik-bosluk-cevap-${index}`}
              label={`${index + 1}. boşluğun kabul edilen cevapları`}
              description="Her satıra bir cevap."
              error={fieldError(form, `${base}.accepted`)}
            >
              {(control) => (
                <Textarea
                  {...control}
                  {...form.register(`${base}.accepted`)}
                  rows={2}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField
              id={`icerik-bosluk-secenek-${index}`}
              label={`${index + 1}. boşluğun seçenekleri`}
              description="İsteğe bağlı, her satıra bir seçenek; doluysa öğrenci listeden seçer."
              error={fieldError(form, `${base}.options`)}
            >
              {(control) => (
                <Textarea
                  {...control}
                  {...form.register(`${base}.options`)}
                  rows={2}
                  disabled={busy}
                />
              )}
            </FormField>
          </div>
        )
      })}
      {ids.length < ROW_LIMITS.gaps.max ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              form.setValue('content.question.stem', appendGapMarker(stem), {
                shouldDirty: true,
              })
            }
            disabled={busy}
          >
            <Icon name="Plus" size={15} aria-hidden="true" />
            Boşluk ekle
          </Button>
        </div>
      ) : null}
    </fieldset>
  )
}

function OrderingEditor({ form, busy }: EditorProps) {
  const items = useFieldArray({ control: form.control, name: 'content.question.items' })
  const ids = (useWatch({ control: form.control, name: 'content.question.items' }) ?? []).map(
    (row) => row.id,
  )
  const count = items.fields.length
  return (
    <fieldset className="grid gap-2" aria-describedby="icerik-siralama-ipucu">
      <legend className="mb-1 text-sm font-medium">Öğeler (doğru sırayla)</legend>
      <p id="icerik-siralama-ipucu" className="text-xs text-muted-foreground">
        Öğeleri doğru sırayla yazın; öğrenci karışık sırada görür. En az {ROW_LIMITS.items.min} öğe
        girin.
      </p>
      {items.fields.map((field, index) => (
        <div key={field.id} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <FormField
              id={`icerik-oge-${index}`}
              label={`${index + 1}. öğe`}
              error={fieldError(form, `content.question.items.${index}.text`)}
            >
              {(control) => (
                <Input
                  {...control}
                  {...form.register(`content.question.items.${index}.text`)}
                  disabled={busy}
                />
              )}
            </FormField>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="mt-7"
            aria-label={`${index + 1}. öğeyi yukarı taşı`}
            onClick={() => items.move(index, index - 1)}
            disabled={busy || index === 0}
          >
            <Icon name="ArrowUp" size={16} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="mt-7"
            aria-label={`${index + 1}. öğeyi aşağı taşı`}
            onClick={() => items.move(index, index + 1)}
            disabled={busy || index === count - 1}
          >
            <Icon name="ArrowDown" size={16} aria-hidden="true" />
          </Button>
          {count > ROW_LIMITS.items.min ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="mt-7"
              aria-label={`${index + 1}. öğeyi sil`}
              onClick={() => items.remove(index)}
              disabled={busy}
            >
              <Icon name="Trash2" size={16} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ))}
      <ListError form={form} path="content.question.items" />
      {count < ROW_LIMITS.items.max ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => items.append({ id: nextRowId('i', ids), text: '' })}
            disabled={busy}
          >
            <Icon name="Plus" size={15} aria-hidden="true" />
            Öğe ekle
          </Button>
        </div>
      ) : null}
    </fieldset>
  )
}

function ShortAnswerEditor({ form, busy }: EditorProps) {
  return (
    <div className="grid gap-5 sm:grid-cols-[1fr_200px]">
      <FormField
        id="icerik-kisa-cevap"
        label="Kabul edilen cevaplar"
        description="Her satıra bir cevap; büyük/küçük harf ve fazladan boşluk fark etmez."
        error={fieldError(form, 'answerKey.acceptedText')}
      >
        {(control) => (
          <Textarea
            {...control}
            {...form.register('answerKey.acceptedText')}
            rows={3}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="icerik-kisa-uzunluk"
        label="En fazla karakter"
        error={fieldError(form, 'content.question.maxLength')}
      >
        {(control) => (
          <Input
            {...control}
            type="number"
            min={1}
            max={500}
            {...form.register('content.question.maxLength', { valueAsNumber: true })}
            disabled={busy}
          />
        )}
      </FormField>
    </div>
  )
}

type Response = TaskAttemptAnswers[string]

/**
 * Oynatıcı önizlemesi (iç içe pencere): soru öğrencinin göreceği karışık sırayla oynatıcı
 * bileşeninde (`QuestionInput`) açılır; yazar cevap verip anahtarla denetler. Hiçbir şey kaydedilmez.
 */
function QuestionPreviewModal({ form, onClose }: { form: DraftForm; onClose: () => void }) {
  // Pencere açıldığı andaki form değeri; önizleme açıkken form değişmez (pencere kipli).
  const [preview] = useState(() =>
    previewQuestion(form.getValues('content.question') ?? {}, form.getValues('answerKey')),
  )
  const [response, setResponse] = useState<Response | undefined>(undefined)
  const [check, setCheck] = useState<AnswerCheck | null>(null)
  const answerKey = preview.ok ? preview.answerKey : null
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Soru önizlemesi"
      description="Öğrencinin göreceği hâli; cevap kaydedilmez."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Önizlemeyi kapat
          </Button>
          {answerKey ? (
            <Button
              type="button"
              onClick={() =>
                preview.ok &&
                setCheck(
                  checkPreviewAnswer(
                    preview.question,
                    answerKey,
                    response,
                    form.getValues('tags') ?? {},
                  ),
                )
              }
            >
              <Icon name="Check" size={16} aria-hidden="true" />
              Cevabı denetle
            </Button>
          ) : null}
        </>
      }
    >
      {preview.ok ? (
        <div className="grid gap-4">
          <QuestionInput
            question={{
              questionVersionId: 'onizleme',
              points: 1,
              subskill: null,
              question: preview.question,
            }}
            response={response}
            onChange={(next) => {
              setResponse(next)
              setCheck(null)
            }}
          />
          {answerKey ? null : (
            <p className="text-sm text-muted-foreground">
              Cevap anahtarı tamamlanmadığı için cevap denetlenemez.
            </p>
          )}
          <p
            role="status"
            className={check?.correct ? 'text-sm font-medium text-success' : 'text-sm font-medium'}
          >
            {check?.message ?? ''}
          </p>
        </div>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          {preview.message}
        </p>
      )}
    </Modal>
  )
}
