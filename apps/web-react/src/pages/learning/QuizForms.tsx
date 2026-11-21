// Quiz formları (öğretmen ve yönetici; IST-095, DOM-AKD-075, 076): soru bankasından quiz hazırla,
// düzenle ve arşivle. Formlar sağ panelin içindedir; kirli form kapatılırken ya da sayfadan
// ayrılırken onay ister (`useRouteDiscardGuard`). `If-Match` sürümü gönderim anında kaydın yeniden
// okunan hâlindendir; yalnız değişen alanlar gider, sürüm çakışmasında girdi korunur ve form
// içinde uyarı görünür. Çözülmeye başlanmış quizin soru alanı ve arşivi gerekçesiyle kapalıdır.
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch, type Control } from 'react-hook-form'
import type { QuizStaffDetail } from '@kampus/react-shared/quizzes.ts'
import { isStaffQuizDetail } from '@kampus/react-shared/quizzes.ts'
import {
  useArchiveQuiz,
  useCreateQuiz,
  useQuiz,
  useUpdateQuiz,
} from '@kampus/react-shared/use-quizzes.ts'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { useRouteDiscardGuard } from '@/hooks/use-route-discard-guard.tsx'
import { notify } from '@/lib/notify.ts'
import { RECORD_UNAVAILABLE_MESSAGE, submitWithFreshRecord } from '../language/fresh-submit.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { homeworkClassOptions, homeworkSubjectOptions, pickSubject } from './homework-forms.ts'
import { NoPermission } from './HomeworkForms.tsx'
import {
  changedQuizFields,
  createQuizBody,
  eligibleQuestions,
  keepEligible,
  planQuizUpdate,
  QUIZ_DURATION_MAX,
  QUIZ_DURATION_MIN,
  QUIZ_LOCKED_REASON,
  QUIZ_QUESTION_LIMIT,
  QUIZ_TITLE_MAX_LENGTH,
  quizActions,
  quizErrorRoutes,
  quizFormDefaults,
  quizFormSchema,
  quizLocked,
  questionTopics,
  toggleQuestion,
  type QuizActor,
  type QuizFormOutput,
  type QuizFormValues,
  type QuizOverlap,
} from './quiz-forms.ts'

/** `?quiz-form=` değeri: yeni quiz. */
export const NEW_QUIZ = 'yeni'

const NONE: readonly never[] = []

type Stale =
  | { kind: 'changed' }
  /** `version`: çakışmanın gösterildiği kayıt sürümü; aynı sürümde yeniden kaydetmek onaydır. */
  | { kind: 'overlap'; overlaps: readonly QuizOverlap[]; version: number }

