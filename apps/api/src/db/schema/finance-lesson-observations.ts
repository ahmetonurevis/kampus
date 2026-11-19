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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  LESSON_OBSERVATION_STATUSES,
  OBSERVATION_CRITERIA_MAX,
  OBSERVATION_GENERAL_NOTE_MAX,
  OBSERVATION_NAME_MAX,
  OBSERVATION_NAME_MIN,
  type LessonObservationStatus,
  type ObservationCriterion,
  type ObservationRating,
} from '@kampus/school-core/lib/finance-lesson-observations.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { performancePeriods } from './finance-performance.ts'
import { records } from './records.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Ders gözlem formu şablonu (DOM-FIN-130; ON-206). Kimlik ve arşiv bilgisidir; ad ve ölçütler
 * sürümdedir. `latest_version_number` yeni gözlemin kullanacağı son sürümdür (K-445).
 */
export const lessonObservationTemplates = pgTable(
  'lesson_observation_templates',
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
    primaryKey({
      name: 'lesson_observation_templates_pkey',
      columns: [table.institutionId, table.id],
    }),
    check('lesson_observation_templates_latest_check', sql`${table.latestVersionNumber} >= 1`),
  ],
)

/**
 * Şablon sürümü (DOM-FIN-130; K-445): ad ve ölçütler (kimlik, ad, açıklama, ağırlık, 0–5 seviye
 * tanımı). Gözlemde kullanılmış sürüm değişmez (gözlem yabancı anahtarı `restrict`; servis
 * kullanılmış sürümü düzeltmez), yeni sürüm açılır.
 */
export const lessonObservationTemplateVersions = pgTable(
  'lesson_observation_template_versions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    templateId: uuid('template_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    criteria: jsonb('criteria').$type<ObservationCriterion[]>().notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'lesson_observation_template_versions_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'lesson_observation_template_versions_template_fkey',
      columns: [table.institutionId, table.templateId],
      foreignColumns: [lessonObservationTemplates.institutionId, lessonObservationTemplates.id],
    }).onDelete('restrict'),
    check(
      'lesson_observation_template_versions_name_check',
      sql`char_length(${table.name}) between ${n(OBSERVATION_NAME_MIN)} and ${n(OBSERVATION_NAME_MAX)}`,
    ),
    check(
      'lesson_observation_template_versions_criteria_check',
      sql`jsonb_typeof(${table.criteria}) = 'array'
        and jsonb_array_length(${table.criteria}) between 1 and ${n(OBSERVATION_CRITERIA_MAX)}`,
    ),
    check('lesson_observation_template_versions_number_check', sql`${table.versionNumber} >= 1`),
    uniqueIndex('lesson_observation_template_versions_number_key').on(
      table.institutionId,
      table.templateId,
      table.versionNumber,
    ),
  ],
)

/**
 * Ders gözlem kaydı (DOM-FIN-130; ON-206). Gözlenen öğretmen ve gözlemci kurum üyeliğidir;
 * sınıf ve ders isteğe bağlı school-core kaydıdır (`records`), performans dönemi isteğe bağlıdır
 * (DOM-FIN-124). Ölçüt seviyeleri ve notları sıralı jsonb dizisidir; puan saklanmaz, sürümün
 * ölçütlerinden rubrik kuralıyla hesaplanır. Tamamlanan kayıt değişmez (K-446). Kişisel veri:
 * yönetici, gözlemci ve tamamlanınca gözlenen öğretmen görür, okuma denetime düşer (K-447).
 */
export const lessonObservations = pgTable(
  'lesson_observations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    templateVersionId: uuid('template_version_id').notNull(),
    // kvkk: K (gözlenen öğretmen üyeliği)
    teacherMembershipId: text('teacher_membership_id').notNull(),
    // kvkk: K (gözlemci üyeliği)
    observerMembershipId: text('observer_membership_id').notNull(),
    observedDate: date('observed_date', { mode: 'string' }).notNull(),
    classId: text('class_id'),
    /** Yabancı anahtarın koleksiyon parçası; hep `classes`. */
    classCollection: text('class_collection')
      .notNull()
      .generatedAlwaysAs(sql`'classes'`),
    subjectId: text('subject_id'),
    /** Yabancı anahtarın koleksiyon parçası; hep `subjects`. */
    subjectCollection: text('subject_collection')
      .notNull()
      .generatedAlwaysAs(sql`'subjects'`),
    performancePeriodId: uuid('performance_period_id'),
    // kvkk: K (ölçüt seviyeleri ve notları)
    ratings: jsonb('ratings').$type<ObservationRating[]>().notNull(),
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    generalNote: text('general_note'),
    status: text('status').$type<LessonObservationStatus>().notNull().default('draft'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // kvkk: K
    completedByUserId: text('completed_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'lesson_observations_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'lesson_observations_template_version_fkey',
      columns: [table.institutionId, table.templateVersionId],
      foreignColumns: [
        lessonObservationTemplateVersions.institutionId,
        lessonObservationTemplateVersions.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lesson_observations_teacher_fkey',
      columns: [table.institutionId, table.teacherMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lesson_observations_observer_fkey',
      columns: [table.institutionId, table.observerMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lesson_observations_class_fkey',
      columns: [table.institutionId, table.classCollection, table.classId],
      foreignColumns: [records.institutionId, records.collection, records.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lesson_observations_subject_fkey',
      columns: [table.institutionId, table.subjectCollection, table.subjectId],
      foreignColumns: [records.institutionId, records.collection, records.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lesson_observations_period_fkey',
      columns: [table.institutionId, table.performancePeriodId],
      foreignColumns: [performancePeriods.institutionId, performancePeriods.id],
    }).onDelete('restrict'),
    check('lesson_observations_status_check', oneOf(table.status, LESSON_OBSERVATION_STATUSES)),
    check(
      'lesson_observations_ratings_check',
      sql`jsonb_typeof(${table.ratings}) = 'array'
        and jsonb_array_length(${table.ratings}) between 1 and ${n(OBSERVATION_CRITERIA_MAX)}`,
    ),
    check(
      'lesson_observations_note_check',
      sql`${table.generalNote} is null
        or char_length(${table.generalNote}) between 1 and ${n(OBSERVATION_GENERAL_NOTE_MAX)}`,
    ),
    check(
      'lesson_observations_completed_check',
      sql`((${table.status} = 'completed') = (${table.completedAt} is not null))
        and ((${table.completedAt} is null) = (${table.completedByUserId} is null))
        and (${table.status} = 'draft' or ${table.generalNote} is not null)`,
    ),
    check(
      'lesson_observations_people_check',
      sql`${table.teacherMembershipId} <> ${table.observerMembershipId}`,
    ),
    index('lesson_observations_date_idx').on(table.institutionId, table.observedDate),
    index('lesson_observations_template_version_idx').on(
      table.institutionId,
      table.templateVersionId,
    ),
    index('lesson_observations_teacher_idx').on(table.institutionId, table.teacherMembershipId),
    index('lesson_observations_observer_idx').on(table.institutionId, table.observerMembershipId),
    index('lesson_observations_class_idx').on(table.institutionId, table.classId),
    index('lesson_observations_subject_idx').on(table.institutionId, table.subjectId),
    index('lesson_observations_period_idx').on(table.institutionId, table.performancePeriodId),
  ],
)
