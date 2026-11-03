import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { attemptClock } from '@kampus/react-shared/attempt-model.ts'
import type { TaskAssignmentLearner } from '@kampus/react-shared/use-task-assignments.ts'
import { useAttemptAnswers } from '@kampus/react-shared/use-attempt-answers.ts'
import {
  useSubmitTaskAttempt,
  type TaskAttemptDetail,
} from '@kampus/react-shared/use-task-attempts.ts'
import { Button, T, useColors } from '../../ui/components.tsx'
import { Notice } from '../../ui/SchoolLayout.tsx'
import { useNow } from '../../ui/use-now.ts'
import {
  clockSpokenLabel,
  EXPIRED_REFRESH_MS,
  INITIAL_SOLVE,
  LEAVE_TEXTS,
  SUBMITTED_TEXT,
  confirmSubmitText,
  deadlineAt,
  isSolveLocked,
  isTimeOver,
  needsLeaveConfirm,
  questionNavLabel,
  remainingFrom,
  resultAction,
  shouldRefreshExpired,
  solveProgress,
  solveReducer,
  submitAttempt,
  submitButtonText,
} from '../student-quiz-task.ts'
import { useNotify } from '../toast.tsx'
import type { FooterSlot } from './footer-slot.tsx'
import { TaskQuestionInput } from './task-question-input.tsx'

type Props = {
  assignment: Pick<TaskAssignmentLearner, 'timeLimitMinutes' | 'deadline'>
  attempt: TaskAttemptDetail
  /** Ayrıntının okunduğu an (`dataUpdatedAt`); kalan süre bu ana göre sunucudan gelir. */
  fetchedAt: number
  /** Pencerenin sabit alt bilgisi ve kapatma isteği bu yuvalara yazılır (tek `Sheet`). */
  slot: FooterSlot
  closeRef: MutableRefObject<(() => void) | null>
  /** Süre doldu ya da deneme sunucuda bitti: deneme ve atama yeniden okunur. */
  onRefresh: () => void
  onLeave: () => void
}

/**
 * Quiz görevi çözme (DOM-BEC-042, 043; IST-051). Deneme sunucuda başlamıştır, süre sunucu saatiyle
 * işler (`remainingMs`), cevaplar bellekte tutulup sunucuya kaydedilir (cihaza yazılmaz). Teslim
 * onaylıdır; çift dokunma tek istek atar. Süre dolunca kayıtlı cevaplar kendiliğinden gönderilir;
 * ağ hatasında cevaplar kalır ve "Yeniden gönder" açılır. Hata pencerenin içindedir (toast yok).
 * Karar mantığı `student-quiz-task.ts`'tedir; bileşen `key={attempt.id}` ile kurulur.
 */
