import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  DEBRIEF_TEXT_MAX,
  DEVELOPMENT_GOAL_CRITERION_MAX,
  DEVELOPMENT_GOAL_CRITERION_MIN,
  DEVELOPMENT_GOAL_NOTE_MAX,
  DEVELOPMENT_GOAL_NOTE_MIN,
  DEVELOPMENT_GOAL_SOURCES,
  DEVELOPMENT_GOAL_STATUSES,
  DEVELOPMENT_GOAL_TITLE_MAX,
  DEVELOPMENT_GOAL_TITLE_MIN,
  OBSERVATION_DEBRIEF_STATUSES,
  type DevelopmentGoalSource,
  type DevelopmentGoalStatus,
  type ObservationDebriefStatus,
} from '@kampus/school-core/lib/finance-observation-debriefs.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { lessonObservations } from './finance-lesson-observations.ts'
import { performancePeriods } from './finance-performance.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Gözlem sonrası görüşme (DOM-FIN-133; ON-209; K-454). Tamamlanmış ders gözlemine en çok bir
 * görüşme bağlanır (`observation_id` tekil). Taslak düzeltilir; kesinleşen satır değişmez
 * (servis 409 ve veritabanı tetikleyicisi). Metinler kişisel veridir, denetime ve loga yazılmaz.
 */
export const observationDebriefs = pgTable(
  'observation_debriefs',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    observationId: uuid('observation_id').notNull(),
    debriefDate: date('debrief_date', { mode: 'string' }).notNull(),
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    strengths: text('strengths'),
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    developmentAreas: text('development_areas'),
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    teacherComment: text('teacher_comment'),
    status: text('status').$type<ObservationDebriefStatus>().notNull().default('draft'),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    // kvkk: K
    finalizedByUserId: text('finalized_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'observation_debriefs_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'observation_debriefs_observation_fkey',
      columns: [table.institutionId, table.observationId],
      foreignColumns: [lessonObservations.institutionId, lessonObservations.id],
    }).onDelete('restrict'),
    check('observation_debriefs_status_check', oneOf(table.status, OBSERVATION_DEBRIEF_STATUSES)),
    check(
      'observation_debriefs_text_check',
      sql`(${table.strengths} is null or char_length(${table.strengths}) between 1 and ${n(DEBRIEF_TEXT_MAX)})
        and (${table.developmentAreas} is null or char_length(${table.developmentAreas}) between 1 and ${n(DEBRIEF_TEXT_MAX)})
        and (${table.teacherComment} is null or char_length(${table.teacherComment}) between 1 and ${n(DEBRIEF_TEXT_MAX)})`,
    ),
    check(
      'observation_debriefs_finalized_check',
      sql`((${table.status} = 'finalized') = (${table.finalizedAt} is not null))
        and ((${table.finalizedAt} is null) = (${table.finalizedByUserId} is null))
        and (${table.status} = 'draft'
          or (${table.strengths} is not null and ${table.developmentAreas} is not null))`,
    ),
    uniqueIndex('observation_debriefs_observation_key').on(
      table.institutionId,
      table.observationId,
    ),
    index('observation_debriefs_date_idx').on(table.institutionId, table.debriefDate),
  ],
)

/**
 * Görüşmeye katılanlar (K-454): kurum üyeliği (yönetici ya da öğretmen). Taslakta listeden
 * çıkarılan katılımcı arşivlenir; etkin satır üyelik başına tekildir. Kesinleşmiş görüşmenin
 * katılımı değişmez (tetikleyici).
 */
