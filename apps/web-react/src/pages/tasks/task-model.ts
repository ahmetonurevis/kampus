import { z } from 'zod'
import type {
  TaskAssignment,
  TaskAssignmentBody,
  TaskAssignmentStaff,
} from '@kampus/react-shared/use-task-assignments.ts'
import type { TaskSubmission } from '@kampus/react-shared/use-task-submissions.ts'
import { CONTENT_TYPES } from '@kampus/school-core/content/taxonomy.ts'
import { RESUBMISSION_MAX_DAYS } from '@kampus/school-core/skills/assignment.ts'
import {
  BAND_SCALE,
  BAND_MEANINGS,
  RUBRIC_ASPECTS,
  rubricScoreInputSchema,
} from '@kampus/school-core/skills/rubric.ts'
import {
  ATTEMPT_LIMITS,
  COUNT_POLICIES,
  istanbulLocalToUtc,
  LATE_ACCEPTANCE_MAX_DAYS,
  TASK_KINDS,
} from '@kampus/school-core/skills/scoring.ts'
import { VERSION_LIMITS } from '@kampus/school-core/skills/submission.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/**
 * Öğretmen görev ve puanlama ekranlarının ortak modeli (W22b; ADR 0004 karar 4–7; DOM-BEC-020…023,
 * 040–045; DOM-YTK-028). Kural ve hesap sunucudadır (school-core): toplam, yüzde, hak ve süre
 * kontrolleri burada tekrarlanmaz; yalnız sunum ve istemci tarafı form doğrulaması vardır.
 */

export const NONE: readonly never[] = []

export const SUBMISSION_DATE_OPTIONS = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
} as const satisfies Intl.DateTimeFormatOptions

export const dateTimeLabel = (value: string | null | undefined) =>
  value ? dateLabel(value, SUBMISSION_DATE_OPTIONS) : '—'

// --- Görev türleri -------------------------------------------------------------------------

/** Atanabilen içerik türleri; öğretmen puanlı görev yalnız ödev şablonudur (`scoringModeFor`). */
export const TASK_TYPE_OPTIONS = [
  { value: 'homework_template', label: 'Yazılı ödev (öğretmen puanlar)' },
  { value: 'quiz', label: 'Quiz (otomatik puanlanır)' },
  { value: 'exercise_set', label: 'Alıştırma seti (otomatik puanlanır)' },
  { value: 'question', label: 'Tek soru (otomatik puanlanır)' },
] as const
export type TaskType = (typeof TASK_TYPE_OPTIONS)[number]['value']

export const isTeacherScored = (type: string) => type === 'homework_template'

export const KIND_OPTIONS = (Object.keys(TASK_KINDS) as (keyof typeof TASK_KINDS)[]).map(
  (value) => ({ value, label: TASK_KINDS[value].label }),
)
export const COUNT_POLICY_OPTIONS = (
  Object.keys(COUNT_POLICIES) as (keyof typeof COUNT_POLICIES)[]
).map((value) => ({ value, label: COUNT_POLICIES[value].label }))

const contentTypeLabel = (type: string) =>
  type in CONTENT_TYPES ? CONTENT_TYPES[type as keyof typeof CONTENT_TYPES].label : type

// --- Deneme listesi adresi -----------------------------------------------------------------

/** Panelin deneme listesinin adres öneki; sayfa `dn-sayfa` ile adreste tutulur (OG-994). */
export const ATTEMPT_LIST_PREFIX = 'dn-'
/** Görev paneli kapanınca silinen deneme listesi parametreleri (bir sonraki panele taşınmaz). */
export const ATTEMPT_LIST_PARAMS: readonly string[] = [`${ATTEMPT_LIST_PREFIX}sayfa`]

// --- Atama satırı --------------------------------------------------------------------------

export interface TargetNames {
  className: (id: string) => string
  studentName: (id: string) => string
}

export interface AssignmentRow extends Record<string, unknown> {
  id: string
  title: string
  contentType: string
  kind: string
  scoring: string
  dueAt: string | null
  targets: string
  owner: string
}

export function isStaffAssignment(item: TaskAssignment): item is TaskAssignmentStaff {
  return item.view === 'staff'
}

