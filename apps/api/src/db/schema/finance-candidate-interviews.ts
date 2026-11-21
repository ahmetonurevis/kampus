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
  CANDIDATE_INTERVIEW_STATUSES,
  CANDIDATE_INTERVIEW_TYPES,
  INTERVIEW_CRITERIA_MAX,
  INTERVIEW_GENERAL_NOTE_MAX,
  INTERVIEW_LOCATION_MAX,
  INTERVIEW_SCALE_MAX,
  INTERVIEW_SCALE_MIN,
  INTERVIEW_TEMPLATE_NAME_MAX,
  INTERVIEW_TEMPLATE_NAME_MIN,
  INTERVIEW_URL_MAX,
  type CandidateInterviewStatus,
  type CandidateInterviewType,
  type CandidateRating,
  type InterviewCriterion,
} from '@kampus/school-core/lib/finance-candidate-interviews.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { jobApplications } from './finance-job-postings.ts'
import { lessonObservationTemplateVersions } from './finance-lesson-observations.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Mülakat formu şablonu (DOM-FIN-138; ON-178, K-470). Kimlik ve arşiv bilgisidir; ad, ölçek ve
 * ölçütler sürümdedir. `latest_version_number` yeni mülakatın kullanacağı son sürümdür.
 */
export const interviewTemplates = pgTable(
  'interview_templates',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    latestVersionNumber: integer('latest_version_number').notNull().default(1),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'interview_templates_pkey', columns: [table.institutionId, table.id] }),
    check('interview_templates_latest_check', sql`${table.latestVersionNumber} >= 1`),
  ],
)

/**
 * Mülakat formu sürümü (DOM-FIN-138; K-470): ad, ölçek (1–N) ve ölçütler (kimlik, ad, açıklama,
 * ağırlık). Mülakatta kullanılmış sürüm yerinde düzeltilmez (servis 409), mülakat yabancı anahtarı
 * `restrict`; yeni sürüm açılır.
 */
export const interviewTemplateVersions = pgTable(
  'interview_template_versions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    templateId: uuid('template_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    scaleMax: integer('scale_max').notNull(),
    criteria: jsonb('criteria').$type<InterviewCriterion[]>().notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'interview_template_versions_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'interview_template_versions_template_fkey',
      columns: [table.institutionId, table.templateId],
      foreignColumns: [interviewTemplates.institutionId, interviewTemplates.id],
    }).onDelete('restrict'),
    check(
      'interview_template_versions_name_check',
      sql`char_length(${table.name}) between ${n(INTERVIEW_TEMPLATE_NAME_MIN)} and ${n(INTERVIEW_TEMPLATE_NAME_MAX)}`,
    ),
    check(
      'interview_template_versions_scale_check',
      sql`${table.scaleMax} between ${n(INTERVIEW_SCALE_MIN)} and ${n(INTERVIEW_SCALE_MAX)}`,
    ),
    check(
      'interview_template_versions_criteria_check',
      sql`jsonb_typeof(${table.criteria}) = 'array'
        and jsonb_array_length(${table.criteria}) between 1 and ${n(INTERVIEW_CRITERIA_MAX)}`,
    ),
    check('interview_template_versions_number_check', sql`${table.versionNumber} >= 1`),
    uniqueIndex('interview_template_versions_number_key').on(
      table.institutionId,
      table.templateId,
      table.versionNumber,
    ),
  ],
)

/**
 * Aday mülakatı (DOM-FIN-138; ON-178, K-469). İş başvurusuna bağlıdır; tür, an, yer ya da
 * bağlantı ve form sürümü taşır. Form örnek derste ders gözlem formu sürümü (K-471), diğer
 * türlerde mülakat formu sürümüdür; tam biri doludur. Planlandı → yapıldı ya da iptal. Satır
 * silinmez; başvuru anonimleştirilince yer ve bağlantı silinir.
 */
