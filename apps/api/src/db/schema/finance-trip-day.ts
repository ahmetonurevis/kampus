import { sql } from 'drizzle-orm'
import {
  check,
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
  TRIP_DAY_CHECK_STATUSES,
  TRIP_DAY_CHECKPOINT_MAX,
  TRIP_DAY_CHECKPOINT_MIN,
  TRIP_DAY_GROUP_NAME_MAX,
  TRIP_DAY_GROUP_NAME_MIN,
  TRIP_DAY_MARK_STATUSES,
  TRIP_DAY_REASON_MAX,
  TRIP_DAY_REASON_MIN,
  type TripDayCheckStatus,
  type TripDayMarkStatus,
} from '@kampus/school-core/lib/finance-trip-day.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { tripPlans } from './finance-trip-plans.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Gezi günü grubu (DOM-FIN-154; ON-157; K-517): gezi planının (DOM-FIN-111) araç ya da grubu, isteğe
 * bağlı plaka ve sorumlu görevli (kurum üyeliği; personel tablosu yoktur). Ad planda büyük/küçük
 * harf duyarsız tekildir. Grup silinmez; turu açılmamış grup arşivlenir.
 */
export const tripDayGroups = pgTable(
  'trip_day_groups',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    planId: uuid('plan_id').notNull(),
    name: text('name').notNull(),
    vehiclePlate: text('vehicle_plate'),
    // kvkk: K (personel üyeliği)
    leaderMembershipId: text('leader_membership_id').notNull(),
    position: integer('position').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_day_groups_pkey', columns: [table.institutionId, table.id] }),
    // Üye ve tur satırlarının "grup bu planda" bağı için (kurum, kimlik, plan) tekildir.
    unique('trip_day_groups_plan_key').on(table.institutionId, table.id, table.planId),
    foreignKey({
      name: 'trip_day_groups_plan_fkey',
      columns: [table.institutionId, table.planId],
      foreignColumns: [tripPlans.institutionId, tripPlans.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'trip_day_groups_leader_fkey',
      columns: [table.institutionId, table.leaderMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'trip_day_groups_text_check',
      sql`char_length(${table.name}) between ${n(TRIP_DAY_GROUP_NAME_MIN)} and ${n(TRIP_DAY_GROUP_NAME_MAX)}
        and (${table.vehiclePlate} is null or ${table.vehiclePlate} ~ '^[0-9]{2}[A-Z]{1,3}[0-9]{2,5}$')`,
    ),
    check('trip_day_groups_position_check', sql`${table.position} >= 0`),
    uniqueIndex('trip_day_groups_name_key')
      .on(table.institutionId, table.planId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    index('trip_day_groups_plan_idx').on(table.institutionId, table.planId, table.position),
    index('trip_day_groups_leader_idx').on(table.institutionId, table.leaderMembershipId),
  ],
)

/**
 * Öğrencinin gezi günündeki grubu (K-517): planda öğrenci başına tek etkin satır; taşımada grup
 * değişir, çıkarmada satır arşivlenir. `student_id` `records` kimliğidir.
 */
export const tripDayMembers = pgTable(
  'trip_day_members',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    planId: uuid('plan_id').notNull(),
    groupId: uuid('group_id').notNull(),
    // kvkk: K (öğrenci)
    studentId: text('student_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_day_members_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'trip_day_members_group_fkey',
      columns: [table.institutionId, table.groupId, table.planId],
      foreignColumns: [tripDayGroups.institutionId, tripDayGroups.id, tripDayGroups.planId],
    }).onDelete('restrict'),
    uniqueIndex('trip_day_members_student_key')
      .on(table.institutionId, table.planId, table.studentId)
      .where(sql`${table.archivedAt} is null`),
    index('trip_day_members_group_idx').on(table.institutionId, table.groupId),
    index('trip_day_members_student_idx').on(table.institutionId, table.studentId),
  ],
)

/**
 * Yoklama turu (K-517): grubun adlandırılmış kontrol noktası (çıkış, varış, dönüş çıkışı, okula
 * varış …), grupta sıra numarasıyla. Grubun aynı anda tek süren turu olur (kısmi tekil indeks).
 * Tur ya herkes "var" iken `complete`, ya herkes işaretliyken gerekçeyle `incomplete` (eksikle
 * devam) kapanır; kapanan tur yeniden açılmaz.
 */
export const tripDayChecks = pgTable(
  'trip_day_checks',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    planId: uuid('plan_id').notNull(),
    groupId: uuid('group_id').notNull(),
    sequence: integer('sequence').notNull(),
    checkpoint: text('checkpoint').notNull(),
    status: text('status').$type<TripDayCheckStatus>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    // kvkk: K
    startedByUserId: text('started_by_user_id').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // kvkk: K
    closedByUserId: text('closed_by_user_id'),
    missingCount: integer('missing_count'),
    // kvkk: K (serbest metin; eksik öğrencinin durumu)
    missingReason: text('missing_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_day_checks_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'trip_day_checks_group_fkey',
      columns: [table.institutionId, table.groupId, table.planId],
      foreignColumns: [tripDayGroups.institutionId, tripDayGroups.id, tripDayGroups.planId],
    }).onDelete('restrict'),
    check('trip_day_checks_status_check', oneOf(table.status, TRIP_DAY_CHECK_STATUSES)),
    check(
      'trip_day_checks_text_check',
      sql`${table.sequence} >= 1
        and char_length(${table.checkpoint}) between ${n(TRIP_DAY_CHECKPOINT_MIN)} and ${n(TRIP_DAY_CHECKPOINT_MAX)}
        and (${table.missingReason} is null
          or char_length(${table.missingReason}) between ${n(TRIP_DAY_REASON_MIN)} and ${n(TRIP_DAY_REASON_MAX)})`,
    ),
    // Kapanış alanları duruma göre dolar: süren turda boş; tamamda eksik 0, eksikle devamda eksik
    // en az bir ve gerekçe dolu.
    check(
      'trip_day_checks_closed_check',
      sql`(${table.status} = 'open') = (${table.closedAt} is null)
        and (${table.closedAt} is null) = (${table.closedByUserId} is null)
        and (${table.closedAt} is null) = (${table.missingCount} is null)
        and (${table.status} <> 'complete' or ${table.missingCount} = 0)
        and (${table.status} = 'incomplete') = (${table.missingReason} is not null)
        and (${table.status} <> 'incomplete' or ${table.missingCount} > 0)`,
    ),
    uniqueIndex('trip_day_checks_sequence_key').on(
      table.institutionId,
      table.groupId,
      table.sequence,
    ),
    uniqueIndex('trip_day_checks_open_key')
      .on(table.institutionId, table.groupId)
      .where(sql`${table.status} = 'open' and ${table.archivedAt} is null`),
    index('trip_day_checks_plan_idx').on(table.institutionId, table.planId, table.groupId),
  ],
)

