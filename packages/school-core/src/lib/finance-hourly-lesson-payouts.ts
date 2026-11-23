import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import type { Course } from './courses.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { istanbulInstant } from './finance-infirmary-schedule.ts'
import {
  LESSON_HOUR_MINUTES,
  LESSON_ITEM_STATUSES,
  dayInRanges,
  lessonItemsFor,
  makeupLinks,
  type LessonItemInput,
  type LessonItemKind,
  type LessonItemStatus,
} from './finance-lesson-hour-suggestions.ts'
import { addDays } from './finance-opening-watch.ts'
import {
  WAGE_TYPE_LABELS,
  payRateUnitLabel,
  wageOn,
  type PayRateComponent,
} from './finance-pay-rates.ts'
import { payrollMonthRange } from './finance-payroll-exports.ts'
import { STAFF_SELF_SERVICE_ROLES } from './finance-staff-self-service.ts'
import { dayKey, money, timeLabel } from './format.ts'
import { groupSessions, type LanguageGroup } from './language-groups.ts'

/**
 * Saat ücretli öğretmenin ders saati hakediş dökümü (docs/domain/finans.md DOM-FIN-167; ON-075;
 * IST-087; K-556…K-558). Ay için saat ya da ders saati ücretli öğretmen başına gün gün ders listesi
 * (sınıf ya da grup, ders, süre, durum), verilen saat, iptal ve telafi sayıları ve ücret
 * tanımından tutar. Döküm saklanmaz, her okumada hesaplanır; bordroya aktarılmaz (K-558).
 *
 * - **Kaynak (K-557):** ders programı (`schedule`; iki kurum türünde de): ders durumları programdan
 *   ek ders önerisiyle (DOM-FIN-165, K-550) aynı kuralla belirlenir (iptal, tatil, izinli, yedeğe
 *   devredildi, henüz yapılmadı; yedek ve telafi). Dil okulunda ayrıca açılmış grupların haftalık
 *   kalıbından üretilen oturumlar (`language_groups`, plandan): grup iptal edildiyse iptal anından
 *   sonraki oturum iptaldir; oturum başına iptal, yedek ve telafi kaydı yoktur. Öğretmenin aynı
 *   saatte ders programında dersi varsa grup oturumu sayılmaz (çift sayım olmasın).
 * - **Tutar (K-556):** yalnız verilen ders ödenir. Her satır dersin gününde yürürlükteki ana ücret
 *   tanımıyla fiyatlanır (ay içinde ücret değişirse satır bazında): ders saati ücreti × ders saati
 *   sayısı; saatlik ücret × dakika ÷ 60 (satır başına kuruşa yuvarlanır). O gün ana ücret yoksa ya
 *   da ana ücret aylıksa satırın tutarı boştur ve uyarılır. İptal edilen ders ödenmez; telafi dersi
 *   verilen ders gibi ödenir; yedeğe devredilen ders asıl öğretmene ödenmez, yedek öğretmene ödenir
 *   (doğrulanmalı, H-122).
 * - **Kapsam:** ayla kesişen ana ücret tanımlarından en az biri saatlik ya da ders saati ücreti olan
 *   ya da ayda hiç ana ücret tanımı olmayan (uyarılı) öğretmen; ayda dersi olmayan öğretmen
 *   dökümde yer almaz. Aylık ücretli öğretmenin ek dersi DOM-FIN-165'tedir.
 *
 * Fonksiyonlar saftır.
 */

/** Bütün öğretmenlerin dökümü yalnız yöneticide (muhasebe rolü yok; K-558). */
export const HOURLY_PAYOUT_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Kendi dökümü: kurum personeli (DOM-FIN-166 self-servisi). */
export const HOURLY_PAYOUT_SELF_ROLES = STAFF_SELF_SERVICE_ROLES

/** Dil okulu ders saati dakikası (DOM-DIL-002: 45 dakikalık oturum 1, 90 dakikalık 2 ders saati). */
export const GROUP_LESSON_HOUR_MINUTES = 45
/** Telafi bağı çıkarımı için ayın başından geriye okunan gün (önceki ayda iptal edilen ders). */
export const PAYOUT_LOOKBACK_DAYS = 35

