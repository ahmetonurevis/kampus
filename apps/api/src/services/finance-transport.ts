import { randomUUID } from 'node:crypto'

import {
  assertTransportRouteArchivable,
  assertTransportVehicleArchivable,
  maskDriverPhone,
  planTransportAssignment,
  planTransportRoute,
  planTransportRouteUpdate,
  planTransportStops,
  planTransportVehicle,
  planTransportVehicleUpdate,
  transportAssignSchema,
  transportRouteCreateSchema,
  transportRouteUpdateSchema,
  transportVehicleCreateSchema,
  transportVehicleUpdateSchema,
  type MemberCheck,
  type StudentCheck,
  type TransportDirection,
} from '@kampus/school-core/lib/finance-transport.ts'

import type { Database } from '../db/client.ts'
import { findStaffMember } from '../db/finance-pay-rates.ts'
import {
  archiveStops,
  findAssignment,
  findRoute,
  findVehicle,
  insertAssignment,
  insertRoute,
  insertStops,
  insertVehicle,
  listRoutes,
  listVehicles,
  loadRouteAssignments,
  loadRoutes,
  loadStops,
  loadStudentAssignments,
  loadVehicles,
  plateTaken,
  removeAssignment,
  routeLoads,
  routeNameTaken,
  updateRoute,
  updateStop,
  updateVehicle,
  vehicleRoutes,
  type StoredRoute,
  type StoredTransportStop,
  type StoredVehicle,
} from '../db/finance-transport.ts'
import { memberNames } from '../db/finance-visitors.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { ModuleDisabledError } from '../plugins/modules.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { assertReadable, readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Servis aracı, güzergâh, durak ve öğrenci ataması (DOM-FIN-142; ON-098; IST-099). Kural core
 * `lib/finance-transport.ts`'tedir; servis kurum kilidi altında yükler, aynı transaction'da yazar
 * ve denetime alan adlarını yazar (sürücü adı, telefonu ve öğrenci kimliği yazılmaz; K-481).
 * Sürücü telefonu hiçbir yanıtta tam dönmez. Rol ve modül (`transport`) denetimi rotadadır; veli
 * ve öğrenci görünümü core kapsamıyla (`transportAssignments`, `scope.studentIds`) daralır.
 */

const VEHICLE = 'transport_vehicles'
const ROUTE = 'transport_routes'
const ASSIGNMENT = 'transport_assignments'

// --- Ortak ---------------------------------------------------------------------------------------

/**
 * Okul yaşamı modülü açık mı (`transport`, `clubs`, `meals`, `calendar`; DOM-YTK-040). Uçlar finans
 * yolundadır ve `finance` modülüne bağlıdır (kayıt/finans envanteri); servis, kulüp, yemek menüsü ve okul
 * takvimi ayrıca kendi modülü kapalıyken 403 `module_disabled` döner. Rota `preValidation`'ında, gövde
 * doğrulamasından önce.
 */
export async function assertSchoolLifeModule(
  ctx: ServiceContext,
  key: 'transport' | 'clubs' | 'meals' | 'calendar',
): Promise<void> {
  const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
  if (institution?.modules[key] !== true) {
    ctx.log.info({ event: 'module.disabled_denied', module: key })
    throw new ModuleDisabledError()
  }
}

/** Öğrenci kurumda var mı ve etkin mi (arşivli kayıt yok sayılır). */
export async function studentCheck(
  db: Database,
  ctx: ServiceContext,
  studentId: string,
): Promise<StudentCheck> {
  const [row] = await loadRecordsByIds(db, ctx.institutionId, 'students', [studentId])
  return row === undefined ? null : { active: row.data.isActive !== false }
}

/** Öğrenci adları (arşivli kayıt da adıyla görünür). */
export async function studentNames(
  db: Database,
  ctx: ServiceContext,
  studentIds: readonly string[],
): Promise<Map<string, string>> {
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', [...new Set(studentIds)], {
    includeArchived: true,
  })
  return new Map(
    rows.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : '—']),
  )
}

/** Seçilen üyelik: seçilmediyse `undefined`, kurumda yoksa `null`. */
export async function memberCheck(
  db: Database,
  ctx: ServiceContext,
  membershipId: string | null | undefined,
): Promise<MemberCheck> {
  if (membershipId === null || membershipId === undefined) return undefined
  const member = await findStaffMember(db, ctx.institutionId, membershipId)
  return member === null ? null : { role: member.role, active: member.active }
}

