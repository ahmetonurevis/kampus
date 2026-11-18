import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dateLabel, dayKey } from './format.ts'
import { assertPayrollDaysUnlocked } from './finance-payroll-periods.ts'
import {
  LEAVE_DAYS_MAX,
  leaveEntitlement,
  periodsOverlap,
  planLeaveRecord,
  type LeavePeriod,
  type LeaveProfile,
  type LeaveRecordSnapshot,
  type LeaveStaff,
  type LeaveType,
  type LeaveUsage,
} from './finance-staff-leave.ts'

/**
 * Personel izin talebi ve onayı (docs/domain/finans.md DOM-FIN-116; ON-182).
 *
 * - **Akış (K-397):** talep bekliyor → onaylandı ya da reddedildi (gerekçe). Bekleyen talep
 *   gerekçeyle geri çekilir (iptal); onaylı talebi yalnız yönetici gerekçeyle iptal eder ve
 *   talebin ürettiği kullanılmış izin kaydı da iptal edilir. Talebi bugün yönetici personel adına
 *   açar (personel self-servisi ON-189). Birim tam iş günüdür; yarım gün yoktur.
 * - **Onay (K-398):** onaylanan talep kullanılmış izin kaydını (DOM-FIN-109, K-362) türün güncel
 *   ayarıyla üretir. Kalan yıllık izin (başlangıç gününde, planlananlar düşülmüş) talebi
 *   karşılamıyorsa onay 422 `staff_leave_balance_insufficient`; yönetici avans izin olarak
 *   bilerek onaylayabilir. Aynı personelde bekleyen ya da onaylı talep ya da etkin kayıtla çakışan
 *   talep açılmaz. Onaylı bordro ayına değen onay ve onaylı talebin iptali 409
 *   `payroll_period_locked` (DOM-FIN-108, K-357).
 * - **Ders bağı (K-399):** personel bir öğretmen kaydına bağlıysa izin aralığındaki iptal
 *   edilmemiş dersleri ders programından listelenir ve talebe kopyalanır; her derse yedek öğretmen
 *   elle seçilir (öneri yok, OG-843). Aynı saatte dersi olan, aynı gün izinli ya da başka branştan
 *   yedek uyarıdır, engel değildir. Bağ ders programına yazılmaz.
 *
 * Fonksiyonlar saftır.
 */

/** Talep yalnız yöneticide (izin verisiyle aynı, personel kişisel verisi). */
export const FINANCE_LEAVE_REQUEST_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const LEAVE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number]
export const LEAVE_REQUEST_STATUS_LABELS = {
  pending: 'Onay bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  cancelled: 'İptal edildi',
} as const satisfies Record<LeaveRequestStatus, string>

export const LEAVE_REQUEST_DESCRIPTION_MAX = 500
export const LEAVE_REQUEST_REASON_MIN = 5
export const LEAVE_REQUEST_REASON_MAX = 500
/** Talebe bağlanabilen en çok ders; uzun izinde ders programı ayrıca düzenlenir. */
export const LEAVE_REQUEST_LESSONS_MAX = 200
export const LEAVE_LESSON_TITLE_MAX = 120

/** Yedek öğretmen uyarıları (engel değildir). */
export const SUBSTITUTE_WARNINGS = ['busy', 'on_leave', 'other_subject'] as const
export type SubstituteWarning = (typeof SUBSTITUTE_WARNINGS)[number]
export const SUBSTITUTE_WARNING_LABELS = {
  busy: 'Bu saatte başka dersi var',
  on_leave: 'Bu gün izinli',
  other_subject: 'Başka branştan',
} as const satisfies Record<SubstituteWarning, string>

// --- Şemalar -------------------------------------------------------------------------------------

const membershipSchema = z
  .string('Personel seçin.')
  .trim()
  .min(1, 'Personel seçin.')
  .max(100, 'Personel geçersiz.')
