import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { FINANCE_PERFORMANCE_ROLES, type PerformancePeriodStatus } from './finance-performance.ts'
import {
  isSelfEvaluationAnswered,
  SELF_EVALUATION_CHANNEL_LABELS,
  SELF_EVALUATION_CHANNELS,
  SELF_EVALUATION_QUESTIONS_MAX,
  SELF_EVALUATION_REASON_MAX,
  SELF_EVALUATION_REASON_MIN,
  SELF_EVALUATION_SCORE_MAX,
  SELF_EVALUATION_SCORE_MIN,
  SELF_EVALUATION_TEXT_MAX,
  selfEvaluationTemplateInputSchema,
  type SelfEvaluationAnswer,
  type SelfEvaluationChannel,
  type SelfEvaluationQuestion,
} from './finance-self-evaluations.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Çok kaynaklı geri bildirim (docs/domain/finans.md DOM-FIN-134; ON-212). Performans dönemine
 * (`DOM-FIN-124`) bağlı tek bir geri bildirim şablonu vardır: puanlı (1–5) ve açık uçlu sorular;
 * soru biçimi öz değerlendirmeninkidir (`DOM-FIN-131`). Yönetici dönemde performans kaydı olan
 * personele (değerlendirilen) değerlendiren atar: kurumun etkin bir personeli, ilişkisi yönetici ya
 * da meslektaş; kişi kendini değerlendirmez (öz değerlendirme ayrıdır). Bu turda değerlendirenin
 * ekranı yoktur: yönetici kâğıt form ya da e-postayla gelen yanıtı değerlendiren adına girer
 * (K-458). Meslektaş yanıtı anonimdir: tek tek okunmaz; değerlendirilene ve rapora yalnız toplu,
 * dönem değerlendirme aşamasına geçtikten sonra ve en az N meslektaş yanıtı varsa gösterilir (N
 * kurum ayarı, varsayılan 3; K-459). Yönetici yanıtı anonim değildir. Fonksiyonlar saftır.
 */

/** Geri bildirimi yalnız yönetici okur ve yazar (K-459; performans verisiyle aynı, K-429). */
export const FINANCE_STAFF_FEEDBACK_ROLES = FINANCE_PERFORMANCE_ROLES satisfies readonly Role[]

export const STAFF_FEEDBACK_RELATIONS = ['manager', 'peer'] as const
export type StaffFeedbackRelation = (typeof STAFF_FEEDBACK_RELATIONS)[number]
export const STAFF_FEEDBACK_RELATION_LABELS = {
  manager: 'Yönetici',
  peer: 'Meslektaş',
} as const satisfies Record<StaffFeedbackRelation, string>

export const STAFF_FEEDBACK_STATUSES = ['pending', 'submitted'] as const
export type StaffFeedbackStatus = (typeof STAFF_FEEDBACK_STATUSES)[number]
export const STAFF_FEEDBACK_STATUS_LABELS = {
  pending: 'Yanıt bekleniyor',
  submitted: 'Yanıtlandı',
} as const satisfies Record<StaffFeedbackStatus, string>

/** Değerlendiren adına girişte yanıtın geldiği kanal (K-458); öz değerlendirmeyle aynı. */
export const STAFF_FEEDBACK_CHANNELS = SELF_EVALUATION_CHANNELS
export type StaffFeedbackChannel = SelfEvaluationChannel
export const STAFF_FEEDBACK_CHANNEL_LABELS = SELF_EVALUATION_CHANNEL_LABELS

export type StaffFeedbackQuestion = SelfEvaluationQuestion
export type StaffFeedbackAnswer = SelfEvaluationAnswer

export const STAFF_FEEDBACK_QUESTIONS_MAX = SELF_EVALUATION_QUESTIONS_MAX
export const STAFF_FEEDBACK_TEXT_MAX = SELF_EVALUATION_TEXT_MAX
export const STAFF_FEEDBACK_REASON_MIN = SELF_EVALUATION_REASON_MIN
export const STAFF_FEEDBACK_REASON_MAX = SELF_EVALUATION_REASON_MAX

