// Öğrenci quiz görevinin (otomatik puanlı deneme) mobil saf modeli (OG-061; IST-051, IST-124;
// DOM-BEC-005, 042, 043, 044, 045, 047). Deneme çözme, süre saati, cevap ve sonuç metinleri web ile
// ortaktır (`@kampus/react-shared/attempt-model.ts`, `use-attempt-answers.ts`); burada yalnız
// telefonun kararları vardır: hangi görev açılır, başlatma onayı, çözme akışı, süre dolunca
// gönderim ve sonuç görünürlüğü. Cevaplar yalnız bellekte ve sunucudadır, cihaza yazılmaz.
//
// Dinleme: mobilde ses oynatıcı yoktur ve dinleme hakkı deneme başlayınca işler. Dinleme kaydı
// içerebilecek görev telefonda başlatılmaz; hak boşa gitmesin diye karar deneme başlamadan önce
// eldeki bilgiyle kesinleşmelidir (Sabah kararı 92). Kesin bilgi atamadaki sunucu hesabı
// `hasListening`'dir (false açar, true "Bu görev web'den çözülür"). Alanı taşımayan eski yanıtta
// önceki denemeden kanıt ya da süren deneme aranır; yoksa görev listede aynı bilgiyle kalır.
import { keepsIdempotencyKey } from '@kampus/react-shared/commands.ts'
import {
  answeredCount,
  attemptContentNote,
  attemptResultHeading,
  describeKey,
  describeResponse,
  formatPoints,
  itemOutcome,
  type AttemptQuestion,
} from '@kampus/react-shared/attempt-model.ts'
import type { TaskTone } from '@kampus/react-shared/student-task-model.ts'
import type { TaskAssignmentLearner } from '@kampus/react-shared/use-task-assignments.ts'
import {
  attemptStale,
  TASK_ATTEMPT_MESSAGES,
  type TaskAttemptAnswers,
  type TaskAttemptDetail,
} from '@kampus/react-shared/use-task-attempts.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import {
  mobileTone,
  writingTaskRow,
  type MobileTone,
  type WritingTaskRow,
} from './student-writing.ts'

type Fields = Pick<TaskAssignmentLearner, 'scoringMode' | 'contentType' | 'listeningPlays'> &
  Partial<
    Pick<TaskAssignmentLearner, 'progress' | 'timeLimitMinutes' | 'attempts' | 'hasListening'>
  >

// --- Açılabilirlik -------------------------------------------------------------------------

/** Deneme olarak çözülen görev türleri; diğer otomatik puanlı türler denemesizdir. */
const ATTEMPT_CONTENT_TYPES: readonly TaskAssignmentLearner['contentType'][] = [
  'question',
  'quiz',
  'exercise_set',
]

/** Otomatik puanlı soru, quiz ya da alıştırma seti (öğretmen puanlı yazma/konuşma değil). */
export const isQuizTask = (assignment: Pick<Fields, 'scoringMode' | 'contentType'>) =>
  assignment.scoringMode === 'auto' && ATTEMPT_CONTENT_TYPES.includes(assignment.contentType)

export const WEB_ONLY_TEXT = "Bu görev web'den çözülür."
export const WEB_ONLY_LISTENING_TEXT =
  "Bu görev web'den çözülür: dinleme kaydı içeriyor, telefonda çalınamaz."
export const WEB_ONLY_UNKNOWN_TEXT =
  "Bu görev web'den çözülür: dinleme kaydı içerip içermediği başlamadan bilinemiyor, hakkın boşa gitmesin."

/**
 * Önceki bir denemenin ayrıntısından gelen kanıt: görev sürümü atamada sabittir, bu yüzden bir
 * denemede dinleme kaydı yoksa sonrakilerde de yoktur. İçerik kaldırılmış ya da kapalıysa kayıt
 * "yok" görünür ama bu kanıt değildir.
 */
export type ListeningEvidence = { noListeningRecording: boolean }

