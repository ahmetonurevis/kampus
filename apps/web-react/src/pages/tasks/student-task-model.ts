import { TASK_CONTENT_UNAVAILABLE_MESSAGE } from '@kampus/react-shared/use-task-assignments.ts'
import type {
  TaskAttempt,
  TaskAttemptAnswers,
  TaskAttemptDetail,
} from '@kampus/react-shared/use-task-attempts.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/**
 * Öğrencinin görev ekranlarının saf modeli (IST-051; DOM-BEC-040…046). Durum, hak ve düğme
 * kararları sunucunun döndürdüğü kayıtlardan (deneme, teslim, `allowance`) türetilir; saklanmaz.
 * Puan ve geri bildirim yalnız sunucu açtıysa (`result`, `score` dolu) gösterilir: açılmamış
 * puana dair hiçbir ifade üretilmez (DOM-BEC-045). Burada yalnız deneme çözme ve sonuç gösterimi
 * kalır; liste, yazma durumu ve yönerge react-shared'dedir.
 */

// Görev listesi, yazma durumu ve yönerge web ve mobil için ortaktır; gerçek tanım
// `@kampus/react-shared/student-task-model.ts`'tedir (davranış değişmeden taşındı, IST-124).
export {
  autoProgress,
  blockedByMessage,
  FAILED,
  isLearnerAssignment,
  isNotFoundError,
  LAPSED_REASON,
  type LearnerAttribution,
  releasedScore,
  responseLabel,
  resubmissionPending,
  type ResultAudience,
  runningAttempt,
  scoreLabel,
  shownAttempt,
  type StudentTaskMode,
  type StudentTaskRow,
  studentTaskRow,
  submittedTextLabel,
  summaryBlockedReason,
  summaryProgress,
  taskClosed,
  taskKindLabel,
  type TaskProgress,
  type TaskTone,
  versionLimit,
  type WritingBrief,
  writingBrief,
  writingInitialBody,
  writingProgress,
} from '@kampus/react-shared/student-task-model.ts'
export { isSpeakingTask, taskTypeLabel } from '@kampus/react-shared/task-labels.ts'

// --- Cevaplar -----------------------------------------------------------------------------

/**
 * Cevap kaydı sürümü yalnız ilerler: geç dönen eski bir okuma, daha yeni bir yazmanın sürümünü
 * geri alamaz (aksi hâlde sonraki kayıt 409 alır).
 */
export const newerRowVersion = (current: number, incoming: number) => Math.max(current, incoming)

export type AttemptQuestion = TaskAttemptDetail['questions'][number]
type Response = TaskAttemptAnswers[string]

/** Sorunun cevabı tam mı (ilerleme sayacı ve teslim öncesi uyarı için). */
export function isAnswered(question: AttemptQuestion, response: Response | undefined): boolean {
  if (!response) return false
  const body = question.question
  switch (response.questionType) {
    case 'multiple_choice':
      return response.optionId !== null
    case 'true_false':
      return response.answer !== null
    case 'matching':
      return body.questionType === 'matching' && response.pairs.length === body.prompts.length
    case 'gap_fill':
      return (
        body.questionType === 'gap_fill' &&
        body.gaps.every((gap) =>
          response.gaps.some((item) => item.gapId === gap.id && item.value.trim() !== ''),
        )
      )
    case 'ordering':
      return body.questionType === 'ordering' && response.order.length === body.items.length
    case 'short_answer':
      return response.value.trim() !== ''
    default:
      return response satisfies never
  }
}

export const answeredCount = (questions: readonly AttemptQuestion[], answers: TaskAttemptAnswers) =>
  questions.filter((question) => isAnswered(question, answers[question.questionVersionId])).length

