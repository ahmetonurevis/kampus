import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import type { TransportDirection } from '@kampus/school-core/lib/finance-transport.ts'
import type {
  TransportMarkStatus,
  TransportTripStatus,
} from '@kampus/school-core/lib/finance-transport-trips.ts'

import type { Database } from './client.ts'
import { transportRoutes, transportStops, transportVehicles } from './schema/finance-transport.ts'
import {
  transportTripMarkCorrections,
  transportTripMarks,
  transportTrips,
} from './schema/finance-transport-trips.ts'

/**
 * Servis seferi, biniş-iniş işareti ve düzeltme deposu (DOM-FIN-149; ON-145). Kurum kapsamlıdır:
 * ilk parametre `institutionId`; arşivli satırlar okunmaz. Kural core
 * `lib/finance-transport-trips.ts`'tedir; depo yalnız okur ve yazar. Düzeltme satırı yalnız
 * eklenir (güncelleme yok).
 */

export interface StoredTrip {
  id: string
  routeId: string
  direction: TransportDirection
  vehicleId: string
  tripDate: string
  status: TransportTripStatus
  startedAt: Date
  closedAt: Date | null
  version: number
}

export interface StoredTripMark {
  id: string
  tripId: string
  stopId: string
  studentId: string
  status: TransportMarkStatus
  boardedAt: Date | null
  alightedAt: Date | null
  version: number
}

export interface StoredTripCorrection {
  markId: string
  reason: string
  createdAt: Date
}

const TRIP = {
  id: transportTrips.id,
  routeId: transportTrips.routeId,
  direction: transportTrips.direction,
  vehicleId: transportTrips.vehicleId,
  tripDate: transportTrips.tripDate,
  status: transportTrips.status,
  startedAt: transportTrips.startedAt,
  closedAt: transportTrips.closedAt,
  version: transportTrips.version,
}
const MARK = {
  id: transportTripMarks.id,
  tripId: transportTripMarks.tripId,
  stopId: transportTripMarks.stopId,
  studentId: transportTripMarks.studentId,
  status: transportTripMarks.status,
  boardedAt: transportTripMarks.boardedAt,
  alightedAt: transportTripMarks.alightedAt,
  version: transportTripMarks.version,
}

const liveTrips = (institutionId: string) =>
  and(eq(transportTrips.institutionId, institutionId), isNull(transportTrips.archivedAt))
const liveMarks = (institutionId: string) =>
  and(eq(transportTripMarks.institutionId, institutionId), isNull(transportTripMarks.archivedAt))

// --- Sefer ---------------------------------------------------------------------------------------

