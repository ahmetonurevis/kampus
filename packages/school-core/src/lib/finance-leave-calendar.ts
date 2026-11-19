import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { addDays, daysBetween } from './finance-opening-watch.ts'
import { dateLabel, dayKey } from './format.ts'
import { periodsOverlap, type LeaveKind, type LeavePeriod } from './finance-staff-leave.ts'

/**
 * Personel izin takvimi ve çakışma uyarıları (docs/domain/finans.md DOM-FIN-123; ON-183).
 *
 * - **Takvim (K-420):** onaylı ve bekleyen izinler ay ya da hafta görünümünde; kaynaklar izin
 *   talepleri (bekleyen, onaylı), elle yazılmış kullanılmış izin kayıtları ve sağlık raporlarıdır.
 *   Yönetici tür adını görür; rapor (izin türü `sick` ya da sağlık raporu) yalnız "Raporlu" olarak,
 *   rapor türü ve tanı olmadan gösterilir. Ön büro yalnız onaylı izinleri, tür olmadan "İzinli"
 *   olarak okur; uyarıları ve ayarı görmez.
 * - **Branş (K-421):** personelin branşı bağlı öğretmen kaydının dersidir (`membership_links`,
 *   `teacher` → `teachers.subjectId`); öğretmen kaydı olmayan personelin branşı yoktur.
 * - **Uyarılar (K-422; engel değildir):** aynı branşta aynı günde izinli personel sayısı kurum
 *   eşiğine (varsayılan 2) ulaşırsa, izin kurumun sınav haftasına denk gelirse, talebin bir dersine
 *   seçilen yedek öğretmen o gün izinliyse. Bekleyen talepler de sayılır.
 *
 * Fonksiyonlar saftır.
 */

/** Takvimi yönetici ve ön büro okur (ön büro yalnız onaylı izni, tür olmadan). */
export const FINANCE_LEAVE_CALENDAR_ROLES = [
  'yonetici',
  'onburo',
] as const satisfies readonly Role[]
/** Eşik ve sınav haftaları ayarı yalnız yöneticide. */
export const FINANCE_LEAVE_CALENDAR_SETTINGS_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const LEAVE_CONCURRENT_THRESHOLD_DEFAULT = 2
export const LEAVE_CONCURRENT_THRESHOLD_MIN = 2
export const LEAVE_CONCURRENT_THRESHOLD_MAX = 20
export const EXAM_WEEKS_MAX = 40
export const EXAM_WEEK_LABEL_MIN = 2
export const EXAM_WEEK_LABEL_MAX = 80
/** Bir sınav haftası aralığının en uzun hâli (takvim günü, uçlar dahil). */
export const EXAM_WEEK_DAYS_MAX = 31
/** Takvim sorgusunun en uzun aralığı (takvim günü, uçlar dahil; ay görünümü 6 hafta). */
export const LEAVE_CALENDAR_RANGE_MAX_DAYS = 62

/** Takvim kaydının kaynağı. */
export const LEAVE_CALENDAR_SOURCES = ['request', 'record', 'medical_report'] as const
export type LeaveCalendarSource = (typeof LEAVE_CALENDAR_SOURCES)[number]
export const LEAVE_CALENDAR_STATUSES = ['pending', 'approved'] as const
export type LeaveCalendarStatus = (typeof LEAVE_CALENDAR_STATUSES)[number]
export const LEAVE_CALENDAR_STATUS_LABELS = {
  pending: 'Onay bekliyor',
  approved: 'Onaylı',
} as const satisfies Record<LeaveCalendarStatus, string>

/**
 * Gösterim sınıfı (K-420): `leave` tür adıyla, `sick` yalnız "Raporlu", `absent` türsüz "İzinli"
 * (ön büro).
 */
export const LEAVE_CALENDAR_CATEGORIES = ['leave', 'sick', 'absent'] as const
export type LeaveCalendarCategory = (typeof LEAVE_CALENDAR_CATEGORIES)[number]
export const LEAVE_CALENDAR_CATEGORY_LABELS = {
  leave: 'İzinli',
  sick: 'Raporlu',
  absent: 'İzinli',
} as const satisfies Record<LeaveCalendarCategory, string>

