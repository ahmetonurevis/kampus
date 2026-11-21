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
  STAFF_FEEDBACK_CHANNELS,
  STAFF_FEEDBACK_QUESTIONS_MAX,
  STAFF_FEEDBACK_REASON_MAX,
  STAFF_FEEDBACK_REASON_MIN,
  STAFF_FEEDBACK_RELATIONS,
  STAFF_FEEDBACK_STATUSES,
  STAFF_FEEDBACK_THRESHOLD_DEFAULT,
  STAFF_FEEDBACK_THRESHOLD_MAX,
  STAFF_FEEDBACK_THRESHOLD_MIN,
  type StaffFeedbackAnswer,
  type StaffFeedbackChannel,
  type StaffFeedbackQuestion,
  type StaffFeedbackRelation,
  type StaffFeedbackStatus,
} from '@kampus/school-core/lib/finance-staff-feedback.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { performancePeriods, performanceReviews } from './finance-performance.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Çok kaynaklı geri bildirim kurum ayarı (DOM-FIN-134; ON-212): meslektaş anonimlik eşiği. Satır
 * yoksa varsayılan (3) geçerlidir (K-459).
 */
export const staffFeedbackSettings = pgTable(
  'staff_feedback_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    peerAnonymityThreshold: integer('peer_anonymity_threshold')
      .notNull()
      .default(STAFF_FEEDBACK_THRESHOLD_DEFAULT),
    ...requiredColumns(),
  },
  (table) => [
    check(
      'staff_feedback_settings_threshold_check',
      sql`${table.peerAnonymityThreshold} between ${n(STAFF_FEEDBACK_THRESHOLD_MIN)} and ${n(STAFF_FEEDBACK_THRESHOLD_MAX)}`,
    ),
  ],
)

/**
 * Geri bildirim şablonu (DOM-FIN-134; ON-212). Performans dönemi başına tek şablon; sorular sıralı
 * jsonb dizisidir. Dönemde yanıt girilince ya da dönem kapanınca sorular değişmez (K-457).
 */
export const staffFeedbackTemplates = pgTable(
  'staff_feedback_templates',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    periodId: uuid('period_id').notNull(),
    questions: jsonb('questions').$type<StaffFeedbackQuestion[]>().notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_feedback_templates_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_feedback_templates_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [performancePeriods.institutionId, performancePeriods.id],
    }).onDelete('restrict'),
    check(
      'staff_feedback_templates_questions_check',
      sql`jsonb_typeof(${table.questions}) = 'array' and jsonb_array_length(${table.questions}) between 1 and ${n(STAFF_FEEDBACK_QUESTIONS_MAX)}`,
    ),
    uniqueIndex('staff_feedback_templates_period_key').on(table.institutionId, table.periodId),
  ],
)

/**
 * Değerlendiren ataması ve yanıtı (DOM-FIN-134; ON-212). Personel ayrı tablo değildir:
 * değerlendirilen üyeliği dönemdeki performans kaydına, değerlendiren kurum üyeliğine bağlanır;
 * ikisi aynı kişi olamaz. Yanıtı girilmemiş atama kaldırılınca arşivlenir. Yanıt atamanın üzerindedir: bekliyor → yanıtlandı; geri alınınca cevaplar
 * silinir, son gerekçe ve geri alma sayısı saklanır (K-458). Meslektaş yanıtı tek tek okunmaz,
 * yalnız toplu ve eşik üstünde gösterilir (K-459).
 */