export const HOURLY_PAYOUT_NOTE =
  'Döküm ders programından (dil okulunda ayrıca grup planından) her okumada hesaplanır, saklanmaz ve bordroya aktarılmaz. Yalnız verilen ders ödenir: iptal edilen ders ödenmez, telafi dersi verilen ders gibi ödenir (doğrulanmalı).'

// --- Şemalar -------------------------------------------------------------------------------------

export const HOURLY_PAYOUT_PURPOSES = ['view', 'pdf'] as const
export type HourlyPayoutPurpose = (typeof HOURLY_PAYOUT_PURPOSES)[number]

export const hourlyPayoutQuerySchema = z.strictObject({
  purpose: z
    .enum(HOURLY_PAYOUT_PURPOSES, 'Amaç `view` ya da `pdf` olmalıdır.')
    .default('view')
    .describe(
      '`view` ekran, `pdf` PDF verisi (taze oturum, `finance.hourly_lesson_payout.export` denetimi)',
    ),
})

// --- Girdi ---------------------------------------------------------------------------------------

/** Ana ücret tanımı (iptal edilmemiş; ay dışı dahil olabilir). */
export interface PayoutRate {
  component: PayRateComponent
  rateType: string
  amountCents: number
  startDate: string
  endDate: string | null
}

export interface PayoutTeacher {
  membershipId: string
  /** Üyeliğe bağlı ders programı öğretmen kayıtları. */
  teacherIds: readonly string[]
  rates: readonly PayoutRate[]
}

/** Dil okulu grubunun plandan üretilen oturumu. */
export interface PayoutGroupSession {
  id: string
  groupId: string
  teacherMembershipId: string
  day: string
  startsAt: string
  minutes: number
  /** Kur adı. */
  title: string | null
  /** Grup iptal edildi ve oturum iptal anından sonra. */
  cancelled: boolean
}

export interface HourlyPayoutInput extends LessonItemInput {
  month: string
  teachers: readonly PayoutTeacher[]
  groupSessions: readonly PayoutGroupSession[]
}

type PayoutGroup = Pick<
  LanguageGroup,
  | 'id'
  | 'courseId'
  | 'teacherMembershipId'
  | 'schedule'
  | 'startDate'
  | 'endDate'
  | 'state'
  | 'openedAt'
  | 'cancelledAt'
>

/**
 * Açılmış grupların aralıktaki oturumları (K-557). Hiç açılmamış grup (planlı ya da açılmadan
 * iptal edilen) ve öğretmeni olmayan grup oturum üretmez. Saat Europe/Istanbul duvar saatidir.
 */
export function groupPayoutSessions(
  groups: readonly PayoutGroup[],
  courses: readonly Pick<Course, 'id' | 'name' | 'totalHours' | 'sessionMinutes'>[],
  range: { from: string; to: string },
): PayoutGroupSession[] {
  const byId = new Map(courses.map((course) => [course.id, course]))
  const sessions: PayoutGroupSession[] = []
  for (const group of groups) {
    const course = byId.get(group.courseId)
    if (
      course === undefined ||
      group.teacherMembershipId === null ||
      group.openedAt === null ||
      group.startDate > range.to ||
      group.endDate < range.from
    )
      continue
    for (const session of groupSessions(group, course)) {
      if (session.date < range.from || session.date > range.to) continue
      const startsAt = istanbulInstant(session.date, session.startTime)
      sessions.push({
        id: `group:${group.id}:${session.date}:${session.startTime}`,
        groupId: group.id,
        teacherMembershipId: group.teacherMembershipId,
        day: session.date,
        startsAt,
        minutes: course.sessionMinutes,
        title: course.name,
        cancelled:
          group.state === 'cancelled' &&
          group.cancelledAt !== null &&
          startsAt >= group.cancelledAt,
      })
    }
  }
  return sessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
}

