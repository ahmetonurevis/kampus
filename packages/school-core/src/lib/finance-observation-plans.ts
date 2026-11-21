import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import {
  assertObservationPeople,
  assertObservationRecords,
  type ObservationMember,
  type ObservationPeriodCheck,
} from './finance-lesson-observations.ts'

/**
 * Ders gözlem planı (docs/domain/finans.md DOM-FIN-139; ON-207). Yönetici gözlemleri önceden
 * planlar: öğretmen × gözlemci (kurum üyeliği; aynı kişi olamaz), gün ve saat (Europe/Istanbul
 * duvar saati; ders programına bağlı değildir, saat elle girilir), süre, gözlem formu sürümü,
 * isteğe bağlı sınıf, ders ve performans dönemi. Durum planlandı → (ertelendi) → gerçekleşti ya da
 * iptal; erteleme ve iptal gerekçe ister (K-472). Gözlemcinin ve gözlenenin aynı saatte başka
 * planı olamaz, öğretmen başına dönemde en çok `OBSERVATION_PLANS_PER_PERIOD_MAX` plan açılır,
 * geçmiş güne plan açılmaz (K-472). Plan günü gelince gözlem taslağı plandan açılır (DOM-FIN-130),
 * gözlem tamamlanınca plan gerçekleşir (K-473). Öğretmene bildirim gönderilecek kayıt olarak
 * tutulur (K-474). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Plan yazımı yalnız yönetici (K-474). */
export const OBSERVATION_PLAN_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Plan okuması: yönetici hepsini, öğretmen gözlemcisi ya da gözleneni olduğu planı (K-474). */
export const OBSERVATION_PLAN_READ_ROLES = [
  'yonetici',
  'ogretmen',
] as const satisfies readonly Role[]

export const OBSERVATION_PLAN_STATUSES = ['planned', 'postponed', 'done', 'cancelled'] as const
export type ObservationPlanStatus = (typeof OBSERVATION_PLAN_STATUSES)[number]
export const OBSERVATION_PLAN_STATUS_LABELS = {
  planned: 'Planlandı',
  postponed: 'Ertelendi',
  done: 'Gerçekleşti',
  cancelled: 'İptal',
} as const satisfies Record<ObservationPlanStatus, string>
/** Açık plan: henüz gerçekleşmemiş ve iptal edilmemiş (düzeltilir, ertelenir, başlatılır). */
export const OPEN_OBSERVATION_PLAN_STATUSES = [
  'planned',
  'postponed',
] as const satisfies readonly ObservationPlanStatus[]

/** Öğretmene giden bildirimin konusu (K-474). */
export const OBSERVATION_PLAN_NOTICE_KINDS = [
  'scheduled',
  'changed',
  'postponed',
  'cancelled',
] as const
export type ObservationPlanNoticeKind = (typeof OBSERVATION_PLAN_NOTICE_KINDS)[number]
export const OBSERVATION_PLAN_NOTICE_KIND_LABELS = {
  scheduled: 'Gözlem planlandı',
  changed: 'Plan değişti',
  postponed: 'Gözlem ertelendi',
  cancelled: 'Gözlem iptal edildi',
} as const satisfies Record<ObservationPlanNoticeKind, string>
/**
 * Bildirim durumu: bugün yalnız `pending` (gönderilecek). Personele giden bildirim kanalı yoktur
 * (bildirim merkezi öğrenci/veli kitlelidir); kanal gelince `sent` ve `failed` eklenir (K-474).
 */
export const OBSERVATION_PLAN_NOTICE_STATUSES = ['pending'] as const
export type ObservationPlanNoticeStatus = (typeof OBSERVATION_PLAN_NOTICE_STATUSES)[number]
export const OBSERVATION_PLAN_NOTICE_STATUS_LABELS = {
  pending: 'Gönderilecek',
} as const satisfies Record<ObservationPlanNoticeStatus, string>

/** Öğretmen başına bir performans döneminde en çok bu kadar plan (iptal sayılmaz; K-472). */
export const OBSERVATION_PLANS_PER_PERIOD_MAX = 3
export const OBSERVATION_PLAN_DURATION_MIN = 10
export const OBSERVATION_PLAN_DURATION_MAX = 240
/** Varsayılan süre bir ders saatidir. */
export const OBSERVATION_PLAN_DURATION_DEFAULT = 40
export const OBSERVATION_PLAN_REASON_MIN = 3
export const OBSERVATION_PLAN_REASON_MAX = 500
export const OBSERVATION_PLAN_NOTE_MAX = 1000
const MINUTES_PER_DAY = 24 * 60
/** `HH:MM`, 00:00–23:59. */
export const PLAN_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