export type LeaveCalendarAudience = 'manager' | 'front_desk'
export const leaveCalendarAudience = (role: Role): LeaveCalendarAudience =>
  role === 'yonetici' ? 'manager' : 'front_desk'

export const LEAVE_CONFLICTS = ['branch_concurrent', 'exam_week', 'substitute_on_leave'] as const
export type LeaveConflictCode = (typeof LEAVE_CONFLICTS)[number]

// --- Ayar ----------------------------------------------------------------------------------------

export interface ExamWeek extends LeavePeriod {
  label: string
}

const examWeekSchema = z
  .strictObject({
    label: z
      .string('Sınav haftasının adını yazın.')
      .trim()
      .min(EXAM_WEEK_LABEL_MIN, 'Sınav haftasının adını en az 2 karakterle yazın.')
      .max(EXAM_WEEK_LABEL_MAX, `En fazla ${String(EXAM_WEEK_LABEL_MAX)} karakter girebilirsiniz.`)
      .describe('Ör. "1. dönem ara sınavları"'),
    startDate: daySchema.describe('İlk gün'),
    endDate: daySchema.describe('Son gün (dahil)'),
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıç gününden önce olamaz.',
      })
    else if (daysBetween(value.startDate, value.endDate) + 1 > EXAM_WEEK_DAYS_MAX)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: `Bir sınav haftası en çok ${String(EXAM_WEEK_DAYS_MAX)} gün olabilir.`,
      })
  })

const examWeeksSchema = z
  .array(examWeekSchema)
  .max(EXAM_WEEKS_MAX, `En fazla ${String(EXAM_WEEKS_MAX)} sınav haftası tanımlanabilir.`)
  .superRefine((list, context) => {
    list.forEach((week, index) => {
      const clash = list.findIndex(
        (other, otherIndex) => otherIndex < index && periodsOverlap(week, other),
      )
      if (clash !== -1)
        context.addIssue({
          code: 'custom',
          path: [index, 'startDate'],
          message: `Bu aralık "${list[clash]?.label ?? ''}" ile çakışıyor.`,
        })
    })
  })
  .transform((list) =>
    [...list].sort(
      (a, b) => a.startDate.localeCompare(b.startDate) || a.label.localeCompare(b.label),
    ),
  )

/** Ayar değişikliği (K-421, K-422): gönderilmeyen alan değişmez; sınav haftaları bütün yazılır. */
export const leaveCalendarSettingsSchema = z
  .strictObject({
    concurrentThreshold: z
      .number('Eşiği girin.')
      .int('Eşik tam sayı olmalıdır.')
      .min(LEAVE_CONCURRENT_THRESHOLD_MIN, 'Eşik en az 2 olmalıdır.')
      .max(
        LEAVE_CONCURRENT_THRESHOLD_MAX,
        `Eşik en fazla ${String(LEAVE_CONCURRENT_THRESHOLD_MAX)} olabilir.`,
      )
      .optional()
      .describe('Aynı branşta aynı gün izinli personel sayısı bu sayıya ulaşınca uyarı (2–20)'),
    examWeeks: examWeeksSchema
      .optional()
      .describe('Sınav haftaları; liste bütün olarak yazılır, boş liste uyarıyı kapatır'),
  })
  .refine((value) => value.concurrentThreshold !== undefined || value.examWeeks !== undefined, {
    message: 'Değiştirilecek bir alan gönderin.',
  })
export type LeaveCalendarSettingsInput = z.input<typeof leaveCalendarSettingsSchema>
export type LeaveCalendarSettingsFields = z.output<typeof leaveCalendarSettingsSchema>

export interface LeaveCalendarSettings {
  concurrentThreshold: number
  examWeeks: ExamWeek[]
}

