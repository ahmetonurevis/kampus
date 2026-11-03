import type { LearnerTaskProgress } from '@kampus/react-shared/use-learner-task-progress.ts'
import {
  TASK_CONTENT_UNAVAILABLE_MESSAGE,
  type TaskAssignmentLearner,
  type TaskAssignmentLearnerDetail,
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
import { isSpeakingTask, taskTypeLabel } from '@kampus/react-shared/task-labels.ts'
import { isApiError } from '@kampus/api-client/errors.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { isClosed } from '@kampus/school-core/skills/scoring.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/**
 * Öğrencinin görev ekranlarının saf modeli (IST-051; DOM-BEC-040…046). Durum, hak ve düğme
 * kararları sunucunun döndürdüğü kayıtlardan (deneme, teslim, `allowance`) türetilir; saklanmaz.
 * Puan ve geri bildirim yalnız sunucu açtıysa (`result`, `score` dolu) gösterilir: açılmamış
 * puana dair hiçbir ifade üretilmez (DOM-BEC-045).
 */

export type StudentTaskMode = 'auto' | 'teacher'

/** Kursiyer görünümü mü (liste satırı ya da ayrıntı). */
export const isLearnerAssignment = <T extends { view: string }>(
  item: T,
): item is Extract<T, { view: 'learner' }> => item.view === 'learner'

type SubmissionOf = Partial<Pick<TaskAssignmentLearner, 'submission'>>

export { isSpeakingTask, taskTypeLabel }

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

/**
 * Sunucu özetinin içerik kapısı engeli (DOM-KYN-021, 025, 051): yazma ucu bu görevde 422
 * `content_unavailable` ya da 409 `resource_license_expired` döneceğinden çalışma alanı da işlem
 * önermez. Kapalı içerik her yerel nedenden önce gelir; lisans engeli yalnız başka neden yokken.
 */
function contentBlock(
  assignment: Pick<TaskAssignmentLearner, 'progress' | 'scoringMode'>,
): { reason: string; overrides: boolean } | null {
  const entry = assignment.progress[0]
  if (entry?.blockedBy === 'content_unavailable')
    return { reason: TASK_CONTENT_UNAVAILABLE_MESSAGE, overrides: true }
  if (entry?.blockedBy === 'license_expired')
    return {
      reason:
        summaryBlockedReason(assignment.scoringMode === 'auto' ? 'auto' : 'teacher', entry) ?? '',
      overrides: false,
    }
  return null
}

/** Yerel durum kararına içerik engelini işler (`contentBlock`). */
function withContentBlock(
  assignment: Pick<TaskAssignmentLearner, 'progress' | 'scoringMode'>,
  canAct: boolean,
  blockedReason: string | null,
): Pick<TaskProgress, 'canAct' | 'blockedReason'> {
  const block = contentBlock(assignment)
  if (!block) return { canAct, blockedReason }
  return {
    canAct: false,
    blockedReason: block.overrides || blockedReason === null ? block.reason : blockedReason,
  }
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
  const localReason = running
    ? null
    : closed
      ? 'Teslim süresi doldu; yeni deneme başlatılamaz.'
      : limitReached
        ? 'Deneme hakkınız doldu.'
        : null
  // Süren deneme çözme ekranında sürer; kaldırılmış içerikte yazma ucu süren denemeyi de reddeder
  // (422 `content_unavailable`), çözme ekranı açılmaz. Telif askısında süren deneme sürer (özet
  // `in_progress`; Sabah kararı 47). Yeni deneme içerik kapısına takılırsa önerilmez.
  const { canAct, blockedReason } = running
    ? contentBlock(assignment)?.overrides
      ? { canAct: false, blockedReason: TASK_CONTENT_UNAVAILABLE_MESSAGE }
      : { canAct: true, blockedReason: null }
    : withContentBlock(assignment, localReason === null, localReason)

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

/**
 * `allowance.blockedBy` için neden metni; puanlamadan bağımsız (DOM-BEC-045). Konuşma görevinde
 * gönderilen her kayıt bir denemedir (IST-051), metin deneme hakkını anar.
 */
export function blockedByMessage(
  blockedBy: 'limit' | 'graded' | 'locked',
  speaking = false,
): string {
  switch (blockedBy) {
    case 'limit':
      return speaking ? 'Konuşma deneme hakkınız doldu.' : 'Sürüm hakkınız doldu.'
    case 'graded':
      return speaking
        ? 'Kaydınız değerlendirildi; yeni kayıt için öğretmeninizin yeniden teslim istemesi gerekir.'
        : 'Teslim değerlendirildi; yeni sürüm için öğretmeninizin yeniden teslim istemesi gerekir.'
    case 'locked':
      return speaking
        ? 'Teslim süresi doldu; yeni kayıt gönderilemez.'
        : 'Teslim süresi doldu; yeni sürüm gönderilemez.'
    default:
      return blockedBy satisfies never
  }
}

type SubmissionLike = Pick<
  TaskSubmission,
  'status' | 'versionCount' | 'latestVersion' | 'resubmission'
> &
  Partial<Pick<TaskSubmissionDetail, 'allowance'>>

/** Etkin sürüm sınırı; konuşmada deneme hakkıyla birlikte (core `versionAllowance`). */
export function versionLimit(assignment: SubmissionOf): number | null {
  const settings = assignment.submission
  if (!settings) return null
  return settings.submissionKind === 'audio'
    ? Math.min(settings.maxVersions, settings.speakingAttempts)
    : settings.maxVersions
}

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
  const speaking = isSpeakingTask(assignment)
  const used = submission?.versionCount ?? 0
  const rights = limit === null ? '—' : `${used} / ${limit} ${speaking ? 'deneme' : 'sürüm'}`
  const score = scoreLabel(releasedScore(submission))

  // Ayrıntı okunduysa düğme kararı sunucunun `allowance`'ındandır; okunmadıysa pencereye bakılır
  // (son söz yine sunucunundur: kapalı pencerede teslim 422 `submission_closed` alır).
  const allowance = submission?.allowance ?? null
  const localCanAct = allowance ? allowance.canSubmit : !closed
  const localReason = localCanAct
    ? null
    : allowance
      ? blockedByMessage(allowance.blockedBy ?? 'locked', speaking)
      : submission && submission.versionCount > 0
        ? blockedByMessage('locked', speaking)
        : 'Teslim süresi doldu.'
  // Atama özetinin içerik kapısı (taslak ve teslim ucu aynı kuralla 422/409 döner).
  const { canAct, blockedReason } = withContentBlock(assignment, localCanAct, localReason)

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

type ProgressStatus = LearnerTaskProgress['status']

const AUTO_STATUS: Record<ProgressStatus, Pick<TaskProgress, 'status' | 'tone'>> = {
  pending: { status: 'Başlanmadı', tone: 'gray' },
  in_progress: { status: 'Sürüyor', tone: 'amber' },
  submitted: { status: 'Tamamlandı', tone: 'green' },
  late: { status: 'Geç tamamlandı', tone: 'amber' },
  not_submitted: { status: 'Teslim edilmedi', tone: 'red' },
}

const WRITING_STATUS: Record<ProgressStatus, Pick<TaskProgress, 'status' | 'tone'>> = {
  pending: { status: 'Bekliyor', tone: 'amber' },
  in_progress: { status: 'Bekliyor', tone: 'amber' },
  submitted: { status: 'Teslim edildi', tone: 'green' },
  late: { status: 'Geç teslim edildi', tone: 'amber' },
  not_submitted: { status: 'Teslim edilmedi', tone: 'red' },
}

/** Özetteki `blockedBy` için neden metni; puanlamadan bağımsız (DOM-BEC-045). */
export function summaryBlockedReason(
  mode: StudentTaskMode,
  progress: Pick<LearnerTaskProgress, 'blockedBy' | 'used'>,
  speaking = false,
): string | null {
  switch (progress.blockedBy) {
    case null:
    case 'in_progress':
      // Süren deneme yeni deneme açmaz ama sürdürülebilir; engel sayılmaz.
      return null
    case 'content_unavailable':
      return TASK_CONTENT_UNAVAILABLE_MESSAGE
    case 'license_expired':
      return mode === 'auto'
        ? 'İçeriğin kullanım lisansının süresi doldu; yeni deneme başlatılamaz.'
        : 'İçeriğin kullanım lisansının süresi doldu; yeni sürüm gönderilemez.'
    case 'unavailable':
      return 'Görev içeriği şu an kullanılamıyor; öğretmeninize danışın.'
    case 'limit':
      return mode === 'auto' ? 'Deneme hakkınız doldu.' : blockedByMessage('limit', speaking)
    case 'graded':
      return blockedByMessage('graded', speaking)
    case 'locked':
      return mode === 'auto'
        ? 'Teslim süresi doldu; yeni deneme başlatılamaz.'
        : progress.used > 0
          ? blockedByMessage('locked', speaking)
          : 'Teslim süresi doldu.'
    default:
      return progress.blockedBy satisfies never
  }
}

/** Özet eskidi (süre doldu); liste tazelenene kadar gösterilen neden. */
export const LAPSED_REASON = 'Süre doldu; görev durumu güncelleniyor.'

/**
 * Liste satırının durumu: atama görünümünün kursiyer özetinden (`progress`; IST-051), satır başına
 * deneme/teslim okuması yapılmaz. Sunucu özeti okuma anındadır; ekran açıkken teslim süresi dolan
 * başlanmamış görev yerelde "Teslim edilmedi"ye döner; süren denemesi biten ya da yeniden teslim
 * süresi dolan görevde (`actionableUntil` geçti) birincil işlem kalkar (son söz yine sunucunundur). Puan yalnız
 * sunucu açtıysa gelir (DOM-BEC-045). Özet yoksa `null` (satır "Okunamadı" gösterir).
 */
export function summaryProgress(
  assignment: TaskAssignmentLearner,
  now: Date,
  learnerId?: string,
): TaskProgress | null {
  const entry =
    learnerId === undefined
      ? assignment.progress[0]
      : assignment.progress.find((item) => item.learnerId === learnerId)
  if (!entry) return null
  const mode: StudentTaskMode = assignment.scoringMode === 'auto' ? 'auto' : 'teacher'
  const expired = entry.status === 'pending' && taskClosed(assignment, now)
  // Süren deneme bitti ya da yeni deneme/sürüm penceresi kapandı: liste yeniden okunana kadar
  // birincil işlem gösterilmez (`actionableUntil`; kanca o an listeyi tazeler).
  const lapsed =
    !expired &&
    entry.actionableUntil !== null &&
    now.getTime() > new Date(entry.actionableUntil).getTime()
  const progress: LearnerTaskProgress = expired
    ? { ...entry, status: 'not_submitted', canAct: false, blockedBy: 'locked' }
    : entry
  const speaking = isSpeakingTask(assignment)
  const unit = mode === 'auto' || speaking ? 'deneme' : 'sürüm'
  const rights =
    progress.limit === null
      ? mode === 'auto'
        ? 'Sınırsız'
        : '—'
      : `${progress.used} / ${progress.limit} ${unit}`
  const shown =
    mode === 'teacher' && progress.resubmissionRequested
      ? { status: 'Yeniden teslim istendi', tone: 'amber' as const }
      : (mode === 'auto' ? AUTO_STATUS : WRITING_STATUS)[progress.status]
  const canAct = !lapsed && (progress.canAct || progress.blockedBy === 'in_progress')
  return {
    ...shown,
    rights,
    score: progress.status === 'in_progress' ? '—' : scoreLabel(progress.score?.percent),
    canAct,
    blockedReason: lapsed
      ? LAPSED_REASON
      : progress.canAct
        ? null
        : summaryBlockedReason(mode, progress, speaking),
  }
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
}

/** Satırın özeti yok (sunucu kursiyer özetini döndürmedi); diğer satırlar etkilenmez. */
export const FAILED: TaskProgress = {
  status: 'Okunamadı',
  tone: 'red',
  rights: '—',
  score: '—',
  canAct: false,
  blockedReason: 'Bu görevin durumu okunamadı; listeyi yenileyip yeniden deneyin.',
}

export function studentTaskRow(
  assignment: TaskAssignmentLearner,
  progress: TaskProgress | null,
): StudentTaskRow {
  const shown = progress ?? FAILED
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
  }
}

// --- Yazma yönergesi ve taslak ----------------------------------------------------------------

type DraftLike = { body: string; savedAt: string } | null | undefined
type DetailLike =
  | {
      versions: readonly { body: string | null; submittedAt: string }[]
    }
  | null
  | undefined

/**
 * Editörün açılış metni. Taslak yalnız son gönderilen sürümden yeniyse kullanılır: teslimden sonra
 * eski kalan taslak gönderilen metnin üstüne yazılmaz. Taslak yoksa yeniden teslim bekleniyorsa son
 * sürüm, aksi hâlde boş metin.
 */
export function writingInitialBody(
  draft: DraftLike,
  detail: DetailLike,
  resubmissionOpen: boolean,
): string {
  const latest = detail?.versions.at(-1)
  const draftIsNewer =
    draft && (!latest || new Date(draft.savedAt).getTime() > new Date(latest.submittedAt).getTime())
  if (draftIsNewer) return draft.body
  return resubmissionOpen && latest ? (latest.body ?? '') : ''
}

export type LearnerAttribution = NonNullable<
  TaskAssignmentLearnerDetail['content']
>['attributions'][number]

export type WritingBrief = {
  /** Sabitlenen içerik sürümünün öğrenciye dönük yönergesi; yoksa `null`. */
  instructions: string | null
  /** Kaynak gösterimi (DOM-KYN-024); içerik okunamadıysa boş. */
  attributions: readonly LearnerAttribution[]
  /** İçerik gösterilemiyorsa neden (DOM-KYN-021); gösteriliyorsa `null`. */
  notice: string | null
}

const CONTENT_NOTICES: Record<
  NonNullable<TaskAssignmentLearnerDetail['contentUnavailable']>,
  string
> = {
  license_expired: 'Bu içeriğin kullanım lisansının süresi doldu; yönerge artık gösterilemiyor.',
  unavailable: 'Görev içeriği şu an gösterilemiyor; ne yazacağınızı öğretmeninizden öğrenin.',
}

/**
 * Yazma görevinin yönergesi ve kaynak gösterimi: atama ayrıntısı, atamada sabitlenen içerik
 * sürümünün öğrenciye dönük görünümünü taşır (DOM-KYN-024). Değerlendirme ölçütü, cevap anahtarı
 * ve öğretmen notu sunucudan hiç gelmez. Lisansı dolmuş içerik yalnız süren işi olana gösterilir
 * (DOM-KYN-021); gösterilmiyorsa neden açık metinle söylenir.
 */
export function writingBrief(detail: TaskAssignmentLearnerDetail): WritingBrief {
  const content = detail.content
  if (!content)
    return {
      instructions: null,
      attributions: [],
      notice: CONTENT_NOTICES[detail.contentUnavailable ?? 'unavailable'],
    }
  const instructions =
    content.body.type === 'homework_template' ? content.body.instructions.trim() || null : null
  return {
    instructions,
    attributions: content.attributions,
    notice: instructions ? null : 'Bu görev için yazılı yönerge eklenmemiş.',
  }
}

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

/** Atama okuması 404 döndüyse görev yok ya da öğrencinin kapsamında değil (varlığı sızdırılmaz). */
export const isNotFoundError = (error: unknown): boolean =>
  isApiError(error) && error.status === 404

// --- Deneme sonucu (kursiyer, personel, veli) ----------------------------------------------

/** Sonuç ekranına kim bakıyor: kursiyer kendi cevabını, personel ve veli öğrencinin cevabını okur. */
export type ResultAudience = 'learner' | 'staff' | 'parent'

const RESPONSE_LABELS = {
  learner: 'Cevabınız: ',
  staff: 'Öğrencinin cevabı: ',
  parent: 'Çocuğunuzun cevabı: ',
} as const satisfies Record<ResultAudience, string>

/** Madde satırında cevabın önündeki etiket. */
export const responseLabel = (audience: ResultAudience) => RESPONSE_LABELS[audience]

const SUBMITTED_TEXT_LABELS = {
  learner: 'Gönderdiğiniz metni göster',
  staff: 'Gönderilen metni göster',
  parent: 'Çocuğunuzun gönderdiği metni göster',
} as const satisfies Record<ResultAudience, string>

/** Teslim sürümündeki metni açan özet etiketi. */
export const submittedTextLabel = (audience: ResultAudience) => SUBMITTED_TEXT_LABELS[audience]

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
