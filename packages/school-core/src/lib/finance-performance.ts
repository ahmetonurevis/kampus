import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Personel performans dönemi (docs/domain/finans.md DOM-FIN-124; ON-211). Yönetici bir dönem açar
 * (ad, başlangıç–bitiş) ve dönemi sırayla planlama → yürürlükte → ara görüşme → değerlendirme →
 * kapandı aşamalarından geçirir (K-427). Her personel için dönemde tek kayıt vardır: hedefler
 * (başlık, ölçüt, ağırlık; ağırlıklar toplamı 100), ara görüşme notu ve günü, dönem sonu hedef
 * puanları (1–5), değerlendiren ve personelin görüşü. Hangi alanın hangi aşamada yazılacağı ve
 * dönem kapanınca kilit K-428'dedir. Personel kaydı ayrı tablo değildir (Oğuzhan'ın üyelik kaydı);
 * kayıt üyeliğe bağlanır. Performans verisi kişiseldir: yalnız yönetici okur ve yazar, her okuma
 * denetime düşer (K-429). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Performans verisini yalnız yönetici okur ve yazar (K-429); personelin kendi ekranı ayrı iştir. */
export const FINANCE_PERFORMANCE_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const PERFORMANCE_PERIOD_STATUSES = [
  'planning',
  'active',
  'interim',
  'evaluation',
  'closed',
] as const
export type PerformancePeriodStatus = (typeof PERFORMANCE_PERIOD_STATUSES)[number]
export const PERFORMANCE_PERIOD_STATUS_LABELS = {
  planning: 'Planlama',
  active: 'Yürürlükte',
  interim: 'Ara görüşme',
  evaluation: 'Değerlendirme',
  closed: 'Kapandı',
} as const satisfies Record<PerformancePeriodStatus, string>

export const PERFORMANCE_NAME_MIN = 2
export const PERFORMANCE_NAME_MAX = 120
export const PERFORMANCE_GOALS_MAX = 10
export const PERFORMANCE_GOAL_TITLE_MIN = 2
export const PERFORMANCE_GOAL_TITLE_MAX = 200
export const PERFORMANCE_GOAL_CRITERION_MIN = 2
export const PERFORMANCE_GOAL_CRITERION_MAX = 500
export const PERFORMANCE_WEIGHT_TOTAL = 100
export const PERFORMANCE_SCORE_MIN = 1
export const PERFORMANCE_SCORE_MAX = 5
export const PERFORMANCE_NOTE_MAX = 2000

/** Aşama sırası: dönem yalnız bir sonraki aşamaya geçer, geri dönmez; kapandı son aşamadır. */
export function nextPerformanceStatus(
  status: PerformancePeriodStatus,
): PerformancePeriodStatus | null {
  const index = PERFORMANCE_PERIOD_STATUSES.indexOf(status)
  return PERFORMANCE_PERIOD_STATUSES[index + 1] ?? null
}

/** Hedefler planlama, yürürlük ve ara görüşmede yazılır (K-428). */
export const PERFORMANCE_GOAL_STATUSES = [
  'planning',
  'active',
  'interim',
] as const satisfies readonly PerformancePeriodStatus[]
/** Ara görüşme notu ve günü ara görüşme ve değerlendirmede yazılır (K-428). */
export const PERFORMANCE_INTERIM_STATUSES = [
  'interim',
  'evaluation',
] as const satisfies readonly PerformancePeriodStatus[]
/** Yeni personel kaydı planlama ve yürürlükte açılır (K-428). */
export const PERFORMANCE_ENROLL_STATUSES = [
  'planning',
  'active',
] as const satisfies readonly PerformancePeriodStatus[]

const within = (list: readonly PerformancePeriodStatus[], status: PerformancePeriodStatus) =>
  list.includes(status)

// --- Puan ----------------------------------------------------------------------------------------

export interface PerformanceGoal {
  title: string
  criterion: string
  weight: number
  score: number | null
}

/**
 * Genel puan: hedef puanlarının ağırlıklı ortalaması, iki ondalığa yuvarlanır (K-428). Puanı
 * girilmemiş hedef varsa ya da hedef yoksa `null`; ağırlıklar toplamı 100 olmasa da ağırlık
 * toplamına bölünür.
 */
