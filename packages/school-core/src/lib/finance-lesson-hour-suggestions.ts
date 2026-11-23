import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { addDays } from './finance-opening-watch.ts'
import { PAYROLL_LESSON_HOURS_MAX, payrollMonthRange } from './finance-payroll-exports.ts'
import { PAYROLL_REASON_MAX, PAYROLL_REASON_MIN } from './finance-payroll-periods.ts'
import { staffingWeek } from './finance-staffing-plans.ts'
import { dayKey } from './format.ts'

/**
 * Programdan ek ders önerisi (docs/domain/finans.md DOM-FIN-165; ON-195; IST-087 genişlemesi;
 * K-550…K-552). Ayın ek ders saati bugün elle girilir (DOM-FIN-105, K-337) ve çizelgeyle onaylanır
 * (DOM-FIN-120). Bu modül saati ders programından **önerir**; öneri saklanmaz, yönetici onu elle
 * girişe aktarır ya da düzeltir.
 *
 * - **Sayım (K-550):** öğretmen başına ders programındaki her ders kaydı ders süresinin 40 dakikalık
 *   ders saati sayısı kadar (en az 1) sayılır. İptal edilen ders, kurum tatiline (okul takvimi,
 *   K-545) denk gelen ders, öğretmenin izinli ya da raporlu olduğu gündeki kendi dersi ve henüz
 *   bitmemiş ders sayılmaz. Yedek atanan ders yalnız yedek öğretmene sayılır; asıl öğretmende
 *   "yedeğe devredildi" görünür. Telafi dersi kendi kaydıyla sayılır; telafi bağı dersin
 *   `makeupForLessonId` alanından, yoksa aynı sınıf ve dersin iptalinden sonra açılan dersten
 *   çıkarılır (yalnız gösterim). Gün bazlı yoklama (sınıfın o günü) alınmadıysa ders yine sayılır
 *   ama işaretlenir.
 * - **Maaş karşılığı ve üst sınır (K-551):** sayım hafta hafta (Europe/Istanbul pazartesi–pazar)
 *   yapılır. Haftanın ilk dersinden başlayarak ilk `weeklyLoad` saat maaş karşılığıdır (varsayılan
 *   15), sonrası haftada toplam `weeklyCap` saate kadar (varsayılan 30) ek derstir, üstü sayılmaz.
 *   Ay sonunu kesen haftada her ek ders saati dersin günüyle kendi ayına yazılır. Saat ya da ders
 *   saati ücretli öğretmene (ana ücret tanımı saatlik) öneri verilmez; ücret tanımı olmayan öğretmen
 *   aylık sayılır ve uyarı taşır. Öneri yalnız `extra` (ek ders) türündedir; nöbet elle girilir.
 * - **Aktarım (K-552):** öneri tek tıkla elle girişe yazılır (kayıt yoksa açılır, varsa saati
 *   düzeltilir); öneriden farklı saat gerekçe ister (5–500). Ekrandaki öneri sunucudakiyle aynı
 *   olmalıdır (409 `lesson_suggestion_changed`). Müdür onaylı ya da bordro dönemi kilitli ayda
 *   aktarım yoktur (K-410). Her aktarım önerilen, önceki ve yazılan saati gerekçesiyle değişmez
 *   satır olarak saklar.
 *
 * Fonksiyonlar saftır.
 */

/** Öneri ve aktarım yalnız yöneticide (K-552): döküm öğretmenin izin ve rapor günlerini ele verir. */
export const LESSON_SUGGESTION_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** Ders saati dakikası (MEB ortaöğretim ders saati). */
export const LESSON_HOUR_MINUTES = 40
export const WEEKLY_LOAD_DEFAULT = 15
export const WEEKLY_LOAD_MAX = 40
export const WEEKLY_CAP_DEFAULT = 30
export const WEEKLY_CAP_MAX = 60
export const LESSON_SUGGESTION_ITEMS_MAX = 200

// --- Şemalar -------------------------------------------------------------------------------------

/** Sorguda metinden sayıya çevrilir; gövdede sayı beklenir. */
const weeklyLoadSchema = (coerce: boolean) =>
  (coerce ? z.coerce.number() : z.number('Maaş karşılığı haftalık ders saatini girin.'))
    .int('Maaş karşılığı ders saati tam sayı olmalıdır.')
    .min(0, 'Maaş karşılığı ders saati eksi olamaz.')
    .max(WEEKLY_LOAD_MAX, `Maaş karşılığı ders saati en fazla ${String(WEEKLY_LOAD_MAX)} olabilir.`)
    .describe('Maaş karşılığı haftalık ders saati (0–40, varsayılan 15)')
