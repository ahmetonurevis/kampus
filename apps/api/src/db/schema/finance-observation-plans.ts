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
  OBSERVATION_PLAN_DURATION_DEFAULT,
  OBSERVATION_PLAN_DURATION_MAX,
  OBSERVATION_PLAN_DURATION_MIN,
  OBSERVATION_PLAN_NOTE_MAX,
  OBSERVATION_PLAN_NOTICE_KINDS,
  OBSERVATION_PLAN_NOTICE_STATUSES,
  OBSERVATION_PLAN_REASON_MAX,
  OBSERVATION_PLAN_REASON_MIN,
  OBSERVATION_PLAN_STATUSES,
  type ObservationPlanNoticeKind,
  type ObservationPlanNoticeStatus,
  type ObservationPlanStatus,
} from '@kampus/school-core/lib/finance-observation-plans.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import {
  lessonObservations,
  lessonObservationTemplateVersions,
} from './finance-lesson-observations.ts'
import { performancePeriods } from './finance-performance.ts'
import { records } from './records.ts'

const n = (value: number) => sql.raw(String(value))
/** `HH:MM` biçimi (00:00–23:59); core `PLAN_TIME_PATTERN` ile aynı. */
const TIME_CHECK = sql.raw(`'^([01][0-9]|2[0-3]):[0-5][0-9]$'`)

/**
 * Ders gözlem planı (DOM-FIN-139; ON-207). Öğretmen ve gözlemci kurum üyeliğidir; gün ve saat
 * Europe/Istanbul duvar saatidir (ders programına bağlı değildir). Form sürümü plan açılırken
 * yazılır, gözlem plandan bu sürümle açılır (`observation_id`, tekil). Durum planlandı → ertelendi
 * → gerçekleşti ya da iptal (K-472, K-473). Çakışma ve dönem sınırı kurum kilidi altında
 * serviste denetlenir.
 */
