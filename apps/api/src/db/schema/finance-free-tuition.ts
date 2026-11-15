import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  FREE_TUITION_DOCUMENTS,
  FREE_TUITION_REASONS,
  FREE_TUITION_STATUSES,
} from '@kampus/school-core/lib/finance-free-tuition.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { bankAccounts } from './payments.ts'

/**
 * Ücretsiz okutma (DOM-FIN-026; IST-105): eğitim yılı dönemi ve kontenjanı, aday, değerlendirme
 * kurulu toplantısı ve kabul edilen öğrencinin hakkı (ücret sıfırlama, iade, MEBBİS işareti).
 * `student_id` ve sözleşme/taksit kimlikleri `records` kimlikleridir, yabancı anahtar değildir.
 */
export const freeTuitionRounds = pgTable(
  'free_tuition_rounds',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    academicYear: integer('academic_year').notNull(),
    teachingStartDate: date('teaching_start_date').notNull(),
    studentCount: integer('student_count'),
    computedQuota: integer('computed_quota'),
    confirmedQuota: integer('confirmed_quota'),
    // kvkk: K
    quotaConfirmedByUserId: text('quota_confirmed_by_user_id'),
    quotaConfirmedAt: timestamp('quota_confirmed_at', { withTimezone: true }),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'free_tuition_rounds_pkey', columns: [table.institutionId, table.id] }),
    check(
      'free_tuition_rounds_quota_check',
      sql`(${table.confirmedQuota} is null) = (${table.quotaConfirmedAt} is null)
        and (${table.confirmedQuota} is null) = (${table.studentCount} is null)
        and (${table.confirmedQuota} is null) = (${table.computedQuota} is null)
        and (${table.confirmedQuota} is null) = (${table.quotaConfirmedByUserId} is null)
        and (${table.confirmedQuota} is null or (${table.studentCount} >= 0
          and ${table.computedQuota} >= 0 and ${table.confirmedQuota} >= ${table.computedQuota}))`,
    ),
    uniqueIndex('free_tuition_rounds_year_key')
      .on(table.institutionId, table.academicYear)
      .where(sql`${table.archivedAt} is null`),
  ],
)

export type FreeTuitionBoardMember = { name: string; title: string }
export type FreeTuitionBoardDecision = {
  applicationId: string
  studentId: string
  decision: 'accepted' | 'reserve' | 'rejected'
}

export const freeTuitionBoardMeetings = pgTable(
  'free_tuition_board_meetings',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    roundId: uuid('round_id').notNull(),
    meetingDate: date('meeting_date').notNull(),
    // kvkk: K
    members: jsonb('members').$type<FreeTuitionBoardMember[]>().notNull(),
    decisions: jsonb('decisions').$type<FreeTuitionBoardDecision[]>().notNull(),
    // kvkk: K
    recordedByUserId: text('recorded_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'free_tuition_board_meetings_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'free_tuition_board_meetings_round_fkey',
      columns: [table.institutionId, table.roundId],
      foreignColumns: [freeTuitionRounds.institutionId, freeTuitionRounds.id],
    }).onDelete('restrict'),
    check(
      'free_tuition_board_meetings_members_check',
      sql`jsonb_typeof(${table.members}) = 'array' and jsonb_array_length(${table.members}) between 3 and 9`,
    ),
    check(
      'free_tuition_board_meetings_decisions_check',
      sql`jsonb_typeof(${table.decisions}) = 'array' and jsonb_array_length(${table.decisions}) > 0`,
    ),
    index('free_tuition_board_meetings_round_idx').on(table.institutionId, table.roundId),
  ],
)

export const freeTuitionApplications = pgTable(
  'free_tuition_applications',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    roundId: uuid('round_id').notNull(),
    // kvkk: K
    studentId: text('student_id').notNull(),
    // kvkk: Ç
    reason: text('reason').notNull(),
    // kvkk: Ç
    documents: text('documents')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status').notNull().default('pending'),
    boardMeetingId: uuid('board_meeting_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'free_tuition_applications_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'free_tuition_applications_round_fkey',
      columns: [table.institutionId, table.roundId],
      foreignColumns: [freeTuitionRounds.institutionId, freeTuitionRounds.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'free_tuition_applications_meeting_fkey',
      columns: [table.institutionId, table.boardMeetingId],
      foreignColumns: [freeTuitionBoardMeetings.institutionId, freeTuitionBoardMeetings.id],
    }).onDelete('restrict'),
    check('free_tuition_applications_reason_check', oneOf(table.reason, FREE_TUITION_REASONS)),
    check(
      'free_tuition_applications_documents_check',
      sql`${table.documents} <@ array[${sql.raw(
        FREE_TUITION_DOCUMENTS.map((item) => `'${item}'`).join(', '),
      )}]::text[]`,
    ),
    check('free_tuition_applications_status_check', oneOf(table.status, FREE_TUITION_STATUSES)),
    check(
      'free_tuition_applications_meeting_check',
      sql`(${table.status} = 'pending') = (${table.boardMeetingId} is null)`,
    ),
    index('free_tuition_applications_round_idx').on(table.institutionId, table.roundId),
    uniqueIndex('free_tuition_applications_student_key')
      .on(table.institutionId, table.roundId, table.studentId)
      .where(sql`${table.archivedAt} is null`),
    index('free_tuition_applications_meeting_idx')
      .on(table.institutionId, table.boardMeetingId)
      .where(sql`${table.boardMeetingId} is not null`),
  ],
)