export function performanceOverallScore(
  goals: readonly { weight: number; score: number | null }[],
): number | null {
  if (goals.length === 0) return null
  let weighted = 0
  let total = 0
  for (const goal of goals) {
    if (goal.score === null) return null
    weighted += goal.weight * goal.score
    total += goal.weight
  }
  if (total <= 0) return null
  return Math.round((weighted * 100) / total) / 100
}

/** Bütün hedeflerin puanı girilmiş mi (dönem kapanışının ön şartı; K-427). */
export const isPerformanceScored = (goals: readonly { score: number | null }[]) =>
  goals.length > 0 && goals.every((goal) => goal.score !== null)

// --- Şemalar -------------------------------------------------------------------------------------

const optionalNote = (label: string) =>
  z
    .string(`${label} geçersiz.`)
    .trim()
    .max(
      PERFORMANCE_NOTE_MAX,
      `${label} en fazla ${String(PERFORMANCE_NOTE_MAX)} karakter olabilir.`,
    )
    .transform((value) => (value === '' ? null : value))
    .nullable()

export const performancePeriodInputSchema = z
  .strictObject({
    name: z
      .string('Dönem adını yazın.')
      .trim()
      .min(PERFORMANCE_NAME_MIN, 'Dönem adını en az 2 karakterle yazın.')
      .max(
        PERFORMANCE_NAME_MAX,
        `Dönem adı en fazla ${String(PERFORMANCE_NAME_MAX)} karakter olabilir.`,
      )
      .describe('Dönem adı (ör. "2026–2027 güz dönemi")'),
    startDate: daySchema.describe('Dönemin ilk günü'),
    endDate: daySchema.describe('Dönemin son günü (dahil)'),
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate)
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıç gününden önce olamaz.',
      })
  })
export type PerformancePeriodInput = z.input<typeof performancePeriodInputSchema>
export type PerformancePeriodFields = z.output<typeof performancePeriodInputSchema>

export const performancePeriodStatusSchema = z.strictObject({
  status: z
    .enum(PERFORMANCE_PERIOD_STATUSES, 'Aşamayı seçin.')
    .describe('Geçilecek aşama; yalnız bir sonraki aşama kabul edilir (K-427)'),
})

const goalSchema = z.strictObject({
  title: z
    .string('Hedef başlığını yazın.')
    .trim()
    .min(PERFORMANCE_GOAL_TITLE_MIN, 'Hedef başlığını en az 2 karakterle yazın.')
    .max(
      PERFORMANCE_GOAL_TITLE_MAX,
      `Hedef başlığı en fazla ${String(PERFORMANCE_GOAL_TITLE_MAX)} karakter olabilir.`,
    )
    .describe('Hedefin kısa adı'),
  criterion: z
    .string('Ölçütü yazın.')
    .trim()
    .min(PERFORMANCE_GOAL_CRITERION_MIN, 'Ölçütü en az 2 karakterle yazın.')
    .max(
      PERFORMANCE_GOAL_CRITERION_MAX,
      `Ölçüt en fazla ${String(PERFORMANCE_GOAL_CRITERION_MAX)} karakter olabilir.`,
    )
    .describe('Başarının nasıl ölçüleceği'),
  weight: z
    .number('Ağırlığı girin.')
    .int('Ağırlık tam sayı olmalı.')
    .min(1, 'Ağırlık en az %1 olmalı.')
    .max(PERFORMANCE_WEIGHT_TOTAL, 'Ağırlık en çok %100 olabilir.')
    .describe('Hedefin ağırlığı, yüzde; hedeflerin toplamı 100'),
})

/** Hedef listesi: 1–10 hedef, ağırlıklar toplamı tam 100 (K-428). */
export const performanceGoalsSchema = z
  .array(goalSchema, 'Hedefleri girin.')
  .min(1, 'En az bir hedef girin.')
  .max(PERFORMANCE_GOALS_MAX, `En çok ${String(PERFORMANCE_GOALS_MAX)} hedef girilebilir.`)
  .superRefine((goals, ctx) => {
    const total = goals.reduce((sum, goal) => sum + goal.weight, 0)
    if (total !== PERFORMANCE_WEIGHT_TOTAL)
      ctx.addIssue({
        code: 'custom',
        message: `Hedef ağırlıklarının toplamı %100 olmalı (şu an %${String(total)}).`,
      })
  })
  .describe('Hedefler (başlık, ölçüt, ağırlık %); toplam ağırlık 100')

