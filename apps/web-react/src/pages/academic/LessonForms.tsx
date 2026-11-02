// Ders programı formları (yönetici; IST-094, DOM-YTK-069): ders planla/düzenle, yedek öğretmen
// ata ve dersi iptal et. Her form kendi penceresindedir; kirli form kapatılırken ya da sayfadan
// ayrılırken onay ister. Sürüm çakışmasında form korunur ve güncel dersi yükleme önerilir; ders
// çakışmasında sunucunun mesajı ilgili alanın altında görünür.
import { zodResolver } from '@hookform/resolvers/zod'
import { useRef, type ReactNode } from 'react'
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { useBlocker } from 'react-router'
import {
  useCancelLesson,
  useCreateLesson,
  useLesson,
  useSubstituteLesson,
  useUpdateLesson,
} from '@kampus/react-shared/use-lessons.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
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
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import { notify } from '@/lib/notify.ts'
import {
  ConflictNotice,
  FormActions,
  isVersionConflict,
  RootError,
  useEditConflict,
} from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import type { AcademicLookups } from './academic-rows.ts'
import {
  cancelFormSchema,
  changedLessonFields,
  classOptions,
  keepValidOption,
  lessonErrorRoutes,
  lessonActions,
  lessonFormDefaults,
  lessonFormSchema,
  REASON_MAX_LENGTH,
  substituteCandidates,
  substituteFormSchema,
  subjectOptions,
  teacherOptions,
  type CancelFormValues,
  type Lesson,
  type LessonFormOutput,
  type LessonFormValues,
  type Option,
  type SubstituteFormValues,
} from './schedule-model.ts'

/** `?ders-form=` değeri: yeni ders. */
export const NEW_LESSON = 'yeni'

/**
 * Kirli form koruması: pencere kapatma ve sayfa içi gezinme (geri, bağlantı) aynı yoldan geçer;
 * form kirliyse gezinme durur ve onay sorulur. Başarılı gönderimden sonra `leave()` korumayı
 * kaldırır (form sıfırlanmadan kapanır).
 */
function useDiscardGuard(dirty: boolean) {
  const leaving = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !leaving.current &&
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  )
  const dialog = (
    <AlertDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kaydedilmemiş değişiklikler var</AlertDialogTitle>
          <AlertDialogDescription>
            Formdaki değişiklikler kaydedilmedi. Kapatırsanız silinir.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Düzenlemeye devam et</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Radix kendi kapanışını yapmasın; gezinme sürer ve pencere kapanır.
              event.preventDefault()
              if (blocker.state === 'blocked') blocker.proceed()
            }}
          >
            Değişiklikleri at
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return {
    dialog,
    leave: () => {
      leaving.current = true
    },
  }
}

function FormDialog({
  title,
  description,
  size = 'default',
  onClose,
  guard,
  busy,
  children,
}: {
  title: string
  description?: string
  size?: 'default' | 'wide'
  onClose: () => void
  guard: ReactNode
  busy: boolean
  children: ReactNode
}) {
  return (
    <>
      <Modal
        open
        onOpenChange={(open) => (open || busy ? undefined : onClose())}
        title={title}
        size={size}
        {...(description ? { description } : {})}
      >
        {children}
      </Modal>
      {guard}
    </>
  )
}

/** Ders artık değiştirilemiyorsa (iptal edildi, başladı) form yerine açıklama. */
function Unavailable({ lesson, now }: { lesson: Lesson; now: string }) {
  if (lessonActions(lesson, true, now).edit) return null
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {lesson.status === 'cancelled'
        ? 'Bu ders iptal edildi; değiştirilemez.'
        : 'Başlamış ya da geçmiş ders değiştirilemez.'}
    </p>
  )
}

// --- Ders planla / düzenle ----------------------------------------------------

type LessonDialogProps = {
  /** `yeni` ya da düzenlenen dersin kimliği. */
  target: string
  lookups: AcademicLookups
  onClose: () => void
}