/** Hedeflerin okunur özeti: sınıf/grup adları, öğrenci hedefleri sayıyla. */
export function targetsLabel(
  targets: TaskAssignmentStaff['targets'],
  names: TargetNames,
  max = 3,
): string {
  const groups = targets
    .filter((target) => target.kind !== 'student')
    .map((t) => names.className(t.id))
  const students = targets.filter((target) => target.kind === 'student')
  const shown = groups.slice(0, max)
  const parts = [shown.join(', ')]
  if (groups.length > max) parts[0] += ` +${groups.length - max}`
  if (students.length > 0) parts.push(`${students.length} öğrenci`)
  return parts.filter(Boolean).join(' · ') || '—'
}

export function assignmentRow(
  item: TaskAssignmentStaff,
  names: TargetNames,
  userId: string,
): AssignmentRow {
  return {
    id: item.id,
    title: item.title,
    contentType: contentTypeLabel(item.contentType),
    kind: TASK_KINDS[item.kind].label,
    scoring: item.scoringMode === 'teacher' ? 'Rubrikle puanlanır' : 'Otomatik puanlanır',
    dueAt: item.deadline.dueAt,
    targets: targetsLabel(item.targets, names),
    owner: item.assignedByUserId === userId ? 'Siz' : 'Başka kullanıcı',
  }
}

/**
 * Görev listesinin kapsam notu. Yönetici kurumun bütün atamalarını görür (OG-993), öğretmen
 * atadıklarını ve sınıflarını hedefleyenleri (DOM-YTK-028); kapsamı sunucu uygular, metin yalnız
 * bilgidir.
 */
export function assignmentScopeNote(role: string): string {
  return role === 'yonetici'
    ? 'Kurumdaki bütün sınıfların görevleri'
    : 'Atadıklarınız ve sınıflarınızı hedefleyenler'
}

/** Atamayı yalnız atayan değiştirir (DOM-YTK-028); yönetici de değiştirebilir. */
export function canChangeAssignment(
  item: Pick<TaskAssignmentStaff, 'assignedByUserId'>,
  userId: string,
  role: string,
): boolean {
  return role === 'yonetici' || item.assignedByUserId === userId
}

// --- Teslim durumu -------------------------------------------------------------------------

const SUBMISSION_STATUS: Record<TaskSubmission['status'], { label: string; tone: BadgeTone }> = {
  pending: { label: 'Teslim bekleniyor', tone: 'amber' },
  submitted: { label: 'Teslim edildi', tone: 'purple' },
  late: { label: 'Geç teslim', tone: 'red' },
  not_submitted: { label: 'Teslim edilmedi', tone: 'gray' },
}
export const submissionStatus = (status: TaskSubmission['status']) => SUBMISSION_STATUS[status]

/** Son sürümün puan durumu: puansız, puanlı (yüzde) ya da kesinleşmemiş. */
export function scoreState(submission: TaskSubmission): { label: string; tone: BadgeTone } {
  const latest = submission.latestVersion
  if (!latest) return { label: 'Teslim yok', tone: 'gray' }
  if (!latest.score) return { label: 'Puan bekliyor', tone: 'amber' }
  return latest.score.settled
    ? { label: `Puanlandı · %${latest.score.percent}`, tone: 'green' }
    : { label: `Kesinleşmedi · %${latest.score.percent}`, tone: 'amber' }
}

/** Puanlanabilir mi: son sürüm var ve henüz puanı yok. */
export const needsScoring = (submission: TaskSubmission) =>
  submission.latestVersion !== null && submission.latestVersion.score === null

// --- Rubrik --------------------------------------------------------------------------------

const ASPECT_LABELS: Record<string, string> = {
  overall: 'Genel',
  ...Object.fromEntries(
    Object.values(RUBRIC_ASPECTS).flatMap((aspects) =>
      Object.entries(aspects).map(([key, value]) => [key, value.label]),
    ),
  ),
}
export const aspectLabel = (aspect: string) => ASPECT_LABELS[aspect] ?? aspect

export const BANDS = Array.from(
  { length: BAND_SCALE.max - BAND_SCALE.min + 1 },
  (_, index) => BAND_SCALE.min + index,
)

/** 0–2 hedefin altındadır; sunucu bu bantta kriter yorumu ister (DOM-BEC-020). */
export const bandNeedsComment = (band: number) => band < BAND_SCALE.target

export const bandMeaningLabel = (meaning: keyof typeof BAND_MEANINGS) =>
  BAND_MEANINGS[meaning].label

// --- Puan formu ----------------------------------------------------------------------------

