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
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  TRANSPORT_DIRECTIONS,
  type TransportDirection,
} from '@kampus/school-core/lib/finance-transport.ts'
import {
  TRANSPORT_CORRECTION_REASON_MAX,
  TRANSPORT_CORRECTION_REASON_MIN,
  TRANSPORT_MARK_STATUSES,
  TRANSPORT_TRIP_STATUSES,
  type TransportMarkStatus,
  type TransportTripStatus,
} from '@kampus/school-core/lib/finance-transport-trips.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { transportRoutes, transportStops, transportVehicles } from './finance-transport.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Servis seferi (DOM-FIN-149; ON-145; K-502): güzergâh × gün (Europe/Istanbul) × yön. Aynı
 * güzergâhın aynı gün ve yönde tek seferi olur (kısmi tekil indeks). Araç başlatma anındaki
 * araçtır (güzergâhın aracı sonra değişse de sefer kaydı değişmez). Kapanan sefer yeniden açılmaz;
 * kapanış kim ve ne zaman bilgisini taşır. Konum verisi tutulmaz.
 */
export const transportTrips = pgTable(
  'transport_trips',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    routeId: uuid('route_id').notNull(),
    direction: text('direction').$type<TransportDirection>().notNull(),
    vehicleId: uuid('vehicle_id').notNull(),
    tripDate: date('trip_date', { mode: 'string' }).notNull(),
    status: text('status').$type<TransportTripStatus>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    // kvkk: K
    startedByUserId: text('started_by_user_id').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // kvkk: K
    closedByUserId: text('closed_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'transport_trips_pkey', columns: [table.institutionId, table.id] }),
    // İşaret tablosunun "durak bu seferin güzergâhında" bağı için (kurum, kimlik, güzergâh) tekildir.
    unique('transport_trips_route_key').on(table.institutionId, table.id, table.routeId),
    foreignKey({
      name: 'transport_trips_route_fkey',
      columns: [table.institutionId, table.routeId, table.direction],
      foreignColumns: [
        transportRoutes.institutionId,
        transportRoutes.id,
        transportRoutes.direction,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'transport_trips_vehicle_fkey',
      columns: [table.institutionId, table.vehicleId],
      foreignColumns: [transportVehicles.institutionId, transportVehicles.id],
    }).onDelete('restrict'),
    check('transport_trips_direction_check', oneOf(table.direction, TRANSPORT_DIRECTIONS)),
    check('transport_trips_status_check', oneOf(table.status, TRANSPORT_TRIP_STATUSES)),
    check(
      'transport_trips_closed_check',
      sql`(${table.status} = 'closed') = (${table.closedAt} is not null) and (${table.closedAt} is null) = (${table.closedByUserId} is null)`,
    ),
    uniqueIndex('transport_trips_route_day_key')
      .on(table.institutionId, table.routeId, table.tripDate, table.direction)
      .where(sql`${table.archivedAt} is null`),
    index('transport_trips_day_idx').on(table.institutionId, table.tripDate),
    index('transport_trips_vehicle_idx').on(table.institutionId, table.vehicleId),
  ],
)

/**
 * Öğrencinin seferdeki biniş-iniş işareti (DOM-FIN-149; K-502, K-503): bindi (saat), indi (biniş
 * ve iniş saati) ya da gelmedi. Seferde öğrenci başına tek satır; durak işaret anındaki
 * atamasının durağıdır ve seferin güzergâhında olmalıdır (bileşik yabancı anahtar). Saat tutarlılığı
 * kısıtla korunur. Konum ve biyometri tutulmaz. `student_id` `records` kimliğidir.
 */
export const transportTripMarks = pgTable(
  'transport_trip_marks',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    tripId: uuid('trip_id').notNull(),
    routeId: uuid('route_id').notNull(),
    stopId: uuid('stop_id').notNull(),
    // kvkk: K (öğrenci)
    studentId: text('student_id').notNull(),
    status: text('status').$type<TransportMarkStatus>().notNull(),
    // kvkk: K (öğrencinin biniş anı)
    boardedAt: timestamp('boarded_at', { withTimezone: true }),
    // kvkk: K (öğrencinin iniş anı)
    alightedAt: timestamp('alighted_at', { withTimezone: true }),
    // kvkk: K
    markedByUserId: text('marked_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'transport_trip_marks_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'transport_trip_marks_trip_fkey',
      columns: [table.institutionId, table.tripId, table.routeId],
      foreignColumns: [transportTrips.institutionId, transportTrips.id, transportTrips.routeId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'transport_trip_marks_stop_fkey',
      columns: [table.institutionId, table.routeId, table.stopId],
      foreignColumns: [transportStops.institutionId, transportStops.routeId, transportStops.id],
    }).onDelete('restrict'),
    check('transport_trip_marks_status_check', oneOf(table.status, TRANSPORT_MARK_STATUSES)),
    check(
      'transport_trip_marks_times_check',
      sql`(${table.status} = 'absent' and ${table.boardedAt} is null and ${table.alightedAt} is null) or (${table.status} = 'boarded' and ${table.boardedAt} is not null and ${table.alightedAt} is null) or (${table.status} = 'alighted' and ${table.boardedAt} is not null and ${table.alightedAt} >= ${table.boardedAt})`,
    ),
    uniqueIndex('transport_trip_marks_student_key')
      .on(table.institutionId, table.tripId, table.studentId)
      .where(sql`${table.archivedAt} is null`),
    index('transport_trip_marks_trip_idx').on(table.institutionId, table.tripId, table.routeId),
    index('transport_trip_marks_stop_idx').on(table.institutionId, table.routeId, table.stopId),
    index('transport_trip_marks_student_idx').on(table.institutionId, table.studentId),
  ],
)