const reasonSchema = (label: string) =>
  z
    .string(`${label} yazın.`)
    .trim()
    .min(LEAVE_REQUEST_REASON_MIN, `${label} en az 5 karakterle yazın.`)
    .max(
      LEAVE_REQUEST_REASON_MAX,
      `En fazla ${String(LEAVE_REQUEST_REASON_MAX)} karakter girebilirsiniz.`,
    )
const recordIdSchema = z.string().trim().min(1).max(100)

const substituteSchema = z.strictObject({
  lessonId: recordIdSchema.describe('Ders programındaki ders kimliği'),
  substituteTeacherId: recordIdSchema
    .nullable()
    .describe('Yedek öğretmen kaydı; `null` seçilmemiş'),
})
export type LeaveSubstituteInput = z.output<typeof substituteSchema>

const substitutesSchema = z
  .array(substituteSchema)
  .max(
    LEAVE_REQUEST_LESSONS_MAX,
    `En fazla ${String(LEAVE_REQUEST_LESSONS_MAX)} derse yedek seçilebilir.`,
  )
  .superRefine((list, context) => {
    const seen = new Set<string>()
    list.forEach((item, index) => {
      if (seen.has(item.lessonId))
        context.addIssue({
          code: 'custom',
          path: [index, 'lessonId'],
          message: 'Bir ders iki kez seçilemez.',
        })
      seen.add(item.lessonId)
    })
  })

/** İzin talebi (K-397): tür, aralık, iş günü, açıklama ve derslere yedek öğretmen. */
export const leaveRequestCreateSchema = z
  .strictObject({
    // kvkk: K (personel üyeliği)
    membershipId: membershipSchema.describe('İzin isteyen personelin kurum üyeliği'),
    typeCode: z
      .string('İzin türünü seçin.')
      .regex(/^[a-z][a-z0-9_]{1,39}$/, 'İzin türü geçersiz.')
      .describe('İzin türü kodu (DOM-FIN-109)'),
    startDate: daySchema.describe('İznin ilk günü'),
    endDate: daySchema.describe('İznin son günü (dahil)'),
    days: z
      .number('Gün sayısını girin.')
      .int('Gün sayısı tam sayı olmalıdır; yarım gün izin yoktur.')
      .min(1, 'Gün sayısı en az 1 olmalıdır.')
      .max(LEAVE_DAYS_MAX, `Gün sayısı en fazla ${String(LEAVE_DAYS_MAX)} olabilir.`)
      .describe('İzin iş günü (hafta tatili ve genel tatil hariç; elle, tam gün)'),
    // kvkk: K (serbest metin)
    description: z
      .string()
      .trim()
      .max(
        LEAVE_REQUEST_DESCRIPTION_MAX,
        `En fazla ${String(LEAVE_REQUEST_DESCRIPTION_MAX)} karakter girebilirsiniz.`,
      )
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .default(null)
      .describe('İsteğe bağlı açıklama, en çok 500 karakter; denetim kaydına yazılmaz'),
    substitutes: substitutesSchema
      .default([])
      .describe('Etkilenen derslerden yedek seçilenler; seçilmeyen ders yedeksiz kalır'),
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıç gününden önce olamaz.',
      })
  })
export type LeaveRequestCreateInput = z.input<typeof leaveRequestCreateSchema>
export type LeaveRequestCreateFields = z.output<typeof leaveRequestCreateSchema>

/** Onay (K-398): yetersiz bakiyede avans izin olarak bilerek onay. */
export const leaveRequestApproveSchema = z.strictObject({
  allowAdvance: z
    .boolean()
    .default(false)
    .describe('Kalan yıllık izin yetmiyorsa avans izin olarak onayla (bakiye eksiye düşer)'),
})
export type LeaveRequestApproveFields = z.output<typeof leaveRequestApproveSchema>

export const leaveRequestRejectSchema = z.strictObject({
  reason: reasonSchema('Ret gerekçesini').describe('Ret gerekçesi; denetim kaydına yazılmaz'),
})
export const leaveRequestCancelSchema = z.strictObject({
  reason: reasonSchema('İptal gerekçesini').describe('İptal gerekçesi; denetim kaydına yazılmaz'),
})
export type LeaveRequestReasonFields = z.output<typeof leaveRequestCancelSchema>