/**
 * Alan sınırları ve mesajları sunucunun kurallarından (`rubricScoreInputSchema`) türetilir; core
 * değişirse istemci ayrışmaz. Formda bant seçilmemiş (`null`) ve yorum boş (`''`) olabilir.
 */
const scoreCriterionCore = rubricScoreInputSchema.shape.criteria.element.shape

export const scoreFormSchema = z
  .object({
    criteria: z.array(
      z.object({
        criterionId: z.string(),
        band: scoreCriterionCore.band.nullable(),
        comment: scoreCriterionCore.comment.removeDefault().unwrap(),
      }),
    ),
    overallComment: rubricScoreInputSchema.shape.overallComment,
  })
  .superRefine((value, context) => {
    value.criteria.forEach((criterion, index) => {
      if (criterion.band === null) {
        context.addIssue({
          code: 'custom',
          path: ['criteria', index, 'band'],
          message: 'Bu kritere bir bant seçin.',
        })
      } else if (bandNeedsComment(criterion.band) && criterion.comment === '') {
        context.addIssue({
          code: 'custom',
          path: ['criteria', index, 'comment'],
          message: 'Hedefin altındaki banda kısa bir yorum yazın.',
        })
      }
    })
  })
export type ScoreFormValues = z.input<typeof scoreFormSchema>

/** Sunucuya yalnız kriter bantları, yorumlar ve genel yorum gider; toplam sunucuda hesaplanır. */
export function scoreBody(values: ScoreFormValues, versionNumber: number) {
  return {
    versionNumber,
    criteria: values.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      band: criterion.band ?? 0,
      comment: criterion.comment.trim() === '' ? null : criterion.comment.trim(),
    })),
    overallComment: values.overallComment.trim(),
  }
}

/**
 * Teslim eskidiğinde (sürüm çakışması, yeni sürüm, kaybolan sürüm numarası, sürüm zaten puanlandı,
 * yeniden teslim zaten istendi) hata TEK yerde, pencerenin üstündeki uyarıda görünür; toast
 * gösterilmez. Teslim tazelendiği için form yerinde kalabilir ya da puan kartına dönüşebilir;
 * uyarı metni bu güncel duruma göre yazılır (`staleNoticeText`). Teslimin hiç bulunamaması
 * (`not_found`) gibi diğer hatalar toast'ta kalır.
 */
const STALE_NOTICE_CODES = new Set([
  'version_conflict',
  'version_not_latest',
  'submission_version_not_found',
  'rubric_score_exists',
  'resubmission_exists',
])
export const showsStaleNotice = (error: { code: string }) => STALE_NOTICE_CODES.has(error.code)

/** Güncel teslime göre uyarı: puan formu duruyorsa "yeniden kaydedin", kalktıysa nedeni söyler. */
export function staleNoticeText(state: { scored: boolean; resubmissionRequested: boolean }) {
  const head = 'Teslim bu arada değişti ve güncel hâli yüklendi.'
  if (state.resubmissionRequested) return `${head} Bu sürüm için yeniden teslim zaten istendi.`
  if (state.scored) return `${head} Bu sürüm zaten puanlandı; verilen puan sürüm kartındadır.`
  return `${head} Puanı gözden geçirip yeniden kaydedin.`
}

// --- Yeniden teslim isteği -----------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Yeniden teslim son tarihi (`YYYY-AA-GGTSS:dd`, Europe/Istanbul) için istemci denetimi: ileri ve
 * en çok 14 gün sonra (DOM-BEC-040). Son söz sunucudadır (`resubmission_due_invalid`).
 */
export function resubmissionDueError(local: string, now: number): string | null {
  if (local === '') return 'Yeni son teslim tarihini girin.'
  const due = istanbulLocalToUtc(local)
  if (due === null) return 'Geçerli bir tarih ve saat girin.'
  const ms = Date.parse(due)
  if (ms <= now) return 'Yeni son teslim ileri bir tarih olmalı.'
  if (ms > now + RESUBMISSION_MAX_DAYS * DAY_MS) {
    return `Yeniden teslim tarihi önümüzdeki ${RESUBMISSION_MAX_DAYS} gün içinde olmalı.`
  }
  return null
}

/** Varsayılan yeni son teslim: bir hafta sonrasının günü, 23:59 (Istanbul). */
export function defaultResubmissionLocal(now: number): string {
  return `${instantToLocal(new Date(now + 7 * DAY_MS).toISOString()).slice(0, 10)}T23:59`
}
/** Seçilebilecek en erken ve en geç an (`datetime-local` sınırları). */
export const resubmissionMinLocal = (now: number) =>
  instantToLocal(new Date(now + 60_000).toISOString())