/**
 * Turda öğrencinin işareti (K-517): var ya da yok, işaret anı ve işaretleyen; turda öğrenci başına
 * tek satır. Süren turda değişebilir, kapanan turda donar. Konum tutulmaz. `student_id` `records`
 * kimliğidir.
 */
export const tripDayCheckMarks = pgTable(
  'trip_day_check_marks',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    checkId: uuid('check_id').notNull(),
    // kvkk: K (öğrenci)
    studentId: text('student_id').notNull(),
    status: text('status').$type<TripDayMarkStatus>().notNull(),
    // kvkk: K (öğrencinin işaret anı)
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull(),
    // kvkk: K
    markedByUserId: text('marked_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_day_check_marks_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'trip_day_check_marks_check_fkey',
      columns: [table.institutionId, table.checkId],
      foreignColumns: [tripDayChecks.institutionId, tripDayChecks.id],
    }).onDelete('restrict'),
    check('trip_day_check_marks_status_check', oneOf(table.status, TRIP_DAY_MARK_STATUSES)),
    uniqueIndex('trip_day_check_marks_student_key')
      .on(table.institutionId, table.checkId, table.studentId)
      .where(sql`${table.archivedAt} is null`),
    index('trip_day_check_marks_check_idx').on(table.institutionId, table.checkId),
    index('trip_day_check_marks_student_idx').on(table.institutionId, table.studentId),
  ],
)
