import {
  assertTransportRosterPurpose,
  transportRosterContacts,
  transportRosterCount,
  transportRosterGroups,
  type RosterParentRecord,
  type RosterStudent,
  type TransportRosterPurpose,
} from '@kampus/school-core/lib/finance-transport-roster.ts'
import { maskDriverPhone } from '@kampus/school-core/lib/finance-transport.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import { findRoute, findVehicle, loadRouteAssignments, loadStops } from '../db/finance-transport.ts'
import { memberNames } from '../db/finance-visitors.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { loadGuardianAccounts } from '../db/student-guardians.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { mapOperationError } from './operation-runner.ts'

/**
 * Servis listesi (DOM-FIN-148; ON-148; IST-028; K-499…K-501). Güzergâhın etkin atamalarını durak
 * sırasıyla, kayıtlı öğrencinin adı, sınıfı ve acil iletişimiyle döndürür; kural core
 * `lib/finance-transport-roster.ts`'tedir. Veli telefonu `office` amacında maskeli, `driver`
 * amacında tamdır (yalnız yönetici); sürücü telefonu her zaman maskelidir. Her okuma amacıyla
 * denetime yazılır (`finance.transport.roster_export`, tam telefonlu liste
 * `finance.transport.roster_driver_export`): değer, öğrenci kimliği ve telefon yazılmaz, yalnız alan
 * adları ve satır sayısı. Rol, modül ve taze oturum rotadadır.
 */

const ROUTE = 'transport_routes'
const FIELDS = ['studentName', 'className', 'stop', 'contactName', 'contactPhone'] as const
/** Amaç denetimde eylem adıyla ayrılır: tam telefonlu liste ayrıca sorgulanabilsin (K-500). */
const AUDIT_ACTIONS = {
  office: 'finance.transport.roster_export',
  driver: 'finance.transport.roster_driver_export',
} as const satisfies Record<TransportRosterPurpose, string>

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

export async function transportRosterFor(
  ctx: ServiceContext,
  routeId: string,
  purpose: TransportRosterPurpose,
) {
  try {
    assertTransportRosterPurpose(ctx.actor.role, purpose)
  } catch (error) {
    throw mapOperationError(error)
  }
  const route = await findRoute(ctx.db, ctx.institutionId, routeId)
  if (route === null) throw new NotFoundError()
  const [vehicle, stops, assignments] = await Promise.all([
    findVehicle(ctx.db, ctx.institutionId, route.vehicleId),
    loadStops(ctx.db, ctx.institutionId, [routeId]),
    loadRouteAssignments(ctx.db, ctx.institutionId, [routeId]),
  ])
  const studentIds = [...new Set(assignments.map((assignment) => assignment.studentId))]
  // Arşivli öğrenci kaydı yüklenmez: listeye girmez (K-499).
  const [studentRows, links] = await Promise.all([
    loadRecordsByIds(ctx.db, ctx.institutionId, 'students', studentIds),
    loadGuardianAccounts(ctx.db, ctx.institutionId, studentIds),
  ])
  const students = new Map<string, RosterStudent & { parentId: string | null }>(
    studentRows.map((row) => [
      row.id,
      {
        name: text(row.data.name) ?? '—',
        classId: text(row.data.classId),
        isActive: row.data.isActive !== false,
        parentId: text(row.data.parentId),
      },
    ]),
  )
  const parentIds = [
    ...links.flatMap((link) => (link.parentId === null ? [] : [link.parentId])),
    ...[...students.values()].flatMap((student) =>
      student.parentId === null ? [] : [student.parentId],
    ),
  ]
  const classIds = [...students.values()].flatMap((student) =>
    student.classId === null ? [] : [student.classId],
  )
  const [parentRows, classRows, accounts, guides] = await Promise.all([
    loadRecordsByIds(ctx.db, ctx.institutionId, 'parents', [...new Set(parentIds)]),
    loadRecordsByIds(ctx.db, ctx.institutionId, 'classes', [...new Set(classIds)], {
      includeArchived: true,
    }),
    memberNames(
      ctx.db,
      ctx.institutionId,
      links.flatMap((link) => (link.membershipId === null ? [] : [link.membershipId])),
    ),
    memberNames(
      ctx.db,
      ctx.institutionId,
      vehicle?.guideMembershipId === null || vehicle === null ? [] : [vehicle.guideMembershipId],
    ),
  ])
  const parents = new Map<string, RosterParentRecord>(
    parentRows.map((row) => [
      row.id,
      {
        id: row.id,
        name: text(row.data.name),
        phone: text(row.data.phone),
        relationship: text(row.data.relationship),
      },
    ]),
  )
  const classNames = new Map(
    classRows.flatMap((row) => {
      const name = text(row.data.name)
      return name === null ? [] : [[row.id, name] as const]
    }),
  )
  const linksByStudent = new Map<string, typeof links>()
  for (const link of links)
    linksByStudent.set(link.studentId, [...(linksByStudent.get(link.studentId) ?? []), link])
  const groups = transportRosterGroups({
    stops,
    assignments,
    students,
    classNames,
    contactsOf: (studentId) =>
      transportRosterContacts({
        links: linksByStudent.get(studentId) ?? [],
        memberNames: accounts,
        parents,
        studentParentId: students.get(studentId)?.parentId ?? null,
        purpose,
      }),
  })
  const total = transportRosterCount(groups)
  const action = AUDIT_ACTIONS[purpose]
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType: ROUTE,
    entityId: routeId,
    // kvkk: K — değer yazılmaz; alan adları ve satır sayısı, amaç eylem adındadır.
    changes: { fields: [...FIELDS], counts: { students: total } },
    createdAt: ctx.now,
  })
  ctx.log.info({ event: action, routeId, count: total })
  return {
    route: {
      id: route.id,
      name: route.name,
      direction: route.direction,
      vehiclePlate: vehicle?.plate ?? null,
      capacity: vehicle?.capacity ?? 0,
      driverName: vehicle?.driverName ?? null,
      driverPhoneMasked: vehicle === null ? null : maskDriverPhone(vehicle.driverPhone),
      guideName:
        vehicle === null || vehicle.guideMembershipId === null
          ? null
          : (guides.get(vehicle.guideMembershipId) ?? null),
    },
    purpose,
    phonesMasked: purpose !== 'driver',
    listDate: dayKey(ctx.now),
    total,
    stops: groups,
  }
}
