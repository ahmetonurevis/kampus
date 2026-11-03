// Öğrenci quiz ekranlarının saf modeli (IST-124; DOM-AKD-077, DOM-AKD-078). Liste satırı, süzgeç,
// çözme durum makinesi ve sonuç metinleri burada; ekran (`screens/StudentQuizzes.tsx`,
// `screens/quiz-solve.tsx`) yalnız çizer. Deneme durumu, başlatma kararı, şık harfi ve inceleme
// satırı web ile ortaktır (`@kampus/react-shared/quizzes.ts`). Puan istemcide hesaplanmaz: sonuç
// sunucunun cevaplardan hesapladığı `attempts[].result`'tır; cevap anahtarı öğrenciye hiç gelmez,
// bu yüzden soru bazında doğru/yanlış gösterilmez (yalnız verilen cevap, sunucu açınca).
import type { ApiError } from '@kampus/api-client/errors.ts'
import {
  answeredCount,
  attemptOf,
  attemptPhase,
  canStartQuiz,
  isQuizSubmitRetryable,
  QUIZ_ALREADY_SUBMITTED_MESSAGE,
  QUIZ_PHASE_TEXT,
  QUIZ_TIME_EXPIRED_MESSAGE,
  quizErrorMessage,
  quizGraceLeftMs,
  quizSecondsLeft,
  quizClockOffset,
  quizSubmitRetryDelay,
  type AttemptPhase,
  type QuizAttempt,
  type QuizListItem,
  type QuizQuestion,
  type QuizStart,
} from '@kampus/react-shared/quizzes.ts'
import { dueText, matchesSearch } from './presentation.ts'

// --- Liste ---------------------------------------------------------------------------------

/**
 * Listenin üç ayrımı: açık (çözülebilir ya da süren), tamamlanmış ve süresi geçmiş (süresinde
 * gönderilmemiş deneme ya da hiç çözülmeden kapanan quiz).
 */
export type QuizGroup = 'open' | 'completed' | 'expired'

/** Süzgeç değeri: boş metin "tümü" demektir (`list-state.ts`). */
export const QUIZ_GROUP_OPTIONS = [
  { value: '', label: 'Tümü' },
  { value: 'open', label: 'Açık' },
  { value: 'completed', label: 'Tamamlanan' },
  { value: 'expired', label: 'Süresi geçen' },
] as const satisfies readonly { value: '' | QuizGroup; label: string }[]

export const isQuizGroup = (value: string): value is QuizGroup =>
  value === 'open' || value === 'completed' || value === 'expired'

type GroupInput = Pick<QuizListItem, 'status'>

/** Quizin ayrımı: karar sunucunun `status` alanı ve deneme durumundadır, istemci saatinde değil. */
export function quizGroup(
  quiz: GroupInput,
  attempt: Pick<QuizAttempt, 'status'> | undefined,
): QuizGroup {
  const phase = attemptPhase(attempt)
  if (phase === 'completed') return 'completed'
  if (phase === 'expired') return 'expired'
  if (phase === 'in_progress') return 'open'
  return quiz.status === 'open' ? 'open' : 'expired'
}

export type QuizRow = {
  id: string
  title: string
  subject: string
  subtitle: string
  due: string
  group: QuizGroup
  phase: AttemptPhase
  /** Rozet metni; hiç çözülmeden kapanan quizde "Süresi geçti". */
  badge: string
  /** Sunucunun hesapladığı puan; sonuçlanmamış denemede `null`. */
  score: string | null
  startable: boolean
  resumable: boolean
}

export const QUIZ_CLOSED_BADGE = 'Süresi geçti'

/** Rozet rengi deneme durumundan gelir (ortak `Badge` metin tahminine bırakılmaz). */
export function quizBadgeTone(badge: string): 'primary' | 'green' | 'amber' | 'red' {
  if (badge === QUIZ_PHASE_TEXT.completed) return 'green'
  if (badge === QUIZ_PHASE_TEXT.expired || badge === QUIZ_CLOSED_BADGE) return 'red'
  if (badge === QUIZ_PHASE_TEXT.none) return 'amber'
  return 'primary'
}