const weeklyCapSchema = (coerce: boolean) =>
  (coerce ? z.coerce.number() : z.number('Haftalık ders üst sınırını girin.'))
    .int('Haftalık üst sınır tam sayı olmalıdır.')
    .min(1, 'Haftalık üst sınır en az 1 olmalıdır.')
    .max(WEEKLY_CAP_MAX, `Haftalık üst sınır en fazla ${String(WEEKLY_CAP_MAX)} olabilir.`)
    .describe('Maaş karşılığı dahil haftalık toplam ders üst sınırı (1–60, varsayılan 30)')

const capNotBelowLoad = (value: { weeklyLoad: number; weeklyCap: number }) =>
  value.weeklyCap >= value.weeklyLoad
const CAP_MESSAGE = {
  message: 'Haftalık üst sınır maaş karşılığı ders saatinden az olamaz.',
  path: ['weeklyCap'],
}

/** Öneri parametreleri (sorgu). */
export const lessonSuggestionQuerySchema = z
  .strictObject({
    weeklyLoad: weeklyLoadSchema(true).default(WEEKLY_LOAD_DEFAULT),
    weeklyCap: weeklyCapSchema(true).default(WEEKLY_CAP_DEFAULT),
  })
  .refine(capNotBelowLoad, CAP_MESSAGE)
export type LessonSuggestionParams = z.output<typeof lessonSuggestionQuerySchema>

const reasonSchema = z
  .string('Gerekçeyi yazın.')
  .trim()
  .max(PAYROLL_REASON_MAX, `Gerekçe en fazla ${String(PAYROLL_REASON_MAX)} karakter olabilir.`)
  .transform((value) => (value === '' ? null : value))
  .refine((value) => value === null || value.length >= PAYROLL_REASON_MIN, {
    message: `Gerekçe en az ${String(PAYROLL_REASON_MIN)} karakter olmalıdır.`,
  })
  .nullable()
  .describe('Öneriden farklı saatte zorunlu gerekçe (5–500)')

export const lessonSuggestionTransferItemSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .describe('Öğretmenin kurum üyeliği'),
  suggestedHours: z
    .number('Önerilen saati gönderin.')
    .int('Önerilen saat tam sayı olmalıdır.')
    .min(0, 'Önerilen saat eksi olamaz.')
    .max(PAYROLL_LESSON_HOURS_MAX, 'Önerilen saat geçersiz.')
    .describe('Ekranda görülen öneri; sunucudaki öneriyle aynı olmalıdır'),
  hours: z
    .number('Aktarılacak saati girin.')
    .int('Saat tam sayı olmalıdır.')
    .min(1, 'Saat en az 1 olmalıdır.')
    .max(PAYROLL_LESSON_HOURS_MAX, `Saat en fazla ${String(PAYROLL_LESSON_HOURS_MAX)} olabilir.`)
    .describe('Elle girişe yazılacak saat (öneri ya da düzeltilmiş saat)'),
  // kvkk: Ç
  reason: reasonSchema.default(null),
})
export type LessonSuggestionTransferItem = z.output<typeof lessonSuggestionTransferItemSchema>

/** Aktarım gövdesi: öneri parametreleri ve öğretmen başına satırlar (tek ya da toplu). */
export const lessonSuggestionTransferSchema = z
  .strictObject({
    weeklyLoad: weeklyLoadSchema(false),
    weeklyCap: weeklyCapSchema(false),
    items: z
      .array(lessonSuggestionTransferItemSchema)
      .min(1, 'Aktarılacak öğretmeni seçin.')
      .max(
        LESSON_SUGGESTION_ITEMS_MAX,
        `Tek seferde en fazla ${String(LESSON_SUGGESTION_ITEMS_MAX)} öğretmen aktarılır.`,
      ),
  })
  .refine(capNotBelowLoad, CAP_MESSAGE)
  .refine(
    (value) => new Set(value.items.map((item) => item.membershipId)).size === value.items.length,
    { message: 'Aynı öğretmen bir kez aktarılır.', path: ['items'] },
  )
