import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { View } from 'react-native'
import {
  attemptOf,
  attemptPhase,
  QUIZ_PHASE_TEXT,
  quizClockOffset,
  quizErrorMessage,
  quizReviewRows,
  type QuizAttempt,
  type QuizListItem,
  type QuizQuestion,
  type QuizResult,
  type QuizStart,
  quizItemKey,
} from '@kampus/react-shared/quizzes.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useQuiz, useStartQuiz } from '@kampus/react-shared/use-quizzes.ts'
import { Badge, Button, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, Notice, Section } from '../../ui/SchoolLayout.tsx'
import { dueText } from '../presentation.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import {
  applyQuizStart,
  EXPIRED_ATTEMPT_TEXT,
  isTimeOver,
  OVERDUE_ATTEMPT_TEXT,
  QUIZ_CLOSED_BADGE,
  quizAction,
  quizBadgeTone,
  quizGroup,
  REVIEW_LOCKED_TEXT,
  START_TEXTS,
  solveEntry,
  solveEntryFromStart,
  startDescription,
  type SolveInput,
} from '../student-quiz.ts'
import { useQuizSolve } from './quiz-solve.tsx'

/** Panelin quizden kullandığı alanlar (öğrenci ayrıntısı; cevap anahtarı yoktur). */
type DetailFields = Pick<
  QuizListItem,
  'id' | 'title' | 'subject' | 'duration' | 'questionCount' | 'dueDate' | 'status'
> & { questions: readonly QuizQuestion[] | null }

/**
 * Quiz penceresi: ayrıntı ve sonuç, başlatma ve çözme tek pencerede değişir (iç içe pencere yok).
 * Tek kayıt ucu kapsamı uygular: kapsam dışı quiz 404 döner ve Türkçe hata görünür. Sonuç
 * (puan, doğru sayısı) sunucudan gelir; cevap anahtarı hiç gelmez (DOM-AKD-078).
 */
export function QuizSheet({
  quizId,
  studentId,
  onClose,
}: {
  quizId: string
  studentId: string
  onClose: () => void
}) {
  const item = useQuiz(quizId)
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()
  const [input, setInput] = useState<SolveInput | null>(null)
  // Açılışta süre dolmuş çıktı: çözme açılmaz, sunucu durumu tazelenip gösterilir.
  const [overdue, setOverdue] = useState(false)
  const solve = useQuizSolve({ quizId, input, onClose: () => setInput(null) })
  const quiz = item.data?.data
  const attempt = quiz ? attemptOf(quiz, studentId) : undefined
  const clockOffsetMs = quizClockOffset(
    quiz && 'serverNow' in quiz ? quiz.serverNow : null,
    item.dataUpdatedAt,
  )

  function enter(entry: ReturnType<typeof solveEntry>) {
    if (entry.kind === 'solve') return setInput(entry.input)
    if (entry.kind === 'expired') setOverdue(true)
    void item.refetch()
  }
  function openSolve() {
    enter(solveEntry(attempt, quiz?.questions, Date.now(), clockOffsetMs))
  }
  // Başlatma yanıtı önbelleğe hemen yazılır: ekran tazelemeyi beklemez, tazeleme düşse de
  // "Quizi başlat" yeniden görünmez.
  function started(start: QuizStart) {
    const receivedAt = Date.now()
    queryClient.setQueryData(
      institutionKey(institutionId, ...quizItemKey(quizId)),
      (cached: typeof item.data) => applyQuizStart(cached, start),
    )
    enter(solveEntryFromStart(start, receivedAt))
  }

  return (
    <Sheet
      visible
      title={quiz?.title ?? 'Quiz'}
      onClose={solve ? solve.requestClose : onClose}
      footer={solve?.footer}
      pinFooter={!!solve}
    >
      {solve ? (
        solve.content
      ) : !quiz ? (
        item.error ? (
          <QueryError error={item.error} onRetry={() => void item.refetch()} />
        ) : (
          <ListLoading label="Quiz yükleniyor…" />
        )
      ) : (
        <>
          {item.error && <QueryError error={item.error} onRetry={() => void item.refetch()} />}
          <QuizDetail
            quiz={quiz}
            attempt={attempt}
            overdue={overdue || (!!attempt && isTimeOver(attempt, Date.now(), clockOffsetMs))}
            onSolve={openSolve}
            onStarted={started}
          />
        </>
      )}
    </Sheet>
  )
}