export const listeningEvidence = (
  detail: Pick<TaskAttemptDetail, 'listeningRecording' | 'contentRemoved' | 'contentUnavailable'>,
): ListeningEvidence => ({
  noListeningRecording:
    detail.listeningRecording === null &&
    !detail.contentRemoved &&
    detail.contentUnavailable === null,
})

export type QuizTaskAccess =
  | {
      open: true
      /**
       * `question` tek soru (dinleme kaydı bağlanamaz), `server` sunucu `hasListening: false`
       * dedi, `evidence` önceki denemede kayıt yok (alansız eski yanıt), `running` süren deneme
       * var (hak zaten işlemiş; ayrıntı açılınca `solveGate` yine bakar).
       */
      via: 'question' | 'server' | 'evidence' | 'running'
    }
  | { open: false; reason: 'unsupported' | 'listening' | 'unknown'; text: string }

/**
 * Görev telefonda açılır mı (karar yalnız atama alanlarından):
 * - `hasListening` true ya da `listeningPlays` dolu: dinleme kaydı içerebilir (DOM-BEC-005),
 *   açılmaz.
 * - tek `question`: dinleme kaydı yalnız quiz/alıştırma setine bağlanır, açılır.
 * - `hasListening` false: sunucu kayıt ve dinleme içeriği olmadığını hesapladı, açılır.
 * - alan yoksa (eski yanıt) quiz/alıştırma seti: `listeningPlays` boşluğu "sınırsız hakla
 *   dinleme" de olabilir (atama formundaki "Sınırsız" seçeneği); açılması için önceki denemeden
 *   kanıt gerekir ya da süren bir deneme olmalıdır. Aksi hâlde belirsizdir ve açılmaz.
 */
export function quizTaskAccess(assignment: Fields, evidence?: ListeningEvidence): QuizTaskAccess {
  if (!isQuizTask(assignment))
    return { open: false, reason: 'unsupported', text: 'Bu görev telefonda açılmaz.' }
  if (assignment.hasListening === true || assignment.listeningPlays !== null)
    return { open: false, reason: 'listening', text: WEB_ONLY_LISTENING_TEXT }
  if (assignment.contentType === 'question') return { open: true, via: 'question' }
  if (assignment.hasListening === false) return { open: true, via: 'server' }
  if (assignment.progress?.[0]?.status === 'in_progress') return { open: true, via: 'running' }
  if (evidence?.noListeningRecording === true) return { open: true, via: 'evidence' }
  return { open: false, reason: 'unknown', text: WEB_ONLY_UNKNOWN_TEXT }
}

/** Satırın hangi pencereyi açacağı; `null` açılmaz (yalnız listede görünür). */
export type TaskOpenKind = 'quiz' | null

export type QuizTaskState = {
  open: TaskOpenKind
  /** Açılmayan görevin satır altı bilgisi; açılıyorsa `null`. */
  note: string | null
  /** Erişilebilir ad eki: "Görevi aç" ya da neden açılmadığı. */
  hint: string
  tone: MobileTone
}

export function quizTaskState(assignment: Fields, evidence?: ListeningEvidence): QuizTaskState {
  const access = quizTaskAccess(assignment, evidence)
  return access.open
    ? { open: 'quiz', note: null, hint: 'Görevi aç', tone: 'primary' }
    : { open: null, note: access.text, hint: access.text, tone: 'amber' }
}

/** Ödevlerim > Görevler satırı: hangi pencerenin açılacağı ve açılmayanın nedeni. */
export type StudentTaskRow = Omit<WritingTaskRow, 'writable'> & {
  open: 'writing' | 'quiz' | null
  /** Açılmayan görevin satır altı bilgisi; açılıyorsa `null`. */
  note: string | null
}

/**
 * Öğrenci görev satırı (öğretmen puanlı yazma + otomatik puanlı quiz görevleri tek listede).
 * Yazma görevi ve açılabilir quiz görevi dokununca açılır; konuşma, el yazısı ve dinlemeli görev
 * satırda "web'den çözülür" notuyla kalır (Sabah kararı 92). Durum ve puan atama özetindendir.
 */