export type LessonSuggestionTransferInput = z.input<typeof lessonSuggestionTransferSchema>
export type LessonSuggestionTransfer = z.output<typeof lessonSuggestionTransferSchema>

// --- Girdi ---------------------------------------------------------------------------------------

/** Ders programındaki ders (yalnız gereken alanlar). */
export interface SuggestionLesson {
  id: string
  /** Başlangıç anı (ISO 8601 UTC). */
  date: string
  /** Dakika. */
  duration: number
  classId: string
  subjectId: string
  title: string | null
  teacherId: string
  originalTeacherId: string | null
  cancelledAt: string | null
  /** Kaydın açıldığı an; telafi çıkarımı için. */
  createdAt: string | null
  /** Açık telafi bağı (ders programında henüz yok; OG-116 iş isteği). */
  makeupForLessonId: string | null
}

export const SUGGESTION_PAY_BASES = ['monthly', 'hourly', 'unknown'] as const
export type SuggestionPayBasis = (typeof SUGGESTION_PAY_BASES)[number]
export const SUGGESTION_PAY_BASIS_LABELS = {
  monthly: 'Aylık ücretli',
  hourly: 'Saat ya da ders saati ücretli',
  unknown: 'Ücret tanımı yok',
} as const satisfies Record<SuggestionPayBasis, string>

/**
 * Öğretmenin ücret türü (K-551): ayla kesişen, en geç başlayan ana ücret tanımı. Saatlik ya da
 * ders saati ücreti saat ücretlidir; aylık brüt ya da net aylıktır; tanım yoksa bilinmez.
 */
export function suggestionPayBasis(
  rates: readonly {
    component: string
    rateType: string
    startDate: string
    endDate: string | null
  }[],
  month: string,
): SuggestionPayBasis {
  const range = payrollMonthRange(month)
  const wage = rates
    .filter(
      (rate) =>
        rate.component === 'wage' &&
        rate.startDate <= range.to &&
        (rate.endDate === null || rate.endDate >= range.from),
    )
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
  if (wage === undefined) return 'unknown'
  return wage.rateType === 'hourly' || wage.rateType === 'lesson_hour' ? 'hourly' : 'monthly'
}

export interface SuggestionTeacher {
  membershipId: string
  /** Üyeliğe bağlı öğretmen kayıtları. */
  teacherIds: readonly string[]
  payBasis: SuggestionPayBasis
}

export interface SuggestionInput {
  month: string
  params: LessonSuggestionParams
  /** Hesap anı (ISO); bitmemiş ders sayılmaz. */
  now: string
  lessons: readonly SuggestionLesson[]
  teachers: readonly SuggestionTeacher[]
  /** Kurum tatilleri (K-545). */
  holidays: readonly { title: string; startDate: string; endDate: string }[]
  /** İzin ve rapor aralıkları (üyelik başına). */
  absences: readonly { membershipId: string; startDate: string; endDate: string }[]
  /** Yoklaması alınmış sınıf günleri (`sınıf|gün`); yoklama okunamıyorsa `null`. */
  attendanceDays: ReadonlySet<string> | null
}

// --- Sonuç ---------------------------------------------------------------------------------------

export const LESSON_ITEM_STATUSES = [
  'counted',
  'cancelled',
  'holiday',
  'leave',
  'substituted_out',
  'upcoming',
] as const
export type LessonItemStatus = (typeof LESSON_ITEM_STATUSES)[number]
export const LESSON_ITEM_STATUS_LABELS = {
  counted: 'Sayıldı',
  cancelled: 'İptal edildi; sayılmadı',
  holiday: 'Tatil; sayılmadı',
  leave: 'Öğretmen izinli; sayılmadı',
  substituted_out: 'Yedeğe devredildi; sayılmadı',
  upcoming: 'Henüz yapılmadı; sayılmadı',
} as const satisfies Record<LessonItemStatus, string>

export const LESSON_ITEM_KINDS = ['own', 'substitute', 'makeup'] as const
export type LessonItemKind = (typeof LESSON_ITEM_KINDS)[number]
export const LESSON_ITEM_KIND_LABELS = {
  own: 'Kendi dersi',
  substitute: 'Yedek ders',
  makeup: 'Telafi dersi',
} as const satisfies Record<LessonItemKind, string>

