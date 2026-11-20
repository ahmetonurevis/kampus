import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import type { LessonObservationStatus, ObservationMember } from './finance-lesson-observations.ts'
import type { PerformancePeriodStatus } from './finance-performance.ts'

/**
 * Gözlem sonrası görüşme ve gelişim hedefi (docs/domain/finans.md DOM-FIN-133; ON-209).
 * Tamamlanmış ders gözlemine (DOM-FIN-130) en çok bir görüşme bağlanır: gün, katılanlar (kurum
 * üyeliği; gözlenen öğretmen dahil), güçlü yönler, gelişim alanları ve öğretmenin görüşü. Görüşme
 * taslakken düzeltilir, kesinleşince değişmez (K-454). Gelişim hedefi genel personel gelişim
 * kaydıdır (`staff_development_goals`): öğretmen (üyelik), kaynak (gözlem görüşmesi ya da
 * doğrudan), isteğe bağlı performans dönemi (DOM-FIN-124), hedef, ölçüt, takip tarihi ve durum
 * (açık, sürüyor, ulaşıldı, bırakıldı); her takip notu ve durum değişikliği değişmez geçmiş
 * satırıdır (K-455). Görüşme ve hedef kişisel veridir: yönetici, gözlemci ve ilgili öğretmen görür
 * (K-456). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Görüşme ve hedef yazımı bu turda yalnız yönetici (K-456; öğretmen ekranı ayrı iştir). */
export const OBSERVATION_DEBRIEF_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Okuma: yönetici hepsini; öğretmen yalnız gözlemcisi ya da öğretmeni olduğu kaydı (K-456). */
export const OBSERVATION_DEBRIEF_READ_ROLES = [
  'yonetici',
  'ogretmen',
] as const satisfies readonly Role[]
/** Görüşmeye katılabilecek roller (K-454). */
export const DEBRIEF_PARTICIPANT_ROLES = ['yonetici', 'ogretmen'] as const satisfies readonly Role[]

export const OBSERVATION_DEBRIEF_STATUSES = ['draft', 'finalized'] as const
export type ObservationDebriefStatus = (typeof OBSERVATION_DEBRIEF_STATUSES)[number]
export const OBSERVATION_DEBRIEF_STATUS_LABELS = {
  draft: 'Taslak',
  finalized: 'Kesinleşti',
} as const satisfies Record<ObservationDebriefStatus, string>

export const DEVELOPMENT_GOAL_STATUSES = ['open', 'in_progress', 'achieved', 'dropped'] as const
export type DevelopmentGoalStatus = (typeof DEVELOPMENT_GOAL_STATUSES)[number]
export const DEVELOPMENT_GOAL_STATUS_LABELS = {
  open: 'Açık',
  in_progress: 'Sürüyor',
  achieved: 'Ulaşıldı',
  dropped: 'Bırakıldı',
} as const satisfies Record<DevelopmentGoalStatus, string>
/** Takibi süren durumlar; takip tarihi geçmişse gecikmiş sayılır (K-455). */
export const DEVELOPMENT_GOAL_ACTIVE_STATUSES = [
  'open',
  'in_progress',
] as const satisfies readonly DevelopmentGoalStatus[]

export const DEVELOPMENT_GOAL_SOURCES = ['observation_debrief', 'direct'] as const
export type DevelopmentGoalSource = (typeof DEVELOPMENT_GOAL_SOURCES)[number]
export const DEVELOPMENT_GOAL_SOURCE_LABELS = {
  observation_debrief: 'Gözlem görüşmesi',
  direct: 'Doğrudan',
} as const satisfies Record<DevelopmentGoalSource, string>