export const observationDebriefParticipants = pgTable(
  'observation_debrief_participants',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    debriefId: uuid('debrief_id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'observation_debrief_participants_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'observation_debrief_participants_debrief_fkey',
      columns: [table.institutionId, table.debriefId],
      foreignColumns: [observationDebriefs.institutionId, observationDebriefs.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'observation_debrief_participants_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    uniqueIndex('observation_debrief_participants_member_key')
      .on(table.institutionId, table.debriefId, table.membershipId)
      .where(sql`${table.archivedAt} is null`),
    index('observation_debrief_participants_debrief_idx').on(table.institutionId, table.debriefId),
    index('observation_debrief_participants_membership_idx').on(
      table.institutionId,
      table.membershipId,
    ),
  ],
)

/**
 * Personel gelişim hedefi (DOM-FIN-133; ON-209; K-455). Genel kayıttır: kaynak gözlem görüşmesi
 * (`debrief_id` dolu) ya da doğrudan; isteğe bağlı performans dönemi (DOM-FIN-124). Performans
 * raporu (ON-220) bu tabloyu okur. Kapanan (ulaşıldı, bırakıldı) hedef değişmez; takip geçmişi
 * `staff_development_goal_notes`'tadır.
 */
export const staffDevelopmentGoals = pgTable(
  'staff_development_goals',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (öğretmen üyeliği)
    teacherMembershipId: text('teacher_membership_id').notNull(),
    source: text('source').$type<DevelopmentGoalSource>().notNull(),
    debriefId: uuid('debrief_id'),
    performancePeriodId: uuid('performance_period_id'),
    // kvkk: K
    title: text('title').notNull(),
    // kvkk: K
    successCriterion: text('success_criterion').notNull(),
    followUpDate: date('follow_up_date', { mode: 'string' }).notNull(),
    status: text('status').$type<DevelopmentGoalStatus>().notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_development_goals_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_development_goals_teacher_fkey',
      columns: [table.institutionId, table.teacherMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_development_goals_debrief_fkey',
      columns: [table.institutionId, table.debriefId],
      foreignColumns: [observationDebriefs.institutionId, observationDebriefs.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_development_goals_period_fkey',
      columns: [table.institutionId, table.performancePeriodId],
      foreignColumns: [performancePeriods.institutionId, performancePeriods.id],
    }).onDelete('restrict'),
    check('staff_development_goals_status_check', oneOf(table.status, DEVELOPMENT_GOAL_STATUSES)),
    check('staff_development_goals_source_check', oneOf(table.source, DEVELOPMENT_GOAL_SOURCES)),
    check(
      'staff_development_goals_source_debrief_check',
      sql`(${table.source} = 'observation_debrief') = (${table.debriefId} is not null)`,
    ),
    check(
      'staff_development_goals_text_check',
      sql`char_length(${table.title}) between ${n(DEVELOPMENT_GOAL_TITLE_MIN)} and ${n(DEVELOPMENT_GOAL_TITLE_MAX)}
        and char_length(${table.successCriterion}) between ${n(DEVELOPMENT_GOAL_CRITERION_MIN)} and ${n(DEVELOPMENT_GOAL_CRITERION_MAX)}`,
    ),
    check(
      'staff_development_goals_closed_check',
      sql`(${table.status} in ('achieved', 'dropped')) = (${table.closedAt} is not null)`,
    ),
    index('staff_development_goals_teacher_idx').on(table.institutionId, table.teacherMembershipId),
    index('staff_development_goals_debrief_idx').on(table.institutionId, table.debriefId),
    index('staff_development_goals_period_idx').on(table.institutionId, table.performancePeriodId),
    index('staff_development_goals_follow_up_idx').on(
      table.institutionId,
      table.status,
      table.followUpDate,
    ),
  ],
)

/**
 * Gelişim hedefi takip geçmişi (K-455): not, durum değişikliği (önce/sonra) ve yeni takip tarihi.
 * Yalnız eklenir; satır değişmez ve silinmez (`kampus_reject_immutable_change`).
 */
export const staffDevelopmentGoalNotes = pgTable(
  'staff_development_goal_notes',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    goalId: uuid('goal_id').notNull(),
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    note: text('note').notNull(),
    statusFrom: text('status_from').$type<DevelopmentGoalStatus>().notNull(),
    statusTo: text('status_to').$type<DevelopmentGoalStatus>(),
    nextFollowUpDate: date('next_follow_up_date', { mode: 'string' }),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'staff_development_goal_notes_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'staff_development_goal_notes_goal_fkey',
      columns: [table.institutionId, table.goalId],
      foreignColumns: [staffDevelopmentGoals.institutionId, staffDevelopmentGoals.id],
    }).onDelete('restrict'),
    check(
      'staff_development_goal_notes_status_check',
      sql`${oneOf(table.statusFrom, DEVELOPMENT_GOAL_STATUSES)}
        and (${table.statusTo} is null or ${oneOf(table.statusTo, DEVELOPMENT_GOAL_STATUSES)})`,
    ),
    check(
      'staff_development_goal_notes_note_check',
      sql`char_length(${table.note}) between ${n(DEVELOPMENT_GOAL_NOTE_MIN)} and ${n(DEVELOPMENT_GOAL_NOTE_MAX)}`,
    ),
    index('staff_development_goal_notes_goal_idx').on(
      table.institutionId,
      table.goalId,
      table.createdAt,
    ),
  ],
)
