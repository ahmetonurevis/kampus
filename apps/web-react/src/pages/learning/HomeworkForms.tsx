// Ödev formları (öğretmen ve yönetici; IST-095, DOM-AKD-070, 071, 073): ödev ver ve düzenle,
// teslimi değerlendir ve ödevi arşivle. Formlar sağ panelin içindedir; kirli form kapatılırken ya
// da sayfadan ayrılırken onay ister (`useRouteDiscardGuard`). `If-Match` sürümü gönderim anında
// kaydın yeniden okunan hâlindendir (açılıştaki kopya bayat olabilir); sürüm çakışmasında girdi
// korunur ve form içinde uyarı görünür. Hata kodu ilgili alanın altında, alana bağlanamayan kural
// hatası formun içinde, gerisi toast'ta görünür.
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import type { HomeworkDetail, HomeworkSubmission } from '@kampus/react-shared/homework.ts'
import {
  useArchiveHomework,
  useCreateHomework,
  useGradeSubmission,
  useHomework,
  useUpdateHomework,
} from '@kampus/react-shared/use-homework.ts'
import { HOMEWORK_FEEDBACK_MAX_LENGTH } from '@kampus/school-core/lib/homework.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useRouteDiscardGuard } from '@/hooks/use-route-discard-guard.tsx'
import { notify } from '@/lib/notify.ts'
import { RECORD_UNAVAILABLE_MESSAGE, submitWithFreshRecord } from '../language/fresh-submit.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  changedHomeworkFields,
  gradeFormDefaults,
  gradeFormSchema,
  homeworkClassOptions,
  homeworkErrorRoutes,
  homeworkFormDefaults,
  homeworkFormSchema,
  homeworkSubjectOptions,
  pickSubject,
  type GradeFormValues,
  type HomeworkActor,
  type HomeworkFormOutput,
  type HomeworkFormValues,
} from './homework-forms.ts'

/** `?odev-form=` değeri: yeni ödev. */
export const NEW_HOMEWORK = 'yeni'

const NONE: readonly never[] = []

/** Gönderimde kayıt başkası tarafından değişmişti: girdi korunur, yeniden kaydetmek yeterli. */
function ChangedNotice({ show, subject }: { show: boolean; subject: string }) {
  if (!show) return null
  return (
    <div role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
      {subject} bu arada başka biri tarafından değişti. Güncel hâli yüklendi; girdiniz korundu.
      Kontrol edip yeniden kaydedin.
    </div>
  )
}

/** Gönderim anında ödevi yeniden okur (`If-Match` sürümü buradan); okunamazsa `undefined`. */
function useFreshHomework(homeworkId: string) {
  const item = useHomework(homeworkId)
  async function fetchFresh(): Promise<HomeworkDetail | undefined> {
    const result = await item.refetch()
    return result.error ? undefined : result.data?.data
  }
  return { item, fetchFresh }
}

// --- Ödev ver / düzenle ------------------------------------------------------

type FormTargetProps = {
  /** `yeni` ya da düzenlenen ödevin kimliği. */
  target: string
  actor: HomeworkActor
  onClose: () => void
}

/** Sağ panel içeriği: yeni ödev formu ya da ödevi okuyup düzenleme formu. */
export function HomeworkFormContent({ target, actor, onClose }: FormTargetProps) {
  if (target === NEW_HOMEWORK) return <HomeworkForm actor={actor} onClose={onClose} />
  return <HomeworkEdit homeworkId={target} actor={actor} onClose={onClose} />
}

function HomeworkEdit({
  homeworkId,
  actor,
  onClose,
}: {
  homeworkId: string
  actor: HomeworkActor
  onClose: () => void
}) {
  const { item, fetchFresh } = useFreshHomework(homeworkId)
  // Formun açıldığı andaki kayıt: sonradan gelen tazeleme girdiyi silmesin.
  const [opened, setOpened] = useState<HomeworkDetail | null>(null)
  const live = item.data?.data
  if (!opened && live) setOpened(live)
  if (item.error && !opened)
    return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!opened) return <SummaryLoading />
  return <HomeworkForm homework={opened} fetchFresh={fetchFresh} actor={actor} onClose={onClose} />
}