export const DEFAULT_LEAVE_CALENDAR_SETTINGS: LeaveCalendarSettings = {
  concurrentThreshold: LEAVE_CONCURRENT_THRESHOLD_DEFAULT,
  examWeeks: [],
}

const sameWeeks = (a: readonly ExamWeek[], b: readonly ExamWeek[]) =>
  a.length === b.length &&
  a.every(
    (week, index) =>
      week.label === b[index]?.label &&
      week.startDate === b[index].startDate &&
      week.endDate === b[index].endDate,
  )

/** Ayarı uygular; değişiklik yoksa 422 `leave_calendar_settings_unchanged`. */
export function planLeaveCalendarSettings(
  current: LeaveCalendarSettings,
  input: LeaveCalendarSettingsFields,
): { next: LeaveCalendarSettings; changed: (keyof LeaveCalendarSettings)[] } {
  const next = {
    concurrentThreshold: input.concurrentThreshold ?? current.concurrentThreshold,
    examWeeks: input.examWeeks ?? current.examWeeks,
  }
  const changed: (keyof LeaveCalendarSettings)[] = []
  if (next.concurrentThreshold !== current.concurrentThreshold) changed.push('concurrentThreshold')
  if (!sameWeeks(next.examWeeks, current.examWeeks)) changed.push('examWeeks')
  if (changed.length === 0)
    throw new DomainError('leave_calendar_settings_unchanged', 'Ayarda değişiklik yok.', {
      kind: 'rule',
      path: ['concurrentThreshold'],
    })
  return { next, changed }
}

// --- Takvim --------------------------------------------------------------------------------------

/** Takvimdeki izin (kaynak ne olursa olsun tek biçim). */
export interface LeaveAbsence extends LeavePeriod {
  id: string
  source: LeaveCalendarSource
  membershipId: string
  name: string
  role: string
  status: LeaveCalendarStatus
  /** İzin türü biçimi; sağlık raporunda `null`. */
  kind: LeaveKind | null
  typeLabel: string | null
  /** Talepten doğan kaydın talebi (çift sayım olmasın diye takvime alınmaz). */
  requestId?: string | null
}

export interface LeaveCalendarEntry extends LeavePeriod {
  id: string
  source: LeaveCalendarSource
  membershipId: string
  name: string
  role: string
  subjectIds: string[]
  status: LeaveCalendarStatus
  category: LeaveCalendarCategory
  typeLabel: string | null
}

/** Kaydın görünür biçimi (K-420): rapor türsüz "Raporlu", ön büroda türsüz "İzinli". */
export function calendarEntryView(
  absence: LeaveAbsence,
  subjectIds: readonly string[],
  audience: LeaveCalendarAudience,
): LeaveCalendarEntry {
  const sick = absence.source === 'medical_report' || absence.kind === 'sick'
  const category: LeaveCalendarCategory =
    audience === 'front_desk' ? 'absent' : sick ? 'sick' : 'leave'
  return {
    id: absence.id,
    source: absence.source,
    membershipId: absence.membershipId,
    name: absence.name,
    role: absence.role,
    subjectIds: [...subjectIds],
    status: absence.status,
    category,
    typeLabel: category === 'leave' ? absence.typeLabel : null,
    startDate: absence.startDate,
    endDate: absence.endDate,
  }
}

/** Takvime giren izinler: talepten doğan kayıt talebin kendisiyle gösterilir (çift sayılmaz). */
export const calendarAbsences = (absences: readonly LeaveAbsence[]) =>
  absences.filter((absence) => absence.source !== 'record' || !absence.requestId)

/** Aralığın günleri (uçlar dahil). */
export function daysOf(period: LeavePeriod): string[] {
  const days: string[] = []
  for (let day = period.startDate; day <= period.endDate; day = addDays(day, 1)) days.push(day)
  return days
}

/** Aynı branşta eşiğe ulaşan gün. */
export interface BranchBusyDay {
  day: string
  subjectId: string
  count: number
  membershipIds: string[]
}