// --- Saat ----------------------------------------------------------------------------------------

/** `HH:MM` → günün dakikası. */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

/** Günün dakikası → `HH:MM`. */
export function timeOf(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Bitiş saati (`HH:MM`); süre gün sonunu aşmaz (şema denetler). */
export const planEndTime = (startTime: string, durationMinutes: number) =>
  timeOf(minutesOf(startTime) + durationMinutes)

export interface PlanSlot {
  plannedDate: string
  startTime: string
  durationMinutes: number
}

/** İki zaman aralığı aynı günde kesişiyor mu (uç uca değen aralık kesişmez). */
export function slotsOverlap(a: PlanSlot, b: PlanSlot): boolean {
  if (a.plannedDate !== b.plannedDate) return false
  const aStart = minutesOf(a.startTime)
  const bStart = minutesOf(b.startTime)
  return aStart < bStart + b.durationMinutes && bStart < aStart + a.durationMinutes
}

// --- Şemalar -------------------------------------------------------------------------------------

const memberIdSchema = (message: string) =>
  z.string(message).trim().min(1, message).max(100, message)
const recordIdSchema = (label: string) =>
  z
    .string(`${label} geçersiz.`)
    .trim()
    .max(200, `${label} geçersiz.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
const timeSchema = z
  .string('Başlangıç saatini girin.')
  .trim()
  .regex(PLAN_TIME_PATTERN, 'Saati SS:DD biçiminde girin (ör. 09:40).')
  .describe('Başlangıç saati, Europe/Istanbul (SS:DD)')
const durationSchema = z
  .number('Süreyi girin.')
  .int('Süre tam dakika olmalı.')
  .min(OBSERVATION_PLAN_DURATION_MIN, `Süre en az ${String(OBSERVATION_PLAN_DURATION_MIN)} dakika.`)
  .max(
    OBSERVATION_PLAN_DURATION_MAX,
    `Süre en çok ${String(OBSERVATION_PLAN_DURATION_MAX)} dakika.`,
  )
  .describe('Süre (dakika)')
const noteSchema = z
  .string('Not geçersiz.')
  .trim()
  .max(
    OBSERVATION_PLAN_NOTE_MAX,
    `Not en fazla ${OBSERVATION_PLAN_NOTE_MAX.toLocaleString('tr-TR')} karakter olabilir.`,
  )
  .transform((value) => (value === '' ? null : value))
  .nullable()
const reasonSchema = z
  .string('Gerekçeyi yazın.')
  .trim()
  .min(OBSERVATION_PLAN_REASON_MIN, 'Gerekçeyi en az 3 karakterle yazın.')
  .max(
    OBSERVATION_PLAN_REASON_MAX,
    `Gerekçe en fazla ${String(OBSERVATION_PLAN_REASON_MAX)} karakter olabilir.`,
  )

/** Saat ve süre gün sonunu aşmaz (plan aynı gün içindedir). */
function refineDayEnd(
  value: { startTime?: string | undefined; durationMinutes?: number | undefined },
  ctx: z.RefinementCtx,
) {
  if (value.startTime === undefined || value.durationMinutes === undefined) return
  if (!PLAN_TIME_PATTERN.test(value.startTime)) return
  if (minutesOf(value.startTime) + value.durationMinutes > MINUTES_PER_DAY)
    ctx.addIssue({
      code: 'custom',
      message: 'Gözlem gece yarısından önce bitmeli.',
      path: ['durationMinutes'],
    })
}

export const observationPlanCreateSchema = z
  .strictObject({
    // kvkk: K (öğretmen üyeliği)
    teacherMembershipId: memberIdSchema('Öğretmeni seçin.').describe(
      'Gözlenecek öğretmenin kurum üyeliği',
    ),
    // kvkk: K (gözlemci üyeliği)
    observerMembershipId: memberIdSchema('Gözlemciyi seçin.').describe(
      'Gözlemcinin kurum üyeliği (etkin yönetici ya da öğretmen)',
    ),
    templateId: z
      .uuid('Gözlem formunu seçin.')
      .describe('Gözlem formu; plan açılırken son sürümü plana yazılır'),
    plannedDate: daySchema.describe('Plan günü; bugünden (Europe/Istanbul) önce olamaz'),
    startTime: timeSchema,
    durationMinutes: durationSchema.default(OBSERVATION_PLAN_DURATION_DEFAULT),
    classId: recordIdSchema('Sınıf').optional().describe('İsteğe bağlı sınıf (`classes` kaydı)'),
    subjectId: recordIdSchema('Ders').optional().describe('İsteğe bağlı ders (`subjects` kaydı)'),
    performancePeriodId: z
      .uuid('Performans dönemi geçersiz.')
      .nullable()
      .optional()
      .describe('İsteğe bağlı performans dönemi (DOM-FIN-124); dönem başına plan sınırı buna göre'),
    // kvkk: K (serbest metin; denetime ve loga yazılmaz)
    note: noteSchema.optional().describe('Gözlemin odağı (ör. "soru teknikleri"); öğretmen görür'),
  })
  .superRefine(refineDayEnd)
export type ObservationPlanCreateInput = z.input<typeof observationPlanCreateSchema>
export type ObservationPlanCreateFields = z.output<typeof observationPlanCreateSchema>

/** Açık planın düzeltmesi: yalnız gönderilen alanlar; öğretmen değişmez (yeni plan açılır). */
export const observationPlanUpdateSchema = z
  .strictObject({
    observerMembershipId: memberIdSchema('Gözlemciyi seçin.').optional(),
    templateId: z.uuid('Gözlem formunu seçin.').optional().describe('Son sürümü plana yazılır'),
    plannedDate: daySchema.optional().describe('Plan günü; bugünden önce olamaz'),
    startTime: timeSchema.optional(),
    durationMinutes: durationSchema.optional(),
    classId: recordIdSchema('Sınıf').optional().describe('Sınıf; boş metin bağı kaldırır'),
    subjectId: recordIdSchema('Ders').optional().describe('Ders; boş metin bağı kaldırır'),
    performancePeriodId: z
      .uuid('Performans dönemi geçersiz.')
      .nullable()
      .optional()
      .describe('Performans dönemi; `null` bağı kaldırır'),
    note: noteSchema.optional().describe('Not; boş metin siler'),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type ObservationPlanUpdateInput = z.input<typeof observationPlanUpdateSchema>
export type ObservationPlanUpdateFields = z.output<typeof observationPlanUpdateSchema>

/** Erteleme: yeni gün ve saat zorunlu, süre isteğe bağlı (verilmezse korunur), gerekçe (K-472). */
export const observationPlanPostponeSchema = z
  .strictObject({
    plannedDate: daySchema.describe('Yeni gün; bugünden önce olamaz'),
    startTime: timeSchema,
    durationMinutes: durationSchema.optional().describe('Yeni süre; verilmezse korunur'),
    // kvkk: K (serbest metin; denetime ve loga yazılmaz)
    reason: reasonSchema.describe('Erteleme gerekçesi (3–500)'),
  })
  .superRefine(refineDayEnd)
export type ObservationPlanPostponeInput = z.input<typeof observationPlanPostponeSchema>

/** İptal: gerekçe zorunlu (K-472). */
export const observationPlanCancelSchema = z.strictObject({
  // kvkk: K (serbest metin; denetime ve loga yazılmaz)
  reason: reasonSchema.describe('İptal gerekçesi (3–500)'),
})
export type ObservationPlanCancelInput = z.input<typeof observationPlanCancelSchema>

/** Gözlemi başlatma gövdesizdir. */
export const observationPlanStartSchema = z.strictObject({})

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string[]) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

/** Planın kişilerinden biriyle aynı günde, iptal edilmemiş başka plan. */
export interface BusyPlan extends PlanSlot {
  id: string
  teacherMembershipId: string
  observerMembershipId: string
}

export interface ObservationPlanChecks {
  /** Formun son sürümü; form kurumda yoksa `null`. */
  template: { archived: boolean; versionId: string } | null
  teacher: ObservationMember | null
  observer: ObservationMember | null
  classFound: boolean | null
  subjectFound: boolean | null
  period: ObservationPeriodCheck
  /** Öğretmenin bu döneme bağlı, iptal edilmemiş (bu plan dışındaki) plan sayısı. */
  teacherPlansInPeriod: number
  /** Gözlemcinin ya da öğretmenin aynı gündeki, iptal edilmemiş (bu plan dışındaki) planları. */
  busy: readonly BusyPlan[]
  today: string
}

function assertDate(plannedDate: string, today: string): void {
  if (plannedDate < today)
    throw ruleError('observation_plan_date_past', 'Geçmiş güne gözlem planlanamaz.', [
      'plannedDate',
    ])
}

function assertPlanPeriod(period: ObservationPeriodCheck, plannedDate: string): void {
  if (period === undefined) return
  if (period === null)
    throw ruleError('observation_period_not_found', 'Performans dönemi bulunamadı.', [
      'performancePeriodId',
    ])
  if (period.status === 'closed')
    throw ruleError('observation_period_closed', 'Kapanmış performans dönemine plan bağlanmaz.', [
      'performancePeriodId',
    ])
  if (plannedDate < period.startDate || plannedDate > period.endDate)
    throw ruleError(
      'observation_plan_outside_period',
      'Plan günü performans dönemi içinde olmalı.',
      ['plannedDate'],
    )
}

function assertLimit(teacherPlansInPeriod: number): void {
  if (teacherPlansInPeriod >= OBSERVATION_PLANS_PER_PERIOD_MAX)
    throw ruleError(
      'observation_plan_limit',
      `Bu öğretmene bu dönemde en çok ${String(OBSERVATION_PLANS_PER_PERIOD_MAX)} gözlem planlanır.`,
      ['teacherMembershipId'],
    )
}

/**
 * Çakışma (K-472): gözlemci ve gözlenen aynı saatte başka bir planda (gözlemci ya da gözlenen
 * olarak) yer alamaz. Ders programına bağ olmadığından derse denk gelme denetlenmez.
 */
function assertFree(
  slot: PlanSlot,
  people: { teacherMembershipId: string; observerMembershipId: string },
  busy: readonly BusyPlan[],
): void {
  const involves = (plan: BusyPlan, membershipId: string) =>
    plan.observerMembershipId === membershipId || plan.teacherMembershipId === membershipId
  const clash = busy.filter((plan) => slotsOverlap(slot, plan))
  if (clash.some((plan) => involves(plan, people.observerMembershipId)))
    throw ruleError(
      'observation_plan_observer_busy',
      'Gözlemcinin bu saatte başka bir gözlem planı var.',
      ['startTime'],
    )
  if (clash.some((plan) => involves(plan, people.teacherMembershipId)))
    throw ruleError(
      'observation_plan_teacher_busy',
      'Öğretmenin bu saatte başka bir gözlem planı var.',
      ['startTime'],
    )
}

function assertTemplate(template: ObservationPlanChecks['template']): string {
  if (template === null)
    throw ruleError('observation_template_not_found', 'Gözlem formu bulunamadı.', ['templateId'])
  if (template.archived)
    throw conflict('observation_template_archived', 'Gözlem formu arşivlendi; seçilemez.')
  return template.versionId
}

export interface PlannedObservation {
  teacherMembershipId: string
  observerMembershipId: string
  templateVersionId: string
  plannedDate: string
  startTime: string
  durationMinutes: number
  classId: string | null
  subjectId: string | null
  performancePeriodId: string | null
  note: string | null
}

/**
 * Yeni plan (K-472): form kurumun arşivlenmemiş formu (son sürümü plana yazılır), gözlenen etkin
 * öğretmen, gözlemci etkin yönetici ya da öğretmen ve başka kişi (DOM-FIN-130 kişi kuralı), gün
 * bugünden önce değil, dönem bağlıysa kapanmamış ve gün dönem içinde, öğretmenin dönemdeki plan
 * sayısı sınırın altında, iki kişi de o saatte boş.
 */
export function planObservationPlan(
  input: ObservationPlanCreateFields,
  checks: ObservationPlanChecks,
): PlannedObservation {
  const templateVersionId = assertTemplate(checks.template)
  assertObservationPeople(checks.teacher, checks.observer)
  assertObservationRecords(checks)
  assertDate(input.plannedDate, checks.today)
  assertPlanPeriod(checks.period, input.plannedDate)
  if (checks.period !== undefined) assertLimit(checks.teacherPlansInPeriod)
  assertFree(input, input, checks.busy)
  return {
    teacherMembershipId: input.teacherMembershipId,
    observerMembershipId: input.observerMembershipId,
    templateVersionId,
    plannedDate: input.plannedDate,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    classId: input.classId ?? null,
    subjectId: input.subjectId ?? null,
    performancePeriodId: input.performancePeriodId ?? null,
    note: input.note ?? null,
  }
}

/** Planın yazmaya esas hâli. */
export interface ObservationPlanState extends PlanSlot {
  status: ObservationPlanStatus
  observationId: string | null
  teacherMembershipId: string
  observerMembershipId: string
  performancePeriodId: string | null
}

/** Açık ve gözlemi başlamamış plan değişir; gerçekleşen, iptal edilen ya da başlayan 409. */
function assertEditable(plan: Pick<ObservationPlanState, 'status' | 'observationId'>): void {
  if (plan.status === 'done')
    throw conflict('observation_plan_done', 'Plan gerçekleşti; artık değiştirilemez.')
  if (plan.status === 'cancelled')
    throw conflict('observation_plan_cancelled', 'Plan iptal edildi; artık değiştirilemez.')
  if (plan.observationId !== null)
    throw conflict(
      'observation_plan_started',
      'Bu planın gözlemi başladı; plan değiştirilemez. Gerekirse gözlem taslağını arşivleyin.',
    )
}

export interface ObservationPlanPatch {
  observerMembershipId?: string
  templateVersionId?: string
  plannedDate?: string
  startTime?: string
  durationMinutes?: number
  classId?: string | null
  subjectId?: string | null
  performancePeriodId?: string | null
  note?: string | null
}

export interface ObservationPlanUpdateChecks {
  /** Yalnız `templateId` gönderildiyse; yoksa `undefined`. */
  template?: ObservationPlanChecks['template'] | undefined
  /** Gözlenen ve (değiştiyse yeni) gözlemci; kişi denetimi yalnız gözlemci değişince. */
  teacher: ObservationMember | null
  observer: ObservationMember | null
  classFound: boolean | null
  subjectFound: boolean | null
  /** Son hâldeki dönem; bağ yoksa `undefined`. */
  period: ObservationPeriodCheck
  teacherPlansInPeriod: number
  busy: readonly BusyPlan[]
  today: string
}

/**
 * Açık planın düzeltmesi (K-472). Gün gönderilirse bugünden önce olamaz; gün, saat, süre ya da
 * gözlemci değişince çakışma, gün ya da dönem değişince dönem, dönem değişince sınır yeniden
 * denetlenir. Gün, saat, süre ya da gözlemci değiştiyse öğretmene "plan değişti" bildirimi
 * düşer (`notify`).
 */
export function planObservationPlanUpdate(
  plan: ObservationPlanState,
  input: ObservationPlanUpdateFields,
  checks: ObservationPlanUpdateChecks,
): { patch: ObservationPlanPatch; notify: boolean } {
  assertEditable(plan)
  const patch: ObservationPlanPatch = {}
  if (input.templateId !== undefined)
    patch.templateVersionId = assertTemplate(checks.template ?? null)
  const observerChanged =
    input.observerMembershipId !== undefined &&
    input.observerMembershipId !== plan.observerMembershipId
  if (observerChanged) {
    assertObservationPeople(checks.teacher, checks.observer)
    patch.observerMembershipId = input.observerMembershipId
  }
  assertObservationRecords(checks)
  if (input.classId !== undefined) patch.classId = input.classId
  if (input.subjectId !== undefined) patch.subjectId = input.subjectId
  if (input.plannedDate !== undefined) assertDate(input.plannedDate, checks.today)
  const slot: PlanSlot = {
    plannedDate: input.plannedDate ?? plan.plannedDate,
    startTime: input.startTime ?? plan.startTime,
    durationMinutes: input.durationMinutes ?? plan.durationMinutes,
  }
  if (minutesOf(slot.startTime) + slot.durationMinutes > MINUTES_PER_DAY)
    throw ruleError('observation_plan_day_end', 'Gözlem gece yarısından önce bitmeli.', [
      'durationMinutes',
    ])
  const periodChanged =
    input.performancePeriodId !== undefined &&
    input.performancePeriodId !== plan.performancePeriodId
  if (input.plannedDate !== undefined || periodChanged)
    assertPlanPeriod(checks.period, slot.plannedDate)
  if (periodChanged && checks.period !== undefined) assertLimit(checks.teacherPlansInPeriod)
  if (input.performancePeriodId !== undefined) patch.performancePeriodId = input.performancePeriodId
  const slotChanged =
    slot.plannedDate !== plan.plannedDate ||
    slot.startTime !== plan.startTime ||
    slot.durationMinutes !== plan.durationMinutes
  if (slotChanged || observerChanged)
    assertFree(
      slot,
      {
        teacherMembershipId: plan.teacherMembershipId,
        observerMembershipId: input.observerMembershipId ?? plan.observerMembershipId,
      },
      checks.busy,
    )
  if (input.plannedDate !== undefined) patch.plannedDate = input.plannedDate
  if (input.startTime !== undefined) patch.startTime = input.startTime
  if (input.durationMinutes !== undefined) patch.durationMinutes = input.durationMinutes
  if (input.note !== undefined) patch.note = input.note
  return { patch, notify: slotChanged || observerChanged }
}

/**
 * Erteleme (K-472): açık ve başlamamış plan yeni gün ve saate alınır, gerekçe yazılır, durum
 * "ertelendi" olur ve sayaç artar. Yeni gün bugünden önce olamaz, aynı saat 422, dönem bağlıysa
 * gün dönem içinde, iki kişi de yeni saatte boş olmalı.
 */
export function planObservationPlanPostpone(
  plan: ObservationPlanState,
  input: z.output<typeof observationPlanPostponeSchema>,
  checks: { period: ObservationPeriodCheck; busy: readonly BusyPlan[]; today: string },
): PlanSlot & { reason: string } {
  assertEditable(plan)
  const slot: PlanSlot = {
    plannedDate: input.plannedDate,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes ?? plan.durationMinutes,
  }
  if (minutesOf(slot.startTime) + slot.durationMinutes > MINUTES_PER_DAY)
    throw ruleError('observation_plan_day_end', 'Gözlem gece yarısından önce bitmeli.', [
      'durationMinutes',
    ])
  if (slot.plannedDate === plan.plannedDate && slot.startTime === plan.startTime)
    throw ruleError(
      'observation_plan_same_slot',
      'Ertelemek için başka bir gün ya da saat seçin.',
      ['plannedDate'],
    )
  assertDate(slot.plannedDate, checks.today)
  assertPlanPeriod(checks.period, slot.plannedDate)
  assertFree(slot, plan, checks.busy)
  return { ...slot, reason: input.reason }
}

/** İptal (K-472): açık ve başlamamış plan gerekçeyle kapanır; sınırda sayılmaz. */
export function planObservationPlanCancel(
  plan: Pick<ObservationPlanState, 'status' | 'observationId'>,
  input: z.output<typeof observationPlanCancelSchema>,
): { reason: string } {
  assertEditable(plan)
  return { reason: input.reason }
}

/**
 * Gözlemi başlatma (K-473): açık ve başlamamış plan, günü geldiyse (bugün ya da geçmiş) gözlem
 * taslağını açar; gözlemin günü plan günüdür. Gözlem açma kuralları DOM-FIN-130'dakidir.
 */
export function planObservationPlanStart(
  plan: Pick<ObservationPlanState, 'status' | 'observationId' | 'plannedDate'>,
  today: string,
): void {
  assertEditable(plan)
  if (plan.plannedDate > today)
    throw ruleError(
      'observation_plan_not_due',
      'Plan günü gelmeden gözlem başlatılamaz; gerekirse planı öne alın.',
      ['plannedDate'],
    )
}

/** Geciken plan: günü geçmiş (İstanbul günü), gerçekleşmemiş ve iptal edilmemiş (K-473). */
export const isObservationPlanOverdue = (
  plan: { status: ObservationPlanStatus; plannedDate: string },
  today: string,
) =>
  (OPEN_OBSERVATION_PLAN_STATUSES as readonly string[]).includes(plan.status) &&
  plan.plannedDate < today

/** Plan görünürlüğü (K-474): yönetici hepsini, öğretmen gözlemcisi ya da gözleneni olduğu planı. */
export function canViewObservationPlan(
  viewer: { role: string; membershipId: string },
  plan: { teacherMembershipId: string; observerMembershipId: string },
): boolean {
  if (viewer.role === 'yonetici') return true
  if (viewer.role !== 'ogretmen') return false
  return (
    plan.teacherMembershipId === viewer.membershipId ||
    plan.observerMembershipId === viewer.membershipId
  )
}