export function studentTaskRow(assignment: TaskAssignmentLearner, now: Date): StudentTaskRow {
  const { writable, ...row } = writingTaskRow(assignment, now)
  const named = (hint: string) => `${assignment.title}, ${row.status}. ${hint}`
  if (writable) return { ...row, open: 'writing', note: null, label: named('Görevi aç') }
  const state =
    assignment.scoringMode === 'auto'
      ? quizTaskState(assignment)
      : { open: null, note: WEB_ONLY_TEXT, hint: WEB_ONLY_TEXT }
  return { ...row, open: state.open, note: state.note, label: named(state.hint) }
}

// --- Başlatma ------------------------------------------------------------------------------

export const START_TEXTS = {
  title: 'Deneme başlatılsın mı?',
  cancel: 'Vazgeç',
  confirm: 'Başlat',
} as const

/**
 * Başlatma onayı: deneme hakkı ve süre başlatınca işler (DOM-BEC-042, 043). Değerlendirmede kalan
 * hak söylenir; alıştırmada hak sınırsızdır. Alıştırmada anında kontrol telefonda yoktur, cevaplar
 * teslimde puanlanır.
 */
export function startDescription(assignment: Fields): string {
  const parts: string[] = []
  if (assignment.timeLimitMinutes != null)
    parts.push(
      `${assignment.timeLimitMinutes} dakikan var; süre başlatınca işler, uygulamayı ya da ekranı kapatsan da durmaz.`,
    )
  const entry = assignment.progress?.[0]
  if (assignment.attempts?.kind === 'evaluation')
    parts.push(
      entry?.remaining != null
        ? `Başlatınca ${entry.remaining} deneme hakkından biri kullanılır.`
        : 'Başlatınca bir deneme hakkın kullanılır.',
    )
  else parts.push('Alıştırmada deneme hakkın sınırsızdır.')
  parts.push('Cevapların teslim edilince puanlanır.')
  return parts.join(' ')
}

// --- Çözme ayrıntısının kapısı -------------------------------------------------------------

export const LISTENING_ATTEMPT_TEXT =
  "Bu denemenin dinleme kaydı telefonda çalınamaz. Süren denemeyi web'den çöz."

export type SolveGate =
  /** Soruların çözüleceği süren deneme. */
  | { kind: 'solve' }
  /** Deneme bitti: sonuç görünümü. */
  | { kind: 'result' }
  /** Deneme açılamaz; `text` sakin bilgi. */
  | { kind: 'blocked'; reason: 'listening' | 'content'; text: string }

/**
 * Deneme ayrıntısı geldikten sonra çözme ekranı açılır mı. Dinleme kaydı gelmişse (hak başka
 * yerde başlatılmış olsa bile) telefonda çözülmez; kaldırılmış ya da kapalı içerikte soru gelmez.
 */
export function solveGate(
  detail: Pick<
    TaskAttemptDetail,
    'status' | 'listeningRecording' | 'contentRemoved' | 'contentUnavailable' | 'questions'
  >,
): SolveGate {
  if (detail.status !== 'in_progress') return { kind: 'result' }
  const note = attemptContentNote(detail)
  if (note !== null) return { kind: 'blocked', reason: 'content', text: note }
  if (detail.listeningRecording !== null)
    return { kind: 'blocked', reason: 'listening', text: LISTENING_ATTEMPT_TEXT }
  if (detail.questions.length === 0)
    return { kind: 'blocked', reason: 'content', text: 'Bu denemenin soruları şu an açılamıyor.' }
  return { kind: 'solve' }
}

// --- Süre ----------------------------------------------------------------------------------

/**
 * Süre sunucu saatindedir: ayrıntının okunduğu anda kalan süre (`remainingMs`) cihazın o anki
 * saatine eklenir, böylece cihaz saati kayması etkisizdir. Süre sınırı ve teslim penceresi yoksa
 * `null` (sayaç yok).
 */
export const deadlineAt = (fetchedAt: number, remainingMs: number | null): number | null =>
  remainingMs === null ? null : fetchedAt + remainingMs

export const remainingFrom = (deadline: number | null, now: number): number | null =>
  deadline === null ? null : deadline - now

