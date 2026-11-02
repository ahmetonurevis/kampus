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

import { COURSE_GROUP_CAPACITY_MAX } from '@kampus/school-core/lib/courses.ts'
import {
  GROUP_AGE_BANDS,
  GROUP_DELIVERIES,
  GROUP_MEMBER_STATUSES,
  GROUP_NAME_MAX,
  GROUP_REASON_MAX,
  GROUP_ROOM_MAX,
  GROUP_STATES,
  WAITLIST_STATUSES,
  type GroupAgeBand,
  type GroupDelivery,
  type GroupMemberStatus,
  type GroupSlot,
  type GroupState,
  type WaitlistStatus,
} from '@kampus/school-core/lib/language-groups.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { courses } from './courses.ts'
import { records } from './records.ts'

const max = (value: number) => sql.raw(String(value))

/**
 * Dil okulu grubu (IST-077; docs/domain/dil-okulu.md DOM-DIL-003, -008, -040…043; kural core
 * `lib/language-groups.ts`). Grup kurun tarihli açılışıdır: kur bileşik yabancı anahtarla aynı
 * kurumun kuruna bağlanır; seviye ve oturum uzunluğu kurdan okunur, burada saklanmaz.
 *
 * - Saklanan durum `planned`, `open`, `cancelled`; `running` ve `completed` tarihten türetilir.
 * - `end_date` core `groupEndDate`'ten her yazmada yeniden hesaplanır; liste süzgeci (devam eden,
 *   tamamlanan) ve çakışma yüklemesi tarih aralığını SQL'de okusun diye tutulur.
 * - Haftalık kalıp `schedule` (`[{ weekday, startTime }]`) jsonb'dir: yalnız core'da okunur,
 *   üzerinde sorgu ve indeks yoktur. Çakışma denetimi kurum kilidi altında core'dadır.
 * - Ad ve derslik anahtarları core'dan türetilir (`groupNameKey`, `groupRoomKey`).
 * - Öğretmen aynı kurumun üyeliğidir: `(institution_id, teacher_membership_id)` bileşik yabancı
 *   anahtarı `memberships (institution_id, id)` tekil indeksine bağlanır (indeks Better Auth
 *   şemasında olmadığından migration'a elle eklenir, `memberships_institution_id_user_id_key`
 *   gibi). Rol core'da (`group_teacher_invalid`) denetlenir. Üyelik silinirse yalnız
 *   `teacher_membership_id` boşalır (`on delete set null (teacher_membership_id)`, elle; Drizzle
 *   kolon listesini üretmez) ve grup öğretmensiz kalır.
 */
