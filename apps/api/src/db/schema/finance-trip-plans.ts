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
  TRIP_AUTHORITY_REFERENCE_MAX,
  TRIP_COMPANY_MAX,
  TRIP_CONTACTS_MAX,
  TRIP_NAME_MAX,
  TRIP_NAME_MIN,
  TRIP_NOTE_MAX,
  TRIP_PERSON_NAME_MAX,
  TRIP_PLAN_EVENTS,
  TRIP_PLAN_STATUSES,
  TRIP_PURPOSE_MAX,
  TRIP_PURPOSE_MIN,
  TRIP_REASON_MAX,
  TRIP_REASON_MIN,
  TRIP_RISKS_MAX,
  TRIP_STAFF_ROLES,
  TRIP_STOPS_MAX,
  TRIP_STUDENTS_MAX,
  TRIP_TRANSPORT_TYPES,
  type TripContact,
  type TripPlanEvent,
  type TripPlanStatus,
  type TripRisk,
  type TripStaffRole,
  type TripStop,
  type TripTransportType,
} from '@kampus/school-core/lib/finance-trip-plans.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { paidActivities } from './finance-paid-activities.ts'
import { files } from './files.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Gezi planı ve onay dosyası (DOM-FIN-111; ON-155; K-366…K-368). Güzergâh, risk değerlendirmesi ve
 * acil iletişim plana ait sıralı listelerdir (jsonb); görevliler üyeliğe yabancı anahtarla
 * `trip_plan_staff`'tadır. Plan silinmez, iptal edilir; her durum değişikliği `trip_plan_events`'e
 * yazılır. Numara kurum içi sıradır (`GZ-<sıra>`). Ücretli etkinlik bağı isteğe bağlıdır; bir
 * etkinlik iptal edilmemiş tek plana bağlanır.
 */