/**
 * Meslektaş anonimlik eşiği (K-459): kurum ayarı 3–10, varsayılan 3. Alt sınır 3'tür: iki
 * yanıtlı ortalamada her meslektaş kendi cevabını çıkarıp ötekinin cevabını bulur.
 */
export const STAFF_FEEDBACK_THRESHOLD_MIN = 3
export const STAFF_FEEDBACK_THRESHOLD_MAX = 10
export const STAFF_FEEDBACK_THRESHOLD_DEFAULT = 3

/** Değerlendiren planlama, yürürlük ve ara görüşmede atanır ve kaldırılır (K-458). */
export const STAFF_FEEDBACK_ASSIGN_STATUSES = [
  'planning',
  'active',
  'interim',
] as const satisfies readonly PerformancePeriodStatus[]
/** Yanıt yürürlük ve ara görüşmede girilir ve geri alınır (K-458). */
export const STAFF_FEEDBACK_OPEN_STATUSES = [
  'active',
  'interim',
] as const satisfies readonly PerformancePeriodStatus[]
/**
 * Meslektaş toplu sonucu değerlendirme aşamasından sonra açılır (K-459): yanıt girişi o anda
 * kapanmıştır; toplu sonuç her yeni yanıtla değişseydi iki görünüm arasındaki fark tek yanıtı
 * ortaya çıkarırdı.
 */
export const STAFF_FEEDBACK_RESULT_STATUSES = [
  'evaluation',
  'closed',
] as const satisfies readonly PerformancePeriodStatus[]

const within = (list: readonly PerformancePeriodStatus[], status: PerformancePeriodStatus) =>
  list.includes(status)

export const isStaffFeedbackOpen = (status: PerformancePeriodStatus) =>
  within(STAFF_FEEDBACK_OPEN_STATUSES, status)
export const isStaffFeedbackAssignable = (status: PerformancePeriodStatus) =>
  within(STAFF_FEEDBACK_ASSIGN_STATUSES, status)
export const isStaffFeedbackResultOpen = (status: PerformancePeriodStatus) =>
  within(STAFF_FEEDBACK_RESULT_STATUSES, status)

// --- Şemalar -------------------------------------------------------------------------------------

/** Şablon: 1–20 soru; soru biçimi öz değerlendirmeninkidir (K-457). */
export const staffFeedbackTemplateInputSchema = selfEvaluationTemplateInputSchema
export type StaffFeedbackTemplateFields = z.output<typeof staffFeedbackTemplateInputSchema>

const membershipField = (label: string, description: string) =>
  z
    .string(`${label} seçin.`)
    .trim()
    .min(1, `${label} seçin.`)
    .max(100, `${label} geçersiz.`)
    .describe(description)

export const staffFeedbackAssignmentCreateSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  subjectMembershipId: membershipField(
    'Değerlendirilen personeli',
    'Değerlendirilen personelin kurum üyeliği; dönemde performans kaydı olmalı',
  ),
  // kvkk: K (personel üyeliği)
  reviewerMembershipId: membershipField(
    'Değerlendireni',
    'Değerlendirenin kurum üyeliği; kurumun etkin personeli, değerlendirilenden başka kişi',
  ),
  relation: z
    .enum(STAFF_FEEDBACK_RELATIONS, 'İlişki türünü seçin.')
    .describe('`manager` yönetici (anonim değil), `peer` meslektaş (anonim; K-459)'),
})
export type StaffFeedbackAssignmentCreateInput = z.input<typeof staffFeedbackAssignmentCreateSchema>
export type StaffFeedbackAssignmentCreateFields = z.output<
  typeof staffFeedbackAssignmentCreateSchema
>

