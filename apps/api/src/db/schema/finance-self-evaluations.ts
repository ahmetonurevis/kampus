import { sql } from 'drizzle-orm'
import {
  check,
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
  SELF_EVALUATION_CHANNELS,
  SELF_EVALUATION_QUESTIONS_MAX,
  SELF_EVALUATION_REASON_MAX,
  SELF_EVALUATION_REASON_MIN,
  SELF_EVALUATION_STATUSES,
  SELF_EVALUATION_TEXT_MAX,
  type SelfEvaluationAnswer,
  type SelfEvaluationChannel,
  type SelfEvaluationQuestion,
  type SelfEvaluationStatus,
} from '@kampus/school-core/lib/finance-self-evaluations.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { performancePeriods, performanceReviews } from './finance-performance.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Öz değerlendirme şablonu (DOM-FIN-131; ON-210). Performans dönemi başına tek şablon; sorular
 * sıralı jsonb dizisidir. Dönemde yanıt açılınca ya da dönem kapanınca sorular değişmez (K-448).
 */
export const selfEvaluationTemplates = pgTable(
  'self_evaluation_templates',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    periodId: uuid('period_id').notNull(),
    questions: jsonb('questions').$type<SelfEvaluationQuestion[]>().notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'self_evaluation_templates_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'self_evaluation_templates_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [performancePeriods.institutionId, performancePeriods.id],
    }).onDelete('restrict'),
    check(
      'self_evaluation_templates_questions_check',
      sql`jsonb_typeof(${table.questions}) = 'array' and jsonb_array_length(${table.questions}) between 1 and ${n(SELF_EVALUATION_QUESTIONS_MAX)}`,
    ),
    uniqueIndex('self_evaluation_templates_period_key').on(table.institutionId, table.periodId),
  ],
)

/**
 * Personel × dönem öz değerlendirme yanıtı (DOM-FIN-131; ON-210). Personel ayrı tablo değildir:
 * yanıt üyeliğe ve dönemdeki performans kaydına bağlanır (yalnız dönemdeki personel yanıt verir).
 * Taslak → gönderildi; geri açılınca taslağa döner, son gerekçe ve açılma sayısı saklanır (K-449).
 * Kişisel veri: yalnız yönetici okur, ayrıntı okuması denetime düşer (K-450).
 */
export const selfEvaluationResponses = pgTable(
  'self_evaluation_responses',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    periodId: uuid('period_id').notNull(),
    templateId: uuid('template_id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    // kvkk: K (puan ve serbest metin; loglanmaz)
    answers: jsonb('answers').$type<SelfEvaluationAnswer[]>().notNull(),
    status: text('status').$type<SelfEvaluationStatus>().notNull().default('draft'),
    channel: text('channel').$type<SelfEvaluationChannel>().notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // kvkk: K
    submittedByUserId: text('submitted_by_user_id'),
    // kvkk: K (serbest metin; loglanmaz)
    managerComment: text('manager_comment'),
    // kvkk: K
    managerCommentByName: text('manager_comment_by_name'),
    managerCommentAt: timestamp('manager_comment_at', { withTimezone: true }),
    reopenCount: integer('reopen_count').notNull().default(0),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    // kvkk: K
    reopenedByUserId: text('reopened_by_user_id'),
    // kvkk: K (serbest metin; loglanmaz)
    reopenReason: text('reopen_reason'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'self_evaluation_responses_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'self_evaluation_responses_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [performancePeriods.institutionId, performancePeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'self_evaluation_responses_template_fkey',
      columns: [table.institutionId, table.templateId],
      foreignColumns: [selfEvaluationTemplates.institutionId, selfEvaluationTemplates.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'self_evaluation_responses_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'self_evaluation_responses_review_fkey',
      columns: [table.institutionId, table.periodId, table.membershipId],
      foreignColumns: [
        performanceReviews.institutionId,
        performanceReviews.periodId,
        performanceReviews.membershipId,
      ],
    }).onDelete('restrict'),
    check('self_evaluation_responses_status_check', oneOf(table.status, SELF_EVALUATION_STATUSES)),
    check(
      'self_evaluation_responses_channel_check',
      oneOf(table.channel, SELF_EVALUATION_CHANNELS),
    ),
    check(
      'self_evaluation_responses_answers_check',
      sql`jsonb_typeof(${table.answers}) = 'array' and jsonb_array_length(${table.answers}) between 1 and ${n(SELF_EVALUATION_QUESTIONS_MAX)}`,
    ),
    check(
      'self_evaluation_responses_submitted_check',
      sql`((${table.status} = 'submitted') = (${table.submittedAt} is not null))
        and ((${table.submittedAt} is null) = (${table.submittedByUserId} is null))`,
    ),
    check(
      'self_evaluation_responses_comment_check',
      sql`(${table.managerComment} is null or char_length(${table.managerComment}) between 1 and ${n(SELF_EVALUATION_TEXT_MAX)})
        and ((${table.managerComment} is null) = (${table.managerCommentByName} is null))
        and ((${table.managerComment} is null) = (${table.managerCommentAt} is null))`,
    ),
    check(
      'self_evaluation_responses_reopen_check',
      sql`${table.reopenCount} >= 0
        and ((${table.reopenCount} = 0) = (${table.reopenedAt} is null))
        and ((${table.reopenedAt} is null) = (${table.reopenedByUserId} is null))
        and ((${table.reopenedAt} is null) = (${table.reopenReason} is null))
        and (${table.reopenReason} is null or char_length(${table.reopenReason}) between ${n(SELF_EVALUATION_REASON_MIN)} and ${n(SELF_EVALUATION_REASON_MAX)})`,
    ),
    uniqueIndex('self_evaluation_responses_member_key').on(
      table.institutionId,
      table.periodId,
      table.membershipId,
    ),
    index('self_evaluation_responses_template_idx').on(table.institutionId, table.templateId),
    index('self_evaluation_responses_membership_idx').on(table.institutionId, table.membershipId),
  ],
)
