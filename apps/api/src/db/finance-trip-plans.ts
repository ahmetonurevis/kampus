import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  max,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'

import type { PaidActivityKind } from '@kampus/school-core/lib/finance-paid-activities.ts'
import {
  TRIP_PLAN_DONE_STATUSES,
  TRIP_STAFF_MEMBER_ROLES,
  type TripContact,
  type TripPlanEvent,
  type TripPlanState,
  type TripPlanStatus,
  type TripRisk,
  type TripStaffMember,
  type TripStaffRole,
  type TripStop,
  type TripTransport,
  type TripTransportType,
} from '@kampus/school-core/lib/finance-trip-plans.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { paidActivities } from './schema/finance-paid-activities.ts'
import { tripPlanEvents, tripPlanStaff, tripPlans } from './schema/finance-trip-plans.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Gezi planı deposu (DOM-FIN-111; ON-155). Kurum kapsamlıdır: ilk parametre `institutionId`. Kural
 * core `lib/finance-trip-plans.ts`'tedir; depo yalnız okur ve yazar. Görevli listesi düzeltmede
 * bütün olarak değişir (eski satırlar arşivlenir); geçmiş satırı yalnız eklenir.
 */

export interface StoredTripPlan {
  id: string
  sequence: number
  name: string
  purpose: string
  departureAt: string
  returnAt: string
  expectedStudentCount: number
  stops: TripStop[]
  transport: TripTransport
  risks: TripRisk[]
  emergencyContacts: TripContact[]
  paidActivityId: string | null
  paidActivityName: string | null
  paidActivityKind: PaidActivityKind | null
  paidActivityDate: string | null
  paidActivityStatus: 'open' | 'cancelled' | null
  status: TripPlanStatus
  submittedAt: string | null
  approvedAt: string | null
  approvedByUserId: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  authorityNotifiedOn: string | null
  authorityReference: string | null
  completedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdByUserId: string
  createdAt: string
  version: number
}

const COLUMNS = {
  id: tripPlans.id,
  sequence: tripPlans.sequence,
  name: tripPlans.name,
  purpose: tripPlans.purpose,
  departureAt: tripPlans.departureAt,
  returnAt: tripPlans.returnAt,
  expectedStudentCount: tripPlans.expectedStudentCount,
  stops: tripPlans.stops,
  transportType: tripPlans.transportType,
  transportCompany: tripPlans.transportCompany,
  transportPlate: tripPlans.transportPlate,
  driverName: tripPlans.driverName,
  driverPhone: tripPlans.driverPhone,
  transportFileId: tripPlans.transportFileId,
  risks: tripPlans.risks,
  emergencyContacts: tripPlans.emergencyContacts,
  paidActivityId: tripPlans.paidActivityId,
  paidActivityName: paidActivities.name,
  paidActivityKind: sql<PaidActivityKind | null>`${paidActivities.kind}`,
  paidActivityDate: paidActivities.activityDate,
  paidActivityStatus: sql<'open' | 'cancelled' | null>`${paidActivities.status}`,
  status: tripPlans.status,
  submittedAt: tripPlans.submittedAt,
  approvedAt: tripPlans.approvedAt,
  approvedByUserId: tripPlans.approvedByUserId,
  rejectedAt: tripPlans.rejectedAt,
  rejectionReason: tripPlans.rejectionReason,
  authorityNotifiedOn: tripPlans.authorityNotifiedOn,
  authorityReference: tripPlans.authorityReference,
  completedAt: tripPlans.completedAt,
  cancelledAt: tripPlans.cancelledAt,
  cancelReason: tripPlans.cancelReason,
  createdByUserId: tripPlans.createdByUserId,
  createdAt: tripPlans.createdAt,
  version: tripPlans.version,
}

