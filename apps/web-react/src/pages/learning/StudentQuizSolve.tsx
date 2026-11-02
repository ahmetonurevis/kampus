// Öğrencinin quiz çözme ekranı (`?quiz-coz=<quiz>`; IST-095, DOM-AKD-077, DOM-AKD-078). Deneme
// sunucuda başlar ve süre sunucuda işler: sayaç `expiresAt`'ten yalnız gösterimdir, karar
// sunucudadır (ağ payı dahil). Sayfa yenilenirse açık deneme `GET /quizzes/:id`'den devam eder
// (sorular deneme başlayınca öğrenciye açılır); yeni deneme başlatılmaz. Cevaplar yalnız bellekte
// tutulur (tarayıcı deposuna yazılmaz); kirli ekrandan çıkarken onay sorulur. Süre dolunca cevaplar
// bir kez kendiliğinden gönderilir. Gövdede puan yoktur; puan sunucuda cevaplardan hesaplanır.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { isApiError } from '@kampus/api-client/errors.ts'
import {
  QUIZ_ALREADY_SUBMITTED_MESSAGE,
  QUIZ_TIME_EXPIRED_MESSAGE,
  quizClockLabel,
  quizErrorField,
  quizSecondsLeft,
  submitQuizBody,
  type QuizAttempt,
  type QuizQuestion,
} from '@kampus/react-shared/quizzes.ts'
import { useQuiz, useSubmitQuiz } from '@kampus/react-shared/use-quizzes.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
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
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useNow } from '@/hooks/use-now.ts'
import { useRouteDiscardGuard } from '@/hooks/use-route-discard-guard.tsx'
import { useStableCallback } from '@/hooks/use-stable-callback.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { answeredCount, OPTION_LETTERS } from './quiz-forms.ts'

/** Çözme ekranının adres parametresi (`?coz=` görev çalışma alanınındır). */
export const QUIZ_SOLVE_PARAM = 'quiz-coz'
/** Öğrenci ve veli quiz sonucu panelinin parametresi. */
export const QUIZ_RESULT_PARAM = 'quiz'

/** Liste, sonuç paneli ve çözme ekranı arasında geçiş; diğer adres parametreleri korunur. */
export function useQuizNavigation() {
  const navigate = useNavigate()
  const go = (set: Record<string, string | null>, replace: boolean) => {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(set))
      if (value === null) next.delete(key)
      else next.set(key, value)
    const search = next.toString()
    void Promise.resolve(
      navigate({ search: search ? `?${search}` : '' }, { replace, preventScrollReset: true }),
    ).catch((error: unknown) => console.error('[quiz] gezinme başarısız', error))
  }
  return {
    solve: (quizId: string) => go({ [QUIZ_RESULT_PARAM]: null, [QUIZ_SOLVE_PARAM]: quizId }, false),
    result: (quizId: string) => go({ [QUIZ_SOLVE_PARAM]: null, [QUIZ_RESULT_PARAM]: quizId }, true),
    list: () => go({ [QUIZ_SOLVE_PARAM]: null, [QUIZ_RESULT_PARAM]: null }, false),
  }
}

