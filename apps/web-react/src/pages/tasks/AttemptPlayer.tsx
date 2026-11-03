import { useEffect, useState } from 'react'
import { SUBSKILLS } from '@kampus/school-core/content/taxonomy.ts'
import { TASK_CONTENT_UNAVAILABLE_MESSAGE } from '@kampus/react-shared/use-task-assignments.ts'
import {
  useCheckTaskAttemptItem,
  useSubmitTaskAttempt,
  type TaskAttemptDetail,
} from '@kampus/react-shared/use-task-attempts.ts'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now.ts'
import { notify } from '@/lib/notify.ts'
import { ListeningRecording } from './ListeningRecording.tsx'
import {
  checkView,
  feedbackFor,
  shownFeedback,
  type CheckedFeedback,
} from './practice-check-model.ts'
import { QuestionInput } from './QuestionInput.tsx'
import { ReadingPassage } from './ReadingPassage.tsx'
import { answeredCount, attemptClock, describeKey, isAnswered } from './student-task-model.ts'
import { useAttemptAnswers, type SaveState } from './use-attempt-answers.ts'

type Props = {
  title: string
  attempt: TaskAttemptDetail
  /** Atamanın süre sınırı (dk); `null` ise geri sayım yerine son teslim yazılır (DOM-BEC-043). */
  timeLimitMinutes: number | null
  /** Atamanın son teslimi; yoksa `null`. */
  dueAt: string | null
  /** Detayın okunduğu an (ms): `remainingMs` bu ana göredir; istemci saati kayması etkisizdir. */
  fetchedAt: number
  /** Süre dolduysa sunucudan güncel durumu ister (deneme kaydedilmiş cevaplarla teslim sayılır). */
  onExpired: () => void
  onLeave: () => void
}

const SAVE_TEXT: Record<SaveState, string> = {
  saved: 'Cevaplarınız kaydedildi.',
  dirty: 'Kaydedilecek değişiklik var…',
  saving: 'Kaydediliyor…',
  error: 'Kaydedilemedi; değişiklik yapınca veya teslimde yeniden denenir.',
}

/**
 * Deneme çözme ekranı (DOM-BEC-042, 043, 045): sorular tek tek, cevaplar otomatik kaydedilir,
 * süre sunucu saatinden gelir. Çözüm sırasında doğru cevap ya da puan yoktur; teslimden sonra
 * sonuç ekranı sunucunun açtığı kadarını gösterir. Okuma-anlama etkinliğinde (IST-042) metin
 * geniş ekranda soruların solunda kendi içinde kayar, dar ekranda üstte durur; soru başında alt
 * beceri etiketi (DOM-BEC-006) yazılır. Dinleme etkinliğinde (IST-045, DOM-BEC-005) kayıt
 * soruların üstündedir; bağlantı bu denemenin kimliğiyle istenir ve hak burada sayılır.
 * Alıştırmada (`feedback` dizi; OG-085, DOM-BEC-047) her soruda "Kontrol et" vardır: cevap önce
 * kaydedilir, sonuç ve kalan hak `aria-live` bölgesinde okunur; kilitli sorunun girdisi kapanır ve
 * yalnız onun doğru cevabı ile açıklaması görünür.
 */