function QuizDetail({
  quiz,
  attempt,
  overdue,
  onSolve,
  onStarted,
}: {
  quiz: DetailFields
  attempt: QuizAttempt | undefined
  overdue: boolean
  onSolve: () => void
  onStarted: (start: QuizStart) => void
}) {
  const phase = attemptPhase(attempt)
  const group = quizGroup(quiz, attempt)
  const badge = phase === 'none' && group === 'expired' ? QUIZ_CLOSED_BADGE : QUIZ_PHASE_TEXT[phase]
  return (
    <>
      <Badge text={badge} tone={quizBadgeTone(badge)} />
      <Section title="Bilgiler" panel>
        <View style={{ gap: 12 }}>
          <DetailPair label="Ders" value={quiz.subject} />
          <DetailPair label="Soru sayısı" value={quiz.questionCount} />
          <DetailPair label="Süre" value={`${quiz.duration} dk`} />
          <DetailPair
            label="Son tarih"
            value={quiz.dueDate ? dueText(quiz.dueDate) : 'Süresiz açık'}
          />
        </View>
      </Section>
      {attempt?.result ? (
        <ResultSection quiz={quiz} attempt={attempt} result={attempt.result} />
      ) : (
        <ActionSection
          quiz={quiz}
          attempt={attempt}
          overdue={overdue}
          onSolve={onSolve}
          onStarted={onStarted}
        />
      )}
    </>
  )
}

/** Sonuçlanmamış deneme: başlat, devam et ya da neden yapılamadığı. */
function ActionSection({
  quiz,
  attempt,
  overdue,
  onSolve,
  onStarted,
}: {
  quiz: DetailFields
  attempt: QuizAttempt | undefined
  overdue: boolean
  onSolve: () => void
  onStarted: (start: QuizStart) => void
}) {
  const action = quizAction(quiz, attempt)
  if (action === 'resume' && overdue)
    return <Notice tone="amber" title="Süre doldu" text={OVERDUE_ATTEMPT_TEXT} />
  if (action === 'resume')
    return (
      <Section title="Quiz sürüyor" panel>
        <T muted size={14}>
          Bu quizi çözmeye başladın; süre sunucu saatiyle işliyor.
        </T>
        <Button accent icon="Play" onPress={onSolve}>
          Quize devam et
        </Button>
      </Section>
    )
  if (action === 'start') return <StartSection quiz={quiz} onStarted={onStarted} />
  if (action === 'closed')
    return (
      <Notice
        tone="amber"
        title="Quiz kapandı"
        text="Bu quizin son tarihi geçti; quiz artık başlatılamaz."
      />
    )
  return <T muted>Sonuç henüz görünmüyor. Birazdan yeniden dene.</T>
}

/**
 * Quizi başlatır: önce onay sorulur (süre başlayınca durmaz). Düğme istek sürerken kilitlidir ve
 * komut kilidi çift dokunmayı tek isteğe indirir (`Idempotency-Key` komutta); hata pencerede,
 * Türkçe gösterilir. Başlatma yanıtı (deneme, sorular, `serverNow`) önbelleğe yazılır ve çözme oradan açılır.
 */
