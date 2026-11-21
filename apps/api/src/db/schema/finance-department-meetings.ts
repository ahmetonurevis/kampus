import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  DEPARTMENT_DECISION_NOTE_MAX,
  DEPARTMENT_DECISION_STATUSES,
  DEPARTMENT_DECISION_TEXT_MAX,
  DEPARTMENT_DECISION_TEXT_MIN,
  DEPARTMENT_MEETING_AGENDA_MAX,
  DEPARTMENT_MEETING_ATTENDANCE,
  DEPARTMENT_MEETING_CLASS_MAX,
  DEPARTMENT_MEETING_KINDS,
  DEPARTMENT_MEETING_LOCATION_MAX,
  DEPARTMENT_MEETING_LOCATION_MIN,
  DEPARTMENT_MEETING_STATUSES,
  DEPARTMENT_MEETING_SUBJECT_MAX,
  MEETING_BOARDS,
  MEETING_TEMPLATE_NAME_MAX,
  MEETING_TEMPLATE_NAME_MIN,
  type DepartmentDecisionStatus,
  type DepartmentMeetingAttendance,
  type DepartmentMeetingKind,
  type DepartmentMeetingStatus,
  type MeetingBoard,
  type StoredAgendaItem,
} from '@kampus/school-core/lib/finance-department-meetings.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { records } from './records.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Kurul ve zümre toplantısının gündem şablonu (DOM-FIN-135; ON-218; K-461). Kurul türü başına
 * kurumun adlı şablonları; maddeler sıralı jsonb (`{ title }`). Toplantı açılırken gündem
 * şablondan kopyalanır, toplantı şablona yalnız iz olarak bağlanır. Silinmez, arşivlenir.
 */
export const departmentMeetingTemplates = pgTable(
  'department_meeting_templates',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    board: text('board').$type<MeetingBoard>().notNull(),
    name: text('name').notNull(),
    items: jsonb('items').$type<{ title: string }[]>().notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'department_meeting_templates_pkey',
      columns: [table.institutionId, table.id],
    }),
    check('department_meeting_templates_board_check', oneOf(table.board, MEETING_BOARDS)),
    check(
      'department_meeting_templates_name_check',
      sql`char_length(${table.name}) between ${n(MEETING_TEMPLATE_NAME_MIN)} and ${n(MEETING_TEMPLATE_NAME_MAX)}`,
    ),
    check(
      'department_meeting_templates_items_check',
      sql`jsonb_typeof(${table.items}) = 'array'
        and jsonb_array_length(${table.items}) between 1 and ${n(DEPARTMENT_MEETING_AGENDA_MAX)}`,
    ),
    uniqueIndex('department_meeting_templates_name_key')
      .on(table.institutionId, table.board, table.name)
      .where(sql`${table.archivedAt} is null`),
    index('department_meeting_templates_board_idx').on(table.institutionId, table.board),
  ],
)

/**
 * Kurul ve zümre toplantısı tutanağı (DOM-FIN-132, DOM-FIN-135; ON-217, ON-218). Kurul türü
 * (zümre, öğretmenler kurulu, şube öğretmenler kurulu) ve hedefi (zümrede ders, şube kurulunda
 * sınıf; adları toplantı anında kopyalanır), zaman, gün, yer, başkan ve sıralı gündem (jsonb;
 * maddenin kimliği kararın bağıdır). İmza günüyle kesinleşir (K-453): kesinleşmiş satır değişmez
 * (migration'daki tetikleyici). Satır silinmez.
 */