export const performanceReviewCreateSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .describe('Değerlendirilecek personelin kurum üyeliği'),
  goals: performanceGoalsSchema,
})
export type PerformanceReviewCreateInput = z.input<typeof performanceReviewCreateSchema>
export type PerformanceReviewCreateFields = z.output<typeof performanceReviewCreateSchema>

/** Kısmi düzeltme: yalnız gönderilen alanlar yazılır; en az bir alan (K-428). */
export const performanceReviewUpdateSchema = z
  .strictObject({
    goals: performanceGoalsSchema.optional(),
    // kvkk: K (serbest metin; denetime yazılmaz)
    interimNote: optionalNote('Ara görüşme notu')
      .optional()
      .describe('Ara görüşme notu; boş metin notu siler'),
    interimDate: daySchema
      .nullable()
      .optional()
      .describe('Ara görüşmenin yapıldığı gün; dönem içinde, bugünden sonra olamaz'),
    scores: z
      .array(
        z
          .number('Puan geçersiz.')
          .int('Puan tam sayı olmalı.')
          .min(PERFORMANCE_SCORE_MIN, 'Puan en az 1 olabilir.')
          .max(PERFORMANCE_SCORE_MAX, 'Puan en çok 5 olabilir.')
          .nullable(),
        'Puanlar geçersiz.',
      )
      .max(PERFORMANCE_GOALS_MAX, 'Puanlar geçersiz.')
      .optional()
      .describe('Hedef sırasıyla dönem sonu puanları (1–5; boş = girilmedi)'),
    // kvkk: K (serbest metin; denetime yazılmaz)
    staffComment: optionalNote('Personel görüşü')
      .optional()
      .describe('Personelin değerlendirmeye görüşü; yönetici personel adına girer (K-428)'),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type PerformanceReviewUpdateInput = z.input<typeof performanceReviewUpdateSchema>
export type PerformanceReviewUpdateFields = z.output<typeof performanceReviewUpdateSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

const closedError = () =>
  conflict('performance_period_closed', 'Dönem kapandı; kayıtlar artık değiştirilemez.')

/**
 * Aşama geçişi (K-427): yalnız bir sonraki aşamaya; kapanmış dönem değişmez. Kapanış için her
 * kaydın bütün hedefleri puanlanmış olmalı (`unscoredCount` 0).
 */
export function planPerformancePeriodStatus(
  period: { status: PerformancePeriodStatus },
  input: unknown,
  checks: { unscoredCount: number },
): PerformancePeriodStatus {
  const { status } = performancePeriodStatusSchema.parse(input)
  if (period.status === 'closed') throw closedError()
  const next = nextPerformanceStatus(period.status)
  if (status !== next)
    throw conflict(
      'performance_status_invalid',
      `Dönem ${PERFORMANCE_PERIOD_STATUS_LABELS[period.status]} aşamasından yalnız ${next === null ? '—' : PERFORMANCE_PERIOD_STATUS_LABELS[next]} aşamasına geçebilir.`,
    )
  if (status === 'closed' && checks.unscoredCount > 0)
    throw ruleError(
      'performance_period_unscored',
      `Puanı eksik ${String(checks.unscoredCount)} kayıt var; dönem bütün hedefler puanlanınca kapanır.`,
      'status',
    )
  return status
}

/** Servisin kurum kilidi altında yüklediği gerçekler (yeni kayıt). */
export interface PerformanceReviewChecks {
  period: { status: PerformancePeriodStatus }
  /** Üyelik: kurumda yoksa `null`; `active` pasifleştirilmemiş demektir. */
  staff: { userId: string; role: string; active: boolean } | null
  /** Bu personelin dönemde kaydı var mı. */
  duplicate: boolean
  actorUserId: string
}

/**
 * Yeni personel kaydı (K-428): dönem planlama ya da yürürlükteyken; personel kurumun etkin
 * yönetici, öğretmen ya da ön büro üyeliğidir; dönemde personel başına tek kayıt; yönetici kendi
 * kaydını açmaz (değerlendiren ile değerlendirilen ayrı kişidir).
 */
export function planPerformanceReview(
  input: PerformanceReviewCreateFields,
  checks: PerformanceReviewChecks,
): PerformanceGoal[] {
  const { period, staff } = checks
  if (period.status === 'closed') throw closedError()
  if (!within(PERFORMANCE_ENROLL_STATUSES, period.status))
    throw conflict(
      'performance_enroll_closed',
      'Personel yalnız planlama ve yürürlük aşamasında döneme eklenir.',
    )
  if (staff === null)
    throw ruleError('performance_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(staff.role))
    throw ruleError(
      'performance_not_staff',
      'Performans kaydı yalnız personele (yönetici, öğretmen, ön büro) açılır.',
      'membershipId',
    )
  if (!staff.active)
    throw ruleError(
      'performance_staff_inactive',
      'Ayrılan (pasifleştirilmiş) personele performans kaydı açılmaz.',
      'membershipId',
    )
  if (staff.userId === checks.actorUserId)
    throw ruleError(
      'performance_self_review',
      'Kendi performans kaydınızı açamazsınız; başka bir yönetici açar.',
      'membershipId',
    )
  if (checks.duplicate)
    throw conflict('performance_review_exists', 'Bu personelin bu dönemde zaten kaydı var.')
  return input.goals.map((goal) => ({ ...goal, score: null }))
}

/** Kaydın değişen alanları; `undefined` alan yazılmaz. */
export interface PerformanceReviewPatch {
  goals?: PerformanceGoal[]
  interimNote?: string | null
  interimDate?: string | null
  staffComment?: string | null
  /** Puan yazılınca değerlendiren işaretlenir. */
  evaluated?: boolean
}

/**
 * Kayıt düzeltmesi (K-428). Kapanmış dönem kilitlidir (409). Hedefler planlama, yürürlük ve ara
 * görüşmede; ara görüşme notu ve günü ara görüşme ve değerlendirmede; puan ve personel görüşü
 * yalnız değerlendirmede yazılır. Ara görüşme günü dönem içinde ve bugünden sonra değildir. Puan
 * dizisi hedef sayısı kadardır; puan yazan yönetici değerlendiren olur.
 */
export function planPerformanceReviewUpdate(
  review: { goals: readonly PerformanceGoal[] },
  period: { status: PerformancePeriodStatus; startDate: string; endDate: string },
  input: PerformanceReviewUpdateFields,
  today: string,
): PerformanceReviewPatch {
  if (period.status === 'closed') throw closedError()
  const patch: PerformanceReviewPatch = {}
  if (input.goals !== undefined) {
    if (!within(PERFORMANCE_GOAL_STATUSES, period.status))
      throw ruleError(
        'performance_goals_locked',
        'Hedefler değerlendirme aşamasında değiştirilemez.',
        'goals',
      )
    patch.goals = input.goals.map((goal) => ({ ...goal, score: null }))
  }
  if (input.interimNote !== undefined || input.interimDate !== undefined) {
    if (!within(PERFORMANCE_INTERIM_STATUSES, period.status))
      throw ruleError(
        'performance_interim_not_open',
        'Ara görüşme bilgisi ara görüşme ya da değerlendirme aşamasında yazılır.',
        input.interimDate === undefined ? 'interimNote' : 'interimDate',
      )
    if (input.interimDate !== undefined && input.interimDate !== null) {
      if (input.interimDate < period.startDate || input.interimDate > period.endDate)
        throw ruleError(
          'performance_interim_date_outside',
          'Ara görüşme günü dönem içinde olmalı.',
          'interimDate',
        )
      if (input.interimDate > today)
        throw ruleError(
          'performance_interim_date_future',
          'Ara görüşme günü bugünden sonra olamaz.',
          'interimDate',
        )
    }
    if (input.interimNote !== undefined) patch.interimNote = input.interimNote
    if (input.interimDate !== undefined) patch.interimDate = input.interimDate
  }
  if (input.scores !== undefined || input.staffComment !== undefined) {
    if (period.status !== 'evaluation')
      throw ruleError(
        'performance_evaluation_not_open',
        'Puan ve personel görüşü değerlendirme aşamasında yazılır.',
        input.scores === undefined ? 'staffComment' : 'scores',
      )
    if (input.scores !== undefined) {
      const { scores } = input
      if (scores.length !== review.goals.length)
        throw ruleError('performance_scores_mismatch', 'Her hedef için bir puan girin.', 'scores')
      patch.goals = review.goals.map((goal, index) => ({ ...goal, score: scores[index] ?? null }))
      patch.evaluated = true
    }
    if (input.staffComment !== undefined) patch.staffComment = input.staffComment
  }
  return patch
}
