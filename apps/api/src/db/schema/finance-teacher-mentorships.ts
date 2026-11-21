import { sql } from 'drizzle-orm'
import {
  boolean,
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
  CHECKLIST_LABEL_MAX,
  CHECKLIST_LABEL_MIN,
  MEETING_DURATION_MAX,
  MEETING_DURATION_MIN,
  MEETING_NEXT_STEP_MAX,
  MEETING_NOTE_MAX,
  MEETING_TOPIC_MAX,
  MEETING_TOPIC_MIN,
  MENTOR_LOAD_MAX,
  MENTOR_LOAD_MIN,
  MENTORSHIP_CHECKLIST_MAX,
  MENTORSHIP_END_REASON_MAX,
  MENTORSHIP_END_REASON_MIN,
  MENTORSHIP_STATUSES,
  type MentorshipChecklistTemplateItem,
  type MentorshipStatus,
} from '@kampus/school-core/lib/finance-teacher-mentorships.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { staffJobOffers } from './finance-staff-onboarding.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Mentorluk kurum ayarı (DOM-FIN-136; ON-219, K-463, K-465): mentor başına süren eşleşme sınırı ve
 * yeni eşleşmelere kopyalanan kontrol listesi. Satır yoksa core varsayılanı kullanılır.
 */
export const teacherMentorshipSettings = pgTable(
  'teacher_mentorship_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    maxActivePerMentor: integer('max_active_per_mentor').notNull(),
    checklistItems: jsonb('checklist_items').$type<MentorshipChecklistTemplateItem[]>().notNull(),
    // kvkk: K
    updatedByUserId: text('updated_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    check(
      'teacher_mentorship_settings_load_check',
      sql`${table.maxActivePerMentor} between ${n(MENTOR_LOAD_MIN)} and ${n(MENTOR_LOAD_MAX)}`,
    ),
    check(
      'teacher_mentorship_settings_items_check',
      sql`jsonb_typeof(${table.checklistItems}) = 'array'
        and jsonb_array_length(${table.checklistItems}) <= ${n(MENTORSHIP_CHECKLIST_MAX)}`,
    ),
  ],
)

/**
 * Mentorluk eşleşmesi (DOM-FIN-136; ON-219, K-463). Mentor ve yeni öğretmen kurum üyeliğidir
 * (personel tablosu yoktur); isteğe bağlı işe başlama listesi kabul edilmiş iş teklifidir
 * (DOM-FIN-121). Sürüyor → tamamlandı ya da erken sonlandı (gerekçeli); kapanan satır değişmez.
 * Yeni öğretmenin aynı anda tek süren eşleşmesi olur (kısmi tekil indeks).
 */