export const languageGroups = pgTable(
  'language_groups',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    courseId: uuid('course_id').notNull(),
    name: text('name').notNull(),
    /** Ad tekilliği anahtarı: core `groupNameKey(name)`. */
    nameKey: text('name_key').notNull(),
    ageBand: text('age_band').$type<GroupAgeBand>().notNull(),
    teacherMembershipId: text('teacher_membership_id'),
    delivery: text('delivery').$type<GroupDelivery>().notNull(),
    room: text('room'),
    /** Derslik çakışma anahtarı: core `groupRoomKey(room)`. */
    roomKey: text('room_key'),
    schedule: jsonb('schedule').$type<GroupSlot[]>().notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    capacity: integer('capacity').notNull(),
    state: text('state').$type<GroupState>().notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    mergedIntoGroupId: uuid('merged_into_group_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'language_groups_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'language_groups_course_fkey',
      columns: [table.institutionId, table.courseId],
      foreignColumns: [courses.institutionId, courses.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'language_groups_teacher_fkey',
      columns: [table.institutionId, table.teacherMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'language_groups_merged_into_fkey',
      columns: [table.institutionId, table.mergedIntoGroupId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    check(
      'language_groups_name_check',
      sql`char_length(${table.name}) between 1 and ${max(GROUP_NAME_MAX)}`,
    ),
    check('language_groups_age_band_check', oneOf(table.ageBand, GROUP_AGE_BANDS)),
    check('language_groups_delivery_check', oneOf(table.delivery, GROUP_DELIVERIES)),
    // Çevrim içi grubun dersliği yoktur; derslik ve anahtarı birlikte bulunur.
    check(
      'language_groups_room_check',
      sql`(${table.room} is null) = (${table.roomKey} is null)
        and (${table.room} is null or char_length(${table.room}) between 1 and ${max(GROUP_ROOM_MAX)})
        and (${table.delivery} = 'in_person' or ${table.room} is null)`,
    ),
    check(
      'language_groups_schedule_check',
      sql`jsonb_typeof(${table.schedule}) = 'array' and jsonb_array_length(${table.schedule}) >= 1`,
    ),
    check('language_groups_dates_check', sql`${table.endDate} >= ${table.startDate}`),
    // Kapasite 1–18 (DOM-DIL-040); kurun en çok mevcuduna göre denetim core'dadır.
    check(
      'language_groups_capacity_check',
      sql`${table.capacity} between 1 and ${max(COURSE_GROUP_CAPACITY_MAX)}`,
    ),
    check('language_groups_state_check', oneOf(table.state, GROUP_STATES)),
    check(
      'language_groups_lifecycle_check',
      sql`(${table.state} = 'planned' and ${table.openedAt} is null and ${table.cancelledAt} is null)
        or (${table.state} = 'open' and ${table.openedAt} is not null and ${table.cancelledAt} is null)
        or (${table.state} = 'cancelled' and ${table.cancelledAt} is not null
          and ${table.cancelReason} is not null)`,
    ),
    check(
      'language_groups_cancel_check',
      sql`(${table.cancelReason} is null or char_length(${table.cancelReason}) between 1 and ${max(GROUP_REASON_MAX)})
        and (${table.mergedIntoGroupId} is null
          or (${table.state} = 'cancelled' and ${table.mergedIntoGroupId} <> ${table.id}))`,
    ),
    uniqueIndex('language_groups_name_key')
      .on(table.institutionId, table.nameKey)
      .where(sql`${table.archivedAt} is null and ${table.state} <> 'cancelled'`),
    index('language_groups_course_idx').on(table.institutionId, table.courseId),
    index('language_groups_teacher_idx').on(table.institutionId, table.teacherMembershipId),
    index('language_groups_merged_into_idx').on(table.institutionId, table.mergedIntoGroupId),
  ],
)

/**
 * Grubun kursiyerleri (DOM-DIL-040, -045). Kursiyer aynı kurumun `students` kaydıdır: sabit
 * `student_collection` (üretilen kolon, hep `students`) ile `records (institution_id, collection,
 * id)` birincil anahtarına bileşik yabancı anahtar (`on delete restrict`; kayıt silinmez, arşivlenir).
 * Satır yazması kayıt ve satış akışındadır (ON-058; kural
 * core `planGroupPlacement`); grup birleştirmede kaynak satırlar arşivlenir, hedefe yenisi yazılır
 * (geçmiş korunur). Aynı grupta bir kursiyerin tek arşivlenmemiş satırı olur.
 */
export const languageGroupMembers = pgTable(
  'language_group_members',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    groupId: uuid('group_id').notNull(),
    // kvkk: K (school-core öğrenci kaydı kimliği)
    studentId: text('student_id').notNull(),
    /** Yabancı anahtarın koleksiyon parçası; hep `students`. */
    studentCollection: text('student_collection')
      .notNull()
      .generatedAlwaysAs(sql`'students'`),
    status: text('status').$type<GroupMemberStatus>().notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'language_group_members_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'language_group_members_group_fkey',
      columns: [table.institutionId, table.groupId],
      foreignColumns: [languageGroups.institutionId, languageGroups.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'language_group_members_student_fkey',
      columns: [table.institutionId, table.studentCollection, table.studentId],
      foreignColumns: [records.institutionId, records.collection, records.id],
    }).onDelete('restrict'),
    check('language_group_members_status_check', oneOf(table.status, GROUP_MEMBER_STATUSES)),
    uniqueIndex('language_group_members_group_student_key')
      .on(table.institutionId, table.groupId, table.studentId)
      .where(sql`${table.archivedAt} is null`),
    index('language_group_members_student_idx').on(table.institutionId, table.studentId),
  ],
)

/**
 * Bekleme sırası (DOM-DIL-043): grubun (`group_id`) ya da kurun herhangi bir grubunun
 * (`group_id is null`) sırası. Bekleyen kayıtlı öğrenci ya da CRM adayıdır (tam biri). Teklif
 * `offer_group_id` grubuna `offer_expires_at`'e kadar geçerlidir ve kapasiteye sayılır. Yazma
 * kayıt akışındadır (ON-058; öneri core `suggestWaitlistOffers`); bu görevde yalnız okunur.
 */
export const languageGroupWaitlist = pgTable(
  'language_group_waitlist',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    courseId: uuid('course_id').notNull(),
    groupId: uuid('group_id'),
    // kvkk: K
    studentId: text('student_id'),
    // kvkk: K
    prospectId: text('prospect_id'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    status: text('status').$type<WaitlistStatus>().notNull(),
    offerGroupId: uuid('offer_group_id'),
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'language_group_waitlist_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'language_group_waitlist_course_fkey',
      columns: [table.institutionId, table.courseId],
      foreignColumns: [courses.institutionId, courses.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'language_group_waitlist_group_fkey',
      columns: [table.institutionId, table.groupId],
      foreignColumns: [languageGroups.institutionId, languageGroups.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'language_group_waitlist_offer_group_fkey',
      columns: [table.institutionId, table.offerGroupId],
      foreignColumns: [languageGroups.institutionId, languageGroups.id],
    }).onDelete('restrict'),
    check('language_group_waitlist_status_check', oneOf(table.status, WAITLIST_STATUSES)),
    check(
      'language_group_waitlist_learner_check',
      sql`(${table.studentId} is null) <> (${table.prospectId} is null)`,
    ),
    // Teklif alanları birlikte bulunur; bekleyen satırda teklif yoktur.
    check(
      'language_group_waitlist_offer_check',
      sql`((${table.offerGroupId} is null) = (${table.offeredAt} is null)
          and (${table.offeredAt} is null) = (${table.offerExpiresAt} is null))
        and (${table.status} <> 'waiting' or ${table.offeredAt} is null)
        and (${table.status} not in ('offered', 'accepted', 'expired') or ${table.offeredAt} is not null)
        and (${table.offerExpiresAt} is null or ${table.offerExpiresAt} > ${table.offeredAt})`,
    ),
    // Bir kişi aynı kurun sırasında bir kez bekler ya da teklif alır.
    uniqueIndex('language_group_waitlist_student_key')
      .on(table.institutionId, table.courseId, table.studentId)
      .where(
        sql`${table.archivedAt} is null and ${table.studentId} is not null and ${table.status} in ('waiting', 'offered')`,
      ),
    uniqueIndex('language_group_waitlist_prospect_key')
      .on(table.institutionId, table.courseId, table.prospectId)
      .where(
        sql`${table.archivedAt} is null and ${table.prospectId} is not null and ${table.status} in ('waiting', 'offered')`,
      ),
    index('language_group_waitlist_course_idx').on(
      table.institutionId,
      table.courseId,
      table.requestedAt,
    ),
    index('language_group_waitlist_group_idx').on(table.institutionId, table.groupId),
    index('language_group_waitlist_offer_group_idx').on(table.institutionId, table.offerGroupId),
  ],
)
