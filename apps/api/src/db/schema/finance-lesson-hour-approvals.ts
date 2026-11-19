import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  LESSON_CONFIRMATION_CHANNELS,
  LESSON_CONFIRMATION_OUTCOMES,
  LESSON_SHEET_STATUSES,
  type LessonConfirmationChannel,
  type LessonConfirmationOutcome,
  type LessonSheetStatus,
} from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'
import {
  PAYROLL_REASON_MAX,
  PAYROLL_REASON_MIN,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))
const MONTH = sql.raw(`'^20[2-9][0-9]-(0[1-9]|1[0-2])$'`)
const SHA256 = sql.raw(`'^[0-9a-f]{64}$'`)

/**
 * Ek ders çizelgesi onayı (DOM-FIN-120; ON-196, K-409…K-411). Kurumda ay başına tek çizelge;
 * kaydı olmayan ay taslaktır. İlk gönderimde satır açılır; durum `draft`, `teacher_review` ya da
 * `approved` (müdür onaylı, ek ders saati kilitli). Son gönderen, son onaylayan ve son yeniden
 * açma (gerekçesiyle) saklanır; önceki geçişler denetim kaydındadır.
 */
export const lessonHourApprovals = pgTable(
  'lesson_hour_approvals',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    month: text('month').notNull(),
    status: text('status').$type<LessonSheetStatus>().notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    // kvkk: K
    submittedByUserId: text('submitted_by_user_id').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    // kvkk: K
    approvedByUserId: text('approved_by_user_id'),
    approvalCount: integer('approval_count').notNull().default(0),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    // kvkk: K
    reopenedByUserId: text('reopened_by_user_id'),
    // kvkk: Ç
    reopenReason: text('reopen_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'lesson_hour_approvals_pkey', columns: [table.institutionId, table.id] }),
    check('lesson_hour_approvals_month_check', sql`${table.month} ~ ${MONTH}`),
    check('lesson_hour_approvals_status_check', oneOf(table.status, LESSON_SHEET_STATUSES)),
    check(
      'lesson_hour_approvals_approval_check',
      sql`${table.approvalCount} >= 0
        and ((${table.approvedAt} is null) = (${table.approvedByUserId} is null))
        and ((${table.approvedAt} is null) = (${table.approvalCount} = 0))
        and (${table.status} <> 'approved' or ${table.approvedAt} is not null)`,
    ),
    check(
      'lesson_hour_approvals_reopen_check',
      sql`((${table.reopenedAt} is null) = (${table.reopenedByUserId} is null))
        and ((${table.reopenedAt} is null) = (${table.reopenReason} is null))
        and (${table.reopenReason} is null or char_length(${table.reopenReason})
          between ${n(PAYROLL_REASON_MIN)} and ${n(PAYROLL_REASON_MAX)})`,
    ),
    uniqueIndex('lesson_hour_approvals_month_key')
      .on(table.institutionId, table.month)
      .where(sql`${table.archivedAt} is null`),
  ],
)

/**
 * Öğretmen yanıtı (DOM-FIN-120; K-409): ön büro ya da yönetici öğretmen adına teyit ya da
 * gerekçeli itirazı alındığı kanalla işler. Yanıt personelin o anki saat kayıtlarının özetini
 * (`entries_hash`) taşır; kayıtlar değişince teyit geçersizleşir. Satır değişmez (tetikleyici);
 * personelin durumu son satırdan (`sequence`) hesaplanır.
 */
export const lessonHourConfirmations = pgTable(
  'lesson_hour_confirmations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    approvalId: uuid('approval_id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    outcome: text('outcome').$type<LessonConfirmationOutcome>().notNull(),
    channel: text('channel').$type<LessonConfirmationChannel>().notNull(),
    // kvkk: Ç
    reason: text('reason'),
    entriesHash: text('entries_hash').notNull(),
    // kvkk: K
    recordedByUserId: text('recorded_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'lesson_hour_confirmations_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'lesson_hour_confirmations_approval_fkey',
      columns: [table.institutionId, table.approvalId],
      foreignColumns: [lessonHourApprovals.institutionId, lessonHourApprovals.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lesson_hour_confirmations_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'lesson_hour_confirmations_outcome_check',
      oneOf(table.outcome, LESSON_CONFIRMATION_OUTCOMES),
    ),
    check(
      'lesson_hour_confirmations_channel_check',
      oneOf(table.channel, LESSON_CONFIRMATION_CHANNELS),
    ),
    check(
      'lesson_hour_confirmations_reason_check',
      sql`(${table.outcome} = 'disputed') = (${table.reason} is not null)
        and (${table.reason} is null or char_length(${table.reason})
          between ${n(PAYROLL_REASON_MIN)} and ${n(PAYROLL_REASON_MAX)})`,
    ),
    check('lesson_hour_confirmations_hash_check', sql`${table.entriesHash} ~ ${SHA256}`),
    check('lesson_hour_confirmations_sequence_check', sql`${table.sequence} >= 1`),
    uniqueIndex('lesson_hour_confirmations_sequence_key').on(
      table.institutionId,
      table.approvalId,
      table.sequence,
    ),
    index('lesson_hour_confirmations_membership_idx').on(table.institutionId, table.membershipId),
  ],
)