export const teacherMentorships = pgTable(
  'teacher_mentorships',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (mentor üyeliği)
    mentorMembershipId: text('mentor_membership_id').notNull(),
    // kvkk: K (yeni öğretmen üyeliği)
    menteeMembershipId: text('mentee_membership_id').notNull(),
    onboardingOfferId: uuid('onboarding_offer_id'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    status: text('status').$type<MentorshipStatus>().notNull().default('active'),
    closedOn: date('closed_on', { mode: 'string' }),
    // kvkk: K (serbest metin; denetime yazılmaz)
    endReason: text('end_reason'),
    // kvkk: K
    closedByUserId: text('closed_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'teacher_mentorships_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'teacher_mentorships_mentor_fkey',
      columns: [table.institutionId, table.mentorMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'teacher_mentorships_mentee_fkey',
      columns: [table.institutionId, table.menteeMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'teacher_mentorships_offer_fkey',
      columns: [table.institutionId, table.onboardingOfferId],
      foreignColumns: [staffJobOffers.institutionId, staffJobOffers.id],
    }).onDelete('restrict'),
    check('teacher_mentorships_status_check', oneOf(table.status, MENTORSHIP_STATUSES)),
    check(
      'teacher_mentorships_people_check',
      sql`${table.mentorMembershipId} <> ${table.menteeMembershipId}`,
    ),
    check(
      'teacher_mentorships_dates_check',
      sql`${table.endDate} > ${table.startDate}
        and (${table.closedOn} is null or ${table.closedOn} >= ${table.startDate})`,
    ),
    check(
      'teacher_mentorships_closed_check',
      sql`((${table.status} = 'active') = (${table.closedOn} is null))
        and ((${table.closedOn} is null) = (${table.closedByUserId} is null))
        and ((${table.status} = 'ended_early') = (${table.endReason} is not null))
        and (${table.endReason} is null
          or char_length(${table.endReason}) between ${n(MENTORSHIP_END_REASON_MIN)} and ${n(MENTORSHIP_END_REASON_MAX)})`,
    ),
    uniqueIndex('teacher_mentorships_mentee_active_key')
      .on(table.institutionId, table.menteeMembershipId)
      .where(sql`${table.status} = 'active' and ${table.archivedAt} is null`),
    index('teacher_mentorships_mentor_idx').on(
      table.institutionId,
      table.mentorMembershipId,
      table.status,
    ),
    index('teacher_mentorships_mentee_idx').on(table.institutionId, table.menteeMembershipId),
    index('teacher_mentorships_offer_idx').on(table.institutionId, table.onboardingOfferId),
    index('teacher_mentorships_status_idx').on(table.institutionId, table.status, table.startDate),
  ],
)

/**
 * Mentorluk görüşmesi (DOM-FIN-136; K-464): gün, süre, konu, not ve sonraki adım. Yalnız süren
 * eşleşmeye eklenir; yanlış kayıt eşleşme sürerken arşivlenir.
 */
export const teacherMentorshipMeetings = pgTable(
  'teacher_mentorship_meetings',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    mentorshipId: uuid('mentorship_id').notNull(),
    meetingDate: date('meeting_date', { mode: 'string' }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    topic: text('topic').notNull(),
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    note: text('note'),
    // kvkk: K (serbest metin; denetime yazılmaz)
    nextStep: text('next_step'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'teacher_mentorship_meetings_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'teacher_mentorship_meetings_mentorship_fkey',
      columns: [table.institutionId, table.mentorshipId],
      foreignColumns: [teacherMentorships.institutionId, teacherMentorships.id],
    }).onDelete('restrict'),
    check(
      'teacher_mentorship_meetings_duration_check',
      sql`${table.durationMinutes} between ${n(MEETING_DURATION_MIN)} and ${n(MEETING_DURATION_MAX)}`,
    ),
    check(
      'teacher_mentorship_meetings_text_check',
      sql`char_length(${table.topic}) between ${n(MEETING_TOPIC_MIN)} and ${n(MEETING_TOPIC_MAX)}
        and (${table.note} is null or char_length(${table.note}) between 1 and ${n(MEETING_NOTE_MAX)})
        and (${table.nextStep} is null
          or char_length(${table.nextStep}) between 1 and ${n(MEETING_NEXT_STEP_MAX)})`,
    ),
    index('teacher_mentorship_meetings_mentorship_idx').on(
      table.institutionId,
      table.mentorshipId,
      table.meetingDate,
    ),
  ],
)

/**
 * Eşleşmenin kontrol listesi maddesi (DOM-FIN-136; K-465): kurum ayarından eşleşme açılırken
 * kopyalanır, silinmez; sıra `position`. Tamamlanma anı ve işaretleyen birlikte yazılır, geri
 * alınınca birlikte silinir.
 */
export const teacherMentorshipChecklistItems = pgTable(
  'teacher_mentorship_checklist_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    mentorshipId: uuid('mentorship_id').notNull(),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    required: boolean('required').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // kvkk: K
    completedByUserId: text('completed_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'teacher_mentorship_checklist_items_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'teacher_mentorship_checklist_items_mentorship_fkey',
      columns: [table.institutionId, table.mentorshipId],
      foreignColumns: [teacherMentorships.institutionId, teacherMentorships.id],
    }).onDelete('restrict'),
    check(
      'teacher_mentorship_checklist_items_label_check',
      sql`char_length(${table.label}) between ${n(CHECKLIST_LABEL_MIN)} and ${n(CHECKLIST_LABEL_MAX)}`,
    ),
    check(
      'teacher_mentorship_checklist_items_completed_check',
      sql`(${table.completedAt} is null) = (${table.completedByUserId} is null)`,
    ),
    uniqueIndex('teacher_mentorship_checklist_items_position_key').on(
      table.institutionId,
      table.mentorshipId,
      table.position,
    ),
  ],
)