/** Satır yalnız okuyan öğrencinin denemesinden kurulur (sunucu zaten yalnız kendisininkini verir). */
export function quizRow(item: QuizListItem, studentId: string): QuizRow {
  const attempt = attemptOf(item, studentId)
  const phase = attemptPhase(attempt)
  const group = quizGroup(item, attempt)
  const result = attempt?.result ?? null
  return {
    id: item.id,
    title: item.title,
    subject: item.subject,
    subtitle: `${item.subject} · ${item.questionCount} soru · ${item.duration} dk`,
    due: item.dueDate ? `Son tarih: ${dueText(item.dueDate)}` : 'Süresiz açık',
    group,
    phase,
    badge: phase === 'none' && group === 'expired' ? QUIZ_CLOSED_BADGE : QUIZ_PHASE_TEXT[phase],
    score: result ? `%${result.score}` : null,
    startable: canStartQuiz(item, attempt),
    resumable: phase === 'in_progress',
  }
}

/** Süzgeç ve arama (başlık, ders); açık ayrım önce, sonra tamamlanan, sonra süresi geçen. */
export function visibleQuizRows(
  rows: readonly QuizRow[],
  filter: string,
  search: string,
): QuizRow[] {
  const group = isQuizGroup(filter) ? filter : undefined
  return rows.filter(
    (row) =>
      (group === undefined || row.group === group) &&
      matchesSearch([row.title, row.subject], search),
  )
}

export function quizGroupCounts(rows: readonly QuizRow[]): Record<QuizGroup, number> {
  const counts: Record<QuizGroup, number> = { open: 0, completed: 0, expired: 0 }
  for (const row of rows) counts[row.group] += 1
  return counts
}

export function quizEmptyText(filter: string): { title: string; text: string } {
  switch (filter) {
    case 'open':
      return { title: 'Açık quiz yok', text: 'Öğretmenin quiz yayınladığında burada görünür.' }
    case 'completed':
      return {
        title: 'Tamamlanan quiz yok',
        text: 'Gönderdiğin quizler burada sonuçlarıyla görünür.',
      }
    case 'expired':
      return { title: 'Süresi geçen quiz yok', text: 'Süresi geçen quizler burada görünür.' }
    default:
      return { title: 'Henüz quiz yok', text: 'Sınıfına quiz yayınlandığında burada görünür.' }
  }
}

// --- Başlatma ------------------------------------------------------------------------------

export const START_TEXTS = {
  title: 'Quiz başlatılsın mı?',
  cancel: 'Vazgeç',
  confirm: 'Başlat',
} as const

export const startDescription = (quiz: { questionCount: number; duration: number }) =>
  `${quiz.questionCount} soru, ${quiz.duration} dakika. Süre başlatınca işler; uygulamayı ya da ekranı kapatsan da durmaz. Quiz yalnız bir kez çözülebilir.`

// --- Çözme durum makinesi ------------------------------------------------------------------

/**
 * `answering` seçim yapılır; `confirming` gönderim onayı bekler; `leaving` çıkış onayı bekler;
 * `sending` istek sürer; `waiting` ağ hatası sonrası süre-payı içinde yeniden denemeyi bekler;
 * `submitted`, `already`, `expired` bitiş durumlarıdır.
 */
export type SolvePhase =
  | 'answering'
  | 'confirming'
  | 'leaving'
  | 'sending'
  | 'waiting'
  | 'submitted'
  | 'already'
  | 'expired'

export type SolveState = {
  phase: SolvePhase
  /** Soru kimliği → seçilen şık sırası; yalnız bellekte durur, cihaza yazılmaz. */
  answers: Readonly<Record<string, number>>
  /** Ekrandaki sorunun sırası (0 tabanlı). */
  index: number
  /** Formun içinde gösterilen Türkçe hata ya da bilgi. */
  error: string | null
  /** Son hata kesin değildi: cevaplar kayıtlı, aynı gövde yeniden gönderilebilir. */
  retryable: boolean
  /** Gönderim süre dolduğu için kendiliğinden başladı. */
  auto: boolean
}

export const INITIAL_SOLVE: SolveState = {
  phase: 'answering',
  answers: {},
  index: 0,
  error: null,
  retryable: false,
  auto: false,
}

export const RETRY_NOTICE =
  'Bağlantı sorunu oldu; cevapların yeniden gönderiliyor. Bu ekranı kapatma.'
export const RESEND_HINT =
  ' Cevapların bu ekranda duruyor; bağlantı gelince "Yeniden gönder"e dokun.'

