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
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  CLUB_SELECTION_CHOICES_MAX,
  CLUB_SELECTION_GRADE_MAX,
  CLUB_SELECTION_GRADE_MIN,
  CLUB_SELECTION_NAME_MAX,
  CLUB_SELECTION_OUTCOMES,
  CLUB_SELECTION_ENTRY_ROLES,
  CLUB_SELECTION_SEATS_MAX,
  CLUB_SELECTION_YEAR_MAX,
  CLUB_SELECTION_YEAR_MIN,
  type ClubSelectionEntryRole,
  type ClubSelectionOutcome,
} from '@kampus/school-core/lib/finance-club-selection.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { schoolClubMembers, schoolClubs } from './finance-clubs.ts'

const n = (value: number) => sql.raw(String(value))
const GRADES = sql.raw(
  `'{${Array.from(
    { length: CLUB_SELECTION_GRADE_MAX - CLUB_SELECTION_GRADE_MIN + 1 },
    (_, index) => CLUB_SELECTION_GRADE_MIN + index,
  ).join(',')}}'::integer[]`,
)

/**
 * Kulüp tercih dönemi (DOM-FIN-150; ON-169; K-505…K-507): eğitim yılı ve dönem, açılış–kapanış
 * günü (Europe/Istanbul, ikisi dahil), en çok tercih ve atanacak kulüp sayısı, sınıf düzeyi
 * süzgeci. Kura tohumu (`seed`) bir kez yazılır; onay anı dağıtımı kilitler. Arşiv = `archived_at`.
 */
export const clubSelectionPeriods = pgTable(
  'club_selection_periods',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    academicYear: integer('academic_year').notNull(),
    term: integer('term'),
    openDate: date('open_date', { mode: 'string' }).notNull(),
    closeDate: date('close_date', { mode: 'string' }).notNull(),
    maxChoices: integer('max_choices').notNull(),
    seatsPerStudent: integer('seats_per_student').notNull().default(1),
    gradeLevels: integer('grade_levels')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    seed: text('seed'),
    drawnAt: timestamp('drawn_at', { withTimezone: true }),
    // kvkk: K
    drawnByUserId: text('drawn_by_user_id'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    // kvkk: K
    confirmedByUserId: text('confirmed_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'club_selection_periods_pkey', columns: [table.institutionId, table.id] }),
    check(
      'club_selection_periods_name_check',
      sql`char_length(${table.name}) between 2 and ${n(CLUB_SELECTION_NAME_MAX)}`,
    ),
    check(
      'club_selection_periods_year_check',
      sql`${table.academicYear} between ${n(CLUB_SELECTION_YEAR_MIN)} and ${n(CLUB_SELECTION_YEAR_MAX)}`,
    ),
    check(
      'club_selection_periods_term_check',
      sql`${table.term} is null or ${table.term} in (1, 2)`,
    ),
    check('club_selection_periods_dates_check', sql`${table.closeDate} >= ${table.openDate}`),
    check(
      'club_selection_periods_counts_check',
      sql`${table.maxChoices} between 1 and ${n(CLUB_SELECTION_CHOICES_MAX)}
        and ${table.seatsPerStudent} between 1 and ${n(CLUB_SELECTION_SEATS_MAX)}
        and ${table.seatsPerStudent} <= ${table.maxChoices}`,
    ),
    check('club_selection_periods_grades_check', sql`${table.gradeLevels} <@ ${GRADES}`),
    check(
      'club_selection_periods_draw_check',
      sql`(${table.seed} is null) = (${table.drawnAt} is null)
        and (${table.drawnAt} is null) = (${table.drawnByUserId} is null)
        and (${table.confirmedAt} is null) = (${table.confirmedByUserId} is null)
        and (${table.confirmedAt} is null or ${table.seed} is not null)`,
    ),
    index('club_selection_periods_year_idx').on(table.institutionId, table.academicYear),
  ],
)

/** Döneme katılan kulüpler (DOM-FIN-150; K-505); sıra web'deki gösterim sırasıdır. */
export const clubSelectionPeriodClubs = pgTable(
  'club_selection_period_clubs',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    periodId: uuid('period_id').notNull(),
    clubId: uuid('club_id').notNull(),
    position: integer('position').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'club_selection_period_clubs_pkey',
      columns: [table.institutionId, table.periodId, table.clubId],
    }),
    foreignKey({
      name: 'club_selection_period_clubs_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [clubSelectionPeriods.institutionId, clubSelectionPeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'club_selection_period_clubs_club_fkey',
      columns: [table.institutionId, table.clubId],
      foreignColumns: [schoolClubs.institutionId, schoolClubs.id],
    }).onDelete('restrict'),
    check('club_selection_period_clubs_position_check', sql`${table.position} >= 1`),
    index('club_selection_period_clubs_club_idx').on(table.institutionId, table.clubId),
  ],
)

/**
 * Öğrencinin bir dönemdeki tercihi (DOM-FIN-150; K-505). Dönemde öğrenci başına tek etkin tercih
 * (kısmi tekil indeks); değişiklik eskisini arşivleyip yenisini yazar, geri çekme arşivdir.
 */
