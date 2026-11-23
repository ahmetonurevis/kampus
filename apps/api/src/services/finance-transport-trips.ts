import { randomUUID } from 'node:crypto'

import type { TransportDirection } from '@kampus/school-core/lib/finance-transport.ts'
import {
  planTransportTripClose,
  planTransportTripMark,
  planTransportTripStart,
  transportTripAccess,
  transportTripCloseSchema,
  transportTripCounts,
  transportTripMarkSchema,
  transportTripStartSchema,
  type TransportRosterStatus,
  type TransportTripAccess,
  type TransportTripMarkPlan,
} from '@kampus/school-core/lib/finance-transport-trips.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  findRoute,
  findVehicle,
  loadRouteAssignments,
  loadStudentAssignments,
  type StoredAssignment,
} from '../db/finance-transport.ts'
import {
  closeTrip,
  findTrip,
  insertTrip,
  insertTripCorrection,
  insertTripMark,
  latestTripCorrections,
  liveRouteRows,
  loadStudentTripMarks,
  loadTripMarks,
  routeLabels,
  stopLabels,
  tripsOnDate,
  updateTripMark,
  vehicleLabels,
  type StoredTrip,
  type StoredTripMark,
} from '../db/finance-transport-trips.ts'
import { memberNames } from '../db/finance-visitors.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { studentNames } from './finance-transport.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { assertReadable, readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Servis seferi ve biniş-iniş kaydı (DOM-FIN-149; ON-145; IST-144). Kural core
 * `lib/finance-transport-trips.ts`'tedir; servis kurum kilidi altında yükler, aynı transaction'da
 * yazar ve denetime alan adlarını yazar (öğrenci kimliği, saat değeri ve gerekçe denetime
 * yazılmaz; gerekçe düzeltme satırındadır). Rehber kapsamı güzergâhın bugünkü aracının rehberidir
 * (`transportTripAccess`, K-502): okuyamayan rol için sefer yok sayılır (404). Rol ve modül
 * (`finance`, `transport`) denetimi rotadadır; veli ve öğrenci görünümü core kapsamıyla
 * (`transportAssignments`, `scope.studentIds`) daralır.
 */

const TRIP = 'transport_trips'
const MARK = 'transport_trip_marks'

// --- Erişim --------------------------------------------------------------------------------------

/** Güzergâhın bugünkü aracının rehberi (araç arşivliyse rehber yok sayılır). */
async function routeGuide(db: Database, ctx: ServiceContext, vehicleId: string) {
  const vehicle = (await vehicleLabels(db, ctx.institutionId, [vehicleId])).get(vehicleId)
  return vehicle === undefined || vehicle.archived ? null : vehicle.guideMembershipId
}

interface TripScope {
  trip: StoredTrip
  route: { name: string; direction: TransportDirection; vehicleId: string }
  guideMembershipId: string | null
  access: TransportTripAccess
}

/** Sefer ve yetki; sefer yoksa ya da rol okuyamıyorsa 404 (K-502). */
async function tripScope(db: Database, ctx: ServiceContext, tripId: string): Promise<TripScope> {
  const trip = await findTrip(db, ctx.institutionId, tripId)
  if (trip === null) throw new NotFoundError()
  const route = (await routeLabels(db, ctx.institutionId, [trip.routeId])).get(trip.routeId)
  if (route === undefined) throw new NotFoundError()
  const guideMembershipId = await routeGuide(db, ctx, route.vehicleId)
  const access = transportTripAccess(ctx.actor, guideMembershipId)
  if (!access.read) throw new NotFoundError()
  return { trip, route, guideMembershipId, access }
}

// --- Liste (sefer listesi) -----------------------------------------------------------------------

interface RosterEntry {
  studentId: string
  stopId: string
  mark: StoredTripMark | null
}

/**
 * Seferin öğrenci listesi: açık seferde etkin atamalar ve işaretler, kapanmış seferde yalnız
 * işaretler (kapanışta liste donar; K-503). İşaretli öğrencinin durağı işaretin durağıdır.
 */
function rosterOf(
  trip: StoredTrip,
  marks: readonly StoredTripMark[],
  assignments: readonly StoredAssignment[],
): RosterEntry[] {
  const own = marks.filter((mark) => mark.tripId === trip.id)
  const marked = new Map(own.map((mark) => [mark.studentId, mark]))
  const entries: RosterEntry[] = own.map((mark) => ({
    studentId: mark.studentId,
    stopId: mark.stopId,
    mark,
  }))
  if (trip.status === 'open')
    for (const assignment of assignments)
      if (assignment.routeId === trip.routeId && !marked.has(assignment.studentId))
        entries.push({ studentId: assignment.studentId, stopId: assignment.stopId, mark: null })
  return entries
}

const statusOf = (entry: RosterEntry): TransportRosterStatus => entry.mark?.status ?? 'pending'
const iso = (value: Date | null) => (value === null ? null : value.toISOString())

async function tripDetail(db: Database, ctx: ServiceContext, tripId: string) {
  const { trip, route, guideMembershipId, access } = await tripScope(db, ctx, tripId)
  const [marks, assignments, vehicles, guides] = await Promise.all([
    loadTripMarks(db, ctx.institutionId, [trip.id]),
    trip.status === 'open'
      ? loadRouteAssignments(db, ctx.institutionId, [trip.routeId])
      : Promise.resolve([]),
    vehicleLabels(db, ctx.institutionId, [trip.vehicleId]),
    memberNames(db, ctx.institutionId, guideMembershipId === null ? [] : [guideMembershipId]),
  ])
  const roster = rosterOf(trip, marks, assignments)
  const [names, stops, corrections] = await Promise.all([
    studentNames(
      db,
      ctx,
      roster.map((entry) => entry.studentId),
    ),
    stopLabels(
      db,
      ctx.institutionId,
      roster.map((entry) => entry.stopId),
    ),
    latestTripCorrections(
      db,
      ctx.institutionId,
      marks.map((mark) => mark.id),
    ),
  ])
  const rows = roster
    .map((entry) => {
      const stop = stops.get(entry.stopId)
      const correction = entry.mark === null ? undefined : corrections.get(entry.mark.id)
      return {
        studentId: entry.studentId,
        studentName: names.get(entry.studentId) ?? '—',
        stopId: entry.stopId,
        stopName: stop?.name ?? '—',
        stopPosition: stop?.position ?? 0,
        stopTime: stop?.time ?? null,
        status: statusOf(entry),
        boardedAt: iso(entry.mark?.boardedAt ?? null),
        alightedAt: iso(entry.mark?.alightedAt ?? null),
        correctedAt: correction === undefined ? null : correction.createdAt.toISOString(),
        // Gerekçe serbest metindir; yalnız düzeltmeyi yapabilen yöneticiye döner (K-503).
        correctionReason: correction !== undefined && access.correct ? correction.reason : null,
      }
    })
    .sort(
      (a, b) => a.stopPosition - b.stopPosition || a.studentName.localeCompare(b.studentName, 'tr'),
    )
  return {
    id: trip.id,
    routeId: trip.routeId,
    routeName: route.name,
    direction: trip.direction,
    tripDate: trip.tripDate,
    status: trip.status,
    vehiclePlate: vehicles.get(trip.vehicleId)?.plate ?? null,
    guideName: guideMembershipId === null ? null : (guides.get(guideMembershipId) ?? null),
    startedAt: trip.startedAt.toISOString(),
    closedAt: iso(trip.closedAt),
    counts: transportTripCounts(rows.map((row) => row.status)),
    canOperate: access.operate && trip.status === 'open',
    canCorrect: access.correct && trip.status === 'closed',
    version: trip.version,
    roster: rows,
  }
}

export function getTripFor(ctx: ServiceContext, tripId: string) {
  return tripDetail(ctx.db, ctx, tripId)
}

// --- Günlük özet ---------------------------------------------------------------------------------

const DIRECTION_ORDER: Record<TransportDirection, number> = { morning: 0, evening: 1 }

/**
 * Günlük sefer özeti (K-502): rolün görebildiği her güzergâh için o günün seferi (yoksa `null`) ve
 * binen, inen, gelmeyen, araçta, işaretlenmemiş sayıları. Etkin güzergâhlar ve o gün seferi olan
 * (sonradan arşivlenmiş) güzergâhlar listelenir; yön ve ada göre sıralı, sayfalı.
 */
export async function listTripsFor(
  ctx: ServiceContext,
  query: {
    date: string
    direction?: TransportDirection | undefined
    page: number
    pageSize: number
  },
) {
  const { db, institutionId } = ctx
  const [live, dayTrips] = await Promise.all([
    liveRouteRows(db, institutionId, query.direction),
    tripsOnDate(db, institutionId, query.date),
  ])
  const trips = dayTrips.filter(
    (trip) => query.direction === undefined || trip.direction === query.direction,
  )
  const tripByRoute = new Map(trips.map((trip) => [trip.routeId, trip]))
  const labels = await routeLabels(db, institutionId, [
    ...live.map((route) => route.id),
    ...trips.map((trip) => trip.routeId),
  ])
  const vehicles = await vehicleLabels(
    db,
    institutionId,
    [...labels.values()].map((route) => route.vehicleId),
  )
  const visible = [...labels.entries()]
    .map(([routeId, route]) => {
      const vehicle = vehicles.get(route.vehicleId)
      const guide = vehicle === undefined || vehicle.archived ? null : vehicle.guideMembershipId
      return { routeId, route, guide, access: transportTripAccess(ctx.actor, guide) }
    })
    .filter((row) => row.access.read)
    .sort(
      (a, b) =>
        DIRECTION_ORDER[a.route.direction] - DIRECTION_ORDER[b.route.direction] ||
        a.route.name.localeCompare(b.route.name, 'tr'),
    )
  const pageRows = visible.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
  const pageTrips = pageRows.flatMap((row) => {
    const trip = tripByRoute.get(row.routeId)
    return trip === undefined ? [] : [trip]
  })
  const [marks, assignments, guides] = await Promise.all([
    loadTripMarks(
      db,
      institutionId,
      pageTrips.map((trip) => trip.id),
    ),
    loadRouteAssignments(
      db,
      institutionId,
      pageRows.map((row) => row.routeId),
    ),
    memberNames(
      db,
      institutionId,
      pageRows.flatMap((row) => (row.guide === null ? [] : [row.guide])),
    ),
  ])
  const items = pageRows.map((row) => {
    const trip = tripByRoute.get(row.routeId) ?? null
    const assigned = assignments.filter((assignment) => assignment.routeId === row.routeId).length
    const vehicle = trip === null ? vehicles.get(row.route.vehicleId) : vehicles.get(trip.vehicleId)
    const plate = vehicle?.plate ?? null
    return {
      routeId: row.routeId,
      routeName: row.route.name,
      direction: row.route.direction,
      vehiclePlate: plate,
      guideName: row.guide === null ? null : (guides.get(row.guide) ?? null),
      assigned,
      canOperate: row.access.operate,
      trip:
        trip === null
          ? null
          : {
              id: trip.id,
              status: trip.status,
              startedAt: trip.startedAt.toISOString(),
              closedAt: iso(trip.closedAt),
              counts: transportTripCounts(rosterOf(trip, marks, assignments).map(statusOf)),
              version: trip.version,
            },
    }
  })
  return { items, total: visible.length }
}

// --- Veli ve öğrenci -----------------------------------------------------------------------------

/**
 * Veli ve öğrenci görünümü (K-502): kapsamdaki öğrencilerin (veli için bağlı çocuklar) bugünkü
 * (Europe/Istanbul) biniş-iniş durumu, yön başına bir satır: güzergâh, durak, sefer durumu
 * (başlamadı, sürüyor, kapandı) ve işaret saatleri. Bildirim göndermez (ON-146).
 */
export async function listMyTripsFor(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'transportAssignments')
  const studentIds = [...scope.studentIds]
  if (studentIds.length === 0) return []
  const today = dayKey(ctx.now)
  const [assignments, trips] = await Promise.all([
    loadStudentAssignments(ctx.db, ctx.institutionId, studentIds),
    tripsOnDate(ctx.db, ctx.institutionId, today),
  ])
  const marks = await loadStudentTripMarks(
    ctx.db,
    ctx.institutionId,
    studentIds,
    trips.map((trip) => trip.id),
  )
  const tripById = new Map(trips.map((trip) => [trip.id, trip]))
  type Row = { studentId: string; direction: TransportDirection; routeId: string; stopId: string }
  const rows = new Map<string, Row & { trip: StoredTrip | null; mark: StoredTripMark | null }>()
  // Bugünün işareti önce gelir: öğrenci sonradan başka güzergâha atanmış olsa da işaret görünür.
  for (const mark of marks) {
    const trip = tripById.get(mark.tripId)
    if (trip === undefined) continue
    rows.set(`${mark.studentId}:${trip.direction}`, {
      studentId: mark.studentId,
      direction: trip.direction,
      routeId: trip.routeId,
      stopId: mark.stopId,
      trip,
      mark,
    })
  }
  for (const assignment of assignments) {
    const key = `${assignment.studentId}:${assignment.direction}`
    if (rows.has(key)) continue
    const trip = trips.find(
      (row) => row.routeId === assignment.routeId && row.direction === assignment.direction,
    )
    rows.set(key, {
      studentId: assignment.studentId,
      direction: assignment.direction,
      routeId: assignment.routeId,
      stopId: assignment.stopId,
      trip: trip ?? null,
      mark: null,
    })
  }
  const list = [...rows.values()]
  const [names, labels, stops] = await Promise.all([
    studentNames(
      ctx.db,
      ctx,
      list.map((row) => row.studentId),
    ),
    routeLabels(
      ctx.db,
      ctx.institutionId,
      list.map((row) => row.routeId),
    ),
    stopLabels(
      ctx.db,
      ctx.institutionId,
      list.map((row) => row.stopId),
    ),
  ])
  return list
    .map((row) => ({
      studentId: row.studentId,
      studentName: names.get(row.studentId) ?? '—',
      direction: row.direction,
      routeName: labels.get(row.routeId)?.name ?? '—',
      stopName: stops.get(row.stopId)?.name ?? '—',
      stopTime: stops.get(row.stopId)?.time ?? null,
      tripDate: today,
      tripStatus: row.trip === null ? ('not_started' as const) : row.trip.status,
      status: row.mark?.status ?? ('pending' as const),
      boardedAt: iso(row.mark?.boardedAt ?? null),
      alightedAt: iso(row.mark?.alightedAt ?? null),
    }))
    .sort(
      (a, b) =>
        a.studentName.localeCompare(b.studentName, 'tr') ||
        DIRECTION_ORDER[a.direction] - DIRECTION_ORDER[b.direction],
    )
}