export const tripPlans = pgTable(
  'trip_plans',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    sequence: integer('sequence').notNull(),
    name: text('name').notNull(),
    purpose: text('purpose').notNull(),
    departureAt: timestamp('departure_at', { withTimezone: true }).notNull(),
    returnAt: timestamp('return_at', { withTimezone: true }).notNull(),
    expectedStudentCount: integer('expected_student_count').notNull(),
    stops: jsonb('stops').$type<TripStop[]>().notNull(),
    transportType: text('transport_type').$type<TripTransportType>().notNull(),
    transportCompany: text('transport_company'),
    transportPlate: text('transport_plate'),
    // kvkk: K
    driverName: text('driver_name'),
    // kvkk: K
    driverPhone: text('driver_phone'),
    transportFileId: uuid('transport_file_id'),
    risks: jsonb('risks').$type<TripRisk[]>().notNull(),
    // kvkk: K (ad ve telefon)
    emergencyContacts: jsonb('emergency_contacts').$type<TripContact[]>().notNull(),
    paidActivityId: uuid('paid_activity_id'),
    status: text('status').$type<TripPlanStatus>().notNull().default('draft'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    // kvkk: K
    approvedByUserId: text('approved_by_user_id'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    authorityNotifiedOn: date('authority_notified_on', { mode: 'string' }),
    authorityReference: text('authority_reference'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_plans_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'trip_plans_transport_file_fkey',
      columns: [table.institutionId, table.transportFileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'trip_plans_paid_activity_fkey',
      columns: [table.institutionId, table.paidActivityId],
      foreignColumns: [paidActivities.institutionId, paidActivities.id],
    }).onDelete('restrict'),
    check('trip_plans_sequence_check', sql`${table.sequence} >= 1`),
    check('trip_plans_status_check', oneOf(table.status, TRIP_PLAN_STATUSES)),
    check('trip_plans_transport_type_check', oneOf(table.transportType, TRIP_TRANSPORT_TYPES)),
    check(
      'trip_plans_text_check',
      sql`char_length(${table.name}) between ${n(TRIP_NAME_MIN)} and ${n(TRIP_NAME_MAX)}
        and char_length(${table.purpose}) between ${n(TRIP_PURPOSE_MIN)} and ${n(TRIP_PURPOSE_MAX)}
        and (${table.transportCompany} is null or char_length(${table.transportCompany}) between 2 and ${n(TRIP_COMPANY_MAX)})
        and (${table.transportPlate} is null or ${table.transportPlate} ~ '^[0-9]{2}[A-Z]{1,3}[0-9]{2,5}$')
        and (${table.driverName} is null or char_length(${table.driverName}) between 2 and ${n(TRIP_PERSON_NAME_MAX)})
        and (${table.driverPhone} is null or ${table.driverPhone} ~ '^0[0-9]{10}$')
        and (${table.authorityReference} is null or char_length(${table.authorityReference}) between 1 and ${n(TRIP_AUTHORITY_REFERENCE_MAX)})`,
    ),
    check(
      'trip_plans_terms_check',
      sql`${table.returnAt} > ${table.departureAt}
        and ${table.expectedStudentCount} between 1 and ${n(TRIP_STUDENTS_MAX)}
        and jsonb_typeof(${table.stops}) = 'array'
        and jsonb_array_length(${table.stops}) between 1 and ${n(TRIP_STOPS_MAX)}
        and jsonb_typeof(${table.risks}) = 'array'
        and jsonb_array_length(${table.risks}) <= ${n(TRIP_RISKS_MAX)}
        and jsonb_typeof(${table.emergencyContacts}) = 'array'
        and jsonb_array_length(${table.emergencyContacts}) <= ${n(TRIP_CONTACTS_MAX)}`,
    ),
    // Karar alanları duruma göre dolar: onaylanmış ve tamamlanmış planda onay, reddedilmiş planda
    // ret vardır; iptal edilen plan son kararını korur. Bildirim işareti onay ister.
    check(
      'trip_plans_status_fields_check',
      sql`(${table.status} not in ('approved', 'completed') or ${table.approvedAt} is not null)
        and (${table.approvedAt} is null or ${table.status} in ('approved', 'completed', 'cancelled'))
        and ((${table.approvedAt} is null) = (${table.approvedByUserId} is null))
        and (${table.status} <> 'rejected' or ${table.rejectedAt} is not null)
        and (${table.rejectedAt} is null or ${table.status} in ('rejected', 'cancelled'))
        and ((${table.rejectedAt} is null) = (${table.rejectionReason} is null))
        and (${table.rejectionReason} is null
          or char_length(${table.rejectionReason}) between ${n(TRIP_REASON_MIN)} and ${n(TRIP_REASON_MAX)})
        and (${table.status} = 'draft' or ${table.status} = 'cancelled' or ${table.submittedAt} is not null)
        and (${table.authorityNotifiedOn} is null or ${table.approvedAt} is not null)
        and (${table.authorityReference} is null or ${table.authorityNotifiedOn} is not null)
        and ((${table.status} = 'completed') = (${table.completedAt} is not null))
        and ((${table.status} = 'cancelled') = (${table.cancelledAt} is not null))
        and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))
        and (${table.cancelReason} is null
          or char_length(${table.cancelReason}) between ${n(TRIP_REASON_MIN)} and ${n(TRIP_REASON_MAX)})`,
    ),
    uniqueIndex('trip_plans_sequence_key').on(table.institutionId, table.sequence),
    // Bir ücretli etkinlik iptal edilmemiş tek plana bağlanır (servis 409 verir, indeks son güvence).
    uniqueIndex('trip_plans_paid_activity_key')
      .on(table.institutionId, table.paidActivityId)
      .where(
        sql`${table.paidActivityId} is not null and ${table.archivedAt} is null and ${table.status} <> 'cancelled'`,
      ),
    index('trip_plans_status_idx').on(table.institutionId, table.status, table.departureAt),
    index('trip_plans_departure_idx').on(table.institutionId, table.departureAt),
    index('trip_plans_transport_file_idx').on(table.institutionId, table.transportFileId),
    index('trip_plans_paid_activity_idx').on(table.institutionId, table.paidActivityId),
  ],
)

/**
 * Gezinin görevli öğretmenleri (K-366): kurumun öğretmen ya da yönetici üyeliği; sorumlu ve
 * görevli. Düzeltmede liste bütün olarak değişir: eski satırlar arşivlenir (silinmez), yeniler
 * eklenir. Etkin satırlarda aynı üyelik planda bir kez bulunur.
 */
export const tripPlanStaff = pgTable(
  'trip_plan_staff',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    planId: uuid('plan_id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    role: text('role').$type<TripStaffRole>().notNull(),
    position: integer('position').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_plan_staff_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'trip_plan_staff_plan_fkey',
      columns: [table.institutionId, table.planId],
      foreignColumns: [tripPlans.institutionId, tripPlans.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'trip_plan_staff_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('trip_plan_staff_role_check', oneOf(table.role, TRIP_STAFF_ROLES)),
    check('trip_plan_staff_position_check', sql`${table.position} >= 0`),
    uniqueIndex('trip_plan_staff_member_key')
      .on(table.institutionId, table.planId, table.membershipId)
      .where(sql`${table.archivedAt} is null`),
    index('trip_plan_staff_plan_idx').on(table.institutionId, table.planId, table.position),
    index('trip_plan_staff_membership_idx').on(table.institutionId, table.membershipId),
  ],
)

/**
 * Plan geçmişi (K-367): taslak, onaya gönderme, onay, ret, yeniden açma, bildirim işareti,
 * tamamlama ve iptal birer satırdır (kim, ne zaman, not). Satır yalnız eklenir.
 */
export const tripPlanEvents = pgTable(
  'trip_plan_events',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    planId: uuid('plan_id').notNull(),
    event: text('event').$type<TripPlanEvent>().notNull(),
    fromStatus: text('from_status').$type<TripPlanStatus>(),
    toStatus: text('to_status').$type<TripPlanStatus>().notNull(),
    note: text('note'),
    // kvkk: K
    actorUserId: text('actor_user_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_plan_events_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'trip_plan_events_plan_fkey',
      columns: [table.institutionId, table.planId],
      foreignColumns: [tripPlans.institutionId, tripPlans.id],
    }).onDelete('restrict'),
    check('trip_plan_events_event_check', oneOf(table.event, TRIP_PLAN_EVENTS)),
    check(
      'trip_plan_events_status_check',
      sql`${oneOf(table.toStatus, TRIP_PLAN_STATUSES)}
        and (${table.fromStatus} is null or ${oneOf(table.fromStatus, TRIP_PLAN_STATUSES)})
        and ((${table.event} = 'created') = (${table.fromStatus} is null))`,
    ),
    check(
      'trip_plan_events_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(TRIP_NOTE_MAX)}`,
    ),
    index('trip_plan_events_plan_idx').on(table.institutionId, table.planId, table.occurredAt),
  ],
)