export const LEAVE_TEXTS = {
  title: 'Quizden çıkılsın mı?',
  description:
    'Süre işlemeye devam eder; seçtiğin cevaplar kaybolur ve sunucuda boş cevaplı sayılır.',
  cancel: 'Çözmeye devam et',
  confirm: 'Çık ve cevapları at',
} as const

export type SolveAction =
  | { type: 'select'; questionId: string; position: number; optionCount: number }
  | { type: 'goto'; index: number; total: number }
  /** Gönder düğmesi: süre dolduysa ya da hata sonrası yeniden gönderimde onay sorulmaz. */
  | { type: 'press'; timeOver: boolean }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'leave' }
  /** Çözme bitti ya da pencere çözmeden ayrıldı: sonraki çözme temiz başlar. */
  | { type: 'reset' }
  /** Sayaç sıfırlandı: cevaplar kendiliğinden gönderilir. */
  | { type: 'timeout' }
  | { type: 'wake' }
  | { type: 'sent' }
  | { type: 'failed'; error: ApiError; timeOver: boolean; waitMs: number | null }

/** Cevaplar kilitli mi: istek sürerken, bekleme sırasında ve bittikten sonra seçim değişmez. */
export const isSolveLocked = (state: SolveState) =>
  state.phase === 'sending' ||
  state.phase === 'waiting' ||
  state.phase === 'submitted' ||
  state.phase === 'already' ||
  state.phase === 'expired'

/** Çıkarken cevapların kaybolacağı durum (onay sorulur). */
export const needsLeaveConfirm = (state: SolveState) =>
  (state.phase === 'answering' || state.phase === 'confirming') &&
  Object.keys(state.answers).length > 0

const send = (state: SolveState, auto: boolean): SolveState => ({
  ...state,
  phase: 'sending',
  error: null,
  auto: state.auto || auto,
})

/**
 * Saf geçiş fonksiyonu. Çift dokunma ikinci gönderim yaratmaz: `sending`/`waiting` iken `press`,
 * `confirm` ve `timeout` değişiklik yapmaz; ekran yalnız `sending`e geçişte tek istek atar
 * (belirsiz hatadan sonra aynı gövde yeniden gönderilirse `Idempotency-Key` aynı kalır, 429'da yeni
 * anahtar kullanılır; `keepsIdempotencyKey`, `useApiCommand`).
 */
export function solveReducer(state: SolveState, action: SolveAction): SolveState {
  switch (action.type) {
    case 'select': {
      if (isSolveLocked(state) || state.phase !== 'answering') return state
      const { position, optionCount } = action
      if (!Number.isInteger(position) || position < 0 || position >= optionCount) return state
      if (state.answers[action.questionId] === position && state.error === null) return state
      // Yeni seçim hatayı eskitir; cevaplar değiştiği için yeniden gönderim yeni gövdedir.
      return {
        ...state,
        answers: { ...state.answers, [action.questionId]: position },
        error: null,
        retryable: false,
      }
    }
    case 'goto': {
      if (state.phase !== 'answering') return state
      const last = Math.max(0, action.total - 1)
      const index = Math.min(Math.max(0, Math.trunc(action.index)), last)
      return index === state.index ? state : { ...state, index }
    }
    case 'press': {
      if (state.phase !== 'answering') return state
      if (action.timeOver || state.retryable) return send(state, action.timeOver)
      return { ...state, phase: 'confirming', error: null }
    }
    case 'reset':
      return INITIAL_SOLVE
    case 'confirm':
      return state.phase === 'confirming' ? send(state, false) : state
    case 'cancel':
      return state.phase === 'confirming' || state.phase === 'leaving'
        ? { ...state, phase: 'answering' }
        : state
    case 'leave':
      return needsLeaveConfirm(state) && state.phase === 'answering'
        ? { ...state, phase: 'leaving' }
        : state
    case 'timeout':
      return state.phase === 'answering' ||
        state.phase === 'confirming' ||
        state.phase === 'leaving'
        ? send(state, true)
        : state
    case 'wake':
      return state.phase === 'waiting' ? send(state, state.auto) : state
    case 'sent':
      return state.phase === 'sending' ? { ...state, phase: 'submitted', error: null } : state
    case 'failed': {
      if (state.phase !== 'sending') return state
      const { error, timeOver, waitMs } = action
      // Cevaplar zaten kayıtlı (ör. başka cihazdan): sonuç görünümüne geçilir.
      if (error.code === 'quiz_already_submitted')
        return { ...state, phase: 'already', error: QUIZ_ALREADY_SUBMITTED_MESSAGE }
      if (error.code === 'quiz_time_expired')
        return { ...state, phase: 'expired', error: QUIZ_TIME_EXPIRED_MESSAGE }
      const retryable = isQuizSubmitRetryable(error)
      if (retryable && timeOver && waitMs !== null)
        return { ...state, phase: 'waiting', error: RETRY_NOTICE, retryable: true }
      // Kesin olmayan hata: cevaplar ekranda kalır, "Yeniden gönder" açılır.
      return {
        ...state,
        phase: 'answering',
        retryable,
        error: quizErrorMessage(error) + (retryable && timeOver ? RESEND_HINT : ''),
      }
    }
    default: {
      const unreachable: never = action
      return unreachable
    }
  }
}

