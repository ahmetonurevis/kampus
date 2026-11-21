import { and, asc, eq, inArray, isNull, max, ne } from 'drizzle-orm'

import type {
  TripDayCheckStatus,
  TripDayMarkStatus,
} from '@kampus/school-core/lib/finance-trip-day.ts'
import type { TripPlanStatus } from '@kampus/school-core/lib/finance-trip-plans.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import {
  tripDayCheckMarks,
  tripDayChecks,
  tripDayGroups,
  tripDayMembers,
} from './schema/finance-trip-day.ts'
import { tripPlans } from './schema/finance-trip-plans.ts'

/**
 * Gezi günü deposu (DOM-FIN-154; ON-157). Kurum kapsamlıdır: ilk parametre `institutionId`; arşivli
 * satır okunmaz. Kural core `lib/finance-trip-day.ts`'tedir; depo yalnız okur ve yazar. Sürümlü
 * güncelleme tutmazsa `false` döner (servis 409 verir).
 */

const g = tripDayGroups
const m = tripDayMembers
const c = tripDayChecks
const k = tripDayCheckMarks

// --- Grup ----------------------------------------------------------------------------------------

export interface StoredTripDayGroup {
  id: string
  planId: string
  name: string
  vehiclePlate: string | null
  leaderMembershipId: string
  leaderName: string | null
  position: number
  version: number
}

const GROUP_COLUMNS = {
  id: g.id,
  planId: g.planId,
  name: g.name,
  vehiclePlate: g.vehiclePlate,
  leaderMembershipId: g.leaderMembershipId,
  leaderName: users.name,
  position: g.position,
  version: g.version,
}

const groupSelect = (db: Database) =>
  db
    .select(GROUP_COLUMNS)
    .from(g)
    .leftJoin(
      memberships,
      and(eq(memberships.institutionId, g.institutionId), eq(memberships.id, g.leaderMembershipId)),
    )
    .leftJoin(users, eq(users.id, memberships.userId))

/** Planın etkin grupları, sırasıyla. */
export async function loadTripDayGroups(
  db: Database,
  institutionId: string,
  planId: string,
): Promise<StoredTripDayGroup[]> {
  return groupSelect(db)
    .where(and(eq(g.institutionId, institutionId), eq(g.planId, planId), isNull(g.archivedAt)))
    .orderBy(asc(g.position), asc(g.id))
}

