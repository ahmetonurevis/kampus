import { and, asc, count, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm'

import type { TransportDirection } from '@kampus/school-core/lib/finance-transport.ts'

import type { Database } from './client.ts'
import {
  transportAssignments,
  transportRoutes,
  transportStops,
  transportVehicles,
} from './schema/finance-transport.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Servis aracı, güzergâh, durak ve atama deposu (DOM-FIN-142; ON-098). Kurum kapsamlıdır: ilk
 * parametre `institutionId`; arşivli satırlar okunmaz. Kural core `lib/finance-transport.ts`'tedir;
 * depo yalnız okur ve yazar. Sürücü telefonu depodan çıkar, maskeyi servis uygular (K-481).
 */

export interface StoredVehicle {
  id: string
  plate: string
  capacity: number
  driverName: string
  driverPhone: string
  guideMembershipId: string | null
  version: number
}

export interface StoredRoute {
  id: string
  name: string
  direction: TransportDirection
  vehicleId: string
  version: number
}

export interface StoredTransportStop {
  id: string
  routeId: string
  position: number
  name: string
  time: string
}

export interface StoredAssignment {
  id: string
  routeId: string
  stopId: string
  direction: TransportDirection
  studentId: string
  version: number
}

const VEHICLE = {
  id: transportVehicles.id,
  plate: transportVehicles.plate,
  capacity: transportVehicles.capacity,
  driverName: transportVehicles.driverName,
  driverPhone: transportVehicles.driverPhone,
  guideMembershipId: transportVehicles.guideMembershipId,
  version: transportVehicles.version,
}
const ROUTE = {
  id: transportRoutes.id,
  name: transportRoutes.name,
  direction: transportRoutes.direction,
  vehicleId: transportRoutes.vehicleId,
  version: transportRoutes.version,
}
const STOP = {
  id: transportStops.id,
  routeId: transportStops.routeId,
  position: transportStops.position,
  name: transportStops.name,
  time: transportStops.stopTime,
}
const ASSIGNMENT = {
  id: transportAssignments.id,
  routeId: transportAssignments.routeId,
  stopId: transportAssignments.stopId,
  direction: transportAssignments.direction,
  studentId: transportAssignments.studentId,
  version: transportAssignments.version,
}

const liveVehicles = (institutionId: string) =>
  and(eq(transportVehicles.institutionId, institutionId), isNull(transportVehicles.archivedAt))
const liveRoutes = (institutionId: string) =>
  and(eq(transportRoutes.institutionId, institutionId), isNull(transportRoutes.archivedAt))
const liveStops = (institutionId: string) =>
  and(eq(transportStops.institutionId, institutionId), isNull(transportStops.archivedAt))
const liveAssignments = (institutionId: string) =>
  and(
    eq(transportAssignments.institutionId, institutionId),
    isNull(transportAssignments.archivedAt),
  )
const search = (
  column: typeof transportVehicles.plate | typeof transportRoutes.name,
  q?: string,
) => (q === undefined ? undefined : sql`strpos(${foldSql(column)}, ${foldSearch(q)}) > 0`)

// --- Araç ----------------------------------------------------------------------------------------

export async function findVehicle(db: Database, institutionId: string, id: string) {
  const [row] = await db
    .select(VEHICLE)
    .from(transportVehicles)
    .where(and(liveVehicles(institutionId), eq(transportVehicles.id, id)))
    .limit(1)
  return row ?? null
}

export async function loadVehicles(db: Database, institutionId: string, ids: readonly string[]) {
  if (ids.length === 0) return []
  return db
    .select(VEHICLE)
    .from(transportVehicles)
    .where(and(liveVehicles(institutionId), inArray(transportVehicles.id, [...new Set(ids)])))
}

/** Plaka başka etkin araçta mı (`exceptId` hariç). */
export async function plateTaken(
  db: Database,
  institutionId: string,
  plate: string,
  exceptId?: string,
) {
  const [row] = await db
    .select({ id: transportVehicles.id })
    .from(transportVehicles)
    .where(
      and(
        liveVehicles(institutionId),
        eq(transportVehicles.plate, plate),
        exceptId === undefined ? undefined : ne(transportVehicles.id, exceptId),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function listVehicles(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; q?: string | undefined },
): Promise<{ items: StoredVehicle[]; total: number }> {
  const where = and(liveVehicles(institutionId), search(transportVehicles.plate, query.q))
  const [totalRow] = await db.select({ total: count() }).from(transportVehicles).where(where)
  const items = await db
    .select(VEHICLE)
    .from(transportVehicles)
    .where(where)
    .orderBy(asc(transportVehicles.plate), asc(transportVehicles.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

export async function insertVehicle(
  tx: Database,
  institutionId: string,
  input: Omit<StoredVehicle, 'version'> & { createdByUserId: string; now: Date },
) {
  const { now, ...values } = input
  await tx
    .insert(transportVehicles)
    .values({ ...values, institutionId, createdAt: now, updatedAt: now })
}

/** Araç düzenleme ya da arşivi; sürüm tutmazsa `false` (409). */
export async function updateVehicle(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<Omit<StoredVehicle, 'id' | 'version'> & { archivedAt: Date }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(transportVehicles)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        liveVehicles(institutionId),
        eq(transportVehicles.id, input.id),
        eq(transportVehicles.version, input.expectedVersion),
      ),
    )
    .returning({ id: transportVehicles.id })
  return rows.length === 1
}

// --- Güzergâh ------------------------------------------------------------------------------------

export async function findRoute(db: Database, institutionId: string, id: string) {
  const [row] = await db
    .select(ROUTE)
    .from(transportRoutes)
    .where(and(liveRoutes(institutionId), eq(transportRoutes.id, id)))
    .limit(1)
  return row ?? null
}

export async function loadRoutes(db: Database, institutionId: string, ids: readonly string[]) {
  if (ids.length === 0) return []
  return db
    .select(ROUTE)
    .from(transportRoutes)
    .where(and(liveRoutes(institutionId), inArray(transportRoutes.id, [...new Set(ids)])))
}

/** Aracın etkin güzergâhları. */
export function vehicleRoutes(db: Database, institutionId: string, vehicleId: string) {
  return db
    .select(ROUTE)
    .from(transportRoutes)
    .where(and(liveRoutes(institutionId), eq(transportRoutes.vehicleId, vehicleId)))
}

/** Ad aynı yönde başka etkin güzergâhta mı. */
export async function routeNameTaken(
  db: Database,
  institutionId: string,
  input: { name: string; direction: TransportDirection; exceptId?: string },
) {
  const [row] = await db
    .select({ id: transportRoutes.id })
    .from(transportRoutes)
    .where(
      and(
        liveRoutes(institutionId),
        eq(transportRoutes.direction, input.direction),
        eq(transportRoutes.name, input.name),
        input.exceptId === undefined ? undefined : ne(transportRoutes.id, input.exceptId),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function listRoutes(
  db: Database,
  institutionId: string,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    direction?: TransportDirection | undefined
    vehicleId?: string | undefined
  },
): Promise<{ items: StoredRoute[]; total: number }> {
  const filters: (SQL | undefined)[] = [
    liveRoutes(institutionId),
    search(transportRoutes.name, query.q),
    query.direction === undefined ? undefined : eq(transportRoutes.direction, query.direction),
    query.vehicleId === undefined ? undefined : eq(transportRoutes.vehicleId, query.vehicleId),
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(transportRoutes).where(where)
  const items = await db
    .select(ROUTE)
    .from(transportRoutes)
    .where(where)
    .orderBy(asc(transportRoutes.direction), asc(transportRoutes.name), asc(transportRoutes.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

export async function insertRoute(
  tx: Database,
  institutionId: string,
  input: Omit<StoredRoute, 'version'> & { createdByUserId: string; now: Date },
) {
  const { now, ...values } = input
  await tx
    .insert(transportRoutes)
    .values({ ...values, institutionId, createdAt: now, updatedAt: now })
}

export async function updateRoute(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<{ name: string; vehicleId: string; archivedAt: Date }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(transportRoutes)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        liveRoutes(institutionId),
        eq(transportRoutes.id, input.id),
        eq(transportRoutes.version, input.expectedVersion),
      ),
    )
    .returning({ id: transportRoutes.id })
  return rows.length === 1
}

// --- Durak ---------------------------------------------------------------------------------------

/** Güzergâhların etkin durakları, sıraya göre. */
export async function loadStops(
  db: Database,
  institutionId: string,
  routeIds: readonly string[],
): Promise<StoredTransportStop[]> {
  if (routeIds.length === 0) return []
  return db
    .select(STOP)
    .from(transportStops)
    .where(and(liveStops(institutionId), inArray(transportStops.routeId, [...new Set(routeIds)])))
    .orderBy(asc(transportStops.routeId), asc(transportStops.position), asc(transportStops.id))
}

export async function insertStops(
  tx: Database,
  institutionId: string,
  routeId: string,
  stops: readonly { id: string; name: string; time: string; position: number }[],
  now: Date,
) {
  if (stops.length === 0) return
  await tx.insert(transportStops).values(
    stops.map((stop) => ({
      institutionId,
      id: stop.id,
      routeId,
      position: stop.position,
      name: stop.name,
      stopTime: stop.time,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

export async function updateStop(
  tx: Database,
  institutionId: string,
  input: { id: string; name: string; time: string; position: number; now: Date },
) {
  await tx
    .update(transportStops)
    .set({
      name: input.name,
      stopTime: input.time,
      position: input.position,
      updatedAt: input.now,
      version: sql`${transportStops.version} + 1`,
    })
    .where(and(liveStops(institutionId), eq(transportStops.id, input.id)))
}

export async function archiveStops(
  tx: Database,
  institutionId: string,
  ids: readonly string[],
  now: Date,
) {
  if (ids.length === 0) return
  await tx
    .update(transportStops)
    .set({ archivedAt: now, updatedAt: now, version: sql`${transportStops.version} + 1` })
    .where(and(liveStops(institutionId), inArray(transportStops.id, [...ids])))
}

// --- Atama ---------------------------------------------------------------------------------------

export async function findAssignment(db: Database, institutionId: string, id: string) {
  const [row] = await db
    .select(ASSIGNMENT)
    .from(transportAssignments)
    .where(and(liveAssignments(institutionId), eq(transportAssignments.id, id)))
    .limit(1)
  return row ?? null
}

/** Güzergâhların etkin atamaları. */
export async function loadRouteAssignments(
  db: Database,
  institutionId: string,
  routeIds: readonly string[],
): Promise<StoredAssignment[]> {
  if (routeIds.length === 0) return []
  return db
    .select(ASSIGNMENT)
    .from(transportAssignments)
    .where(
      and(
        liveAssignments(institutionId),
        inArray(transportAssignments.routeId, [...new Set(routeIds)]),
      ),
    )
    .orderBy(asc(transportAssignments.createdAt), asc(transportAssignments.id))
}

/** Öğrencilerin etkin atamaları (veli ve öğrenci görünümü, aynı yön denetimi). */
export async function loadStudentAssignments(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<StoredAssignment[]> {
  if (studentIds.length === 0) return []
  return db
    .select(ASSIGNMENT)
    .from(transportAssignments)
    .where(
      and(
        liveAssignments(institutionId),
        inArray(transportAssignments.studentId, [...new Set(studentIds)]),
      ),
    )
    .orderBy(asc(transportAssignments.direction), asc(transportAssignments.id))
}

/** Güzergâh başına etkin atama sayısı. */
export async function routeLoads(
  db: Database,
  institutionId: string,
  routeIds: readonly string[],
): Promise<Map<string, number>> {
  if (routeIds.length === 0) return new Map()
  const rows = await db
    .select({ routeId: transportAssignments.routeId, total: count() })
    .from(transportAssignments)
    .where(
      and(
        liveAssignments(institutionId),
        inArray(transportAssignments.routeId, [...new Set(routeIds)]),
      ),
    )
    .groupBy(transportAssignments.routeId)
  return new Map(rows.map((row) => [row.routeId, row.total]))
}

export async function insertAssignment(
  tx: Database,
  institutionId: string,
  input: Omit<StoredAssignment, 'version'> & { createdByUserId: string; now: Date },
) {
  const { now, ...values } = input
  await tx
    .insert(transportAssignments)
    .values({ ...values, institutionId, createdAt: now, updatedAt: now })
}

/** Atamayı kaldırır (arşiv); sürüm tutmazsa `false` (409). */
export async function removeAssignment(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(transportAssignments)
    .set({
      archivedAt: input.now,
      removedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        liveAssignments(institutionId),
        eq(transportAssignments.id, input.id),
        eq(transportAssignments.version, input.expectedVersion),
      ),
    )
    .returning({ id: transportAssignments.id })
  return rows.length === 1
}