export async function findTrip(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredTrip | null> {
  const [row] = await db
    .select(TRIP)
    .from(transportTrips)
    .where(and(liveTrips(institutionId), eq(transportTrips.id, id)))
    .limit(1)
  return row ?? null
}

/** Günün seferleri (isteğe bağlı güzergâh süzgeciyle). */
export function tripsOnDate(
  db: Database,
  institutionId: string,
  tripDate: string,
  routeIds?: readonly string[],
): Promise<StoredTrip[]> {
  if (routeIds !== undefined && routeIds.length === 0) return Promise.resolve([])
  return db
    .select(TRIP)
    .from(transportTrips)
    .where(
      and(
        liveTrips(institutionId),
        eq(transportTrips.tripDate, tripDate),
        routeIds === undefined
          ? undefined
          : inArray(transportTrips.routeId, [...new Set(routeIds)]),
      ),
    )
    .orderBy(asc(transportTrips.routeId))
}

export async function insertTrip(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    routeId: string
    direction: TransportDirection
    vehicleId: string
    tripDate: string
    userId: string
    now: Date
  },
) {
  await tx.insert(transportTrips).values({
    institutionId,
    id: input.id,
    routeId: input.routeId,
    direction: input.direction,
    vehicleId: input.vehicleId,
    tripDate: input.tripDate,
    status: 'open',
    startedAt: input.now,
    startedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Seferi kapatır; sürüm tutmazsa ya da sefer açık değilse `false` (409). */
export async function closeTrip(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(transportTrips)
    .set({
      status: 'closed',
      closedAt: input.now,
      closedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        liveTrips(institutionId),
        eq(transportTrips.id, input.id),
        eq(transportTrips.status, 'open'),
        eq(transportTrips.version, input.expectedVersion),
      ),
    )
    .returning({ id: transportTrips.id })
  return rows.length === 1
}

/**
 * Güzergâh adları ve yönleri, arşivli güzergâh dahil (geçmiş seferin güzergâhı sonradan
 * arşivlenmiş olabilir).
 */
export async function routeLabels(
  db: Database,
  institutionId: string,
  routeIds: readonly string[],
): Promise<Map<string, { name: string; direction: TransportDirection; vehicleId: string }>> {
  if (routeIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: transportRoutes.id,
      name: transportRoutes.name,
      direction: transportRoutes.direction,
      vehicleId: transportRoutes.vehicleId,
    })
    .from(transportRoutes)
    .where(
      and(
        eq(transportRoutes.institutionId, institutionId),
        inArray(transportRoutes.id, [...new Set(routeIds)]),
      ),
    )
  return new Map(rows.map(({ id, ...row }) => [id, row]))
}

/** Kurumun etkin güzergâhları (sefer özeti; güzergâh sayısı küçüktür, sayfalama serviste). */
export function liveRouteRows(
  db: Database,
  institutionId: string,
  direction?: TransportDirection,
): Promise<{ id: string; name: string; direction: TransportDirection; vehicleId: string }[]> {
  return db
    .select({
      id: transportRoutes.id,
      name: transportRoutes.name,
      direction: transportRoutes.direction,
      vehicleId: transportRoutes.vehicleId,
    })
    .from(transportRoutes)
    .where(
      and(
        eq(transportRoutes.institutionId, institutionId),
        isNull(transportRoutes.archivedAt),
        direction === undefined ? undefined : eq(transportRoutes.direction, direction),
      ),
    )
}

/** Durak adı, sırası ve saati, arşivli durak dahil (işaretin durağı sonradan kaldırılmış olabilir). */
export async function stopLabels(
  db: Database,
  institutionId: string,
  stopIds: readonly string[],
): Promise<Map<string, { name: string; position: number; time: string }>> {
  if (stopIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: transportStops.id,
      name: transportStops.name,
      position: transportStops.position,
      time: transportStops.stopTime,
    })
    .from(transportStops)
    .where(
      and(
        eq(transportStops.institutionId, institutionId),
        inArray(transportStops.id, [...new Set(stopIds)]),
      ),
    )
  return new Map(rows.map(({ id, ...row }) => [id, row]))
}

/** Araç plakası ve rehberi, arşivli araç dahil (seferin aracı başlatma anındaki araçtır). */
export async function vehicleLabels(
  db: Database,
  institutionId: string,
  vehicleIds: readonly string[],
): Promise<Map<string, { plate: string; guideMembershipId: string | null; archived: boolean }>> {
  if (vehicleIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: transportVehicles.id,
      plate: transportVehicles.plate,
      guideMembershipId: transportVehicles.guideMembershipId,
      archivedAt: transportVehicles.archivedAt,
    })
    .from(transportVehicles)
    .where(
      and(
        eq(transportVehicles.institutionId, institutionId),
        inArray(transportVehicles.id, [...new Set(vehicleIds)]),
      ),
    )
  return new Map(
    rows.map((row) => [
      row.id,
      {
        plate: row.plate,
        guideMembershipId: row.guideMembershipId,
        archived: row.archivedAt !== null,
      },
    ]),
  )
}

// --- İşaret --------------------------------------------------------------------------------------

