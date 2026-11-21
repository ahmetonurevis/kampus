import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { assertActiveStudent, type MemberCheck, type StudentCheck } from './finance-transport.ts'

/**
 * Kulüp, üyelik ve kulüp yoklaması (docs/domain/finans.md DOM-FIN-142; ON-098; IST-099). Kulüp ad
 * (kurumda tekil), sorumlu öğretmen (etkin öğretmen üyeliği), kontenjan ve haftalık gün/saat
 * taşır. Öğrenci kulübe bir kez üye olur ve kontenjan aşılamaz (409). Yoklama bir oturum günü ×
 * etkin üyelerdir; aynı kulüpte aynı günün oturumu yinelenmez (409), yanlış oturum arşivlenip
 * yeniden alınır (K-483).
 *
 * Kurumun eski iş akışı koleksiyonları (`clubs`, `clubMemberships`, `clubAttendance`; Oğuzhan'ın
 * okul yaşamı ekranı) bu modelden ayrıdır ve değişmez; modül anahtarı (`clubs`) ve rol kapsamı
 * (`clubMemberships`) ortaktır. Fonksiyonlar saftır.
 */

/** Kulüp ve üyelik yazma: yönetici ve ön büro (K-483). */
export const FINANCE_CLUB_MANAGE_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Kulüp okuma: yönetici ve ön büro bütün kulüpleri, öğretmen yalnız sorumlu olduğu kulübü. */
export const FINANCE_CLUB_READ_ROLES = [
  'yonetici',
  'onburo',
  'ogretmen',
] as const satisfies readonly Role[]
/** Yoklama: yönetici ve kulübün sorumlu öğretmeni (K-483). */
export const FINANCE_CLUB_ATTENDANCE_ROLES = [
  'yonetici',
  'ogretmen',
] as const satisfies readonly Role[]
/** Kendi (çocuğunun) üyeliğini okuyan roller; kapsam sunucuda daralır. */
export const FINANCE_CLUB_FAMILY_ROLES = ['veli', 'ogrenci'] as const satisfies readonly Role[]

/** ISO hafta günü: 1 Pazartesi … 7 Pazar. */
export const CLUB_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
export type ClubWeekday = (typeof CLUB_WEEKDAYS)[number]
export const CLUB_WEEKDAY_LABELS = {
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
  7: 'Pazar',
} as const satisfies Record<ClubWeekday, string>

export const CLUB_ATTENDANCE_STATUSES = ['present', 'absent', 'excused'] as const
export type ClubAttendanceStatus = (typeof CLUB_ATTENDANCE_STATUSES)[number]
export const CLUB_ATTENDANCE_STATUS_LABELS = {
  present: 'Geldi',
  absent: 'Gelmedi',
  excused: 'İzinli',
} as const satisfies Record<ClubAttendanceStatus, string>

export const CLUB_NAME_MAX = 120
export const CLUB_CAPACITY_MAX = 200
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

// --- Şemalar -------------------------------------------------------------------------------------

const nameSchema = z
  .string('Kulüp adını girin.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(CLUB_NAME_MAX, `En çok ${String(CLUB_NAME_MAX)} karakter girebilirsiniz.`)
  .describe('Kulüp adı (2–120); kurumda tekil')
const teacherSchema = z
  .string('Sorumlu öğretmeni seçin.')
  .trim()
  .min(1, 'Sorumlu öğretmeni seçin.')
  .max(100)
  .describe('Sorumlu öğretmenin kurum üyeliği (etkin öğretmen)')
const capacitySchema = z
  .number('Kontenjanı girin.')
  .int('Kontenjan tam sayı olmalı.')
  .min(1, 'Kontenjan en az 1 olmalı.')
  .max(CLUB_CAPACITY_MAX, `Kontenjan en çok ${String(CLUB_CAPACITY_MAX)} olabilir.`)
  .describe('Üye kontenjanı (1–200)')
const weekdaySchema = z
  .number('Günü seçin.')
  .int('Günü seçin.')
  .min(1, 'Günü seçin.')
  .max(7, 'Günü seçin.')
  .describe('Haftanın günü (1 Pazartesi … 7 Pazar)')
const timeSchema = (missing: string) =>
  z.string(missing).regex(TIME_PATTERN, 'Saati SS:DD biçiminde girin.')

export const clubCreateSchema = z
  .strictObject({
    name: nameSchema,
    teacherMembershipId: teacherSchema,
    capacity: capacitySchema,
    meetingDay: weekdaySchema,
    startTime: timeSchema('Başlangıç saatini girin.').describe('Başlangıç saati (SS:DD)'),
    endTime: timeSchema('Bitiş saatini girin.').describe('Bitiş saati (SS:DD, başlangıçtan sonra)'),
  })
  .superRefine((value, context) => {
    if (value.endTime <= value.startTime)
      context.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'Bitiş saati başlangıçtan sonra olmalı.',
      })
  })
