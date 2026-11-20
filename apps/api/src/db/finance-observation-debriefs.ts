import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core'

import type { LessonObservationStatus } from '@kampus/school-core/lib/finance-lesson-observations.ts'
import {
  DEVELOPMENT_GOAL_ACTIVE_STATUSES,
  type DevelopmentGoalPatch,
  type DevelopmentGoalSource,
  type DevelopmentGoalStatus,
  type ObservationDebriefPatch,
  type ObservationDebriefStatus,
  type PlannedDevelopmentGoal,
  type PlannedGoalFollowUp,
} from '@kampus/school-core/lib/finance-observation-debriefs.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { lessonObservations } from './schema/finance-lesson-observations.ts'
import {
  observationDebriefParticipants as participants,
  observationDebriefs as debriefs,
  staffDevelopmentGoalNotes as goalNotes,
  staffDevelopmentGoals as goals,
} from './schema/finance-observation-debriefs.ts'
import { performancePeriods } from './schema/finance-performance.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Gözlem sonrası görüşme ve gelişim hedefi deposu (DOM-FIN-133; ON-209). Kurum kapsamlıdır: ilk
 * parametre `institutionId`. Kural core `lib/finance-observation-debriefs.ts`'tedir. Gözlem,
 * üyelik (Better Auth `memberships`, `users`) ve performans dönemi yalnız okunur. Gelişim hedefi
 * genel kayıttır; performans raporu (ON-220) `listDevelopmentGoals` ile okur.
 */

const teacherMembership = alias(memberships, 'teacher_membership')
const teacherUser = alias(users, 'teacher_user')
const observerMembership = alias(memberships, 'observer_membership')
const observerUser = alias(users, 'observer_user')

/** Öğretmen üyeliği birleşimi: gözlemin ya da hedefin öğretmeni, aynı kurum. */
const ON_TEACHER = (membershipId: AnyPgColumn, institutionId: AnyPgColumn) =>
  and(eq(teacherMembership.institutionId, institutionId), eq(teacherMembership.id, membershipId))

// --- Görüşme -------------------------------------------------------------------------------------

export interface StoredDebriefParticipant {
  id: string
  membershipId: string
  name: string
  role: string
  active: boolean
}

export interface StoredObservationDebrief {
  id: string
  observationId: string
  observedDate: string
  observationStatus: LessonObservationStatus
  teacherMembershipId: string
  teacherName: string
  observerMembershipId: string
  observerName: string
  debriefDate: string
  strengths: string | null
  developmentAreas: string | null
  teacherComment: string | null
  status: ObservationDebriefStatus
  finalizedAt: string | null
  participants: StoredDebriefParticipant[]
  createdAt: string
  updatedAt: string
  version: number
}

const DEBRIEF_COLUMNS = {
  id: debriefs.id,
  observationId: debriefs.observationId,
  observedDate: lessonObservations.observedDate,
  observationStatus: lessonObservations.status,
  teacherMembershipId: lessonObservations.teacherMembershipId,
  teacherName: teacherUser.name,
  observerMembershipId: lessonObservations.observerMembershipId,
  observerName: observerUser.name,
  debriefDate: debriefs.debriefDate,
  strengths: debriefs.strengths,
  developmentAreas: debriefs.developmentAreas,
  teacherComment: debriefs.teacherComment,
  status: debriefs.status,
  finalizedAt: debriefs.finalizedAt,
  createdAt: debriefs.createdAt,
  updatedAt: debriefs.updatedAt,
  version: debriefs.version,
}

const debriefBase = (db: Database) =>
  db
    .select(DEBRIEF_COLUMNS)
    .from(debriefs)
    .innerJoin(
      lessonObservations,
      and(
        eq(lessonObservations.institutionId, debriefs.institutionId),
        eq(lessonObservations.id, debriefs.observationId),
      ),
    )
    .innerJoin(
      teacherMembership,
      ON_TEACHER(lessonObservations.teacherMembershipId, lessonObservations.institutionId),
    )
    .innerJoin(teacherUser, eq(teacherUser.id, teacherMembership.userId))
    .innerJoin(
      observerMembership,
      and(
        eq(observerMembership.institutionId, lessonObservations.institutionId),
        eq(observerMembership.id, lessonObservations.observerMembershipId),
      ),
    )
    .innerJoin(observerUser, eq(observerUser.id, observerMembership.userId))

