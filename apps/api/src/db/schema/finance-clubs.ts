import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  CLUB_ATTENDANCE_STATUSES,
  CLUB_CAPACITY_MAX,
  CLUB_NAME_MAX,
  type ClubAttendanceStatus,
} from '@kampus/school-core/lib/finance-clubs.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))
const TIME_CHECK = sql.raw(`'^([01][0-9]|2[0-3]):[0-5][0-9]$'`)

/**
 * Kulüp (DOM-FIN-142; ON-098; K-483): ad (kurumda arşivlenmemiş kulüpler arasında tekil), sorumlu
 * öğretmen (mevcut kurum üyeliği), kontenjan ve haftalık gün/saat. Arşiv = `archived_at`.
 */
export const schoolClubs = pgTable(
  'school_clubs',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    // kvkk: K (personel üyeliği)
    teacherMembershipId: text('teacher_membership_id').notNull(),
    capacity: integer('capacity').notNull(),
    meetingDay: integer('meeting_day').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'school_clubs_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'school_clubs_teacher_fkey',
      columns: [table.institutionId, table.teacherMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'school_clubs_name_check',
      sql`char_length(${table.name}) between 2 and ${n(CLUB_NAME_MAX)}`,
    ),
    check(
      'school_clubs_capacity_check',
      sql`${table.capacity} between 1 and ${n(CLUB_CAPACITY_MAX)}`,
    ),
    check('school_clubs_meeting_day_check', sql`${table.meetingDay} between 1 and 7`),
    check(
      'school_clubs_time_check',
      sql`${table.startTime} ~ ${TIME_CHECK} and ${table.endTime} ~ ${TIME_CHECK}
        and ${table.endTime} > ${table.startTime}`,
    ),
    uniqueIndex('school_clubs_name_key')
      .on(table.institutionId, table.name)
      .where(sql`${table.archivedAt} is null`),
    index('school_clubs_teacher_idx').on(table.institutionId, table.teacherMembershipId),
  ],
)

/**
 * Kulüp üyeliği (DOM-FIN-142; K-483): öğrenci kulüpte tek etkin üyeliğe sahiptir (kısmi tekil
 * indeks); kontenjan kurum kilidi altında servis denetimiyle korunur. Ayrılış arşivdir.
 * `student_id` `records` kimliğidir.
 */
export const schoolClubMembers = pgTable(
  'school_club_members',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    clubId: uuid('club_id').notNull(),
    // kvkk: K (öğrenci)
    studentId: text('student_id').notNull(),
    // kvkk: K
    joinedByUserId: text('joined_by_user_id').notNull(),
    // kvkk: K
    removedByUserId: text('removed_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'school_club_members_pkey', columns: [table.institutionId, table.id] }),
    unique('school_club_members_club_key').on(table.institutionId, table.clubId, table.id),
    foreignKey({
      name: 'school_club_members_club_fkey',
      columns: [table.institutionId, table.clubId],
      foreignColumns: [schoolClubs.institutionId, schoolClubs.id],
    }).onDelete('restrict'),
    check(
      'school_club_members_removed_check',
      sql`(${table.archivedAt} is null) = (${table.removedByUserId} is null)`,
    ),
    uniqueIndex('school_club_members_student_key')
      .on(table.institutionId, table.clubId, table.studentId)
      .where(sql`${table.archivedAt} is null`),
    index('school_club_members_student_idx').on(table.institutionId, table.studentId),
  ],
)

/**
 * Kulüp oturumu (DOM-FIN-142; K-483): bir günün yoklaması. Aynı kulüpte aynı günün etkin oturumu
 * tektir (kısmi tekil indeks); yanlış oturum arşivlenip yeniden alınır.
 */
export const schoolClubSessions = pgTable(
  'school_club_sessions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    clubId: uuid('club_id').notNull(),
    sessionDate: date('session_date', { mode: 'string' }).notNull(),
    // kvkk: K
    recordedByUserId: text('recorded_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'school_club_sessions_pkey', columns: [table.institutionId, table.id] }),
    unique('school_club_sessions_club_key').on(table.institutionId, table.clubId, table.id),
    foreignKey({
      name: 'school_club_sessions_club_fkey',
      columns: [table.institutionId, table.clubId],
      foreignColumns: [schoolClubs.institutionId, schoolClubs.id],
    }).onDelete('restrict'),
    uniqueIndex('school_club_sessions_date_key')
      .on(table.institutionId, table.clubId, table.sessionDate)
      .where(sql`${table.archivedAt} is null`),
  ],
)

/**
 * Oturum × üye yoklama işareti (DOM-FIN-142; K-483). Oturum ve üyelik aynı kulübe bileşik yabancı
 * anahtarla bağlıdır; bir oturumda üye bir kez işaretlenir (birincil anahtar).
 */
export const schoolClubAttendance = pgTable(
  'school_club_attendance',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    sessionId: uuid('session_id').notNull(),
    memberId: uuid('member_id').notNull(),
    clubId: uuid('club_id').notNull(),
    status: text('status').$type<ClubAttendanceStatus>().notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'school_club_attendance_pkey',
      columns: [table.institutionId, table.sessionId, table.memberId],
    }),
    foreignKey({
      name: 'school_club_attendance_session_fkey',
      columns: [table.institutionId, table.clubId, table.sessionId],
      foreignColumns: [
        schoolClubSessions.institutionId,
        schoolClubSessions.clubId,
        schoolClubSessions.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'school_club_attendance_member_fkey',
      columns: [table.institutionId, table.clubId, table.memberId],
      foreignColumns: [
        schoolClubMembers.institutionId,
        schoolClubMembers.clubId,
        schoolClubMembers.id,
      ],
    }).onDelete('restrict'),
    check('school_club_attendance_status_check', oneOf(table.status, CLUB_ATTENDANCE_STATUSES)),
    index('school_club_attendance_session_idx').on(
      table.institutionId,
      table.clubId,
      table.sessionId,
    ),
    index('school_club_attendance_member_idx').on(
      table.institutionId,
      table.clubId,
      table.memberId,
    ),
  ],
)
