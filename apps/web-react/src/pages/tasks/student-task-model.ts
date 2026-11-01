import type {
  TaskAssignment,
  TaskAssignmentLearner,
} from '@kampus/react-shared/use-task-assignments.ts'
import type {
  TaskAttempt,
  TaskAttemptAnswers,
  TaskAttemptDetail,
} from '@kampus/react-shared/use-task-attempts.ts'
import type {
  TaskSubmission,
  TaskSubmissionDetail,
} from '@kampus/react-shared/use-task-submissions.ts'
import { isApiError } from '@kampus/api-client/errors.ts'
import { isClosed } from '@kampus/school-core/skills/scoring.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/**
 * Öğrencinin görev ekranlarının saf modeli (IST-051; DOM-BEC-040…046). Durum, hak ve düğme
 * kararları sunucunun döndürdüğü kayıtlardan (deneme, teslim, `allowance`) türetilir; saklanmaz.
 * Puan ve geri bildirim yalnız sunucu açtıysa (`result`, `score` dolu) gösterilir: açılmamış
 * puana dair hiçbir ifade üretilmez (DOM-BEC-045).
 */

export type StudentTaskMode = 'auto' | 'teacher'

export const isLearnerAssignment = (item: TaskAssignment): item is TaskAssignmentLearner =>
  item.view === 'learner'

const CONTENT_LABELS: Record<TaskAssignmentLearner['contentType'], string> = {
  quiz: 'Quiz',
  exercise_set: 'Alıştırma seti',
  question: 'Soru',
  homework_template: 'Yazma ödevi',
  text: 'Metin',
  reading_passage: 'Okuma parçası',
  audio: 'Dinleme',
  video: 'Video',
  worksheet: 'Çalışma kâğıdı',
  file: 'Dosya',
  link: 'Bağlantı',
  book_reference: 'Kitap',
}

export const taskTypeLabel = (assignment: Pick<TaskAssignmentLearner, 'contentType'>) =>
  CONTENT_LABELS[assignment.contentType]

export const taskKindLabel = (assignment: Pick<TaskAssignmentLearner, 'kind'>) =>
  assignment.kind === 'evaluation' ? 'Değerlendirme' : 'Alıştırma'

/** Teslim kapandı mı (core `isClosed`, DOM-BEC-044); son tarihsiz görev kapanmaz. */
export const taskClosed = (assignment: Pick<TaskAssignmentLearner, 'deadline'>, now: Date) =>
  isClosed(assignment.deadline, now.toISOString())

export const scoreLabel = (percent: number | null | undefined) =>
  percent === null || percent === undefined ? '—' : `${percent} / 100`

export type TaskProgress = {
  status: string
  tone: BadgeTone
  /** Deneme veya sürüm hakkı; "2 / 3 deneme", "Sınırsız". */
  rights: string
  /** Yalnız açılmış puan; yoksa `—`. */
  score: string
  /** Başlatma (otomatik) ya da yeni sürüm gönderme (yazma) şu an mümkün mü. */
  canAct: boolean
  /** `canAct` değilse neden; puanlamadan bağımsız ve sızıntısız metin. */
  blockedReason: string | null
}

const byNumber = (a: TaskAttempt, b: TaskAttempt) => a.attemptNumber - b.attemptNumber

/** Sayılan deneme (DOM-BEC-042); yoksa tamamlanan son deneme (alıştırma sonucu). */
export function shownAttempt(attempts: readonly TaskAttempt[]): TaskAttempt | undefined {
  const done = [...attempts].sort(byNumber).filter((attempt) => attempt.status !== 'in_progress')
  return done.find((attempt) => attempt.counted) ?? done.at(-1)
}

/** Süren deneme (varsa en yenisi). */
export const runningAttempt = (attempts: readonly TaskAttempt[]) =>
  [...attempts]
    .sort(byNumber)
    .reverse()
    .find((attempt) => attempt.status === 'in_progress')

export const NOT_LOADED: TaskProgress = {
  status: 'Yükleniyor',
  tone: 'gray',
  rights: '—',
  score: '—',
  canAct: false,
  blockedReason: null,
}

/** Otomatik puanlı görevin durumu: denemelerden (DOM-BEC-042, 044). */
export function autoProgress(
  assignment: TaskAssignmentLearner,
  attempts: readonly TaskAttempt[],
  now: Date,
): TaskProgress {
  const closed = taskClosed(assignment, now)
  const limit = assignment.attempts.kind === 'evaluation' ? assignment.attempts.maxAttempts : null
  const running = runningAttempt(attempts)
  const shown = shownAttempt(attempts)
  const rights = limit === null ? 'Sınırsız' : `${attempts.length} / ${limit} deneme`
  const score = scoreLabel(shown?.result?.percent)

  const limitReached = limit !== null && attempts.length >= limit
  const blockedReason = running
    ? null
    : closed
      ? 'Teslim süresi doldu; yeni deneme başlatılamaz.'
      : limitReached
        ? 'Deneme hakkınız doldu.'
        : null
  const canAct = running !== undefined || blockedReason === null

  if (running)
    return { status: 'Sürüyor', tone: 'amber', rights, score: '—', canAct, blockedReason }
  if (shown)
    return {
      status: shown.late ? 'Geç tamamlandı' : 'Tamamlandı',
      tone: shown.late ? 'amber' : 'green',
      rights,
      score,
      canAct,
      blockedReason,
    }
  return closed
    ? { status: 'Teslim edilmedi', tone: 'red', rights, score, canAct, blockedReason }
    : { status: 'Başlanmadı', tone: 'gray', rights, score, canAct, blockedReason }
}