export interface LessonItem {
  lessonId: string
  day: string
  startsAt: string
  classId: string
  subjectId: string
  title: string | null
  /** Dersin ders saati sayısı (K-550). */
  hours: number
  status: LessonItemStatus
  kind: LessonItemKind
  /** Sayılan dersin maaş karşılığı, ek ders ve üst sınır üstü saatleri (K-551). */
  loadHours: number
  extraHours: number
  overCapHours: number
  /** Sınıfın o günü yoklama alınmadı (`null`: yoklama okunamadı ya da ders sayılmadı). */
  attendanceMissing: boolean | null
  makeupForLessonId: string | null
  /** Tatil adı. */
  holidayTitle: string | null
}

export interface SuggestionWeek {
  startDate: string
  endDate: string
  /** Haftanın bu aya düşen ilk ve son günü. */
  monthFrom: string
  monthTo: string
  countedHours: number
  loadHours: number
  extraHours: number
  overCapHours: number
  /** Ek ders saatinin bu aya düşen kısmı. */
  extraInMonth: number
}

export interface SuggestionTotals {
  countedHours: number
  ownHours: number
  substituteHours: number
  makeupHours: number
  loadHours: number
  extraHours: number
  overCapHours: number
  cancelledHours: number
  holidayHours: number
  leaveHours: number
  substitutedOutHours: number
  upcomingHours: number
  attendanceMissingLessons: number
}

export const SUGGESTION_WARNINGS = ['no_pay_rate', 'over_cap', 'attendance_missing'] as const
export type SuggestionWarning = (typeof SUGGESTION_WARNINGS)[number]
export const SUGGESTION_WARNING_LABELS = {
  no_pay_rate: 'Ana ücret tanımı yok; aylık ücretli sayıldı',
  over_cap: 'Haftalık üst sınırı aşan saat sayılmadı',
  attendance_missing: 'Bazı ders günlerinde sınıfın yoklaması alınmamış',
} as const satisfies Record<SuggestionWarning, string>

export interface TeacherSuggestion {
  membershipId: string
  payBasis: SuggestionPayBasis
  /** Öneri verilir mi (saat ücretlide `false`). */
  applicable: boolean
  /** Önerilen ek ders saati; öneri yoksa `null`. */
  suggestedHours: number | null
  totals: SuggestionTotals
  weeks: SuggestionWeek[]
  /** Ayın günleri (yalnız dersi olan günler), gün sırasıyla. */
  days: { day: string; items: LessonItem[] }[]
  warnings: SuggestionWarning[]
}

export interface UnlinkedTeacher {
  teacherId: string
  countedHours: number
}

export interface LessonSuggestion {
  month: string
  params: LessonSuggestionParams
  /** Yüklenen aralık: ayı kapsayan haftalar. */
  rangeFrom: string
  rangeTo: string
  monthComplete: boolean
  attendanceKnown: boolean
  teachers: TeacherSuggestion[]
  /** Dersi olup personel üyeliğine bağlı olmayan öğretmen kayıtları (aktarılamaz). */
  unlinked: UnlinkedTeacher[]
}

// --- Hesap ---------------------------------------------------------------------------------------

/** Ayı kapsayan haftaların aralığı (pazartesi–pazar): yüklenecek ders ve tatil aralığı. */
export function lessonSuggestionRange(month: string): { from: string; to: string } {
  const range = payrollMonthRange(month)
  return { from: staffingWeek(range.from).startDate, to: staffingWeek(range.to).endDate }
}

/** Dersin ders saati sayısı (K-550): 40 dakikalık ders saati, en az 1. */
export function lessonHourCount(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 1
  return Math.max(1, Math.floor(duration / LESSON_HOUR_MINUTES))
}

const MINUTE_MS = 60_000
const lessonEndMs = (lesson: SuggestionLesson) =>
  Date.parse(lesson.date) +
  (lesson.duration > 0 ? lesson.duration : LESSON_HOUR_MINUTES) * MINUTE_MS

/** Günü kapsayan ilk aralık (başlangıç ve bitiş dahil); tatil ve izin denetimi. */
export const dayInRanges = <T extends { startDate: string; endDate: string }>(
  day: string,
  ranges: readonly T[],
): T | undefined => ranges.find((range) => range.startDate <= day && day <= range.endDate)

