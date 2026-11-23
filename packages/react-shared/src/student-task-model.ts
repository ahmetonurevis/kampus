import { isApiError } from '@kampus/api-client/errors.ts'
import { isClosed } from '@kampus/school-core/skills/scoring.ts'
import type { LearnerTaskProgress } from './use-learner-task-progress.ts'
import { isSpeakingTask, taskTypeLabel } from './task-labels.ts'
import {
  TASK_CONTENT_UNAVAILABLE_MESSAGE,
  type TaskAssignmentLearner,
  type TaskAssignmentLearnerDetail,
} from './use-task-assignments.ts'
import type { TaskAttempt } from './use-task-attempts.ts'
import type { TaskSubmission, TaskSubmissionDetail } from './use-task-submissions.ts'

/**
 * Öğrencinin görev ekranlarının saf modeli (IST-051, IST-124; DOM-BEC-040…046), web ve mobil ortak.
 * Durum, hak ve düğme kararları sunucunun döndürdüğü kayıtlardan (deneme, teslim, `allowance`)
 * türetilir; saklanmaz. Puan ve geri bildirim yalnız sunucu açtıysa (`result`, `score` dolu)
 * gösterilir: açılmamış puana dair hiçbir ifade üretilmez (DOM-BEC-045). Web
 * `apps/web-react/src/pages/tasks/student-task-model.ts` bunları yeniden dışa aktarır.
 */

/** Durum rozetinin tonu; web `BadgeTone` ve mobil rozet bu dört tonu tanır. */
export type TaskTone = 'green' | 'amber' | 'red' | 'gray'

export type StudentTaskMode = 'auto' | 'teacher'

/** Kursiyer görünümü mü (liste satırı ya da ayrıntı). */
export const isLearnerAssignment = <T extends { view: string }>(
  item: T,
): item is Extract<T, { view: 'learner' }> => item.view === 'learner'

type SubmissionOf = Partial<Pick<TaskAssignmentLearner, 'submission'>>

export const taskKindLabel = (assignment: Pick<TaskAssignmentLearner, 'kind'>) =>
  assignment.kind === 'evaluation' ? 'Değerlendirme' : 'Alıştırma'

/** Teslim kapandı mı (core `isClosed`, DOM-BEC-044); son tarihsiz görev kapanmaz. */
export const taskClosed = (assignment: Pick<TaskAssignmentLearner, 'deadline'>, now: Date) =>
  isClosed(assignment.deadline, now.toISOString())

export const scoreLabel = (percent: number | null | undefined) =>
  percent === null || percent === undefined ? '—' : `${percent} / 100`

export type TaskProgress = {
  status: string
  tone: TaskTone
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
  tone: TaskTone
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