/** Yüklenecek ders programı aralığı: telafi bağı için ayın başından {@link PAYOUT_LOOKBACK_DAYS} gün önce. */
export function hourlyPayoutRange(month: string): { from: string; to: string } {
  const range = payrollMonthRange(month)
  return { from: addDays(range.from, -PAYOUT_LOOKBACK_DAYS), to: range.to }
}

// --- Sonuç ---------------------------------------------------------------------------------------

export const PAYOUT_LINE_STATUSES = [...LESSON_ITEM_STATUSES, 'duplicate'] as const
export type PayoutLineStatus = LessonItemStatus | 'duplicate'
export const PAYOUT_LINE_STATUS_LABELS = {
  counted: 'Verildi',
  cancelled: 'İptal edildi',
  holiday: 'Tatil',
  leave: 'Öğretmen izinli',
  substituted_out: 'Yedeğe devredildi',
  upcoming: 'Henüz yapılmadı',
  duplicate: 'Programda aynı saatte ders var; sayılmadı',
} as const satisfies Record<PayoutLineStatus, string>

export const PAYOUT_LINE_KINDS = ['own', 'substitute', 'makeup', 'group'] as const
export type PayoutLineKind = LessonItemKind | 'group'
export const PAYOUT_LINE_KIND_LABELS = {
  own: 'Kendi dersi',
  substitute: 'Yedek ders',
  makeup: 'Telafi dersi',
  group: 'Grup dersi (plandan)',
} as const satisfies Record<PayoutLineKind, string>

/** Verilen dersin neden tutarsız kaldığı. */
export const PAYOUT_UNPRICED = ['no_rate', 'monthly'] as const
export type PayoutUnpriced = (typeof PAYOUT_UNPRICED)[number]
export const PAYOUT_UNPRICED_LABELS = {
  no_rate: 'O gün ana ücret tanımı yok',
  monthly: 'O gün ana ücret aylık',
} as const satisfies Record<PayoutUnpriced, string>

export const PAYOUT_RATE_TYPES = ['hourly', 'lesson_hour'] as const
export type PayoutRateType = (typeof PAYOUT_RATE_TYPES)[number]

export interface PayoutLine {
  lessonId: string
  source: 'schedule' | 'group'
  day: string
  startsAt: string
  minutes: number
  /** Ders saati sayısı: programda 40, grupta 45 dakika (en az 1). */
  hours: number
  classId: string | null
  groupId: string | null
  subjectId: string | null
  title: string | null
  status: PayoutLineStatus
  kind: PayoutLineKind
  makeupForLessonId: string | null
  holidayTitle: string | null
  /** Sınıfın o günü yoklaması alınmadı (yalnız verilen program dersinde; yoksa boş). */
  attendanceMissing: boolean | null
  rateType: PayoutRateType | null
  rateCents: number | null
  amountCents: number | null
  unpriced: PayoutUnpriced | null
}

export interface PayoutTotals {
  lessons: number
  givenLessons: number
  givenHours: number
  givenMinutes: number
  ownHours: number
  substituteHours: number
  makeupLessons: number
  makeupHours: number
  groupHours: number
  cancelledLessons: number
  cancelledHours: number
  substitutedOutLessons: number
  holidayLessons: number
  leaveLessons: number
  upcomingLessons: number
  duplicateLessons: number
  attendanceMissingLessons: number
  /** Fiyatlanan satırların toplamı (kuruş). */
  amountCents: number
  /** Verilip tutarı hesaplanamayan ders saati. */
  unpricedHours: number
}

/** Ay içinde uygulanan ücret tanımı başına kırılım (ücret değişirse birden çok satır). */
export interface PayoutRateBreakdown {
  rateType: PayoutRateType
  rateCents: number
  startDate: string
  endDate: string | null
  lessons: number
  hours: number
  minutes: number
  amountCents: number
}

