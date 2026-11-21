import { sql } from 'drizzle-orm'
import {
  boolean,
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
  STAFF_FEEDBACK_THRESHOLD_MAX,
  STAFF_FEEDBACK_THRESHOLD_MIN,
} from '@kampus/school-core/lib/finance-staff-feedback.ts'
import {
  STAFF_SURVEY_QUESTIONS_MAX,
  STAFF_SURVEY_STATUSES,
  STAFF_SURVEY_TITLE_MAX,
  STAFF_SURVEY_TITLE_MIN,
  type StaffSurveyAnswer,
  type StaffSurveyQuestion,
  type StaffSurveyStatus,
} from '@kampus/school-core/lib/finance-staff-surveys.ts'
import type { StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { orgUnits } from './finance-org-chart.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Personel memnuniyet anketi (DOM-FIN-143; ON-191; K-484). Taslak düzeltilir; yayımlanan satır
 * değişmez (`kampus_guard_staff_survey` tetikleyicisi, 55000). Yeni sürüm yayımlanmış anketin
 * kopyasıdır (`source_survey_id`, `revision`); bir sürümün tek etkin kopyası olur.
 */
export const staffSurveys = pgTable(
  'staff_surveys',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    title: text('title').notNull(),
    revision: integer('revision').notNull().default(1),
    sourceSurveyId: uuid('source_survey_id'),
    status: text('status').$type<StaffSurveyStatus>().notNull().default('draft'),
    openDate: date('open_date', { mode: 'string' }).notNull(),
    closeDate: date('close_date', { mode: 'string' }).notNull(),
    anonymityThreshold: integer('anonymity_threshold').notNull(),
    audienceRoles: jsonb('audience_roles').$type<StaffRole[]>().notNull(),
    audienceUnitIds: jsonb('audience_unit_ids').$type<string[]>().notNull(),
    questions: jsonb('questions').$type<StaffSurveyQuestion[]>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // kvkk: K
    publishedByUserId: text('published_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_surveys_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_surveys_source_fkey',
      columns: [table.institutionId, table.sourceSurveyId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    check('staff_surveys_status_check', oneOf(table.status, STAFF_SURVEY_STATUSES)),
    check(
      'staff_surveys_title_check',
      sql`char_length(${table.title}) between ${n(STAFF_SURVEY_TITLE_MIN)} and ${n(STAFF_SURVEY_TITLE_MAX)}`,
    ),
    check('staff_surveys_dates_check', sql`${table.closeDate} >= ${table.openDate}`),
    check(
      'staff_surveys_threshold_check',
      sql`${table.anonymityThreshold} between ${n(STAFF_FEEDBACK_THRESHOLD_MIN)} and ${n(STAFF_FEEDBACK_THRESHOLD_MAX)}`,
    ),
    check('staff_surveys_revision_check', sql`${table.revision} >= 1`),
    check(
      'staff_surveys_questions_check',
      sql`jsonb_typeof(${table.questions}) = 'array' and jsonb_array_length(${table.questions}) between 1 and ${n(STAFF_SURVEY_QUESTIONS_MAX)}`,
    ),
    check(
      'staff_surveys_audience_check',
      sql`jsonb_typeof(${table.audienceRoles}) = 'array' and jsonb_typeof(${table.audienceUnitIds}) = 'array'`,
    ),
    check(
      'staff_surveys_published_check',
      sql`((${table.status} = 'published') = (${table.publishedAt} is not null))
        and ((${table.publishedAt} is null) = (${table.publishedByUserId} is null))`,
    ),
    uniqueIndex('staff_surveys_source_key')
      .on(table.institutionId, table.sourceSurveyId)
      .where(sql`${table.sourceSurveyId} is not null and ${table.archivedAt} is null`),
    index('staff_surveys_source_idx').on(table.institutionId, table.sourceSurveyId),
    index('staff_surveys_close_idx').on(table.institutionId, table.status, table.closeDate),
  ],
)

/**
 * Anket katılımcısı ve katılım işareti (DOM-FIN-143; K-484, K-485). Yayımda hedef kitleden
 * donar. Yanıtla yalnız `responded` true olur; zaman kolonları yayım anında kalır (yanıt anı
 * saklanmaz, yanıt satırıyla eşleştirilemez). Yanıtın kendisi `staff_survey_responses`'tadır ve
 * kişiye bağlanmaz.
 */
export const staffSurveyParticipants = pgTable(
  'staff_survey_participants',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    surveyId: uuid('survey_id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    unitId: uuid('unit_id'),
    responded: boolean('responded').notNull().default(false),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'staff_survey_participants_pkey',
      columns: [table.institutionId, table.surveyId, table.membershipId],
    }),
    foreignKey({
      name: 'staff_survey_participants_survey_fkey',
      columns: [table.institutionId, table.surveyId],
      foreignColumns: [staffSurveys.institutionId, staffSurveys.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_survey_participants_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_survey_participants_unit_fkey',
      columns: [table.institutionId, table.unitId],
      foreignColumns: [orgUnits.institutionId, orgUnits.id],
    }).onDelete('restrict'),
    index('staff_survey_participants_membership_idx').on(table.institutionId, table.membershipId),
    index('staff_survey_participants_unit_idx').on(table.institutionId, table.unitId),
  ],
)

/**
 * Anonim yanıt (DOM-FIN-143; K-485). Üyelik ya da kullanıcı kimliği taşımaz; birim katılımcının
 * yayım günündeki birimidir (sonuç kırılımı için). Zaman kolonları anketin yayım anıdır, yanıt
 * anı değil. Satır değişmez ve silinmez (`kampus_reject_immutable_change`).
 */
export const staffSurveyResponses = pgTable(
  'staff_survey_responses',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    surveyId: uuid('survey_id').notNull(),
    unitId: uuid('unit_id'),
    // kvkk: K (puan ve serbest metin; kişiye bağlanmaz, denetime ve loga yazılmaz)
    answers: jsonb('answers').$type<StaffSurveyAnswer[]>().notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_survey_responses_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_survey_responses_survey_fkey',
      columns: [table.institutionId, table.surveyId],
      foreignColumns: [staffSurveys.institutionId, staffSurveys.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_survey_responses_unit_fkey',
      columns: [table.institutionId, table.unitId],
      foreignColumns: [orgUnits.institutionId, orgUnits.id],
    }).onDelete('restrict'),
    check(
      'staff_survey_responses_answers_check',
      sql`jsonb_typeof(${table.answers}) = 'array' and jsonb_array_length(${table.answers}) between 1 and ${n(STAFF_SURVEY_QUESTIONS_MAX)}`,
    ),
    index('staff_survey_responses_survey_idx').on(table.institutionId, table.surveyId),
    index('staff_survey_responses_unit_idx').on(table.institutionId, table.unitId),
  ],
)