const changedKeys = (input: Record<string, unknown>) =>
  Object.keys(input).filter((key) => input[key] !== undefined)

// --- Görünüm -------------------------------------------------------------------------------------

async function vehicleRows(db: Database, ctx: ServiceContext, vehicles: readonly StoredVehicle[]) {
  const guides = await memberNames(
    db,
    ctx.institutionId,
    vehicles.flatMap((vehicle) =>
      vehicle.guideMembershipId === null ? [] : [vehicle.guideMembershipId],
    ),
  )
  const routes = (
    await Promise.all(vehicles.map((vehicle) => vehicleRoutes(db, ctx.institutionId, vehicle.id)))
  ).flat()
  const loads = await routeLoads(
    db,
    ctx.institutionId,
    routes.map((route) => route.id),
  )
  return vehicles.map((vehicle) => {
    const own = routes.filter((route) => route.vehicleId === vehicle.id)
    return {
      id: vehicle.id,
      plate: vehicle.plate,
      capacity: vehicle.capacity,
      driverName: vehicle.driverName,
      driverPhoneMasked: maskDriverPhone(vehicle.driverPhone),
      guideMembershipId: vehicle.guideMembershipId,
      guideName:
        vehicle.guideMembershipId === null ? null : (guides.get(vehicle.guideMembershipId) ?? null),
      routeCount: own.length,
      maxRouteLoad: Math.max(0, ...own.map((route) => loads.get(route.id) ?? 0)),
      version: vehicle.version,
    }
  })
}

async function vehicleBody(db: Database, ctx: ServiceContext, id: string) {
  const vehicle = await findVehicle(db, ctx.institutionId, id)
  if (vehicle === null) throw new NotFoundError()
  const [row] = await vehicleRows(db, ctx, [vehicle])
  if (row === undefined) throw new NotFoundError()
  return row
}

async function routeRows(db: Database, ctx: ServiceContext, routes: readonly StoredRoute[]) {
  const ids = routes.map((route) => route.id)
  const [vehicles, loads, stops] = await Promise.all([
    loadVehicles(
      db,
      ctx.institutionId,
      routes.map((route) => route.vehicleId),
    ),
    routeLoads(db, ctx.institutionId, ids),
    loadStops(db, ctx.institutionId, ids),
  ])
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
  return routes.map((route) => {
    const vehicle = vehicleById.get(route.vehicleId)
    const own = stops.filter((stop) => stop.routeId === route.id)
    return {
      id: route.id,
      name: route.name,
      direction: route.direction,
      vehicleId: route.vehicleId,
      vehiclePlate: vehicle?.plate ?? null,
      capacity: vehicle?.capacity ?? 0,
      load: loads.get(route.id) ?? 0,
      stopCount: own.length,
      firstStopTime: own[0]?.time ?? null,
      lastStopTime: own.at(-1)?.time ?? null,
      version: route.version,
    }
  })
}

async function routeDetail(db: Database, ctx: ServiceContext, id: string) {
  const route = await findRoute(db, ctx.institutionId, id)
  if (route === null) throw new NotFoundError()
  const [[row], stops, assignments, vehicle] = await Promise.all([
    routeRows(db, ctx, [route]),
    loadStops(db, ctx.institutionId, [id]),
    loadRouteAssignments(db, ctx.institutionId, [id]),
    findVehicle(db, ctx.institutionId, route.vehicleId),
  ])
  if (row === undefined) throw new NotFoundError()
  const [names, guides] = await Promise.all([
    studentNames(
      db,
      ctx,
      assignments.map((assignment) => assignment.studentId),
    ),
    memberNames(
      db,
      ctx.institutionId,
      vehicle?.guideMembershipId === null || vehicle === null ? [] : [vehicle.guideMembershipId],
    ),
  ])
  const stopById = new Map(stops.map((stop) => [stop.id, stop]))
  return {
    ...row,
    driverName: vehicle?.driverName ?? null,
    driverPhoneMasked: vehicle === null ? null : maskDriverPhone(vehicle.driverPhone),
    guideName:
      vehicle === null || vehicle.guideMembershipId === null
        ? null
        : (guides.get(vehicle.guideMembershipId) ?? null),
    stops: stops.map((stop) => ({
      id: stop.id,
      position: stop.position,
      name: stop.name,
      time: stop.time,
      assigned: assignments.filter((assignment) => assignment.stopId === stop.id).length,
    })),
    assignments: assignments
      .map((assignment) => ({
        id: assignment.id,
        studentId: assignment.studentId,
        studentName: names.get(assignment.studentId) ?? '—',
        stopId: assignment.stopId,
        stopName: stopById.get(assignment.stopId)?.name ?? '—',
        stopTime: stopById.get(assignment.stopId)?.time ?? null,
        version: assignment.version,
      }))
      .sort(
        (a, b) =>
          (stopById.get(a.stopId)?.position ?? 0) - (stopById.get(b.stopId)?.position ?? 0) ||
          a.studentName.localeCompare(b.studentName, 'tr'),
      ),
  }
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listVehiclesFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  const { items, total } = await listVehicles(ctx.db, ctx.institutionId, query)
  return { items: await vehicleRows(ctx.db, ctx, items), total }
}