export const leaveRequestSubstitutesSchema = z.strictObject({
  substitutes: substitutesSchema
    .min(1, 'En az bir ders seçin.')
    .describe('Yedeği değişecek dersler; `null` yedeği kaldırır'),
})
export type LeaveRequestSubstitutesFields = z.output<typeof leaveRequestSubstitutesSchema>

// --- Ders programı -------------------------------------------------------------------------------

/** Ders programındaki ders (yalnız gereken alanlar). */
export interface ScheduleLesson {
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
}

/** Yedek adayı öğretmen kaydı. */
export interface LeaveTeacher {
  id: string
  name: string
  subjectId: string | null
  isActive: boolean
}

/** Talebe kopyalanan ders. */
export interface LeaveRequestLesson {
  lessonId: string
  /** Başlangıç anı (ISO 8601 UTC). */
  startsAt: string
  duration: number
  classId: string
  subjectId: string
  title: string
  substituteTeacherId: string | null
}

const lessonEnd = (lesson: { date: string; duration: number }) =>
  Date.parse(lesson.date) + (lesson.duration || 30) * 60_000
const lessonsOverlap = (
  a: { date: string; duration: number },
  b: { date: string; duration: number },
) => Date.parse(a.date) < lessonEnd(b) && Date.parse(b.date) < lessonEnd(a)

/**
 * İzin aralığında (Europe/Istanbul günü, uçlar dahil) öğretmenin iptal edilmemiş dersleri: asıl ya
 * da yedek olduğu dersler, başlangıca göre sıralı.
 */
