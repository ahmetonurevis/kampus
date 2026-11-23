import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { addDays } from './academic-years.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { istanbulInstant } from './finance-infirmary-schedule.ts'
import { isoWeekday, MEAL_KINDS, type MealKind } from './finance-meal-menus.ts'
import type { StudentCheck } from './finance-transport.ts'

/**
 * Yemek aboneliği ve gün iptali (docs/domain/finans.md DOM-FIN-164; ON-150; IST-099; K-547…K-549).
 * Abonelik öğrencinin bir öğüne (menü öğünleriyle aynı anahtarlar, kurumun açık öğünü) başlangıç ve
 * bitiş günü arasında, seçilen hafta günlerinde katılmasıdır; diyet türü (normal, vejetaryen,
 * glütensiz, laktozsuz, diğer + kısa açıklama) yalnız tür olarak tutulur, tıbbi gerekçe sağlık
 * profilinde kalır (K-547). Gün iptali veli ya da okul tarafından yapılır; kesim (kurum ayarı,
 * varsayılan bir gün önce 15:00, İstanbul) geçince veli iptal edemez, okulun iptali "geç iptal"
 * işaretlenir ve iade/mahsup gününe girmez (K-548). Okul takvimindeki kurum tatili (DOM-FIN-163,
 * K-545) yemek günü sayılmaz. Günlük mutfak sayısı ve aylık gün özeti okumada hesaplanır,
 * saklanmaz (K-549). Ücret bağı ek hizmet kalemi (ON-087) gelince eklenir. Fonksiyonlar saftır.
 */

/** Abonelik yazma ve iptal: yönetici ve ön büro (K-547). */
export const FINANCE_MEAL_SUBSCRIPTION_MANAGE_ROLES = [
  'yonetici',
  'onburo',
] as const satisfies readonly Role[]
/** Kesim ayarını değiştiren rol. */
export const FINANCE_MEAL_SUBSCRIPTION_ADMIN_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Kendi (veli: bağlı çocuklarının) aboneliğini okuyan aile rolleri. */
export const FINANCE_MEAL_SUBSCRIPTION_FAMILY_ROLES = [
  'veli',
  'ogrenci',
] as const satisfies readonly Role[]
/** Gün iptali ve geri alma: okul ve veli; öğrenci iptal etmez (K-548). */
export const FINANCE_MEAL_CANCEL_ROLES = [
  'yonetici',
  'onburo',
  'veli',
] as const satisfies readonly Role[]

/** Diyet türleri; saklanan değer İngilizce anahtardır, gösterim sırası bu dizidir (K-547). */
export const MEAL_DIET_TYPES = [
  'standard',
  'vegetarian',
  'gluten_free',
  'lactose_free',
  'other',
] as const
export type MealDietType = (typeof MEAL_DIET_TYPES)[number]
export const MEAL_DIET_TYPE_LABELS = {
  standard: 'Normal',
  vegetarian: 'Vejetaryen',
  gluten_free: 'Glütensiz',
  lactose_free: 'Laktozsuz',
  other: 'Diğer',
} as const satisfies Record<MealDietType, string>

export const MEAL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
export type MealWeekday = (typeof MEAL_WEEKDAYS)[number]
export const MEAL_WEEKDAY_LABELS = {
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
  7: 'Pazar',
} as const satisfies Record<MealWeekday, string>
export const MEAL_WEEKDAY_SHORT_LABELS = {
  1: 'Pzt',
  2: 'Sal',
  3: 'Çar',
  4: 'Per',
  5: 'Cum',
  6: 'Cmt',
  7: 'Paz',
} as const satisfies Record<MealWeekday, string>
/** Yeni abonelik formunun varsayılan günleri: hafta içi. */
export const DEFAULT_MEAL_WEEKDAYS: readonly MealWeekday[] = [1, 2, 3, 4, 5]

/** İptali kim yaptı: veli (`family`) ya da okul (`school`). */
export const MEAL_CANCELLED_BY = ['family', 'school'] as const
export type MealCancelledBy = (typeof MEAL_CANCELLED_BY)[number]
export const MEAL_CANCELLED_BY_LABELS = {
  family: 'Veli',
  school: 'Okul',
} as const satisfies Record<MealCancelledBy, string>

