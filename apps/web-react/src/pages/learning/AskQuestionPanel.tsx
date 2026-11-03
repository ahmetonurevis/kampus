import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import type { z } from 'zod'
import {
  QUESTION_PHOTO_LIMIT,
  QUESTION_PHOTO_PURPOSE,
  QUESTION_SENSITIVE_NOTICE,
  QUESTION_TEXT_MAX_LENGTH,
  QUESTION_TEXT_MIN_LENGTH,
  QUESTION_TITLE_MAX_LENGTH,
} from '@kampus/school-core/lib/questions.ts'
import { fileAttachField } from '@kampus/react-shared/files.ts'
import { useAskQuestion } from '@kampus/react-shared/use-question-commands.ts'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { focusFirstError } from '../requests/request-forms.ts'
import {
  addQuestionPhoto,
  askDefaults,
  askFieldName,
  askFormSchema,
  askOptions,
  askQuestionBody,
  optionOf,
  teacherChoice,
  type AskFormValues,
  type AskOption,
} from './question-forms.ts'

type Output = z.output<typeof askFormSchema>

/** `?soru-form=` değeri: yeni soru. */
export const NEW_QUESTION = 'yeni'

/**
 * Yeni soru (öğrenci, Vue "Öğretmenine soru sor"): kısa form sağ panelde açılır. Ders ve öğretmen
 * seçenekleri sunucunun kapsamladığı atamalardan kurulur: öğrenci yalnız kendi sınıfının ders
 * öğretmenlerine soru gönderir (DOM-ILT-090). Soru dersin öğretmenine düşer; mükerrer gönderim
 * `Idempotency-Key` ile önlenir. Özel nitelikli bilgi uyarısı formda görünür (DOM-ILT-014).
 * En çok 3 fotoğraf seçilir seçilmez yüklenir (`student_question_photo`) ve gönderimde aynı
 * işlemle soruya bağlanır (DOM-ILT-094); yükleme sürerken gönderim kilitlidir, güvenlik taraması
 * sürerken yalnız gönder düğmesi kilitlidir.
 */
export function AskQuestionPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Yeni soru"
    >
      {open ? <AskQuestionLoader onClose={onClose} /> : null}
    </SidePanel>
  )
}

function AskQuestionLoader({ onClose }: { onClose: () => void }) {
  const assignments = useCoreAll('assignments')
  const teachers = useCoreAll('teachers')
  const subjects = useCoreAll('subjects')
  const error = assignments.error ?? teachers.error ?? subjects.error
  const options = useMemo(
    () =>
      assignments.data && teachers.data && subjects.data
        ? askOptions(assignments.data, teachers.data, subjects.data)
        : undefined,
    [assignments.data, teachers.data, subjects.data],
  )
  if (error)
    return (
      <QueryError
        error={error}
        onRetry={() => {
          for (const query of [assignments, teachers, subjects])
            if (query.error) void query.refetch()
        }}
      />
    )
  if (!options) return <SummaryLoading />
  if (options.length === 0)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Sınıfınız için soru gönderebileceğiniz bir ders öğretmeni bulunamadı.
      </p>
    )
  return <AskQuestionForm options={options} onClose={onClose} />
}

const SUBJECT_HINT = 'Soru, sınıfınızda o dersi veren öğretmene gider.'