const answerSchema = z.strictObject({
  score: z
    .number('Puan geçersiz.')
    .int('Puan tam sayı olmalı.')
    .min(SELF_EVALUATION_SCORE_MIN, 'Puan en az 1 olabilir.')
    .max(SELF_EVALUATION_SCORE_MAX, 'Puan en çok 5 olabilir.')
    .nullable()
    .optional()
    .describe('Puanlı soru için 1–5; boş = cevaplanmadı'),
  // kvkk: K (serbest metin; denetime ve loga yazılmaz)
  text: z
    .string('Cevap geçersiz.')
    .trim()
    .max(
      STAFF_FEEDBACK_TEXT_MAX,
      `Cevap en fazla ${String(STAFF_FEEDBACK_TEXT_MAX)} karakter olabilir.`,
    )
    .nullable()
    .optional()
    .describe('Açık uçlu soru için cevap; boş = cevaplanmadı'),
})

/** Yanıt girişi (K-458): kanal ve soru sırasıyla cevaplar; giriş yanıtı gönderir. */
export const staffFeedbackResponseSchema = z.strictObject({
  channel: z
    .enum(STAFF_FEEDBACK_CHANNELS, 'Yanıtın geldiği kanalı seçin.')
    .describe('Yanıtın geldiği kanal: `paper` kâğıt form, `email` e-posta (K-458)'),
  answers: z
    .array(answerSchema, 'Cevapları girin.')
    .max(STAFF_FEEDBACK_QUESTIONS_MAX, 'Cevaplar geçersiz.')
    .describe('Soru sırasıyla cevaplar; dizi soru sayısı kadardır'),
})
export type StaffFeedbackResponseInput = z.input<typeof staffFeedbackResponseSchema>
export type StaffFeedbackResponseFields = z.output<typeof staffFeedbackResponseSchema>

export const staffFeedbackWithdrawSchema = z.strictObject({
  // kvkk: K (serbest metin; denetime ve loga yazılmaz)
  reason: z
    .string('Geri alma gerekçesini yazın.')
    .trim()
    .min(STAFF_FEEDBACK_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      STAFF_FEEDBACK_REASON_MAX,
      `Gerekçe en fazla ${String(STAFF_FEEDBACK_REASON_MAX)} karakter olabilir.`,
    )
    .describe('Girilmiş yanıtın neden geri alındığı (zorunlu, K-458)'),
})

export const staffFeedbackSettingsSchema = z.strictObject({
  peerAnonymityThreshold: z
    .number('Eşiği girin.')
    .int('Eşik tam sayı olmalı.')
    .min(STAFF_FEEDBACK_THRESHOLD_MIN, 'Eşik en az 3 olabilir.')
    .max(STAFF_FEEDBACK_THRESHOLD_MAX, 'Eşik en çok 10 olabilir.')
    .describe('Meslektaş sonucunun gösterilmesi için gereken en az yanıt (3–10; K-459)'),
})
export type StaffFeedbackSettings = z.output<typeof staffFeedbackSettingsSchema>