/** Seferlerin işaretleri. */
export async function loadTripMarks(
  db: Database,
  institutionId: string,
  tripIds: readonly string[],
): Promise<StoredTripMark[]> {
  if (tripIds.length === 0) return []
  return db
    .select(MARK)
    .from(transportTripMarks)
    .where(and(liveMarks(institutionId), inArray(transportTripMarks.tripId, [...new Set(tripIds)])))
    .orderBy(asc(transportTripMarks.tripId), asc(transportTripMarks.id))
}

/** Öğrencilerin verilen seferlerdeki işaretleri (veli görünümü). */
export async function loadStudentTripMarks(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
  tripIds: readonly string[],
): Promise<StoredTripMark[]> {
  if (studentIds.length === 0 || tripIds.length === 0) return []
  return db
    .select(MARK)
    .from(transportTripMarks)
    .where(
      and(
        liveMarks(institutionId),
        inArray(transportTripMarks.studentId, [...new Set(studentIds)]),
        inArray(transportTripMarks.tripId, [...new Set(tripIds)]),
      ),
    )
}

export async function insertTripMark(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    tripId: string
    routeId: string
    stopId: string
    studentId: string
    status: TransportMarkStatus
    boardedAt: Date | null
    alightedAt: Date | null
    userId: string
    now: Date
  },
) {
  const { userId, now, ...values } = input
  await tx.insert(transportTripMarks).values({
    ...values,
    institutionId,
    markedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
}

/** İşareti günceller; sürüm tutmazsa `false` (409). */
export async function updateTripMark(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    status: TransportMarkStatus
    boardedAt: Date | null
    alightedAt: Date | null
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(transportTripMarks)
    .set({
      status: input.status,
      boardedAt: input.boardedAt,
      alightedAt: input.alightedAt,
      markedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        liveMarks(institutionId),
        eq(transportTripMarks.id, input.id),
        eq(transportTripMarks.version, input.expectedVersion),
      ),
    )
    .returning({ id: transportTripMarks.id })
  return rows.length === 1
}

// --- Düzeltme ------------------------------------------------------------------------------------

export async function insertTripCorrection(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    markId: string
    previous: { status: TransportMarkStatus; boardedAt: Date | null; alightedAt: Date | null }
    next: { status: TransportMarkStatus; boardedAt: Date | null; alightedAt: Date | null }
    reason: string
    userId: string
    now: Date
  },
) {
  await tx.insert(transportTripMarkCorrections).values({
    institutionId,
    id: input.id,
    markId: input.markId,
    previousStatus: input.previous.status,
    previousBoardedAt: input.previous.boardedAt,
    previousAlightedAt: input.previous.alightedAt,
    status: input.next.status,
    boardedAt: input.next.boardedAt,
    alightedAt: input.next.alightedAt,
    reason: input.reason,
    correctedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** İşaretlerin son düzeltmesi (gerekçe ve an). */
export async function latestTripCorrections(
  db: Database,
  institutionId: string,
  markIds: readonly string[],
): Promise<Map<string, StoredTripCorrection>> {
  if (markIds.length === 0) return new Map()
  const rows = await db
    .select({
      markId: transportTripMarkCorrections.markId,
      reason: transportTripMarkCorrections.reason,
      createdAt: transportTripMarkCorrections.createdAt,
    })
    .from(transportTripMarkCorrections)
    .where(
      and(
        eq(transportTripMarkCorrections.institutionId, institutionId),
        isNull(transportTripMarkCorrections.archivedAt),
        inArray(transportTripMarkCorrections.markId, [...new Set(markIds)]),
      ),
    )
    .orderBy(asc(transportTripMarkCorrections.createdAt), asc(transportTripMarkCorrections.id))
  // Sıralı okunur; aynı işaretin sonraki düzeltmesi öncekinin yerine geçer.
  return new Map(rows.map((row) => [row.markId, row]))
}
