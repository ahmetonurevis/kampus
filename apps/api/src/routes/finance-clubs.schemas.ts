import { z } from 'zod'

import { CLUB_ATTENDANCE_STATUSES } from '@kampus/school-core/lib/finance-clubs.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Kulüp, üyelik ve yoklama şemaları (DOM-FIN-142; ON-098; K-483). */

const counts = z
  .object({ present: z.number().int(), absent: z.number().int(), excused: z.number().int() })
  .describe('Oturumdaki geldi, gelmedi ve izinli sayısı')

export const clubRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  teacherMembershipId: z.string().describe('Sorumlu öğretmenin kurum üyeliği'),
  teacherName: z.string().nullable(),
  capacity: z.number().int(),
  memberCount: z.number().int().describe('Etkin üye sayısı'),
  meetingDay: z.number().int().describe('Haftanın günü (1 Pazartesi … 7 Pazar)'),
  startTime: z.string().describe('SS:DD'),
  endTime: z.string().describe('SS:DD'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const clubMemberSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  // kvkk: K (öğrenci)
  studentName: z.string(),
  joinedAt: z.string().describe('Üyelik anı (ISO 8601)'),
  sessionCount: z.number().int().describe('Katıldığı (işaretlendiği) etkin oturum sayısı'),
  presentCount: z.number().int().describe('Geldi işaretli oturum sayısı'),
  version: z.number().int().describe('`If-Match` için üyelik sürümü (sonlandırma)'),
})

export const clubDetailSchema = clubRowSchema.extend({
  members: z.array(clubMemberSchema).describe('Etkin üyeler, ada göre'),
  sessions: z
    .array(
      z.object({
        id: z.string(),
        sessionDate: z.string().describe('Oturum günü (YYYY-MM-DD)'),
        counts,
        version: z.number().int(),
      }),
    )
    .describe('Etkin oturumlar, yeni gün önce'),
})

export const clubSessionSchema = z.object({
  id: z.string(),
  clubId: z.string(),
  sessionDate: z.string(),
  counts,
  marks: z.array(
    z.object({
      memberId: z.string(),
      studentId: z.string().nullable(),
      studentName: z.string(),
      status: z.enum(CLUB_ATTENDANCE_STATUSES),
    }),
  ),
  version: z.number().int().describe('`If-Match` için oturum sürümü (arşiv)'),
})

export const myClubSchema = z.object({
  studentId: z.string(),
  studentName: z.string(),
  clubId: z.string(),
  clubName: z.string(),
  teacherName: z.string().nullable(),
  meetingDay: z.number().int(),
  startTime: z.string(),
  endTime: z.string(),
  joinedAt: z.string(),
  sessionCount: z.number().int(),
  presentCount: z.number().int(),
})

export const clubResponse = dataResponse(clubDetailSchema)
export const clubListResponse = z.object({ data: z.array(clubRowSchema), meta: pageMetaSchema })
export const clubMemberResponse = dataResponse(clubMemberSchema)
export const clubSessionResponse = dataResponse(clubSessionSchema)
export const clubArchivedResponse = dataResponse(z.object({ id: z.string() }))
export const myClubsResponse = dataResponse(z.array(myClubSchema))

export const clubListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Kulüp adında arama'),
})

export const clubParams = z.object({ clubId: z.uuid('Kulüp geçersiz.') })
export const clubMemberParams = clubParams.extend({ memberId: z.uuid('Üyelik geçersiz.') })
export const clubSessionParams = clubParams.extend({ sessionId: z.uuid('Oturum geçersiz.') })