export const DEFAULT_STAFF_FEEDBACK_SETTINGS: StaffFeedbackSettings = {
  peerAnonymityThreshold: STAFF_FEEDBACK_THRESHOLD_DEFAULT,
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

const closedError = () =>
  conflict(
    'performance_period_closed',
    'Dönem kapandı; geri bildirim şablonu, atamalar ve yanıtlar artık değiştirilemez.',
  )

/** Şablon açma (K-457): dönem kapanmamış olmalı; dönemde tek şablon. */
export function planStaffFeedbackTemplate(
  period: { status: PerformancePeriodStatus },
  input: StaffFeedbackTemplateFields,
  checks: { exists: boolean },
): StaffFeedbackQuestion[] {
  if (period.status === 'closed') throw closedError()
  if (checks.exists)
    throw conflict('staff_feedback_template_exists', 'Bu dönemin geri bildirim şablonu var.')
  return input.questions
}

/** Şablon düzeltme (K-457): kapanmamış dönemde, dönemde hiç yanıt girilmemişken. */
export function planStaffFeedbackTemplateUpdate(
  period: { status: PerformancePeriodStatus },
  input: StaffFeedbackTemplateFields,
  checks: { responseCount: number },
): StaffFeedbackQuestion[] {
  if (period.status === 'closed') throw closedError()
  if (checks.responseCount > 0)
    throw conflict(
      'staff_feedback_template_in_use',
      `Bu şablonla ${String(checks.responseCount)} yanıt girildi; sorular artık değiştirilemez.`,
    )
  return input.questions
}

/** Servisin kurum kilidi altında yüklediği gerçekler (yeni atama). */
export interface StaffFeedbackAssignmentChecks {
  period: { status: PerformancePeriodStatus }
  /** Değerlendirilenin dönemde performans kaydı var mı. */
  enrolled: boolean
  /** Değerlendirenin üyeliği: kurumda yoksa `null`; `active` pasifleştirilmemiş demektir. */
  reviewer: { role: string; active: boolean } | null
  /** Aynı değerlendirilen × değerlendiren dönemde atanmış mı. */
  duplicate: boolean
}

/**
 * Değerlendiren ataması (K-458): dönem planlama, yürürlük ya da ara görüşmede; değerlendirilen
 * dönemde performans kaydı olan personel; değerlendiren kurumun etkin personeli (yönetici,
 * öğretmen, ön büro) ve değerlendirilenden başka kişi (kendini değerlendirme öz değerlendirmedir);
 * dönemde değerlendirilen × değerlendiren tek atama. İlişki türü atamada seçilir.
 */
export function planStaffFeedbackAssignment(
  input: StaffFeedbackAssignmentCreateFields,
  checks: StaffFeedbackAssignmentChecks,
): void {
  const { period, reviewer } = checks
  if (period.status === 'closed') throw closedError()
  if (!isStaffFeedbackAssignable(period.status))
    throw conflict(
      'staff_feedback_assign_closed',
      'Değerlendiren yalnız planlama, yürürlük ve ara görüşme aşamasında atanır.',
    )
  if (input.subjectMembershipId === input.reviewerMembershipId)
    throw ruleError(
      'staff_feedback_self',
      'Kişi kendini değerlendiremez; kendi değerlendirmesi öz değerlendirmedir.',
      'reviewerMembershipId',
    )
  if (!checks.enrolled)
    throw ruleError(
      'staff_feedback_not_enrolled',
      'Geri bildirim yalnız dönemde performans kaydı olan personel için toplanır.',
      'subjectMembershipId',
    )
  if (reviewer === null)
    throw ruleError(
      'staff_feedback_reviewer_not_found',
      'Değerlendiren bulunamadı.',
      'reviewerMembershipId',
    )
  if (!isStaffRole(reviewer.role))
    throw ruleError(
      'staff_feedback_reviewer_not_staff',
      'Değerlendiren kurumun personeli (yönetici, öğretmen, ön büro) olmalı.',
      'reviewerMembershipId',
    )
  if (!reviewer.active)
    throw ruleError(
      'staff_feedback_reviewer_inactive',
      'Ayrılan (pasifleştirilmiş) personel değerlendiren olamaz.',
      'reviewerMembershipId',
    )
  if (checks.duplicate)
    throw conflict(
      'staff_feedback_assignment_exists',
      'Bu değerlendiren bu personel için dönemde zaten atandı.',
    )
}

interface StoredAssignmentState {
  status: StaffFeedbackStatus
}

/** Atamayı kaldırma (K-458): yalnız yanıtı girilmemiş atama, atamaya açık dönemde. */
export function planStaffFeedbackAssignmentRemove(
  assignment: StoredAssignmentState,
  period: { status: PerformancePeriodStatus },
): void {
  if (period.status === 'closed') throw closedError()
  if (!isStaffFeedbackAssignable(period.status))
    throw conflict(
      'staff_feedback_assign_closed',
      'Değerlendiren yalnız planlama, yürürlük ve ara görüşme aşamasında kaldırılır.',
    )
  if (assignment.status !== 'pending')
    throw conflict(
      'staff_feedback_responded',
      'Yanıtı girilmiş atama kaldırılamaz; önce yanıtı gerekçeyle geri alın.',
    )
}

const notOpenError = () =>
  ruleError(
    'staff_feedback_not_open',
    'Geri bildirim yanıtı yürürlük ya da ara görüşme aşamasında girilir ve geri alınır.',
  )

/**
 * Cevapları şablona göre doğrular ve saklanacak biçime getirir: dizi soru sayısı kadardır
 * (422 `staff_feedback_answers_mismatch`); puanlı soruya metin, açık uçluya puan yazılmaz
 * (422 `staff_feedback_answer_kind`). Boş metin cevaplanmamış sayılır.
 */
export function normalizeStaffFeedbackAnswers(
  questions: readonly StaffFeedbackQuestion[],
  answers: readonly { score?: number | null | undefined; text?: string | null | undefined }[],
): StaffFeedbackAnswer[] {
  if (answers.length !== questions.length)
    throw ruleError(
      'staff_feedback_answers_mismatch',
      'Her soru için bir cevap satırı gönderin.',
      'answers',
    )
  return questions.map((question, index) => {
    const answer = answers[index] ?? {}
    const score = answer.score ?? null
    const text =
      answer.text === undefined || answer.text === null || answer.text === '' ? null : answer.text
    if (
      (question.kind === 'scale' && text !== null) ||
      (question.kind === 'open' && score !== null)
    )
      throw ruleError(
        'staff_feedback_answer_kind',
        `${String(index + 1)}. soru ${question.kind === 'scale' ? 'puanlıdır; metin yazılmaz' : 'açık uçludur; puan verilmez'}.`,
        'answers',
      )
    return { score, text }
  })
}

/** Servisin kurum kilidi altında yüklediği gerçekler (yanıt girişi). */
export interface StaffFeedbackResponseChecks {
  period: { status: PerformancePeriodStatus }
  /** Dönemin şablonu; yoksa `null`. */
  questions: readonly StaffFeedbackQuestion[] | null
  /** Değerlendirilenin kullanıcısı: kendisi hakkındaki yanıtı giremez. */
  subjectUserId: string
  actorUserId: string
}

/**
 * Yanıt girişi (K-458): yanıt bekleyen atama, yürürlük ya da ara görüşmedeki dönem, hazır şablon;
 * değerlendirilen yönetici kendisi hakkındaki yanıtı giremez. Bütün zorunlu sorular cevaplı olmalı
 * (422 `staff_feedback_incomplete`); giriş yanıtı gönderir, taslak yoktur.
 */
export function planStaffFeedbackResponse(
  assignment: StoredAssignmentState,
  input: StaffFeedbackResponseFields,
  checks: StaffFeedbackResponseChecks,
): { answers: StaffFeedbackAnswer[]; channel: StaffFeedbackChannel } {
  if (checks.period.status === 'closed') throw closedError()
  if (!isStaffFeedbackOpen(checks.period.status)) throw notOpenError()
  if (assignment.status === 'submitted')
    throw conflict(
      'staff_feedback_already_responded',
      'Bu atamanın yanıtı girildi; değiştirmek için önce gerekçeyle geri alın.',
    )
  if (checks.questions === null)
    throw ruleError(
      'staff_feedback_template_missing',
      'Önce dönemin geri bildirim şablonunu hazırlayın.',
    )
  if (checks.subjectUserId === checks.actorUserId)
    throw ruleError(
      'staff_feedback_subject_entry',
      'Kendinizle ilgili geri bildirim yanıtını giremezsiniz; başka bir yönetici girer.',
    )
  const answers = normalizeStaffFeedbackAnswers(checks.questions, input.answers)
  const missing = checks.questions.filter(
    (question, index) => question.required && !isSelfEvaluationAnswered(question, answers[index]),
  ).length
  if (missing > 0)
    throw ruleError(
      'staff_feedback_incomplete',
      `Zorunlu ${String(missing)} soru cevaplanmadı; yanıt bütün zorunlu sorular cevaplanınca girilir.`,
      'answers',
    )
  return { answers, channel: input.channel }
}

/** Yanıtı geri alma (K-458): yalnız girilmiş yanıt, yanıta açık dönem; gerekçe zorunlu. */
export function planStaffFeedbackWithdraw(
  assignment: StoredAssignmentState,
  period: { status: PerformancePeriodStatus },
  input: unknown,
): string {
  const { reason } = staffFeedbackWithdrawSchema.parse(input)
  if (period.status === 'closed') throw closedError()
  if (!isStaffFeedbackOpen(period.status)) throw notOpenError()
  if (assignment.status !== 'submitted')
    throw conflict('staff_feedback_not_responded', 'Yalnız girilmiş yanıt geri alınır.')
  return reason
}

/** Eşik ayarı (K-459): değişiklik yoksa 422 `staff_feedback_settings_unchanged`. */
export function planStaffFeedbackSettings(
  current: StaffFeedbackSettings,
  input: StaffFeedbackSettings,
): StaffFeedbackSettings {
  if (current.peerAnonymityThreshold === input.peerAnonymityThreshold)
    throw ruleError(
      'staff_feedback_settings_unchanged',
      'Eşik zaten bu değerde.',
      'peerAnonymityThreshold',
    )
  return input
}

// --- Takip ---------------------------------------------------------------------------------------

export interface StaffFeedbackProgress {
  assigned: number
  responded: number
  /** Yanıtlanan / atanan, yüzde, bir ondalık; atama yoksa `null`. */
  rate: number | null
}

export interface StaffFeedbackSummary extends StaffFeedbackProgress {
  pending: number
  byRelation: Record<StaffFeedbackRelation, StaffFeedbackProgress>
}

const rateOf = (responded: number, assigned: number) =>
  assigned === 0 ? null : Math.round((responded * 1000) / assigned) / 10

const progressOf = (assigned: number, responded: number): StaffFeedbackProgress => ({
  assigned,
  responded,
  rate: rateOf(responded, assigned),
})

/** Atanan / yanıtlanan oranı, toplam ve ilişki türüne göre (K-458). */
export function multiSourceFeedbackSummary(
  counts: readonly {
    relation: StaffFeedbackRelation
    status: StaffFeedbackStatus
    total: number
  }[],
): StaffFeedbackSummary {
  const of = (relation: StaffFeedbackRelation, status?: StaffFeedbackStatus) =>
    counts
      .filter((row) => row.relation === relation && (status === undefined || row.status === status))
      .reduce((sum, row) => sum + row.total, 0)
  const byRelation = {
    manager: progressOf(of('manager'), of('manager', 'submitted')),
    peer: progressOf(of('peer'), of('peer', 'submitted')),
  }
  const assigned = byRelation.manager.assigned + byRelation.peer.assigned
  const responded = byRelation.manager.responded + byRelation.peer.responded
  return { ...progressOf(assigned, responded), pending: assigned - responded, byRelation }
}

// --- Toplu sonuç ---------------------------------------------------------------------------------

/** Değerlendirilen hakkındaki bir atama: ilişki, durum ve (girildiyse) yanıt. */
export interface StaffFeedbackResultInput {
  relation: StaffFeedbackRelation
  status: StaffFeedbackStatus
  // kvkk: K
  reviewerName: string
  submittedAt: string | null
  // kvkk: K (puan ve serbest metin)
  answers: readonly StaffFeedbackAnswer[] | null
}

export type StaffFeedbackPeerHiddenReason = 'period_open' | 'below_threshold'

export interface StaffFeedbackQuestionResult {
  kind: StaffFeedbackQuestion['kind']
  text: string
  /** Bu soruyu cevaplayan meslektaş sayısı. */
  answered: number
  /** Soru eşiğin altında cevaplandıysa sonucu gizlidir (ortalama ve metin dönmez). */
  hidden: boolean
  /** Puanlı soruda ortalama, iki ondalık; açık uçluda ya da gizliyse `null`. */
  average: number | null
  /** Açık uçlu cevaplar, giriş sırasından bağımsız alfabetik; puanlıda ya da gizliyse boş. */
  texts: string[]
}

export interface StaffFeedbackManagerResponse {
  // kvkk: K
  reviewerName: string
  submittedAt: string | null
  answers: StaffFeedbackAnswer[]
}

export interface StaffFeedbackResult {
  threshold: number
  questions: StaffFeedbackQuestion[]
  /** Yönetici yanıtları anonim değildir: değerlendirenin adıyla tek tek (K-459). */
  manager: StaffFeedbackProgress & { responses: StaffFeedbackManagerResponse[] }
  /** Meslektaş yanıtları yalnız toplu ve eşik üstünde (K-459); tek yanıt hiç dönmez. */
  peer: StaffFeedbackProgress & {
    visible: boolean
    hiddenReason: StaffFeedbackPeerHiddenReason | null
    questions: StaffFeedbackQuestionResult[]
  }
}

const collator = new Intl.Collator('tr', { sensitivity: 'base' })

/**
 * Değerlendirilenin toplu sonucu (K-459). Yönetici yanıtları adıyla döner. Meslektaş yanıtları
 * yalnız dönem değerlendirme ya da kapandı aşamasındaysa (`period_open`) ve en az `threshold`
 * meslektaş yanıtı varsa (`below_threshold`) toplu döner; ayrıca her soru en az `threshold`
 * meslektaşça cevaplanmış olmalı, yoksa o sorunun sonucu gizlidir. Puanlı soruda ortalama, açık
 * uçluda alfabetik sıralı metinler döner; hangi cevabın kimden geldiği hiçbir yerde dönmez.
 * Performans raporu (ON-220) ve değerlendirilenin kendi ekranı da bu sonucu kullanır.
 */
export function multiSourceFeedbackResult(input: {
  periodStatus: PerformancePeriodStatus
  questions: readonly StaffFeedbackQuestion[] | null
  threshold: number
  assignments: readonly StaffFeedbackResultInput[]
}): StaffFeedbackResult {
  const questions = [...(input.questions ?? [])]
  const submitted = (relation: StaffFeedbackRelation) =>
    input.assignments.filter(
      (row) => row.relation === relation && row.status === 'submitted' && row.answers !== null,
    )
  const assigned = (relation: StaffFeedbackRelation) =>
    input.assignments.filter((row) => row.relation === relation).length
  const managers = submitted('manager')
  const peers = submitted('peer')
  const hiddenReason: StaffFeedbackPeerHiddenReason | null = !isStaffFeedbackResultOpen(
    input.periodStatus,
  )
    ? 'period_open'
    : peers.length < input.threshold
      ? 'below_threshold'
      : null
  const peerQuestions =
    hiddenReason !== null
      ? []
      : questions.map((question, index): StaffFeedbackQuestionResult => {
          const answers = peers
            .map((row) => row.answers?.[index])
            .filter((answer) => isSelfEvaluationAnswered(question, answer))
          const hidden = answers.length < input.threshold
          const scores = answers.flatMap((answer) =>
            answer === undefined || answer.score === null ? [] : [answer.score],
          )
          const average =
            hidden || question.kind !== 'scale' || scores.length === 0
              ? null
              : Math.round((scores.reduce((sum, score) => sum + score, 0) * 100) / scores.length) /
                100
          const texts =
            hidden || question.kind !== 'open'
              ? []
              : answers
                  .flatMap((answer) =>
                    answer === undefined || answer.text === null ? [] : [answer.text],
                  )
                  .sort(collator.compare)
          return {
            kind: question.kind,
            text: question.text,
            answered: answers.length,
            hidden,
            average,
            texts,
          }
        })
  return {
    threshold: input.threshold,
    questions,
    manager: {
      ...progressOf(assigned('manager'), managers.length),
      responses: managers.map((row) => ({
        reviewerName: row.reviewerName,
        submittedAt: row.submittedAt,
        answers: [...(row.answers ?? [])],
      })),
    },
    peer: {
      ...progressOf(assigned('peer'), peers.length),
      visible: hiddenReason === null,
      hiddenReason,
      questions: peerQuestions,
    },
  }
}