function HomeworkForm({
  homework,
  fetchFresh,
  actor,
  onClose,
}: {
  homework?: HomeworkDetail
  fetchFresh?: () => Promise<HomeworkDetail | undefined>
  actor: HomeworkActor
  onClose: () => void
}) {
  const create = useCreateHomework()
  const update = useUpdateHomework()
  const classes = useCoreAll('classes')
  const subjects = useCoreAll('subjects')
  const assignments = useCoreAll('assignments')
  const form = useForm<HomeworkFormValues, unknown, HomeworkFormOutput>({
    resolver: zodResolver(homeworkFormSchema),
    defaultValues: homeworkFormDefaults(homework),
  })
  const [changed, setChanged] = useState(false)
  const guard = useRouteDiscardGuard(form.formState.isDirty)
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const classId = useWatch({ control: form.control, name: 'classId' })
  const records = {
    classes: classes.data?.map((row) => row.record) ?? NONE,
    subjects: subjects.data?.map((row) => row.record) ?? NONE,
    assignments: assignments.data?.map((row) => row.record) ?? NONE,
  }
  const classOptions = homeworkClassOptions(records.classes, records.assignments, actor)
  const subjectOptions = homeworkSubjectOptions(
    classId,
    records.assignments,
    records.subjects,
    actor,
  )
  const editing = homework !== undefined
  const lookupError = classes.error ?? subjects.error ?? assignments.error
  const lookupsPending =
    !editing && (classes.isPending || subjects.isPending || assignments.isPending)

  const onSubmit = form.handleSubmit(async (values) => {
    const routes = { setError: form.setError, ...homeworkErrorRoutes('homework') }
    setChanged(false)
    if (!homework || !fetchFresh) {
      const outcome = await create.submit(values, routes)
      if (outcome.status === 'success') {
        notify.success('Ödev verildi.')
        guard.leave()
        onClose()
      }
      return
    }
    const result = await submitWithFreshRecord(fetchFresh, async (fresh) => {
      const body = changedHomeworkFields(fresh, values)
      if (Object.keys(body).length === 0) {
        const touched = Object.keys(changedHomeworkFields(homework, values)).length > 0
        form.setError('root.server', {
          type: 'manual',
          message: touched ? 'Ödev zaten bu değerlerde kayıtlı.' : 'Değişiklik yapmadınız.',
        })
        return { status: 'busy' as const }
      }
      return update.submit({ homeworkId: fresh.id, version: fresh.version, body }, routes)
    })
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.conflicted) {
      setChanged(true)
      return
    }
    if (result.outcome.status === 'success') {
      notify.success('Ödev güncellendi.')
      guard.leave()
      onClose()
    }
  })

  const title = editing ? 'Ödevi düzenle' : 'Ödev ver'
  if (lookupError)
    return (
      <QueryError
        error={lookupError}
        onRetry={() => {
          for (const query of [classes, subjects, assignments])
            if (query.error) void query.refetch()
        }}
      />
    )
  if (lookupsPending) return <SummaryLoading />
  if (!editing && classOptions.length === 0)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Ödev verebileceğiniz sınıf yok. Ödev, sınıfın dersine atanmış öğretmen üzerinden verilir.
      </p>
    )
  return (
    <>
      <form
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-5"
      >
        <ChangedNotice show={changed} subject="Ödev" />
        <p className="text-sm text-muted-foreground">
          {editing
            ? 'Sınıf ve ders değişmez; yanlış sınıfa verilen ödevi arşivleyip yeniden verin.'
            : 'Son teslim Türkiye saatiyle girilir.'}
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="odev-sinif" label="Sınıf" error={errors.classId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('classId', {
                  onChange: (event: { target: { value: string } }) =>
                    form.setValue(
                      'subjectId',
                      pickSubject(
                        form.getValues('subjectId'),
                        homeworkSubjectOptions(
                          event.target.value,
                          records.assignments,
                          records.subjects,
                          actor,
                        ),
                      ),
                      { shouldDirty: true },
                    ),
                })}
                disabled={busy || editing}
                className="w-full"
              >
                <NativeSelectOption value="">Sınıf seçin</NativeSelectOption>
                {(editing
                  ? [{ value: homework.classId, label: className(homework, records.classes) }]
                  : classOptions
                ).map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="odev-ders" label="Ders" error={errors.subjectId}>
            {(control) => (
              // Denetimli seçim: sınıf değişince ders seçenekleri bir sonraki çizimde gelir;
              // `setValue` kayıtlı (denetimsiz) seçime henüz olmayan seçeneği yazamaz.
              <Controller
                control={form.control}
                name="subjectId"
                render={({ field }) => (
                  <NativeSelect
                    {...control}
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={busy || editing || !classId}
                    className="w-full"
                  >
                    <NativeSelectOption value="">
                      {classId ? 'Ders seçin' : 'Önce sınıf seçin'}
                    </NativeSelectOption>
                    {(editing
                      ? [{ value: homework.subjectId, label: homework.subject }]
                      : subjectOptions
                    ).map((option) => (
                      <NativeSelectOption key={option.value} value={option.value}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              />
            )}
          </FormField>
        </div>
        <FormField id="odev-baslik" label="Başlık" error={errors.title}>
          {(control) => (
            <Input {...control} {...form.register('title')} maxLength={120} disabled={busy} />
          )}
        </FormField>
        <FormField id="odev-aciklama" label="Açıklama" error={errors.description}>
          {(control) => (
            <Textarea
              {...control}
              {...form.register('description')}
              rows={5}
              maxLength={4000}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="odev-son-teslim"
          label="Son teslim"
          error={errors.dueDate}
          description="Tarih ve saat Türkiye saatiyle; geçmiş bir an seçilemez."
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('dueDate')}
              type="datetime-local"
              disabled={busy}
            />
          )}
        </FormField>
        <Controller
          control={form.control}
          name="allowLate"
          render={({ field }) => (
            <div className="flex items-start gap-2">
              <Checkbox
                id="odev-gec-teslim"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                disabled={busy}
              />
              <Label htmlFor="odev-gec-teslim" className="text-sm leading-snug">
                Son teslimden sonra geç teslim kabul edilsin
              </Label>
            </div>
          )}
        />
        <RootError message={errors.root?.server?.message} />
        <FormActions
          busy={busy}
          onCancel={onClose}
          submitLabel={editing ? 'Kaydet' : 'Ödevi ver'}
        />
      </form>
      {guard.dialog}
    </>
  )
}

function className(
  homework: Pick<HomeworkDetail, 'classId'>,
  classes: readonly { id: string; name: string }[],
) {
  return classes.find((item) => item.id === homework.classId)?.name ?? homework.classId
}

// --- Değerlendirme -----------------------------------------------------------

export function GradeForm({
  homeworkId,
  submission,
  fetchFresh,
  onClose,
}: {
  homeworkId: string
  submission: HomeworkSubmission
  /** Gönderim anında teslimi yeniden okur; teslim artık yoksa `undefined`. */
  fetchFresh: () => Promise<HomeworkSubmission | undefined>
  onClose: () => void
}) {
  const grade = useGradeSubmission()
  const form = useForm<GradeFormValues>({
    resolver: zodResolver(gradeFormSchema),
    defaultValues: gradeFormDefaults(submission),
  })
  const [changed, setChanged] = useState(false)
  const guard = useRouteDiscardGuard(form.formState.isDirty)
  const busy = grade.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const regrade = submission.score !== null

  const onSubmit = form.handleSubmit(async (values) => {
    setChanged(false)
    const result = await submitWithFreshRecord(fetchFresh, (fresh) =>
      grade.submit(
        { homeworkId, submissionId: fresh.id, version: fresh.version, body: values },
        { setError: form.setError, ...homeworkErrorRoutes('grade') },
      ),
    )
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.conflicted) {
      setChanged(true)
      return
    }
    if (result.outcome.status === 'success') {
      notify.success('Değerlendirme kaydedildi.')
      guard.leave()
      onClose()
    }
  })

  return (
    <>
      <form
        noValidate
        aria-label="Teslimi değerlendir"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-5"
      >
        <ChangedNotice show={changed} subject="Teslim" />
        <p className="text-sm text-muted-foreground">
          Puan resmî not değildir. Kaydedince öğrenciye ve velisine bildirim gider; bildirim puanı
          ve geri bildirimi göstermez.
        </p>
        <FormField id="teslim-puan" label="Puan (0–100)" error={errors.score}>
          {(control) => (
            <Input
              {...control}
              {...form.register('score', { valueAsNumber: true })}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="teslim-geri-bildirim"
          label="Geri bildirim"
          error={errors.feedback}
          description={`Öğrenci ve velisi görür. En çok ${HOMEWORK_FEEDBACK_MAX_LENGTH} karakter.`}
        >
          {(control) => (
            <Textarea
              {...control}
              {...form.register('feedback')}
              rows={5}
              maxLength={HOMEWORK_FEEDBACK_MAX_LENGTH}
              disabled={busy}
            />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <FormActions
          busy={busy}
          onCancel={onClose}
          submitLabel={regrade ? 'Değerlendirmeyi güncelle' : 'Değerlendir'}
        />
      </form>
      {guard.dialog}
    </>
  )
}

// --- Arşiv -------------------------------------------------------------------

/**
 * Ödevi onayla arşivler (DOM-AKD-071). Teslim almış ödev arşivlenmez; ekranda teslim görünmese de
 * (başka öğretmenin teslimleri) sunucu 409 `homework_has_submissions` verir ve mesaj toast olur.
 */
export function ArchiveHomeworkDialog({
  homework,
  open,
  onOpenChange,
  onArchived,
}: {
  homework: Pick<HomeworkDetail, 'id' | 'title'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onArchived: () => void
}) {
  const archive = useArchiveHomework()
  const { fetchFresh } = useFreshHomework(homework.id)
  const busy = archive.isPending

  async function confirm() {
    const result = await submitWithFreshRecord(fetchFresh, (fresh) =>
      archive.submit({ homeworkId: fresh.id, version: fresh.version }),
    )
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.outcome.status === 'success') {
      notify.success(`${homework.title} arşivlendi.`)
      onOpenChange(false)
      onArchived()
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ödevi arşivle</AlertDialogTitle>
          <AlertDialogDescription>
            {homework.title} ödev listesinden kalkar. Teslim alınmış ödev arşivlenemez; öğrencilerin
            teslimleri ve puanları korunur.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Vazgeç</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={(event) => {
              // Pencere sonuç gelene kadar açık kalır; başarıda kapanır.
              event.preventDefault()
              void confirm()
            }}
          >
            Arşivle
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
