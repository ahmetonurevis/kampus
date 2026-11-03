import { useEffect, useReducer, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import {
  OPTION_LETTERS,
  QUIZ_ALREADY_SUBMITTED_MESSAGE,
  QUIZ_TIME_EXPIRED_MESSAGE,
  quizClockLabel,
  quizSecondsLeft,
  submitQuizBody,
  type QuizAttempt,
  type QuizQuestion,
} from '@kampus/react-shared/quizzes.ts'
import { useSubmitQuiz } from '@kampus/react-shared/use-quizzes.ts'
import { Button, Sheet, T, useColors } from '../../ui/components.tsx'
import { Notice } from '../../ui/SchoolLayout.tsx'
import {
  confirmSubmitText,
  INITIAL_SOLVE,
  isSolveLocked,
  isTimeOver,
  LEAVE_TEXTS,
  needsLeaveConfirm,
  nextRetryWait,
  questionNavLabel,
  solveEndText,
  solveProgress,
  solveReducer,
  submitButtonText,
} from '../student-quiz.ts'
import { useNotify } from '../toast.tsx'

/** Sayaç saniyede bir yenilenir; süresiz denemede çalışmaz. */
function useClock(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [enabled])
  return now
}

type Props = {
  quizId: string
  title: string
  attempt: QuizAttempt
  questions: readonly QuizQuestion[]
  /** Sunucu saati eksi cihaz saati (ms); sayaç ve yeniden deneme bununla işler. */
  clockOffsetMs: number
  /** Pencere kapandı (çıkış onaylandı ya da sonuç görünümüne dönüldü). */
  onClose: () => void
}

/**
 * Quiz çözme (DOM-AKD-077, DOM-AKD-078). Deneme sunucuda başlamıştır ve süre sunucuda işler:
 * sayaç `expiresAt`'ten yalnız gösterimdir, karar sunucudadır (ağ payı dahil). Cevaplar yalnız
 * bellekte tutulur (cihaza yazılmaz) ve web gibi tek istekle gönderilir (`POST …/attempt/submit`,
 * `Idempotency-Key` `useApiCommand`'da: aynı gövdenin yeniden gönderimi aynı anahtarı taşır).
 * Gönderim onaylıdır; çift dokunma tek istek atar (durum makinesi + komut kilidi). Ağ/5xx
 * hatasında cevaplar kalır ve "Yeniden gönder" sunulur; süre dolunca cevaplar kendiliğinden gider.
 * Puan gövdede yoktur, sunucu cevaplardan hesaplar.
 */