export async function listRoutesFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    direction?: TransportDirection | undefined
    vehicleId?: string | undefined
  },
) {
  const { items, total } = await listRoutes(ctx.db, ctx.institutionId, query)
  return { items: await routeRows(ctx.db, ctx, items), total }
}

export function getRouteFor(ctx: ServiceContext, id: string) {
  return routeDetail(ctx.db, ctx, id)
}

/**
 * Veli ve öğrenci görünümü (K-482): kapsamdaki öğrencilerin (veli için bağlı çocuklar) etkin
 * atamaları; güzergâh, yön, durak ve saat, araç plakası, sürücü adı ve maskeli telefonu, rehber.
 * Kapsam core `transportAssignments` kuralı ve `scope.studentIds`'ten gelir.
 */
export async function listMyTransportFor(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'transportAssignments')
  const studentIds = [...scope.studentIds]
  const assignments = await loadStudentAssignments(ctx.db, ctx.institutionId, studentIds)
  if (assignments.length === 0) return []
  const routeIds = assignments.map((assignment) => assignment.routeId)
  const [routes, stops, names] = await Promise.all([
    loadRoutes(ctx.db, ctx.institutionId, routeIds),
    loadStops(ctx.db, ctx.institutionId, routeIds),
    studentNames(
      ctx.db,
      ctx,
      assignments.map((assignment) => assignment.studentId),
    ),
  ])
  const vehicles = await loadVehicles(
    ctx.db,
    ctx.institutionId,
    routes.map((route) => route.vehicleId),
  )
  const guides = await memberNames(
    ctx.db,
    ctx.institutionId,
    vehicles.flatMap((vehicle) =>
      vehicle.guideMembershipId === null ? [] : [vehicle.guideMembershipId],
    ),
  )
  const routeById = new Map(routes.map((route) => [route.id, route]))
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const stopById = new Map<string, StoredTransportStop>(stops.map((stop) => [stop.id, stop]))
  return assignments.flatMap((assignment) => {
    const route = routeById.get(assignment.routeId)
    const stop = stopById.get(assignment.stopId)
    if (route === undefined || stop === undefined) return []
    const vehicle = vehicleById.get(route.vehicleId)
    return [
      {
        studentId: assignment.studentId,
        studentName: names.get(assignment.studentId) ?? '—',
        direction: route.direction,
        routeName: route.name,
        stopName: stop.name,
        stopPosition: stop.position,
        stopTime: stop.time,
        vehiclePlate: vehicle?.plate ?? null,
        driverName: vehicle?.driverName ?? null,
        driverPhoneMasked: vehicle === undefined ? null : maskDriverPhone(vehicle.driverPhone),
        guideName:
          vehicle?.guideMembershipId === null || vehicle === undefined
            ? null
            : (guides.get(vehicle.guideMembershipId) ?? null),
      },
    ]
  })
}

// --- Araç yazma ----------------------------------------------------------------------------------