/**
 * Telafi bağları (K-550): açık bağ önce; yoksa iptal edilmemiş ders, aynı sınıf ve dersin kendi
 * açılışından önce iptal edilmiş ve kendinden önce başlayan bir dersiyle eşlenir. Her iptal en çok
 * bir telafiye bağlanır; dersler açılış sırasıyla, iptaller ders sırasıyla eşlenir.
 */
export function makeupLinks(lessons: readonly SuggestionLesson[]): Map<string, string> {
  const links = new Map<string, string>()
  const used = new Set<string>()
  for (const lesson of lessons)
    if (lesson.cancelledAt === null && lesson.makeupForLessonId !== null) {
      links.set(lesson.id, lesson.makeupForLessonId)
      used.add(lesson.makeupForLessonId)
    }
  const cancelled = lessons
    .filter((lesson) => lesson.cancelledAt !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const candidates = lessons
    .filter((lesson) => lesson.cancelledAt === null && !links.has(lesson.id))
    .filter((lesson) => lesson.createdAt !== null)
    .sort(
      (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id),
    )
  for (const lesson of candidates) {
    const created = Date.parse(lesson.createdAt ?? '')
    const match = cancelled.find(
      (item) =>
        !used.has(item.id) &&
        item.classId === lesson.classId &&
        item.subjectId === lesson.subjectId &&
        Date.parse(item.cancelledAt ?? '') <= created &&
        item.date < lesson.date,
    )
    if (match === undefined) continue
    links.set(lesson.id, match.id)
    used.add(match.id)
  }
  return links
}

const emptyTotals = (): SuggestionTotals => ({
  countedHours: 0,
  ownHours: 0,
  substituteHours: 0,
  makeupHours: 0,
  loadHours: 0,
  extraHours: 0,
  overCapHours: 0,
  cancelledHours: 0,
  holidayHours: 0,
  leaveHours: 0,
  substitutedOutHours: 0,
  upcomingHours: 0,
  attendanceMissingLessons: 0,
})

const STATUS_TOTAL = {
  cancelled: 'cancelledHours',
  holiday: 'holidayHours',
  leave: 'leaveHours',
  substituted_out: 'substitutedOutHours',
  upcoming: 'upcomingHours',
} as const satisfies Record<Exclude<LessonItemStatus, 'counted'>, keyof SuggestionTotals>

const KIND_TOTAL = {
  own: 'ownHours',
  substitute: 'substituteHours',
  makeup: 'makeupHours',
} as const satisfies Record<LessonItemKind, keyof SuggestionTotals>

/** Ders durumunu belirleyen girdi (öneri ve saat ücreti dökümü ortak kullanır, DOM-FIN-167). */
export type LessonItemInput = Pick<
  SuggestionInput,
  'now' | 'lessons' | 'holidays' | 'absences' | 'attendanceDays'
>

/**
 * Öğretmenin dersleri durumlarıyla (aralığın tamamı; hafta hesabı ay dışını da okur). Sayım kuralı
 * K-550'dir; saat ücreti dökümü (DOM-FIN-167, K-556) aynı durumları kullanır.
 */
export function lessonItemsFor(
  teacher: Pick<SuggestionTeacher, 'membershipId' | 'teacherIds'>,
  input: LessonItemInput,
  makeups: ReadonlyMap<string, string>,
): LessonItem[] {
  const ids = new Set(teacher.teacherIds)
  const now = Date.parse(input.now)
  const absences = input.absences.filter((item) => item.membershipId === teacher.membershipId)
  const items: LessonItem[] = []
  for (const lesson of input.lessons) {
    const current = ids.has(lesson.teacherId)
    const original =
      lesson.originalTeacherId !== null &&
      ids.has(lesson.originalTeacherId) &&
      !ids.has(lesson.teacherId)
    if (!current && !original) continue
    const day = dayKey(lesson.date)
    const holiday = dayInRanges(day, input.holidays)
    const makeupFor = makeups.get(lesson.id) ?? null
    const substitute =
      lesson.originalTeacherId !== null && !ids.has(lesson.originalTeacherId) && current
    const status: LessonItemStatus = original
      ? 'substituted_out'
      : lesson.cancelledAt !== null
        ? 'cancelled'
        : holiday !== undefined
          ? 'holiday'
          : dayInRanges(day, absences) !== undefined
            ? 'leave'
            : lessonEndMs(lesson) > now
              ? 'upcoming'
              : 'counted'
    const attendanceMissing =
      status !== 'counted' || input.attendanceDays === null
        ? null
        : !input.attendanceDays.has(`${lesson.classId}|${day}`)
    items.push({
      lessonId: lesson.id,
      day,
      startsAt: new Date(lesson.date).toISOString(),
      classId: lesson.classId,
      subjectId: lesson.subjectId,
      title: lesson.title,
      hours: lessonHourCount(lesson.duration),
      status,
      kind: substitute ? 'substitute' : makeupFor !== null ? 'makeup' : 'own',
      loadHours: 0,
      extraHours: 0,
      overCapHours: 0,
      attendanceMissing,
      makeupForLessonId: makeupFor,
      holidayTitle: holiday?.title ?? null,
    })
  }
  return items.sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.lessonId.localeCompare(b.lessonId),
  )
}

