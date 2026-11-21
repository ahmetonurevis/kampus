import { z } from 'zod'

import type {
  ClubAttendanceBody,
  ClubBody,
  ClubDetail,
  ClubRow,
  ClubUpdateBody,
} from '@kampus/react-shared/use-finance-clubs.ts'
import {
  CLUB_ATTENDANCE_STATUSES,
  CLUB_CAPACITY_MAX,
  CLUB_NAME_MAX,
  clubScheduleLabel,
  type ClubAttendanceStatus,
} from '@kampus/school-core/lib/finance-clubs.ts'

/**
 * Kulüpler sekmesinin saf mantığı (DOM-FIN-142; ON-098; K-483): kulüp ve yoklama formlarının
 * şeması, gövdesi ve tablo metinleri. Kural ayrıntısı sunucudadır.
 */

export const scheduleText = (row: Pick<ClubRow, 'meetingDay' | 'startTime' | 'endTime'>) =>
  clubScheduleLabel(row.meetingDay, row.startTime, row.endTime)
export const quotaText = (row: Pick<ClubRow, 'memberCount' | 'capacity'>) =>
  `${String(row.memberCount)}/${String(row.capacity)}`

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const clubFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Kulüp adını en az 2 karakterle yazın.')
      .max(CLUB_NAME_MAX, `En çok ${String(CLUB_NAME_MAX)} karakter.`),
    teacherMembershipId: z.string().min(1, 'Sorumlu öğretmeni seçin.'),
    capacity: z
      .string()
      .trim()
      .refine(
        (value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= CLUB_CAPACITY_MAX,
        `Kontenjan 1 ile ${String(CLUB_CAPACITY_MAX)} arasında bir tam sayı olmalı.`,
      ),
    meetingDay: z.string().regex(/^[1-7]$/, 'Günü seçin.'),
    startTime: z.string().regex(TIME, 'Saati SS:DD biçiminde girin.'),
    endTime: z.string().regex(TIME, 'Saati SS:DD biçiminde girin.'),
  })
  .superRefine((value, context) => {
    if (TIME.test(value.startTime) && TIME.test(value.endTime) && value.endTime <= value.startTime)
      context.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'Bitiş saati başlangıçtan sonra olmalı.',
      })
  })
export type ClubFormValues = z.infer<typeof clubFormSchema>

export function clubDefaults(club?: ClubRow): ClubFormValues {
  return {
    name: club?.name ?? '',
    teacherMembershipId: club?.teacherMembershipId ?? '',
    capacity: club === undefined ? '' : String(club.capacity),
    meetingDay: club === undefined ? '' : String(club.meetingDay),
    startTime: club?.startTime ?? '',
    endTime: club?.endTime ?? '',
  }
}

export function clubCreateBody(values: ClubFormValues): ClubBody {
  return {
    name: values.name.trim(),
    teacherMembershipId: values.teacherMembershipId,
    capacity: Number(values.capacity),
    meetingDay: Number(values.meetingDay),
    startTime: values.startTime,
    endTime: values.endTime,
  }
}

/** Yalnız değişen alanlar; değişiklik yoksa `null`. */
export function clubUpdateBody(values: ClubFormValues, club: ClubRow): ClubUpdateBody | null {
  const next = clubCreateBody(values)
  const body = Object.fromEntries(
    (Object.keys(next) as (keyof ClubBody)[])
      .filter((key) => next[key] !== club[key])
      .map((key) => [key, next[key]]),
  ) as ClubUpdateBody
  return Object.keys(body).length === 0 ? null : body
}

const CLUB_FIELDS = [
  'name',
  'teacherMembershipId',
  'capacity',
  'meetingDay',
  'startTime',
  'endTime',
] as const
export function clubFormField(name: string): (typeof CLUB_FIELDS)[number] | null {
  return CLUB_FIELDS.find((field) => field === name) ?? null
}

/** Yoklama taslağı: her etkin üye "geldi" ile başlar. */
export function attendanceDefaults(members: ClubDetail['members']) {
  return Object.fromEntries(
    members.map((member) => [member.id, 'present' as ClubAttendanceStatus]),
  ) as Record<string, ClubAttendanceStatus>
}

export function attendanceBody(
  sessionDate: string,
  marks: Readonly<Record<string, ClubAttendanceStatus>>,
): ClubAttendanceBody {
  return {
    sessionDate,
    marks: Object.entries(marks).map(([memberId, status]) => ({ memberId, status })),
  }
}

export const isAttendanceStatus = (value: string): value is ClubAttendanceStatus =>
  (CLUB_ATTENDANCE_STATUSES as readonly string[]).includes(value)

/** Oturum özeti: `12 geldi · 1 gelmedi · 2 izinli`. */
export function countsText(counts: Record<ClubAttendanceStatus, number>) {
  return `${String(counts.present)} geldi · ${String(counts.absent)} gelmedi · ${String(counts.excused)} izinli`
}