/** Yeni araç (K-481). `Idempotency-Key` rotada zorunlu. 201. */
export function createVehicleCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: VEHICLE, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.transport.vehicle_create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = transportVehicleCreateSchema.parse(input)
        const [taken, guide] = await Promise.all([
          plateTaken(tx, ctx.institutionId, parsed.plate),
          memberCheck(tx, ctx, parsed.guideMembershipId),
        ])
        return { run: () => (planTransportVehicle({ plateTaken: taken, guide }), parsed) }
      },
      after: async (tx, parsed) => {
        await insertVehicle(tx, ctx.institutionId, {
          id,
          ...parsed,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.transport.vehicle_create', entity, changedKeys(parsed))
        body = { data: await vehicleBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function versionedVehicle(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const vehicle = await findVehicle(tx, ctx.institutionId, id)
  if (vehicle === null) throw new NotFoundError()
  if (vehicle.version !== version) throw new ConflictError()
  return vehicle
}

/** Araç düzenleme (K-481, K-482): kapasite atanmış öğrencinin altına inemez. `If-Match`. */
export function updateVehicleCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: VEHICLE, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.transport.vehicle_update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = transportVehicleUpdateSchema.parse(input)
        const vehicle = await versionedVehicle(tx, ctx, id, expectedVersion)
        const routes = await vehicleRoutes(tx, ctx.institutionId, id)
        const [taken, guide, loads] = await Promise.all([
          parsed.plate === undefined ? false : plateTaken(tx, ctx.institutionId, parsed.plate, id),
          memberCheck(tx, ctx, parsed.guideMembershipId),
          routeLoads(
            tx,
            ctx.institutionId,
            routes.map((route) => route.id),
          ),
        ])
        return {
          run: () =>
            planTransportVehicleUpdate(vehicle, parsed, {
              plateTaken: taken,
              guide,
              maxRouteLoad: Math.max(0, ...loads.values()),
            }),
        }
      },
      after: async (tx, plan) => {
        const saved = await updateVehicle(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: plan.next,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.transport.vehicle_update', entity, plan.changed)
        body = { data: await vehicleBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Araç arşivi (K-482): etkin güzergâhı olan araç arşivlenmez. `If-Match`. */
export function archiveVehicleCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: VEHICLE, id }
  return runCommand(
    ctx,
    {
      action: 'finance.transport.vehicle_archive',
      collections: [],
      entity,
      load: async (tx) => {
        await versionedVehicle(tx, ctx, id, expectedVersion)
        const routes = await vehicleRoutes(tx, ctx.institutionId, id)
        return { run: () => assertTransportVehicleArchivable(routes.length) }
      },
      after: async (tx) => {
        const saved = await updateVehicle(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { archivedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.transport.vehicle_archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

// --- Güzergâh yazma ------------------------------------------------------------------------------

/** Yeni güzergâh ve durakları (K-481). `Idempotency-Key` rotada zorunlu. 201. */
export function createRouteCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ROUTE, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.transport.route_create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = transportRouteCreateSchema.parse(input)
        const [vehicle, taken] = await Promise.all([
          findVehicle(tx, ctx.institutionId, parsed.vehicleId),
          routeNameTaken(tx, ctx.institutionId, { name: parsed.name, direction: parsed.direction }),
        ])
        return { run: () => (planTransportRoute({ vehicle, nameTaken: taken }), parsed) }
      },
      after: async (tx, parsed) => {
        await insertRoute(tx, ctx.institutionId, {
          id,
          name: parsed.name,
          direction: parsed.direction,
          vehicleId: parsed.vehicleId,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await insertStops(
          tx,
          ctx.institutionId,
          id,
          parsed.stops.map((stop, index) => ({
            id: randomUUID(),
            name: stop.name,
            time: stop.time,
            position: index + 1,
          })),
          ctx.now,
        )
        await auditWork(tx, ctx, 'finance.transport.route_create', entity, [
          'name',
          'direction',
          'vehicleId',
          'stops',
        ])
        body = { data: await routeDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function versionedRoute(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const route = await findRoute(tx, ctx.institutionId, id)
  if (route === null) throw new NotFoundError()
  if (route.version !== version) throw new ConflictError()
  return route
}

/**
 * Güzergâh düzenleme (K-481, K-482): ad, araç ve durak listesi. Yön değişmez. Listeden çıkan
 * durakta atanmış öğrenci varsa 422. `If-Match`.
 */
export function updateRouteCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ROUTE, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.transport.route_update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = transportRouteUpdateSchema.parse(input)
        const route = await versionedRoute(tx, ctx, id, expectedVersion)
        const [vehicle, taken, stops, assignments] = await Promise.all([
          parsed.vehicleId === undefined
            ? undefined
            : findVehicle(tx, ctx.institutionId, parsed.vehicleId),
          parsed.name === undefined
            ? false
            : routeNameTaken(tx, ctx.institutionId, {
                name: parsed.name,
                direction: route.direction,
                exceptId: id,
              }),
          loadStops(tx, ctx.institutionId, [id]),
          loadRouteAssignments(tx, ctx.institutionId, [id]),
        ])
        return {
          run: () => {
            planTransportRouteUpdate(parsed, {
              vehicle,
              nameTaken: taken,
              load: assignments.length,
            })
            const stopPlan =
              parsed.stops === undefined
                ? null
                : planTransportStops(
                    stops,
                    parsed.stops,
                    new Set(assignments.map((assignment) => assignment.stopId)),
                  )
            return { parsed, stopPlan }
          },
        }
      },
      after: async (tx, { parsed, stopPlan }) => {
        const saved = await updateRoute(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            ...(parsed.name === undefined ? {} : { name: parsed.name }),
            ...(parsed.vehicleId === undefined ? {} : { vehicleId: parsed.vehicleId }),
          },
        })
        if (!saved) throw new ConflictError()
        if (stopPlan !== null) {
          await archiveStops(tx, ctx.institutionId, stopPlan.archive, ctx.now)
          for (const stop of stopPlan.update)
            await updateStop(tx, ctx.institutionId, { ...stop, now: ctx.now })
          await insertStops(
            tx,
            ctx.institutionId,
            id,
            stopPlan.insert.map((stop) => ({ ...stop, id: randomUUID() })),
            ctx.now,
          )
        }
        await auditWork(tx, ctx, 'finance.transport.route_update', entity, changedKeys(parsed))
        body = { data: await routeDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Güzergâh arşivi (K-482): atanmış öğrencisi olan güzergâh arşivlenmez. `If-Match`. */
export function archiveRouteCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ROUTE, id }
  return runCommand(
    ctx,
    {
      action: 'finance.transport.route_archive',
      collections: [],
      entity,
      load: async (tx) => {
        await versionedRoute(tx, ctx, id, expectedVersion)
        const loads = await routeLoads(tx, ctx.institutionId, [id])
        return { run: () => assertTransportRouteArchivable(loads.get(id) ?? 0) }
      },
      after: async (tx) => {
        const stops = await loadStops(tx, ctx.institutionId, [id])
        const saved = await updateRoute(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { archivedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await archiveStops(
          tx,
          ctx.institutionId,
          stops.map((stop) => stop.id),
          ctx.now,
        )
        await auditWork(tx, ctx, 'finance.transport.route_archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

// --- Atama yazma ---------------------------------------------------------------------------------

/**
 * Öğrenci–durak ataması (K-482): aynı yönde ikinci güzergâh ve araç kapasitesi aşımı 409; kurum
 * kilidi altında sayılır, kısmi tekil indeks son güvencedir. `Idempotency-Key` zorunlu. 201.
 */
export function assignStudentCommand(
  ctx: ServiceContext,
  routeId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ASSIGNMENT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.transport.assign',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = transportAssignSchema.parse(input)
        const route = await findRoute(tx, ctx.institutionId, routeId)
        if (route === null) throw new NotFoundError()
        const [vehicle, stops, loads, student, existing] = await Promise.all([
          findVehicle(tx, ctx.institutionId, route.vehicleId),
          loadStops(tx, ctx.institutionId, [routeId]),
          routeLoads(tx, ctx.institutionId, [routeId]),
          studentCheck(tx, ctx, parsed.studentId),
          loadStudentAssignments(tx, ctx.institutionId, [parsed.studentId]),
        ])
        const sameDirection = existing.find(
          (assignment) => assignment.direction === route.direction,
        )
        return {
          run: () => {
            planTransportAssignment({
              student,
              stopOnRoute: stops.some((stop) => stop.id === parsed.stopId),
              load: loads.get(routeId) ?? 0,
              capacity: vehicle?.capacity ?? 0,
              sameDirection:
                sameDirection === undefined ? null : { routeId: sameDirection.routeId },
              routeId,
            })
            return { parsed, direction: route.direction }
          },
        }
      },
      after: async (tx, { parsed, direction }) => {
        await insertAssignment(tx, ctx.institutionId, {
          id,
          routeId,
          stopId: parsed.stopId,
          direction,
          studentId: parsed.studentId,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.transport.assign', entity, ['routeId', 'stopId'])
        const detail = await routeDetail(tx, ctx, routeId)
        const assignment = detail.assignments.find((row) => row.id === id)
        if (assignment === undefined) throw new NotFoundError()
        body = { data: assignment }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Atamayı kaldırır (arşiv; K-482). `If-Match` atamanın sürümüdür. */
export function removeAssignmentCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ASSIGNMENT, id }
  return runCommand(
    ctx,
    {
      action: 'finance.transport.unassign',
      collections: [],
      entity,
      load: async (tx) => {
        const assignment = await findAssignment(tx, ctx.institutionId, id)
        if (assignment === null) throw new NotFoundError()
        if (assignment.version !== expectedVersion) throw new ConflictError()
        return { run: () => assignment }
      },
      after: async (tx) => {
        const saved = await removeAssignment(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.transport.unassign', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}