export function LessonFormDialog({ target, lookups, onClose }: LessonDialogProps) {
  if (target === NEW_LESSON) return <LessonForm lookups={lookups} onClose={onClose} />
  return <LessonEdit lessonId={target} lookups={lookups} onClose={onClose} />
}

function LessonEdit({
  lessonId,
  lookups,
  onClose,
}: {
  lessonId: string
  lookups: AcademicLookups
  onClose: () => void
}) {
  const item = useLesson(lessonId)
  const now = useMinuteClock()
  const lesson = item.data?.data
  if (!lesson || item.error || !lessonActions(lesson, true, now).edit)
    return (
      <Modal open onOpenChange={(open) => (open ? undefined : onClose())} title="Dersi düzenle">
        {item.error ? (
          <QueryError error={item.error} onRetry={() => void item.refetch()} />
        ) : lesson ? (
          <Unavailable lesson={lesson} now={now} />
        ) : (
          <SummaryLoading />
        )}
      </Modal>
    )
  return (
    <LessonForm
      lesson={lesson}
      lookups={lookups}
      onClose={onClose}
      reload={async () => {
        const fresh = (await item.refetch()).data?.data
        return fresh ? { version: fresh.version, values: lessonFormDefaults(fresh) } : null
      }}
    />
  )
}

