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
  SOCIAL_ACTIVITY_KINDS,
  SOCIAL_ACTIVITY_NAME_MAX,
  SOCIAL_ACTIVITY_ORGANIZATION_MAX,
  SOCIAL_ACTIVITY_PLACE_MAX,
  SOCIAL_ACTIVITY_SCOPES,
  SOCIAL_ENTRY_MAX_HOURS,
  SOCIAL_ENTRY_STEP_MINUTES,
  SOCIAL_HOUR_KINDS,
  SOCIAL_HOUR_NOTE_MAX,
  SOCIAL_HOUR_REASON_MAX,
  SOCIAL_HOUR_SOURCES,
  SOCIAL_HOUR_STATUSES,
  SOCIAL_TARGET_MAX_HOURS,
  type SocialActivityKind,
  type SocialActivityScope,
  type SocialHourKind,
  type SocialHourSource,
  type SocialHourStatus,
} from '@kampus/school-core/lib/finance-social-activities.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { schoolClubs } from './finance-clubs.ts'

const n = (value: number) => sql.raw(String(value))
const MAX_MINUTES = SOCIAL_ENTRY_MAX_HOURS * 60

/**
 * Sosyal etkinlik (DOM-FIN-160; ON-170; K-535): kulüp/topluluk çalışması ya da gönüllülük
 * faaliyeti; ad, tür, tarih aralığı (bitişsiz = süren), yer, sorumlu öğretmen (kurum üyeliği),
 * kurum içi/dışı ve kuruluş adı, isteğe bağlı kulüp bağı (ON-098). Arşiv = `archived_at`.
 */
export const socialActivities = pgTable(
  'social_activities',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<SocialActivityKind>().notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    location: text('location').notNull(),
    // kvkk: K (personel üyeliği)
    responsibleMembershipId: text('responsible_membership_id').notNull(),
    organizationScope: text('organization_scope').$type<SocialActivityScope>().notNull(),
    organizationName: text('organization_name'),
    clubId: uuid('club_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'social_activities_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'social_activities_responsible_fkey',
      columns: [table.institutionId, table.responsibleMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'social_activities_club_fkey',
      columns: [table.institutionId, table.clubId],
      foreignColumns: [schoolClubs.institutionId, schoolClubs.id],
    }).onDelete('restrict'),
    check(
      'social_activities_name_check',
      sql`char_length(${table.name}) between 2 and ${n(SOCIAL_ACTIVITY_NAME_MAX)}`,
    ),
    check('social_activities_kind_check', oneOf(table.kind, SOCIAL_ACTIVITY_KINDS)),
    check('social_activities_scope_check', oneOf(table.organizationScope, SOCIAL_ACTIVITY_SCOPES)),
    check(
      'social_activities_location_check',
      sql`char_length(${table.location}) between 2 and ${n(SOCIAL_ACTIVITY_PLACE_MAX)}`,
    ),
    check(
      'social_activities_organization_check',
      sql`(${table.organizationName} is null or char_length(${table.organizationName}) between 2 and ${n(SOCIAL_ACTIVITY_ORGANIZATION_MAX)})
        and (${table.organizationScope} = 'internal' or ${table.organizationName} is not null)`,
    ),
    check(
      'social_activities_dates_check',
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    check('social_activities_club_check', sql`${table.clubId} is null or ${table.kind} = 'club'`),
    index('social_activities_responsible_idx').on(
      table.institutionId,
      table.responsibleMembershipId,
    ),
    index('social_activities_club_idx')
      .on(table.institutionId, table.clubId)
      .where(sql`${table.clubId} is not null`),
    index('social_activities_start_idx').on(table.institutionId, table.startDate),
  ],
)

/**
 * Sosyal etkinlik saati (DOM-FIN-160; K-536): öğrenci × etkinlik × gün başına kayıt (`entry`) ya
 * da onaylı kaydı düzelten ters kayıt (`reversal`, eksi dakika). Öğretmen girişi onaylı açılır,
 * öğrenci beyanı bekler. Karar verilmiş kayıt değişmez (tetikleyici); onaylı kayıtta yalnız ters
 * kayıt bağı bir kez yazılır. Aynı öğrenci × etkinlik × günün etkin kaydı tektir (kısmi tekil
 * indeks). `student_id` `records` kimliğidir.
 */