export const PAYOUT_PAY_BASES = ['hourly', 'mixed', 'unknown'] as const
export type PayoutPayBasis = (typeof PAYOUT_PAY_BASES)[number]
export const PAYOUT_PAY_BASIS_LABELS = {
  hourly: 'Saat ya da ders saati ücretli',
  mixed: 'Ay içinde aylık ve saat ücreti',
  unknown: 'Ana ücret tanımı yok',
} as const satisfies Record<PayoutPayBasis, string>

export const PAYOUT_WARNINGS = [
  'no_pay_rate',
  'rate_gap',
  'monthly_days',
  'attendance_missing',
  'group_plan',
  'duplicate',
] as const
export type PayoutWarning = (typeof PAYOUT_WARNINGS)[number]
export const PAYOUT_WARNING_LABELS = {
  no_pay_rate: 'Ayda ana ücret tanımı yok; tutar hesaplanmadı',
  rate_gap: 'Bazı ders günlerinde ana ücret tanımı yok; o derslerin tutarı boş',
  monthly_days: 'Bazı ders günlerinde ana ücret aylık; o dersler dökümde ödenmez',
  attendance_missing: 'Bazı ders günlerinde sınıfın yoklaması alınmamış',
  group_plan: 'Grup dersleri plandan; oturum iptali ve telafisi bilinmiyor',
  duplicate: 'Ders programıyla aynı saatteki grup oturumu sayılmadı',
} as const satisfies Record<PayoutWarning, string>

export interface TeacherPayout {
  membershipId: string
  payBasis: PayoutPayBasis
  totals: PayoutTotals
  rates: PayoutRateBreakdown[]
  /** Ayın dersi olan günleri, gün sırasıyla. */
  days: { day: string; lines: PayoutLine[] }[]
  warnings: PayoutWarning[]
}

export interface HourlyPayout {
  month: string
  monthComplete: boolean
  attendanceKnown: boolean
  teachers: TeacherPayout[]
}

// --- Hesap ---------------------------------------------------------------------------------------

const MINUTE_MS = 60_000
const isPayoutRateType = (value: string): value is PayoutRateType =>
  (PAYOUT_RATE_TYPES as readonly string[]).includes(value)

const overlapsMonth = (rate: PayoutRate, range: { from: string; to: string }) =>
  rate.startDate <= range.to && (rate.endDate === null || rate.endDate >= range.from)

/** Öğretmenin ayla kesişen ana ücretlerinden türü; aylık-yalnız öğretmen `null` (dökümde yok). */
export function payoutPayBasis(rates: readonly PayoutRate[], month: string): PayoutPayBasis | null {
  const range = payrollMonthRange(month)
  const wages = rates.filter((rate) => rate.component === 'wage' && overlapsMonth(rate, range))
  if (wages.length === 0) return 'unknown'
  const hourly = wages.filter((rate) => isPayoutRateType(rate.rateType)).length
  if (hourly === 0) return null
  return hourly === wages.length ? 'hourly' : 'mixed'
}

/**
 * Verilen dersin tutarı (K-556): dersin günündeki ana ücret tanımı. Ders saati ücreti × ders saati,
 * saatlik ücret × dakika ÷ 60 (kuruşa yuvarlanır). Tanım yoksa ya da aylıksa tutar boştur.
 */
export function priceLine(
  rates: readonly PayoutRate[],
  line: Pick<PayoutLine, 'day' | 'hours' | 'minutes'>,
): Pick<PayoutLine, 'rateType' | 'rateCents' | 'amountCents' | 'unpriced'> & {
  rate: PayoutRate | null
} {
  const wage = wageOn(rates, line.day)
  if (wage === null)
    return { rate: null, rateType: null, rateCents: null, amountCents: null, unpriced: 'no_rate' }
  if (!isPayoutRateType(wage.rateType))
    return { rate: null, rateType: null, rateCents: null, amountCents: null, unpriced: 'monthly' }
  const amountCents =
    wage.rateType === 'lesson_hour'
      ? wage.amountCents * line.hours
      : Math.round((wage.amountCents * line.minutes) / 60)
  return {
    rate: wage,
    rateType: wage.rateType,
    rateCents: wage.amountCents,
    amountCents,
    unpriced: null,
  }
}