export const MEAL_DIET_NOTE_MIN = 2
export const MEAL_DIET_NOTE_MAX = 200
/** Abonelik en çok bir yıl (366 gün) sürer. */
export const MEAL_SUBSCRIPTION_DAYS_MAX = 366
/** Abonelik en çok bir yıl ileride başlar. */
export const MEAL_SUBSCRIPTION_AHEAD_MAX_DAYS = 366
/** Tek istekte en çok bir aylık gün iptal edilir. */
export const MEAL_CANCELLATION_DATES_MAX = 31
/** Kesim en çok yedi gün önce. */
export const MEAL_CUTOFF_DAYS_MAX = 7
/** Hiç kaydedilmemiş kurum ayarında kesim: bir gün önce 15:00 (K-548). */
export const DEFAULT_MEAL_CUTOFF = { cutoffDaysBefore: 1, cutoffTime: '15:00' } as const

export type MealCutoff = { cutoffDaysBefore: number; cutoffTime: string }

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

// --- Şemalar -------------------------------------------------------------------------------------

const weekdaysSchema = z
  .array(
    z
      .number('Hafta gününü seçin.')
      .int('Hafta günü geçersiz.')
      .min(1, 'Hafta günü geçersiz.')
      .max(7, 'Hafta günü geçersiz.'),
    'Hafta günlerini seçin.',
  )
  .min(1, 'En az bir hafta günü seçin.')
  .max(MEAL_WEEKDAYS.length)
  .refine((list) => new Set(list).size === list.length, 'Aynı gün iki kez seçilmiş.')
  .describe('Yemek günleri (ISO: 1 pazartesi … 7 pazar)')

// kvkk: Ç — diyet türünün açıklaması; serbest metin, tanı yazılmaz, loglanmaz ve denetime yazılmaz.
const dietNoteSchema = z
  .string()
  .trim()
  .max(MEAL_DIET_NOTE_MAX, `En çok ${String(MEAL_DIET_NOTE_MAX)} karakter girebilirsiniz.`)
  .nullable()
  .describe(
    '“Diğer” diyetin kısa açıklaması (2–200; ör. “domuz eti içermeyen”); tıbbi ayrıntı yazılmaz, diğer türlerde `null`',
  )

const subscriptionShape = {
  studentId: z
    .string('Öğrenciyi seçin.')
    .trim()
    .min(1, 'Öğrenciyi seçin.')
    .max(100)
    .describe('Öğrenci (students)'),
  mealKind: z.enum(MEAL_KINDS, 'Öğünü seçin.').describe('Öğün; kurumda açık olmalı'),
  startDate: daySchema.describe('İlk yemek günü (YYYY-MM-DD, Europe/Istanbul)'),
  endDate: daySchema.describe('Son yemek günü (YYYY-MM-DD, dahil)'),
  weekdays: weekdaysSchema,
  // kvkk: Ç — diyet türü (K-547); sağlık verisi olarak değil, yemek hizmeti tercihi olarak tutulur.
  dietType: z.enum(MEAL_DIET_TYPES, 'Diyet türünü seçin.').describe('Diyet türü'),
  dietNote: dietNoteSchema.optional(),
}

export interface MealSubscriptionIssue {
  path: 'startDate' | 'endDate' | 'dietNote'
  code: string
  message: string
}

/** Abonelik alanlarının bütün hâl kuralları (oluşturma şeması ve düzenleme birleşimi). */
export function mealSubscriptionIssues(fields: {
  startDate: string
  endDate: string
  dietType: MealDietType
  dietNote: string | null
}): MealSubscriptionIssue[] {
  const issues: MealSubscriptionIssue[] = []
  if (fields.endDate < fields.startDate)
    issues.push({
      path: 'endDate',
      code: 'meal_subscription_end_before_start',
      message: 'Bitiş günü başlangıçtan önce olamaz.',
    })
  else if (fields.endDate > addDays(fields.startDate, MEAL_SUBSCRIPTION_DAYS_MAX - 1))
    issues.push({
      path: 'endDate',
      code: 'meal_subscription_too_long',
      message: `Abonelik en çok ${String(MEAL_SUBSCRIPTION_DAYS_MAX)} gün sürer.`,
    })
  const note = fields.dietNote?.trim() ?? ''
  if (fields.dietType === 'other' && note.length < MEAL_DIET_NOTE_MIN)
    issues.push({
      path: 'dietNote',
      code: 'meal_diet_note_required',
      message: `“Diğer” diyeti en az ${String(MEAL_DIET_NOTE_MIN)} karakterle açıklayın.`,
    })
  if (fields.dietType !== 'other' && note !== '')
    issues.push({
      path: 'dietNote',
      code: 'meal_diet_note_not_allowed',
      message: 'Açıklama yalnız “Diğer” diyette yazılır.',
    })
  return issues
}