export const isTimeOver = (remaining: number | null) => remaining !== null && remaining <= 0

/** Süre dolduktan sonra deneme ayrıntısı bu aralıkla yenilenir (sunucu kaydedilenlerle teslim eder). */
export const EXPIRED_REFRESH_MS = 2000

// --- Çözme akışı (durum makinesi) ----------------------------------------------------------

/**
 * `answering` cevap verilir; `confirming` gönderim onayı bekler; `leaving` çıkış onayı bekler;
 * `sending` istek sürer; `submitted` teslim edildi; `ended` deneme sunucuda zaten bitti (süre doldu
 * ya da başka yerde teslim edildi): sonuç sunucudan yenilenir.
 */
export type SolvePhase = 'answering' | 'confirming' | 'leaving' | 'sending' | 'submitted' | 'ended'

export type SolveState = {
  phase: SolvePhase
  /** Formun içinde gösterilen Türkçe hata ya da bilgi. */
  error: string | null
  /**
   * Son gönderim hatalıydı ve cevaplar o zamandan beri değişmedi: "Yeniden gönder" onaysız gider.
   * Ağ ve 5xx hatasında istek aynı `Idempotency-Key` ile gider (`keepsKey`); 429'da yeni anahtar.
   */
  resend: boolean
  keepsKey: boolean
  /** Süre dolduğu için kendiliğinden gönderim başladı; yalnız bir kez denenir. */
  autoSent: boolean
}

export const INITIAL_SOLVE: SolveState = {
  phase: 'answering',
  error: null,
  resend: false,
  keepsKey: false,
  autoSent: false,
}

export const LEAVE_TEXTS = {
  title: 'Denemeden çıkılsın mı?',
  description:
    'Süre işlemeye devam eder; cevapların kaydedildiği yere kadar sunucuda kalır, kalanı boş sayılır.',
  cancel: 'Çözmeye devam et',
  confirm: 'Çık',
} as const

export const TIME_OVER_ENDED_TEXT =
  'Süre doldu. Kaydedilmiş cevapların teslim sayıldı; sonuç yenileniyor.'
export const ALREADY_SUBMITTED_TEXT = 'Bu deneme zaten teslim edildi; sonuç yenileniyor.'
export const SUBMITTED_TEXT = 'Denemen teslim edildi.'
export const NOT_SAVED_TEXT =
  'Cevapların kaydedilemedi. Cevapların bu ekranda duruyor; bağlantı gelince yeniden dene.'
export const RESEND_HINT =
  ' Cevapların bu ekranda duruyor; bağlantı gelince "Yeniden gönder"e dokun.'

export type SolveAction =
  /** Cevap değişti: hata eskir, yeniden gönderim yeni gövdedir ve onay ister. */
  | { type: 'edit' }
  /** Gönder düğmesi: süre dolduysa ya da hata sonrası yeniden gönderimde onay sorulmaz. */
  | { type: 'press'; timeOver: boolean }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'leave' }
  /** Sayaç sıfırlandı: cevaplar bir kez kendiliğinden gönderilir. */
  | { type: 'timeout' }
  | { type: 'sent' }
  | { type: 'failed'; failure: SubmitFailure }

export type SubmitFailure = {
  /** `not-saved`: bekleyen cevaplar kaydedilemedi, teslim isteği gitmedi. */
  kind: 'not-saved' | 'request'
  error: ApiError | null
}

/** Cevaplar kilitli mi: istek sürerken ve bittikten sonra cevap değişmez. */
export const isSolveLocked = (state: SolveState) =>
  state.phase === 'sending' || state.phase === 'submitted' || state.phase === 'ended'

/** Çıkarken sorulacak onay: cevaplı ve henüz gönderilmemiş. */
export const needsLeaveConfirm = (state: SolveState, answered: number) =>
  (state.phase === 'answering' || state.phase === 'confirming') && answered > 0

const send = (state: SolveState, auto: boolean): SolveState => ({
  ...state,
  phase: 'sending',
  error: null,
  autoSent: state.autoSent || auto,
})