/**
 * Aralıkta aynı branşta aynı gün izinli farklı personel sayısı eşiğe ulaşan günler (K-421), güne
 * ve branşa göre sıralı. Bekleyen ve onaylı izinler sayılır; aynı personelin iki kaydı bir sayılır.
 */
export function branchBusyDays(
  absences: readonly LeaveAbsence[],
  branches: ReadonlyMap<string, readonly string[]>,
  period: LeavePeriod,
  threshold: number,
): BranchBusyDay[] {
  const busy: BranchBusyDay[] = []
  const subjects = [...new Set([...branches.values()].flat())].sort()
  for (const day of daysOf(period))
    for (const subjectId of subjects) {
      const members = [
        ...new Set(
          absences
            .filter(
              (absence) =>
                absence.startDate <= day &&
                day <= absence.endDate &&
                (branches.get(absence.membershipId) ?? []).includes(subjectId),
            )
            .map((absence) => absence.membershipId),
        ),
      ].sort()
      if (members.length >= threshold)
        busy.push({ day, subjectId, count: members.length, membershipIds: members })
    }
  return busy
}

// --- Çakışma uyarıları ---------------------------------------------------------------------------

export interface BranchConcurrentConflict extends LeavePeriod {
  code: 'branch_concurrent'
  subjectId: string
  subjectName: string
  /** En kalabalık gündeki izinli personel sayısı (talep dahil). */
  peak: number
  threshold: number
  /** Eşiğe ulaşılan günlerde izinli diğer personel (tür yazılmaz). */
  staff: { membershipId: string; name: string }[]
}
export interface ExamWeekConflict extends LeavePeriod {
  code: 'exam_week'
  label: string
}
export interface SubstituteOnLeaveConflict {
  code: 'substitute_on_leave'
  lessonId: string
  startsAt: string
  title: string
  teacherId: string
  teacherName: string
}
export type LeaveConflict = BranchConcurrentConflict | ExamWeekConflict | SubstituteOnLeaveConflict

/** Uyarı aranan izin: talep ya da önizleme. */
export interface ConflictTarget extends LeavePeriod {
  membershipId: string
  name: string
  /** Seçilmiş yedekleriyle dersler (önizlemede boş). */
  lessons: readonly {
    lessonId: string
    startsAt: string
    title: string
    substituteTeacherId: string | null
  }[]
}

export interface ConflictContext {
  /** Aralığa değen diğer izinler (hedefin kendi kayıtları servis tarafından dışlanmış olabilir). */
  absences: readonly LeaveAbsence[]
  branches: ReadonlyMap<string, readonly string[]>
  subjectNames: ReadonlyMap<string, string>
  settings: LeaveCalendarSettings
  /** Öğretmen kaydı → izinli olduğu aralıklar (yedek uyarısı). */
  teacherAbsences: ReadonlyMap<string, readonly LeavePeriod[]>
  teacherNames: ReadonlyMap<string, string>
}

function branchConflicts(target: ConflictTarget, context: ConflictContext) {
  const others = calendarAbsences(context.absences).filter(
    (absence) => absence.membershipId !== target.membershipId && periodsOverlap(absence, target),
  )
  const self: LeaveAbsence = {
    id: 'target',
    source: 'request',
    membershipId: target.membershipId,
    name: target.name,
    role: '',
    status: 'pending',
    kind: null,
    typeLabel: null,
    startDate: target.startDate,
    endDate: target.endDate,
  }
  const subjects = context.branches.get(target.membershipId) ?? []
  const busy = branchBusyDays(
    [self, ...others],
    new Map(
      [...context.branches].map(([id, list]) => [id, list.filter((s) => subjects.includes(s))]),
    ),
    target,
    context.settings.concurrentThreshold,
  )
  return [...subjects].sort().flatMap((subjectId): BranchConcurrentConflict[] => {
    const days = busy.filter((item) => item.subjectId === subjectId)
    const first = days[0]
    const last = days.at(-1)
    if (first === undefined || last === undefined) return []
    const ids = new Set(days.flatMap((item) => item.membershipIds))
    ids.delete(target.membershipId)
    const names = new Map(others.map((absence) => [absence.membershipId, absence.name]))
    return [
      {
        code: 'branch_concurrent',
        subjectId,
        subjectName: context.subjectNames.get(subjectId) ?? subjectId,
        startDate: first.day,
        endDate: last.day,
        peak: Math.max(...days.map((item) => item.count)),
        threshold: context.settings.concurrentThreshold,
        staff: [...ids]
          .map((membershipId) => ({ membershipId, name: names.get(membershipId) ?? '' }))
          .sort(
            (a, b) =>
              a.name.localeCompare(b.name, 'tr') || a.membershipId.localeCompare(b.membershipId),
          ),
      },
    ]
  })
}

