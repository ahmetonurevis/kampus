import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import {
  OPTION_LETTERS,
  QUIZ_ALREADY_SUBMITTED_MESSAGE,
  QUIZ_TIME_EXPIRED_MESSAGE,
  quizClockLabel,
  quizSecondsLeft,
  submitQuizBody,
} from '@kampus/react-shared/quizzes.ts'
import { useSubmitQuiz } from '@kampus/react-shared/use-quizzes.ts'
import { Button, T, useColors } from '../../ui/components.tsx'
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
  type SolveInput,
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
  /** Çözme girdisi; `null` iken kanca boştadır (pencere ayrıntı görünümündedir). */
  input: SolveInput | null
  /** Çözme bitti (çıkış onaylandı ya da sonuç görünümüne dönüldü). */
  onClose: () => void
}

/** Pencerenin çözme görünümü: gövde, sabit alt alan ve kapatma isteği. */
export type QuizSolveView = {
  content: ReactNode
  footer: ReactNode
  requestClose: () => void
}

/**
 * Quiz çözme (DOM-AKD-077, DOM-AKD-078). Deneme sunucuda başlamıştır ve süre sunucuda işler:
 * sayaç `expiresAt`'ten yalnız gösterimdir, karar sunucudadır (ağ payı dahil). Cevaplar yalnız
 * bellekte tutulur (cihaza yazılmaz) ve web gibi tek istekle gönderilir (`POST …/attempt/submit`,
 * `Idempotency-Key` `useApiCommand`'da: belirsiz hatadan sonra aynı gövde aynı anahtarı taşır).
 * Gönderim onaylıdır; çift dokunma tek istek atar (durum makinesi + komut kilidi). Ağ/5xx
 * hatasında cevaplar kalır ve "Yeniden gönder" sunulur; süre dolunca cevaplar kendiliğinden gider
 * (yalnız çözme sürerken dolarsa: açılışta süre dolmuşsa çözme hiç açılmaz, `solveEntry`).
 * Kanca olarak yazılmıştır: pencere tek `Sheet` kalır, ayrıntı ve çözme yalnız içerik değiştirir
 * (iOS'ta bir Modal kapanıp başkası açılınca ikincisi görünmeyebilir).
 */
export function useQuizSolve({ quizId, input, onClose }: Props): QuizSolveView | null {
  const c = useColors()
  const notify = useNotify()
  const submit = useSubmitQuiz()
  // Sorular girişte sabitlenir: arka planda tazelenen sorgu çözme sırasını değiştirmez.
  const fixed = useMemo(() => (input ? input.questions.map((q) => ({ ...q })) : []), [input])
  const attempt = input?.attempt
  const clockOffsetMs = input?.clockOffsetMs ?? 0
  const [state, dispatch] = useReducer(solveReducer, INITIAL_SOLVE)
  const ids = fixed.map((question) => question.id)
  const { total, done } = solveProgress(ids, state.answers)

  const mounted = useRef(true)
  const latest = useRef({ state, clockOffsetMs, ids })
  latest.current = { state, clockOffsetMs, ids }
  const tries = useRef(0)
  const waitMs = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const active = input !== null
  const now = useClock(active && attempt?.expiresAt !== null)
  const secondsLeft = quizSecondsLeft(attempt?.expiresAt ?? null, now, clockOffsetMs)
  const timeOver = secondsLeft === 0

  // Çıkış ya da bitiş: sonraki çözme temiz başlar.
  function close() {
    dispatch({ type: 'reset' })
    tries.current = 0
    waitMs.current = 0
    onClose()
  }

  // Çözme sürerken süre dolarsa cevaplar kendiliğinden gönderilir (sunucu ağ payı içinde kabul eder).
  useEffect(() => {
    if (active && timeOver) dispatch({ type: 'timeout' })
  }, [active, timeOver])

  // Gönderim: `sending`e geçişte tek istek. Hata pencerenin içinde görünür (toast yok); aynı gövde
  // yeniden gönderilirse komut aynı `Idempotency-Key`'i kullanır. Çift tetik `busy` döner.
  const phase = state.phase
  useEffect(() => {
    if (!active || !attempt || phase !== 'sending') return
    void (async () => {
      const { state: current, clockOffsetMs: offset, ids: questionIds } = latest.current
      const outcome = await submit.submit(
        { quizId, body: submitQuizBody(questionIds, current.answers) },
        { fieldFor: () => undefined, silent: () => true },
      )
      if (outcome.status === 'busy') return
      // Bitiş bildirimleri pencere kapansa da verilir.
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
  }, [phase, active])

  // Ağ hatası sonrası geri çekilmeli bekleme; sayaç ya da kapanış beklemeyi iptal eder.
  useEffect(() => {
    if (!active || phase !== 'waiting') return
    const timer = setTimeout(() => dispatch({ type: 'wake' }), waitMs.current)
    return () => clearTimeout(timer)
  }, [phase, active])

  // Gönderildi ya da zaten gönderilmişti: sonuç görünümüne dönülür.
  useEffect(() => {
    if (active && (phase === 'submitted' || phase === 'already')) close()
    // `close` yalnız bu geçişte okunur.
  }, [phase, active])

  if (!active) return null

  const question = fixed[Math.min(state.index, Math.max(0, fixed.length - 1))]
  const locked = isSolveLocked(state)
  const busy = state.phase === 'sending' || state.phase === 'waiting'
  const ended = state.phase === 'expired'

  function requestClose() {
    if (busy) return
    if (state.phase === 'leaving') return dispatch({ type: 'cancel' })
    if (state.phase === 'confirming') return dispatch({ type: 'cancel' })
    if (needsLeaveConfirm(state)) return dispatch({ type: 'leave' })
    close()
  }

  const clockText =
    secondsLeft === null
      ? null
      : timeOver
        ? 'Süre doldu'
        : `Kalan süre ${quizClockLabel(secondsLeft)}`
  const urgent = secondsLeft !== null && (timeOver || secondsLeft < 60)

  // Onay metinleri kaydırılabilir gövdededir (büyük yazıda taşmaz); düğmeler sabit alt alanda kalır.
  const prompt =
    state.phase === 'confirming' ? (
      <Notice title="Cevaplar gönderilsin mi?" text={confirmSubmitText(total, done)} />
    ) : state.phase === 'leaving' ? (
      <Notice title={LEAVE_TEXTS.title} text={LEAVE_TEXTS.description} tone="amber" />
    ) : null

  const footer = ended ? (
    <Button accent icon="Eye" onPress={close}>
      Sonucu gör
    </Button>
  ) : state.phase === 'confirming' ? (
    <View style={{ gap: 10 }}>
      <Button accent icon="Send" onPress={() => dispatch({ type: 'confirm' })}>
        Gönder
      </Button>
      <Button onPress={() => dispatch({ type: 'cancel' })}>Çözmeye devam et</Button>
    </View>
  ) : state.phase === 'leaving' ? (
    <View style={{ gap: 10 }}>
      <Button onPress={() => dispatch({ type: 'cancel' })}>{LEAVE_TEXTS.cancel}</Button>
      <Button danger onPress={close}>
        {LEAVE_TEXTS.confirm}
      </Button>
    </View>
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

  const content = (
    <View style={{ gap: 16 }}>
      {prompt}
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
        {done} / {total} soru cevaplandı. Süre sunucu saatiyle işler; uygulamayı kapatsan da durmaz.
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
  )

  return { content, footer, requestClose }
}