function AskQuestionForm({
  options,
  onClose,
}: {
  options: readonly AskOption[]
  onClose: () => void
}) {
  const ask = useAskQuestion()
  const form = useForm<AskFormValues, unknown, Output>({
    resolver: zodResolver(askFormSchema),
    defaultValues: askDefaults(),
  })
  const [uploading, setUploading] = useState(false)
  // Taranan fotoğraf yalnız gönderimi engeller; alanlar ve vazgeç açık kalır (OG-987).
  const [scanBlocked, setScanBlocked] = useState(false)
  const busy = ask.isPending || uploading || form.formState.isSubmitting
  const errors = form.formState.errors
  const option = optionOf(options, useWatch({ control: form.control, name: 'subjectId' }))
  const photos = useWatch({ control: form.control, name: 'files' })

  function addPhoto(item: FileUploadItem) {
    form.clearErrors('files')
    form.setValue('files', addQuestionPhoto(form.getValues('files'), item), { shouldDirty: true })
  }

  function removePhoto(id: string) {
    form.clearErrors('files')
    form.setValue(
      'files',
      form.getValues('files').filter((file) => file.id !== id),
      { shouldDirty: true },
    )
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const result = askQuestionBody(values, options)
    if (!result.ok) {
      form.setError(
        result.field,
        { type: 'manual', message: result.message },
        { shouldFocus: true },
      )
      return
    }
    const focus = focusFirstError(form.setError)
    const outcome = await ask.submit(result.body, {
      // Sunucunun `fileIds` maddesi formdaki fotoğraf listesinde görünür; yolsuz bağlama hatası
      // (taranan ya da reddedilen fotoğraf, 422 `file_not_ready`/`file_rejected`) da oraya yazılır.
      setError: (name: string, error) => focus(askFieldName(name), error),
      fieldFor: fileAttachField('fileIds'),
    })
    if (outcome.status === 'success') {
      notify.success('Sorunuz öğretmeninize iletildi.')
      onClose()
    }
  })

  return (
    <form
      noValidate
      aria-label="Yeni soru"
      onSubmit={(event) => {
        if (scanBlocked) return event.preventDefault()
        void onSubmit(event)
      }}
      className="grid gap-5"
    >
      <p
        role="note"
        className="flex gap-2.5 rounded-card border bg-surface-soft px-4 py-3 text-sm text-muted-foreground"
      >
        <Icon name="Info" size={17} aria-hidden="true" className="mt-0.5 shrink-0" />
        {QUESTION_SENSITIVE_NOTICE}
      </p>
      <FormField id="soru-ders" label="Ders" description={SUBJECT_HINT} error={errors.subjectId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('subjectId', {
              onChange: () => form.setValue('topic', ''),
            })}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Ders seçin</NativeSelectOption>
            {options.map((item) => (
              <NativeSelectOption key={item.subjectId} value={item.subjectId}>
                {item.subject}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <Controller
        name="teacherId"
        control={form.control}
        render={({ field }) => (
          <FormField id="soru-ogretmen" label="Öğretmen" error={errors.teacherId}>
            {(control) => (
              <NativeSelect
                {...control}
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                onChange={field.onChange}
                value={teacherChoice(option, field.value)}
                className="w-full"
                disabled={busy || !option}
              >
                {option?.teachers.length === 1 ? null : (
                  <NativeSelectOption value="">Öğretmen seçin</NativeSelectOption>
                )}
                {(option?.teachers ?? []).map((teacher) => (
                  <NativeSelectOption key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
      />
      {option && option.topics.length > 0 ? (
        <FormField id="soru-kazanim" label="Kazanım (isteğe bağlı)" error={errors.topic}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('topic')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Kazanım seçmeden gönder</NativeSelectOption>
              {option.topics.map((topic) => (
                <NativeSelectOption key={topic} value={topic}>
                  {topic}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <FormField
        id="soru-baslik"
        label="Konu başlığı"
        description={`En çok ${QUESTION_TITLE_MAX_LENGTH} karakter.`}
        error={errors.title}
      >
        {(control) => (
          <Input
            {...control}
            {...form.register('title')}
            placeholder="Hangi konuda yardıma ihtiyacın var?"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="soru-metin"
        label="Sorunuz"
        description={`En az ${QUESTION_TEXT_MIN_LENGTH}, en çok ${QUESTION_TEXT_MAX_LENGTH} karakter.`}
        error={errors.text}
      >
        {(control) => (
          <Textarea
            {...control}
            {...form.register('text')}
            rows={6}
            placeholder="Sorunu ve takıldığın noktayı açıkla..."
            disabled={busy}
          />
        )}
      </FormField>
      <FileUploadField
        id="soru-fotograf"
        label="Fotoğraf ekle (isteğe bağlı)"
        purpose={QUESTION_PHOTO_PURPOSE}
        multiple
        maxFiles={QUESTION_PHOTO_LIMIT}
        description={`Defter ya da kitap sayfasının fotoğrafı; JPEG, PNG ya da WEBP, en çok ${QUESTION_PHOTO_LIMIT} fotoğraf.`}
        listLabel="Eklenen fotoğraflar"
        items={photos}
        error={errors.files}
        disabled={ask.isPending || form.formState.isSubmitting}
        onUploaded={addPhoto}
        onRemoved={removePhoto}
        onBusyChange={(next) => {
          setUploading(next)
          if (next) form.clearErrors('files')
        }}
        onBlockedChange={setScanBlocked}
      />
      <RootError message={errors.root?.server?.message} />
      <FormActions
        busy={busy}
        disabled={scanBlocked}
        onCancel={onClose}
        submitLabel="Soruyu gönder"
        icon="ArrowRight"
      />
    </form>
  )
}