/**
 * Haftalık dağıtım (K-551): sayılan dersler başlangıç sırasıyla önce maaş karşılığını, sonra
 * üst sınıra kadar ek dersi doldurur; kalan üst sınır üstüdür. Öneri verilmeyen öğretmende
 * dağıtım yapılmaz.
 */
function allocate(items: LessonItem[], params: LessonSuggestionParams, applicable: boolean) {
  const weeks = new Map<string, LessonItem[]>()
  for (const item of items) {
    if (item.status !== 'counted') continue
    const start = staffingWeek(item.day).startDate
    const list = weeks.get(start) ?? []
    list.push(item)
    weeks.set(start, list)
  }
  if (!applicable) return weeks
  const extraLimit = params.weeklyCap - params.weeklyLoad
  for (const list of weeks.values()) {
    let load = 0
    let extra = 0
    for (const item of list) {
      let left = item.hours
      item.loadHours = Math.min(left, Math.max(0, params.weeklyLoad - load))
      load += item.loadHours
      left -= item.loadHours
      item.extraHours = Math.min(left, Math.max(0, extraLimit - extra))
      extra += item.extraHours
      item.overCapHours = left - item.extraHours
    }
  }
  return weeks
}

function teacherSuggestion(
  teacher: SuggestionTeacher,
  input: SuggestionInput,
  makeups: ReadonlyMap<string, string>,
): TeacherSuggestion {
  const range = payrollMonthRange(input.month)
  const inMonth = (day: string) => range.from <= day && day <= range.to
  const applicable = teacher.payBasis !== 'hourly'
  const items = lessonItemsFor(teacher, input, makeups)
  const byWeek = allocate(items, input.params, applicable)
  const totals = emptyTotals()
  const days = new Map<string, LessonItem[]>()
  for (const item of items) {
    if (!inMonth(item.day)) continue
    const list = days.get(item.day) ?? []
    list.push(item)
    days.set(item.day, list)
    if (item.status !== 'counted') {
      totals[STATUS_TOTAL[item.status]] += item.hours
      continue
    }
    totals.countedHours += item.hours
    totals[KIND_TOTAL[item.kind]] += item.hours
    totals.loadHours += item.loadHours
    totals.extraHours += item.extraHours
    totals.overCapHours += item.overCapHours
    if (item.attendanceMissing === true) totals.attendanceMissingLessons += 1
  }
  const weeks = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([startDate, list]): SuggestionWeek[] => {
      const endDate = addDays(startDate, 6)
      const monthFrom = startDate < range.from ? range.from : startDate
      const monthTo = endDate > range.to ? range.to : endDate
      if (monthFrom > monthTo) return []
      const sum = (pick: (item: LessonItem) => number) =>
        list.reduce((total, item) => total + pick(item), 0)
      return [
        {
          startDate,
          endDate,
          monthFrom,
          monthTo,
          countedHours: sum((item) => item.hours),
          loadHours: sum((item) => item.loadHours),
          extraHours: sum((item) => item.extraHours),
          overCapHours: sum((item) => item.overCapHours),
          extraInMonth: sum((item) => (inMonth(item.day) ? item.extraHours : 0)),
        },
      ]
    })
  const warnings: SuggestionWarning[] = []
  if (teacher.payBasis === 'unknown') warnings.push('no_pay_rate')
  if (totals.overCapHours > 0) warnings.push('over_cap')
  if (totals.attendanceMissingLessons > 0) warnings.push('attendance_missing')
  return {
    membershipId: teacher.membershipId,
    payBasis: teacher.payBasis,
    applicable,
    suggestedHours: applicable ? totals.extraHours : null,
    totals,
    weeks,
    days: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, list]) => ({ day, items: list })),
    warnings,
  }
}

