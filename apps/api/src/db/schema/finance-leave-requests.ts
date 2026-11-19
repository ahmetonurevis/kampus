import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  LEAVE_LESSON_TITLE_MAX,
  LEAVE_REQUEST_DESCRIPTION_MAX,
  LEAVE_REQUEST_REASON_MAX,
  LEAVE_REQUEST_REASON_MIN,
  LEAVE_REQUEST_STATUSES,
  type LeaveRequestStatus,
} from '@kampus/school-core/lib/finance-leave-requests.ts'
import {
  LEAVE_DAYS_MAX,
  LEAVE_KINDS,
  LEAVE_LABEL_MAX,
  LEAVE_LABEL_MIN,
  type LeaveKind,
} from '@kampus/school-core/lib/finance-staff-leave.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Personel izin talebi (DOM-FIN-116; ON-182; K-397…K-399). Talep bekliyor → onaylandı ya da
 * reddedildi; bekleyen ya da onaylı talep gerekçeyle iptal edilir. Onaylanan talep kullanılmış izin
 * kaydını (`staff_leave_records.request_id`) üretir. Tür adının ve yıllıktan düşer ayarının talep
 * anındaki kopyasını gösterim için taşır; onay türün güncel ayarıyla kayıt yazar. Silinmez.
 */
export const staffLeaveRequests = pgTable(
  'staff_leave_requests',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    typeCode: text('type_code').notNull(),
    kind: text('kind').$type<LeaveKind>().notNull(),
    typeLabel: text('type_label').notNull(),
    deductsFromAnnual: boolean('deducts_from_annual').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    days: integer('days').notNull(),
    // kvkk: K (serbest metin)
    description: text('description'),
    status: text('status').$type<LeaveRequestStatus>().notNull().default('pending'),
    // kvkk: K
    requestedByUserId: text('requested_by_user_id').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // kvkk: K
    decidedByUserId: text('decided_by_user_id'),
    // kvkk: K (serbest metin)
    rejectReason: text('reject_reason'),
    advanceApproved: boolean('advance_approved').notNull().default(false),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    // kvkk: K (serbest metin)
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_leave_requests_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_leave_requests_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('staff_leave_requests_status_check', oneOf(table.status, LEAVE_REQUEST_STATUSES)),
    // Rapor talep edilmez (sağlık raporu kaydından okunur, ON-185).
    check(
      'staff_leave_requests_kind_check',
      sql`${oneOf(table.kind, LEAVE_KINDS)} and ${table.kind} <> 'sick'`,
    ),
    check(
      'staff_leave_requests_dates_check',
      sql`${table.endDate} >= ${table.startDate}
        and ${table.days} between 1 and least(${n(LEAVE_DAYS_MAX)},
          ${table.endDate} - ${table.startDate} + 1)`,
    ),
    check(
      'staff_leave_requests_label_check',
      sql`char_length(${table.typeLabel}) between ${n(LEAVE_LABEL_MIN)} and ${n(LEAVE_LABEL_MAX)}`,
    ),
    check(
      'staff_leave_requests_description_check',
      sql`${table.description} is null
        or char_length(${table.description}) between 1 and ${n(LEAVE_REQUEST_DESCRIPTION_MAX)}`,
    ),
    // Karar alanları yalnız karara bağlanmış talepte; ret gerekçesi yalnız retle.
    check(
      'staff_leave_requests_decision_check',
      sql`((${table.decidedAt} is null) = (${table.decidedByUserId} is null))
        and (${table.status} <> 'pending' or ${table.decidedAt} is null)
        and (${table.status} not in ('approved', 'rejected') or ${table.decidedAt} is not null)
        and ((${table.status} = 'rejected') = (${table.rejectReason} is not null))
        and (${table.rejectReason} is null or char_length(${table.rejectReason})
          between ${n(LEAVE_REQUEST_REASON_MIN)} and ${n(LEAVE_REQUEST_REASON_MAX)})
        and (not ${table.advanceApproved} or ${table.decidedAt} is not null)`,
    ),
    check(
      'staff_leave_requests_cancel_check',
      sql`((${table.status} = 'cancelled') = (${table.cancelledAt} is not null))
        and ((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null))
        and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))
        and (${table.cancelReason} is null or char_length(${table.cancelReason})
          between ${n(LEAVE_REQUEST_REASON_MIN)} and ${n(LEAVE_REQUEST_REASON_MAX)})`,
    ),
    index('staff_leave_requests_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.startDate,
    ),
    index('staff_leave_requests_status_idx').on(table.institutionId, table.status, table.startDate),
  ],
)

/**
 * Talebin etkilediği ders ve yedek öğretmen bağı (K-399). Talep açılırken ders programından
 * (`records`, `schedule`) kopyalanır; yedek öğretmen elle seçilir ve ders programına yazılmaz.
 */
export const staffLeaveRequestLessons = pgTable(
  'staff_leave_request_lessons',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    requestId: uuid('request_id').notNull(),
    lessonId: text('lesson_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    duration: integer('duration').notNull(),
    classId: text('class_id').notNull(),
    subjectId: text('subject_id').notNull(),
    title: text('title').notNull(),
    // kvkk: K (öğretmen kaydı)
    substituteTeacherId: text('substitute_teacher_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'staff_leave_request_lessons_pkey',
      columns: [table.institutionId, table.requestId, table.lessonId],
    }),
    foreignKey({
      name: 'staff_leave_request_lessons_request_fkey',
      columns: [table.institutionId, table.requestId],
      foreignColumns: [staffLeaveRequests.institutionId, staffLeaveRequests.id],
    }).onDelete('restrict'),
    check('staff_leave_request_lessons_duration_check', sql`${table.duration} between 0 and 1440`),
    check(
      'staff_leave_request_lessons_title_check',
      sql`char_length(${table.title}) between 1 and ${n(LEAVE_LESSON_TITLE_MAX)}`,
    ),
  ],
)