export const resubmissionMaxLocal = (now: number) =>
  instantToLocal(new Date(now + RESUBMISSION_MAX_DAYS * DAY_MS).toISOString())

// --- Atama formu ---------------------------------------------------------------------------

const optionalCount = z
  .string()
  .trim()
  .refine((value) => value === '' || /^\d+$/.test(value), 'Sayı girin.')

export const assignmentFormSchema = z
  .object({
    taskType: z.enum(TASK_TYPE_OPTIONS.map((option) => option.value) as [TaskType, ...TaskType[]]),
    resourceId: z.string().min(1, 'Atanacak içeriği seçin.'),
    targets: z.array(z.string()).min(1, 'En az bir sınıf veya grup seçin.'),
    kind: z.enum(['evaluation', 'practice']),
    maxAttempts: z.coerce
      .number<string>()
      .int()
      .min(ATTEMPT_LIMITS.min, `Deneme hakkı en az ${ATTEMPT_LIMITS.min} olmalı.`)
      .max(ATTEMPT_LIMITS.max, `Deneme hakkı en fazla ${ATTEMPT_LIMITS.max} olabilir.`),
    countPolicy: z.enum(['first', 'highest']),
    maxVersions: z.coerce
      .number<string>()
      .int()
      .min(VERSION_LIMITS.min, `Sürüm sınırı en az ${VERSION_LIMITS.min} olmalı.`)
      .max(VERSION_LIMITS.max, `Sürüm sınırı en fazla ${VERSION_LIMITS.max} olabilir.`),
    minWords: optionalCount,
    maxWords: optionalCount,
    rubricVersionId: z.string(),
    /** Dinleme hakkı (DOM-BEC-005); yalnız dinleme kaydına bağlı içerikte gövdeye girer. */
    listeningPlays: z.enum(['1', '2', 'unlimited']),
    dueAt: z.string(),
    lateAcceptanceDays: z.coerce
      .number<string>()
      .int()
      .min(0)
      .max(
        LATE_ACCEPTANCE_MAX_DAYS,
        `Geç kabul en fazla ${LATE_ACCEPTANCE_MAX_DAYS} gün olabilir.`,
      ),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message })
    const teacher = isTeacherScored(value.taskType)
    if (value.dueAt.trim() === '') {
      if (value.kind === 'evaluation') issue('dueAt', 'Değerlendirme görevine son teslim girin.')
    } else if (istanbulLocalToUtc(value.dueAt) === null) {
      issue('dueAt', 'Geçerli bir tarih ve saat girin.')
    }
    if (teacher && value.rubricVersionId === '') issue('rubricVersionId', 'Bir rubrik seçin.')
    if (value.kind === 'evaluation' && !teacher && value.countPolicy === 'highest') {
      if (value.maxAttempts <= 1) {
        issue('countPolicy', '"En yüksek puan" için deneme hakkı 1\'den büyük olmalı.')
      }
    }
    const min = value.minWords === '' ? null : Number(value.minWords)
    const max = value.maxWords === '' ? null : Number(value.maxWords)
    if (min !== null && max !== null && min > max) {
      issue('maxWords', 'Alt sınır üst sınırdan büyük olamaz.')
    }
  })
export type AssignmentFormValues = z.input<typeof assignmentFormSchema>
export type AssignmentFormOutput = z.output<typeof assignmentFormSchema>

export const defaultAssignment: AssignmentFormValues = {
  taskType: 'homework_template',
  resourceId: '',
  targets: [],
  kind: 'evaluation',
  maxAttempts: '1',
  countPolicy: 'first',
  maxVersions: String(VERSION_LIMITS.default),
  minWords: '',
  maxWords: '',
  rubricVersionId: '',
  listeningPlays: '2',
  dueAt: '',
  lateAcceptanceDays: '0',
}

/** Dinleme hakkı seçenekleri (DOM-BEC-005); varsayılan 2, değerlendirmede yaygın sınav uygulaması. */
export const LISTENING_PLAY_OPTIONS = [
  { value: '2', label: '2 dinleme (varsayılan)' },
  { value: '1', label: '1 dinleme' },
  { value: 'unlimited', label: 'Sınırsız' },
] as const satisfies readonly { value: AssignmentFormValues['listeningPlays']; label: string }[]

