import { sql } from 'drizzle-orm'
import {
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
  uuid,
} from 'drizzle-orm/pg-core'

import {
  TEACHER_FEEDBACK_QUESTIONS_MAX,
  TEACHER_FEEDBACK_STATUSES,
  TEACHER_FEEDBACK_TERM_MAX,
  TEACHER_FEEDBACK_TERM_MIN,
  TEACHER_FEEDBACK_THRESHOLD_MAX,
  TEACHER_FEEDBACK_THRESHOLD_MIN,
  TEACHER_FEEDBACK_TITLE_MAX,
  TEACHER_FEEDBACK_TITLE_MIN,
  type TeacherFeedbackAnswer,
  type TeacherFeedbackQuestion,
  type TeacherFeedbackRespondentRole,
  type TeacherFeedbackStatus,
} from '@kampus/school-core/lib/finance-teacher-feedback.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Öğretmene yönelik öğrenci ve veli geri bildirim anketi (DOM-FIN-159; ON-213; K-532). Taslak
 * düzeltilir; yayımlanan satırda yalnız erken kapatma (`closed_at`) bir kez yazılır
 * (`kampus_guard_teacher_feedback_survey` tetikleyicisi, 55000).
 */
export const teacherFeedbackSurveys = pgTable(
  'teacher_feedback_surveys',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    title: text('title').notNull(),
    term: text('term').notNull(),
    status: text('status').$type<TeacherFeedbackStatus>().notNull().default('draft'),
    openDate: date('open_date', { mode: 'string' }).notNull(),
    closeDate: date('close_date', { mode: 'string' }).notNull(),
    anonymityThreshold: integer('anonymity_threshold').notNull(),
    respondentRoles: jsonb('respondent_roles').$type<TeacherFeedbackRespondentRole[]>().notNull(),
    classIds: jsonb('class_ids').$type<string[]>().notNull(),
    questions: jsonb('questions').$type<TeacherFeedbackQuestion[]>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // kvkk: K
    publishedByUserId: text('published_by_user_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // kvkk: K
    closedByUserId: text('closed_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'teacher_feedback_surveys_pkey', columns: [table.institutionId, table.id] }),
    check('teacher_feedback_surveys_status_check', oneOf(table.status, TEACHER_FEEDBACK_STATUSES)),
    check(
      'teacher_feedback_surveys_title_check',
      sql`char_length(${table.title}) between ${n(TEACHER_FEEDBACK_TITLE_MIN)} and ${n(TEACHER_FEEDBACK_TITLE_MAX)}`,
    ),
    check(
      'teacher_feedback_surveys_term_check',
      sql`char_length(${table.term}) between ${n(TEACHER_FEEDBACK_TERM_MIN)} and ${n(TEACHER_FEEDBACK_TERM_MAX)}`,
    ),
    check('teacher_feedback_surveys_dates_check', sql`${table.closeDate} >= ${table.openDate}`),
    check(
      'teacher_feedback_surveys_threshold_check',
      sql`${table.anonymityThreshold} between ${n(TEACHER_FEEDBACK_THRESHOLD_MIN)} and ${n(TEACHER_FEEDBACK_THRESHOLD_MAX)}`,
    ),
    check(
      'teacher_feedback_surveys_questions_check',
      sql`jsonb_typeof(${table.questions}) = 'array' and jsonb_array_length(${table.questions}) between 1 and ${n(TEACHER_FEEDBACK_QUESTIONS_MAX)}`,
    ),
    check(
      'teacher_feedback_surveys_audience_check',
      sql`jsonb_typeof(${table.respondentRoles}) = 'array' and jsonb_array_length(${table.respondentRoles}) between 1 and 2 and jsonb_typeof(${table.classIds}) = 'array'`,
    ),
    check(
      'teacher_feedback_surveys_published_check',
      sql`((${table.status} = 'published') = (${table.publishedAt} is not null))
        and ((${table.publishedAt} is null) = (${table.publishedByUserId} is null))`,
    ),
    check(
      'teacher_feedback_surveys_closed_check',
      sql`((${table.closedAt} is null) = (${table.closedByUserId} is null))
        and (${table.closedAt} is null or ${table.status} = 'published')`,
    ),
    index('teacher_feedback_surveys_close_idx').on(
      table.institutionId,
      table.status,
      table.closeDate,
    ),
  ],
)

/**
 * Katılım işareti (DOM-FIN-159; K-533): yanıtlayan üyelik × anket × öğretmen, yalnız eklenir.
 * Tekrar yanıtı önler; yanıtın kendisi `teacher_feedback_responses`'tadır ve kişiye bağlanmaz.
 * Zaman kolonları anketin yayım anıdır (yanıt anı saklanmaz).
 */
export const teacherFeedbackParticipations = pgTable(
  'teacher_feedback_participations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    surveyId: uuid('survey_id').notNull(),
    // kvkk: K (öğrenci ya da veli üyeliği)
    membershipId: text('membership_id').notNull(),
    teacherId: text('teacher_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'teacher_feedback_participations_pkey',
      columns: [table.institutionId, table.surveyId, table.membershipId, table.teacherId],
    }),
    foreignKey({
      name: 'teacher_feedback_participations_survey_fkey',
      columns: [table.institutionId, table.surveyId],
      foreignColumns: [teacherFeedbackSurveys.institutionId, teacherFeedbackSurveys.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'teacher_feedback_participations_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    index('teacher_feedback_participations_membership_idx').on(
      table.institutionId,
      table.membershipId,
    ),
  ],
)

/**
 * Anonim yanıt (DOM-FIN-159; K-532, K-533): öğretmen, kırılım sınıfı ve cevaplar; üyelik,
 * kullanıcı ve yanıtlayan rolü yoktur. Zaman kolonları anketin yayım anıdır. Satır değişmez ve
 * silinmez (`kampus_reject_immutable_change`).
 */
export const teacherFeedbackResponses = pgTable(
  'teacher_feedback_responses',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    surveyId: uuid('survey_id').notNull(),
    teacherId: text('teacher_id').notNull(),
    classId: text('class_id').notNull(),
    // kvkk: K (puan ve serbest metin; kişiye bağlanmaz, denetime ve loga yazılmaz)
    answers: jsonb('answers').$type<TeacherFeedbackAnswer[]>().notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'teacher_feedback_responses_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'teacher_feedback_responses_survey_fkey',
      columns: [table.institutionId, table.surveyId],
      foreignColumns: [teacherFeedbackSurveys.institutionId, teacherFeedbackSurveys.id],
    }).onDelete('restrict'),
    check(
      'teacher_feedback_responses_answers_check',
      sql`jsonb_typeof(${table.answers}) = 'array' and jsonb_array_length(${table.answers}) between 1 and ${n(TEACHER_FEEDBACK_QUESTIONS_MAX)}`,
    ),
    index('teacher_feedback_responses_survey_idx').on(
      table.institutionId,
      table.surveyId,
      table.teacherId,
    ),
    index('teacher_feedback_responses_teacher_idx').on(table.institutionId, table.teacherId),
  ],
)