/**
 * Kapanmış seferin yönetici düzeltmesi (DOM-FIN-149; K-503): önceki ve yeni işaret, gerekçe,
 * düzelten ve an. Yalnız eklenir (depo güncelleme sunmaz); denetim kaydı alan adlarını, bu tablo
 * gerekçeyi tutar.
 */
export const transportTripMarkCorrections = pgTable(
  'transport_trip_mark_corrections',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    markId: uuid('mark_id').notNull(),
    previousStatus: text('previous_status').$type<TransportMarkStatus>().notNull(),
    // kvkk: K
    previousBoardedAt: timestamp('previous_boarded_at', { withTimezone: true }),
    // kvkk: K
    previousAlightedAt: timestamp('previous_alighted_at', { withTimezone: true }),
    status: text('status').$type<TransportMarkStatus>().notNull(),
    // kvkk: K
    boardedAt: timestamp('boarded_at', { withTimezone: true }),
    // kvkk: K
    alightedAt: timestamp('alighted_at', { withTimezone: true }),
    // kvkk: K (serbest metin)
    reason: text('reason').notNull(),
    // kvkk: K
    correctedByUserId: text('corrected_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'transport_trip_mark_corrections_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'transport_trip_mark_corrections_mark_fkey',
      columns: [table.institutionId, table.markId],
      foreignColumns: [transportTripMarks.institutionId, transportTripMarks.id],
    }).onDelete('restrict'),
    check(
      'transport_trip_mark_corrections_status_check',
      sql`${oneOf(table.status, TRANSPORT_MARK_STATUSES)} and ${oneOf(table.previousStatus, TRANSPORT_MARK_STATUSES)}`,
    ),
    check(
      'transport_trip_mark_corrections_reason_check',
      sql`char_length(${table.reason}) between ${n(TRANSPORT_CORRECTION_REASON_MIN)} and ${n(TRANSPORT_CORRECTION_REASON_MAX)}`,
    ),
    index('transport_trip_mark_corrections_mark_idx').on(table.institutionId, table.markId),
  ],
)