export const socialActivityHours = pgTable(
  'social_activity_hours',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    activityId: uuid('activity_id').notNull(),
    // kvkk: K (öğrenci)
    studentId: text('student_id').notNull(),
    activityDate: date('activity_date', { mode: 'string' }).notNull(),
    kind: text('kind').$type<SocialHourKind>().notNull(),
    minutes: integer('minutes').notNull(),
    status: text('status').$type<SocialHourStatus>().notNull(),
    source: text('source').$type<SocialHourSource>().notNull(),
    // kvkk: K (serbest metin)
    note: text('note'),
    // kvkk: K
    enteredByUserId: text('entered_by_user_id').notNull(),
    // kvkk: K
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // kvkk: K (serbest metin)
    rejectionReason: text('rejection_reason'),
    reversesEntryId: uuid('reverses_entry_id'),
    reversedByEntryId: uuid('reversed_by_entry_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'social_activity_hours_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'social_activity_hours_activity_fkey',
      columns: [table.institutionId, table.activityId],
      foreignColumns: [socialActivities.institutionId, socialActivities.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'social_activity_hours_reverses_fkey',
      columns: [table.institutionId, table.reversesEntryId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    check('social_activity_hours_kind_check', oneOf(table.kind, SOCIAL_HOUR_KINDS)),
    check('social_activity_hours_status_check', oneOf(table.status, SOCIAL_HOUR_STATUSES)),
    check('social_activity_hours_source_check', oneOf(table.source, SOCIAL_HOUR_SOURCES)),
    check(
      'social_activity_hours_minutes_check',
      sql`${table.minutes} % ${n(SOCIAL_ENTRY_STEP_MINUTES)} = 0 and (
        (${table.kind} = 'entry' and ${table.minutes} between ${n(SOCIAL_ENTRY_STEP_MINUTES)} and ${n(MAX_MINUTES)})
        or (${table.kind} = 'reversal' and ${table.minutes} between ${n(-MAX_MINUTES)} and ${n(-SOCIAL_ENTRY_STEP_MINUTES)}))`,
    ),
    check(
      'social_activity_hours_reversal_check',
      sql`(${table.kind} = 'reversal') = (${table.reversesEntryId} is not null)
        and (${table.kind} = 'entry' or (${table.status} = 'approved' and ${table.reversedByEntryId} is null))
        and (${table.reversedByEntryId} is null or (${table.kind} = 'entry' and ${table.status} = 'approved'))`,
    ),
    check(
      'social_activity_hours_decision_check',
      sql`(${table.status} = 'pending') = (${table.decidedByUserId} is null)
        and (${table.decidedByUserId} is null) = (${table.decidedAt} is null)
        and (${table.status} = 'rejected') = (${table.rejectionReason} is not null)
        and (${table.rejectionReason} is null or char_length(${table.rejectionReason}) between 1 and ${n(SOCIAL_HOUR_REASON_MAX)})`,
    ),
    check(
      'social_activity_hours_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(SOCIAL_HOUR_NOTE_MAX)}`,
    ),
    uniqueIndex('social_activity_hours_day_key')
      .on(table.institutionId, table.activityId, table.studentId, table.activityDate)
      .where(
        sql`${table.kind} = 'entry' and ${table.status} <> 'rejected' and ${table.reversedByEntryId} is null and ${table.archivedAt} is null`,
      ),
    uniqueIndex('social_activity_hours_reverses_key')
      .on(table.institutionId, table.reversesEntryId)
      .where(sql`${table.reversesEntryId} is not null`),
    index('social_activity_hours_student_idx').on(
      table.institutionId,
      table.studentId,
      table.activityDate,
    ),
    index('social_activity_hours_activity_idx').on(
      table.institutionId,
      table.activityId,
      table.status,
    ),
  ],
)

/**
 * Kurumun sosyal etkinlik hedefleri (DOM-FIN-160; K-537): ortaöğrenim boyunca toplam ve isteğe
 * bağlı öğretim yılı hedefi (tam saat). Satır yoksa mevzuat önerisi (40 ve 10) uygulanır.
 */
export const socialActivitySettings = pgTable(
  'social_activity_settings',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    totalTargetHours: integer('total_target_hours').notNull(),
    yearlyTargetHours: integer('yearly_target_hours'),
    // kvkk: K
    updatedByUserId: text('updated_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'social_activity_settings_pkey', columns: [table.institutionId] }),
    check(
      'social_activity_settings_targets_check',
      sql`${table.totalTargetHours} between 1 and ${n(SOCIAL_TARGET_MAX_HOURS)}
        and (${table.yearlyTargetHours} is null or ${table.yearlyTargetHours} between 1 and ${n(SOCIAL_TARGET_MAX_HOURS)})`,
    ),
  ],
)
