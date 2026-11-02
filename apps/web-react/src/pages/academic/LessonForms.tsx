// Ders programı formları (yönetici; IST-094, DOM-YTK-069): ders planla/düzenle, yedek öğretmen
// ata ve dersi iptal et. Her form kendi penceresindedir; kirli form kapatılırken ya da sayfadan
// ayrılırken onay ister. `If-Match` sürümü gönderim anında dersin yeniden okunan kaydındandır
// (formun açıldığı andaki kopya bayat olabilir); sürüm çakışmasında girdi korunur, başkasının da
// değiştirdiği alanlar kullanıcıya gösterilir. Açık form açıldığı andaki uygunlukla açık kalır
// (ders başlasa ya da iptal edilse de girdi kaybolmaz); sunucu reddederse 422 mesajı formda
// görünür. Ders çakışmasında sunucunun mesajı ilgili alanın altında görünür.
import { zodResolver } from '@hookform/resolvers/zod'
import { useRef, useState, type ReactNode } from 'react'
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
import { RECORD_UNAVAILABLE_MESSAGE, submitWithFreshRecord } from '../language/fresh-submit.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
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
  lessonUnavailableText,
  openedLesson,
  planLessonUpdate,
  REASON_MAX_LENGTH,
  substituteCandidates,
  substituteFormSchema,
  subjectOptions,
  teacherOptions,
  type CancelFormValues,
  type Lesson,
  type LessonFormOutput,
  type LessonFormValues,
  type LessonOverlap,
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

/** Ders artık değiştirilemiyorsa (iptal edildi, başladı) form açılmadan önce açıklama. */
function Unavailable({ lesson, now }: { lesson: Lesson; now: string }) {
  if (lessonActions(lesson, true, now).edit) return null
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {lessonUnavailableText(lesson)}
    </p>
  )
}

/**
 * Formun açıldığı andaki ders: uygunluk yalnız açılışta bakılır. Sonradan ders başlar ya da iptal
 * edilirse (dakikalık saat, yenileme) açık form kapanmaz ve girdi kaybolmaz; `live` güncel kayıttır
 * ve form içinde uyarı göstermek içindir. `fetchFresh` gönderim anında dersi yeniden okur.
 */
function useOpenedLesson(lessonId: string) {
  const item = useLesson(lessonId)
  const now = useMinuteClock()
  const live = item.data?.data
  const [opened, setOpened] = useState<Lesson | null>(null)
  const next = openedLesson(opened, live, now)
  if (next !== opened) setOpened(next)
  async function fetchFresh(): Promise<Lesson | undefined> {
    const result = await item.refetch()
    return result.error ? undefined : result.data?.data
  }
  return { item, now, live, opened, fetchFresh }
}

/** Form açıkken ders değiştirilemez hâle geldiyse uyarı; girdi korunur, karar sunucudadır. */
function LiveNotice({ live, now }: { live: Lesson | undefined; now: string }) {
  if (!live || lessonActions(live, true, now).edit) return null
  return (
    <div role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
      {lessonUnavailableText(live)} Girdiniz korundu; kaydetmeyi denerseniz sunucu işlemi reddeder.
    </div>
  )
}

type Stale =
  | { kind: 'changed' }
  /** `version`: çakışmanın gösterildiği kayıt sürümü; aynı sürümde yeniden kaydetmek onaydır. */
  | { kind: 'overlap'; overlaps: readonly LessonOverlap[]; version: number }

/**
 * Gönderimde ders başkası tarafından değişmiş çıktı: kayıt gönderilmedi (ya da 409 döndü), girdi
 * korunur. Aynı alanı başkası da değiştirdiyse değerler yan yana gösterilir; "Kaydet"e yeniden
 * basmak kullanıcının değerini yazar (sessiz ezme yok).
 */