/** Görüşmelerin etkin katılımcıları, ada göre. */
export async function listDebriefParticipants(
  db: Database,
  institutionId: string,
  debriefIds: readonly string[],
): Promise<Map<string, StoredDebriefParticipant[]>> {
  const result = new Map<string, StoredDebriefParticipant[]>()
  if (debriefIds.length === 0) return result
  const rows = await db
    .select({
      debriefId: participants.debriefId,
      id: participants.id,
      membershipId: participants.membershipId,
      name: users.name,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(participants)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, participants.institutionId),
        eq(memberships.id, participants.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(participants.institutionId, institutionId),
        inArray(participants.debriefId, [...new Set(debriefIds)]),
        isNull(participants.archivedAt),
      ),
    )
    .orderBy(asc(foldSql(users.name)), asc(participants.id))
  for (const row of rows) {
    const list = result.get(row.debriefId) ?? []
    list.push({
      id: row.id,
      membershipId: row.membershipId,
      name: row.name,
      role: row.role,
      active: row.deactivatedAt === null,
    })
    result.set(row.debriefId, list)
  }
  return result
}

type DebriefRow = Omit<
  StoredObservationDebrief,
  'participants' | 'finalizedAt' | 'createdAt' | 'updatedAt'
> & { finalizedAt: Date | null; createdAt: Date; updatedAt: Date }

async function withParticipants(
  db: Database,
  institutionId: string,
  row: DebriefRow | undefined,
): Promise<StoredObservationDebrief | null> {
  if (row === undefined) return null
  const people = await listDebriefParticipants(db, institutionId, [row.id])
  return {
    ...row,
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    participants: people.get(row.id) ?? [],
  }
}