/** Süre bittikten sonra ağ payı içinde sıradaki yeniden denemenin bekleme süresi; yoksa `null`. */
export function nextRetryWait(
  tryNo: number,
  attempt: Pick<QuizAttempt, 'expiresAt'>,
  now: number,
  offsetMs: number,
): number | null {
  return quizSubmitRetryDelay(tryNo, quizGraceLeftMs(attempt.expiresAt, now, offsetMs))
}

/** Süre doldu mu (yalnız gösterim ve otomatik gönderim; karar sunucudadır). */
export const isTimeOver = (
  attempt: Pick<QuizAttempt, 'expiresAt'>,
  now: number,
  offsetMs: number,
) => quizSecondsLeft(attempt.expiresAt, now, offsetMs) === 0

/** Düğmenin yazısı: hata sonrası ve süre bitince "Yeniden gönder". */
export const submitButtonText = (state: SolveState, timeOver: boolean) =>
  state.phase === 'sending' || state.phase === 'waiting'
    ? 'Gönderiliyor…'
    : state.retryable || timeOver
      ? 'Yeniden gönder'
      : 'Cevapları gönder'

export function confirmSubmitText(total: number, done: number): string {
  return `${total} sorudan ${done} tanesini cevapladın.${
    done < total ? ' Boş bıraktığın sorular yanlış sayılır.' : ''
  } Gönderdikten sonra cevaplar değiştirilemez.`
}

/** Soru gezinmesi: cevaplanmış mı bilgisiyle düğme etiketi (ekran okuyucu için). */
export function questionNavLabel(index: number, answered: boolean): string {
  return `Soru ${index + 1}, ${answered ? 'cevaplandı' : 'boş'}`
}

export const solveProgress = (
  ids: readonly string[],
  answers: Readonly<Record<string, number | undefined>>,
) => ({ total: ids.length, done: answeredCount(ids, answers) })

/** Bitiş durumunun açıklaması (gönderim sonrası ekranda kalan sürede). */
export function solveEndText(phase: SolvePhase, auto: boolean): string | null {
  switch (phase) {
    case 'submitted':
      return auto ? 'Süre doldu; cevapların gönderildi.' : 'Cevapların gönderildi.'
    case 'already':
      return QUIZ_ALREADY_SUBMITTED_MESSAGE
    case 'expired':
      return QUIZ_TIME_EXPIRED_MESSAGE
    default:
      return null
  }
}

// --- Ayrıntı ve sonuç ----------------------------------------------------------------------

/** İnceleme (verilen cevaplar, konu yüzdeleri) kapalıyken gösterilen açıklama (DOM-AKD-078). */
export const REVIEW_LOCKED_TEXT =
  'Konu bazında sonuç ve cevaplar quizin son tarihi geçince ya da quiz kapanınca açılır.'

export const EXPIRED_ATTEMPT_TEXT =
  'Cevaplar süresinde gönderilmediği için deneme boş cevaplı sayıldı.'

export const OVERDUE_ATTEMPT_TEXT =
  'Bu quizin süresi doldu. Cevaplar süresinde gönderilmediği için deneme boş cevaplı sayılır; sonuç sunucuda hesaplanınca burada görünür.'