export function AttemptPlayer({
  title,
  attempt,
  timeLimitMinutes,
  dueAt,
  fetchedAt,
  onExpired,
  onLeave,
}: Props) {
  const answers = useAttemptAnswers(attempt)
  const submit = useSubmitTaskAttempt()
  const check = useCheckTaskAttemptItem()
  const [index, setIndex] = useState(0)
  const [confirming, setConfirming] = useState(false)
  // Son kontrol yanıtı; yalnız tazelenen ayrıntı gelene kadar ekranın doğrusudur (sürüm karşılaştırılır).
  const [checked, setChecked] = useState<CheckedFeedback | null>(null)
  const feedback = shownFeedback(attempt, checked)

  const questions = attempt.questions
  const question = questions[index]
  const total = questions.length
  const done = answeredCount(questions, answers.answers)
  const remainingAt = attempt.remainingMs === null ? null : fetchedAt + attempt.remainingMs
  const timed = timeLimitMinutes !== null
  // Süresiz denemede saat yalnız teslim penceresinin kapanışını yakalar; saniyelik tık gerekmez.
  const now = useNow(remainingAt !== null, timed ? 1000 : 15_000)
  const remaining = remainingAt === null ? null : remainingAt - now
  const timeOver = remaining !== null && remaining <= 0
  const clock = attemptClock({ timeLimitMinutes, dueAt, remainingMs: remaining })

  useEffect(() => {
    if (!timeOver) return
    onExpired()
    const timer = window.setInterval(onExpired, 2000)
    return () => window.clearInterval(timer)
  }, [timeOver, onExpired])

  async function finish() {
    const saved = await answers.flush()
    if (!saved) {
      notify.error('Cevaplarınız kaydedilemedi. Bağlantınızı kontrol edip yeniden deneyin.')
      return
    }
    const outcome = await submit.submit({
      attemptId: attempt.id,
      version: answers.currentVersion(),
    })
    if (outcome.status === 'success') {
      setConfirming(false)
      notify.success('Denemeniz teslim edildi.')
    }
  }

  async function checkItem(questionVersionId: string) {
    const response = answers.answers[questionVersionId]
    if (response === undefined) return
    const saved = await answers.flush()
    if (!saved) {
      notify.error('Cevabınız kaydedilemedi. Bağlantınızı kontrol edip yeniden deneyin.')
      return
    }
    const outcome = await check.submit({
      attemptId: attempt.id,
      version: answers.currentVersion(),
      questionVersionId,
      response,
    })
    if (outcome.status === 'success') {
      answers.adoptVersion(outcome.data.data.rowVersion)
      setChecked({
        rowVersion: outcome.data.data.rowVersion,
        feedback: outcome.data.data.feedback,
      })
    } else setChecked(null)
  }

  async function leave() {
    await answers.flush()
    onLeave()
  }

  // Kapalı içerikte soru gelmez (`contentUnavailable`; DOM-KYN-025, 051): çözme ekranı çizilmez.
  if (!question)
    return attempt.contentUnavailable ? (
      <p role="status" className="text-sm text-muted-foreground">
        {TASK_CONTENT_UNAVAILABLE_MESSAGE}
      </p>
    ) : null
  const entry = feedbackFor(feedback, question.questionVersionId)
  const practice = feedback !== null
  const view = checkView({
    entry,
    answered: isAnswered(question, answers.answers[question.questionVersionId]),
    timeOver,
  })
  const player = (
    <section
      aria-labelledby="deneme-baslik"
      className="panel min-w-0 rounded-card border bg-surface p-6 max-[650px]:p-4"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="deneme-baslik" className="text-lg font-semibold [overflow-wrap:anywhere]">
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge text={`${index + 1} / ${total} soru`} tone="purple" />
          {clock ? <StatusBadge text={clock.text} tone={clock.tone} /> : null}
        </div>
      </header>

      <div
        role="progressbar"
        aria-label="Cevaplanan sorular"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${total} sorudan ${done} tanesi cevaplandı`}
        className="mb-6 h-2 overflow-hidden rounded-full bg-surface-soft"
      >
        <span
          className="block h-full bg-primary"
          style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }}
        />
      </div>

      {question.subskill ? (
        <p className="mb-3">
          <span className="sr-only">Alt beceri: </span>
          <StatusBadge text={SUBSKILLS[question.subskill].label} tone="gray" />
        </p>
      ) : null}
      <QuestionInput
        key={question.questionVersionId}
        question={question}
        response={answers.answers[question.questionVersionId]}
        onChange={(response) => answers.setAnswer(question.questionVersionId, response)}
        disabled={timeOver || submit.isPending || check.isPending || view.locked}
      />

      {practice ? (
        <div className="mt-4 rounded-md border bg-surface-soft p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={!view.canCheck || check.isPending || submit.isPending}
              aria-busy={check.isPending}
              aria-describedby="kontrol-hakki"
              onClick={() => void checkItem(question.questionVersionId)}
            >
              <Icon name="CheckCheck" size={16} aria-hidden="true" />
              Kontrol et
            </Button>
            <span id="kontrol-hakki" className="text-xs text-muted-foreground">
              {view.remainingText}
            </span>
          </div>
          <div
            role="status"
            aria-live="polite"
            aria-label="Kontrol sonucu"
            className="mt-2 text-sm"
          >
            {view.result ? (
              <>
                <p className="flex flex-wrap items-center gap-2">
                  <StatusBadge text={view.result.label} tone={view.result.tone} />
                  <span>{view.result.detail}</span>
                </p>
                {entry?.answerKey ? (
                  <>
                    <p className="mt-2">
                      <span className="text-muted-foreground">Doğru cevap: </span>
                      <span lang="en">{describeKey(question.question, entry.answerKey)}</span>
                    </p>
                    {entry.answerKey.explanation ? (
                      <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {entry.answerKey.explanation}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <p role="status" className="mt-4 text-xs text-muted-foreground">
        {SAVE_TEXT[answers.state]}
      </p>

      <nav
        aria-label="Soru gezintisi"
        className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4"
      >
        <Button
          type="button"
          variant="secondary"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
        >
          <Icon name="ArrowLeft" size={16} aria-hidden="true" />
          Önceki soru
        </Button>
        <ol className="flex min-w-0 flex-1 flex-wrap justify-center gap-1.5">
          {questions.map((item, position) => (
            <li key={item.questionVersionId}>
              <button
                type="button"
                onClick={() => setIndex(position)}
                aria-label={`${position + 1}. soruya git${isAnswered(item, answers.answers[item.questionVersionId]) ? ', cevaplandı' : ''}`}
                aria-current={position === index ? 'step' : undefined}
                className={`grid size-9 place-items-center rounded-md border text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring ${
                  position === index
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isAnswered(item, answers.answers[item.questionVersionId])
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'bg-surface'
                }`}
              >
                {position + 1}
              </button>
            </li>
          ))}
        </ol>
        {index < total - 1 ? (
          <Button type="button" onClick={() => setIndex(index + 1)}>
            Sonraki
            <Icon name="ArrowRight" size={16} aria-hidden="true" />
          </Button>
        ) : (
          <Button type="button" disabled={timeOver} onClick={() => setConfirming(true)}>
            <Icon name="Check" size={16} aria-hidden="true" />
            Denemeyi teslim et
          </Button>
        )}
      </nav>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="link" className="px-0" onClick={() => void leave()}>
          Daha sonra devam et
        </Button>
        {index < total - 1 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={timeOver}
            onClick={() => setConfirming(true)}
          >
            Denemeyi teslim et
          </Button>
        ) : null}
      </div>
      {timed && remaining !== null ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Süre sunucu saatiyle işler; ekranı kapatsanız da durmaz.
        </p>
      ) : null}

      <Modal
        open={confirming}
        onOpenChange={(open) => (submit.isPending ? undefined : setConfirming(open))}
        title="Deneme teslim edilsin mi?"
        description="Teslimden sonra cevaplarınız değiştirilemez."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={submit.isPending}
              onClick={() => setConfirming(false)}
            >
              Vazgeç
            </Button>
            <Button
              type="button"
              disabled={submit.isPending}
              aria-busy={submit.isPending}
              onClick={() => void finish()}
            >
              Teslim et
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {total - done > 0
            ? `${total - done} soru cevapsız; cevapsız sorular yanlış sayılır.`
            : 'Bütün sorular cevaplandı.'}
        </p>
      </Modal>
    </section>
  )
  const body = attempt.passage ? (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <ReadingPassage
        passage={attempt.passage}
        className="min-w-0 lg:sticky lg:top-(--topbar-clearance) lg:max-h-[calc(100dvh-var(--topbar-clearance)-16px)] lg:overflow-y-auto"
      />
      {player}
    </div>
  ) : (
    player
  )
  if (!attempt.listeningRecording) return body
  return (
    <div className="grid gap-5">
      <ListeningRecording
        recording={attempt.listeningRecording}
        listening={attempt.listening}
        mode="attempt"
        attemptId={attempt.id}
      />
      {body}
    </div>
  )
}