export function TaskAttemptSolve({
  assignment,
  attempt,
  fetchedAt,
  slot,
  closeRef,
  onRefresh,
  onLeave,
}: Props) {
  const c = useColors()
  const notify = useNotify()
  const answers = useAttemptAnswers(attempt)
  const submit = useSubmitTaskAttempt()
  const [state, dispatch] = useReducer(solveReducer, INITIAL_SOLVE)
  const [index, setIndex] = useState(0)

  const questions = attempt.questions
  const { total, done } = solveProgress(questions, answers.answers)
  const deadline = deadlineAt(fetchedAt, attempt.remainingMs)
  const timed = assignment.timeLimitMinutes !== null
  const now = useNow(timed ? 1000 : 15_000).getTime()
  const remaining = remainingFrom(deadline, now)
  const timeOver = isTimeOver(remaining)
  const clock = attemptClock({
    timeLimitMinutes: assignment.timeLimitMinutes,
    dueAt: assignment.deadline.dueAt,
    remainingMs: remaining,
  })

  const latest = useRef({ deadline, refresh: onRefresh })
  useLayoutEffect(() => {
    latest.current = { deadline, refresh: onRefresh }
  })

  // Süre dolunca cevaplar bir kez kendiliğinden gönderilir (sunucu kayıtlı cevaplarla teslim eder).
  useEffect(() => {
    if (timeOver) dispatch({ type: 'timeout' })
  }, [timeOver])

  // `sending`e geçişte tek istek: önce bekleyen cevaplar kaydedilir, sonra teslim gider.
  const phase = state.phase
  useEffect(() => {
    if (phase !== 'sending') return
    void (async () => {
      const over = isTimeOver(remainingFrom(latest.current.deadline, Date.now()))
      const result = await submitAttempt({
        timeOver: over,
        flush: answers.flush,
        send: () =>
          submit.submit(
            { attemptId: attempt.id, version: answers.currentVersion() },
            // Hata pencerenin içinde gösterilir; toast aynı hatayı ikinci kez söylemesin.
            { silent: () => true },
          ),
      })
      const action = resultAction(result)
      if (!action) return
      if (action.type === 'sent') notify(SUBMITTED_TEXT)
      dispatch(action)
    })()
    // Yalnız `sending`e geçişte çalışır; cevaplar o anda kilitlidir.
  }, [phase])

  // Teslim sonrası ve süre dolduktan sonra sonuç sunucudan yenilenir; teslim edilince pencere
  // kendiliğinden sonuç görünümüne geçer.
  const refreshing =
    state.phase === 'submitted' || state.phase === 'ended' || shouldRefreshExpired(state, timeOver)
  useEffect(() => {
    if (!refreshing) return
    latest.current.refresh()
    const timer = setInterval(() => latest.current.refresh(), EXPIRED_REFRESH_MS)
    return () => clearInterval(timer)
  }, [refreshing])

  const locked = isSolveLocked(state)
  const busy = state.phase === 'sending'
  const question = questions[Math.min(index, Math.max(0, total - 1))]

  function leave() {
    // Bekleyen cevaplar en iyi gayretle kaydedilir; süre sunucuda işlemeye devam eder.
    void answers.flush()
    onLeave()
  }

  function requestClose() {
    if (busy) return
    if (state.phase === 'leaving' || state.phase === 'confirming')
      return dispatch({ type: 'cancel' })
    if (needsLeaveConfirm(state, done)) return dispatch({ type: 'leave' })
    leave()
  }
  useEffect(() => {
    closeRef.current = requestClose
  })
  useEffect(
    () => () => {
      closeRef.current = null
    },
    [closeRef],
  )

  const footer =
    state.phase === 'confirming' ? (
      <View style={{ gap: 10 }}>
        <Button accent icon="Send" onPress={() => dispatch({ type: 'confirm' })}>
          Gönder
        </Button>
        <Button onPress={() => dispatch({ type: 'cancel' })}>{LEAVE_TEXTS.cancel}</Button>
      </View>
    ) : state.phase === 'leaving' ? (
      <View style={{ gap: 10 }}>
        <Button onPress={() => dispatch({ type: 'cancel' })}>{LEAVE_TEXTS.cancel}</Button>
        <Button danger onPress={leave}>
          {LEAVE_TEXTS.confirm}
        </Button>
      </View>
    ) : state.phase === 'ended' || state.phase === 'submitted' ? (
      <Button disabled>Sonuç yenileniyor…</Button>
    ) : (
      <Button
        accent
        icon="Send"
        disabled={busy}
        label={submitButtonText(state, timeOver)}
        onPress={() => dispatch({ type: 'press', timeOver })}
      >
        {submitButtonText(state, timeOver)}
      </Button>
    )
  useEffect(() => {
    slot.set(footer)
  })
  useEffect(() => () => slot.set(null), [slot])

  const urgent = clock?.tone === 'red'
  const change = (response: Parameters<typeof answers.setAnswer>[1]) => {
    if (!question) return
    dispatch({ type: 'edit' })
    answers.setAnswer(question.questionVersionId, response)
  }

  return (
    <View style={{ gap: 16 }}>
      {state.phase === 'confirming' && (
        <Notice title="Deneme teslim edilsin mi?" text={confirmSubmitText(total, done)} />
      )}
      {state.phase === 'leaving' && (
        <Notice title={LEAVE_TEXTS.title} text={LEAVE_TEXTS.description} tone="amber" />
      )}
      {clock && (
        <View
          accessible
          accessibilityRole="timer"
          accessibilityLabel={timed ? clockSpokenLabel(remaining, clock.text) : clock.text}
          style={{
            alignSelf: 'flex-start',
            minHeight: 36,
            justifyContent: 'center',
            paddingHorizontal: 12,
            borderRadius: 8,
            backgroundColor: urgent ? c.redSoft : c.soft,
          }}
        >
          <T bold size={15} style={{ color: urgent ? c.red : c.text }}>
            {clock.text}
          </T>
        </View>
      )}
      <T
        muted
        size={13}
        accessibilityRole="progressbar"
        accessibilityLabel={`${total} sorudan ${done} tanesi cevaplandı`}
      >
        {done} / {total} soru cevaplandı. Süre sunucu saatiyle işler; uygulamayı kapatsan da durmaz.
      </T>
      {!!state.error && (
        <Notice
          tone={state.phase === 'ended' ? 'amber' : 'red'}
          title={state.phase === 'ended' ? 'Deneme bitti' : 'Cevaplar gönderilemedi'}
          text={state.error}
        />
      )}
      {attempt.passage && (
        <View style={{ gap: 8 }}>
          <T bold size={16} accessibilityRole="header">
            {attempt.passage.title}
          </T>
          <T size={15}>{attempt.passage.body}</T>
          {attempt.passage.glossary.map((entry) => (
            <T key={entry.term} muted size={13}>
              {entry.term}: {entry.meaning}
            </T>
          ))}
        </View>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 8 }}
        style={{ flexGrow: 0 }}
        accessibilityLabel="Sorular"
      >
        {questions.map((item, position) => {
          const answered = answers.answers[item.questionVersionId] !== undefined
          const current = position === index
          return (
            <Pressable
              key={item.questionVersionId}
              accessibilityRole="button"
              accessibilityLabel={questionNavLabel(position, answered)}
              accessibilityState={{ selected: current }}
              disabled={state.phase !== 'answering'}
              onPress={() => setIndex(position)}
              style={{
                minWidth: 48,
                minHeight: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                borderWidth: current ? 2 : 1,
                borderColor: current ? c.primary : c.border,
                backgroundColor: answered ? c.primarySoft : c.surface,
              }}
            >
              <T bold size={15} style={{ color: current ? c.primary : c.text }}>
                {position + 1}
              </T>
            </Pressable>
          )
        })}
      </ScrollView>
      {question && (
        <View style={{ gap: 12 }}>
          <TaskQuestionInput
            key={question.questionVersionId}
            question={question}
            response={answers.answers[question.questionVersionId]}
            onChange={change}
            disabled={locked || state.phase !== 'answering'}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              icon="ChevronLeft"
              style={{ flex: 1 }}
              disabled={index === 0 || state.phase !== 'answering'}
              onPress={() => setIndex(index - 1)}
            >
              Önceki
            </Button>
            <Button
              icon="ChevronRight"
              style={{ flex: 1 }}
              disabled={index >= total - 1 || state.phase !== 'answering'}
              onPress={() => setIndex(index + 1)}
            >
              Sonraki
            </Button>
          </View>
        </View>
      )}
    </View>
  )
}