export const clubSelectionPreferences = pgTable(
  'club_selection_preferences',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    periodId: uuid('period_id').notNull(),
    // kvkk: K (öğrenci)
    studentId: text('student_id').notNull(),
    // kvkk: K
    enteredByUserId: text('entered_by_user_id').notNull(),
    enteredByRole: text('entered_by_role').$type<ClubSelectionEntryRole>().notNull(),
    // kvkk: K
    replacedByUserId: text('replaced_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'club_selection_preferences_pkey',
      columns: [table.institutionId, table.id],
    }),
    unique('club_selection_preferences_period_key').on(
      table.institutionId,
      table.periodId,
      table.id,
    ),
    foreignKey({
      name: 'club_selection_preferences_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [clubSelectionPeriods.institutionId, clubSelectionPeriods.id],
    }).onDelete('restrict'),
    check(
      'club_selection_preferences_role_check',
      oneOf(table.enteredByRole, CLUB_SELECTION_ENTRY_ROLES),
    ),
    check(
      'club_selection_preferences_replaced_check',
      sql`(${table.archivedAt} is null) = (${table.replacedByUserId} is null)`,
    ),
    uniqueIndex('club_selection_preferences_student_key')
      .on(table.institutionId, table.periodId, table.studentId)
      .where(sql`${table.archivedAt} is null`),
    index('club_selection_preferences_student_idx').on(table.institutionId, table.studentId),
  ],
)

/** Tercihin sıralı kulüpleri (DOM-FIN-150; K-505): sıra ve kulüp tercih içinde tekildir. */
export const clubSelectionChoices = pgTable(
  'club_selection_choices',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    preferenceId: uuid('preference_id').notNull(),
    periodId: uuid('period_id').notNull(),
    rank: integer('rank').notNull(),
    clubId: uuid('club_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'club_selection_choices_pkey',
      columns: [table.institutionId, table.preferenceId, table.rank],
    }),
    unique('club_selection_choices_club_key').on(
      table.institutionId,
      table.preferenceId,
      table.clubId,
    ),
    foreignKey({
      name: 'club_selection_choices_preference_fkey',
      columns: [table.institutionId, table.periodId, table.preferenceId],
      foreignColumns: [
        clubSelectionPreferences.institutionId,
        clubSelectionPreferences.periodId,
        clubSelectionPreferences.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'club_selection_choices_club_fkey',
      columns: [table.institutionId, table.clubId],
      foreignColumns: [schoolClubs.institutionId, schoolClubs.id],
    }).onDelete('restrict'),
    check(
      'club_selection_choices_rank_check',
      sql`${table.rank} between 1 and ${n(CLUB_SELECTION_CHOICES_MAX)}`,
    ),
    index('club_selection_choices_period_idx').on(
      table.institutionId,
      table.periodId,
      table.preferenceId,
    ),
    index('club_selection_choices_club_idx').on(table.institutionId, table.clubId),
  ],
)

/**
 * Onaylanan dağıtım sonucu (DOM-FIN-150; K-506, K-507): öğrenci × kulüp; atananın üyeliği
 * (`school_club_members`) onayla aynı işlemde yazılır, yedekte kulüp başına sıra tutulur.
 */
export const clubSelectionResults = pgTable(
  'club_selection_results',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    periodId: uuid('period_id').notNull(),
    // kvkk: K (öğrenci)
    studentId: text('student_id').notNull(),
    clubId: uuid('club_id').notNull(),
    outcome: text('outcome').$type<ClubSelectionOutcome>().notNull(),
    rank: integer('rank').notNull(),
    round: integer('round'),
    waitlistPosition: integer('waitlist_position'),
    lotteryPosition: integer('lottery_position').notNull(),
    memberId: uuid('member_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'club_selection_results_pkey',
      columns: [table.institutionId, table.periodId, table.studentId, table.clubId],
    }),
    foreignKey({
      name: 'club_selection_results_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [clubSelectionPeriods.institutionId, clubSelectionPeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'club_selection_results_club_fkey',
      columns: [table.institutionId, table.clubId],
      foreignColumns: [schoolClubs.institutionId, schoolClubs.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'club_selection_results_member_fkey',
      columns: [table.institutionId, table.memberId],
      foreignColumns: [schoolClubMembers.institutionId, schoolClubMembers.id],
    }).onDelete('restrict'),
    check('club_selection_results_outcome_check', oneOf(table.outcome, CLUB_SELECTION_OUTCOMES)),
    check(
      'club_selection_results_shape_check',
      sql`${table.rank} between 1 and ${n(CLUB_SELECTION_CHOICES_MAX)}
        and ${table.lotteryPosition} >= 1
        and ((${table.outcome} = 'assigned' and ${table.memberId} is not null
              and ${table.round} >= 1 and ${table.waitlistPosition} is null)
          or (${table.outcome} = 'waitlisted' and ${table.memberId} is null
              and ${table.round} is null and ${table.waitlistPosition} >= 1))`,
    ),
    uniqueIndex('club_selection_results_waitlist_key')
      .on(table.institutionId, table.periodId, table.clubId, table.waitlistPosition)
      .where(sql`${table.outcome} = 'waitlisted'`),
    index('club_selection_results_club_idx').on(table.institutionId, table.clubId),
    index('club_selection_results_member_idx').on(table.institutionId, table.memberId),
    index('club_selection_results_student_idx').on(table.institutionId, table.studentId),
  ],
)