// --- Yazma ---------------------------------------------------------------------------------------

/**
 * Sefer başlatma (K-502): gün sunucunun İstanbul günü, yön güzergâhın yönü, araç güzergâhın
 * bugünkü aracıdır. Rehber ya da yönetici; aynı güzergâhın bugünkü seferi 409. `Idempotency-Key`
 * zorunlu. 201.
 */
export function startTripCommand(
  ctx: ServiceContext,
  routeId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: TRIP, id }
  const tripDate = dayKey(ctx.now)
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.transport.trip_start',
      collections: [],
      entity,
      load: async (tx) => {
        transportTripStartSchema.parse(input)
        const route = await findRoute(tx, ctx.institutionId, routeId)
        if (route === null) throw new NotFoundError()
        const vehicle = await findVehicle(tx, ctx.institutionId, route.vehicleId)
        const access = transportTripAccess(ctx.actor, vehicle?.guideMembershipId ?? null)
        if (!access.read) throw new NotFoundError()
        const existing = await tripsOnDate(tx, ctx.institutionId, tripDate, [routeId])
        const tripExists = existing.some((trip) => trip.direction === route.direction)
        return { run: () => (planTransportTripStart({ access, tripExists }), route) }
      },
      after: async (tx, route) => {
        await insertTrip(tx, ctx.institutionId, {
          id,
          routeId,
          direction: route.direction,
          vehicleId: route.vehicleId,
          tripDate,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.transport.trip_start', entity, [
          'routeId',
          'direction',
          'tripDate',
          'vehicleId',
        ])
        body = { data: await tripDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Biniş-iniş işareti (K-502, K-503): açık seferde rehber ya da yönetici; kapanmış seferde yalnız
 * yönetici gerekçeyle düzeltir (önceki ve yeni işaret ile gerekçe düzeltme satırına yazılır).
 * Aynı işaretin yinelenmesi bir şey yazmaz. `If-Match` yoktur: çevrimdışı kuyruktaki ardışık
 * işaretler (bindi, sonra indi) kurum kilidi altında sırayla uygulanır; `Idempotency-Key` zorunlu.
 */
export function markTripCommand(
  ctx: ServiceContext,
  tripId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  type Loaded = {
    plan: TransportTripMarkPlan
    markId: string
    current: StoredTripMark | null
    stopId: string
    routeId: string
    studentId: string
    reason: string | undefined
  }
  return runCommand<Loaded>(
    ctx,
    {
      action: 'finance.transport.trip_mark',
      collections: [],
      entity: (loaded) => ({ type: MARK, id: loaded.markId }),
      load: async (tx) => {
        const parsed = transportTripMarkSchema.parse(input)
        const { trip, access } = await tripScope(tx, ctx, tripId)
        const [marks, assignments] = await Promise.all([
          loadTripMarks(tx, ctx.institutionId, [trip.id]),
          trip.status === 'open'
            ? loadRouteAssignments(tx, ctx.institutionId, [trip.routeId])
            : Promise.resolve([]),
        ])
        const current = marks.find((mark) => mark.studentId === parsed.studentId) ?? null
        const assignment = assignments.find((row) => row.studentId === parsed.studentId)
        return {
          run: (): Loaded => ({
            plan: planTransportTripMark(parsed, {
              trip,
              access,
              onRoster: current !== null || assignment !== undefined,
              current,
              now: ctx.now,
            }),
            markId: current?.id ?? randomUUID(),
            current,
            stopId: current?.stopId ?? assignment?.stopId ?? '',
            routeId: trip.routeId,
            studentId: parsed.studentId,
            reason: parsed.reason,
          }),
        }
      },
      after: async (tx, loaded) => {
        const { plan, current } = loaded
        if (plan.kind === 'write') {
          if (current === null)
            await insertTripMark(tx, ctx.institutionId, {
              id: loaded.markId,
              tripId,
              routeId: loaded.routeId,
              stopId: loaded.stopId,
              studentId: loaded.studentId,
              ...plan.next,
              userId: ctx.actor.userId,
              now: ctx.now,
            })
          else {
            const saved = await updateTripMark(tx, ctx.institutionId, {
              id: current.id,
              expectedVersion: current.version,
              ...plan.next,
              userId: ctx.actor.userId,
              now: ctx.now,
            })
            if (!saved) throw new ConflictError()
          }
          if (plan.correction && current !== null && loaded.reason !== undefined)
            await insertTripCorrection(tx, ctx.institutionId, {
              id: randomUUID(),
              markId: current.id,
              previous: current,
              next: plan.next,
              reason: loaded.reason,
              userId: ctx.actor.userId,
              now: ctx.now,
            })
          await auditWork(
            tx,
            ctx,
            plan.correction ? 'finance.transport.trip_mark_correct' : 'finance.transport.trip_mark',
            { type: MARK, id: loaded.markId },
            plan.correction ? [...plan.changed, 'reason'] : plan.changed,
          )
        }
        body = { data: await tripDetail(tx, ctx, tripId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Sefer kapatma (K-504): binip inişi işaretlenmemiş ya da işaretlenmemiş öğrenci varken 422;
 * kapanmış sefer 409. Rehber ya da yönetici. `If-Match` seferin sürümüdür.
 */
export function closeTripCommand(
  ctx: ServiceContext,
  tripId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TRIP, id: tripId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.transport.trip_close',
      collections: [],
      entity,
      load: async (tx) => {
        transportTripCloseSchema.parse(input)
        const { trip, access } = await tripScope(tx, ctx, tripId)
        if (trip.version !== expectedVersion) throw new ConflictError()
        const [marks, assignments] = await Promise.all([
          loadTripMarks(tx, ctx.institutionId, [trip.id]),
          loadRouteAssignments(tx, ctx.institutionId, [trip.routeId]),
        ])
        const roster = rosterOf(trip, marks, assignments).map(statusOf)
        return { run: () => planTransportTripClose({ status: trip.status, access, roster }) }
      },
      after: async (tx) => {
        const saved = await closeTrip(tx, ctx.institutionId, {
          id: tripId,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.transport.trip_close', entity, ['status', 'closedAt'])
        body = { data: await tripDetail(tx, ctx, tripId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
