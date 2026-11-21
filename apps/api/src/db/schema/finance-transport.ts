import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  TRANSPORT_DIRECTIONS,
  TRANSPORT_DRIVER_NAME_MAX,
  TRANSPORT_ROUTE_NAME_MAX,
  TRANSPORT_ROUTE_STOPS_MAX,
  TRANSPORT_STOP_NAME_MAX,
  TRANSPORT_VEHICLE_CAPACITY_MAX,
  type TransportDirection,
} from '@kampus/school-core/lib/finance-transport.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))
const TIME_CHECK = sql.raw(`'^([01][0-9]|2[0-3]):[0-5][0-9]$'`)

/**
 * Servis aracı (DOM-FIN-142; ON-098; K-481). Plaka boşluksuz büyük harfle ve kurumda arşivlenmemiş
 * araçlar arasında tekildir. Sürücü adı ve telefonu kişisel veridir: telefon yalnız yazılır,
 * yanıtlarda maskeli döner. Rehber personel mevcut kurum üyeliğidir (personel tablosu yok).
 * Arşiv = `archived_at`.
 */
export const transportVehicles = pgTable(
  'transport_vehicles',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    plate: text('plate').notNull(),
    capacity: integer('capacity').notNull(),
    // kvkk: K (sürücü kimliği)
    driverName: text('driver_name').notNull(),
    // kvkk: K (sürücü iletişimi)
    driverPhone: text('driver_phone').notNull(),
    // kvkk: K (personel üyeliği)
    guideMembershipId: text('guide_membership_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'transport_vehicles_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'transport_vehicles_guide_fkey',
      columns: [table.institutionId, table.guideMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'transport_vehicles_plate_check',
      sql`${table.plate} ~ '^(0[1-9]|[1-7][0-9]|8[01])[A-Z]{1,3}[0-9]{2,5}$'`,
    ),
    check(
      'transport_vehicles_capacity_check',
      sql`${table.capacity} between 1 and ${n(TRANSPORT_VEHICLE_CAPACITY_MAX)}`,
    ),
    check(
      'transport_vehicles_driver_name_check',
      sql`char_length(${table.driverName}) between 2 and ${n(TRANSPORT_DRIVER_NAME_MAX)}`,
    ),
    check('transport_vehicles_driver_phone_check', sql`${table.driverPhone} ~ '^0[0-9]{10}$'`),
    uniqueIndex('transport_vehicles_plate_key')
      .on(table.institutionId, table.plate)
      .where(sql`${table.archivedAt} is null`),
    index('transport_vehicles_guide_idx').on(table.institutionId, table.guideMembershipId),
  ],
)

/**
 * Servis güzergâhı (DOM-FIN-142; K-481): ad, yön (sabah/akşam; sonradan değişmez) ve araç. Ad aynı
 * yönde arşivlenmemiş güzergâhlar arasında tekildir. Arşiv = `archived_at`.
 */
export const transportRoutes = pgTable(
  'transport_routes',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    direction: text('direction').$type<TransportDirection>().notNull(),
    vehicleId: uuid('vehicle_id').notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'transport_routes_pkey', columns: [table.institutionId, table.id] }),
    // Atama tablosunun yön bağı için (kurum, kimlik, yön) tekildir.
    unique('transport_routes_direction_key').on(table.institutionId, table.id, table.direction),
    foreignKey({
      name: 'transport_routes_vehicle_fkey',
      columns: [table.institutionId, table.vehicleId],
      foreignColumns: [transportVehicles.institutionId, transportVehicles.id],
    }).onDelete('restrict'),
    check('transport_routes_direction_check', oneOf(table.direction, TRANSPORT_DIRECTIONS)),
    check(
      'transport_routes_name_check',
      sql`char_length(${table.name}) between 2 and ${n(TRANSPORT_ROUTE_NAME_MAX)}`,
    ),
    uniqueIndex('transport_routes_name_key')
      .on(table.institutionId, table.direction, table.name)
      .where(sql`${table.archivedAt} is null`),
    index('transport_routes_vehicle_idx').on(table.institutionId, table.vehicleId),
  ],
)

/**
 * Güzergâh durağı (DOM-FIN-142; K-481): sıra (1'den), durak adı ya da semt ve geçiş saati
 * (SS:DD, Europe/Istanbul). Açık adres tutulmaz (KVKK en az veri; H-105). Listeden çıkan durak
 * arşivlenir; sıra servis kuralıyla tutulur.
 */
export const transportStops = pgTable(
  'transport_stops',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    routeId: uuid('route_id').notNull(),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    stopTime: text('stop_time').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'transport_stops_pkey', columns: [table.institutionId, table.id] }),
    // Atama tablosunun "durak bu güzergâhta" bağı için (kurum, güzergâh, kimlik) tekildir.
    unique('transport_stops_route_key').on(table.institutionId, table.routeId, table.id),
    foreignKey({
      name: 'transport_stops_route_fkey',
      columns: [table.institutionId, table.routeId],
      foreignColumns: [transportRoutes.institutionId, transportRoutes.id],
    }).onDelete('restrict'),
    check(
      'transport_stops_position_check',
      sql`${table.position} between 1 and ${n(TRANSPORT_ROUTE_STOPS_MAX)}`,
    ),
    check(
      'transport_stops_name_check',
      sql`char_length(${table.name}) between 2 and ${n(TRANSPORT_STOP_NAME_MAX)}`,
    ),
    check('transport_stops_time_check', sql`${table.stopTime} ~ ${TIME_CHECK}`),
  ],
)

/**
 * Öğrenci–durak ataması (DOM-FIN-142; K-482). Durak güzergâha, yön güzergâha bileşik yabancı
 * anahtarla bağlıdır; öğrenci aynı yönde tek etkin atamaya sahiptir (kısmi tekil indeks). Araç
 * kapasitesi kurum kilidi altında servis denetimiyle korunur. Kaldırılan atama arşivlenir.
 * `student_id` `records` kimliğidir.
 */
export const transportAssignments = pgTable(
  'transport_assignments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    routeId: uuid('route_id').notNull(),
    stopId: uuid('stop_id').notNull(),
    direction: text('direction').$type<TransportDirection>().notNull(),
    // kvkk: K (öğrenci)
    studentId: text('student_id').notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    // kvkk: K
    removedByUserId: text('removed_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'transport_assignments_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'transport_assignments_route_fkey',
      columns: [table.institutionId, table.routeId, table.direction],
      foreignColumns: [
        transportRoutes.institutionId,
        transportRoutes.id,
        transportRoutes.direction,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'transport_assignments_stop_fkey',
      columns: [table.institutionId, table.routeId, table.stopId],
      foreignColumns: [transportStops.institutionId, transportStops.routeId, transportStops.id],
    }).onDelete('restrict'),
    check('transport_assignments_direction_check', oneOf(table.direction, TRANSPORT_DIRECTIONS)),
    check(
      'transport_assignments_removed_check',
      sql`(${table.archivedAt} is null) = (${table.removedByUserId} is null)`,
    ),
    uniqueIndex('transport_assignments_student_key')
      .on(table.institutionId, table.studentId, table.direction)
      .where(sql`${table.archivedAt} is null`),
    index('transport_assignments_route_idx').on(
      table.institutionId,
      table.routeId,
      table.direction,
    ),
    index('transport_assignments_stop_idx').on(table.institutionId, table.routeId, table.stopId),
  ],
)