function StaleNotice({ stale }: { stale: Stale | null }) {
  if (!stale) return null
  return (
    <div role="alert" className="grid gap-2 rounded-card border bg-warning-soft p-4 text-sm">
      {stale.kind === 'changed' ? (
        <p className="font-medium">
          Ders bu arada başka biri tarafından değişti. Girdiniz korundu; güncel kayıtla birleştirmek
          için yeniden kaydedin.
        </p>
      ) : (
        <>
          <p className="font-medium">
            Ders bu arada değişti ve değiştirdiğiniz alanlardan biri başkası tarafından da
            değiştirildi. Yeniden kaydederseniz sizin değeriniz yazılır.
          </p>
          <ul className="grid gap-1">
            {stale.overlaps.map((item) => (
              <li key={item.field}>
                <strong className="font-semibold">{item.label}:</strong> kayıtlı değer {item.theirs}
                , sizin girdiğiniz {item.mine}.
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
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
  return (
    <WithLesson lessonId={lessonId} title="Dersi düzenle" onClose={onClose}>
      {({ lesson, fetchFresh, notice }) => (
        <LessonForm
          lesson={lesson}
          lookups={lookups}
          onClose={onClose}
          fetchFresh={fetchFresh}
          notice={notice}
        />
      )}
    </WithLesson>
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
  fetchFresh,
  notice,
}: {
  /** Düzenlemede formun açıldığı andaki ders; yeni derste yok. */
  lesson?: Lesson
  lookups: AcademicLookups
  onClose: () => void
  fetchFresh?: () => Promise<Lesson | undefined>
  notice?: ReactNode
}) {
  const create = useCreateLesson()
  const update = useUpdateLesson()
  const form = useForm<LessonFormValues, unknown, LessonFormOutput>({
    resolver: zodResolver(lessonFormSchema),
    defaultValues: lessonFormDefaults(lesson),
  })
  const [stale, setStale] = useState<Stale | null>(null)
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
    const shown = stale
    setStale(null)
    if (!lesson || !fetchFresh) {
      const outcome = await create.submit(values, routes)
      if (outcome.status === 'success') {
        notify.success('Ders planlandı.')
        guard.leave()
        onClose()
      }
      return
    }
    const result = await submitWithFreshRecord(fetchFresh, async (fresh) => {
      const plan = planLessonUpdate(lesson, fresh, values, lookups)
      if (Object.keys(plan.body).length === 0) {
        const touched = Object.keys(changedLessonFields(lesson, values)).length > 0
        form.setError('root.server', {
          type: 'manual',
          message: touched ? 'Ders zaten bu değerlerde kayıtlı.' : 'Değişiklik yapmadınız.',
        })
        return { status: 'busy' as const }
      }
      const confirmed = shown?.kind === 'overlap' && shown.version === fresh.version
      if (plan.overlaps.length > 0 && !confirmed) {
        setStale({ kind: 'overlap', overlaps: plan.overlaps, version: fresh.version })
        return { status: 'busy' as const }
      }
      return update.submit({ lessonId: fresh.id, version: fresh.version, body: plan.body }, routes)
    })
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.conflicted) {
      setStale({ kind: 'changed' })
      return
    }
    if (result.outcome.status === 'success') {
      notify.success('Ders güncellendi.')
      guard.leave()
      onClose()
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
        {notice}
        <StaleNotice stale={stale} />
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

type LessonScope = {
  /** Formun açıldığı andaki ders. */
  lesson: Lesson
  /** Gönderim anında dersi yeniden okur (`If-Match` sürümü buradan); okunamazsa `undefined`. */
  fetchFresh: () => Promise<Lesson | undefined>
  /** Ders açılıştan sonra değiştirilemez hâle geldiyse form içi uyarı. */
  notice: ReactNode
}

/** Ortak çatı: dersi okur; açılışta değiştirilemiyorsa açıklama, değilse formu çizer. */
function WithLesson({
  lessonId,
  title,
  onClose,
  children,
}: {
  lessonId: string
  title: string
  onClose: () => void
  children: (scope: LessonScope) => ReactNode
}) {
  const { item, now, live, opened, fetchFresh } = useOpenedLesson(lessonId)
  if (!opened)
    return (
      <Modal open onOpenChange={(open) => (open ? undefined : onClose())} title={title}>
        {item.error ? (
          <QueryError error={item.error} onRetry={() => void item.refetch()} />
        ) : live ? (
          <Unavailable lesson={live} now={now} />
        ) : (
          <SummaryLoading />
        )}
      </Modal>
    )
  return children({
    lesson: opened,
    fetchFresh,
    notice: <LiveNotice live={live} now={now} />,
  })
}

function lessonSummary(lesson: Lesson, lookups: AcademicLookups) {
  const title = lesson.title ?? lookups.subjects.get(lesson.subjectId)?.name ?? 'Ders'
  const className = lookups.classes.get(lesson.classId)?.name
  return [title, className].filter(Boolean).join(' · ')
}

export function SubstituteDialog({ lessonId, lookups, onClose }: ReasonDialogProps) {
  return (
    <WithLesson lessonId={lessonId} title="Yedek öğretmen ata" onClose={onClose}>
      {(scope) => <SubstituteForm {...scope} lookups={lookups} onClose={onClose} />}
    </WithLesson>
  )
}

function SubstituteForm({
  lesson,
  fetchFresh,
  notice,
  lookups,
  onClose,
}: LessonScope & { lookups: AcademicLookups; onClose: () => void }) {
  const substitute = useSubstituteLesson()
  const form = useForm<SubstituteFormValues>({
    resolver: zodResolver(substituteFormSchema),
    defaultValues: { teacherId: '', reason: '' },
  })
  const [stale, setStale] = useState<Stale | null>(null)
  const guard = useDiscardGuard(form.formState.isDirty)
  const busy = substitute.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const candidates = substituteCandidates(lesson, lookups)

  const onSubmit = form.handleSubmit(async (values) => {
    setStale(null)
    const result = await submitWithFreshRecord(fetchFresh, (fresh) =>
      substitute.submit(
        { lessonId: fresh.id, version: fresh.version, body: values },
        { setError: form.setError, ...lessonErrorRoutes('substitute') },
      ),
    )
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.conflicted) {
      setStale({ kind: 'changed' })
      return
    }
    if (result.outcome.status === 'success') {
      notify.success('Yedek öğretmen atandı.')
      guard.leave()
      onClose()
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
        {notice}
        <StaleNotice stale={stale} />
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
        <FormActions busy={busy} onCancel={onClose} submitLabel="Yedeği ata" />
      </form>
    </FormDialog>
  )
}

export function CancelDialog({ lessonId, lookups, onClose }: ReasonDialogProps) {
  return (
    <WithLesson lessonId={lessonId} title="Dersi iptal et" onClose={onClose}>
      {(scope) => <CancelForm {...scope} lookups={lookups} onClose={onClose} />}
    </WithLesson>
  )
}

function CancelForm({
  lesson,
  fetchFresh,
  notice,
  lookups,
  onClose,
}: LessonScope & { lookups: AcademicLookups; onClose: () => void }) {
  const cancel = useCancelLesson()
  const form = useForm<CancelFormValues>({
    resolver: zodResolver(cancelFormSchema),
    defaultValues: { reason: '' },
  })
  const [stale, setStale] = useState<Stale | null>(null)
  const guard = useDiscardGuard(form.formState.isDirty)
  const busy = cancel.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    setStale(null)
    const result = await submitWithFreshRecord(fetchFresh, (fresh) =>
      cancel.submit(
        { lessonId: fresh.id, version: fresh.version, body: values },
        { setError: form.setError, ...lessonErrorRoutes('cancel') },
      ),
    )
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.conflicted) {
      setStale({ kind: 'changed' })
      return
    }
    if (result.outcome.status === 'success') {
      notify.success('Ders iptal edildi.')
      guard.leave()
      onClose()
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
        {notice}
        <StaleNotice stale={stale} />
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
        <FormActions busy={busy} onCancel={onClose} submitLabel="Dersi iptal et" />
      </form>
    </FormDialog>
  )
}