const emptyTotals = (): PayoutTotals => ({
  lessons: 0,
  givenLessons: 0,
  givenHours: 0,
  givenMinutes: 0,
  ownHours: 0,
  substituteHours: 0,
  makeupLessons: 0,
  makeupHours: 0,
  groupHours: 0,
  cancelledLessons: 0,
  cancelledHours: 0,
  substitutedOutLessons: 0,
  holidayLessons: 0,
  leaveLessons: 0,
  upcomingLessons: 0,
  duplicateLessons: 0,
  attendanceMissingLessons: 0,
  amountCents: 0,
  unpricedHours: 0,
})

const STATUS_COUNT = {
  cancelled: 'cancelledLessons',
  holiday: 'holidayLessons',
  leave: 'leaveLessons',
  substituted_out: 'substitutedOutLessons',
  upcoming: 'upcomingLessons',
  duplicate: 'duplicateLessons',
} as const satisfies Record<Exclude<PayoutLineStatus, 'counted'>, keyof PayoutTotals>

const KIND_HOURS = {
  own: 'ownHours',
  substitute: 'substituteHours',
  makeup: 'makeupHours',
  group: 'groupHours',
} as const satisfies Record<PayoutLineKind, keyof PayoutTotals>

const groupHourCount = (minutes: number) =>
  Math.max(1, Math.floor(minutes / GROUP_LESSON_HOUR_MINUTES))

const unpricedLine = { rateType: null, rateCents: null, amountCents: null, unpriced: null }

/** Ders programı satırları (K-550 durumları) ve aynı öğretmenin grup oturumları (K-557). */
function teacherLines(
  teacher: PayoutTeacher,
  input: HourlyPayoutInput,
  makeups: ReadonlyMap<string, string>,
  inMonth: (day: string) => boolean,
): PayoutLine[] {
  const lessons = new Map(input.lessons.map((lesson) => [lesson.id, lesson]))
  const scheduled: PayoutLine[] = lessonItemsFor(teacher, input, makeups)
    .filter((item) => inMonth(item.day))
    .map((item) => {
      const duration = lessons.get(item.lessonId)?.duration ?? 0
      return {
        lessonId: item.lessonId,
        source: 'schedule',
        day: item.day,
        startsAt: item.startsAt,
        minutes: duration > 0 ? duration : LESSON_HOUR_MINUTES,
        hours: item.hours,
        classId: item.classId === '' ? null : item.classId,
        groupId: null,
        subjectId: item.subjectId === '' ? null : item.subjectId,
        title: item.title,
        status: item.status,
        kind: item.kind,
        makeupForLessonId: item.makeupForLessonId,
        holidayTitle: item.holidayTitle,
        attendanceMissing: item.attendanceMissing,
        ...unpricedLine,
      }
    })
  // Grup oturumu, öğretmenin aynı saatteki program dersiyle çakışırsa sayılmaz (çift sayım).
  const busy = scheduled
    .filter((line) => line.status !== 'substituted_out' && line.status !== 'cancelled')
    .map((line) => {
      const start = Date.parse(line.startsAt)
      return { start, end: start + line.minutes * MINUTE_MS }
    })
  const now = Date.parse(input.now)
  const absences = input.absences.filter((item) => item.membershipId === teacher.membershipId)
  const grouped: PayoutLine[] = input.groupSessions
    .filter((session) => session.teacherMembershipId === teacher.membershipId)
    .filter((session) => inMonth(session.day))
    .map((session) => {
      const start = Date.parse(session.startsAt)
      const end = start + session.minutes * MINUTE_MS
      const holiday = dayInRanges(session.day, input.holidays)
      const status: PayoutLineStatus = session.cancelled
        ? 'cancelled'
        : holiday !== undefined
          ? 'holiday'
          : dayInRanges(session.day, absences) !== undefined
            ? 'leave'
            : busy.some((slot) => slot.start < end && start < slot.end)
              ? 'duplicate'
              : end > now
                ? 'upcoming'
                : 'counted'
      return {
        lessonId: session.id,
        source: 'group',
        day: session.day,
        startsAt: session.startsAt,
        minutes: session.minutes,
        hours: groupHourCount(session.minutes),
        classId: null,
        groupId: session.groupId,
        subjectId: null,
        title: session.title,
        status,
        kind: 'group',
        makeupForLessonId: null,
        holidayTitle: holiday?.title ?? null,
        attendanceMissing: null,
        ...unpricedLine,
      }
    })
  return [...scheduled, ...grouped].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.lessonId.localeCompare(b.lessonId),
  )
}