function SelectField({
  form,
  name,
  id,
  label,
  options,
  placeholder,
  disabled,
  description,
  onPick,
}: {
  form: UseFormReturn<LessonFormValues, unknown, LessonFormOutput>
  name: 'classId' | 'subjectId' | 'teacherId'
  id: string
  label: string
  options: readonly Option[]
  placeholder: string
  disabled: boolean
  description?: string
  onPick?: (value: string) => void
}) {
  const registered = form.register(name, {
    onChange: (event: { target: { value: string } }) => onPick?.(event.target.value),
  })
  return (
    <FormField
      id={id}
      label={label}
      error={form.formState.errors[name]}
      {...(description ? { description } : {})}
    >
      {(control) => (
        <NativeSelect {...control} {...registered} disabled={disabled} className="w-full">
          <NativeSelectOption value="">{placeholder}</NativeSelectOption>
          {options.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}

function LessonForm({
  lesson,
  lookups,
  onClose,
  reload,
}: {
  lesson?: Lesson
  lookups: AcademicLookups
  onClose: () => void
  reload?: () => Promise<{ version: number; values: LessonFormValues } | null>
}) {
  const create = useCreateLesson()
  const update = useUpdateLesson()
  const form = useForm<LessonFormValues, unknown, LessonFormOutput>({
    resolver: zodResolver(lessonFormSchema),
    defaultValues: lessonFormDefaults(lesson),
  })
  const conflict = useEditConflict<LessonFormValues>({
    initialVersion: lesson?.version ?? 0,
    reload: async () => (reload ? reload() : null),
    apply: (values) => form.reset(values),
  })
  const guard = useDiscardGuard(form.formState.isDirty)
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const [classId = '', subjectId = ''] = useWatch({
    control: form.control,
    name: ['classId', 'subjectId'],
  })
  const classes = classOptions(lookups)
  const subjects = subjectOptions(classId, lookups)
  const teachers = teacherOptions(classId, subjectId, lookups)
  // Yedek atanmış derste öğretmen düzenlemeyle değişmez (DOM-YTK-069, `lesson_has_substitution`).
  const teacherLocked = Boolean(lesson?.originalTeacherId)

  // Üst seçim değişince artık geçersiz olan alt seçimler temizlenir (sınıf → ders → öğretmen).
  function pickClass(next: string) {
    const nextSubject = keepValidOption(form.getValues('subjectId'), subjectOptions(next, lookups))
    form.setValue('subjectId', nextSubject, { shouldDirty: true })
    if (!teacherLocked)
      form.setValue(
        'teacherId',
        keepValidOption(form.getValues('teacherId'), teacherOptions(next, nextSubject, lookups)),
        { shouldDirty: true },
      )
  }
  function pickSubject(next: string) {
    if (teacherLocked) return
    form.setValue(
      'teacherId',
      keepValidOption(form.getValues('teacherId'), teacherOptions(classId, next, lookups)),
      { shouldDirty: true },
    )
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const routes = { setError: form.setError, ...lessonErrorRoutes('lesson') }
    const outcome = lesson
      ? await (async () => {
          const body = changedLessonFields(lesson, values)
          if (Object.keys(body).length === 0) {
            form.setError('root.server', { type: 'manual', message: 'Değişiklik yapmadınız.' })
            return null
          }
          return update.submit({ lessonId: lesson.id, version: conflict.version, body }, routes)
        })()
      : await create.submit(values, routes)
    if (!outcome) return
    if (outcome.status === 'success') {
      notify.success(lesson ? 'Ders güncellendi.' : 'Ders planlandı.')
      guard.leave()
      onClose()
    } else if (outcome.status === 'failed' && isVersionConflict(outcome.error)) {
      conflict.markConflict()
    }
  })

  const title = lesson ? 'Dersi düzenle' : 'Ders planla'
  return (
    <FormDialog title={title} onClose={onClose} guard={guard.dialog} busy={busy}>
      <form
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-5"
      >
        {conflict.conflicted ? (
          <ConflictNotice
            onReload={() => void conflict.reloadRecord()}
            reloading={conflict.reloading}
          />
        ) : null}
        <p className="text-sm text-muted-foreground">
          Bu formdaki tüm alanlar zorunludur. Saatler Türkiye saatiyle girilir.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            form={form}
            name="classId"
            id="ders-sinif"
            label="Sınıf"
            options={classes}
            placeholder="Sınıf seçin"
            disabled={busy}
            onPick={pickClass}
          />
          <SelectField
            form={form}
            name="subjectId"
            id="ders-ders"
            label="Ders"
            options={subjects}
            placeholder={classId ? 'Ders seçin' : 'Önce sınıf seçin'}
            disabled={busy || !classId}
            onPick={pickSubject}
          />
          <SelectField
            form={form}
            name="teacherId"
            id="ders-ogretmen"
            label="Öğretmen"
            options={
              teacherLocked && lesson
                ? [
                    {
                      value: lesson.teacherId,
                      label: lookups.teachers.get(lesson.teacherId)?.name ?? 'Yedek öğretmen',
                    },
                  ]
                : teachers
            }
            placeholder={subjectId ? 'Öğretmen seçin' : 'Önce ders seçin'}
            disabled={busy || teacherLocked || !subjectId}
            {...(teacherLocked
              ? { description: 'Bu derse yedek atanmış; öğretmen yedek atama işlemiyle değişir.' }
              : {})}
          />
          <FormField id="ders-baslangic" label="Ders başlangıcı" error={errors.date}>
            {(control) => (
              <Input
                {...control}
                {...form.register('date')}
                type="datetime-local"
                disabled={busy}
              />
            )}
          </FormField>
          <FormField id="ders-sure" label="Süre (dakika)" error={errors.duration}>
            {(control) => (
              <Input
                {...control}
                {...form.register('duration')}
                type="number"
                inputMode="numeric"
                min={10}
                max={180}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField id="ders-derslik" label="Derslik" error={errors.room}>
            {(control) => (
              <Input
                {...control}
                {...form.register('room')}
                maxLength={80}
                placeholder="Örn. 101"
                disabled={busy}
              />
            )}
          </FormField>
        </div>
        <RootError message={errors.root?.server?.message} />
        <FormActions
          busy={busy}
          disabled={conflict.conflicted}
          onCancel={onClose}
          submitLabel={lesson ? 'Kaydet' : 'Dersi planla'}
        />
      </form>
    </FormDialog>
  )
}

// --- Yedek öğretmen ata ve iptal ---------------------------------------------

type ReasonDialogProps = {
  lessonId: string
  lookups: AcademicLookups
  onClose: () => void
}

/** Ortak çatı: dersi okur; değiştirilemiyorsa açıklama, değilse formu çizer. */
function WithLesson({
  lessonId,
  title,
  onClose,
  children,
}: {
  lessonId: string
  title: string
  onClose: () => void
  children: (lesson: Lesson, reload: () => Promise<Lesson | null>) => ReactNode
}) {
  const item = useLesson(lessonId)
  const now = useMinuteClock()
  const lesson = item.data?.data
  if (!lesson || item.error || !lessonActions(lesson, true, now).edit)
    return (
      <Modal open onOpenChange={(open) => (open ? undefined : onClose())} title={title}>
        {item.error ? (
          <QueryError error={item.error} onRetry={() => void item.refetch()} />
        ) : lesson ? (
          <Unavailable lesson={lesson} now={now} />
        ) : (
          <SummaryLoading />
        )}
      </Modal>
    )
  return children(lesson, async () => (await item.refetch()).data?.data ?? null)
}

function lessonSummary(lesson: Lesson, lookups: AcademicLookups) {
  const title = lesson.title ?? lookups.subjects.get(lesson.subjectId)?.name ?? 'Ders'
  const className = lookups.classes.get(lesson.classId)?.name
  return [title, className].filter(Boolean).join(' · ')
}

export function SubstituteDialog({ lessonId, lookups, onClose }: ReasonDialogProps) {
  return (
    <WithLesson lessonId={lessonId} title="Yedek öğretmen ata" onClose={onClose}>
      {(lesson, reload) => (
        <SubstituteForm lesson={lesson} reload={reload} lookups={lookups} onClose={onClose} />
      )}
    </WithLesson>
  )
}

function SubstituteForm({
  lesson,
  reload,
  lookups,
  onClose,
}: {
  lesson: Lesson
  reload: () => Promise<Lesson | null>
  lookups: AcademicLookups
  onClose: () => void
}) {
  const substitute = useSubstituteLesson()
  const form = useForm<SubstituteFormValues>({
    resolver: zodResolver(substituteFormSchema),
    defaultValues: { teacherId: '', reason: '' },
  })
  // Gerekçe korunur; yalnız `If-Match` sürümü güncel derse geçer.
  const conflict = useEditConflict<null>({
    initialVersion: lesson.version,
    reload: async () => {
      const fresh = await reload()
      return fresh ? { version: fresh.version, values: null } : null
    },
    apply: () => undefined,
  })
  const guard = useDiscardGuard(form.formState.isDirty)
  const busy = substitute.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const candidates = substituteCandidates(lesson, lookups)

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await substitute.submit(
      { lessonId: lesson.id, version: conflict.version, body: values },
      { setError: form.setError, ...lessonErrorRoutes('substitute') },
    )
    if (outcome.status === 'success') {
      notify.success('Yedek öğretmen atandı.')
      guard.leave()
      onClose()
    } else if (outcome.status === 'failed' && isVersionConflict(outcome.error)) {
      conflict.markConflict()
    }
  })

  return (
    <FormDialog
      title="Yedek öğretmen ata"
      description="Yalnız bu dersin öğretmeni değişir; kalıcı branş ataması korunur. Gerekçe yalnız yöneticilere görünür."
      onClose={onClose}
      guard={guard.dialog}
      busy={busy}
    >
      <form
        noValidate
        aria-label="Yedek öğretmen ata"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-5"
      >
        {conflict.conflicted ? (
          <ConflictNotice
            onReload={() => void conflict.reloadRecord()}
            reloading={conflict.reloading}
          />
        ) : null}
        <p className="text-sm font-medium [overflow-wrap:anywhere]">
          {lessonSummary(lesson, lookups)}
        </p>
        <FormField
          id="yedek-ogretmen"
          label="Yedek öğretmen"
          error={errors.teacherId}
          description={
            candidates.length
              ? 'Dersin kampüsündeki, aynı branştaki etkin öğretmenler.'
              : 'Uygun yedek yok. Önce Eğitim Kadrosu ekranından aynı branş ve kampüste öğretmen ekleyin.'
          }
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('teacherId')}
              disabled={busy}
              className="w-full"
            >
              <NativeSelectOption value="">Öğretmen seçin</NativeSelectOption>
              {candidates.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="yedek-gerekce"
          label="Görevlendirme gerekçesi"
          error={errors.reason}
          description={`Denetim kaydına yazılır. En çok ${REASON_MAX_LENGTH} karakter.`}
        >
          {(control) => (
            <Textarea
              {...control}
              {...form.register('reason')}
              rows={4}
              maxLength={REASON_MAX_LENGTH}
              disabled={busy}
            />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <FormActions
          busy={busy}
          disabled={conflict.conflicted}
          onCancel={onClose}
          submitLabel="Yedeği ata"
        />
      </form>
    </FormDialog>
  )
}

export function CancelDialog({ lessonId, lookups, onClose }: ReasonDialogProps) {
  return (
    <WithLesson lessonId={lessonId} title="Dersi iptal et" onClose={onClose}>
      {(lesson, reload) => (
        <CancelForm lesson={lesson} reload={reload} lookups={lookups} onClose={onClose} />
      )}
    </WithLesson>
  )
}

function CancelForm({
  lesson,
  reload,
  lookups,
  onClose,
}: {
  lesson: Lesson
  reload: () => Promise<Lesson | null>
  lookups: AcademicLookups
  onClose: () => void
}) {
  const cancel = useCancelLesson()
  const form = useForm<CancelFormValues>({
    resolver: zodResolver(cancelFormSchema),
    defaultValues: { reason: '' },
  })
  const conflict = useEditConflict<null>({
    initialVersion: lesson.version,
    reload: async () => {
      const fresh = await reload()
      return fresh ? { version: fresh.version, values: null } : null
    },
    apply: () => undefined,
  })
  const guard = useDiscardGuard(form.formState.isDirty)
  const busy = cancel.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { lessonId: lesson.id, version: conflict.version, body: values },
      { setError: form.setError, ...lessonErrorRoutes('cancel') },
    )
    if (outcome.status === 'success') {
      notify.success('Ders iptal edildi.')
      guard.leave()
      onClose()
    } else if (outcome.status === 'failed' && isVersionConflict(outcome.error)) {
      conflict.markConflict()
    }
  })

  return (
    <FormDialog
      title="Dersi iptal et"
      description="Ders günlük programlardan kalkar; iptal kaydı ve gerekçe yönetim ekranında korunur. Gerekçe yalnız yöneticilere görünür."
      onClose={onClose}
      guard={guard.dialog}
      busy={busy}
    >
      <form
        noValidate
        aria-label="Dersi iptal et"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-5"
      >
        {conflict.conflicted ? (
          <ConflictNotice
            onReload={() => void conflict.reloadRecord()}
            reloading={conflict.reloading}
          />
        ) : null}
        <p className="text-sm font-medium [overflow-wrap:anywhere]">
          {lessonSummary(lesson, lookups)}
        </p>
        <FormField
          id="iptal-gerekce"
          label="İptal gerekçesi"
          error={errors.reason}
          description={`Denetim kaydına yazılır. En çok ${REASON_MAX_LENGTH} karakter.`}
        >
          {(control) => (
            <Textarea
              {...control}
              {...form.register('reason')}
              rows={4}
              maxLength={REASON_MAX_LENGTH}
              disabled={busy}
            />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <FormActions
          busy={busy}
          disabled={conflict.conflicted}
          onCancel={onClose}
          submitLabel="Dersi iptal et"
        />
      </form>
    </FormDialog>
  )
}