export function QuizSolve({ quizId, title, attempt, questions, clockOffsetMs, onClose }: Props) {
  const c = useColors()
  const notify = useNotify()
  const submit = useSubmitQuiz()
  // Sorular ilk okumada sabitlenir: arka planda tazelenen sorgu çözme sırasını değiştirmez.
  const [fixed] = useState(() => questions.map((question) => ({ ...question })))
  const [state, dispatch] = useReducer(solveReducer, INITIAL_SOLVE)
  const ids = fixed.map((question) => question.id)
  const { total, done } = solveProgress(ids, state.answers)

  const mounted = useRef(true)
  const latest = useRef({ state, clockOffsetMs })
  latest.current = { state, clockOffsetMs }
  const tries = useRef(0)
  const waitMs = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const now = useClock(attempt.expiresAt !== null)
  const secondsLeft = quizSecondsLeft(attempt.expiresAt, now, clockOffsetMs)
  const timeOver = secondsLeft === 0

  // Süre dolunca cevaplar kendiliğinden gönderilir (sunucu ağ payı içinde kabul eder).
  useEffect(() => {
    if (timeOver) dispatch({ type: 'timeout' })
  }, [timeOver])

  // Gönderim: `sending`e geçişte tek istek. Hata pencerenin içinde görünür (toast yok); aynı gövde
  // yeniden gönderilirse komut aynı `Idempotency-Key`'i kullanır. Çift tetik `busy` döner.
  const phase = state.phase
  useEffect(() => {
    if (phase !== 'sending') return
    void (async () => {
      const { state: current, clockOffsetMs: offset } = latest.current
      const outcome = await submit.submit(
        { quizId, body: submitQuizBody(ids, current.answers) },
        { fieldFor: () => undefined, silent: () => true },
      )
      if (outcome.status === 'busy') return
      // Bitiş bildirimleri pencere kapansa da verilir: komut sorguları tazeleyince ayrıntı
      // pencere çözme görünümünü bu işlem bitmeden kapatabilir.
      if (outcome.status === 'success') {
        notify(solveEndText('submitted', current.auto) ?? '')
        if (mounted.current) dispatch({ type: 'sent' })
        return
      }
      if (outcome.error.code === 'quiz_already_submitted')
        notify(QUIZ_ALREADY_SUBMITTED_MESSAGE, 'warning')
      if (outcome.error.code === 'quiz_time_expired') notify(QUIZ_TIME_EXPIRED_MESSAGE, 'warning')
      if (!mounted.current) return
      const clock = Date.now()
      const over = isTimeOver(attempt, clock, offset)
      const wait = over ? nextRetryWait(tries.current, attempt, clock, offset) : null
      if (wait !== null) tries.current += 1
      waitMs.current = wait ?? 0
      dispatch({ type: 'failed', error: outcome.error, timeOver: over, waitMs: wait })
    })()
    // Yalnız `sending`e geçişte çalışır; cevaplar o anda kilitlidir.
  }, [phase])

  // Ağ hatası sonrası geri çekilmeli bekleme; sayaç ya da kapanış beklemeyi iptal eder.
  useEffect(() => {
    if (phase !== 'waiting') return
    const timer = setTimeout(() => dispatch({ type: 'wake' }), waitMs.current)
    return () => clearTimeout(timer)
  }, [phase])

  // Gönderildi ya da zaten gönderilmişti: sonuç görünümüne dönülür.
  useEffect(() => {
    if (phase === 'submitted' || phase === 'already') onClose()
    // `onClose` yalnız bu geçişte okunur.
  }, [phase])

  const question = fixed[Math.min(state.index, Math.max(0, fixed.length - 1))]
  const locked = isSolveLocked(state)
  const busy = state.phase === 'sending' || state.phase === 'waiting'
  const ended = state.phase === 'expired'

  function requestClose() {
    if (busy) return
    if (state.phase === 'leaving') return dispatch({ type: 'cancel' })
    if (state.phase === 'confirming') return dispatch({ type: 'cancel' })
    if (needsLeaveConfirm(state)) return dispatch({ type: 'leave' })
    onClose()
  }

  const clockText =
    secondsLeft === null
      ? null
      : timeOver
        ? 'Süre doldu'
        : `Kalan süre ${quizClockLabel(secondsLeft)}`
  const urgent = secondsLeft !== null && (timeOver || secondsLeft < 60)

  const footer = ended ? (
    <Button accent icon="Eye" onPress={onClose}>
      Sonucu gör
    </Button>
  ) : state.phase === 'confirming' ? (
    <Notice title="Cevaplar gönderilsin mi?" text={confirmSubmitText(total, done)}>
      <Button accent icon="Send" onPress={() => dispatch({ type: 'confirm' })}>
        Gönder
      </Button>
      <Button onPress={() => dispatch({ type: 'cancel' })}>Çözmeye devam et</Button>
    </Notice>
  ) : state.phase === 'leaving' ? (
    <Notice title={LEAVE_TEXTS.title} text={LEAVE_TEXTS.description} tone="amber">
      <Button onPress={() => dispatch({ type: 'cancel' })}>{LEAVE_TEXTS.cancel}</Button>
      <Button danger onPress={onClose}>
        {LEAVE_TEXTS.confirm}
      </Button>
    </Notice>
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

  return (
    <Sheet visible title={title} onClose={requestClose} footer={footer} pinFooter>
      <View style={{ gap: 16 }}>
        {clockText && (
          <View
            accessible
            accessibilityRole="timer"
            accessibilityLabel={clockText}
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
              {clockText}
            </T>
          </View>
        )}
        <T
          muted
          size={13}
          accessibilityRole="progressbar"
          accessibilityLabel={`${total} sorudan ${done} tanesi cevaplandı`}
        >
          {done} / {total} soru cevaplandı. Süre sunucu saatiyle işler; uygulamayı kapatsan da
          durmaz.
        </T>
        {!!state.error && (
          <Notice
            tone={state.phase === 'waiting' ? 'amber' : 'red'}
            title={state.phase === 'waiting' ? 'Yeniden deneniyor' : 'Cevaplar gönderilemedi'}
            text={state.error}
          />
        )}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8 }}
          style={{ flexGrow: 0 }}
          accessibilityLabel="Sorular"
        >
          {fixed.map((item, index) => {
            const answered = typeof state.answers[item.id] === 'number'
            const current = index === state.index
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={questionNavLabel(index, answered)}
                accessibilityState={{ selected: current }}
                disabled={locked || state.phase !== 'answering'}
                onPress={() => dispatch({ type: 'goto', index, total })}
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
                  {index + 1}
                </T>
              </Pressable>
            )
          })}
        </ScrollView>
        {question && (
          <View style={{ gap: 12 }}>
            <T bold size={17} accessibilityRole="header">
              {state.index + 1}. {question.text}
            </T>
            <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
              {question.options.map((text, position) => {
                const letter = OPTION_LETTERS[position] ?? String(position + 1)
                const checked = state.answers[question.id] === position
                return (
                  <Pressable
                    key={`${question.id}-${position}`}
                    accessibilityRole="radio"
                    accessibilityLabel={`${letter}) ${text}`}
                    accessibilityState={{ checked, disabled: locked }}
                    disabled={locked || state.phase !== 'answering'}
                    onPress={() =>
                      dispatch({
                        type: 'select',
                        questionId: question.id,
                        position,
                        optionCount: question.options.length,
                      })
                    }
                    style={({ pressed }) => ({
                      minHeight: 56,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      borderWidth: checked ? 2 : 1,
                      borderColor: checked ? c.primary : c.border,
                      backgroundColor: checked ? c.primarySoft : c.surface,
                      opacity: locked ? 0.6 : pressed ? 0.75 : 1,
                    })}
                  >
                    <T bold size={15} muted>
                      {letter})
                    </T>
                    <T size={15} style={{ flex: 1, flexShrink: 1 }}>
                      {text}
                    </T>
                  </Pressable>
                )
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button
                icon="ChevronLeft"
                style={{ flex: 1 }}
                disabled={state.index === 0 || state.phase !== 'answering'}
                onPress={() => dispatch({ type: 'goto', index: state.index - 1, total })}
              >
                Önceki
              </Button>
              <Button
                icon="ChevronRight"
                style={{ flex: 1 }}
                disabled={state.index >= total - 1 || state.phase !== 'answering'}
                onPress={() => dispatch({ type: 'goto', index: state.index + 1, total })}
              >
                Sonraki
              </Button>
            </View>
          </View>
        )}
      </View>
    </Sheet>
  )
}