/** Görüşme (arşivlenmemiş gözlemin); kurumda yoksa `null`. */
export async function findObservationDebrief(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredObservationDebrief | null> {
  const [row] = await debriefBase(db)
    .where(
      and(
        eq(debriefs.institutionId, institutionId),
        eq(debriefs.id, id),
        isNull(lessonObservations.archivedAt),
      ),
    )
    .limit(1)
  return withParticipants(db, institutionId, row)
}

/** Gözlemin görüşmesi; yoksa `null` (gözlem başına en çok bir; K-454). */
export async function findDebriefByObservation(
  db: Database,
  institutionId: string,
  observationId: string,
): Promise<StoredObservationDebrief | null> {
  const [row] = await debriefBase(db)
    .where(
      and(eq(debriefs.institutionId, institutionId), eq(debriefs.observationId, observationId)),
    )
    .limit(1)
  return withParticipants(db, institutionId, row)
}

export interface DebriefMember {
  membershipId: string
  role: string
  active: boolean
}

/** Kurumdaki üyelikler (rol, etkin mi); bulunamayan kimlik eşlemede yoktur. */
export async function findDebriefMembers(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<Map<string, DebriefMember>> {
  const result = new Map<string, DebriefMember>()
  if (membershipIds.length === 0) return result
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
  for (const row of rows)
    result.set(row.id, {
      membershipId: row.id,
      role: row.role,
      active: row.deactivatedAt === null,
    })
  return result
}

async function syncParticipants(
  tx: Database,
  institutionId: string,
  input: {
    debriefId: string
    previous: readonly StoredDebriefParticipant[]
    next: readonly string[]
    newId: () => string
    now: Date
  },
): Promise<void> {
  const nextIds = new Set(input.next)
  const known = new Set(input.previous.map((row) => row.membershipId))
  const removed = input.previous.filter((row) => !nextIds.has(row.membershipId))
  if (removed.length > 0)
    await tx
      .update(participants)
      .set({ archivedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(participants.institutionId, institutionId),
          inArray(
            participants.id,
            removed.map((row) => row.id),
          ),
        ),
      )
  const added = input.next.filter((id) => !known.has(id))
  if (added.length > 0)
    await tx.insert(participants).values(
      added.map((membershipId) => ({
        institutionId,
        id: input.newId(),
        debriefId: input.debriefId,
        membershipId,
        createdAt: input.now,
        updatedAt: input.now,
      })),
    )
}

export async function insertObservationDebrief(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    observationId: string
    debriefDate: string
    participantMembershipIds: readonly string[]
    strengths: string | null
    developmentAreas: string | null
    teacherComment: string | null
    newId: () => string
    userId: string
    now: Date
  },
): Promise<void> {
  const { now } = input
  await tx.insert(debriefs).values({
    institutionId,
    id: input.id,
    observationId: input.observationId,
    debriefDate: input.debriefDate,
    strengths: input.strengths,
    developmentAreas: input.developmentAreas,
    teacherComment: input.teacherComment,
    createdByUserId: input.userId,
    createdAt: now,
    updatedAt: now,
  })
  await syncParticipants(tx, institutionId, {
    debriefId: input.id,
    previous: [],
    next: input.participantMembershipIds,
    newId: input.newId,
    now,
  })
}

/** Taslak düzeltmesi; yalnız taslak ve sürüm tutarsa yazar, değilse `false` (409). */
export async function updateObservationDebrief(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    patch: ObservationDebriefPatch
    previousParticipants: readonly StoredDebriefParticipant[]
    newId: () => string
    now: Date
  },
): Promise<boolean> {
  const { participantMembershipIds, ...fields } = input.patch
  const rows = await tx
    .update(debriefs)
    .set({ ...fields, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(debriefs.institutionId, institutionId),
        eq(debriefs.id, input.id),
        eq(debriefs.version, input.expectedVersion),
        eq(debriefs.status, 'draft'),
      ),
    )
    .returning({ id: debriefs.id })
  if (rows.length !== 1) return false
  if (participantMembershipIds !== undefined)
    await syncParticipants(tx, institutionId, {
      debriefId: input.id,
      previous: input.previousParticipants,
      next: participantMembershipIds,
      newId: input.newId,
      now: input.now,
    })
  return true
}

/** Kesinleştirme (K-454); yalnız taslak ve sürüm tutarsa. */
export async function finalizeObservationDebrief(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(debriefs)
    .set({
      status: 'finalized',
      finalizedAt: input.now,
      finalizedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(debriefs.institutionId, institutionId),
        eq(debriefs.id, input.id),
        eq(debriefs.version, input.expectedVersion),
        eq(debriefs.status, 'draft'),
      ),
    )
    .returning({ id: debriefs.id })
  return rows.length === 1
}

// --- Gelişim hedefi ------------------------------------------------------------------------------