export const candidateInterviews = pgTable(
  'candidate_interviews',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    jobApplicationId: uuid('job_application_id').notNull(),
    type: text('type').$type<CandidateInterviewType>().notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    // kvkk: K (yer; anonimleştirmede silinir)
    location: text('location'),
    // kvkk: K (görüşme bağlantısı; anonimleştirmede silinir)
    meetingUrl: text('meeting_url'),
    interviewTemplateVersionId: uuid('interview_template_version_id'),
    observationTemplateVersionId: uuid('observation_template_version_id'),
    status: text('status').$type<CandidateInterviewStatus>().notNull().default('planned'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // kvkk: K
    completedByUserId: text('completed_by_user_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'candidate_interviews_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'candidate_interviews_application_fkey',
      columns: [table.institutionId, table.jobApplicationId],
      foreignColumns: [jobApplications.institutionId, jobApplications.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'candidate_interviews_interview_version_fkey',
      columns: [table.institutionId, table.interviewTemplateVersionId],
      foreignColumns: [interviewTemplateVersions.institutionId, interviewTemplateVersions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'candidate_interviews_observation_version_fkey',
      columns: [table.institutionId, table.observationTemplateVersionId],
      foreignColumns: [
        lessonObservationTemplateVersions.institutionId,
        lessonObservationTemplateVersions.id,
      ],
    }).onDelete('restrict'),
    check('candidate_interviews_type_check', oneOf(table.type, CANDIDATE_INTERVIEW_TYPES)),
    check('candidate_interviews_status_check', oneOf(table.status, CANDIDATE_INTERVIEW_STATUSES)),
    check(
      'candidate_interviews_form_check',
      sql`(${table.type} = 'sample_lesson') = (${table.observationTemplateVersionId} is not null)
        and (${table.interviewTemplateVersionId} is null) = (${table.observationTemplateVersionId} is not null)`,
    ),
    check(
      'candidate_interviews_location_check',
      sql`${table.location} is null or char_length(${table.location}) between 1 and ${n(INTERVIEW_LOCATION_MAX)}`,
    ),
    check(
      'candidate_interviews_url_check',
      sql`${table.meetingUrl} is null or char_length(${table.meetingUrl}) between 9 and ${n(INTERVIEW_URL_MAX)}`,
    ),
    check(
      'candidate_interviews_completed_check',
      sql`((${table.status} = 'completed') = (${table.completedAt} is not null))
        and ((${table.completedAt} is null) = (${table.completedByUserId} is null))`,
    ),
    check(
      'candidate_interviews_cancelled_check',
      sql`((${table.status} = 'cancelled') = (${table.cancelledAt} is not null))
        and ((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null))`,
    ),
    index('candidate_interviews_application_idx').on(table.institutionId, table.jobApplicationId),
    index('candidate_interviews_interview_version_idx').on(
      table.institutionId,
      table.interviewTemplateVersionId,
    ),
    index('candidate_interviews_observation_version_idx').on(
      table.institutionId,
      table.observationTemplateVersionId,
    ),
    index('candidate_interviews_scheduled_idx').on(table.institutionId, table.scheduledAt),
  ],
)

/**
 * Değerlendirici satırı (DOM-FIN-138; K-470). Mülakat planlanırken değerlendirici başına açılır;
 * değerlendirici yapılmış mülakatta puanlarını ve genel değerlendirmesini bir kez gönderir, sonra
 * satır değişmez (servis 409). Puan saklanmaz, form sürümünden hesaplanır. Başvuru
 * anonimleştirilince ölçüt notları ve genel değerlendirme silinir, puanlar kalır (K-471).
 */
export const candidateInterviewEvaluations = pgTable(
  'candidate_interview_evaluations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    candidateInterviewId: uuid('candidate_interview_id').notNull(),
    // kvkk: K (değerlendirici üyeliği)
    evaluatorMembershipId: text('evaluator_membership_id').notNull(),
    // kvkk: K (ölçüt puanları ve notları)
    ratings: jsonb('ratings').$type<CandidateRating[]>(),
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    generalNote: text('general_note'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'candidate_interview_evaluations_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'candidate_interview_evaluations_interview_fkey',
      columns: [table.institutionId, table.candidateInterviewId],
      foreignColumns: [candidateInterviews.institutionId, candidateInterviews.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'candidate_interview_evaluations_evaluator_fkey',
      columns: [table.institutionId, table.evaluatorMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'candidate_interview_evaluations_submitted_check',
      sql`((${table.submittedAt} is null) = (${table.ratings} is null))
        and (${table.submittedAt} is not null or ${table.generalNote} is null)`,
    ),
    check(
      'candidate_interview_evaluations_ratings_check',
      sql`${table.ratings} is null or (jsonb_typeof(${table.ratings}) = 'array'
        and jsonb_array_length(${table.ratings}) between 1 and ${n(INTERVIEW_CRITERIA_MAX)})`,
    ),
    check(
      'candidate_interview_evaluations_note_check',
      sql`${table.generalNote} is null
        or char_length(${table.generalNote}) between 1 and ${n(INTERVIEW_GENERAL_NOTE_MAX)}`,
    ),
    uniqueIndex('candidate_interview_evaluations_evaluator_key').on(
      table.institutionId,
      table.candidateInterviewId,
      table.evaluatorMembershipId,
    ),
    index('candidate_interview_evaluations_member_idx').on(
      table.institutionId,
      table.evaluatorMembershipId,
    ),
  ],
)