/**
 * İçerik dinleme kaydına bağlı quiz/alıştırma seti mi (IST-045): yalnız öyleyse hak seçilir ve
 * gönderilir. Kaydı olmayan dinleme görevinde hak gönderilmez; sunucu sınırsız saklar (1 ya da 2
 * gönderilse 422 `listening_plays_unavailable`).
 */
export function hasListeningRecording(content: Record<string, unknown> | null | undefined) {
  if (content?.type !== 'quiz' && content?.type !== 'exercise_set') return false
  return typeof content.listeningVersionId === 'string' && content.listeningVersionId !== ''
}

const LISTENING_PLAYS = { '1': 1, '2': 2, unlimited: null } as const

/**
 * Form değerlerinden API gövdesi. Sunucu kuralları (hak, teslim ayarı, rubrik uyumu) core'dadır;
 * burada yalnız görev türüne uymayan alanlar gövdeye girmez. Dinleme hakkı yalnız dinleme kaydına
 * bağlı içerikte (`listening`) gönderilir; aksi hâlde sunucu sınırsız saklar (DOM-BEC-005).
 */
export function assignmentBody(
  values: AssignmentFormOutput,
  resourceVersionId: string,
  groupKind: 'class' | 'group',
  listening = false,
): TaskAssignmentBody {
  const teacher = isTeacherScored(values.taskType)
  const dueAt = values.dueAt.trim() === '' ? null : istanbulLocalToUtc(values.dueAt)
  const attempts =
    values.kind === 'practice'
      ? ({ kind: 'practice' } as const)
      : teacher
        ? ({ kind: 'evaluation', maxAttempts: 1, countPolicy: 'first' } as const)
        : ({
            kind: 'evaluation',
            maxAttempts: values.maxAttempts,
            countPolicy: values.countPolicy,
          } as const)
  const wordLimit = (text: string) => (text === '' ? null : Number(text))
  return {
    resourceVersionId,
    targets: values.targets.map((id) => ({ kind: groupKind, id })),
    settings: {
      attempts,
      deadline: { dueAt, lateAcceptanceDays: values.lateAcceptanceDays },
      ...(listening && !teacher ? { listeningPlays: LISTENING_PLAYS[values.listeningPlays] } : {}),
      ...(teacher
        ? {
            submission: {
              submissionKind: 'text' as const,
              maxVersions: values.maxVersions,
              minWords: wordLimit(values.minWords),
              maxWords: wordLimit(values.maxWords),
            },
            rubricVersionId: values.rubricVersionId,
          }
        : {}),
    },
  } satisfies TaskAssignmentBody
}

/** Sunucu hata yolunu form alanına çevirir; bilinmeyen yol form düzeyi hatadır. */
export function formFieldFor(path: string): string {
  const [first, second, third] = path.split('.')
  if (first === 'resourceVersionId') return 'resourceId'
  if (first === 'targets') return 'targets'
  if (first !== 'settings') return 'root.server'
  if (second === 'deadline') return third === 'dueAt' ? 'dueAt' : 'lateAcceptanceDays'
  if (second === 'rubricVersionId') return 'rubricVersionId'
  if (second === 'listeningPlays') return 'listeningPlays'
  if (second === 'submission') {
    if (third === 'minWords') return 'minWords'
    if (third === 'maxWords') return 'maxWords'
    return 'maxVersions'
  }
  if (second === 'attempts') return third === 'countPolicy' ? 'countPolicy' : 'maxAttempts'
  return 'root.server'
}

// --- Son teslim formu ----------------------------------------------------------------------

/** UTC ISO → `datetime-local` (Europe/Istanbul duvar saati). */
export function instantToLocal(value: string | null): string {
  if (value === null) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(value))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export const deadlineFormSchema = z.object({
  dueAt: z
    .string()
    .min(1, 'Yeni son teslim tarihini girin.')
    .refine((value) => istanbulLocalToUtc(value) !== null, 'Geçerli bir tarih ve saat girin.'),
  lateAcceptanceDays: z.coerce
    .number<string>()
    .int()
    .min(0)
    .max(LATE_ACCEPTANCE_MAX_DAYS, `Geç kabul en fazla ${LATE_ACCEPTANCE_MAX_DAYS} gün olabilir.`),
})
export type DeadlineFormValues = z.input<typeof deadlineFormSchema>
export type DeadlineFormOutput = z.output<typeof deadlineFormSchema>
