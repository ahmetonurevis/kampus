import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'

import {
  isPerformanceScored,
  type PerformanceGoal,
  type PerformancePeriodStatus,
  type PerformanceReviewPatch,
} from '@kampus/school-core/lib/finance-performance.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { performancePeriods, performanceReviews } from './schema/finance-performance.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Performans dönemi deposu (DOM-FIN-124; ON-211). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-performance.ts`'tedir. Personel üyelikten (Better Auth
 * `memberships`, `users`) yalnız okunur.
 */

export interface StoredPerformancePeriod {
  id: string
  name: string
  startDate: string
  endDate: string
  status: PerformancePeriodStatus
  closedAt: string | null
  createdAt: string
  version: number
}

const PERIOD_COLUMNS = {
  id: performancePeriods.id,
  name: performancePeriods.name,
  startDate: performancePeriods.startDate,
  endDate: performancePeriods.endDate,
  status: performancePeriods.status,
  closedAt: performancePeriods.closedAt,
  createdAt: performancePeriods.createdAt,
  version: performancePeriods.version,
}

const toPeriod = (row: {
  id: string
  name: string
  startDate: string
  endDate: string
  status: PerformancePeriodStatus
  closedAt: Date | null
  createdAt: Date
  version: number
}): StoredPerformancePeriod => ({
  ...row,
  closedAt: row.closedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

const periodOf = (institutionId: string) => eq(performancePeriods.institutionId, institutionId)
const reviewOf = (institutionId: string) => eq(performanceReviews.institutionId, institutionId)

export async function findPerformancePeriod(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPerformancePeriod | null> {
  const [row] = await db
    .select(PERIOD_COLUMNS)
    .from(performancePeriods)
    .where(and(periodOf(institutionId), eq(performancePeriods.id, id)))
    .limit(1)
  return row === undefined ? null : toPeriod(row)
}

export interface PerformancePeriodQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: PerformancePeriodStatus | undefined
}

/** Dönemler, yeni başlangıç önce; arama dönem adında. */
export async function listPerformancePeriods(
  db: Database,
  institutionId: string,
  query: PerformancePeriodQuery,
): Promise<{ items: StoredPerformancePeriod[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    periodOf(institutionId),
    search === undefined
      ? undefined
      : sql`strpos(${foldSql(performancePeriods.name)}, ${search}) > 0`,
    query.status === undefined ? undefined : eq(performancePeriods.status, query.status),
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(performancePeriods).where(where)
  const rows = await db
    .select(PERIOD_COLUMNS)
    .from(performancePeriods)
    .where(where)
    .orderBy(desc(performancePeriods.startDate), asc(performancePeriods.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toPeriod), total: totalRow?.total ?? 0 }
}

/** Dönem başına kayıt ve puanı tamamlanmış kayıt sayısı (puanlar jsonb'den okunur). */
export async function performanceProgress(
  db: Database,
  institutionId: string,
  periodIds: readonly string[],
): Promise<Map<string, { reviewCount: number; scoredCount: number }>> {
  const progress = new Map<string, { reviewCount: number; scoredCount: number }>()
  if (periodIds.length === 0) return progress
  const rows = await db
    .select({ periodId: performanceReviews.periodId, goals: performanceReviews.goals })
    .from(performanceReviews)
    .where(
      and(reviewOf(institutionId), inArray(performanceReviews.periodId, [...new Set(periodIds)])),
    )
  for (const row of rows) {
    const current = progress.get(row.periodId) ?? { reviewCount: 0, scoredCount: 0 }
    current.reviewCount += 1
    if (isPerformanceScored(row.goals)) current.scoredCount += 1
    progress.set(row.periodId, current)
  }
  return progress
}

export async function insertPerformancePeriod(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    name: string
    startDate: string
    endDate: string
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx
    .insert(performancePeriods)
    .values({ institutionId, ...rest, createdAt: now, updatedAt: now })
}

/** Aşama geçişi; sürüm tutmazsa `false` (409). Kapanışta kapatan ve an yazılır. */
export async function updatePerformancePeriodStatus(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    status: PerformancePeriodStatus
    userId: string
    now: Date
  },
): Promise<boolean> {
  const closing = input.status === 'closed'
  const rows = await tx
    .update(performancePeriods)
    .set({
      status: input.status,
      closedAt: closing ? input.now : null,
      closedByUserId: closing ? input.userId : null,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        periodOf(institutionId),
        eq(performancePeriods.id, input.id),
        eq(performancePeriods.version, input.expectedVersion),
      ),
    )
    .returning({ id: performancePeriods.id })
  return rows.length === 1
}

export interface StoredPerformanceReview {
  id: string
  periodId: string
  membershipId: string
  staffName: string
  staffRole: string
  goals: PerformanceGoal[]
  interimNote: string | null
  interimDate: string | null
  evaluatorName: string | null
  evaluatedAt: string | null
  staffComment: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const REVIEW_COLUMNS = {
  id: performanceReviews.id,
  periodId: performanceReviews.periodId,
  membershipId: performanceReviews.membershipId,
  staffName: users.name,
  staffRole: memberships.role,
  goals: performanceReviews.goals,
  interimNote: performanceReviews.interimNote,
  interimDate: performanceReviews.interimDate,
  evaluatorName: performanceReviews.evaluatorName,
  evaluatedAt: performanceReviews.evaluatedAt,
  staffComment: performanceReviews.staffComment,
  createdAt: performanceReviews.createdAt,
  updatedAt: performanceReviews.updatedAt,
  version: performanceReviews.version,
}

type ReviewRow = Omit<StoredPerformanceReview, 'evaluatedAt' | 'createdAt' | 'updatedAt'> & {
  evaluatedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toReview = (row: ReviewRow): StoredPerformanceReview => ({
  ...row,
  evaluatedAt: row.evaluatedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const reviewBase = (db: Database) =>
  db
    .select(REVIEW_COLUMNS)
    .from(performanceReviews)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, performanceReviews.institutionId),
        eq(memberships.id, performanceReviews.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))

export async function findPerformanceReview(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPerformanceReview | null> {
  const [row] = await reviewBase(db)
    .where(and(reviewOf(institutionId), eq(performanceReviews.id, id)))
    .limit(1)
  return row === undefined ? null : toReview(row)
}

/** Dönemin kayıtları, personel adına göre; arama personel adında. */
export async function listPerformanceReviews(
  db: Database,
  institutionId: string,
  periodId: string,
  query: { page: number; pageSize: number; q?: string | undefined },
): Promise<{ items: StoredPerformanceReview[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    reviewOf(institutionId),
    eq(performanceReviews.periodId, periodId),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(performanceReviews)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, performanceReviews.institutionId),
        eq(memberships.id, performanceReviews.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
  const rows = await reviewBase(db)
    .where(where)
    .orderBy(asc(foldSql(users.name)), asc(performanceReviews.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toReview), total: totalRow?.total ?? 0 }
}

/** Dönemde puanı eksik kayıt sayısı (kapanış ön şartı; K-427). */
export async function unscoredReviewCount(
  db: Database,
  institutionId: string,
  periodId: string,
): Promise<number> {
  const progress = await performanceProgress(db, institutionId, [periodId])
  const current = progress.get(periodId)
  return current === undefined ? 0 : current.reviewCount - current.scoredCount
}

export async function performanceReviewExists(
  db: Database,
  institutionId: string,
  periodId: string,
  membershipId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: performanceReviews.id })
    .from(performanceReviews)
    .where(
      and(
        reviewOf(institutionId),
        eq(performanceReviews.periodId, periodId),
        eq(performanceReviews.membershipId, membershipId),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Kurumdaki üyelik (kullanıcı, rol, etkin mi); yoksa `null`. */
export async function findPerformanceStaff(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<{ userId: string; role: string; active: boolean } | null> {
  const [row] = await db
    .select({
      userId: memberships.userId,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.id, membershipId)))
    .limit(1)
  return row === undefined
    ? null
    : { userId: row.userId, role: row.role, active: row.deactivatedAt === null }
}

export async function insertPerformanceReview(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    periodId: string
    membershipId: string
    goals: PerformanceGoal[]
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx
    .insert(performanceReviews)
    .values({ institutionId, ...rest, createdAt: now, updatedAt: now })
}

/** Kısmi düzeltme; sürüm tutmazsa `false` (409). Puan yazılınca değerlendiren işaretlenir. */
export async function updatePerformanceReview(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    patch: PerformanceReviewPatch
    evaluator: { userId: string; name: string }
    now: Date
  },
): Promise<boolean> {
  const { patch } = input
  const rows = await tx
    .update(performanceReviews)
    .set({
      ...(patch.goals === undefined ? {} : { goals: patch.goals }),
      ...(patch.interimNote === undefined ? {} : { interimNote: patch.interimNote }),
      ...(patch.interimDate === undefined ? {} : { interimDate: patch.interimDate }),
      ...(patch.staffComment === undefined ? {} : { staffComment: patch.staffComment }),
      ...(patch.evaluated === true
        ? {
            evaluatorUserId: input.evaluator.userId,
            evaluatorName: input.evaluator.name,
            evaluatedAt: input.now,
          }
        : {}),
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        reviewOf(institutionId),
        eq(performanceReviews.id, input.id),
        eq(performanceReviews.version, input.expectedVersion),
      ),
    )
    .returning({ id: performanceReviews.id })
  return rows.length === 1
}