export type ClubCreateInput = z.input<typeof clubCreateSchema>
export type ClubCreateFields = z.output<typeof clubCreateSchema>

export const clubUpdateSchema = z
  .strictObject({
    name: nameSchema.optional(),
    teacherMembershipId: teacherSchema.optional(),
    capacity: capacitySchema.optional(),
    meetingDay: weekdaySchema.optional(),
    startTime: timeSchema('Başlangıç saatini girin.').optional().describe('Başlangıç saati'),
    endTime: timeSchema('Bitiş saatini girin.').optional().describe('Bitiş saati'),
  })
  .superRefine((value, context) => {
    if (Object.values(value).every((field) => field === undefined))
      context.addIssue({ code: 'custom', path: [], message: 'En az bir alanı değiştirin.' })
  })
export type ClubUpdateFields = z.output<typeof clubUpdateSchema>

export const clubMemberAddSchema = z.strictObject({
  studentId: z
    .string('Öğrenciyi seçin.')
    .trim()
    .min(1, 'Öğrenciyi seçin.')
    .max(100)
    .describe('Öğrencinin kaydı'),
})
export type ClubMemberAddFields = z.output<typeof clubMemberAddSchema>

export const clubAttendanceSchema = z.strictObject({
  sessionDate: daySchema.describe('Oturum günü (YYYY-MM-DD); bugünden sonra olamaz'),
  marks: z
    .array(
      z.strictObject({
        memberId: z.uuid('Üye geçersiz.').describe('Kulüp üyeliği'),
        status: z
          .enum(CLUB_ATTENDANCE_STATUSES, 'Durumu seçin.')
          .describe('`present` geldi, `absent` gelmedi, `excused` izinli'),
      }),
      'Yoklamayı girin.',
    )
    .min(1, 'En az bir üyeyi işaretleyin.')
    .max(CLUB_CAPACITY_MAX)
    .refine(
      (marks) => new Set(marks.map((mark) => mark.memberId)).size === marks.length,
      'Aynı üye iki kez işaretlenmiş.',
    )
    .describe('Bütün etkin üyelerin durumu'),
})
export type ClubAttendanceFields = z.output<typeof clubAttendanceSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })
const conflict = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'conflict', path })

/** Sorumlu öğretmen kurumun etkin öğretmeni olmalı (K-483). */
export function assertClubTeacher(teacher: MemberCheck): void {
  if (teacher === undefined) return
  const path = ['teacherMembershipId']
  if (teacher === null) throw ruleError('club_teacher_not_found', 'Öğretmen bulunamadı.', path)
  if (teacher.role !== 'ogretmen')
    throw ruleError('club_teacher_not_teacher', 'Sorumlu kişi öğretmen olmalı.', path)
  if (!teacher.active) throw ruleError('club_teacher_inactive', 'Öğretmenin hesabı pasif.', path)
}

const nameTaken = () => conflict('club_name_taken', 'Bu adla bir kulüp var.', ['name'])

/** Yeni kulüp (K-483): ad tekil (409), sorumlu öğretmen etkin öğretmen. */
export function planClub(checks: { teacher: MemberCheck; nameTaken: boolean }): void {
  if (checks.nameTaken) throw nameTaken()
  assertClubTeacher(checks.teacher)
}

export interface StoredClubFields {
  name: string
  teacherMembershipId: string
  capacity: number
  meetingDay: number
  startTime: string
  endTime: string
}

/**
 * Kulüp düzenleme (K-483): kontenjan etkin üye sayısının altına inemez, bitiş başlangıçtan sonra
 * kalır. Değişen alan adları döner; değişiklik yoksa 422.
 */