export const DEBRIEF_TEXT_MAX = 4000
export const DEBRIEF_PARTICIPANTS_MAX = 10
export const DEVELOPMENT_GOAL_TITLE_MIN = 2
export const DEVELOPMENT_GOAL_TITLE_MAX = 500
export const DEVELOPMENT_GOAL_CRITERION_MIN = 2
export const DEVELOPMENT_GOAL_CRITERION_MAX = 1000
export const DEVELOPMENT_GOAL_NOTE_MIN = 2
export const DEVELOPMENT_GOAL_NOTE_MAX = 1000

// --- Şemalar -------------------------------------------------------------------------------------

const optionalText = (label: string, max: number) =>
  z
    .string(`${label} geçersiz.`)
    .trim()
    .max(max, `${label} en fazla ${max.toLocaleString('tr-TR')} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()

const requiredText = (label: string, min: number, max: number) =>
  z
    .string(`${label} yazın.`)
    .trim()
    .min(min, `${label} en az ${String(min)} karakterle yazın.`)
    .max(max, `${label} en fazla ${max.toLocaleString('tr-TR')} karakter olabilir.`)

const memberIdSchema = (message: string) =>
  z.string(message).trim().min(1, message).max(100, message)

const participantsSchema = z
  .array(memberIdSchema('Katılımcı geçersiz.'), 'Katılanları seçin.')
  .min(1, 'Görüşmeye katılanları seçin.')
  .max(DEBRIEF_PARTICIPANTS_MAX, `En çok ${String(DEBRIEF_PARTICIPANTS_MAX)} katılımcı seçilir.`)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Her katılımcı bir kez seçilir.' })
  // kvkk: K (personel üyelikleri)
  .describe('Görüşmeye katılanların kurum üyelikleri (1–10); gözlenen öğretmen dahil')

const debriefFields = {
  debriefDate: daySchema.describe('Görüşme günü; gözlem gününden önce ve bugünden sonra olamaz'),
  participantMembershipIds: participantsSchema,
  // kvkk: K (serbest metin; denetime ve loga yazılmaz)
  strengths: optionalText('Güçlü yönler', DEBRIEF_TEXT_MAX).describe(
    'Güçlü yönler; kesinleştirmek için zorunlu',
  ),
  // kvkk: K (serbest metin; denetime ve loga yazılmaz)
  developmentAreas: optionalText('Gelişim alanları', DEBRIEF_TEXT_MAX).describe(
    'Gelişim alanları; kesinleştirmek için zorunlu',
  ),
  // kvkk: K (serbest metin; denetime ve loga yazılmaz)
  teacherComment: optionalText('Öğretmenin görüşü', DEBRIEF_TEXT_MAX).describe(
    'Öğretmenin görüşü; öğretmen görüş bildirmediyse boş',
  ),
}

/** Yeni görüşme taslağı (K-454): gün ve katılanlar zorunlu, metinler taslakta boş olabilir. */
export const observationDebriefCreateSchema = z.strictObject({
  debriefDate: debriefFields.debriefDate,
  participantMembershipIds: debriefFields.participantMembershipIds,
  strengths: debriefFields.strengths.default(null),
  developmentAreas: debriefFields.developmentAreas.default(null),
  teacherComment: debriefFields.teacherComment.default(null),
})
export type ObservationDebriefCreateInput = z.input<typeof observationDebriefCreateSchema>
export type ObservationDebriefCreateFields = z.output<typeof observationDebriefCreateSchema>

/** Taslak düzeltmesi: yalnız gönderilen alanlar; boş metin siler (K-454). */
export const observationDebriefUpdateSchema = z
  .strictObject({
    debriefDate: debriefFields.debriefDate.optional(),
    participantMembershipIds: debriefFields.participantMembershipIds.optional(),
    strengths: debriefFields.strengths.optional(),
    developmentAreas: debriefFields.developmentAreas.optional(),
    teacherComment: debriefFields.teacherComment.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type ObservationDebriefUpdateInput = z.input<typeof observationDebriefUpdateSchema>
export type ObservationDebriefUpdateFields = z.output<typeof observationDebriefUpdateSchema>

/** Gövdesiz komut (kesinleştirme) boş nesne alır. */
export const observationDebriefFinalizeSchema = z.strictObject({})

const goalTitleSchema = requiredText(
  'Hedefi',
  DEVELOPMENT_GOAL_TITLE_MIN,
  DEVELOPMENT_GOAL_TITLE_MAX,
).describe('Gelişim hedefi (ör. "Ders sonunda kazanım yoklaması yapmak")')
const goalCriterionSchema = requiredText(
  'Ölçütü',
  DEVELOPMENT_GOAL_CRITERION_MIN,
  DEVELOPMENT_GOAL_CRITERION_MAX,
).describe('Hedefe ulaşıldığı neyle anlaşılır')
const goalPeriodSchema = z
  .uuid('Performans dönemi geçersiz.')
  .nullable()
  .describe('İsteğe bağlı performans dönemi (DOM-FIN-124)')

/**
 * Yeni gelişim hedefi (K-455): kaynak gözlem görüşmesiyse `debriefId` (öğretmen gözlemden gelir),
 * doğrudansa `teacherMembershipId`; ikisinden biri, ikisi birden değil.
 */
export const developmentGoalCreateSchema = z
  .strictObject({
    debriefId: z
      .uuid('Görüşme geçersiz.')
      .optional()
      .describe('Kaynak gözlem görüşmesi; verilirse öğretmen gözlemin öğretmenidir'),
    // kvkk: K (öğretmen üyeliği)
    teacherMembershipId: memberIdSchema('Öğretmeni seçin.')
      .optional()
      .describe('Doğrudan hedefte öğretmenin kurum üyeliği'),
    performancePeriodId: goalPeriodSchema.optional(),
    title: goalTitleSchema,
    successCriterion: goalCriterionSchema,
    followUpDate: daySchema.describe('Takip tarihi; bugünden önce olamaz'),
  })
  .refine(
    (value) => (value.debriefId === undefined) !== (value.teacherMembershipId === undefined),
    {
      message: 'Hedefin kaynağını seçin: gözlem görüşmesi ya da öğretmen.',
      path: ['teacherMembershipId'],
    },
  )
export type DevelopmentGoalCreateInput = z.input<typeof developmentGoalCreateSchema>
export type DevelopmentGoalCreateFields = z.output<typeof developmentGoalCreateSchema>

/** Süren hedefin düzeltmesi: yalnız gönderilen alanlar (K-455). */
export const developmentGoalUpdateSchema = z
  .strictObject({
    title: goalTitleSchema.optional(),
    successCriterion: goalCriterionSchema.optional(),
    followUpDate: daySchema.optional().describe('Yeni takip tarihi; bugünden önce olamaz'),
    performancePeriodId: goalPeriodSchema
      .optional()
      .describe('Performans dönemi; `null` bağı kaldırır'),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type DevelopmentGoalUpdateFields = z.output<typeof developmentGoalUpdateSchema>

/** Takip notu (K-455): not zorunlu; isteğe bağlı yeni durum ve sonraki takip tarihi. */
export const developmentGoalFollowUpSchema = z.strictObject({
  // kvkk: K (serbest metin; denetime ve loga yazılmaz)
  note: requiredText('Takip notunu', DEVELOPMENT_GOAL_NOTE_MIN, DEVELOPMENT_GOAL_NOTE_MAX).describe(
    'Takip notu (görüşme, gözlenen ilerleme)',
  ),
  status: z
    .enum(DEVELOPMENT_GOAL_STATUSES, 'Durumu seçin.')
    .optional()
    .describe('Yeni durum; boşsa durum değişmez'),
  nextFollowUpDate: daySchema
    .optional()
    .describe('Sonraki takip tarihi; bugünden önce olamaz, kapanan hedefte verilmez'),
})
export type DevelopmentGoalFollowUpInput = z.input<typeof developmentGoalFollowUpSchema>
export type DevelopmentGoalFollowUpFields = z.output<typeof developmentGoalFollowUpSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string[]) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

/** Katılımcı üyeliği; kurumda yoksa `null`. */
export type DebriefParticipantCheck = ObservationMember | null

export interface DebriefChecks {
  /** Görüşmenin bağlandığı gözlem (öğretmen, gün, durum). */
  observation: {
    status: LessonObservationStatus
    teacherMembershipId: string
    observedDate: string
  }
  /** İstenen katılımcı kimliğine göre üyelik gerçeği. */
  participants: ReadonlyMap<string, DebriefParticipantCheck>
  /** Görüşmede zaten olan katılımcılar; ayrılmış olsalar da kalır. */
  previousParticipants: readonly string[]
  today: string
}

function assertDebriefDate(debriefDate: string, checks: DebriefChecks): void {
  if (debriefDate < checks.observation.observedDate)
    throw ruleError(
      'debrief_date_before_observation',
      'Görüşme günü gözlem gününden önce olamaz.',
      ['debriefDate'],
    )
  if (debriefDate > checks.today)
    throw ruleError('debrief_date_future', 'Görüşme günü bugünden sonra olamaz.', ['debriefDate'])
}

function assertParticipants(ids: readonly string[], checks: DebriefChecks): void {
  const previous = new Set(checks.previousParticipants)
  ids.forEach((id, index) => {
    const path = ['participantMembershipIds', String(index)]
    const member = checks.participants.get(id) ?? null
    if (member === null)
      throw ruleError('debrief_participant_not_found', 'Katılımcı bulunamadı.', path)
    if (!(DEBRIEF_PARTICIPANT_ROLES as readonly string[]).includes(member.role))
      throw ruleError(
        'debrief_participant_invalid',
        'Katılımcı kurumun yöneticisi ya da öğretmeni olmalı.',
        path,
      )
    if (!member.active && !previous.has(id))
      throw ruleError(
        'debrief_participant_inactive',
        'Ayrılan (pasifleştirilmiş) personel görüşmeye eklenmez.',
        path,
      )
  })
  if (!ids.includes(checks.observation.teacherMembershipId))
    throw ruleError(
      'debrief_teacher_missing',
      'Gözlenen öğretmen görüşmeye katılanlar arasında olmalı.',
      ['participantMembershipIds'],
    )
}

/**
 * Yeni görüşme taslağı (K-454). Gözlem tamamlanmış olmalı (taslak gözlemle görüşme yapılmaz);
 * gözlem başına en çok bir görüşme (409 `debrief_exists`). Gün gözlem günü ile bugün arasında;
 * katılanlar kurumun yöneticisi ya da öğretmeni, etkin ve gözlenen öğretmeni içerir.
 */
export function planObservationDebrief(
  input: ObservationDebriefCreateFields,
  checks: DebriefChecks & { exists: boolean },
): void {
  if (checks.observation.status !== 'completed')
    throw ruleError(
      'debrief_observation_not_completed',
      'Görüşme yalnız tamamlanmış gözlem için açılır.',
    )
  if (checks.exists)
    throw conflict('debrief_exists', 'Bu gözlemin görüşmesi zaten açıldı; onu düzenleyin.')
  assertDebriefDate(input.debriefDate, checks)
  assertParticipants(input.participantMembershipIds, checks)
}

const finalizedError = () =>
  conflict('debrief_finalized', 'Görüşme kesinleşti; artık değiştirilemez.')

export interface ObservationDebriefPatch {
  debriefDate?: string
  participantMembershipIds?: string[]
  strengths?: string | null
  developmentAreas?: string | null
  teacherComment?: string | null
}

/**
 * Taslak görüşme düzeltmesi (K-454). Kesinleşen görüşme 409. Gün ve katılanlar değişirse yeniden
 * denetlenir; listede zaten olan ayrılmış personel kalabilir.
 */
export function planObservationDebriefUpdate(
  debrief: { status: ObservationDebriefStatus },
  input: ObservationDebriefUpdateFields,
  checks: DebriefChecks,
): ObservationDebriefPatch {
  if (debrief.status === 'finalized') throw finalizedError()
  const patch: ObservationDebriefPatch = {}
  if (input.debriefDate !== undefined) {
    assertDebriefDate(input.debriefDate, checks)
    patch.debriefDate = input.debriefDate
  }
  if (input.participantMembershipIds !== undefined) {
    assertParticipants(input.participantMembershipIds, checks)
    patch.participantMembershipIds = input.participantMembershipIds
  }
  if (input.strengths !== undefined) patch.strengths = input.strengths
  if (input.developmentAreas !== undefined) patch.developmentAreas = input.developmentAreas
  if (input.teacherComment !== undefined) patch.teacherComment = input.teacherComment
  return patch
}

/**
 * Kesinleştirme (K-454): güçlü yönler (422 `debrief_strengths_required`) ve gelişim alanları
 * (422 `debrief_development_areas_required`) yazılmış olmalı; öğretmenin görüşü isteğe bağlıdır.
 * Kesinleşen görüşme yeniden kesinleşmez ve değişmez (409).
 */
export function planObservationDebriefFinalize(debrief: {
  status: ObservationDebriefStatus
  strengths: string | null
  developmentAreas: string | null
}): void {
  if (debrief.status === 'finalized') throw finalizedError()
  if (debrief.strengths === null)
    throw ruleError(
      'debrief_strengths_required',
      'Görüşmeyi kesinleştirmek için güçlü yönleri yazın.',
      ['strengths'],
    )
  if (debrief.developmentAreas === null)
    throw ruleError(
      'debrief_development_areas_required',
      'Görüşmeyi kesinleştirmek için gelişim alanlarını yazın.',
      ['developmentAreas'],
    )
}

/**
 * Görüşme görünürlüğü (K-456): yönetici hepsini; gözlemci kendi gözleminin görüşmesini (taslak
 * dahil); gözlenen öğretmen yalnız kesinleşmiş görüşmesini görür. Diğer roller görmez.
 */
export function canViewObservationDebrief(
  viewer: { role: string; membershipId: string },
  debrief: {
    teacherMembershipId: string
    observerMembershipId: string
    status: ObservationDebriefStatus
  },
): boolean {
  if (viewer.role === 'yonetici') return true
  if (viewer.role !== 'ogretmen') return false
  if (debrief.observerMembershipId === viewer.membershipId) return true
  return debrief.teacherMembershipId === viewer.membershipId && debrief.status === 'finalized'
}

// --- Gelişim hedefi ------------------------------------------------------------------------------

/** Bağlanan performans dönemi; `undefined` istenmedi, `null` bulunamadı. */
export type GoalPeriodCheck = { status: PerformancePeriodStatus } | null | undefined

function assertGoalPeriod(period: GoalPeriodCheck): void {
  if (period === undefined) return
  if (period === null)
    throw ruleError('development_goal_period_not_found', 'Performans dönemi bulunamadı.', [
      'performancePeriodId',
    ])
  if (period.status === 'closed')
    throw ruleError(
      'development_goal_period_closed',
      'Kapanmış performans dönemine hedef bağlanmaz.',
      ['performancePeriodId'],
    )
}

function assertFollowUpDate(day: string, today: string, field: string): void {
  if (day < today)
    throw ruleError('development_goal_follow_up_past', 'Takip tarihi bugünden önce olamaz.', [
      field,
    ])
}

export interface DevelopmentGoalChecks {
  /** Kaynak görüşme: `undefined` istenmedi (doğrudan), `null` kurumda yok ya da görülemez. */
  debrief: { teacherMembershipId: string } | null | undefined
  /** Hedefin öğretmeni (görüşmeden ya da gövdeden); kurumda yoksa `null`. */
  teacher: ObservationMember | null
  period: GoalPeriodCheck
  today: string
}

export interface PlannedDevelopmentGoal {
  source: DevelopmentGoalSource
  debriefId: string | null
  teacherMembershipId: string
  performancePeriodId: string | null
  title: string
  successCriterion: string
  followUpDate: string
}

/**
 * Yeni gelişim hedefi (K-455). Kaynak görüşmeyse görüşme kurumda olmalı ve öğretmen gözlemin
 * öğretmenidir; doğrudansa öğretmen gövdeden gelir. Öğretmen kurumun etkin öğretmeni, dönem
 * bağlanırsa kapanmamış, takip tarihi bugünden önce değil. Hedef "açık" başlar.
 */
export function planDevelopmentGoal(
  input: DevelopmentGoalCreateFields,
  checks: DevelopmentGoalChecks,
): PlannedDevelopmentGoal {
  if (input.debriefId !== undefined && checks.debrief === null)
    throw ruleError('development_goal_debrief_not_found', 'Gözlem görüşmesi bulunamadı.', [
      'debriefId',
    ])
  const { teacher } = checks
  const teacherPath = [input.debriefId === undefined ? 'teacherMembershipId' : 'debriefId']
  if (teacher === null)
    throw ruleError('development_goal_teacher_not_found', 'Öğretmen bulunamadı.', teacherPath)
  if (teacher.role !== 'ogretmen')
    throw ruleError('development_goal_not_teacher', 'Gelişim hedefi öğretmene açılır.', teacherPath)
  if (!teacher.active)
    throw ruleError(
      'development_goal_teacher_inactive',
      'Ayrılan (pasifleştirilmiş) öğretmene hedef açılmaz.',
      teacherPath,
    )
  assertGoalPeriod(checks.period)
  assertFollowUpDate(input.followUpDate, checks.today, 'followUpDate')
  return {
    source: input.debriefId === undefined ? 'direct' : 'observation_debrief',
    debriefId: input.debriefId ?? null,
    teacherMembershipId: teacher.membershipId,
    performancePeriodId: input.performancePeriodId ?? null,
    title: input.title,
    successCriterion: input.successCriterion,
    followUpDate: input.followUpDate,
  }
}

export const isDevelopmentGoalActive = (status: DevelopmentGoalStatus) =>
  (DEVELOPMENT_GOAL_ACTIVE_STATUSES as readonly string[]).includes(status)

const closedError = () =>
  conflict('development_goal_closed', 'Hedef kapandı (ulaşıldı ya da bırakıldı); değiştirilemez.')

export interface DevelopmentGoalPatch {
  title?: string
  successCriterion?: string
  followUpDate?: string
  performancePeriodId?: string | null
}

/** Süren hedefin düzeltmesi (K-455): kapanan hedef 409; yeni takip tarihi bugünden önce değil. */
export function planDevelopmentGoalUpdate(
  goal: { status: DevelopmentGoalStatus },
  input: DevelopmentGoalUpdateFields,
  checks: { period: GoalPeriodCheck; today: string },
): DevelopmentGoalPatch {
  if (!isDevelopmentGoalActive(goal.status)) throw closedError()
  const patch: DevelopmentGoalPatch = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.successCriterion !== undefined) patch.successCriterion = input.successCriterion
  if (input.followUpDate !== undefined) {
    assertFollowUpDate(input.followUpDate, checks.today, 'followUpDate')
    patch.followUpDate = input.followUpDate
  }
  if (input.performancePeriodId !== undefined) {
    if (input.performancePeriodId !== null) assertGoalPeriod(checks.period)
    patch.performancePeriodId = input.performancePeriodId
  }
  return patch
}

/** İzin verilen durum geçişleri (K-455): açık → sürüyor; ikisinden ulaşıldı ya da bırakıldı. */
const GOAL_TRANSITIONS: Readonly<Record<DevelopmentGoalStatus, readonly DevelopmentGoalStatus[]>> =
  {
    open: ['in_progress', 'achieved', 'dropped'],
    in_progress: ['achieved', 'dropped'],
    achieved: [],
    dropped: [],
  }

export interface PlannedGoalFollowUp {
  note: string
  statusFrom: DevelopmentGoalStatus
  /** Yeni durum; durum değişmiyorsa `null`. */
  statusTo: DevelopmentGoalStatus | null
  /** Yeni takip tarihi; değişmiyorsa `null`. */
  nextFollowUpDate: string | null
}

/**
 * Takip notu (K-455). Kapanan hedefe not yazılmaz (409). Durum yalnız ileri gider (açık → sürüyor
 * → ulaşıldı/bırakıldı; açık doğrudan kapanabilir); geri ya da aynı duruma geçiş 422
 * `development_goal_status_invalid`. Sonraki takip tarihi bugünden önce olamaz ve kapanan hedefe
 * verilmez (422 `development_goal_follow_up_closed`). Not geçmişe değişmez satır olarak yazılır.
 */
export function planDevelopmentGoalFollowUp(
  goal: { status: DevelopmentGoalStatus },
  input: DevelopmentGoalFollowUpFields,
  today: string,
): PlannedGoalFollowUp {
  if (!isDevelopmentGoalActive(goal.status)) throw closedError()
  const target = input.status
  if (target !== undefined && !GOAL_TRANSITIONS[goal.status].includes(target))
    throw ruleError(
      'development_goal_status_invalid',
      `Hedef "${DEVELOPMENT_GOAL_STATUS_LABELS[goal.status]}" durumundan "${DEVELOPMENT_GOAL_STATUS_LABELS[target]}" durumuna geçemez.`,
      ['status'],
    )
  const closing = target !== undefined && !isDevelopmentGoalActive(target)
  if (input.nextFollowUpDate !== undefined) {
    if (closing)
      throw ruleError(
        'development_goal_follow_up_closed',
        'Kapanan hedefe sonraki takip tarihi verilmez.',
        ['nextFollowUpDate'],
      )
    assertFollowUpDate(input.nextFollowUpDate, today, 'nextFollowUpDate')
  }
  return {
    note: input.note,
    statusFrom: goal.status,
    statusTo: target ?? null,
    nextFollowUpDate: input.nextFollowUpDate ?? null,
  }
}

/** Takip tarihi geçmiş süren hedef (K-455): İstanbul gününe göre `followUpDate < today`. */
export function isDevelopmentGoalOverdue(
  goal: { status: DevelopmentGoalStatus; followUpDate: string },
  today: string,
): boolean {
  return isDevelopmentGoalActive(goal.status) && goal.followUpDate < today
}

const DAY_MS = 86_400_000
/** Gecikme günü; gecikmemiş hedefte 0. */
export function developmentGoalOverdueDays(
  goal: { status: DevelopmentGoalStatus; followUpDate: string },
  today: string,
): number {
  if (!isDevelopmentGoalOverdue(goal, today)) return 0
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${goal.followUpDate}T00:00:00Z`)) / DAY_MS,
  )
}

/**
 * Hedef görünürlüğü (K-456): yönetici hepsini; öğretmen kendi hedefini ve gözlemcisi olduğu
 * gözlemin görüşmesinden doğan hedefi görür. Diğer roller görmez.
 */
export function canViewDevelopmentGoal(
  viewer: { role: string; membershipId: string },
  goal: { teacherMembershipId: string; observerMembershipId: string | null },
): boolean {
  if (viewer.role === 'yonetici') return true
  if (viewer.role !== 'ogretmen') return false
  return (
    goal.teacherMembershipId === viewer.membershipId ||
    goal.observerMembershipId === viewer.membershipId
  )
}