/**
 * Ayın önerisi (K-550, K-551). Girdi değişmez; sonuç her okumada yeniden hesaplanır. Dersi
 * olmayan öğretmen sonuçta yer almaz; dersi olup üyeliğe bağlı olmayan öğretmen kaydı
 * `unlinked`'tedir.
 */
export function lessonHourSuggestion(input: SuggestionInput): LessonSuggestion {
  const range = lessonSuggestionRange(input.month)
  const month = payrollMonthRange(input.month)
  const makeups = makeupLinks(input.lessons)
  const teachers = input.teachers
    .map((teacher) => teacherSuggestion(teacher, input, makeups))
    .filter((item) => item.days.length > 0 || item.weeks.length > 0)
    .sort((a, b) => a.membershipId.localeCompare(b.membershipId))
  const linked = new Set(input.teachers.flatMap((teacher) => teacher.teacherIds))
  const unlinked = new Map<string, number>()
  const now = Date.parse(input.now)
  for (const lesson of input.lessons) {
    const day = dayKey(lesson.date)
    if (linked.has(lesson.teacherId) || day < month.from || day > month.to) continue
    const counted =
      lesson.cancelledAt === null &&
      dayInRanges(day, input.holidays) === undefined &&
      lessonEndMs(lesson) <= now
    unlinked.set(
      lesson.teacherId,
      (unlinked.get(lesson.teacherId) ?? 0) + (counted ? lessonHourCount(lesson.duration) : 0),
    )
  }
  return {
    month: input.month,
    params: input.params,
    rangeFrom: range.from,
    rangeTo: range.to,
    monthComplete: dayKey(input.now) > month.to,
    attendanceKnown: input.attendanceDays !== null,
    teachers,
    unlinked: [...unlinked.entries()]
      .map(([teacherId, countedHours]) => ({ teacherId, countedHours }))
      .sort((a, b) => a.teacherId.localeCompare(b.teacherId)),
  }
}

// --- Aktarım -------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[]) =>
  new DomainError(code, message, { kind: 'rule', path })

export interface TransferPlanItem extends LessonSuggestionTransferItem {
  /** Elle girişteki mevcut kayıt; yoksa açılır. */
  entry: { id: string; hours: number; version: number; note: string | null } | null
}

/**
 * Aktarım planı (K-552): her satırın önerisi sunucudakiyle aynı ve öneri verilebilir olmalı;
 * öneriden farklı saat gerekçe ister; mevcut kayıt zaten bu saatteyse aktarım yoktur. Kilit ve
 * personel denetimi servistedir (K-410, K-337).
 */
export function planLessonSuggestionTransfer(
  input: LessonSuggestionTransfer,
  suggestion: LessonSuggestion,
  entries: ReadonlyMap<string, { id: string; hours: number; version: number; note: string | null }>,
): TransferPlanItem[] {
  const byMember = new Map(suggestion.teachers.map((item) => [item.membershipId, item]))
  return input.items.map((item, index) => {
    const current = byMember.get(item.membershipId)
    if (current === undefined || current.suggestedHours === null)
      throw ruleError(
        'lesson_suggestion_not_found',
        'Bu personel için bu ay programdan ek ders önerisi yok.',
        ['items', String(index), 'membershipId'],
      )
    if (current.suggestedHours !== item.suggestedHours)
      throw new DomainError(
        'lesson_suggestion_changed',
        'Programdan hesaplanan öneri değişti. Öneri güncellendi; yeniden aktarın.',
        { kind: 'conflict', path: ['items', String(index), 'suggestedHours'] },
      )
    if (item.hours !== item.suggestedHours && item.reason === null)
      throw ruleError(
        'lesson_suggestion_reason_required',
        'Öneriden farklı saat için gerekçe yazın.',
        ['items', String(index), 'reason'],
      )
    const entry = entries.get(item.membershipId) ?? null
    if (entry !== null && entry.hours === item.hours)
      throw ruleError(
        'lesson_suggestion_unchanged',
        'Elle girilen ek ders saati zaten bu saatte.',
        ['items', String(index), 'hours'],
      )
    return { ...item, entry }
  })
}