function StaleNotice({ stale }: { stale: Stale | null }) {
  if (!stale) return null
  if (stale.kind === 'changed')
    return (
      <div role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
        Quiz bu arada başka biri tarafından değişti. Güncel hâli yüklendi; girdiniz korundu. Kontrol
        edip yeniden kaydedin.
      </div>
    )
  return (
    <div role="alert" className="grid gap-2 rounded-card border bg-warning-soft p-4 text-sm">
      <p className="font-medium">
        Quiz bu arada değişti ve değiştirdiğiniz alanlardan biri başkası tarafından da değiştirildi.
        Yeniden kaydederseniz sizin değeriniz yazılır.
      </p>
      <ul className="grid gap-1">
        {stale.overlaps.map((item) => (
          <li key={item.field}>
            <strong className="font-semibold">{item.label}:</strong> kayıtlı değer {item.theirs},
            sizin girdiğiniz {item.mine}.
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Gönderim anında quizi yeniden okur (`If-Match` sürümü buradan); okunamazsa `undefined`. */
function useFreshQuiz(quizId: string) {
  const item = useQuiz(quizId)
  async function fetchFresh(): Promise<QuizStaffDetail | undefined> {
    const result = await item.refetch()
    const data = result.error ? undefined : result.data?.data
    return data && isStaffQuizDetail(data) ? data : undefined
  }
  return { item, fetchFresh }
}

// --- Quiz hazırla / düzenle ---------------------------------------------------

type FormTargetProps = {
  /** `yeni` ya da düzenlenen quizin kimliği. */
  target: string
  actor: QuizActor
  onClose: () => void
}

/** Sağ panel içeriği: yeni quiz formu ya da quizi okuyup düzenleme formu. */
export function QuizFormContent({ target, actor, onClose }: FormTargetProps) {
  if (target === NEW_QUIZ)
    return quizActions(actor).create ? (
      <QuizForm actor={actor} onClose={onClose} />
    ) : (
      <NoPermission />
    )
  return <QuizEdit quizId={target} actor={actor} onClose={onClose} />
}

function QuizEdit({
  quizId,
  actor,
  onClose,
}: {
  quizId: string
  actor: QuizActor
  onClose: () => void
}) {
  const { item, fetchFresh } = useFreshQuiz(quizId)
  // Formun açıldığı andaki kayıt: sonradan gelen tazeleme girdiyi silmesin.
  const [opened, setOpened] = useState<QuizStaffDetail | null>(null)
  const live = item.data?.data
  if (!opened && live && isStaffQuizDetail(live)) setOpened(live)
  if (item.error && !opened)
    return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (live && !isStaffQuizDetail(live)) return <NoPermission />
  if (!opened) return <SummaryLoading />
  // Adresten gelinen form de yetkiye bağlıdır: quizin öğretmeni ya da yönetici (DOM-AKD-076).
  if (!quizActions(actor, opened).manage) return <NoPermission />
  return <QuizForm quiz={opened} fetchFresh={fetchFresh} actor={actor} onClose={onClose} />
}

function QuizForm({
  quiz,
  fetchFresh,
  actor,
  onClose,
}: {
  quiz?: QuizStaffDetail
  fetchFresh?: () => Promise<QuizStaffDetail | undefined>
  actor: QuizActor
  onClose: () => void
}) {
  const create = useCreateQuiz()
  const update = useUpdateQuiz()
  const classes = useCoreAll('classes')
  const subjects = useCoreAll('subjects')
  const assignments = useCoreAll('assignments')
  const form = useForm<QuizFormValues, unknown, QuizFormOutput>({
    resolver: zodResolver(quizFormSchema),
    defaultValues: quizFormDefaults(quiz),
  })
  const [stale, setStale] = useState<Stale | null>(null)
  // Açılışta ya da gönderimde çözülmeye başlandığı görülen quizin soruları kilitlenir.
  const [locked, setLocked] = useState(() => (quiz ? quizLocked(quiz) : false))
  const guard = useRouteDiscardGuard(form.formState.isDirty)
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const classId = useWatch({ control: form.control, name: 'classId' })
  const subjectId = useWatch({ control: form.control, name: 'subjectId' })
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
  const editing = quiz !== undefined
  const grade = gradeOf(records.classes, classId)
  const bank = useCoreAll('bank', { filters: { subjectId } }, { enabled: subjectId !== '' })
  const eligible = useMemo(
    () => eligibleQuestions(bank.data?.map((row) => row.record) ?? NONE, subjectId, grade),
    [bank.data, subjectId, grade],
  )
  const lookupError = classes.error ?? subjects.error ?? assignments.error
  const lookupsPending =
    !editing && (classes.isPending || subjects.isPending || assignments.isPending)

  // Sınıf ya da ders değişince yeni derse/düzeye uymayan seçili sorular çıkar.
  function syncQuestions(nextClassId: string, nextSubjectId: string) {
    const nextBank =
      nextSubjectId === subjectId ? (bank.data?.map((row) => row.record) ?? NONE) : NONE
    const nextEligible = eligibleQuestions(
      nextBank,
      nextSubjectId,
      gradeOf(records.classes, nextClassId),
    )
    form.setValue('questionIds', keepEligible(form.getValues('questionIds'), nextEligible), {
      shouldDirty: true,
    })
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const routes = { setError: form.setError, ...quizErrorRoutes('quiz') }
    const shown = stale
    setStale(null)
    if (!quiz || !fetchFresh) {
      const outcome = await create.submit(createQuizBody(values), routes)
      if (outcome.status === 'success') {
        notify.success('Quiz hazırlandı.')
        guard.leave()
        onClose()
      }
      return
    }
    const result = await submitWithFreshRecord(fetchFresh, async (fresh) => {
      const freshLocked = quizLocked(fresh)
      if (freshLocked) setLocked(true)
      const plan = planQuizUpdate(quiz, fresh, values, freshLocked)
      if (plan.questionsBlocked) {
        form.setError('questionIds', { type: 'manual', message: QUIZ_LOCKED_REASON })
        return { status: 'busy' as const }
      }
      if (Object.keys(plan.body).length === 0) {
        const touched = Object.keys(changedQuizFields(quiz, values)).length > 0
        form.setError('root.server', {
          type: 'manual',
          message: touched ? 'Quiz zaten bu değerlerde kayıtlı.' : 'Değişiklik yapmadınız.',
        })
        return { status: 'busy' as const }
      }
      const confirmed = shown?.kind === 'overlap' && shown.version === fresh.version
      if (plan.overlaps.length > 0 && !confirmed) {
        setStale({ kind: 'overlap', overlaps: plan.overlaps, version: fresh.version })
        return { status: 'busy' as const }
      }
      return update.submit({ quizId: fresh.id, version: fresh.version, body: plan.body }, routes)
    })
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.conflicted) {
      setStale({ kind: 'changed' })
      return
    }
    if (result.outcome.status === 'failed' && 'error' in result.outcome) {
      const code = result.outcome.error.code
      if (code === 'quiz_has_attempts') setLocked(true)
    }
    if (result.outcome.status === 'success') {
      notify.success('Quiz güncellendi.')
      guard.leave()
      onClose()
    }
  })

  const title = editing ? 'Quizi düzenle' : 'Quiz hazırla'
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
        Quiz hazırlayabileceğiniz sınıf yok. Quiz, sınıfın dersine atanmış öğretmen üzerinden
        hazırlanır.
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
        <StaleNotice stale={stale} />
        <p className="text-sm text-muted-foreground">
          {editing
            ? 'Sınıf ve ders değişmez. Süre ve son tarih değişikliği yalnız bundan sonra başlayan denemeleri etkiler.'
            : 'Sorular soru bankasından, quizin dersine ve sınıfın düzeyine göre seçilir.'}
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="quiz-sinif" label="Sınıf" error={errors.classId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('classId', {
                  onChange: (event: { target: { value: string } }) => {
                    const next = pickSubject(
                      form.getValues('subjectId'),
                      homeworkSubjectOptions(
                        event.target.value,
                        records.assignments,
                        records.subjects,
                        actor,
                      ),
                    )
                    form.setValue('subjectId', next, { shouldDirty: true })
                    syncQuestions(event.target.value, next)
                  },
                })}
                disabled={busy || editing}
                className="w-full"
              >
                <NativeSelectOption value="">Sınıf seçin</NativeSelectOption>
                {(editing
                  ? [{ value: quiz.classId, label: classNameOf(quiz.classId, records.classes) }]
                  : classOptions
                ).map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="quiz-ders" label="Ders" error={errors.subjectId}>
            {(control) => (
              // Denetimli seçim: sınıf değişince ders seçenekleri bir sonraki çizimde gelir.
              <Controller
                control={form.control}
                name="subjectId"
                render={({ field }) => (
                  <NativeSelect
                    {...control}
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={(event) => {
                      field.onChange(event)
                      syncQuestions(form.getValues('classId'), event.target.value)
                    }}
                    onBlur={field.onBlur}
                    disabled={busy || editing || !classId}
                    className="w-full"
                  >
                    <NativeSelectOption value="">
                      {classId ? 'Ders seçin' : 'Önce sınıf seçin'}
                    </NativeSelectOption>
                    {(editing
                      ? [{ value: quiz.subjectId, label: quiz.subject }]
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
        <FormField id="quiz-baslik" label="Başlık" error={errors.title}>
          {(control) => (
            <Input
              {...control}
              {...form.register('title')}
              maxLength={QUIZ_TITLE_MAX_LENGTH}
              disabled={busy}
            />
          )}
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="quiz-sure"
            label="Süre (dakika)"
            error={errors.duration}
            description={`${QUIZ_DURATION_MIN}–${QUIZ_DURATION_MAX} dakika; öğrenci başlatınca işler.`}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('duration', { valueAsNumber: true })}
                type="number"
                inputMode="numeric"
                min={QUIZ_DURATION_MIN}
                max={QUIZ_DURATION_MAX}
                step={1}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField
            id="quiz-son-tarih"
            label="Son tarih"
            error={errors.dueDate}
            description="İsteğe bağlı, Türkiye saatiyle. Boş bırakılırsa quiz süresiz açık kalır."
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
        </div>
        <QuestionPicker
          control={form.control}
          error={errors.questionIds?.message ?? errors.questionIds?.root?.message}
          eligible={eligible}
          subjectChosen={subjectId !== ''}
          loading={subjectId !== '' && bank.isPending}
          loadError={bank.error}
          onRetry={() => void bank.refetch()}
          locked={locked}
          disabled={busy}
        />
        <RootError message={errors.root?.server?.message} />
        <FormActions
          busy={busy}
          onCancel={onClose}
          submitLabel={editing ? 'Kaydet' : 'Quizi hazırla'}
        />
      </form>
      {guard.dialog}
    </>
  )
}

type ClassRecord = CoreRecord<'classes'>

function gradeOf(classes: readonly ClassRecord[], classId: string): number | undefined {
  const grade: unknown = classes.find((item) => item.id === classId)?.grade
  return typeof grade === 'number' ? grade : undefined
}

function classNameOf(classId: string, classes: readonly ClassRecord[]) {
  return classes.find((item) => item.id === classId)?.name ?? classId
}

// --- Soru seçici ---------------------------------------------------------------

type BankQuestion = CoreRecord<'bank'>

/**
 * Soru bankasından seçim (DOM-AKD-075): quizin dersindeki ve sınıfın düzeyindeki sorular, konu
 * süzgeciyle. Seçim sırası quizdeki soru sırasıdır; en çok 50 soru. Çözülmeye başlanmış quizde
 * seçim kapalıdır ve gerekçesi görünür (DOM-AKD-076).
 */
function QuestionPicker({
  control,
  error,
  eligible,
  subjectChosen,
  loading,
  loadError,
  onRetry,
  locked,
  disabled,
}: {
  control: Control<QuizFormValues, unknown, QuizFormOutput>
  error: string | undefined
  eligible: readonly BankQuestion[]
  subjectChosen: boolean
  loading: boolean
  loadError: unknown
  onRetry: () => void
  locked: boolean
  disabled: boolean
}) {
  const [topic, setTopic] = useState('')
  const topics = questionTopics(eligible)
  const shown = topic ? eligible.filter((question) => question.topic === topic) : eligible
  return (
    <Controller
      control={control}
      name="questionIds"
      render={({ field }) => {
        const selected = field.value
        const known = new Set(eligible.map((question) => question.id))
        const missing = selected.filter((id) => !known.has(id)).length
        return (
          <fieldset
            className="grid gap-3"
            aria-describedby={error ? 'quiz-sorular-hata' : 'quiz-sorular-bilgi'}
          >
            <legend className="mb-1 text-sm font-medium">Sorular</legend>
            <p id="quiz-sorular-bilgi" className="text-sm text-muted-foreground" aria-live="polite">
              {selected.length} / {QUIZ_QUESTION_LIMIT} soru seçili
              {missing > 0 ? ` · ${missing} soru bu listede görünmüyor` : ''}
            </p>
            {locked ? (
              <p role="status" className="rounded-card border bg-muted p-3 text-sm">
                {QUIZ_LOCKED_REASON}
              </p>
            ) : null}
            {error ? (
              <p
                id="quiz-sorular-hata"
                role="alert"
                className="text-sm font-medium text-destructive"
              >
                {error}
              </p>
            ) : null}
            {!subjectChosen ? (
              <p className="text-sm text-muted-foreground">
                Soruları görmek için sınıf ve ders seçin.
              </p>
            ) : loadError ? (
              <QueryError error={loadError} onRetry={onRetry} />
            ) : loading ? (
              <SummaryLoading />
            ) : eligible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Soru bankasında bu derse ve sınıf düzeyine uygun soru yok.
              </p>
            ) : (
              <>
                <NativeSelect
                  aria-label="Konu"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  className="min-h-9 text-sm"
                >
                  <NativeSelectOption value="">Tüm konular</NativeSelectOption>
                  {topics.map((item) => (
                    <NativeSelectOption key={item} value={item}>
                      {item}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <ul
                  aria-label="Soru bankası"
                  className="grid max-h-[420px] gap-2 overflow-y-auto pr-1"
                >
                  {shown.map((question) => {
                    const checked = selected.includes(question.id)
                    const order = selected.indexOf(question.id) + 1
                    const id = `quiz-soru-${question.id}`
                    return (
                      <li
                        key={question.id}
                        className="flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={
                            disabled ||
                            locked ||
                            (!checked && selected.length >= QUIZ_QUESTION_LIMIT)
                          }
                          onCheckedChange={() =>
                            field.onChange(toggleQuestion(selected, question.id))
                          }
                          onBlur={field.onBlur}
                          className="mt-0.5"
                        />
                        <label htmlFor={id} className="grid min-w-0 gap-1 leading-snug">
                          <span className="[overflow-wrap:anywhere]">{question.text}</span>
                          <span className="text-xs text-muted-foreground">
                            {question.topic}
                            {checked ? ` · ${order}. soru` : ''}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </fieldset>
        )
      }}
    />
  )
}

// --- Arşiv ---------------------------------------------------------------------

/**
 * Quizi onayla arşivler (DOM-AKD-076). Çözülmeye başlanmış quiz arşivlenmez; ekran bunu bilmese
 * de (bu arada başlayan deneme) sunucu 409 `quiz_has_attempts` verir ve mesaj toast olur.
 */
export function ArchiveQuizDialog({
  quiz,
  open,
  onOpenChange,
  onArchived,
}: {
  quiz: Pick<QuizStaffDetail, 'id' | 'title'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onArchived: () => void
}) {
  const archive = useArchiveQuiz()
  const { fetchFresh } = useFreshQuiz(quiz.id)
  const busy = archive.isPending

  async function confirm() {
    const result = await submitWithFreshRecord(fetchFresh, (fresh) =>
      archive.submit({ quizId: fresh.id, version: fresh.version }),
    )
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.outcome.status === 'success') {
      notify.success(`${quiz.title} arşivlendi.`)
      onOpenChange(false)
      onArchived()
    } else if (result.outcome.status === 'failed') onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Quizi arşivle</AlertDialogTitle>
          <AlertDialogDescription>
            {quiz.title} quiz listesinden kalkar. Çözülmeye başlanmış quiz arşivlenemez;
            öğrencilerin sonuçları korunur.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Vazgeç</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={(event) => {
              // Pencere sonuç gelene kadar açık kalır.
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
