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
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  CANDIDATE_NAME_MAX,
  JOB_APPLICATION_ANONYMIZATION_REASONS,
  JOB_APPLICATION_CHANNELS,
  JOB_APPLICATION_NOTE_MAX,
  JOB_APPLICATION_RETENTION_DEFAULT_MONTHS,
  JOB_APPLICATION_RETENTION_MAX_MONTHS,
  JOB_APPLICATION_RETENTION_MIN_MONTHS,
  JOB_APPLICATION_STAGES,
  JOB_EMPLOYMENT_TYPES,
  JOB_POSITION_MAX,
  JOB_POSTING_STATUSES,
  JOB_POSTING_TITLE_MAX,
  JOB_TEXT_MAX,
  PRIVACY_NOTICE_VERSION_MAX,
  type JobApplicationAnonymizationReason,
  type JobApplicationChannel,
  type JobApplicationStage,
  type JobEmploymentType,
  type JobPostingStatus,
} from '@kampus/school-core/lib/finance-job-postings.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * İş ilanı (DOM-FIN-128; ON-177, K-439). Taslak → yayında → kapandı; kapanış günü yalnız kapanan
 * ilanda doludur ve başvuruların saklama süresinin başlangıcıdır (K-441). İlan silinmez.
 */
export const jobPostings = pgTable(
  'job_postings',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    title: text('title').notNull(),
    position: text('position').notNull(),
    employmentType: text('employment_type').$type<JobEmploymentType>().notNull(),
    description: text('description').notNull(),
    requirements: text('requirements'),
    publishOn: date('publish_on', { mode: 'string' }).notNull(),
    deadlineOn: date('deadline_on', { mode: 'string' }).notNull(),
    status: text('status').$type<JobPostingStatus>().notNull().default('draft'),
    closedOn: date('closed_on', { mode: 'string' }),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'job_postings_pkey', columns: [table.institutionId, table.id] }),
    check('job_postings_status_check', oneOf(table.status, JOB_POSTING_STATUSES)),
    check('job_postings_employment_type_check', oneOf(table.employmentType, JOB_EMPLOYMENT_TYPES)),
    check(
      'job_postings_title_check',
      sql`char_length(${table.title}) between 2 and ${n(JOB_POSTING_TITLE_MAX)}`,
    ),
    check(
      'job_postings_position_check',
      sql`char_length(${table.position}) between 2 and ${n(JOB_POSITION_MAX)}`,
    ),
    check(
      'job_postings_description_check',
      sql`char_length(${table.description}) between 10 and ${n(JOB_TEXT_MAX)}`,
    ),
    check(
      'job_postings_requirements_check',
      sql`${table.requirements} is null or char_length(${table.requirements}) between 1 and ${n(JOB_TEXT_MAX)}`,
    ),
    check('job_postings_deadline_check', sql`${table.deadlineOn} >= ${table.publishOn}`),
    check(
      'job_postings_closed_check',
      sql`(${table.status} = 'closed') = (${table.closedOn} is not null)`,
    ),
    index('job_postings_status_idx').on(table.institutionId, table.status),
  ],
)

/**
 * İş başvurusu (DOM-FIN-128; ON-177, K-440, K-441). Personel girer; ilan zorunlu, aydınlatma
 * sürümü ve günü zorunlu. Anonimleştirmede ad sabit metne çekilir, iletişim, not ve özgeçmiş bağı
 * temizlenir (dosya imhaya işaretlenir); satır, aşama ve aydınlatma kaydı kalır. Satır silinmez.
 */