export const mealSubscriptionCreateSchema = z
  .strictObject(subscriptionShape)
  .superRefine((value, context) => {
    for (const issue of mealSubscriptionIssues({ ...value, dietNote: value.dietNote ?? null }))
      context.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
  })
  .describe('Yeni yemek aboneliği')
export type MealSubscriptionCreateInput = z.input<typeof mealSubscriptionCreateSchema>
export type MealSubscriptionCreateFields = z.output<typeof mealSubscriptionCreateSchema>

export const mealSubscriptionUpdateSchema = z
  .strictObject({
    startDate: subscriptionShape.startDate.optional(),
    endDate: subscriptionShape.endDate.optional(),
    weekdays: weekdaysSchema.optional(),
    dietType: subscriptionShape.dietType.optional(),
    dietNote: dietNoteSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    'En az bir alanı değiştirin.',
  )
  .describe(
    'Değişen alanlar; başlamış abonelikte yalnız `endDate` (diyet ya da gün değişikliği için abonelik bitirilip yenisi açılır)',
  )
export type MealSubscriptionUpdateFields = z.output<typeof mealSubscriptionUpdateSchema>

export const mealCancellationCreateSchema = z
  .strictObject({
    dates: z
      .array(daySchema, 'İptal edilecek günleri seçin.')
      .min(1, 'En az bir gün seçin.')
      .max(
        MEAL_CANCELLATION_DATES_MAX,
        `Tek seferde en çok ${String(MEAL_CANCELLATION_DATES_MAX)} gün iptal edilir.`,
      )
      .refine((list) => new Set(list).size === list.length, 'Aynı gün iki kez seçilmiş.')
      .describe('İptal edilen yemek günleri (YYYY-MM-DD, Europe/Istanbul)'),
  })
  .describe('Gün iptali; gerekçe alınmaz (sağlık bilgisi yazılmasın diye)')
export type MealCancellationCreateFields = z.output<typeof mealCancellationCreateSchema>

export const mealSubscriptionSettingsSchema = z
  .strictObject({
    cutoffDaysBefore: z
      .number('Kaç gün önce kapanacağını girin.')
      .int('Gün sayısı tam sayı olmalı.')
      .min(0, 'Gün sayısı negatif olamaz.')
      .max(MEAL_CUTOFF_DAYS_MAX, `En çok ${String(MEAL_CUTOFF_DAYS_MAX)} gün önce olabilir.`)
      .describe('Kesim yemek gününden kaç gün önce (0 aynı gün)'),
    cutoffTime: z
      .string('Kesim saatini girin.')
      .regex(TIME, 'Saati SS:DD biçiminde girin.')
      .describe('Kesim saati (SS:DD, Europe/Istanbul)'),
  })
  .describe('Gün iptali kesimi')
export type MealSubscriptionSettingsFields = z.output<typeof mealSubscriptionSettingsSchema>

export const mealMonthSchema = z
  .string()
  .regex(MONTH, 'Ayı YYYY-AA biçiminde seçin.')
  .describe('Ay (YYYY-AA)')

// --- Takvim --------------------------------------------------------------------------------------

/** Ayın günleri (YYYY-AA → ilk ve son gün). */
export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`
  const [year = 0, monthIndex = 1] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  return { from, to: `${month}-${String(last).padStart(2, '0')}` }
}

/** `from`…`to` arası günler (dahil). */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
  return days
}

/** Tatil aralıklarını gün kümesine çevirir (yalnız `from`…`to` arası). */
export function holidayDays(
  holidays: readonly { title: string; startDate: string; endDate: string }[],
  from: string,
  to: string,
): Map<string, string> {
  const days = new Map<string, string>()
  for (const holiday of holidays) {
    const start = holiday.startDate < from ? from : holiday.startDate
    const end = holiday.endDate > to ? to : holiday.endDate
    for (const day of start <= end ? daysBetween(start, end) : [])
      if (!days.has(day)) days.set(day, holiday.title)
  }
  return days
}

/** Abonelik gün dizisi: aralıkta ve seçili hafta gününde mi. */
export function isSubscribedDay(
  subscription: { startDate: string; endDate: string; weekdays: readonly number[] },
  day: string,
): boolean {
  return (
    subscription.startDate <= day &&
    day <= subscription.endDate &&
    subscription.weekdays.includes(isoWeekday(day))
  )
}

export const MEAL_SUBSCRIPTION_STATUSES = ['upcoming', 'active', 'ended'] as const
export type MealSubscriptionStatus = (typeof MEAL_SUBSCRIPTION_STATUSES)[number]
export const MEAL_SUBSCRIPTION_STATUS_LABELS = {
  upcoming: 'Başlamadı',
  active: 'Sürüyor',
  ended: 'Bitti',
} as const satisfies Record<MealSubscriptionStatus, string>

export function mealSubscriptionStatus(
  subscription: { startDate: string; endDate: string },
  today: string,
): MealSubscriptionStatus {
  if (subscription.startDate > today) return 'upcoming'
  if (subscription.endDate < today) return 'ended'
  return 'active'
}

/** Gün iptalinin son anı (UTC ISO): yemek gününden `cutoffDaysBefore` gün önce, İstanbul saatiyle. */
export function mealCancellationDeadline(day: string, cutoff: MealCutoff): string {
  return istanbulInstant(addDays(day, -cutoff.cutoffDaysBefore), cutoff.cutoffTime)
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })
const conflict = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'conflict', path })

/** Boş açıklama `null`. */
const cleanNote = (note: string | null | undefined) => {
  const value = note?.trim() ?? ''
  return value === '' ? null : value
}

const orderedWeekdays = (list: readonly number[]) =>
  MEAL_WEEKDAYS.filter((day) => list.includes(day)) as MealWeekday[]

/** Saklanan abonelik alanları. */
export interface MealSubscriptionFields {
  studentId: string
  mealKind: MealKind
  startDate: string
  endDate: string
  weekdays: MealWeekday[]
  dietType: MealDietType
  dietNote: string | null
}

/** Çakışma denetimi için öğrencinin etkin abonelikleri. */
export type MealSubscriptionSpan = Pick<
  MealSubscriptionFields,
  'mealKind' | 'startDate' | 'endDate'
> & { id: string }

function assertNoOverlap(
  fields: Pick<MealSubscriptionFields, 'mealKind' | 'startDate' | 'endDate'>,
  existing: readonly MealSubscriptionSpan[],
) {
  if (
    existing.some(
      (other) =>
        other.mealKind === fields.mealKind &&
        other.startDate <= fields.endDate &&
        fields.startDate <= other.endDate,
    )
  )
    throw conflict(
      'meal_subscription_overlap',
      'Öğrencinin bu öğünde aynı tarihlere değen aboneliği var.',
      ['startDate'],
    )
}

function throwIssues(fields: Parameters<typeof mealSubscriptionIssues>[0]) {
  const [issue] = mealSubscriptionIssues(fields)
  if (issue !== undefined) throw ruleError(issue.code, issue.message, [issue.path])
}

/**
 * Yeni abonelik (K-547): öğrenci kurumda ve etkin, öğün kurumda açık; başlangıç bugünden önce
 * olamaz ve en çok bir yıl ileridedir; aynı öğünde tarihleri değen ikinci abonelik 409.
 */
export function planMealSubscriptionCreate(
  input: MealSubscriptionCreateFields,
  checks: {
    today: string
    student: StudentCheck
    enabledKinds: readonly MealKind[]
    existing: readonly MealSubscriptionSpan[]
  },
): MealSubscriptionFields {
  if (checks.student === null)
    throw ruleError('meal_subscription_student_not_found', 'Öğrenci bulunamadı.', ['studentId'])
  if (!checks.student.active)
    throw ruleError('meal_subscription_student_inactive', 'Öğrenci kaydı etkin değil.', [
      'studentId',
    ])
  if (!checks.enabledKinds.includes(input.mealKind))
    throw ruleError('meal_kind_disabled', 'Bu öğün kurumda kullanılmıyor.', ['mealKind'])
  if (input.startDate < checks.today)
    throw ruleError('meal_subscription_start_past', 'Abonelik bugünden önce başlayamaz.', [
      'startDate',
    ])
  if (input.startDate > addDays(checks.today, MEAL_SUBSCRIPTION_AHEAD_MAX_DAYS))
    throw ruleError(
      'meal_subscription_start_too_far',
      'Abonelik en çok bir yıl sonrasından başlayabilir.',
      ['startDate'],
    )
  const fields: MealSubscriptionFields = {
    studentId: input.studentId,
    mealKind: input.mealKind,
    startDate: input.startDate,
    endDate: input.endDate,
    weekdays: orderedWeekdays(input.weekdays),
    dietType: input.dietType,
    dietNote: input.dietType === 'other' ? cleanNote(input.dietNote) : null,
  }
  throwIssues(fields)
  assertNoOverlap(fields, checks.existing)
  return fields
}

export type MealSubscriptionChange = Pick<
  MealSubscriptionFields,
  'startDate' | 'endDate' | 'weekdays' | 'dietType' | 'dietNote'
>

/**
 * Abonelik düzenlemesi (K-547): bitmiş abonelik değişmez. Başlamış abonelikte yalnız bitiş günü
 * değişir ve bugünden önceye çekilemez (geçmiş günler ve aylık özet değişmesin diye); diyet ya da
 * gün değişikliği için abonelik bitirilir, yenisi açılır. Başlamamış abonelikte her alan değişir,
 * başlangıç bugünden önce olamaz. Sonuç bütün olarak doğrulanır; değişiklik yoksa 422.
 */
export function planMealSubscriptionUpdate(
  current: MealSubscriptionFields,
  input: MealSubscriptionUpdateFields,
  checks: { today: string; existing: readonly MealSubscriptionSpan[] },
): { values: MealSubscriptionChange; changed: (keyof MealSubscriptionChange)[] } {
  const status = mealSubscriptionStatus(current, checks.today)
  if (status === 'ended')
    throw ruleError('meal_subscription_ended', 'Bitmiş abonelik değiştirilemez.', ['endDate'])
  if (status === 'active') {
    const locked = (['startDate', 'weekdays', 'dietType', 'dietNote'] as const).find(
      (key) => input[key] !== undefined,
    )
    if (locked !== undefined)
      throw ruleError(
        'meal_subscription_started',
        'Başlamış abonelikte yalnız bitiş günü değişir; diyet ya da gün değişikliği için aboneliği bitirip yenisini açın.',
        [locked],
      )
  }
  const dietType = input.dietType ?? current.dietType
  const values: MealSubscriptionChange = {
    startDate: input.startDate ?? current.startDate,
    endDate: input.endDate ?? current.endDate,
    weekdays: input.weekdays === undefined ? current.weekdays : orderedWeekdays(input.weekdays),
    dietType,
    dietNote:
      dietType === 'other' && input.dietNote === undefined
        ? current.dietNote
        : cleanNote(input.dietNote),
  }
  if (status === 'active' && values.endDate < checks.today)
    throw ruleError(
      'meal_subscription_end_past',
      'Başlamış abonelik bugünden önce bitirilemez; en erken bugün bitebilir.',
      ['endDate'],
    )
  if (status === 'upcoming' && values.startDate < checks.today)
    throw ruleError('meal_subscription_start_past', 'Abonelik bugünden önce başlayamaz.', [
      'startDate',
    ])
  throwIssues(values)
  const changed = (Object.keys(values) as (keyof MealSubscriptionChange)[]).filter((key) =>
    key === 'weekdays'
      ? values.weekdays.join(',') !== current.weekdays.join(',')
      : values[key] !== current[key],
  )
  if (changed.length === 0)
    throw ruleError('meal_subscription_unchanged', 'Abonelikte değişiklik yok.')
  assertNoOverlap({ ...values, mealKind: current.mealKind }, checks.existing)
  return { values, changed }
}

/** Abonelik silme (arşiv): yalnız başlamamışsa; başlamış abonelik bitiş günüyle sonlandırılır. */
export function assertMealSubscriptionArchivable(
  subscription: { startDate: string },
  today: string,
): void {
  if (subscription.startDate <= today)
    throw ruleError(
      'meal_subscription_started',
      'Başlamış abonelik silinemez; bitiş gününü değiştirin.',
      ['startDate'],
    )
}

export interface MealCancellationPlan {
  mealDate: string
  /** Kesimden sonra okulun yaptığı iptal; iade/mahsup gününe girmez (K-548). */
  late: boolean
}

/**
 * Gün iptali (K-548): her gün aboneliğin yemek günü olmalı (aralıkta ve seçili hafta günü), tatil
 * olmamalı (tatil zaten yemek yok), bugünden önce olmamalı ve daha önce iptal edilmemiş olmalı
 * (409). Kesim geçtiyse veli iptal edemez (422 `meal_cancellation_cutoff_passed`); okulun iptali
 * "geç iptal" olarak yazılır.
 */
export function planMealCancellations(
  subscription: { startDate: string; endDate: string; weekdays: readonly number[] },
  input: MealCancellationCreateFields,
  checks: {
    now: Date
    today: string
    by: MealCancelledBy
    cutoff: MealCutoff
    holidays: ReadonlyMap<string, string>
    cancelled: ReadonlySet<string>
  },
): MealCancellationPlan[] {
  const nowIso = checks.now.toISOString()
  return [...input.dates].sort().map((mealDate) => {
    const path = ['dates', String(input.dates.indexOf(mealDate))]
    if (!isSubscribedDay(subscription, mealDate))
      throw ruleError('meal_day_not_subscribed', 'Bu gün aboneliğin yemek günü değil.', path)
    if (checks.holidays.has(mealDate))
      throw ruleError('meal_day_holiday', 'Tatil gününde zaten yemek verilmez.', path)
    if (mealDate < checks.today)
      throw ruleError('meal_day_past', 'Geçmiş gün iptal edilemez.', path)
    if (checks.cancelled.has(mealDate))
      throw conflict('meal_day_already_cancelled', 'Bu gün zaten iptal edilmiş.', path)
    const late = nowIso >= mealCancellationDeadline(mealDate, checks.cutoff)
    if (late && checks.by === 'family')
      throw ruleError(
        'meal_cancellation_cutoff_passed',
        'Bu gün için iptal süresi geçti; okulla görüşün.',
        path,
      )
    return { mealDate, late }
  })
}

/**
 * İptalin geri alınması (K-548): geçmiş gün geri alınmaz; veli yalnız kesimden önce, okul yemek
 * günü bitene kadar geri alır.
 */
export function assertMealCancellationRestorable(
  cancellation: { mealDate: string },
  checks: { now: Date; today: string; by: MealCancelledBy; cutoff: MealCutoff },
): void {
  if (cancellation.mealDate < checks.today)
    throw ruleError('meal_day_past', 'Geçmiş günün iptali geri alınamaz.', ['mealDate'])
  if (
    checks.by === 'family' &&
    checks.now.toISOString() >= mealCancellationDeadline(cancellation.mealDate, checks.cutoff)
  )
    throw ruleError(
      'meal_cancellation_cutoff_passed',
      'Bu gün için süre geçti; iptali okul geri alabilir.',
      ['mealDate'],
    )
}

/** Kesim ayarı: değişiklik yoksa 422. */
export function planMealSubscriptionSettings(
  current: MealCutoff,
  input: MealSubscriptionSettingsFields,
): MealCutoff {
  if (
    current.cutoffDaysBefore === input.cutoffDaysBefore &&
    current.cutoffTime === input.cutoffTime
  )
    throw ruleError('meal_subscription_settings_unchanged', 'Kesim ayarında değişiklik yok.')
  return { cutoffDaysBefore: input.cutoffDaysBefore, cutoffTime: input.cutoffTime }
}

// --- Görünüm ve hesap ----------------------------------------------------------------------------

export const MEAL_DAY_STATUSES = ['scheduled', 'cancelled', 'late_cancelled', 'holiday'] as const
export type MealDayStatus = (typeof MEAL_DAY_STATUSES)[number]
export const MEAL_DAY_STATUS_LABELS = {
  scheduled: 'Yemek var',
  cancelled: 'İptal',
  late_cancelled: 'Geç iptal',
  holiday: 'Tatil',
} as const satisfies Record<MealDayStatus, string>

export interface MealCancellationRef {
  id: string
  mealDate: string
  late: boolean
  cancelledBy: MealCancelledBy
  version: number
}

export interface MealCalendarDay<C extends MealCancellationRef = MealCancellationRef> {
  mealDate: string
  status: MealDayStatus
  holidayTitle: string | null
  /** İptalin son anı (kesim, UTC ISO). */
  deadline: string
  /** İsteği yapan bu günü iptal edebilir mi (kesim, tatil ve geçmiş dahil). */
  canCancel: boolean
  /** İsteği yapan bu günün iptalini geri alabilir mi. */
  canRestore: boolean
  cancellation: C | null
}

/**
 * Aboneliğin `from`…`to` arasındaki yemek günleri (K-548): yalnız seçili hafta günleri; her gün
 * yemek var, iptal, geç iptal ya da tatil. İptal ve geri alma bayrakları isteği yapanın (veli ya
 * da okul) kesim kuralıyla hesaplanır.
 */
export function mealSubscriptionCalendar<C extends MealCancellationRef>(
  subscription: { startDate: string; endDate: string; weekdays: readonly number[] },
  range: { from: string; to: string },
  checks: {
    now: Date
    today: string
    by: MealCancelledBy
    cutoff: MealCutoff
    holidays: ReadonlyMap<string, string>
    cancellations: readonly C[]
  },
): MealCalendarDay<C>[] {
  const from = range.from < subscription.startDate ? subscription.startDate : range.from
  const to = range.to > subscription.endDate ? subscription.endDate : range.to
  if (from > to) return []
  const byDate = new Map(checks.cancellations.map((row) => [row.mealDate, row]))
  const nowIso = checks.now.toISOString()
  return daysBetween(from, to)
    .filter((day) => isSubscribedDay(subscription, day))
    .map((mealDate) => {
      const deadline = mealCancellationDeadline(mealDate, checks.cutoff)
      const holidayTitle = checks.holidays.get(mealDate) ?? null
      const cancellation = byDate.get(mealDate) ?? null
      const open = mealDate >= checks.today && (checks.by === 'school' || nowIso < deadline)
      const status: MealDayStatus =
        holidayTitle !== null
          ? 'holiday'
          : cancellation === null
            ? 'scheduled'
            : cancellation.late
              ? 'late_cancelled'
              : 'cancelled'
      return {
        mealDate,
        status,
        holidayTitle,
        deadline,
        canCancel: status === 'scheduled' && open,
        canRestore: cancellation !== null && holidayTitle === null && open,
        cancellation,
      }
    })
}

export interface MealDietCount {
  dietType: MealDietType
  count: number
}

export interface MealCountRow {
  mealKind: MealKind
  /** Yemek verilecek öğrenci (iptaller ve geç iptaller düşülmüş). */
  total: number
  /** Kesimden önce iptal edilen. */
  cancelled: number
  /** Kesimden sonra okulun iptal ettiği (yemek hazırlanmış olabilir). */
  lateCancelled: number
  /** Diyet türü başına yemek sayısı, `MEAL_DIET_TYPES` sırasıyla (sıfırlar dahil). */
  diets: MealDietCount[]
}

export interface MealClassCount {
  classId: string | null
  meals: { mealKind: MealKind; total: number; diets: MealDietCount[] }[]
}

export interface MealDailyCount {
  date: string
  holidayTitle: string | null
  meals: MealCountRow[]
  classes: MealClassCount[]
}

const emptyDiets = () => MEAL_DIET_TYPES.map((dietType) => ({ dietType, count: 0 }))
const bump = (diets: MealDietCount[], dietType: MealDietType) => {
  const row = diets.find((item) => item.dietType === dietType)
  if (row !== undefined) row.count += 1
}

/**
 * Günlük mutfak sayısı (K-549): gün × öğün × diyet türü; o gün yemek günü olan abonelikler sayılır,
 * iptaller (geç iptal dahil) düşülür ve ayrıca sayılır. Tatil gününde her sayı sıfırdır. Sınıf
 * kırılımı öğrencinin güncel sınıfıyladır (sınıfsız öğrenci `classId: null`). Öğünler verilen
 * sırayla (kurumun açık öğünleri ve aboneliği olan öğünler). Saklanmaz.
 */
export function mealDailyCount(
  date: string,
  subscriptions: readonly (Pick<
    MealSubscriptionFields,
    'mealKind' | 'startDate' | 'endDate' | 'dietType'
  > & { id: string; classId: string | null; weekdays: readonly number[] })[],
  checks: {
    mealKinds: readonly MealKind[]
    holidayTitle: string | null
    cancellations: readonly { subscriptionId: string; late: boolean }[]
  },
): MealDailyCount {
  const meals = new Map<MealKind, MealCountRow>(
    checks.mealKinds.map((mealKind) => [
      mealKind,
      { mealKind, total: 0, cancelled: 0, lateCancelled: 0, diets: emptyDiets() },
    ]),
  )
  const classes = new Map<string, MealClassCount>()
  if (checks.holidayTitle === null) {
    const cancelled = new Map(checks.cancellations.map((row) => [row.subscriptionId, row.late]))
    for (const subscription of subscriptions) {
      if (!isSubscribedDay(subscription, date)) continue
      const row = meals.get(subscription.mealKind)
      if (row === undefined) continue
      const late = cancelled.get(subscription.id)
      if (late === true) {
        row.lateCancelled += 1
        continue
      }
      if (late === false) {
        row.cancelled += 1
        continue
      }
      row.total += 1
      bump(row.diets, subscription.dietType)
      const key = subscription.classId ?? ''
      const entry = classes.get(key) ?? { classId: subscription.classId, meals: [] }
      let meal = entry.meals.find((item) => item.mealKind === subscription.mealKind)
      if (meal === undefined) {
        meal = { mealKind: subscription.mealKind, total: 0, diets: emptyDiets() }
        entry.meals.push(meal)
      }
      meal.total += 1
      bump(meal.diets, subscription.dietType)
      classes.set(key, entry)
    }
  }
  for (const entry of classes.values())
    entry.meals.sort((a, b) => MEAL_KINDS.indexOf(a.mealKind) - MEAL_KINDS.indexOf(b.mealKind))
  return {
    date,
    holidayTitle: checks.holidayTitle,
    meals: [...meals.values()],
    classes: [...classes.values()],
  }
}

export interface MealMonthSummary {
  /** Ayda aboneliğin yemek günü olan, tatil olmayan günler (gelecek günler planlıdır). */
  subscribedDays: number
  /** Ayda yemek gününe denk gelen kurum tatili. */
  holidayDays: number
  /** Kesimden önce iptal edilen günler; iade/mahsup için gün sayısı budur (H-119). */
  cancelledDays: number
  /** Kesimden sonra okulun iptal ettiği günler; iade/mahsuba girmez. */
  lateCancelledDays: number
  /** Yemek verilen (ya da verilecek) gün: abone olunan − iptal − geç iptal. */
  mealDays: number
  /** İade ya da mahsup edilecek gün (= kesimden önce iptal). Tutar ON-087 ile hesaplanır. */
  refundableDays: number
}

/**
 * Aylık gün özeti (K-549): aboneliğin ay içindeki yemek günleri; tatil abone olunan güne girmez,
 * iptal ve geç iptal ayrı sayılır. Tutar hesaplanmaz.
 */
export function mealMonthSummary(
  month: string,
  subscription: { startDate: string; endDate: string; weekdays: readonly number[] },
  checks: {
    holidays: ReadonlyMap<string, string>
    cancellations: readonly { mealDate: string; late: boolean }[]
  },
): MealMonthSummary {
  const { from, to } = monthRange(month)
  const cancelled = new Map(checks.cancellations.map((row) => [row.mealDate, row.late]))
  const summary: MealMonthSummary = {
    subscribedDays: 0,
    holidayDays: 0,
    cancelledDays: 0,
    lateCancelledDays: 0,
    mealDays: 0,
    refundableDays: 0,
  }
  for (const day of daysBetween(from, to)) {
    if (!isSubscribedDay(subscription, day)) continue
    if (checks.holidays.has(day)) {
      summary.holidayDays += 1
      continue
    }
    summary.subscribedDays += 1
    const late = cancelled.get(day)
    if (late === true) summary.lateCancelledDays += 1
    else if (late === false) summary.cancelledDays += 1
  }
  summary.mealDays = summary.subscribedDays - summary.cancelledDays - summary.lateCancelledDays
  summary.refundableDays = summary.cancelledDays
  return summary
}

/** Hafta günleri metni: `Pzt, Sal, Çar` ya da `Hafta içi`, `Her gün`. */
export function mealWeekdaysText(weekdays: readonly number[]): string {
  const ordered = orderedWeekdays(weekdays)
  if (ordered.length === 7) return 'Her gün'
  if (ordered.join(',') === '1,2,3,4,5') return 'Hafta içi'
  return ordered.map((day) => MEAL_WEEKDAY_SHORT_LABELS[day]).join(', ')
}

/** Kesim metni: `Bir gün önce, saat 15:00` ya da `Aynı gün, saat 09:00`. */
export function mealCutoffText(cutoff: MealCutoff): string {
  const when =
    cutoff.cutoffDaysBefore === 0
      ? 'Aynı gün'
      : cutoff.cutoffDaysBefore === 1
        ? 'Bir gün önce'
        : `${String(cutoff.cutoffDaysBefore)} gün önce`
  return `${when}, saat ${cutoff.cutoffTime}`
}