function teacherPayout(
  teacher: PayoutTeacher,
  payBasis: PayoutPayBasis,
  input: HourlyPayoutInput,
  makeups: ReadonlyMap<string, string>,
): TeacherPayout | null {
  const range = payrollMonthRange(input.month)
  const inMonth = (day: string) => range.from <= day && day <= range.to
  const lines = teacherLines(teacher, input, makeups, inMonth)
  if (lines.length === 0) return null
  const totals = emptyTotals()
  const breakdown = new Map<PayoutRate, PayoutRateBreakdown>()
  const warnings = new Set<PayoutWarning>()
  if (payBasis === 'unknown') warnings.add('no_pay_rate')
  const days = new Map<string, PayoutLine[]>()
  for (const line of lines) {
    const list = days.get(line.day) ?? []
    list.push(line)
    days.set(line.day, list)
    totals.lessons += 1
    if (line.kind === 'group') warnings.add('group_plan')
    if (line.status !== 'counted') {
      totals[STATUS_COUNT[line.status]] += 1
      if (line.status === 'cancelled') totals.cancelledHours += line.hours
      if (line.status === 'duplicate') warnings.add('duplicate')
      continue
    }
    totals.givenLessons += 1
    totals.givenHours += line.hours
    totals.givenMinutes += line.minutes
    totals[KIND_HOURS[line.kind]] += line.hours
    if (line.kind === 'makeup') totals.makeupLessons += 1
    if (line.attendanceMissing === true) {
      totals.attendanceMissingLessons += 1
      warnings.add('attendance_missing')
    }
    const { rate, ...price } = priceLine(teacher.rates, line)
    Object.assign(line, price)
    if (rate === null || price.rateType === null || price.amountCents === null) {
      totals.unpricedHours += line.hours
      if (payBasis !== 'unknown')
        warnings.add(price.unpriced === 'monthly' ? 'monthly_days' : 'rate_gap')
      continue
    }
    totals.amountCents += price.amountCents
    const entry = breakdown.get(rate) ?? {
      rateType: price.rateType,
      rateCents: rate.amountCents,
      startDate: rate.startDate,
      endDate: rate.endDate,
      lessons: 0,
      hours: 0,
      minutes: 0,
      amountCents: 0,
    }
    entry.lessons += 1
    entry.hours += line.hours
    entry.minutes += line.minutes
    entry.amountCents += price.amountCents
    breakdown.set(rate, entry)
  }
  return {
    membershipId: teacher.membershipId,
    payBasis,
    totals,
    rates: [...breakdown.values()].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    days: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, list]) => ({ day, lines: list })),
    warnings: PAYOUT_WARNINGS.filter((code) => warnings.has(code)),
  }
}

/**
 * Ayın dökümü (K-556, K-557). Aylık-yalnız öğretmen ve ayda dersi olmayan öğretmen sonuçta yer
 * almaz. Girdi değişmez.
 */
export function hourlyLessonPayout(input: HourlyPayoutInput): HourlyPayout {
  const range = payrollMonthRange(input.month)
  const makeups = makeupLinks(input.lessons)
  const teachers = input.teachers
    .flatMap((teacher) => {
      const basis = payoutPayBasis(teacher.rates, input.month)
      if (basis === null) return []
      const payout = teacherPayout(teacher, basis, input, makeups)
      return payout === null ? [] : [payout]
    })
    .sort((a, b) => a.membershipId.localeCompare(b.membershipId))
  return {
    month: input.month,
    monthComplete: dayKey(input.now) > range.to,
    attendanceKnown: input.attendanceDays !== null,
    teachers,
  }
}