export const freeTuitionAwards = pgTable(
  'free_tuition_awards',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    roundId: uuid('round_id').notNull(),
    applicationId: uuid('application_id').notNull(),
    boardMeetingId: uuid('board_meeting_id').notNull(),
    // kvkk: K
    studentId: text('student_id').notNull(),
    academicYear: integer('academic_year').notNull(),
    acceptedDate: date('accepted_date').notNull(),
    contractId: text('contract_id').notNull(),
    contractIds: text('contract_ids').array().notNull(),
    cancelledInvoiceIds: text('cancelled_invoice_ids').array().notNull(),
    refundedInvoiceIds: text('refunded_invoice_ids').array().notNull(),
    // kvkk: Ç
    waivedCents: bigint('waived_cents', { mode: 'number' }).notNull(),
    // kvkk: Ç
    refundCents: bigint('refund_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    refundDueDate: date('refund_due_date').notNull(),
    refundPaidDate: date('refund_paid_date'),
    // kvkk: Ç
    refundIban: text('refund_iban'),
    // kvkk: K
    refundAccountHolder: text('refund_account_holder'),
    // kvkk: K
    refundPaidByUserId: text('refund_paid_by_user_id'),
    refundBankAccountId: uuid('refund_bank_account_id'),
    mebbisRecordedDate: date('mebbis_recorded_date'),
    // kvkk: K
    awardedByUserId: text('awarded_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'free_tuition_awards_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'free_tuition_awards_round_fkey',
      columns: [table.institutionId, table.roundId],
      foreignColumns: [freeTuitionRounds.institutionId, freeTuitionRounds.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'free_tuition_awards_application_fkey',
      columns: [table.institutionId, table.applicationId],
      foreignColumns: [freeTuitionApplications.institutionId, freeTuitionApplications.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'free_tuition_awards_meeting_fkey',
      columns: [table.institutionId, table.boardMeetingId],
      foreignColumns: [freeTuitionBoardMeetings.institutionId, freeTuitionBoardMeetings.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'free_tuition_awards_refund_bank_account_fkey',
      columns: [table.institutionId, table.refundBankAccountId],
      foreignColumns: [bankAccounts.institutionId, bankAccounts.id],
    }).onDelete('restrict'),
    check(
      'free_tuition_awards_amounts_check',
      sql`${table.waivedCents} >= 0 and ${table.refundCents} >= 0`,
    ),
    check('free_tuition_awards_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'free_tuition_awards_refund_paid_check',
      sql`(${table.refundPaidDate} is null) = (${table.refundIban} is null)
        and (${table.refundPaidDate} is null) = (${table.refundAccountHolder} is null)
        and (${table.refundPaidDate} is null) = (${table.refundPaidByUserId} is null)
        and (${table.refundPaidDate} is null) = (${table.refundBankAccountId} is null)
        and (${table.refundPaidDate} is null or ${table.refundCents} > 0)`,
    ),
    uniqueIndex('free_tuition_awards_application_key').on(table.institutionId, table.applicationId),
    uniqueIndex('free_tuition_awards_student_year_key')
      .on(table.institutionId, table.studentId, table.academicYear)
      .where(sql`${table.archivedAt} is null`),
    index('free_tuition_awards_round_idx').on(table.institutionId, table.roundId),
    index('free_tuition_awards_meeting_idx').on(table.institutionId, table.boardMeetingId),
    index('free_tuition_awards_refund_bank_account_idx')
      .on(table.institutionId, table.refundBankAccountId)
      .where(sql`${table.refundBankAccountId} is not null`),
    index('free_tuition_awards_refund_paid_idx')
      .on(table.institutionId, table.refundPaidDate)
      .where(sql`${table.refundPaidDate} is not null`),
  ],
)