/** Kalan süre "dk:sn" ya da "sa:dk:sn". */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const two = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`
}

/**
 * Çözme ekranının saat etiketi (DOM-BEC-043). Sunucunun `remainingMs`'i süre ile teslim penceresinin
 * erken kapananına göredir; süre sınırı yoksa bu son teslime (geç kabul dahil) kadarki saattir ve
 * geri sayım olarak gösterilmez: yerine son teslim tarihi yazılır (Europe/Istanbul), son teslim
 * yoksa etiket yoktur. Pencere kapandıysa (sunucu kaydedilmiş cevaplarla teslim eder) söylenir.
 * Süreli denemede kalan süre geri sayılır; son dakika kırmızıdır.
 */
export function attemptClock({
  timeLimitMinutes,
  dueAt,
  remainingMs,
}: {
  timeLimitMinutes: number | null
  dueAt: string | null
  /** Şu an kalan süre (ms); sunucu `null` döndüyse `null`. */
  remainingMs: number | null
}): { text: string; tone: 'gray' | 'red' } | null {
  const over = remainingMs !== null && remainingMs <= 0
  if (timeLimitMinutes === null) {
    if (over) return { text: 'Teslim süresi doldu', tone: 'red' }
    return dueAt === null
      ? null
      : {
          text: `Son teslim: ${dateLabel(dueAt, { year: 'numeric' })} ${timeLabel(dueAt)}`,
          tone: 'gray',
        }
  }
  if (remainingMs === null) return null
  if (over) return { text: 'Süre doldu', tone: 'red' }
  return {
    text: `Kalan süre ${formatRemaining(remainingMs)}`,
    tone: remainingMs < 60_000 ? 'red' : 'gray',
  }
}

/** Kaydedilen cevapların kararlı karşılaştırma anahtarı (değişiklik algısı). */
export const answersFingerprint = (answers: TaskAttemptAnswers) =>
  JSON.stringify(
    Object.keys(answers)
      .sort()
      .map((key) => [key, answers[key]]),
  )

/** Gap soru kökünü `{{kimlik}}` işaretlerinden metin ve boşluk parçalarına böler. */
export type StemPart =
  { kind: 'text'; key: string; text: string } | { kind: 'gap'; key: string; id: string }
export function splitGapStem(stem: string): StemPart[] {
  const parts: StemPart[] = []
  let last = 0
  for (const match of stem.matchAll(/\{\{([A-Za-z0-9_-]{1,40})\}\}/g)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ kind: 'text', key: `t${last}`, text: stem.slice(last, index) })
    parts.push({ kind: 'gap', key: `g${index}`, id: match[1] ?? '' })
    last = index + match[0].length
  }
  if (last < stem.length) parts.push({ kind: 'text', key: `t${last}`, text: stem.slice(last) })
  return parts
}

// --- Sonuç gösterimi ----------------------------------------------------------------------

type QuestionBody = AttemptQuestion['question']
type KeyEntry = NonNullable<
  NonNullable<NonNullable<TaskAttemptDetail['result']>['answerKey']>[number]
>['answerKey']

const NO_ANSWER = 'Cevapsız'
const TRUE_FALSE_LABELS = { true: 'Doğru', false: 'Yanlış', not_given: 'Verilmemiş' } as const

/** Kabul edilen cevaplar sunucuda `unknown`; metin ya da metin listesidir. */
export function acceptedText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(acceptedText).filter(Boolean).join(' / ')
  return ''
}

/** Öğrencinin cevabının okunur metni (sonuç ekranı). */
export function describeResponse(body: QuestionBody, response: Response | undefined): string {
  if (!response) return NO_ANSWER
  switch (response.questionType) {
    case 'multiple_choice':
      return body.questionType === 'multiple_choice'
        ? (body.options.find((option) => option.id === response.optionId)?.text ?? NO_ANSWER)
        : NO_ANSWER
    case 'true_false':
      return response.answer === null ? NO_ANSWER : TRUE_FALSE_LABELS[response.answer]
    case 'matching':
      if (body.questionType !== 'matching' || response.pairs.length === 0) return NO_ANSWER
      return response.pairs
        .map((pair) => {
          const prompt = body.prompts.find((item) => item.id === pair.promptId)?.text ?? ''
          const choice = body.choices.find((item) => item.id === pair.choiceId)?.text ?? ''
          return `${prompt} → ${choice}`
        })
        .join('; ')
    case 'gap_fill': {
      const filled = response.gaps.filter((gap) => gap.value.trim() !== '')
      return filled.length === 0 ? NO_ANSWER : filled.map((gap) => gap.value).join(', ')
    }
    case 'ordering':
      if (body.questionType !== 'ordering' || response.order.length === 0) return NO_ANSWER
      return response.order
        .map((id) => body.items.find((item) => item.id === id)?.text ?? '')
        .join(' → ')
    case 'short_answer':
      return response.value.trim() === '' ? NO_ANSWER : response.value
    default:
      return response satisfies never
  }
}

/** Doğru cevabın okunur metni; yalnız sunucu anahtarı açtıysa çağrılır (DOM-BEC-045). */
export function describeKey(body: QuestionBody, key: KeyEntry): string {
  switch (key.questionType) {
    case 'multiple_choice':
      return body.questionType === 'multiple_choice'
        ? (body.options.find((option) => option.id === key.correctOptionId)?.text ?? '')
        : ''
    case 'true_false':
      return TRUE_FALSE_LABELS[key.answer]
    case 'matching':
      if (body.questionType !== 'matching') return ''
      return key.pairs
        .map((pair) => {
          const prompt = body.prompts.find((item) => item.id === pair.promptId)?.text ?? ''
          const choice = body.choices.find((item) => item.id === pair.choiceId)?.text ?? ''
          return `${prompt} → ${choice}`
        })
        .join('; ')
    case 'gap_fill':
      return key.gaps.map((gap) => acceptedText(gap.accepted)).join(', ')
    case 'ordering':
      if (body.questionType !== 'ordering') return ''
      return key.order
        .map((id) => body.items.find((item) => item.id === id)?.text ?? '')
        .join(' → ')
    case 'short_answer':
      return acceptedText(key.accepted)
    default:
      return key satisfies never
  }
}

type ItemScore = NonNullable<NonNullable<TaskAttemptDetail['result']>['items']>[number]

/**
 * Puan gösterimi: tamsayıysa ondalıksız, değilse en çok iki ondalık (sunucu iki ondalığa
 * yuvarlar).
 */
export const formatPoints = (value: number) =>
  value.toLocaleString('tr-TR', { maximumFractionDigits: 2, minimumFractionDigits: 0 })

/**
 * Maddenin sunucu sonucundan okunur durum (DOM-BEC-045): yalnız sunucu madde sonucunu açtıysa
 * çağrılır. Cevapsız madde yanlış sayılır ama ayrı yazılır; çok parçalı maddede (eşleştirme,
 * boşluk doldurma) bir kısmı doğruysa "Kısmen doğru".
 */
export function itemOutcome(score: ItemScore): { label: string; tone: BadgeTone } {
  if (!score.answered) return { label: 'Cevapsız', tone: 'gray' }
  if (score.parts > 0 && score.correctParts === score.parts)
    return { label: 'Doğru', tone: 'green' }
  if (score.correctParts > 0) return { label: 'Kısmen doğru', tone: 'amber' }
  return { label: 'Yanlış', tone: 'red' }
}

/** Personelin deneme listesindeki durum (DOM-BEC-042, 043): süren, teslim, süre dolunca teslim. */
export function attemptStatusBadge(
  attempt: Pick<TaskAttempt, 'status' | 'late' | 'autoSubmitted'>,
): { label: string; tone: BadgeTone } {
  if (attempt.status === 'in_progress') return { label: 'Sürüyor', tone: 'amber' }
  if (attempt.late) return { label: 'Geç teslim', tone: 'red' }
  if (attempt.status === 'expired' || attempt.autoSubmitted)
    return { label: 'Süre dolunca teslim', tone: 'gray' }
  return { label: 'Teslim edildi', tone: 'purple' }
}

/**
 * Deneme sonucu bölümünün başlığı: süren denemede (teslim edilmemiş) "sonuç" denmez, çünkü sonuç
 * yoktur; içerik kaldırılmış ve puan hesaplanamıyorsa bile süren deneme "sürüyor" başlığı alır
 * (DOM-KYN-051, DOM-BEC-045).
 */
export function attemptResultHeading(
  attempt: Pick<TaskAttempt, 'attemptNumber' | 'status'>,
): string {
  return attempt.status === 'in_progress'
    ? `${attempt.attemptNumber}. deneme (sürüyor)`
    : `${attempt.attemptNumber}. deneme sonucu`
}

/** Görevin içeriği kaldırıldı (DOM-KYN-051): geçmiş görevlerde bu not görünür. */
export const TASK_CONTENT_REMOVED_MESSAGE = 'Bu içerik kaldırıldı.'

/**
 * Deneme sonucunda soru listesinin yerine çizilen not (DOM-KYN-025, 051): içerik kaldırıldıysa
 * "Bu içerik kaldırıldı", başka nedenle kapalıysa (telif askısı, lisans, kitap sahibi) genel not;
 * açıksa `null`. Kaldırmada anahtar silindiği için puan hesaplanamıyorsa (`result: null`) not tek
 * başına görünür; kayıt ve deneme bilgisi kalır.
 */
export function attemptContentNote(
  attempt: Pick<TaskAttemptDetail, 'contentRemoved' | 'contentUnavailable'>,
): string | null {
  if (attempt.contentRemoved) return TASK_CONTENT_REMOVED_MESSAGE
  return attempt.contentUnavailable ? TASK_CONTENT_UNAVAILABLE_MESSAGE : null
}