/** Kural hatası (422: süre doldu, teslim kapandı) ve zaten teslim (409): deneme sunucuda bitti. */
const attemptEnded = (error: ApiError) =>
  attemptStale(error) || error.code === 'attempt_already_submitted'

/**
 * Saf geçiş fonksiyonu. Çift dokunma ikinci gönderim yaratmaz: `sending` iken `press`, `confirm`
 * ve `timeout` değişiklik yapmaz; ekran yalnız `sending`e geçişte tek istek atar (komut
 * kilidi `runCommand` da ikinci isteği `busy` ile reddeder). Cevaplar bu durumda tutulmaz
 * (`useAttemptAnswers` bellekte tutar); hata hiçbir cevabı silmez.
 */
export function solveReducer(state: SolveState, action: SolveAction): SolveState {
  switch (action.type) {
    case 'edit':
      if (state.phase !== 'answering') return state
      return state.error === null && !state.resend
        ? state
        : { ...state, error: null, resend: false, keepsKey: false }
    case 'press': {
      if (state.phase !== 'answering') return state
      if (action.timeOver || state.resend) return send(state, action.timeOver)
      return { ...state, phase: 'confirming', error: null }
    }
    case 'confirm':
      return state.phase === 'confirming' ? send(state, false) : state
    case 'cancel':
      return state.phase === 'confirming' || state.phase === 'leaving'
        ? { ...state, phase: 'answering' }
        : state
    case 'leave':
      return state.phase === 'answering' ? { ...state, phase: 'leaving' } : state
    case 'timeout':
      return !state.autoSent &&
        (state.phase === 'answering' || state.phase === 'confirming' || state.phase === 'leaving')
        ? send(state, true)
        : state
    case 'sent':
      return state.phase === 'sending' ? { ...state, phase: 'submitted', error: null } : state
    case 'failed': {
      if (state.phase !== 'sending') return state
      const { failure } = action
      if (failure.kind === 'not-saved')
        return {
          ...state,
          phase: 'answering',
          error: NOT_SAVED_TEXT,
          resend: true,
          keepsKey: false,
        }
      const error = failure.error
      if (error && attemptEnded(error))
        return {
          ...state,
          phase: 'ended',
          error:
            error.code === 'attempt_already_submitted'
              ? ALREADY_SUBMITTED_TEXT
              : TIME_OVER_ENDED_TEXT,
          resend: false,
          keepsKey: false,
        }
      const keepsKey = error !== null && keepsIdempotencyKey(error)
      const message =
        error === null
          ? ''
          : ((TASK_ATTEMPT_MESSAGES as Record<string, string>)[error.code] ?? error.message)
      // Kesin olmayan hata: cevaplar ekranda kalır, "Yeniden gönder" açılır; ağ ve 5xx'te aynı
      // anahtar, 429'da yeni anahtar (`createIdempotencyTracker`).
      return {
        ...state,
        phase: 'answering',
        error: message + (keepsKey ? RESEND_HINT : ''),
        resend: true,
        keepsKey,
      }
    }
    default: {
      const unreachable: never = action
      return unreachable
    }
  }
}

/** Düğmenin yazısı: gönderim sürerken "Gönderiliyor…", hata sonrası ve süre bitince "Yeniden gönder". */
export const submitButtonText = (state: SolveState, timeOver: boolean) =>
  state.phase === 'sending'
    ? 'Gönderiliyor…'
    : state.resend || timeOver
      ? 'Yeniden gönder'
      : 'Teslim et'

/** Teslim onayı: boş bırakılan sorular yanlış sayılır (DOM-BEC-043). */
export function confirmSubmitText(total: number, done: number): string {
  return `${total} sorudan ${done} tanesini cevapladın.${
    done < total ? ' Boş bıraktığın sorular yanlış sayılır.' : ''
  } Teslim ettikten sonra cevaplar değiştirilemez.`
}

export const CONFIRM_TEXTS = { title: 'Deneme teslim edilsin mi?', cancel: 'Vazgeç' } as const

