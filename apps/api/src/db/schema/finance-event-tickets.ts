import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
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
  EVENT_CAPACITY_MAX,
  EVENT_PER_STUDENT_LIMIT_MAX,
  EVENT_ROWS_MAX,
  EVENT_SEATING_MODES,
  EVENT_SEATS_PER_ROW_MAX,
  EVENT_TICKET_KINDS,
  EVENT_TICKET_PAYMENT_METHODS,
  EVENT_TICKET_PAYMENT_STATUSES,
  EVENT_TICKET_STATUSES,
  EVENT_TICKET_TYPES_MAX,
  type EventSeatingMode,
  type EventTicketKind,
  type EventTicketPaymentMethod,
  type EventTicketPaymentStatus,
  type EventTicketStatus,
  type EventTicketType,
} from '@kampus/school-core/lib/finance-event-tickets.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Biletli etkinlik (DOM-FIN-103; ON-159; K-325): ad, başlangıç anı, salon, isteğe bağlı okul takvimi
 * etkinliği (`school_event_id`, `records` kimliği, yabancı anahtar değil), oturma düzeni (numaralı
 * salon: sıra × koltuk ve kapalı koltuklar; numarasız: kontenjan), bilet türleri ve öğrenci başına
 * üst sınır. Etkin bileti varken arşivlenmez.
 */
export const ticketedEvents = pgTable(
  'ticketed_events',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    venue: text('venue').notNull(),
    schoolEventId: text('school_event_id'),
    seatingMode: text('seating_mode').$type<EventSeatingMode>().notNull(),
    rowCount: integer('row_count'),
    seatsPerRow: integer('seats_per_row'),
    blockedSeats: text('blocked_seats')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    capacity: integer('capacity'),
    ticketTypes: jsonb('ticket_types').$type<EventTicketType[]>().notNull(),
    perStudentLimit: integer('per_student_limit'),
    salesOpen: boolean('sales_open').notNull().default(true),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'ticketed_events_pkey', columns: [table.institutionId, table.id] }),
    check('ticketed_events_seating_mode_check', oneOf(table.seatingMode, EVENT_SEATING_MODES)),
    check(
      'ticketed_events_layout_check',
      sql`(${table.seatingMode} = 'seated'
          and ${table.rowCount} between 1 and ${n(EVENT_ROWS_MAX)}
          and ${table.seatsPerRow} between 1 and ${n(EVENT_SEATS_PER_ROW_MAX)}
          and ${table.capacity} is null)
        or (${table.seatingMode} = 'general'
          and ${table.capacity} between 1 and ${n(EVENT_CAPACITY_MAX)}
          and ${table.rowCount} is null and ${table.seatsPerRow} is null
          and cardinality(${table.blockedSeats}) = 0)`,
    ),
    check(
      'ticketed_events_ticket_types_check',
      sql`jsonb_typeof(${table.ticketTypes}) = 'array'
        and jsonb_array_length(${table.ticketTypes}) between 1 and ${n(EVENT_TICKET_TYPES_MAX)}`,
    ),
    check(
      'ticketed_events_per_student_limit_check',
      sql`${table.perStudentLimit} is null
        or ${table.perStudentLimit} between 1 and ${n(EVENT_PER_STUDENT_LIMIT_MAX)}`,
    ),
    index('ticketed_events_starts_at_idx').on(table.institutionId, table.startsAt),
  ],
)

/**
 * Etkinlik bileti (DOM-FIN-103; K-325, K-326): öğrencinin ailesine ayrılan, bilet sahibi adını
 * taşıyan bilet. Tür adı, türü ve fiyatı ayırma anında kopyalanır. Koltuk, etkinlikte etkin biletler
 * arasında tekildir (`event_tickets_event_seat_key`, eşzamanlı satışta da). Kod kurumda tekildir ve
 * tahmin edilemez. Bilet silinmez; iptal koltuğu boşa çıkarır.
 */
export const eventTickets = pgTable(
  'event_tickets',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    eventId: uuid('event_id').notNull(),
    code: text('code').notNull(),
    ticketTypeKey: text('ticket_type_key').notNull(),
    ticketTypeName: text('ticket_type_name').notNull(),
    ticketKind: text('ticket_kind').$type<EventTicketKind>().notNull(),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    seat: text('seat'),
    // kvkk: K
    studentId: text('student_id').notNull(),
    // kvkk: K
    holderName: text('holder_name').notNull(),
    status: text('status').$type<EventTicketStatus>().notNull().default('active'),
    paymentStatus: text('payment_status').$type<EventTicketPaymentStatus>().notNull(),
    paymentMethod: text('payment_method').$type<EventTicketPaymentMethod>(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    // kvkk: K
    paidByUserId: text('paid_by_user_id'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    // kvkk: K
    usedByUserId: text('used_by_user_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'event_tickets_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'event_tickets_event_fkey',
      columns: [table.institutionId, table.eventId],
      foreignColumns: [ticketedEvents.institutionId, ticketedEvents.id],
    }).onDelete('restrict'),
    check('event_tickets_kind_check', oneOf(table.ticketKind, EVENT_TICKET_KINDS)),
    check('event_tickets_status_check', oneOf(table.status, EVENT_TICKET_STATUSES)),
    check(
      'event_tickets_payment_status_check',
      oneOf(table.paymentStatus, EVENT_TICKET_PAYMENT_STATUSES),
    ),
    check(
      'event_tickets_payment_method_check',
      sql`${table.paymentMethod} is null or ${oneOf(table.paymentMethod, EVENT_TICKET_PAYMENT_METHODS)}`,
    ),
    check('event_tickets_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'event_tickets_price_check',
      sql`(${table.ticketKind} = 'invitation' and ${table.priceCents} = 0
          and ${table.paymentStatus} = 'not_required')
        or (${table.ticketKind} = 'paid' and ${table.priceCents} > 0
          and ${table.paymentStatus} in ('unpaid', 'paid'))`,
    ),
    check(
      'event_tickets_paid_check',
      sql`(${table.paymentStatus} = 'paid') = (${table.paidAt} is not null)
        and (${table.paidAt} is null) = (${table.paymentMethod} is null)
        and (${table.paidAt} is null) = (${table.paidByUserId} is null)`,
    ),
    check(
      'event_tickets_cancelled_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)
        and (${table.cancelledAt} is null) = (${table.cancelledByUserId} is null)
        and (${table.cancelReason} is null or ${table.cancelledAt} is not null)
        and (${table.refundedAt} is null or (${table.cancelledAt} is not null
          and ${table.paymentStatus} = 'paid'))`,
    ),
    check(
      'event_tickets_used_check',
      sql`(${table.usedAt} is null) = (${table.usedByUserId} is null)
        and (${table.usedAt} is null or ${table.status} = 'active')`,
    ),
    uniqueIndex('event_tickets_code_key').on(table.institutionId, table.code),
    uniqueIndex('event_tickets_event_seat_key')
      .on(table.institutionId, table.eventId, table.seat)
      .where(sql`${table.status} = 'active' and ${table.seat} is not null`),
    index('event_tickets_event_idx').on(table.institutionId, table.eventId),
    index('event_tickets_student_idx').on(table.institutionId, table.studentId),
  ],
)
