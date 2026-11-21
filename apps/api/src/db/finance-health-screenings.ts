import { and, asc, count, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm'

import type {
  HealthScreeningKind,
  HealthScreeningNotificationStatus,
  HealthScreeningOutcome,
  HealthScreeningStatus,
  HealthScreeningThresholds,
} from '@kampus/school-core/lib/finance-health-screenings.ts'

import type { Database } from './client.ts'
import { users } from './schema/auth.ts'
import {
  healthScreeningNotifications,
  healthScreeningResults,
  healthScreeningSessions,
} from './schema/finance-health-screenings.ts'

/**
 * Okul sağlığı taraması deposu (DOM-FIN-153; ON-163). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-health-screenings.ts`'tedir; şifreleme ve çözme
 * servistedir, depo şifreli değeri olduğu gibi okur ve yazar. Yayımlanmış oturumu tetikleyici korur.
 */

const s = healthScreeningSessions
const r = healthScreeningResults
const nt = healthScreeningNotifications

export interface StoredHealthScreeningSession {
  id: string
  kind: HealthScreeningKind
  status: HealthScreeningStatus
  screenedOn: string
  classIds: string[]
  performerMembershipId: string | null
  performerName: string | null
  thresholds: HealthScreeningThresholds
  createdByUserId: string
  publishedAt: string | null
  publishedByUserId: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const SESSION_COLUMNS = {
  id: s.id,
  kind: s.kind,
  status: s.status,
  screenedOn: s.screenedOn,
  classIds: s.classIds,
  performerMembershipId: s.performerMembershipId,
  performerName: s.performerName,
  thresholds: s.thresholds,
  createdByUserId: s.createdByUserId,
  publishedAt: s.publishedAt,
  publishedByUserId: s.publishedByUserId,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  version: s.version,
}

type SessionRow = Omit<StoredHealthScreeningSession, 'publishedAt' | 'createdAt' | 'updatedAt'> & {
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toSession = (row: SessionRow): StoredHealthScreeningSession => ({
  ...row,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

/** Oturum; başka kurumun ya da olmayan oturum `null`. */
export async function findHealthScreeningSession(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredHealthScreeningSession | null> {
  const [row] = await db
    .select(SESSION_COLUMNS)
    .from(s)
    .where(and(eq(s.institutionId, institutionId), eq(s.id, id)))
    .limit(1)
  return row === undefined ? null : toSession(row)
}

export interface HealthScreeningSessionListQuery {
  page: number
  pageSize: number
  status?: HealthScreeningStatus | undefined
  kind?: HealthScreeningKind | undefined
  from?: string | undefined
  to?: string | undefined
}

/** Oturum listesi: en yeni tarama günü önce. */
export async function listHealthScreeningSessions(
  db: Database,
  institutionId: string,
  query: HealthScreeningSessionListQuery,
): Promise<{ items: StoredHealthScreeningSession[]; total: number }> {
  const filters: (SQL | undefined)[] = [
    eq(s.institutionId, institutionId),
    query.status === undefined ? undefined : eq(s.status, query.status),
    query.kind === undefined ? undefined : eq(s.kind, query.kind),
    query.from === undefined ? undefined : gte(s.screenedOn, query.from),
    query.to === undefined ? undefined : lte(s.screenedOn, query.to),
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(s).where(where)
  const rows = await db
    .select(SESSION_COLUMNS)
    .from(s)
    .where(where)
    .orderBy(desc(s.screenedOn), desc(s.createdAt), asc(s.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toSession), total: totalRow?.total ?? 0 }
}

export interface HealthScreeningSessionColumns {
  screenedOn: string
  classIds: string[]
  performerMembershipId: string | null
  performerName: string | null
  thresholds: HealthScreeningThresholds
}

export async function insertHealthScreeningSession(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    kind: HealthScreeningKind
    columns: HealthScreeningSessionColumns
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(s).values({
    institutionId,
    id: input.id,
    kind: input.kind,
    ...input.columns,
    createdByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Açık oturum düzeltmesi; sürüm tutmazsa ya da oturum yayımlandıysa `false` (409). */
export async function updateHealthScreeningSession(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    columns: HealthScreeningSessionColumns
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(s)
    .set({ ...input.columns, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(s.institutionId, institutionId),
        eq(s.id, input.id),
        eq(s.status, 'open'),
        eq(s.version, input.expectedVersion),
      ),
    )
    .returning({ id: s.id })
  return rows.length === 1
}

/** Yayımlama; sürüm tutmazsa `false` (409). */
export async function publishHealthScreeningSession(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(s)
    .set({
      status: 'published',
      publishedAt: input.now,
      publishedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(s.institutionId, institutionId),
        eq(s.id, input.id),
        eq(s.status, 'open'),
        eq(s.version, input.expectedVersion),
      ),
    )
    .returning({ id: s.id })
  return rows.length === 1
}

export interface StoredHealthScreeningResult {
  id: string
  sessionId: string
  studentId: string
  classId: string
  outcome: HealthScreeningOutcome
  referralRecommended: boolean
  healthCiphertext: string
  healthKeyVersion: number
  recordedByUserId: string
  recordedByName: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const RESULT_COLUMNS = {
  id: r.id,
  sessionId: r.sessionId,
  studentId: r.studentId,
  classId: r.classId,
  outcome: r.outcome,
  referralRecommended: r.referralRecommended,
  healthCiphertext: r.healthCiphertext,
  healthKeyVersion: r.healthKeyVersion,
  recordedByUserId: r.recordedByUserId,
  recordedByName: users.name,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  version: r.version,
}

type ResultRow = Omit<StoredHealthScreeningResult, 'createdAt' | 'updatedAt'> & {
  createdAt: Date
  updatedAt: Date
}
const toResult = (row: ResultRow): StoredHealthScreeningResult => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

/** Oturumun sonuçları (isteğe bağlı öğrencilerle daraltılır); yazanın adıyla. */
export async function loadHealthScreeningResults(
  db: Database,
  institutionId: string,
  sessionId: string,
  studentIds?: readonly string[],
): Promise<StoredHealthScreeningResult[]> {
  if (studentIds?.length === 0) return []
  const rows = await db
    .select(RESULT_COLUMNS)
    .from(r)
    .leftJoin(users, eq(users.id, r.recordedByUserId))
    .where(
      and(
        eq(r.institutionId, institutionId),
        eq(r.sessionId, sessionId),
        studentIds === undefined ? undefined : inArray(r.studentId, [...new Set(studentIds)]),
      ),
    )
    .orderBy(asc(r.classId), asc(r.studentId))
  return rows.map(toResult)
}

/** Oturumların sonuç ve bildirim sayıları (liste için). */
export async function countHealthScreeningRows(
  db: Database,
  institutionId: string,
  sessionIds: readonly string[],
): Promise<Map<string, { results: number; notifications: number }>> {
  const map = new Map<string, { results: number; notifications: number }>()
  const ids = [...new Set(sessionIds)]
  if (ids.length === 0) return map
  const [results, notifications] = await Promise.all([
    db
      .select({ sessionId: r.sessionId, total: count() })
      .from(r)
      .where(and(eq(r.institutionId, institutionId), inArray(r.sessionId, ids)))
      .groupBy(r.sessionId),
    db
      .select({ sessionId: nt.sessionId, total: count() })
      .from(nt)
      .where(and(eq(nt.institutionId, institutionId), inArray(nt.sessionId, ids)))
      .groupBy(nt.sessionId),
  ])
  for (const id of ids) map.set(id, { results: 0, notifications: 0 })
  for (const row of results) {
    const entry = map.get(row.sessionId)
    if (entry) entry.results = row.total
  }
  for (const row of notifications) {
    const entry = map.get(row.sessionId)
    if (entry) entry.notifications = row.total
  }
  return map
}

export interface HealthScreeningResultColumns {
  outcome: HealthScreeningOutcome
  referralRecommended: boolean
  healthCiphertext: string
  healthKeyVersion: number
}

export async function insertHealthScreeningResult(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    sessionId: string
    studentId: string
    classId: string
    columns: HealthScreeningResultColumns
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(r).values({
    institutionId,
    id: input.id,
    sessionId: input.sessionId,
    studentId: input.studentId,
    classId: input.classId,
    ...input.columns,
    recordedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Sonuç düzeltmesi; sürüm tutmazsa `false` (409). */
export async function updateHealthScreeningResult(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    columns: HealthScreeningResultColumns
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(r)
    .set({
      ...input.columns,
      recordedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(r.institutionId, institutionId),
        eq(r.id, input.id),
        eq(r.version, input.expectedVersion),
      ),
    )
    .returning({ id: r.id })
  return rows.length === 1
}

export async function insertHealthScreeningNotifications(
  tx: Database,
  institutionId: string,
  input: {
    sessionId: string
    items: readonly { id: string; resultId: string; studentId: string }[]
    now: Date
  },
): Promise<void> {
  if (input.items.length === 0) return
  await tx.insert(nt).values(
    input.items.map((item) => ({
      institutionId,
      id: item.id,
      sessionId: input.sessionId,
      resultId: item.resultId,
      studentId: item.studentId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

/** Sonuçların bildirim durumu (sonuç kimliği → durum). */
export async function loadHealthScreeningNotificationStates(
  db: Database,
  institutionId: string,
  resultIds: readonly string[],
): Promise<Map<string, HealthScreeningNotificationStatus>> {
  const ids = [...new Set(resultIds)]
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ resultId: nt.resultId, status: nt.status })
    .from(nt)
    .where(and(eq(nt.institutionId, institutionId), inArray(nt.resultId, ids)))
  return new Map(rows.map((row) => [row.resultId, row.status]))
}

export interface StoredGuardianScreeningResult extends StoredHealthScreeningResult {
  session: StoredHealthScreeningSession
}

/** Velinin çocuklarının yayımlanmış sonuçları (K-515): en yeni tarama önce; çocuk yoksa boş. */
export async function listPublishedResultsForStudents(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; studentIds: readonly string[] },
): Promise<{ items: StoredGuardianScreeningResult[]; total: number }> {
  if (query.studentIds.length === 0) return { items: [], total: 0 }
  const where = and(
    eq(r.institutionId, institutionId),
    inArray(r.studentId, [...new Set(query.studentIds)]),
    eq(s.status, 'published'),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(r)
    .innerJoin(s, and(eq(s.institutionId, r.institutionId), eq(s.id, r.sessionId)))
    .where(where)
  const rows = await db
    .select({
      result: {
        id: r.id,
        sessionId: r.sessionId,
        studentId: r.studentId,
        classId: r.classId,
        outcome: r.outcome,
        referralRecommended: r.referralRecommended,
        healthCiphertext: r.healthCiphertext,
        healthKeyVersion: r.healthKeyVersion,
        recordedByUserId: r.recordedByUserId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        version: r.version,
      },
      session: SESSION_COLUMNS,
    })
    .from(r)
    .innerJoin(s, and(eq(s.institutionId, r.institutionId), eq(s.id, r.sessionId)))
    .where(where)
    .orderBy(desc(s.screenedOn), asc(s.id), asc(r.studentId))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map((row) => ({
      ...toResult({ ...row.result, recordedByName: null }),
      session: toSession(row.session),
    })),
    total: totalRow?.total ?? 0,
  }
}