export interface StoredDevelopmentGoal {
  id: string
  teacherMembershipId: string
  teacherName: string
  source: DevelopmentGoalSource
  debriefId: string | null
  observationId: string | null
  observedDate: string | null
  observerMembershipId: string | null
  performancePeriodId: string | null
  performancePeriodName: string | null
  title: string
  successCriterion: string
  followUpDate: string
  status: DevelopmentGoalStatus
  closedAt: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const GOAL_COLUMNS = {
  id: goals.id,
  teacherMembershipId: goals.teacherMembershipId,
  teacherName: teacherUser.name,
  source: goals.source,
  debriefId: goals.debriefId,
  observationId: debriefs.observationId,
  observedDate: lessonObservations.observedDate,
  observerMembershipId: lessonObservations.observerMembershipId,
  performancePeriodId: goals.performancePeriodId,
  performancePeriodName: performancePeriods.name,
  title: goals.title,
  successCriterion: goals.successCriterion,
  followUpDate: goals.followUpDate,
  status: goals.status,
  closedAt: goals.closedAt,
  createdAt: goals.createdAt,
  updatedAt: goals.updatedAt,
  version: goals.version,
}

type GoalRow = Omit<StoredDevelopmentGoal, 'closedAt' | 'createdAt' | 'updatedAt'> & {
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toGoal = (row: GoalRow): StoredDevelopmentGoal => ({
  ...row,
  closedAt: row.closedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const goalBase = (db: Database) =>
  db
    .select(GOAL_COLUMNS)
    .from(goals)
    .innerJoin(teacherMembership, ON_TEACHER(goals.teacherMembershipId, goals.institutionId))
    .innerJoin(teacherUser, eq(teacherUser.id, teacherMembership.userId))
    .leftJoin(
      debriefs,
      and(eq(debriefs.institutionId, goals.institutionId), eq(debriefs.id, goals.debriefId)),
    )
    .leftJoin(
      lessonObservations,
      and(
        eq(lessonObservations.institutionId, debriefs.institutionId),
        eq(lessonObservations.id, debriefs.observationId),
      ),
    )
    .leftJoin(
      performancePeriods,
      and(
        eq(performancePeriods.institutionId, goals.institutionId),
        eq(performancePeriods.id, goals.performancePeriodId),
      ),
    )

const goalCount = (db: Database) =>
  db
    .select({ total: count() })
    .from(goals)
    .innerJoin(teacherMembership, ON_TEACHER(goals.teacherMembershipId, goals.institutionId))
    .innerJoin(teacherUser, eq(teacherUser.id, teacherMembership.userId))
    .leftJoin(
      debriefs,
      and(eq(debriefs.institutionId, goals.institutionId), eq(debriefs.id, goals.debriefId)),
    )
    .leftJoin(
      lessonObservations,
      and(
        eq(lessonObservations.institutionId, debriefs.institutionId),
        eq(lessonObservations.id, debriefs.observationId),
      ),
    )

/**
 * Öğretmenin görebildiği hedefler (K-456): kendi hedefi ve gözlemcisi olduğu gözlemin görüşmesinden
 * doğan hedef. Yönetici için süzgeç yoktur (`null`). Core `canViewDevelopmentGoal` ile aynıdır.
 */
const goalVisibleTo = (viewerMembershipId: string | null): SQL | undefined =>
  viewerMembershipId === null
    ? undefined
    : or(
        eq(goals.teacherMembershipId, viewerMembershipId),
        eq(lessonObservations.observerMembershipId, viewerMembershipId),
      )

export async function findDevelopmentGoal(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredDevelopmentGoal | null> {
  const [row] = await goalBase(db)
    .where(and(eq(goals.institutionId, institutionId), eq(goals.id, id)))
    .limit(1)
  return row === undefined ? null : toGoal(row)
}

export interface DevelopmentGoalQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: DevelopmentGoalStatus | undefined
  teacherMembershipId?: string | undefined
  performancePeriodId?: string | undefined
  debriefId?: string | undefined
  /** Verilirse yalnız takip tarihi bu günden önce olan süren hedefler (K-455). */
  overdueBefore?: string | undefined
}

/**
 * Gelişim hedefleri, takip tarihi yakın önce; arama öğretmen adında. `viewerMembershipId`
 * öğretmen süzgecidir. Performans raporu (ON-220) dönem ya da öğretmen süzgeciyle okur.
 */
export async function listDevelopmentGoals(
  db: Database,
  institutionId: string,
  query: DevelopmentGoalQuery,
  viewerMembershipId: string | null,
): Promise<{ items: StoredDevelopmentGoal[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    eq(goals.institutionId, institutionId),
    goalVisibleTo(viewerMembershipId),
    query.status === undefined ? undefined : eq(goals.status, query.status),
    query.teacherMembershipId === undefined
      ? undefined
      : eq(goals.teacherMembershipId, query.teacherMembershipId),
    query.performancePeriodId === undefined
      ? undefined
      : eq(goals.performancePeriodId, query.performancePeriodId),
    query.debriefId === undefined ? undefined : eq(goals.debriefId, query.debriefId),
    query.overdueBefore === undefined
      ? undefined
      : and(
          inArray(goals.status, [...DEVELOPMENT_GOAL_ACTIVE_STATUSES]),
          lt(goals.followUpDate, query.overdueBefore),
        ),
    search === undefined ? undefined : sql`strpos(${foldSql(teacherUser.name)}, ${search}) > 0`,
  )
  const [totalRow] = await goalCount(db).where(where)
  const rows = await goalBase(db)
    .where(where)
    .orderBy(asc(goals.followUpDate), desc(goals.createdAt), asc(goals.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toGoal), total: totalRow?.total ?? 0 }
}

export interface StoredGoalNote {
  id: string
  note: string
  statusFrom: DevelopmentGoalStatus
  statusTo: DevelopmentGoalStatus | null
  nextFollowUpDate: string | null
  authorName: string | null
  createdAt: string
}

/** Hedefin takip geçmişi, eskiden yeniye. */
export async function listGoalNotes(
  db: Database,
  institutionId: string,
  goalId: string,
): Promise<StoredGoalNote[]> {
  const rows = await db
    .select({
      id: goalNotes.id,
      note: goalNotes.note,
      statusFrom: goalNotes.statusFrom,
      statusTo: goalNotes.statusTo,
      nextFollowUpDate: goalNotes.nextFollowUpDate,
      authorName: users.name,
      createdAt: goalNotes.createdAt,
    })
    .from(goalNotes)
    .leftJoin(users, eq(users.id, goalNotes.createdByUserId))
    .where(and(eq(goalNotes.institutionId, institutionId), eq(goalNotes.goalId, goalId)))
    .orderBy(asc(goalNotes.createdAt), asc(goalNotes.id))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export async function insertDevelopmentGoal(
  tx: Database,
  institutionId: string,
  input: PlannedDevelopmentGoal & { id: string; userId: string; now: Date },
): Promise<void> {
  const { id, userId, now, ...goal } = input
  await tx.insert(goals).values({
    institutionId,
    id,
    ...goal,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Süren hedefin düzeltmesi; yalnız süren ve sürüm tutarsa yazar, değilse `false` (409). */
export async function updateDevelopmentGoal(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; patch: DevelopmentGoalPatch; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(goals)
    .set({ ...input.patch, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(goals.institutionId, institutionId),
        eq(goals.id, input.id),
        eq(goals.version, input.expectedVersion),
        inArray(goals.status, [...DEVELOPMENT_GOAL_ACTIVE_STATUSES]),
      ),
    )
    .returning({ id: goals.id })
  return rows.length === 1
}

/**
 * Takip notu (K-455): hedefin durumu ve takip tarihi notla birlikte ilerler, not geçmişe değişmez
 * satır olarak eklenir. Hedef süren değilse ya da sürüm tutmazsa `false` (409).
 */
export async function addGoalFollowUp(
  tx: Database,
  institutionId: string,
  input: {
    goalId: string
    noteId: string
    expectedVersion: number
    plan: PlannedGoalFollowUp
    closing: boolean
    userId: string
    now: Date
  },
): Promise<boolean> {
  const { plan, now } = input
  const rows = await tx
    .update(goals)
    .set({
      ...(plan.statusTo === null ? {} : { status: plan.statusTo }),
      ...(plan.nextFollowUpDate === null ? {} : { followUpDate: plan.nextFollowUpDate }),
      ...(input.closing ? { closedAt: now } : {}),
      updatedAt: now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(goals.institutionId, institutionId),
        eq(goals.id, input.goalId),
        eq(goals.version, input.expectedVersion),
        inArray(goals.status, [...DEVELOPMENT_GOAL_ACTIVE_STATUSES]),
      ),
    )
    .returning({ id: goals.id })
  if (rows.length !== 1) return false
  await tx.insert(goalNotes).values({
    institutionId,
    id: input.noteId,
    goalId: input.goalId,
    note: plan.note,
    statusFrom: plan.statusFrom,
    statusTo: plan.statusTo,
    nextFollowUpDate: plan.nextFollowUpDate,
    createdByUserId: input.userId,
    createdAt: now,
    updatedAt: now,
  })
  return true
}