export const jobApplications = pgTable(
  'job_applications',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    jobPostingId: uuid('job_posting_id').notNull(),
    // kvkk: K (aday kimliği)
    candidateName: text('candidate_name').notNull(),
    // kvkk: K (aday iletişimi)
    email: text('email'),
    // kvkk: K (aday iletişimi)
    phone: text('phone'),
    channel: text('channel').$type<JobApplicationChannel>().notNull(),
    receivedOn: date('received_on', { mode: 'string' }).notNull(),
    // kvkk: K (özgeçmiş)
    cvFileId: uuid('cv_file_id'),
    privacyNoticeVersion: text('privacy_notice_version').notNull(),
    privacyNoticeShownOn: date('privacy_notice_shown_on', { mode: 'string' }).notNull(),
    // kvkk: K (serbest metin)
    note: text('note'),
    stage: text('stage').$type<JobApplicationStage>().notNull().default('new'),
    stageChangedOn: date('stage_changed_on', { mode: 'string' }).notNull(),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    anonymizationReason: text('anonymization_reason').$type<JobApplicationAnonymizationReason>(),
    // kvkk: K
    recordedByUserId: text('recorded_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'job_applications_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'job_applications_posting_fkey',
      columns: [table.institutionId, table.jobPostingId],
      foreignColumns: [jobPostings.institutionId, jobPostings.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'job_applications_cv_file_fkey',
      columns: [table.institutionId, table.cvFileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    check('job_applications_channel_check', oneOf(table.channel, JOB_APPLICATION_CHANNELS)),
    check('job_applications_stage_check', oneOf(table.stage, JOB_APPLICATION_STAGES)),
    check(
      'job_applications_reason_check',
      sql`${table.anonymizationReason} is null or ${oneOf(table.anonymizationReason, JOB_APPLICATION_ANONYMIZATION_REASONS)}`,
    ),
    check(
      'job_applications_name_check',
      sql`char_length(${table.candidateName}) between 2 and ${n(CANDIDATE_NAME_MAX)}`,
    ),
    check(
      'job_applications_notice_check',
      sql`char_length(${table.privacyNoticeVersion}) between 1 and ${n(PRIVACY_NOTICE_VERSION_MAX)}`,
    ),
    check(
      'job_applications_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(JOB_APPLICATION_NOTE_MAX)}`,
    ),
    check(
      'job_applications_contact_check',
      sql`${table.anonymizedAt} is not null or ${table.email} is not null or ${table.phone} is not null`,
    ),
    check(
      'job_applications_anonymized_check',
      sql`(${table.anonymizedAt} is null) = (${table.anonymizationReason} is null) and (${table.anonymizedAt} is null or (${table.email} is null and ${table.phone} is null and ${table.note} is null and ${table.cvFileId} is null))`,
    ),
    check('job_applications_stage_day_check', sql`${table.stageChangedOn} >= ${table.receivedOn}`),
    index('job_applications_posting_idx').on(table.institutionId, table.jobPostingId),
    index('job_applications_stage_idx').on(table.institutionId, table.stage),
    uniqueIndex('job_applications_email_key')
      .on(table.institutionId, table.jobPostingId, table.email)
      .where(sql`${table.email} is not null`),
    uniqueIndex('job_applications_phone_key')
      .on(table.institutionId, table.jobPostingId, table.phone)
      .where(sql`${table.phone} is not null`),
    uniqueIndex('job_applications_cv_file_key')
      .on(table.institutionId, table.cvFileId)
      .where(sql`${table.cvFileId} is not null`),
  ],
)

/**
 * Başvuru aşama geçmişi (DOM-FIN-128; ON-177, K-440). İlk satır başvurunun kaydıdır (önceki aşama
 * boş, `new`); her aşama değişikliği bir satır. Satır değişmez ve silinmez (tetikleyici); aday
 * verisi taşımaz, anonimleştirmede kalır.
 */
export const jobApplicationStageChanges = pgTable(
  'job_application_stage_changes',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    jobApplicationId: uuid('job_application_id').notNull(),
    fromStage: text('from_stage').$type<JobApplicationStage>(),
    toStage: text('to_stage').$type<JobApplicationStage>().notNull(),
    changedOn: date('changed_on', { mode: 'string' }).notNull(),
    // kvkk: K
    changedByUserId: text('changed_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'job_application_stage_changes_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'job_application_stage_changes_application_fkey',
      columns: [table.institutionId, table.jobApplicationId],
      foreignColumns: [jobApplications.institutionId, jobApplications.id],
    }).onDelete('restrict'),
    check('job_application_stage_changes_to_check', oneOf(table.toStage, JOB_APPLICATION_STAGES)),
    check(
      'job_application_stage_changes_from_check',
      sql`${table.fromStage} is null or ${oneOf(table.fromStage, JOB_APPLICATION_STAGES)}`,
    ),
    index('job_application_stage_changes_application_idx').on(
      table.institutionId,
      table.jobApplicationId,
    ),
  ],
)

/**
 * Başvuru havuzu ayarı (DOM-FIN-128; ON-177, K-441). Kurum başına bir satır; satır yoksa varsayılan
 * (12 ay, sürüm boş, ayar sürümü 1).
 */
export const jobApplicationSettings = pgTable(
  'job_application_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    retentionMonths: integer('retention_months')
      .notNull()
      .default(JOB_APPLICATION_RETENTION_DEFAULT_MONTHS),
    privacyNoticeVersion: text('privacy_notice_version'),
    ...requiredColumns(),
  },
  (table) => [
    check(
      'job_application_settings_retention_check',
      sql`${table.retentionMonths} between ${n(JOB_APPLICATION_RETENTION_MIN_MONTHS)} and ${n(JOB_APPLICATION_RETENTION_MAX_MONTHS)}`,
    ),
    check(
      'job_application_settings_notice_check',
      sql`${table.privacyNoticeVersion} is null or char_length(${table.privacyNoticeVersion}) between 1 and ${n(PRIVACY_NOTICE_VERSION_MAX)}`,
    ),
  ],
)