export const observationPlans = pgTable(
  'observation_plans',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (gözlenecek öğretmen üyeliği)
    teacherMembershipId: text('teacher_membership_id').notNull(),
    // kvkk: K (gözlemci üyeliği)
    observerMembershipId: text('observer_membership_id').notNull(),
    templateVersionId: uuid('template_version_id').notNull(),
    plannedDate: date('planned_date', { mode: 'string' }).notNull(),
    startTime: text('start_time').notNull(),
    durationMinutes: integer('duration_minutes')
      .notNull()
      .default(OBSERVATION_PLAN_DURATION_DEFAULT),
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
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    note: text('note'),
    status: text('status').$type<ObservationPlanStatus>().notNull().default('planned'),
    postponeCount: integer('postpone_count').notNull().default(0),
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    postponeReason: text('postpone_reason'),
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    cancelReason: text('cancel_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    observationId: uuid('observation_id'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'observation_plans_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'observation_plans_teacher_fkey',
      columns: [table.institutionId, table.teacherMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'observation_plans_observer_fkey',
      columns: [table.institutionId, table.observerMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'observation_plans_template_version_fkey',
      columns: [table.institutionId, table.templateVersionId],
      foreignColumns: [
        lessonObservationTemplateVersions.institutionId,
        lessonObservationTemplateVersions.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'observation_plans_class_fkey',
      columns: [table.institutionId, table.classCollection, table.classId],
      foreignColumns: [records.institutionId, records.collection, records.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'observation_plans_subject_fkey',
      columns: [table.institutionId, table.subjectCollection, table.subjectId],
      foreignColumns: [records.institutionId, records.collection, records.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'observation_plans_period_fkey',
      columns: [table.institutionId, table.performancePeriodId],
      foreignColumns: [performancePeriods.institutionId, performancePeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'observation_plans_observation_fkey',
      columns: [table.institutionId, table.observationId],
      foreignColumns: [lessonObservations.institutionId, lessonObservations.id],
    }).onDelete('restrict'),
    check('observation_plans_status_check', oneOf(table.status, OBSERVATION_PLAN_STATUSES)),
    check(
      'observation_plans_people_check',
      sql`${table.teacherMembershipId} <> ${table.observerMembershipId}`,
    ),
    check(
      'observation_plans_time_check',
      sql`${table.startTime} ~ ${TIME_CHECK}
        and ${table.durationMinutes} between ${n(OBSERVATION_PLAN_DURATION_MIN)} and ${n(OBSERVATION_PLAN_DURATION_MAX)}
        and substr(${table.startTime}, 1, 2)::int * 60 + substr(${table.startTime}, 4, 2)::int
          + ${table.durationMinutes} <= 1440`,
    ),
    check(
      'observation_plans_note_check',
      sql`${table.note} is null
        or char_length(${table.note}) between 1 and ${n(OBSERVATION_PLAN_NOTE_MAX)}`,
    ),
    check(
      'observation_plans_reasons_check',
      sql`(${table.postponeReason} is null
          or char_length(${table.postponeReason}) between ${n(OBSERVATION_PLAN_REASON_MIN)} and ${n(OBSERVATION_PLAN_REASON_MAX)})
        and (${table.cancelReason} is null
          or char_length(${table.cancelReason}) between ${n(OBSERVATION_PLAN_REASON_MIN)} and ${n(OBSERVATION_PLAN_REASON_MAX)})
        and ${table.postponeCount} >= 0
        and ((${table.postponeCount} = 0) = (${table.postponeReason} is null))`,
    ),
    check(
      'observation_plans_cancelled_check',
      sql`((${table.status} = 'cancelled') = (${table.cancelledAt} is not null))
        and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))
        and (${table.status} <> 'cancelled' or ${table.observationId} is null)`,
    ),
    check(
      'observation_plans_done_check',
      sql`((${table.status} = 'done') = (${table.doneAt} is not null))
        and (${table.status} <> 'done' or ${table.observationId} is not null)`,
    ),
    index('observation_plans_date_idx').on(table.institutionId, table.plannedDate),
    index('observation_plans_observer_idx').on(
      table.institutionId,
      table.observerMembershipId,
      table.plannedDate,
    ),
    index('observation_plans_teacher_idx').on(
      table.institutionId,
      table.teacherMembershipId,
      table.plannedDate,
    ),
    index('observation_plans_template_version_idx').on(
      table.institutionId,
      table.templateVersionId,
    ),
    index('observation_plans_class_idx').on(table.institutionId, table.classId),
    index('observation_plans_subject_idx').on(table.institutionId, table.subjectId),
    index('observation_plans_period_idx').on(table.institutionId, table.performancePeriodId),
    uniqueIndex('observation_plans_observation_key')
      .on(table.institutionId, table.observationId)
      .where(sql`${table.observationId} is not null`),
  ],
)

/**
 * Öğretmene giden plan bildirimi (DOM-FIN-139; K-474). Personele bildirim kanalı olmadığından
 * kayıt "gönderilecek" (`pending`) tutulur; gönderim yapılmaz. Gövde yoktur: konu, plan ve o
 * andaki gün/saat; metin gönderimde şablondan üretilir.
 */
export const observationPlanNotices = pgTable(
  'observation_plan_notices',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    planId: uuid('plan_id').notNull(),
    // kvkk: K (alıcı öğretmen üyeliği)
    recipientMembershipId: text('recipient_membership_id').notNull(),
    kind: text('kind').$type<ObservationPlanNoticeKind>().notNull(),
    plannedDate: date('planned_date', { mode: 'string' }).notNull(),
    startTime: text('start_time').notNull(),
    status: text('status').$type<ObservationPlanNoticeStatus>().notNull().default('pending'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'observation_plan_notices_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'observation_plan_notices_plan_fkey',
      columns: [table.institutionId, table.planId],
      foreignColumns: [observationPlans.institutionId, observationPlans.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'observation_plan_notices_recipient_fkey',
      columns: [table.institutionId, table.recipientMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('observation_plan_notices_kind_check', oneOf(table.kind, OBSERVATION_PLAN_NOTICE_KINDS)),
    check(
      'observation_plan_notices_status_check',
      oneOf(table.status, OBSERVATION_PLAN_NOTICE_STATUSES),
    ),
    check('observation_plan_notices_time_check', sql`${table.startTime} ~ ${TIME_CHECK}`),
    index('observation_plan_notices_plan_idx').on(table.institutionId, table.planId),
    index('observation_plan_notices_recipient_idx').on(
      table.institutionId,
      table.recipientMembershipId,
    ),
  ],
)