/** Soru gezinmesi: cevaplanmış mı bilgisiyle düğme etiketi (ekran okuyucu için). */
export const questionNavLabel = (index: number, answered: boolean) =>
  `Soru ${index + 1}, ${answered ? 'cevaplandı' : 'boş'}`

export const solveProgress = (
  questions: readonly AttemptQuestion[],
  answers: TaskAttemptAnswers,
) => ({ total: questions.length, done: answeredCount(questions, answers) })

// --- Teslim akışı --------------------------------------------------------------------------

export type SendOutcome<TData = unknown> =
  { status: 'success'; data: TData } | { status: 'busy' } | { status: 'failed'; error: ApiError }

export type SubmitResult =
  /** Başka bir teslim sürüyor; ekran değişmez. */
  | { kind: 'busy' }
  /** Bekleyen cevaplar kaydedilemedi: teslim gitmedi, cevaplar ekranda ve bellekte kalır. */
  | { kind: 'not-saved' }
  | { kind: 'failed'; failure: SubmitFailure }
  | { kind: 'done' }

/**
 * Teslim karar akışı (ekran ve test aynı fonksiyonu kullanır): önce bekleyen cevaplar kaydedilir
 * (`flush`); kayıt başarısızsa teslim gitmez. Süre dolduysa kayıt denemesi en iyi gayrettir: süre
 * sonrası kayıt zaten reddedilir, sunucu önceden kaydedilen cevaplarla teslim sayar (DOM-BEC-043);
 * teslim isteği yine gönderilir, 422 gelirse deneme bitmiş sayılır. `send` `Idempotency-Key`'i
 * komut oturumundan alır (aynı gövdede aynı anahtar).
 */
export async function submitAttempt({
  timeOver,
  flush,
  send,
}: {
  timeOver: boolean
  flush: () => Promise<boolean>
  send: () => Promise<SendOutcome>
}): Promise<SubmitResult> {
  const saved = await flush()
  if (!saved && !timeOver) return { kind: 'not-saved' }
  const outcome = await send()
  if (outcome.status === 'busy') return { kind: 'busy' }
  if (outcome.status === 'failed')
    return { kind: 'failed', failure: { kind: 'request', error: outcome.error } }
  return { kind: 'done' }
}

/** `SubmitResult`'ı durum makinesi eylemine çevirir; `busy` eylem üretmez. */
export function resultAction(result: SubmitResult): SolveAction | null {
  switch (result.kind) {
    case 'busy':
      return null
    case 'done':
      return { type: 'sent' }
    case 'not-saved':
      return { type: 'failed', failure: { kind: 'not-saved', error: null } }
    case 'failed':
      return { type: 'failed', failure: result.failure }
    default:
      return result satisfies never
  }
}

/**
 * Süre dolduktan sonra ekran ne yapar: gönderim bekleniyorsa (`timeout` eylemi) ya da sunucunun
 * teslim ettiği denemeyi görmek için ayrıntıyı yeniler.
 */
export const shouldRefreshExpired = (state: SolveState, timeOver: boolean) =>
  timeOver &&
  (state.phase === 'ended' || state.phase === 'answering' || state.phase === 'submitted')

// --- Cevap girdisi (6 soru türü) -----------------------------------------------------------

type Response = TaskAttemptAnswers[string]

/** Eşleştirme: sorunun seçimi değişir, boş seçim eşleşmeyi kaldırır (web `QuestionInput`). */
export function chooseMatch(
  response: Response | undefined,
  promptId: string,
  choiceId: string,
): Response {
  const pairs = response?.questionType === 'matching' ? response.pairs : []
  const rest = pairs.filter((pair) => pair.promptId !== promptId)
  return {
    questionType: 'matching',
    pairs: choiceId === '' ? rest : [...rest, { promptId, choiceId }],
  }
}

/** Boşluk doldurma: boşluğun değeri değişir; diğer boşluklar kalır. */
export function setGapValue(
  response: Response | undefined,
  gapId: string,
  value: string,
): Response {
  const gaps = response?.questionType === 'gap_fill' ? response.gaps : []
  return {
    questionType: 'gap_fill',
    gaps: [...gaps.filter((gap) => gap.gapId !== gapId), { gapId, value }],
  }
}