export const staffFeedbackAssignments = pgTable(
  'staff_feedback_assignments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    periodId: uuid('period_id').notNull(),
    // kvkk: K (personel üyeliği)
    subjectMembershipId: text('subject_membership_id').notNull(),
    // kvkk: K (personel üyeliği)
    reviewerMembershipId: text('reviewer_membership_id').notNull(),
    relation: text('relation').$type<StaffFeedbackRelation>().notNull(),
    status: text('status').$type<StaffFeedbackStatus>().notNull().default('pending'),
    templateId: uuid('template_id'),
    // kvkk: K (puan ve serbest metin; loglanmaz, denetime yazılmaz)
    answers: jsonb('answers').$type<StaffFeedbackAnswer[]>(),
    channel: text('channel').$type<StaffFeedbackChannel>(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // kvkk: K
    submittedByUserId: text('submitted_by_user_id'),
    withdrawCount: integer('withdraw_count').notNull().default(0),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    // kvkk: K
    withdrawnByUserId: text('withdrawn_by_user_id'),
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    withdrawReason: text('withdraw_reason'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'staff_feedback_assignments_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'staff_feedback_assignments_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [performancePeriods.institutionId, performancePeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_feedback_assignments_subject_fkey',
      columns: [table.institutionId, table.subjectMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_feedback_assignments_review_fkey',
      columns: [table.institutionId, table.periodId, table.subjectMembershipId],
      foreignColumns: [
        performanceReviews.institutionId,
        performanceReviews.periodId,
        performanceReviews.membershipId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_feedback_assignments_reviewer_fkey',
      columns: [table.institutionId, table.reviewerMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_feedback_assignments_template_fkey',
      columns: [table.institutionId, table.templateId],
      foreignColumns: [staffFeedbackTemplates.institutionId, staffFeedbackTemplates.id],
    }).onDelete('restrict'),
    check(
      'staff_feedback_assignments_self_check',
      sql`${table.subjectMembershipId} <> ${table.reviewerMembershipId}`,
    ),
    check(
      'staff_feedback_assignments_relation_check',
      oneOf(table.relation, STAFF_FEEDBACK_RELATIONS),
    ),
    check('staff_feedback_assignments_status_check', oneOf(table.status, STAFF_FEEDBACK_STATUSES)),
    check(
      'staff_feedback_assignments_channel_check',
      sql`${table.channel} is null or ${oneOf(table.channel, STAFF_FEEDBACK_CHANNELS)}`,
    ),
    check(
      'staff_feedback_assignments_response_check',
      sql`((${table.status} = 'submitted') = (${table.answers} is not null))
        and ((${table.answers} is null) = (${table.channel} is null))
        and ((${table.answers} is null) = (${table.submittedAt} is null))
        and ((${table.submittedAt} is null) = (${table.submittedByUserId} is null))
        and (${table.answers} is null or ${table.templateId} is not null)
        and (${table.answers} is null or (jsonb_typeof(${table.answers}) = 'array' and jsonb_array_length(${table.answers}) between 1 and ${n(STAFF_FEEDBACK_QUESTIONS_MAX)}))`,
    ),
    check(
      'staff_feedback_assignments_withdraw_check',
      sql`${table.withdrawCount} >= 0
        and ((${table.withdrawCount} = 0) = (${table.withdrawnAt} is null))
        and ((${table.withdrawnAt} is null) = (${table.withdrawnByUserId} is null))
        and ((${table.withdrawnAt} is null) = (${table.withdrawReason} is null))
        and (${table.withdrawReason} is null or char_length(${table.withdrawReason}) between ${n(STAFF_FEEDBACK_REASON_MIN)} and ${n(STAFF_FEEDBACK_REASON_MAX)})`,
    ),
    uniqueIndex('staff_feedback_assignments_pair_key')
      .on(
        table.institutionId,
        table.periodId,
        table.subjectMembershipId,
        table.reviewerMembershipId,
      )
      .where(sql`${table.archivedAt} is null`),
    index('staff_feedback_assignments_period_idx').on(table.institutionId, table.periodId),
    index('staff_feedback_assignments_subject_idx').on(
      table.institutionId,
      table.subjectMembershipId,
    ),
    index('staff_feedback_assignments_reviewer_idx').on(
      table.institutionId,
      table.reviewerMembershipId,
    ),
    index('staff_feedback_assignments_template_idx').on(table.institutionId, table.templateId),
  ],
)