export function StudentQuizSolve({ page, quizId }: { page: NavPage; quizId: string }) {
  useDocumentTitle(page.title)
  const nav = useQuizNavigation()
  const item = useQuiz(quizId)
  // Gönderim süre dolduğu için reddedildi: ekran çökmez, açıklama ve sonuca dönüş gösterilir.
  const [expired, setExpired] = useState(false)

  const back = (
    <Button type="button" variant="secondary" onClick={nav.list}>
      <Icon name="ArrowLeft" size={16} aria-hidden="true" />
      Quizlere dön
    </Button>
  )
  const toResult = (
    <Button type="button" onClick={() => nav.result(quizId)}>
      <Icon name="Eye" size={16} aria-hidden="true" />
      Sonucu gör
    </Button>
  )

  if (item.error) {
    // Başka sınıfın ya da olmayan quiz 404: çözme ekranı hiç çizilmez.
    if (isApiError(item.error) && item.error.status === 404)
      return (
        <>
          <PageHeading title={page.title} actions={back} />
          <EmptyState
            title="Quiz bulunamadı."
            description="Bu quiz sınıfına ait değil ya da artık yayında değil."
          />
        </>
      )
    return (
      <>
        <PageHeading title={page.title} actions={back} />
        <QueryError error={item.error} onRetry={() => void item.refetch()} />
      </>
    )
  }
  const quiz = item.data?.data
  if (!quiz)
    return (
      <>
        <PageHeading title={page.title} actions={back} />
        <p role="status" className="text-sm text-muted-foreground">
          Quiz yükleniyor…
        </p>
      </>
    )

  // Öğrenci yanıtı yalnız kendi denemesini taşır.
  const attempt = quiz.attempts[0]
  const heading = (
    <PageHeading
      title={quiz.title}
      description={`${quiz.subject} · ${quiz.questionCount} soru · ${quiz.duration} dk`}
      actions={back}
    />
  )
  const notice = (text: string, action = toResult) => (
    <>
      {heading}
      <section className="panel grid justify-items-start gap-4 rounded-card border bg-surface p-6 max-[650px]:p-4">
        <p role="status" className="text-sm">
          {text}
        </p>
        {action}
      </section>
    </>
  )

  if (expired) return notice(QUIZ_TIME_EXPIRED_MESSAGE)
  if (!attempt)
    return notice(
      'Bu quizi henüz başlatmadın. Quiz bilgilerini görüp oradan başlatabilirsin.',
      <Button type="button" onClick={() => nav.result(quizId)}>
        <Icon name="Play" size={16} aria-hidden="true" />
        Quiz bilgilerine git
      </Button>,
    )
  if (attempt.status === 'completed') return notice('Bu quizi tamamladın; cevapların gönderildi.')
  if (attempt.status === 'expired')
    return notice(
      'Quizin süresi doldu. Süresinde gönderilmeyen deneme boş cevaplı sayılır; sonucun sunucuda bu hâliyle hesaplandı.',
    )
  if (!quiz.questions)
    return notice('Quizin soruları şu an açılamıyor. Öğretmenine haber ver; sonucun korunur.', back)

  return (
    <>
      {heading}
      <QuizSolveForm
        quizId={quiz.id}
        title={quiz.title}
        attempt={attempt}
        questions={quiz.questions}
        onSubmitted={() => nav.result(quizId)}
        onExpired={() => setExpired(true)}
      />
    </>
  )
}

type FormProps = {
  quizId: string
  title: string
  attempt: QuizAttempt
  questions: readonly QuizQuestion[]
  onSubmitted: () => void
  onExpired: () => void
}