export function affectedLessons(
  lessons: readonly ScheduleLesson[],
  teacherId: string,
  period: LeavePeriod,
): ScheduleLesson[] {
  return lessons
    .filter(
      (lesson) =>
        !lesson.cancelledAt &&
        (lesson.teacherId === teacherId || lesson.originalTeacherId === teacherId) &&
        dayKey(lesson.date) >= period.startDate &&
        dayKey(lesson.date) <= period.endDate,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

/** Talebe kopyalanacak ders biçimi. */
export const lessonSnapshot = (
  lesson: ScheduleLesson,
  substituteTeacherId: string | null,
): LeaveRequestLesson => ({
  lessonId: lesson.id,
  startsAt: lesson.date,
  duration: lesson.duration,
  classId: lesson.classId,
  subjectId: lesson.subjectId,
  title: (lesson.title ?? '').trim().slice(0, LEAVE_LESSON_TITLE_MAX) || 'Ders',
  substituteTeacherId,
})

/**
 * Yedek öğretmen uyarıları (K-399; engel değildir): aynı saatte başka dersi var, o gün izinli
 * (bekleyen ya da onaylı talep, etkin izin kaydı), başka branştan. `schedule` öğretmenlerin o
 * günlerdeki dersleridir; `absences` öğretmen kaydına göre izin aralıklarıdır.
 */
export function substituteWarnings(
  lesson: Pick<LeaveRequestLesson, 'lessonId' | 'startsAt' | 'duration' | 'subjectId'>,
  substitute: LeaveTeacher,
  schedule: readonly ScheduleLesson[],
  absences: ReadonlyMap<string, readonly LeavePeriod[]>,
): SubstituteWarning[] {
  const slot = { date: lesson.startsAt, duration: lesson.duration }
  const day = dayKey(lesson.startsAt)
  const warnings: SubstituteWarning[] = []
  if (
    schedule.some(
      (other) =>
        other.id !== lesson.lessonId &&
        !other.cancelledAt &&
        other.teacherId === substitute.id &&
        lessonsOverlap(slot, other),
    )
  )
    warnings.push('busy')
  if (
    (absences.get(substitute.id) ?? []).some((period) =>
      periodsOverlap(period, { startDate: day, endDate: day }),
    )
  )
    warnings.push('on_leave')
  if (substitute.subjectId !== null && substitute.subjectId !== lesson.subjectId)
    warnings.push('other_subject')
  return warnings
}

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/**
 * Yedek seçimlerini derslere uygular: ders talebin derslerinden olmalı (422
 * `staff_leave_lesson_not_affected`), yedek kurumda etkin öğretmen olmalı (422
 * `staff_leave_substitute_not_found`) ve izin alan öğretmen olamaz (422
 * `staff_leave_substitute_self`). Seçilmeyen dersin yedeği değişmez.
 */
export function applySubstitutes(
  lessons: readonly LeaveRequestLesson[],
  substitutes: readonly LeaveSubstituteInput[],
  checks: { teachers: readonly LeaveTeacher[]; ownTeacherId: string | null },
): LeaveRequestLesson[] {
  const byLesson = new Map(lessons.map((lesson) => [lesson.lessonId, lesson]))
  const choices = new Map<string, string | null>()
  substitutes.forEach((choice, index) => {
    if (!byLesson.has(choice.lessonId))
      throw ruleError(
        'staff_leave_lesson_not_affected',
        'Seçilen ders bu izinden etkilenen dersler arasında değil.',
        `substitutes.${String(index)}.lessonId`,
      )
    const teacherId = choice.substituteTeacherId
    if (teacherId !== null) {
      if (teacherId === checks.ownTeacherId)
        throw ruleError(
          'staff_leave_substitute_self',
          'İzne çıkan öğretmen kendi dersine yedek olamaz.',
          `substitutes.${String(index)}.substituteTeacherId`,
        )
      const teacher = checks.teachers.find((item) => item.id === teacherId)
      if (teacher === undefined || !teacher.isActive)
        throw ruleError(
          'staff_leave_substitute_not_found',
          'Yedek öğretmen bulunamadı.',
          `substitutes.${String(index)}.substituteTeacherId`,
        )
    }
    choices.set(choice.lessonId, teacherId)
  })
  return lessons.map((lesson) =>
    choices.has(lesson.lessonId)
      ? { ...lesson, substituteTeacherId: choices.get(lesson.lessonId) ?? null }
      : lesson,
  )
}

// --- Talep ---------------------------------------------------------------------------------------

/** Çakışma denetimi için personelin bekleyen ve onaylı talepleri. */
export interface OpenLeaveRequest extends LeavePeriod {
  id: string
  status: LeaveRequestStatus
}

/** Personelin etkin (iptal edilmemiş) izin kayıtları. */
export type ActiveLeaveRecord = LeavePeriod & LeaveUsage & { id: string }

/**
 * Talep `startDate` gününden başlarsa kalan yıllık izin (gün): başlangıç günündeki bakiye, o günden
 * sonra başlayan kayıtlar (planlanan) düşülmüş, talebin günleri düşülmüş. Yıllık izinden düşmeyen
 * türde ya da profil yoksa `null`.
 */
export function leaveBalanceAfterRequest(
  request: LeavePeriod & { days: number; deductsFromAnnual: boolean },
  profile: LeaveProfile | null,
  records: readonly LeaveUsage[],
  employmentEndDate: string | null,
): number | null {
  if (!request.deductsFromAnnual || profile === null) return null
  const entitlement = leaveEntitlement(profile, records, request.startDate, employmentEndDate)
  return entitlement.balanceAfterPlannedDays - request.days
}

function assertNoOpenOverlap(
  period: LeavePeriod,
  requests: readonly OpenLeaveRequest[],
  exceptId: string | null,
) {
  const clash = requests.find(
    (request) =>
      request.id !== exceptId &&
      (request.status === 'pending' || request.status === 'approved') &&
      periodsOverlap(request, period),
  )
  if (clash !== undefined)
    throw ruleError(
      'staff_leave_request_overlap',
      `Bu tarihlerde personelin ${clash.status === 'pending' ? 'onay bekleyen' : 'onaylı'} başka bir izin talebi var (${dayText(clash.startDate)} – ${dayText(clash.endDate)}).`,
      'startDate',
    )
}

export interface LeaveRequestChecks {
  staff: LeaveStaff | null
  type: LeaveType | null
  profile: LeaveProfile | null
  records: readonly ActiveLeaveRecord[]
  requests: readonly OpenLeaveRequest[]
}

/**
 * Talep açma (K-397…K-399). Kayıt kuralları (personel etkin, tür var ve açık, rapor talep edilmez,
 * iş günü aralığı aşmaz, yıllıktan düşen türde kıdem başlangıcı, etkin kayıtla çakışma yok;
 * `planLeaveRecord`) talepte de geçerlidir; ek olarak bekleyen ya da onaylı taleple çakışma 422
 * `staff_leave_request_overlap`, 200'den çok ders 422 `staff_leave_request_too_many_lessons`. Yedek
 * seçimleri `applySubstitutes` kurallarıyla derslere uygulanır. Döner: tür kopyası, dersler ve
 * talep sonrası kalan yıllık izin (yetersiz bakiye talepte uyarıdır).
 */
export function planLeaveRequest(
  input: LeaveRequestCreateFields,
  checks: LeaveRequestChecks & {
    lessons: readonly ScheduleLesson[]
    teachers: readonly LeaveTeacher[]
    ownTeacherId: string | null
    employmentEndDate: string | null
  },
): {
  snapshot: LeaveRecordSnapshot
  lessons: LeaveRequestLesson[]
  balanceAfterDays: number | null
} {
  const snapshot = planLeaveRecord({ ...input, note: null }, checks)
  assertNoOpenOverlap(input, checks.requests, null)
  if (checks.lessons.length > LEAVE_REQUEST_LESSONS_MAX)
    throw ruleError(
      'staff_leave_request_too_many_lessons',
      `İzin aralığında ${String(checks.lessons.length)} ders var; bir talebe en çok ${String(LEAVE_REQUEST_LESSONS_MAX)} ders bağlanır. İzni bölün ya da ders programını ayrıca düzenleyin.`,
      'endDate',
    )
  const lessons = applySubstitutes(
    checks.lessons.map((lesson) => lessonSnapshot(lesson, null)),
    input.substitutes,
    checks,
  )
  return {
    snapshot,
    lessons,
    balanceAfterDays: leaveBalanceAfterRequest(
      { ...input, deductsFromAnnual: snapshot.deductsFromAnnual },
      checks.profile,
      checks.records,
      checks.employmentEndDate,
    ),
  }
}

/** Saklanan talep (kural için gereken alanlar). */
export interface LeaveRequestState extends LeavePeriod {
  id: string
  membershipId: string
  typeCode: string
  days: number
  description: string | null
  status: LeaveRequestStatus
}

function assertPending(request: LeaveRequestState) {
  if (request.status !== 'pending')
    throw ruleError(
      'staff_leave_request_not_pending',
      `Talep ${LEAVE_REQUEST_STATUS_LABELS[request.status].toLocaleLowerCase('tr')}; yalnız onay bekleyen talep karara bağlanır.`,
      'status',
    )
}

/**
 * Onay (K-398). Talep bekliyor olmalı; aralık onaylı bordro ayına değmez (409
 * `payroll_period_locked`); kayıt kuralları türün güncel ayarıyla yeniden denetlenir
 * (`planLeaveRecord`; etkin kayıtla çakışma 422 `staff_leave_overlap`); başka bekleyen ya da onaylı
 * talep çakışmaz. Yıllık izinden düşen türde kalan izin talebi karşılamıyorsa 422
 * `staff_leave_balance_insufficient`, `allowAdvance` ile avans izin olarak onaylanır. Döner:
 * üretilecek kaydın tür kopyası ve onay sonrası kalan.
 */
export function planLeaveRequestApproval(
  request: LeaveRequestState,
  input: LeaveRequestApproveFields,
  checks: LeaveRequestChecks & {
    lockedMonths: readonly string[]
    employmentEndDate: string | null
  },
): { snapshot: LeaveRecordSnapshot; balanceAfterDays: number | null } {
  assertPending(request)
  assertPayrollDaysUnlocked(
    checks.lockedMonths,
    [{ from: request.startDate, to: request.endDate }],
    'startDate',
  )
  const snapshot = planLeaveRecord(
    {
      membershipId: request.membershipId,
      typeCode: request.typeCode,
      startDate: request.startDate,
      endDate: request.endDate,
      days: request.days,
      note: null,
    },
    checks,
  )
  assertNoOpenOverlap(request, checks.requests, request.id)
  const balanceAfterDays = leaveBalanceAfterRequest(
    { ...request, deductsFromAnnual: snapshot.deductsFromAnnual },
    checks.profile,
    checks.records,
    checks.employmentEndDate,
  )
  if (balanceAfterDays !== null && balanceAfterDays < 0 && !input.allowAdvance)
    throw ruleError(
      'staff_leave_balance_insufficient',
      `Kalan yıllık izin ${String(balanceAfterDays + request.days)} gün; talep ${String(request.days)} gün. Avans izin olarak onaylamak için "Avans izin olarak onayla" seçeneğini işaretleyin.`,
      'allowAdvance',
    )
  return { snapshot, balanceAfterDays }
}

/** Ret (K-397): yalnız bekleyen talep. */
export function planLeaveRequestRejection(request: LeaveRequestState): void {
  assertPending(request)
}

/**
 * İptal (K-397): bekleyen talep geri çekilir; onaylı talep iptal edilir ve ürettiği kayıt da iptal
 * edilir, aralığı onaylı bordro ayına değiyorsa 409 `payroll_period_locked`. Reddedilmiş ya da iptal
 * edilmiş talep 422 `staff_leave_request_closed`. Döner: kaydın da iptal edilip edilmeyeceği.
 */
export function planLeaveRequestCancel(
  request: LeaveRequestState,
  lockedMonths: readonly string[],
): { cancelsRecord: boolean } {
  if (request.status === 'rejected' || request.status === 'cancelled')
    throw ruleError(
      'staff_leave_request_closed',
      `Talep ${LEAVE_REQUEST_STATUS_LABELS[request.status].toLocaleLowerCase('tr')}; iptal edilemez.`,
      'status',
    )
  if (request.status === 'approved')
    assertPayrollDaysUnlocked(
      lockedMonths,
      [{ from: request.startDate, to: request.endDate }],
      'startDate',
    )
  return { cancelsRecord: request.status === 'approved' }
}

/**
 * Yedek değişikliği (K-399): bekleyen ya da onaylı talepte; kapalı talep 422
 * `staff_leave_request_closed`; değişiklik yoksa 422 `staff_leave_substitutes_unchanged`.
 */
export function planLeaveRequestSubstitutes(
  request: LeaveRequestState,
  lessons: readonly LeaveRequestLesson[],
  input: LeaveRequestSubstitutesFields,
  checks: { teachers: readonly LeaveTeacher[]; ownTeacherId: string | null },
): LeaveRequestLesson[] {
  if (request.status === 'rejected' || request.status === 'cancelled')
    throw ruleError(
      'staff_leave_request_closed',
      `Talep ${LEAVE_REQUEST_STATUS_LABELS[request.status].toLocaleLowerCase('tr')}; yedek öğretmen değiştirilemez.`,
      'status',
    )
  const next = applySubstitutes(lessons, input.substitutes, checks)
  if (
    next.every(
      (lesson, index) => lesson.substituteTeacherId === lessons[index]?.substituteTeacherId,
    )
  )
    throw ruleError(
      'staff_leave_substitutes_unchanged',
      'Yedek öğretmen seçiminde değişiklik yok.',
      'substitutes',
    )
  return next
}

/** Hafta içi gün sayısı (pazartesi–cuma, uçlar dahil): iş günü önerisi; genel tatil bilinmez. */
export function weekdayCount(startDate: string, endDate: string): number {
  if (endDate < startDate) return 0
  let count = 0
  const end = Date.parse(`${endDate}T00:00:00.000Z`)
  for (let at = Date.parse(`${startDate}T00:00:00.000Z`); at <= end; at += 86_400_000) {
    const weekday = new Date(at).getUTCDay()
    if (weekday !== 0 && weekday !== 6) count += 1
  }
  return count
}