export const departmentMeetings = pgTable(
  'department_meetings',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    board: text('board').$type<MeetingBoard>().notNull(),
    subjectId: text('subject_id'),
    subjectName: text('subject_name'),
    classId: text('class_id'),
    /** Yabancı anahtarın koleksiyon parçası; hep `classes`. */
    classCollection: text('class_collection')
      .notNull()
      .generatedAlwaysAs(sql`'classes'`),
    className: text('class_name'),
    agendaTemplateId: uuid('agenda_template_id'),
    kind: text('kind').$type<DepartmentMeetingKind>().notNull(),
    meetingDate: date('meeting_date', { mode: 'string' }).notNull(),
    location: text('location').notNull(),
    // kvkk: K (personel üyeliği)
    chairMembershipId: text('chair_membership_id').notNull(),
    agenda: jsonb('agenda').$type<StoredAgendaItem[]>().notNull(),
    status: text('status').$type<DepartmentMeetingStatus>().notNull(),
    signedDate: date('signed_date', { mode: 'string' }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    // kvkk: K
    finalizedByUserId: text('finalized_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'department_meetings_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'department_meetings_chair_fkey',
      columns: [table.institutionId, table.chairMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'department_meetings_class_fkey',
      columns: [table.institutionId, table.classCollection, table.classId],
      foreignColumns: [records.institutionId, records.collection, records.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'department_meetings_template_fkey',
      columns: [table.institutionId, table.agendaTemplateId],
      foreignColumns: [departmentMeetingTemplates.institutionId, departmentMeetingTemplates.id],
    }).onDelete('restrict'),
    check('department_meetings_board_check', oneOf(table.board, MEETING_BOARDS)),
    // Kurul türünün hedefi (K-460, K-462): zümrede ders, şube kurulunda sınıf, kurulda hiçbiri.
    check(
      'department_meetings_board_target_check',
      sql`(${table.board} = 'department' and ${table.subjectId} is not null and ${table.subjectName} is not null
          and ${table.classId} is null and ${table.className} is null)
        or (${table.board} = 'class' and ${table.classId} is not null and ${table.className} is not null
          and ${table.subjectId} is null and ${table.subjectName} is null)
        or (${table.board} = 'teachers' and ${table.subjectId} is null and ${table.subjectName} is null
          and ${table.classId} is null and ${table.className} is null)`,
    ),
    check('department_meetings_kind_check', oneOf(table.kind, DEPARTMENT_MEETING_KINDS)),
    check('department_meetings_status_check', oneOf(table.status, DEPARTMENT_MEETING_STATUSES)),
    check(
      'department_meetings_text_check',
      sql`(${table.subjectId} is null or char_length(${table.subjectId}) between 1 and ${n(DEPARTMENT_MEETING_SUBJECT_MAX)})
        and (${table.subjectName} is null or char_length(${table.subjectName}) between 1 and 120)
        and char_length(${table.location}) between ${n(DEPARTMENT_MEETING_LOCATION_MIN)} and ${n(DEPARTMENT_MEETING_LOCATION_MAX)}
        and (${table.classId} is null or char_length(${table.classId}) between 1 and ${n(DEPARTMENT_MEETING_CLASS_MAX)})
        and (${table.className} is null or char_length(${table.className}) between 1 and 120)`,
    ),
    check(
      'department_meetings_agenda_check',
      sql`jsonb_typeof(${table.agenda}) = 'array'
        and jsonb_array_length(${table.agenda}) between 1 and ${n(DEPARTMENT_MEETING_AGENDA_MAX)}`,
    ),
    // Kesinleşme üçlüsü birlikte dolar; imza günü toplantıdan önce olamaz.
    check(
      'department_meetings_finalized_check',
      sql`(${table.status} = 'draft' and ${table.signedDate} is null and ${table.finalizedAt} is null and ${table.finalizedByUserId} is null)
        or (${table.status} = 'finalized' and ${table.signedDate} is not null and ${table.finalizedAt} is not null
          and ${table.finalizedByUserId} is not null and ${table.signedDate} >= ${table.meetingDate})`,
    ),
    index('department_meetings_date_idx').on(table.institutionId, table.meetingDate),
    index('department_meetings_subject_idx').on(
      table.institutionId,
      table.subjectId,
      table.meetingDate,
    ),
    index('department_meetings_chair_idx').on(table.institutionId, table.chairMembershipId),
    index('department_meetings_board_idx').on(table.institutionId, table.board, table.meetingDate),
    index('department_meetings_class_idx').on(table.institutionId, table.classId),
    index('department_meetings_template_idx').on(table.institutionId, table.agendaTemplateId),
  ],
)

/**
 * Toplantı katılımı (DOM-FIN-132; K-452): personel kurum üyeliğidir. Taslakta listeden çıkarılan
 * katılımcı arşivlenir; etkin satır personel başına tekildir.
 */
export const departmentMeetingAttendees = pgTable(
  'department_meeting_attendees',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    meetingId: uuid('meeting_id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    status: text('status').$type<DepartmentMeetingAttendance>().notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'department_meeting_attendees_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'department_meeting_attendees_meeting_fkey',
      columns: [table.institutionId, table.meetingId],
      foreignColumns: [departmentMeetings.institutionId, departmentMeetings.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'department_meeting_attendees_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'department_meeting_attendees_status_check',
      oneOf(table.status, DEPARTMENT_MEETING_ATTENDANCE),
    ),
    uniqueIndex('department_meeting_attendees_member_key')
      .on(table.institutionId, table.meetingId, table.membershipId)
      .where(sql`${table.archivedAt} is null`),
    index('department_meeting_attendees_meeting_idx').on(table.institutionId, table.meetingId),
    index('department_meeting_attendees_membership_idx').on(
      table.institutionId,
      table.membershipId,
    ),
  ],
)

/**
 * Toplantı kararı (DOM-FIN-132; K-452, K-453): gündem maddesine bağlı metin, sorumlu personel,
 * termin ve takip. Taslakta kaldırılan karar arşivlenir. Kesinleşen tutanakta yalnız durum ve
 * takip notu değişir (tetikleyici); iptal notsuz olmaz.
 */
export const departmentMeetingDecisions = pgTable(
  'department_meeting_decisions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    meetingId: uuid('meeting_id').notNull(),
    agendaItemId: uuid('agenda_item_id').notNull(),
    text: text('text').notNull(),
    // kvkk: K (personel üyeliği)
    responsibleMembershipId: text('responsible_membership_id').notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    status: text('status').$type<DepartmentDecisionStatus>().notNull(),
    followUpNote: text('follow_up_note'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'department_meeting_decisions_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'department_meeting_decisions_meeting_fkey',
      columns: [table.institutionId, table.meetingId],
      foreignColumns: [departmentMeetings.institutionId, departmentMeetings.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'department_meeting_decisions_responsible_fkey',
      columns: [table.institutionId, table.responsibleMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'department_meeting_decisions_status_check',
      oneOf(table.status, DEPARTMENT_DECISION_STATUSES),
    ),
    check(
      'department_meeting_decisions_text_check',
      sql`char_length(${table.text}) between ${n(DEPARTMENT_DECISION_TEXT_MIN)} and ${n(DEPARTMENT_DECISION_TEXT_MAX)}
        and (${table.followUpNote} is null or char_length(${table.followUpNote}) between 1 and ${n(DEPARTMENT_DECISION_NOTE_MAX)})
        and (${table.status} <> 'cancelled' or ${table.followUpNote} is not null)`,
    ),
    index('department_meeting_decisions_meeting_idx').on(table.institutionId, table.meetingId),
    index('department_meeting_decisions_responsible_idx').on(
      table.institutionId,
      table.responsibleMembershipId,
    ),
    index('department_meeting_decisions_due_idx')
      .on(table.institutionId, table.dueDate)
      .where(sql`${table.status} = 'open' and ${table.archivedAt} is null`),
  ],
)