/**
 * Sıralama: ekranda gösterilen sıra (cevap yoksa öğelerin kendi sırası) bir adım taşınır. Sınır
 * dışına taşıma değişiklik yapmaz (`null`).
 */
export function moveOrderItem(
  shown: readonly string[],
  index: number,
  delta: -1 | 1,
): Response | null {
  const target = index + delta
  if (index < 0 || index >= shown.length || target < 0 || target >= shown.length) return null
  const next = [...shown]
  const [moved] = next.splice(index, 1)
  if (moved === undefined) return null
  next.splice(target, 0, moved)
  return { questionType: 'ordering', order: next }
}

/** Sıralamada gösterilen sıra: tam cevap varsa o, yoksa öğelerin kendi sırası. */
export const shownOrder = (
  items: readonly { id: string }[],
  response: Response | undefined,
): string[] =>
  response?.questionType === 'ordering' && response.order.length === items.length
    ? response.order
    : items.map((item) => item.id)

/** Yeni cevap: yalnız o sorunun cevabı değişir, diğerleri korunur. */
export const withAnswer = (
  answers: TaskAttemptAnswers,
  questionVersionId: string,
  response: Response,
): TaskAttemptAnswers => ({ ...answers, [questionVersionId]: response })

// --- Sonuç görünürlüğü ---------------------------------------------------------------------

export type ResultItemRow = {
  questionVersionId: string
  number: number
  outcome: string
  tone: MobileTone
  points: string
  answer: string
  /** Yalnız sunucu cevap anahtarını açtıysa; aksi hâlde `null` (hiç çizilmez). */
  key: string | null
  explanation: string | null
}

export type AttemptResultView = {
  heading: string
  /** İçerik kaldırıldı ya da kapalı notu; açıksa `null`. */
  note: string | null
  /** Yalnız sunucunun açtığı puan: "75 / 100"; yoksa `null` (puana dair hiçbir ifade yok). */
  score: { percent: string; points: string } | null
  /** Madde sonuçları yalnız sunucu `items` döndürdüyse; yoksa `null` (ipucu da yok). */
  items: ResultItemRow[] | null
}

const toneOf = (tone: TaskTone): MobileTone => mobileTone(tone)

/**
 * Denemenin sonuç görünümü (DOM-BEC-045): puan, madde sonucu ve doğru cevap yalnız sunucu
 * açtıysa üretilir (`result`, `items`, `answerKey` dolu). Süren denemede sonuç yoktur. İstemci puan
 * hesaplamaz; açılmayan alan için ipucu metni de üretilmez.
 */
export function attemptResultView(attempt: TaskAttemptDetail): AttemptResultView {
  const result = attempt.status === 'in_progress' ? null : attempt.result
  const keys = result?.answerKey ?? null
  const items =
    result?.items == null
      ? null
      : result.items.map((score, index): ResultItemRow => {
          const question = attempt.questions.find(
            (item) => item.questionVersionId === score.questionVersionId,
          )
          const outcome = itemOutcome(score)
          const entry = keys?.find((item) => item.questionVersionId === score.questionVersionId)
          return {
            questionVersionId: score.questionVersionId,
            number: index + 1,
            outcome: outcome.label,
            tone: toneOf(outcome.tone),
            points: `${formatPoints(score.earned)} / ${formatPoints(score.points)}`,
            answer: question
              ? describeResponse(question.question, attempt.answers[score.questionVersionId])
              : '',
            key: entry && question ? describeKey(question.question, entry.answerKey) : null,
            explanation: entry?.answerKey.explanation || null,
          }
        })
  return {
    heading: attemptResultHeading(attempt),
    note: attemptContentNote(attempt),
    score: result
      ? {
          percent: `${formatPoints(result.percent)} / 100`,
          points: `${formatPoints(result.earned)} / ${formatPoints(result.possible)} puan`,
        }
      : null,
    items,
  }
}