/** Ayrıntı penceresinde sonuç yoksa ne yapılabileceği. */
export type QuizAction = 'start' | 'resume' | 'closed' | 'pending'

/**
 * `start` açık quiz ve denemesi yok; `resume` süren deneme; `closed` süresi geçmiş ve hiç
 * başlanmamış; `pending` sonuç yok ama deneme bitmiş (ör. sonuç henüz yok): yalnız bilgi.
 */
export function quizAction(
  quiz: Pick<QuizListItem, 'status'>,
  attempt: Pick<QuizAttempt, 'status'> | undefined,
): QuizAction {
  if (attempt?.status === 'in_progress') return 'resume'
  if (canStartQuiz(quiz, attempt)) return 'start'
  if (attempt === undefined) return 'closed'
  return 'pending'
}

/** Çözme ekranının açılabildiği durum: süren deneme ve soruların açık olması. */
export function canSolve(
  attempt: Pick<QuizAttempt, 'status'> | undefined,
  questions: readonly unknown[] | null | undefined,
): boolean {
  return attempt?.status === 'in_progress' && !!questions && questions.length > 0
}

// --- Pencere: çözmeye giriş ve önbellek ----------------------------------------------------

/** Çözme ekranının girdisi: deneme, sabit sorular ve sunucu-cihaz saat farkı. */
export type SolveInput = {
  attempt: QuizAttempt
  questions: readonly QuizQuestion[]
  clockOffsetMs: number
}

/**
 * Çözmeye giriş kararı. Süre açılışta zaten dolmuşsa ekran açılmaz ve boş cevaplar kendiliğinden
 * gönderilmez (onaysız gönderim yok); `expired` sunucu durumunu (tazelenen ayrıntı) göstermek
 * içindir. Çözülemeyen deneme (sorular yok, deneme sürmüyor) `unavailable`dır.
 */
export function solveEntry(
  attempt: QuizAttempt | undefined,
  questions: readonly QuizQuestion[] | null | undefined,
  now: number,
  clockOffsetMs: number,
): { kind: 'solve'; input: SolveInput } | { kind: 'expired' } | { kind: 'unavailable' } {
  if (!attempt || !canSolve(attempt, questions) || !questions) return { kind: 'unavailable' }
  if (isTimeOver(attempt, now, clockOffsetMs)) return { kind: 'expired' }
  return { kind: 'solve', input: { attempt, questions, clockOffsetMs } }
}

/** Önbellekteki tek quiz yanıtının biçimi (`GET /quizzes/:id`); yalnız öğrenci alanları kullanılır. */
type CachedQuiz = { data: Record<string, unknown> & { attempts?: readonly QuizAttempt[] } }

/**
 * Başlatma yanıtını (`QuizStart`) önbellekteki ayrıntıya işler: deneme, sorular ve `serverNow`.
 * Ekran tazelemeyi beklemez; tazeleme düşse de "Quizi başlat" yeniden görünmez. Önbellek yoksa
 * `undefined` döner (yazılacak bir şey yok).
 */
export function applyQuizStart<T extends CachedQuiz>(
  cached: T | undefined,
  start: Pick<QuizStart, 'attempt' | 'questions' | 'serverNow'>,
): T | undefined {
  if (!cached) return undefined
  const others = (cached.data.attempts ?? []).filter(
    (item) => item.studentId !== start.attempt.studentId,
  )
  return {
    ...cached,
    data: {
      ...cached.data,
      attempts: [...others, start.attempt],
      questions: start.questions,
      serverNow: start.serverNow,
    },
  }
}

/** Başlatma yanıtından çözme girdisi (cihazda alındığı andan saat farkı). */
export function solveEntryFromStart(start: QuizStart, receivedAt: number) {
  return solveEntry(
    start.attempt,
    start.questions,
    receivedAt,
    quizClockOffset(start.serverNow, receivedAt),
  )
}

// --- Liste ekranı: hata önceliği -----------------------------------------------------------

/**
 * Yenileme hatası veri varken yerinde (satır içi) gösterilir; liste ve açık pencere yerinde kalır.
 * Tam ekran hata yalnız hiç veri yokken çıkar.
 */
export function queryErrorView(error: unknown, hasData: boolean): 'none' | 'inline' | 'full' {
  if (!error) return 'none'
  return hasData ? 'inline' : 'full'
}
