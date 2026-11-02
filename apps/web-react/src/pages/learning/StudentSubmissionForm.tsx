// Öğrencinin ödev teslim formu (IST-095; DOM-AKD-072). Not ve en çok 5 dosyayla teslim; dosya
// seçilir seçilmez `FileUploadField` ile (`POST /files`, amaç `submission`) sırayla yüklenir ve teslimde aynı işlemle
// teslime bağlanır (ADR 0003). Puanlanmamış teslim yenilenebilir; son teslim geçtiyse ve ödev geç
// teslime açıksa teslim geç olarak işaretlenir. Kirli form kapatılırken onay ister. Son teslim
// formu açıkken geçerse form sökülmez ve girdi kaybolmaz; uyarı gösterilir, karar sunucudadır
// (422 `homework_closed` formun içinde). Yükleme sürerken form kapanırsa istek durdurulur.
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { fileLabel } from '@kampus/react-shared/files.ts'
import { submitHomeworkBody, type HomeworkSubmission } from '@kampus/react-shared/homework.ts'
import { useFileInfos } from '@kampus/react-shared/use-files.ts'
import { useSubmitHomework } from '@kampus/react-shared/use-homework.ts'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useRouteDiscardGuard } from '@/hooks/use-route-discard-guard.tsx'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  addUploadedFile,
  homeworkErrorRoutes,
  SUBMISSION_FILE_LIMIT,
  SUBMISSION_NOTE_MAX_LENGTH,
  submissionFormSchema,
  type SubmissionFormValues,
} from './homework-forms.ts'

type Props = {
  homeworkId: string
  /** Öğrencinin mevcut (puanlanmamış) teslimi; yoksa ilk teslim. */
  submission: HomeworkSubmission | undefined
  /** Son teslim geçti, ödev geç teslime açık: teslim geç olarak işaretlenir. */
  late: boolean
  /** Form açıkken ödev geç teslime kapandı: girdi korunur, gönderimi sunucu yanıtlar. */
  closed?: boolean
}

const defaultsOf = (submission: HomeworkSubmission | undefined): SubmissionFormValues => ({
  note: submission?.note ?? '',
  // Önceki teslimin dosyalarının adı meta veriden okunur (`FileName`).
  files: (submission?.fileIds ?? []).map((id) => ({ id, name: '' })),
})

export function StudentSubmissionForm({ homeworkId, submission, late, closed = false }: Props) {
  const submit = useSubmitHomework()
  const form = useForm<SubmissionFormValues>({
    resolver: zodResolver(submissionFormSchema),
    defaultValues: defaultsOf(submission),
  })
  const guard = useRouteDiscardGuard(form.formState.isDirty)
  const [uploading, setUploading] = useState(false)
  // Taranan dosya yalnız teslim düğmesini kilitler; açıklama alanı açık kalır (OG-987).
  const [scanBlocked, setScanBlocked] = useState(false)
  const files = useWatch({ control: form.control, name: 'files' })
  const busy = submit.isPending || uploading || form.formState.isSubmitting
  const errors = form.formState.errors
  const resubmit = submission !== undefined
  // Önceki teslimin dosyalarının adı meta veriden okunur (adı bilinmeyen dosya için).
  const infos = useFileInfos(files.map((file) => file.id))
  const items = files.map((file, index) => ({
    ...file,
    name: file.name || fileLabel(infos[index]?.data, index),
  }))

  function addUploaded(item: FileUploadItem) {
    form.clearErrors('files')
    form.setValue('files', addUploadedFile(form.getValues('files'), item), { shouldDirty: true })
  }

  function removeFile(id: string) {
    form.clearErrors('files')
    form.setValue(
      'files',
      form.getValues('files').filter((file) => file.id !== id),
      { shouldDirty: true },
    )
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await submit.submit(
      {
        homeworkId,
        body: submitHomeworkBody({
          note: values.note,
          fileIds: values.files.map((file) => file.id),
        }),
      },
      { setError: form.setError, ...homeworkErrorRoutes('submit') },
    )
    if (outcome.status !== 'success') return
    notify.success(resubmit ? 'Teslimin güncellendi.' : 'Ödev teslim edildi.')
    // Form açık kalır (yeniden teslim); gönderilen değerler yeni başlangıçtır.
    form.reset({ note: values.note.trim(), files: values.files })
  })

  return (
    <>
      <form
        noValidate
        aria-label="Ödevi teslim et"
        onSubmit={(event) => {
          if (scanBlocked) return event.preventDefault()
          void onSubmit(event)
        }}
        className="grid gap-5"
      >
        {closed ? (
          <div role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
            Teslim süresi doldu; bu ödev geç teslime kapalı. Yazdıkların ve dosyaların korundu;
            göndermeyi yine de deneyebilirsin, kabul edilip edilmeyeceğine sistem karar verir.
          </div>
        ) : null}
        {late ? (
          <div role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
            Son teslim zamanı geçti. Teslimin geç teslim olarak işaretlenir.
          </div>
        ) : null}
        {resubmit ? (
          <p className="text-sm text-muted-foreground">
            Öğretmenin değerlendirene kadar teslimini güncelleyebilirsin; yeni teslim öncekinin
            yerine geçer.
          </p>
        ) : null}
        <FormField
          id="teslim-aciklama"
          label="Açıklama"
          error={errors.note}
          description={`Öğretmenine iletmek istediğin açıklama. En çok ${SUBMISSION_NOTE_MAX_LENGTH} karakter.`}
        >
          {(control) => (
            <Textarea
              {...control}
              {...form.register('note')}
              rows={4}
              maxLength={SUBMISSION_NOTE_MAX_LENGTH}
              disabled={busy}
            />
          )}
        </FormField>
        <FileUploadField
          id="teslim-dosya"
          label="Dosya ekle"
          purpose="submission"
          multiple
          maxFiles={SUBMISSION_FILE_LIMIT}
          description={`PDF, Word ya da görsel; en çok ${SUBMISSION_FILE_LIMIT} dosya.`}
          items={items}
          error={errors.files}
          disabled={submit.isPending || form.formState.isSubmitting}
          onUploaded={addUploaded}
          onRemoved={removeFile}
          onBusyChange={(busy) => {
            setUploading(busy)
            if (busy) form.clearErrors('files')
          }}
          onBlockedChange={setScanBlocked}
        />
        <RootError message={errors.root?.server?.message} />
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={busy || scanBlocked}
            aria-busy={submit.isPending || undefined}
          >
            <Icon name="Send" size={16} aria-hidden="true" />
            {resubmit ? 'Teslimi güncelle' : 'Teslim et'}
          </Button>
        </div>
      </form>
      {guard.dialog}
    </>
  )
}