type Row = {
  id: string
  sequence: number
  name: string
  purpose: string
  departureAt: Date
  returnAt: Date
  expectedStudentCount: number
  stops: TripStop[]
  transportType: TripTransportType
  transportCompany: string | null
  transportPlate: string | null
  driverName: string | null
  driverPhone: string | null
  transportFileId: string | null
  risks: TripRisk[]
  emergencyContacts: TripContact[]
  paidActivityId: string | null
  paidActivityName: string | null
  paidActivityKind: PaidActivityKind | null
  paidActivityDate: string | null
  paidActivityStatus: 'open' | 'cancelled' | null
  status: TripPlanStatus
  submittedAt: Date | null
  approvedAt: Date | null
  approvedByUserId: string | null
  rejectedAt: Date | null
  rejectionReason: string | null
  authorityNotifiedOn: string | null
  authorityReference: string | null
  completedAt: Date | null
  cancelledAt: Date | null
  cancelReason: string | null
  createdByUserId: string
  createdAt: Date
  version: number
}

const iso = (value: Date | null) => (value === null ? null : value.toISOString())
function toPlan(row: Row): StoredTripPlan {
  const {
    transportType,
    transportCompany,
    transportPlate,
    driverName,
    driverPhone,
    transportFileId,
    ...rest
  } = row
  return {
    ...rest,
    departureAt: row.departureAt.toISOString(),
    returnAt: row.returnAt.toISOString(),
    transport: {
      type: transportType,
      company: transportCompany,
      plate: transportPlate,
      driverName,
      driverPhone,
      documentFileId: transportFileId,
    },
    submittedAt: iso(row.submittedAt),
    approvedAt: iso(row.approvedAt),
    rejectedAt: iso(row.rejectedAt),
    completedAt: iso(row.completedAt),
    cancelledAt: iso(row.cancelledAt),
    createdAt: row.createdAt.toISOString(),
  }
}

const ofInstitution = (institutionId: string) =>
  and(eq(tripPlans.institutionId, institutionId), isNull(tripPlans.archivedAt))

const withActivity = (db: Database) =>
  db
    .select(COLUMNS)
    .from(tripPlans)
    .leftJoin(
      paidActivities,
      and(
        eq(paidActivities.institutionId, tripPlans.institutionId),
        eq(paidActivities.id, tripPlans.paidActivityId),
      ),
    )