function StartSection({
  quiz,
  onStarted,
}: {
  quiz: DetailFields
  onStarted: (start: QuizStart) => void
}) {
  const start = useStartQuiz()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  async function begin() {
    if (start.isPending) return
    setFailure(null)
    const outcome = await start.submit({ quizId: quiz.id }, { silent: () => true })
    if (outcome.status === 'busy') return
    if (outcome.status === 'failed') {
      setConfirming(false)
      setFailure(quizErrorMessage(outcome.error))
      return
    }
    setConfirming(false)
    onStarted(outcome.data.data)
  }
  return (
    <Section title="Quizi başlat" panel>
      <T muted size={14}>
        Başlattığında {quiz.duration} dakikalık süre işler ve durdurulamaz. Her quiz bir kez
        çözülür.
      </T>
      {!!failure && <Notice tone="red" title="Quiz başlatılamadı" text={failure} />}
      {confirming ? (
        <Notice title={START_TEXTS.title} text={startDescription(quiz)}>
          <Button
            accent
            icon="Play"
            disabled={start.isPending}
            label={start.isPending ? 'Quiz başlatılıyor' : START_TEXTS.confirm}
            onPress={() => void begin()}
          >
            {start.isPending ? 'Başlatılıyor…' : START_TEXTS.confirm}
          </Button>
          <Button disabled={start.isPending} onPress={() => setConfirming(false)}>
            {START_TEXTS.cancel}
          </Button>
        </Notice>
      ) : (
        <Button accent icon="Play" onPress={() => setConfirming(true)}>
          Quizi başlat
        </Button>
      )}
    </Section>
  )
}

/**
 * Sonuç (DOM-AKD-078): puan ve doğru sayısı her zaman; verilen cevaplar ve konu yüzdeleri yalnız
 * sunucu inceleme açınca (`answers`, `topicScores`). Doğru şık ve soru bazında doğru/yanlış
 * öğrenciye gelmez, burada da üretilmez.
 */
function ResultSection({
  quiz,
  attempt,
  result,
}: {
  quiz: DetailFields
  attempt: QuizAttempt
  result: QuizResult
}) {
  const answers = attempt.answers
  const submittedAt = attempt.submittedAt ?? attempt.expiresAt
  return (
    <>
      <Section title="Sonuç" panel>
        <View style={{ gap: 12 }}>
          <DetailPair label="Puan" value={`%${result.score}`} />
          <DetailPair label="Doğru / soru" value={`${result.correctCount} / ${result.total}`} />
          {!!submittedAt && (
            <DetailPair
              label={attempt.status === 'expired' ? 'Süre bitişi' : 'Gönderilme tarihi'}
              value={dueText(submittedAt)}
            />
          )}
        </View>
        {attempt.status === 'expired' && (
          <T muted size={14}>
            {EXPIRED_ATTEMPT_TEXT}
          </T>
        )}
      </Section>
      {answers === undefined ? (
        <T muted size={14}>
          {REVIEW_LOCKED_TEXT}
        </T>
      ) : (
        <>
          <Section title="Konu bazında başarı" panel>
            {(result.topicScores ?? []).length === 0 ? (
              <T muted size={14}>
                Konu bazında sonuç yok.
              </T>
            ) : (
              <View style={{ gap: 12 }}>
                {(result.topicScores ?? []).map((topic) => (
                  <DetailPair key={topic.topic} label={topic.topic} value={`%${topic.score}`} />
                ))}
              </View>
            )}
          </Section>
          <Section title="Verdiğin cevaplar" panel>
            {quiz.questions ? (
              <View style={{ gap: 12 }} accessibilityRole="list">
                {quizReviewRows(quiz.questions, answers).map((row, index) => (
                  <View
                    key={row.id}
                    accessible
                    accessibilityLabel={`Soru ${index + 1}. ${row.text}. ${row.topic}. Verilen cevap: ${row.chosen ?? 'Boş bırakıldı'}`}
                    style={{ gap: 4 }}
                  >
                    <T bold size={14}>
                      {index + 1}. {row.text}
                    </T>
                    <T muted size={13}>
                      {row.topic} · Verilen cevap: {row.chosen ?? 'Boş bırakıldı'}
                    </T>
                  </View>
                ))}
              </View>
            ) : (
              <T muted size={14}>
                Quizin bazı soruları soru bankasında artık bulunmuyor.
              </T>
            )}
          </Section>
        </>
      )}
    </>
  )
}