// --- Dışa aktarım --------------------------------------------------------------------------------

const MONTH_NAMES = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
] as const

/** "Eylül 2026". */
export function payoutMonthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number) as [number, number]
  return `${MONTH_NAMES[index - 1] ?? ''} ${String(year)}`
}

/** `ders-saati-hakedis-2026-09.csv`. */
export const hourlyPayoutFilename = (month: string, extension: 'csv' | 'pdf') =>
  `ders-saati-hakedis-${month}.${extension}`

/** Birim ücret metni: "450,00 ₺ ders saati başı"; ücret yoksa boş. */
export function payoutRateText(rateType: PayoutRateType | null, rateCents: number | null): string {
  if (rateType === null || rateCents === null) return ''
  return `${money(rateCents)} ${payRateUnitLabel('wage', rateType)}`
}

export interface PayoutCsvTeacher {
  staffName: string
  totals: Pick<PayoutTotals, 'givenHours' | 'cancelledLessons' | 'makeupLessons' | 'amountCents'>
  days: readonly { lines: readonly (PayoutLine & { placeName: string | null })[] }[]
}

const CSV_HEADER = [
  'Öğretmen',
  'Gün',
  'Başlangıç',
  'Sınıf / grup',
  'Ders',
  'Tür',
  'Durum',
  'Dakika',
  'Ders saati',
  'Ücret türü',
  'Birim ücret',
  'Tutar',
  'Not',
] as const

const lineNote = (line: PayoutLine) =>
  [
    line.holidayTitle,
    line.unpriced === null ? null : PAYOUT_UNPRICED_LABELS[line.unpriced],
    line.attendanceMissing === true ? 'Yoklama alınmamış' : null,
  ]
    .filter((part) => part !== null)
    .join(' | ')

/**
 * CSV (`;`, ondalık virgül, formül kaçışı): ders başına satır, öğretmen başına toplam satırı ve
 * ilke notu. BOM'u rota ekler.
 */
export function hourlyPayoutCsv(teachers: readonly PayoutCsvTeacher[]): string {
  const blank = csvCell('')
  const filler = (count: number) => Array<string>(count).fill(blank)
  const rows: string[][] = []
  for (const teacher of teachers) {
    for (const day of teacher.days)
      for (const line of day.lines)
        rows.push([
          csvCell(teacher.staffName),
          csvCell(line.day),
          csvCell(timeLabel(line.startsAt)),
          csvCell(line.placeName ?? ''),
          csvCell(line.title ?? ''),
          csvCell(PAYOUT_LINE_KIND_LABELS[line.kind]),
          csvCell(PAYOUT_LINE_STATUS_LABELS[line.status]),
          csvCell(line.minutes),
          csvCell(line.hours),
          csvCell(line.rateType === null ? '' : WAGE_TYPE_LABELS[line.rateType]),
          line.rateCents === null ? blank : csvAmount(line.rateCents),
          line.amountCents === null ? blank : csvAmount(line.amountCents),
          csvCell(lineNote(line)),
        ])
    rows.push([
      csvCell(`${teacher.staffName} toplamı`),
      ...filler(5),
      csvCell(
        `${String(teacher.totals.cancelledLessons)} iptal, ${String(teacher.totals.makeupLessons)} telafi`,
      ),
      blank,
      csvCell(teacher.totals.givenHours),
      ...filler(2),
      csvAmount(teacher.totals.amountCents),
      blank,
    ])
  }
  const note = [csvCell(HOURLY_PAYOUT_NOTE), ...filler(CSV_HEADER.length - 1)]
  return [CSV_HEADER.map(csvCell), ...rows, note].map((row) => row.join(CSV_SEPARATOR)).join('\r\n')
}