export async function findTripPlan(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredTripPlan | null> {
  const [row] = await withActivity(db)
    .where(and(ofInstitution(institutionId), eq(tripPlans.id, id)))
    .limit(1)
  return row === undefined ? null : toPlan(row)
}

/** Dosya bağlantısının okuma kuralı için: plan kurumda ve arşivlenmemiş mi. */
export async function tripPlanExists(db: Database, institutionId: string, id: string) {
  const [row] = await db
    .select({ id: tripPlans.id })
    .from(tripPlans)
    .where(and(ofInstitution(institutionId), eq(tripPlans.id, id)))
    .limit(1)
  return row !== undefined
}

export interface TripPlanQuery {
  page: number
  pageSize: number
  status?: TripPlanStatus | undefined
  state?: TripPlanState | undefined
  q?: string | undefined
}

/** `GZ-0007` ya da `7` biçiminde aranan sıra numarası; başka metinde `null`. */
function searchedSequence(q: string): number | null {
  const match = /^(?:gz-?)?0*(\d{1,9})$/i.exec(q.trim())
  return match ? Number(match[1]) : null
}

/**
 * Planlar: süren planlar önce; içlerinde çıkışı yakın olan önce, bitenlerde yeni çıkış önce.
 * `q` ad ve plan numarasında arar.
 */
export async function listTripPlans(
  db: Database,
  institutionId: string,
  query: TripPlanQuery,
): Promise<{ items: StoredTripPlan[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const sequence = query.q === undefined ? null : searchedSequence(query.q)
  const done = [...TRIP_PLAN_DONE_STATUSES]
  const where = and(
    ofInstitution(institutionId),
    query.status === undefined ? undefined : eq(tripPlans.status, query.status),
    query.state === undefined
      ? undefined
      : query.state === 'done'
        ? inArray(tripPlans.status, done)
        : notInArray(tripPlans.status, done),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(tripPlans.name)}, ${search}) > 0`,
          sequence === null ? undefined : eq(tripPlans.sequence, sequence),
        ),
  )
  const [totalRow] = await db.select({ total: count() }).from(tripPlans).where(where)
  const finished = sql`${tripPlans.status} in ('completed', 'cancelled')`
  const rows = await withActivity(db)
    .where(where)
    .orderBy(
      finished,
      sql`case when ${finished} then null else ${tripPlans.departureAt} end asc nulls last`,
      desc(tripPlans.departureAt),
      desc(tripPlans.sequence),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toPlan), total: totalRow?.total ?? 0 }
}

/** Kurumun sıradaki plan sırası; kurum kilidi altında çağrılır. */
export async function nextTripPlanSequence(tx: Database, institutionId: string) {
  const [row] = await tx
    .select({ last: max(tripPlans.sequence) })
    .from(tripPlans)
    .where(eq(tripPlans.institutionId, institutionId))
  return (row?.last ?? 0) + 1
}

/** Plan alanlarının yazılacak biçimi (ulaşım kolonlara açılır). */
export interface TripPlanContent {
  name: string
  purpose: string
  departureAt: string
  returnAt: string
  expectedStudentCount: number
  stops: TripStop[]
  transport: TripTransport
  risks: TripRisk[]
  emergencyContacts: TripContact[]
  paidActivityId: string | null
}

function contentColumns(content: Partial<TripPlanContent>) {
  const { transport, departureAt, returnAt, ...rest } = content
  return {
    ...rest,
    ...(departureAt === undefined ? {} : { departureAt: new Date(departureAt) }),
    ...(returnAt === undefined ? {} : { returnAt: new Date(returnAt) }),
    ...(transport === undefined
      ? {}
      : {
          transportType: transport.type,
          transportCompany: transport.company,
          transportPlate: transport.plate,
          driverName: transport.driverName,
          driverPhone: transport.driverPhone,
          transportFileId: transport.documentFileId,
        }),
  }
}

export async function insertTripPlan(
  tx: Database,
  institutionId: string,
  input: TripPlanContent & { id: string; sequence: number; createdByUserId: string; now: Date },
): Promise<void> {
  const { transport, now } = input
  await tx.insert(tripPlans).values({
    institutionId,
    id: input.id,
    sequence: input.sequence,
    name: input.name,
    purpose: input.purpose,
    departureAt: new Date(input.departureAt),
    returnAt: new Date(input.returnAt),
    expectedStudentCount: input.expectedStudentCount,
    stops: input.stops,
    transportType: transport.type,
    transportCompany: transport.company,
    transportPlate: transport.plate,
    driverName: transport.driverName,
    driverPhone: transport.driverPhone,
    transportFileId: transport.documentFileId,
    risks: input.risks,
    emergencyContacts: input.emergencyContacts,
    paidActivityId: input.paidActivityId,
    status: 'draft',
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Durum ve karar alanları; verilmeyen alan değişmez. */
export type TripPlanStateChanges = Partial<{
  status: TripPlanStatus
  submittedAt: Date | null
  approvedAt: Date | null
  approvedByUserId: string | null
  rejectedAt: Date | null
  rejectionReason: string | null
  authorityNotifiedOn: string | null
  authorityReference: string | null
  completedAt: Date
  cancelledAt: Date
  cancelReason: string
}>

/** Plan `where version = beklenen` ile yazılır; sürüm tutmazsa `false` (409). */
export async function updateTripPlan(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    content?: Partial<TripPlanContent>
    changes?: TripPlanStateChanges
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(tripPlans)
    .set({
      ...contentColumns(input.content ?? {}),
      ...input.changes,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        ofInstitution(institutionId),
        eq(tripPlans.id, input.id),
        eq(tripPlans.version, input.expectedVersion),
      ),
    )
    .returning({ id: tripPlans.id })
  return rows.length === 1
}

export interface StoredTripStaff {
  membershipId: string
  role: TripStaffRole
  name: string | null
  memberRole: string | null
}

/** Planların etkin görevlileri, plandaki sırayla; ad ve kurum rolüyle. */
export async function loadTripPlanStaff(
  db: Database,
  institutionId: string,
  planIds: readonly string[],
): Promise<Map<string, StoredTripStaff[]>> {
  const found = new Map<string, StoredTripStaff[]>()
  if (planIds.length === 0) return found
  const rows = await db
    .select({
      planId: tripPlanStaff.planId,
      membershipId: tripPlanStaff.membershipId,
      role: tripPlanStaff.role,
      name: users.name,
      memberRole: memberships.role,
    })
    .from(tripPlanStaff)
    .leftJoin(
      memberships,
      and(
        eq(memberships.institutionId, tripPlanStaff.institutionId),
        eq(memberships.id, tripPlanStaff.membershipId),
      ),
    )
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(tripPlanStaff.institutionId, institutionId),
        isNull(tripPlanStaff.archivedAt),
        inArray(tripPlanStaff.planId, [...new Set(planIds)]),
      ),
    )
    .orderBy(asc(tripPlanStaff.planId), asc(tripPlanStaff.position))
  for (const { planId, ...row } of rows) {
    const list = found.get(planId) ?? []
    list.push(row)
    found.set(planId, list)
  }
  return found
}

/** Görevli listesini bütün olarak yazar: etkin satırlar arşivlenir, yeni liste eklenir. */
export async function replaceTripPlanStaff(
  tx: Database,
  institutionId: string,
  input: { planId: string; staff: readonly TripStaffMember[]; now: Date; ids: () => string },
): Promise<void> {
  await tx
    .update(tripPlanStaff)
    .set({ archivedAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(tripPlanStaff.institutionId, institutionId),
        eq(tripPlanStaff.planId, input.planId),
        isNull(tripPlanStaff.archivedAt),
      ),
    )
  if (input.staff.length === 0) return
  await tx.insert(tripPlanStaff).values(
    input.staff.map((member, position) => ({
      institutionId,
      id: input.ids(),
      planId: input.planId,
      membershipId: member.membershipId,
      role: member.role,
      position,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

/** Görevli adayı üyelikler: kurumda yoksa haritada bulunmaz. */
export async function findStaffMemberships(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<Map<string, { role: string; active: boolean }>> {
  if (membershipIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: memberships.id,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.id, [...new Set(membershipIds)]),
      ),
    )
  return new Map(
    rows.map((row) => [row.id, { role: row.role, active: row.deactivatedAt === null }]),
  )
}

/** Bağlanacak ücretli etkinlik ve iptal edilmemiş başka plana bağlı olup olmadığı. */
export async function findTripActivity(
  db: Database,
  institutionId: string,
  activityId: string,
  planId: string | null,
): Promise<{
  status: 'open' | 'cancelled'
  activityDate: string
  linkedToOtherPlan: boolean
} | null> {
  const [activity] = await db
    .select({
      status: sql<'open' | 'cancelled'>`${paidActivities.status}`,
      activityDate: paidActivities.activityDate,
    })
    .from(paidActivities)
    .where(
      and(
        eq(paidActivities.institutionId, institutionId),
        isNull(paidActivities.archivedAt),
        eq(paidActivities.id, activityId),
      ),
    )
    .limit(1)
  if (activity === undefined) return null
  const [linked] = await db
    .select({ id: tripPlans.id })
    .from(tripPlans)
    .where(
      and(
        ofInstitution(institutionId),
        eq(tripPlans.paidActivityId, activityId),
        ne(tripPlans.status, 'cancelled'),
        planId === null ? undefined : ne(tripPlans.id, planId),
      ),
    )
    .limit(1)
  return { ...activity, linkedToOtherPlan: linked !== undefined }
}

const OPTIONS_LIMIT = 500

/** Görevli seçenekleri: kurumun etkin öğretmen ve yöneticileri, ada göre. */
export async function listTripStaffOptions(db: Database, institutionId: string) {
  return db
    .select({ membershipId: memberships.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.role, [...TRIP_STAFF_MEMBER_ROLES]),
        isNull(memberships.deactivatedAt),
      ),
    )
    .orderBy(asc(foldSql(users.name)), asc(memberships.id))
    .limit(OPTIONS_LIMIT)
}

/** Ücretli etkinlik seçenekleri: iptal edilmemiş, günü bugün ya da sonra; bağlı planla. */
export async function listTripActivityOptions(db: Database, institutionId: string, today: string) {
  const activities = await db
    .select({
      id: paidActivities.id,
      name: paidActivities.name,
      kind: sql<PaidActivityKind>`${paidActivities.kind}`,
      activityDate: paidActivities.activityDate,
    })
    .from(paidActivities)
    .where(
      and(
        eq(paidActivities.institutionId, institutionId),
        isNull(paidActivities.archivedAt),
        eq(paidActivities.status, 'open'),
        gte(paidActivities.activityDate, today),
      ),
    )
    .orderBy(asc(paidActivities.activityDate), asc(paidActivities.name), asc(paidActivities.id))
    .limit(OPTIONS_LIMIT)
  const ids = activities.map((activity) => activity.id)
  const links =
    ids.length === 0
      ? []
      : await db
          .select({ planId: tripPlans.id, activityId: tripPlans.paidActivityId })
          .from(tripPlans)
          .where(
            and(
              ofInstitution(institutionId),
              inArray(tripPlans.paidActivityId, ids),
              ne(tripPlans.status, 'cancelled'),
            ),
          )
  const linked = new Map(links.map((link) => [link.activityId, link.planId]))
  return activities.map((activity) => ({
    ...activity,
    linkedPlanId: linked.get(activity.id) ?? null,
  }))
}

export interface TripPlanEventWrite {
  id: string
  planId: string
  event: TripPlanEvent
  fromStatus: TripPlanStatus | null
  toStatus: TripPlanStatus
  note: string | null
  actorUserId: string
  now: Date
}

export async function insertTripPlanEvent(
  tx: Database,
  institutionId: string,
  input: TripPlanEventWrite,
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(tripPlanEvents).values({
    ...fields,
    institutionId,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

export interface StoredTripPlanEvent {
  id: string
  event: TripPlanEvent
  fromStatus: TripPlanStatus | null
  toStatus: TripPlanStatus
  note: string | null
  actorUserId: string
  occurredAt: string
}

/** Planın geçmişi, eskiden yeniye. */
export async function listTripPlanEvents(
  db: Database,
  institutionId: string,
  planId: string,
): Promise<StoredTripPlanEvent[]> {
  const rows = await db
    .select({
      id: tripPlanEvents.id,
      event: tripPlanEvents.event,
      fromStatus: tripPlanEvents.fromStatus,
      toStatus: tripPlanEvents.toStatus,
      note: tripPlanEvents.note,
      actorUserId: tripPlanEvents.actorUserId,
      occurredAt: tripPlanEvents.occurredAt,
    })
    .from(tripPlanEvents)
    .where(
      and(
        eq(tripPlanEvents.institutionId, institutionId),
        isNull(tripPlanEvents.archivedAt),
        eq(tripPlanEvents.planId, planId),
      ),
    )
    .orderBy(asc(tripPlanEvents.occurredAt), asc(tripPlanEvents.createdAt))
  return rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() }))
}