/** `allowance.blockedBy` için neden metni; puanlamadan bağımsız (DOM-BEC-045). */
export function blockedByMessage(blockedBy: 'limit' | 'graded' | 'locked'): string {
  switch (blockedBy) {
    case 'limit':
      return 'Sürüm hakkınız doldu.'
    case 'graded':
      return 'Teslim değerlendirildi; yeni sürüm için öğretmeninizin yeniden teslim istemesi gerekir.'
    case 'locked':
      return 'Teslim süresi doldu; yeni sürüm gönderilemez.'
    default:
      return blockedBy satisfies never
  }
}

type SubmissionLike = Pick<
  TaskSubmission,
  'status' | 'versionCount' | 'latestVersion' | 'resubmission'
> &
  Partial<Pick<TaskSubmissionDetail, 'allowance'>>

const versionLimit = (assignment: TaskAssignmentLearner) =>
  assignment.submission?.maxVersions ?? null

/** Açılmış (kesinleşmiş) puan; açılmadıysa `null` (DOM-BEC-045). */
export function releasedScore(submission: SubmissionLike | null | undefined): number | null {
  const score = submission?.latestVersion?.score
  return score && score.settled ? score.percent : null
}

/** Öğretmenin yeniden teslim istediği ve henüz karşılanmadığı durum. */
export function resubmissionPending(submission: SubmissionLike | null | undefined): boolean {
  const request = submission?.resubmission
  const latest = submission?.latestVersion
  return !!request && !!latest && latest.number <= request.versionNumber
}

/**
 * Yazma görevinin durumu: teslimden (DOM-BEC-040, 044). Teslim yokken pencere açıksa gönderilebilir.
 * Ayrıntı okunduysa (`allowance`) düğme kararı sunucunundur; liste satırında hak sayısı gösterilir.
 */
export function writingProgress(
  assignment: TaskAssignmentLearner,
  submission: SubmissionLike | null,
  now: Date,
): TaskProgress {
  const closed = taskClosed(assignment, now)
  const limit = versionLimit(assignment)
  const used = submission?.versionCount ?? 0
  const rights = limit === null ? '—' : `${used} / ${limit} sürüm`
  const score = scoreLabel(releasedScore(submission))

  // Ayrıntı okunduysa düğme kararı sunucunun `allowance`'ındandır; okunmadıysa pencereye bakılır
  // (son söz yine sunucunundur: kapalı pencerede teslim 422 `submission_closed` alır).
  const allowance = submission?.allowance ?? null
  const canAct = allowance ? allowance.canSubmit : !closed
  const blockedReason = canAct
    ? null
    : allowance
      ? blockedByMessage(allowance.blockedBy ?? 'locked')
      : submission && submission.versionCount > 0
        ? blockedByMessage('locked')
        : 'Teslim süresi doldu.'

  if (!submission || submission.versionCount === 0)
    return closed
      ? { status: 'Teslim edilmedi', tone: 'red', rights, score, canAct, blockedReason }
      : { status: 'Bekliyor', tone: 'amber', rights, score, canAct, blockedReason }
  if (resubmissionPending(submission))
    return { status: 'Yeniden teslim istendi', tone: 'amber', rights, score, canAct, blockedReason }
  return submission.status === 'late'
    ? { status: 'Geç teslim edildi', tone: 'amber', rights, score, canAct, blockedReason }
    : { status: 'Teslim edildi', tone: 'green', rights, score, canAct, blockedReason }
}

export type StudentTaskRow = {
  id: string
  title: string
  type: string
  kind: string
  dueAt: string | null
  status: string
  tone: BadgeTone
  rights: string
  score: string
  /** Satırın ilerlemesi okunmadı (yükleniyor ya da hata). */
  pending: boolean
}

export function studentTaskRow(
  assignment: TaskAssignmentLearner,
  progress: TaskProgress | null,
): StudentTaskRow {
  const shown = progress ?? NOT_LOADED
  return {
    id: assignment.id,
    title: assignment.title,
    type: taskTypeLabel(assignment),
    kind: taskKindLabel(assignment),
    dueAt: assignment.deadline.dueAt,
    status: shown.status,
    tone: shown.tone,
    rights: shown.rights,
    score: shown.score,
    pending: progress === null,
  }
}

// --- Cevaplar -----------------------------------------------------------------------------

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

/** Atama okuması 404 döndüyse görev yok ya da öğrencinin kapsamında değil (varlığı sızdırılmaz). */
export const isNotFoundError = (error: unknown): boolean =>
  isApiError(error) && error.status === 404