export function planClubUpdate(
  current: StoredClubFields,
  input: ClubUpdateFields,
  checks: { teacher: MemberCheck; nameTaken: boolean; activeMembers: number },
): { next: StoredClubFields; changed: (keyof StoredClubFields)[] } {
  const next: StoredClubFields = {
    name: input.name ?? current.name,
    teacherMembershipId: input.teacherMembershipId ?? current.teacherMembershipId,
    capacity: input.capacity ?? current.capacity,
    meetingDay: input.meetingDay ?? current.meetingDay,
    startTime: input.startTime ?? current.startTime,
    endTime: input.endTime ?? current.endTime,
  }
  const changed = (Object.keys(next) as (keyof StoredClubFields)[]).filter(
    (key) => next[key] !== current[key],
  )
  if (changed.length === 0) throw ruleError('club_unchanged', 'Kulüpte değişiklik yok.')
  if (changed.includes('name') && checks.nameTaken) throw nameTaken()
  if (changed.includes('teacherMembershipId')) assertClubTeacher(checks.teacher)
  if (next.endTime <= next.startTime)
    throw ruleError('club_time_order', 'Bitiş saati başlangıçtan sonra olmalı.', ['endTime'])
  if (next.capacity < checks.activeMembers)
    throw ruleError(
      'club_capacity_below_members',
      `Kontenjan üye sayısının (${String(checks.activeMembers)}) altına inemez.`,
      ['capacity'],
    )
  return { next, changed }
}

/** Kulüp arşivi (K-483): etkin üyesi olan kulüp arşivlenmez. */
export function assertClubArchivable(activeMembers: number): void {
  if (activeMembers > 0)
    throw ruleError('club_has_members', 'Kulüpte üye var; önce üyelikleri sonlandırın.')
}

/** Üyelik (K-483): etkin öğrenci; aynı öğrenci iki kez üye olamaz, kontenjan dolu 409. */
export function planClubMember(checks: {
  student: StudentCheck
  alreadyMember: boolean
  activeMembers: number
  capacity: number
}): void {
  assertActiveStudent(checks.student, 'club')
  if (checks.alreadyMember)
    throw conflict('club_member_exists', 'Öğrenci bu kulübe zaten üye.', ['studentId'])
  if (checks.activeMembers >= checks.capacity)
    throw conflict(
      'club_capacity_full',
      `Kulüp kontenjanı dolu (${String(checks.activeMembers)}/${String(checks.capacity)}).`,
    )
}

/**
 * Yoklama (K-483): oturum günü bugünden sonra olamaz; kulübün etkin üyesi yoksa yoklama alınmaz;
 * her işaret etkin üyeye ait olmalı ve bütün etkin üyeler işaretlenmeli; aynı günün oturumu varsa
 * 409.
 */
export function planClubAttendance(
  input: ClubAttendanceFields,
  checks: { today: string; activeMemberIds: ReadonlySet<string>; sessionExists: boolean },
): void {
  if (input.sessionDate > checks.today)
    throw ruleError('club_session_future', 'Yoklama bugünden sonraki bir gün için alınamaz.', [
      'sessionDate',
    ])
  if (checks.activeMemberIds.size === 0)
    throw ruleError('club_no_members', 'Kulüpte üye yok; yoklama alınamaz.')
  input.marks.forEach((mark, index) => {
    if (!checks.activeMemberIds.has(mark.memberId))
      throw ruleError(
        'club_attendance_unknown_member',
        'İşaretlenen öğrenci kulübün üyesi değil.',
        ['marks', String(index), 'memberId'],
      )
  })
  if (input.marks.length !== checks.activeMemberIds.size)
    throw ruleError('club_attendance_incomplete', 'Bütün üyelerin durumunu işaretleyin.', ['marks'])
  if (checks.sessionExists)
    throw conflict('club_session_exists', 'Bu günün yoklaması zaten alınmış.', ['sessionDate'])
}

// --- Görünüm -------------------------------------------------------------------------------------

/** `Çarşamba 15:30–16:30`. */
export function clubScheduleLabel(meetingDay: number, startTime: string, endTime: string): string {
  const day = CLUB_WEEKDAY_LABELS[meetingDay as ClubWeekday] ?? ''
  return `${day} ${startTime}–${endTime}`.trim()
}

/** Oturumun durum sayıları. */
export function clubAttendanceCounts(
  marks: readonly { status: ClubAttendanceStatus }[],
): Record<ClubAttendanceStatus, number> {
  const counts = { present: 0, absent: 0, excused: 0 }
  for (const mark of marks) counts[mark.status] += 1
  return counts
}
