// Öğrencinin ödev teslim formu (IST-095; DOM-AKD-072). Not ve en çok 5 dosyayla teslim; dosya
// seçilir seçilmez `POST /files` (amaç `submission`) ile sırayla yüklenir ve teslimde aynı işlemle
// teslime bağlanır (ADR 0003). Puanlanmamış teslim yenilenebilir; son teslim geçtiyse ve ödev geç
// teslime açıksa teslim geç olarak işaretlenir. Kirli form kapatılırken onay ister. Son teslim
// formu açıkken geçerse form sökülmez ve girdi kaybolmaz; uyarı gösterilir, karar sunucudadır
// (422 `homework_closed` formun içinde). Yükleme sürerken form kapanırsa istek durdurulur.
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { fileLabel } from '@kampus/react-shared/files.ts'
import { submitHomeworkBody, type HomeworkSubmission } from '@kampus/react-shared/homework.ts'
import { useFileInfos } from '@kampus/react-shared/use-files.ts'
import { fileIdentity, useFileUpload } from '@kampus/react-shared/use-file-upload.ts'
import { useSubmitHomework } from '@kampus/react-shared/use-homework.ts'
import { FILE_PURPOSES } from '@kampus/school-core/content/taxonomy.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useRouteDiscardGuard } from '@/hooks/use-route-discard-guard.tsx'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  addUploadedFile,
  fitFiles,
  homeworkErrorRoutes,
  SUBMISSION_FILE_LIMIT,
  SUBMISSION_NOTE_MAX_LENGTH,
  submissionFormSchema,
  type SubmissionFile,
  type SubmissionFormValues,
} from './homework-forms.ts'

const ACCEPT = FILE_PURPOSES.submission.mimeTypes.join(',')

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
  const uploader = useFileUpload()
  const form = useForm<SubmissionFormValues>({
    resolver: zodResolver(submissionFormSchema),
    defaultValues: defaultsOf(submission),
  })
  const guard = useRouteDiscardGuard(form.formState.isDirty)
  const [uploading, setUploading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const aborter = useRef<AbortController | null>(null)
  const files = useWatch({ control: form.control, name: 'files' })
  const busy = submit.isPending || uploading || form.formState.isSubmitting
  const errors = form.formState.errors
  const resubmit = submission !== undefined

  // Panel kapanınca (form sökülünce) süren yükleme durur.
  useEffect(() => () => aborter.current?.abort(), [])

  async function addFiles(picked: readonly File[]) {
    form.clearErrors('files')
    const { accepted, dropped, duplicates } = fitFiles(
      form.getValues('files'),
      picked,
      fileIdentity,
    )
    const controller = new AbortController()
    aborter.current = controller
    // Dosya alanına tek hata yazılır: tüm uyarılar birleştirilir (sonuncusu öncekini ezmez).
    const problems: string[] = []
    setUploading(true)
    try {
      for (const file of accepted) {
        if (controller.signal.aborted) return
        const result = await uploader.upload(
          'submission',
          file,
          { silent: () => controller.signal.aborted },
          controller.signal,
        )
        if (controller.signal.aborted) return
        if ('ok' in result) {
          problems.push(`${file.name}: ${result.message}`)
          continue
        }
        if (result.status !== 'success') continue
        const uploaded = result.data.data
        const current = form.getValues('files')
        if (current.some((item) => item.id === uploaded.id)) {
          problems.push(`${file.name}: bu dosya zaten ekli.`)
          continue
        }
        form.setValue(
          'files',
          addUploadedFile(current, {
            id: uploaded.id,
            name: uploaded.originalName ?? file.name,
            key: fileIdentity(file),
          }),
          { shouldDirty: true },
        )
      }
    } finally {
      if (!controller.signal.aborted) {
        setUploading(false)
        if (input.current) input.current.value = ''
      }
    }
    if (duplicates > 0) problems.push(`${duplicates} dosya zaten ekli olduğu için atlandı.`)
    if (dropped > 0)
      problems.push(
        `En fazla ${SUBMISSION_FILE_LIMIT} dosya ekleyebilirsiniz; ${dropped} dosya eklenmedi.`,
      )
    if (problems.length > 0) form.setError('files', { type: 'manual', message: problems.join(' ') })
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
        onSubmit={(event) => void onSubmit(event)}
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
        <FormField
          id="teslim-dosya"
          label="Dosya ekle"
          error={errors.files}
          description={`PDF, Word ya da görsel; en çok ${SUBMISSION_FILE_LIMIT} dosya.`}
        >
          {(control) => (
            <input
              {...control}
              ref={input}
              type="file"
              multiple
              accept={ACCEPT}
              disabled={busy || files.length >= SUBMISSION_FILE_LIMIT}
              aria-busy={uploading || undefined}
              onChange={(event) => void addFiles([...(event.target.files ?? [])])}
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium disabled:opacity-50"
            />
          )}
        </FormField>
        {uploading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Dosya yükleniyor…
          </p>
        ) : null}
        <AttachedFiles files={files} disabled={busy} onRemove={removeFile} />
        <RootError message={errors.root?.server?.message} />
        <div className="flex justify-end">
          <Button type="submit" disabled={busy} aria-busy={submit.isPending || undefined}>
            <Icon name="Send" size={16} aria-hidden="true" />
            {resubmit ? 'Teslimi güncelle' : 'Teslim et'}
          </Button>
        </div>
      </form>
      {guard.dialog}
    </>
  )
}

/** Teslime eklenecek dosyalar; adı bilinmeyen (önceki teslimden gelen) dosya meta veriden okunur. */
function AttachedFiles({
  files,
  disabled,
  onRemove,
}: {
  files: readonly SubmissionFile[]
  disabled: boolean
  onRemove: (id: string) => void
}) {
  const infos = useFileInfos(files.map((file) => file.id))
  if (!files.length) return null
  return (
    <ul aria-label="Eklenen dosyalar" className="grid gap-2">
      {files.map((file, index) => {
        const name = file.name || fileLabel(infos[index]?.data, index)
        return (
          <li
            key={file.id}
            className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon name="FileText" size={16} aria-hidden="true" />
              <span className="truncate">{name}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${name} dosyasını kaldır`}
              disabled={disabled}
              onClick={() => onRemove(file.id)}
            >
              <Icon name="X" size={15} aria-hidden="true" />
              Kaldır
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