/**
 * İzin için uyarılar (K-422; engel değildir): branşta eşzamanlı izin (her branş için bir uyarı,
 * eşiğe ulaşılan ilk ve son gün), denk gelen her sınav haftası ve yedeği o gün izinli her ders.
 */
export function leaveConflicts(target: ConflictTarget, context: ConflictContext): LeaveConflict[] {
  const exams = context.settings.examWeeks
    .filter((week) => periodsOverlap(week, target))
    .map((week): ExamWeekConflict => ({ code: 'exam_week', ...week }))
  const substitutes = target.lessons.flatMap((lesson): SubstituteOnLeaveConflict[] => {
    const teacherId = lesson.substituteTeacherId
    if (teacherId === null) return []
    const day = dayKey(lesson.startsAt)
    const onLeave = (context.teacherAbsences.get(teacherId) ?? []).some(
      (period) => period.startDate <= day && day <= period.endDate,
    )
    return onLeave
      ? [
          {
            code: 'substitute_on_leave',
            lessonId: lesson.lessonId,
            startsAt: lesson.startsAt,
            title: lesson.title,
            teacherId,
            teacherName: context.teacherNames.get(teacherId) ?? teacherId,
          },
        ]
      : []
  })
  return [...branchConflicts(target, context), ...exams, ...substitutes]
}

// --- Metin ---------------------------------------------------------------------------------------

const dayText = (day: string) =>
  dateLabel(`${day}T09:00:00.000Z`, { day: 'numeric', month: 'long' })
const rangeText = (period: LeavePeriod) =>
  period.startDate === period.endDate
    ? dayText(period.startDate)
    : `${dayText(period.startDate)} – ${dayText(period.endDate)}`
const timeText = (value: string) =>
  dateLabel(value, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

/** Uyarının Türkçe metni (ekranda liste). */
export function leaveConflictText(conflict: LeaveConflict): string {
  switch (conflict.code) {
    case 'branch_concurrent': {
      const names = conflict.staff.map((person) => person.name).join(', ')
      return `${conflict.subjectName} branşında ${rangeText(conflict)} arasında aynı gün en çok ${String(conflict.peak)} personel izinli (eşik ${String(conflict.threshold)})${names === '' ? '' : `: ${names}`}.`
    }
    case 'exam_week':
      return `İzin sınav haftasına denk geliyor: ${conflict.label} (${rangeText(conflict)}).`
    case 'substitute_on_leave':
      return `${conflict.title} dersinin (${timeText(conflict.startsAt)}) yedeği ${conflict.teacherName} o gün izinli.`
    default:
      return conflict satisfies never
  }
}

// --- Sorgu ---------------------------------------------------------------------------------------

/** Takvim sorgusu aralığı: bitiş başlangıçtan önce olamaz, en çok 62 gün. */
export function calendarRangeIssue(period: LeavePeriod): string | null {
  if (period.endDate < period.startDate) return 'Bitiş günü başlangıç gününden önce olamaz.'
  if (daysBetween(period.startDate, period.endDate) + 1 > LEAVE_CALENDAR_RANGE_MAX_DAYS)
    return `Takvim aralığı en çok ${String(LEAVE_CALENDAR_RANGE_MAX_DAYS)} gün olabilir.`
  return null
}