export async function findTripDayGroup(
  db: Database,
  institutionId: string,
  planId: string,
  groupId: string,
): Promise<StoredTripDayGroup | null> {
  const [row] = await groupSelect(db)
    .where(
      and(
        eq(g.institutionId, institutionId),
        eq(g.planId, planId),
        eq(g.id, groupId),
        isNull(g.archivedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function nextTripDayGroupPosition(
  tx: Database,
  institutionId: string,
  planId: string,
) {
  const [row] = await tx
    .select({ max: max(g.position) })
    .from(g)
    .where(and(eq(g.institutionId, institutionId), eq(g.planId, planId)))
  return row?.max === null || row?.max === undefined ? 0 : row.max + 1
}

export async function insertTripDayGroup(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    planId: string
    name: string
    vehiclePlate: string | null
    leaderMembershipId: string
    position: number
    now: Date
  },
) {
  const { now, ...values } = input
  await tx.insert(g).values({ ...values, institutionId, createdAt: now, updatedAt: now })
}

export async function updateTripDayGroup(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<{ name: string; vehiclePlate: string | null; leaderMembershipId: string }>
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(g)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(g.institutionId, institutionId),
        eq(g.id, input.id),
        isNull(g.archivedAt),
        eq(g.version, input.expectedVersion),
      ),
    )
    .returning({ id: g.id })
  return rows.length === 1
}

/** Grubu ve öğrenci satırlarını arşivler (öğrenciler grupsuz kalır). */
export async function archiveTripDayGroup(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(g)
    .set({ archivedAt: input.now, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(g.institutionId, institutionId),
        eq(g.id, input.id),
        isNull(g.archivedAt),
        eq(g.version, input.expectedVersion),
      ),
    )
    .returning({ id: g.id })
  if (rows.length !== 1) return false
  await tx
    .update(m)
    .set({ archivedAt: input.now, updatedAt: input.now })
    .where(and(eq(m.institutionId, institutionId), eq(m.groupId, input.id), isNull(m.archivedAt)))
  return true
}

// --- Öğrenciler ----------------------------------------------------------------------------------

export interface StoredTripDayMember {
  id: string
  groupId: string
  studentId: string
  version: number
}

/** Planın etkin grup üyelikleri. */
export async function loadTripDayMembers(
  db: Database,
  institutionId: string,
  planId: string,
): Promise<StoredTripDayMember[]> {
  return db
    .select({ id: m.id, groupId: m.groupId, studentId: m.studentId, version: m.version })
    .from(m)
    .where(and(eq(m.institutionId, institutionId), eq(m.planId, planId), isNull(m.archivedAt)))
    .orderBy(asc(m.studentId))
}

export async function insertTripDayMembers(
  tx: Database,
  institutionId: string,
  input: {
    planId: string
    groupId: string
    studentIds: readonly string[]
    now: Date
    ids: () => string
  },
) {
  if (input.studentIds.length === 0) return
  await tx.insert(m).values(
    input.studentIds.map((studentId) => ({
      institutionId,
      id: input.ids(),
      planId: input.planId,
      groupId: input.groupId,
      studentId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

/** Öğrencileri başka gruba taşır (satır güncellenir, sürüm artar). */
export async function moveTripDayMembers(
  tx: Database,
  institutionId: string,
  input: { planId: string; groupId: string; studentIds: readonly string[]; now: Date },
) {
  if (input.studentIds.length === 0) return
  const rows = await tx
    .select({ id: m.id, version: m.version })
    .from(m)
    .where(
      and(
        eq(m.institutionId, institutionId),
        eq(m.planId, input.planId),
        isNull(m.archivedAt),
        inArray(m.studentId, [...input.studentIds]),
      ),
    )
  for (const row of rows)
    await tx
      .update(m)
      .set({ groupId: input.groupId, updatedAt: input.now, version: row.version + 1 })
      .where(and(eq(m.institutionId, institutionId), eq(m.id, row.id)))
}

export async function archiveTripDayMembers(
  tx: Database,
  institutionId: string,
  input: { planId: string; studentIds: readonly string[]; now: Date },
) {
  if (input.studentIds.length === 0) return
  await tx
    .update(m)
    .set({ archivedAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(m.institutionId, institutionId),
        eq(m.planId, input.planId),
        isNull(m.archivedAt),
        inArray(m.studentId, [...input.studentIds]),
      ),
    )
}

// --- Tur -----------------------------------------------------------------------------------------

export interface StoredTripDayCheck {
  id: string
  planId: string
  groupId: string
  sequence: number
  checkpoint: string
  status: TripDayCheckStatus
  startedAt: Date
  startedByUserId: string
  closedAt: Date | null
  closedByUserId: string | null
  missingCount: number | null
  missingReason: string | null
  version: number
}

const CHECK_COLUMNS = {
  id: c.id,
  planId: c.planId,
  groupId: c.groupId,
  sequence: c.sequence,
  checkpoint: c.checkpoint,
  status: c.status,
  startedAt: c.startedAt,
  startedByUserId: c.startedByUserId,
  closedAt: c.closedAt,
  closedByUserId: c.closedByUserId,
  missingCount: c.missingCount,
  missingReason: c.missingReason,
  version: c.version,
}

/** Planın (verilirse yalnız bu grupların) turları, grup ve sıraya göre. */
export async function loadTripDayChecks(
  db: Database,
  institutionId: string,
  planId: string,
  groupIds?: readonly string[],
): Promise<StoredTripDayCheck[]> {
  if (groupIds?.length === 0) return []
  return db
    .select(CHECK_COLUMNS)
    .from(c)
    .where(
      and(
        eq(c.institutionId, institutionId),
        eq(c.planId, planId),
        isNull(c.archivedAt),
        groupIds === undefined ? undefined : inArray(c.groupId, [...groupIds]),
      ),
    )
    .orderBy(asc(c.groupId), asc(c.sequence))
}

export async function findTripDayCheck(
  db: Database,
  institutionId: string,
  planId: string,
  checkId: string,
): Promise<StoredTripDayCheck | null> {
  const [row] = await db
    .select(CHECK_COLUMNS)
    .from(c)
    .where(
      and(
        eq(c.institutionId, institutionId),
        eq(c.planId, planId),
        eq(c.id, checkId),
        isNull(c.archivedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function insertTripDayCheck(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    planId: string
    groupId: string
    sequence: number
    checkpoint: string
    userId: string
    now: Date
  },
) {
  const { userId, now, ...values } = input
  await tx.insert(c).values({
    ...values,
    institutionId,
    status: 'open',
    startedAt: now,
    startedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Süren turu kapatır; sürüm tutmazsa ya da tur kapanmışsa `false`. */
export async function closeTripDayCheck(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    status: Exclude<TripDayCheckStatus, 'open'>
    missingCount: number
    missingReason: string | null
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(c)
    .set({
      status: input.status,
      closedAt: input.now,
      closedByUserId: input.userId,
      missingCount: input.missingCount,
      missingReason: input.missingReason,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(c.institutionId, institutionId),
        eq(c.id, input.id),
        eq(c.status, 'open'),
        eq(c.version, input.expectedVersion),
      ),
    )
    .returning({ id: c.id })
  return rows.length === 1
}

// --- İşaret --------------------------------------------------------------------------------------

export interface StoredTripDayMark {
  id: string
  checkId: string
  studentId: string
  status: TripDayMarkStatus
  markedAt: Date
  version: number
}

const MARK_COLUMNS = {
  id: k.id,
  checkId: k.checkId,
  studentId: k.studentId,
  status: k.status,
  markedAt: k.markedAt,
  version: k.version,
}

export async function loadTripDayMarks(
  db: Database,
  institutionId: string,
  checkIds: readonly string[],
): Promise<StoredTripDayMark[]> {
  if (checkIds.length === 0) return []
  return db
    .select(MARK_COLUMNS)
    .from(k)
    .where(
      and(
        eq(k.institutionId, institutionId),
        isNull(k.archivedAt),
        inArray(k.checkId, [...new Set(checkIds)]),
      ),
    )
}

export async function insertTripDayMark(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    checkId: string
    studentId: string
    status: TripDayMarkStatus
    markedAt: Date
    userId: string
    now: Date
  },
) {
  const { userId, now, ...values } = input
  await tx.insert(k).values({
    ...values,
    institutionId,
    markedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateTripDayMark(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    status: TripDayMarkStatus
    markedAt: Date
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(k)
    .set({
      status: input.status,
      markedAt: input.markedAt,
      markedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(k.institutionId, institutionId),
        eq(k.id, input.id),
        isNull(k.archivedAt),
        eq(k.version, input.expectedVersion),
      ),
    )
    .returning({ id: k.id })
  return rows.length === 1
}

// --- Veli görünümü -------------------------------------------------------------------------------

export interface StudentTripDayMark {
  studentId: string
  planId: string
  planName: string
  planStatus: TripPlanStatus
  departureAt: Date
  returnAt: Date
  groupId: string
  groupName: string
  leaderMembershipId: string
  checkpoint: string
  sequence: number
  closedAt: Date
  status: TripDayMarkStatus
}

/**
 * Öğrencilerin, iptal edilmemiş planlardaki kapanmış turlardaki işaretleri (K-519). Grup arşivlense
 * de geçmiş işaret okunur; plan çıkış–dönüş süzgeci serviste uygulanır.
 */
export async function loadStudentTripDayMarks(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<StudentTripDayMark[]> {
  if (studentIds.length === 0) return []
  const rows = await db
    .select({
      studentId: k.studentId,
      planId: tripPlans.id,
      planName: tripPlans.name,
      planStatus: tripPlans.status,
      departureAt: tripPlans.departureAt,
      returnAt: tripPlans.returnAt,
      groupId: g.id,
      groupName: g.name,
      leaderMembershipId: g.leaderMembershipId,
      checkpoint: c.checkpoint,
      sequence: c.sequence,
      closedAt: c.closedAt,
      status: k.status,
    })
    .from(k)
    .innerJoin(
      c,
      and(eq(c.institutionId, k.institutionId), eq(c.id, k.checkId), isNull(c.archivedAt)),
    )
    .innerJoin(g, and(eq(g.institutionId, c.institutionId), eq(g.id, c.groupId)))
    .innerJoin(
      tripPlans,
      and(
        eq(tripPlans.institutionId, c.institutionId),
        eq(tripPlans.id, c.planId),
        isNull(tripPlans.archivedAt),
        ne(tripPlans.status, 'cancelled'),
      ),
    )
    .where(
      and(
        eq(k.institutionId, institutionId),
        isNull(k.archivedAt),
        ne(c.status, 'open'),
        inArray(k.studentId, [...new Set(studentIds)]),
      ),
    )
    .orderBy(asc(c.closedAt))
  return rows.flatMap(({ closedAt, ...row }) => (closedAt === null ? [] : [{ ...row, closedAt }]))
}

export interface StudentTripDayGroup {
  studentId: string
  planId: string
  planName: string
  departureAt: Date
  returnAt: Date
  groupName: string
  leaderMembershipId: string
}

/** Öğrencilerin iptal edilmemiş planlardaki etkin grupları (K-519). */
export async function loadStudentTripDayGroups(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<StudentTripDayGroup[]> {
  if (studentIds.length === 0) return []
  return db
    .select({
      studentId: m.studentId,
      planId: tripPlans.id,
      planName: tripPlans.name,
      departureAt: tripPlans.departureAt,
      returnAt: tripPlans.returnAt,
      groupName: g.name,
      leaderMembershipId: g.leaderMembershipId,
    })
    .from(m)
    .innerJoin(
      g,
      and(eq(g.institutionId, m.institutionId), eq(g.id, m.groupId), isNull(g.archivedAt)),
    )
    .innerJoin(
      tripPlans,
      and(
        eq(tripPlans.institutionId, m.institutionId),
        eq(tripPlans.id, m.planId),
        isNull(tripPlans.archivedAt),
        ne(tripPlans.status, 'cancelled'),
      ),
    )
    .where(
      and(
        eq(m.institutionId, institutionId),
        isNull(m.archivedAt),
        inArray(m.studentId, [...new Set(studentIds)]),
      ),
    )
}

/** Kullanıcı adları (turu açan ve kapatan). */
export async function userNames(
  db: Database,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]))
  return new Map(rows.map((row) => [row.id, row.name]))
}