function QuizSolveForm({ quizId, title, attempt, questions, onSubmitted, onExpired }: FormProps) {
  // Sorular ilk okumada sabitlenir: arka planda tazelenen sorgu çözme sırasını değiştirmez.
  const [fixed] = useState(() =>
    questions.map((question) => ({
      ...question,
      choices: question.options.map((text, position) => ({
        text,
        position,
        letter: OPTION_LETTERS[position] ?? String(position + 1),
      })),
    })),
  )
  const [answers, setAnswers] = useState<Readonly<Record<string, number>>>({})
  const [confirming, setConfirming] = useState(false)
  const [rootError, setRootError] = useState<string | undefined>()
  const submit = useSubmitQuiz()
  const guard = useRouteDiscardGuard(Object.keys(answers).length > 0)
  const autoSent = useRef(false)

  const ids = fixed.map((question) => question.id)
  const total = fixed.length
  const done = answeredCount(ids, answers)
  const now = useNow(attempt.expiresAt !== null)
  const secondsLeft = quizSecondsLeft(attempt.expiresAt, now)
  const timeOver = secondsLeft === 0
  const busy = submit.isPending

  async function send(automatic: boolean) {
    setRootError(undefined)
    const outcome = await submit.submit(
      { quizId, body: submitQuizBody(ids, answers) },
      {
        // Hata formun içinde görünür (toast yok); süre ve ikinci gönderim aşağıda ayrıca ele alınır.
        fieldFor: (error) => quizErrorField(error, 'solve'),
        setError: (_name, error) => setRootError(error.message),
      },
    )
    if (outcome.status === 'busy') return
    if (outcome.status === 'success') {
      guard.leave()
      setConfirming(false)
      notify.success(automatic ? 'Süre doldu; cevapların gönderildi.' : 'Cevapların gönderildi.')
      onSubmitted()
      return
    }
    const { code } = outcome.error
    if (code === 'quiz_already_submitted') {
      // Cevaplar zaten kayıtlı (ör. başka sekmeden): sonuç görünümüne geçilir.
      guard.leave()
      notify.info(QUIZ_ALREADY_SUBMITTED_MESSAGE)
      onSubmitted()
    } else if (code === 'quiz_time_expired') {
      guard.leave()
      onExpired()
    }
  }

  // Süre dolunca bir kez kendiliğinden gönderilir (sunucu ağ payı içinde kabul eder).
  const sendOnTimeout = useStableCallback(() => {
    if (autoSent.current) return
    autoSent.current = true
    void send(true)
  })
  useEffect(() => {
    if (timeOver) sendOnTimeout()
  }, [timeOver, sendOnTimeout])

  return (
    <section
      aria-labelledby="quiz-coz-baslik"
      className="panel rounded-card border bg-surface p-6 max-[650px]:p-4"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="quiz-coz-baslik" className="text-lg font-semibold [overflow-wrap:anywhere]">
          {title}
        </h2>
        {secondsLeft !== null ? (
          <span role="timer" aria-label="Kalan süre">
            <StatusBadge
              text={timeOver ? 'Süre doldu' : `Kalan süre ${quizClockLabel(secondsLeft)}`}
              tone={timeOver || secondsLeft < 60 ? 'red' : 'gray'}
            />
          </span>
        ) : null}
      </header>

      <div
        role="progressbar"
        aria-label="Cevaplanan sorular"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${total} sorudan ${done} tanesi cevaplandı`}
        className="mb-2 h-2 overflow-hidden rounded-full bg-surface-soft"
      >
        <span
          className="block h-full bg-primary"
          style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }}
        />
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        {done} / {total} soru cevaplandı. Süre sunucu saatiyle işler; ekranı kapatsan da durmaz.
      </p>

      <ol aria-label="Quiz soruları" className="grid gap-6">
        {fixed.map((question, index) => (
          <li key={question.id}>
            <fieldset className="grid gap-2.5" disabled={busy || timeOver}>
              <legend className="mb-1 text-md font-medium [overflow-wrap:anywhere] whitespace-pre-line">
                {index + 1}. {question.text}
              </legend>
              {question.choices.map(({ text, position, letter }) => (
                <label
                  key={letter}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-card border px-4 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    name={`soru-${question.id}`}
                    value={position}
                    checked={answers[question.id] === position}
                    onChange={() =>
                      setAnswers((current) => ({ ...current, [question.id]: position }))
                    }
                    className="size-5 accent-primary"
                  />
                  <span className="text-sm font-semibold text-muted-foreground" aria-hidden="true">
                    {letter})
                  </span>
                  <span className="text-sm [overflow-wrap:anywhere]">{text}</span>
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-3 border-t pt-4">
        <RootError message={rootError} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button
            type="button"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => setConfirming(true)}
          >
            <Icon name="Send" size={16} aria-hidden="true" />
            Cevapları gönder
          </Button>
        </div>
      </div>

      <AlertDialog
        open={confirming && !timeOver}
        onOpenChange={(open) => (busy ? undefined : setConfirming(open))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cevaplar gönderilsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              {total} sorudan {done} tanesini cevapladın.
              {done < total ? ' Boş bıraktığın sorular yanlış sayılır.' : ''} Gönderdikten sonra
              cevaplar değiştirilemez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Çözmeye devam et</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                // Pencere gönderim bitene kadar açık kalır; sonuç gelince kapanır.
                event.preventDefault()
                void send(false)
              }}
            >
              Gönder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {guard.dialog}
    </section>
  )
}
