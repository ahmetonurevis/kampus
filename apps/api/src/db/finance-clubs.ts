import { and, asc, count, desc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm'

import type { ClubAttendanceStatus } from '@kampus/school-core/lib/finance-clubs.ts'

import type { Database } from './client.ts'
import {
  schoolClubAttendance,
  schoolClubMembers,
  schoolClubs,
  schoolClubSessions,
} from './schema/finance-clubs.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Kulüp, üyelik, oturum ve yoklama deposu (DOM-FIN-142; ON-098). Kurum kapsamlıdır: ilk parametre
 * `institutionId`; arşivli satırlar okunmaz. Kural core `lib/finance-clubs.ts`'tedir.
 */

export interface StoredClub {
  id: string
  name: string
  teacherMembershipId: string
  capacity: number
  meetingDay: number
  startTime: string
  endTime: string
  version: number
}

export interface StoredClubMember {
  id: string
  clubId: string
  studentId: string
  createdAt: Date
  version: number
}

export interface StoredClubSession {
  id: string
  clubId: string
  sessionDate: string
  version: number
}

const CLUB = {
  id: schoolClubs.id,
  name: schoolClubs.name,
  teacherMembershipId: schoolClubs.teacherMembershipId,
  capacity: schoolClubs.capacity,
  meetingDay: schoolClubs.meetingDay,
  startTime: schoolClubs.startTime,
  endTime: schoolClubs.endTime,
  version: schoolClubs.version,
}
const MEMBER = {
  id: schoolClubMembers.id,
  clubId: schoolClubMembers.clubId,
  studentId: schoolClubMembers.studentId,
  createdAt: schoolClubMembers.createdAt,
  version: schoolClubMembers.version,
}
const SESSION = {
  id: schoolClubSessions.id,
  clubId: schoolClubSessions.clubId,
  sessionDate: schoolClubSessions.sessionDate,
  version: schoolClubSessions.version,
}

const liveClubs = (institutionId: string) =>
  and(eq(schoolClubs.institutionId, institutionId), isNull(schoolClubs.archivedAt))
const liveMembers = (institutionId: string) =>
  and(eq(schoolClubMembers.institutionId, institutionId), isNull(schoolClubMembers.archivedAt))
const liveSessions = (institutionId: string) =>
  and(eq(schoolClubSessions.institutionId, institutionId), isNull(schoolClubSessions.archivedAt))

// --- Kulüp ---------------------------------------------------------------------------------------

export async function findClub(db: Database, institutionId: string, id: string) {
  const [row] = await db
    .select(CLUB)
    .from(schoolClubs)
    .where(and(liveClubs(institutionId), eq(schoolClubs.id, id)))
    .limit(1)
  return row ?? null
}

export async function loadClubs(db: Database, institutionId: string, ids: readonly string[]) {
  if (ids.length === 0) return []
  return db
    .select(CLUB)
    .from(schoolClubs)
    .where(and(liveClubs(institutionId), inArray(schoolClubs.id, [...new Set(ids)])))
}

export async function clubNameTaken(
  db: Database,
  institutionId: string,
  name: string,
  exceptId?: string,
) {
  const [row] = await db
    .select({ id: schoolClubs.id })
    .from(schoolClubs)
    .where(
      and(
        liveClubs(institutionId),
        eq(schoolClubs.name, name),
        exceptId === undefined ? undefined : ne(schoolClubs.id, exceptId),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function listClubs(
  db: Database,
  institutionId: string,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    teacherMembershipId?: string | undefined
  },
): Promise<{ items: StoredClub[]; total: number }> {
  const filters: (SQL | undefined)[] = [
    liveClubs(institutionId),
    query.q === undefined
      ? undefined
      : sql`strpos(${foldSql(schoolClubs.name)}, ${foldSearch(query.q)}) > 0`,
    query.teacherMembershipId === undefined
      ? undefined
      : eq(schoolClubs.teacherMembershipId, query.teacherMembershipId),
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(schoolClubs).where(where)
  const items = await db
    .select(CLUB)
    .from(schoolClubs)
    .where(where)
    .orderBy(asc(schoolClubs.name), asc(schoolClubs.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

export async function insertClub(
  tx: Database,
  institutionId: string,
  input: Omit<StoredClub, 'version'> & { createdByUserId: string; now: Date },
) {
  const { now, ...values } = input
  await tx.insert(schoolClubs).values({ ...values, institutionId, createdAt: now, updatedAt: now })
}

export async function updateClub(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<Omit<StoredClub, 'id' | 'version'> & { archivedAt: Date }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(schoolClubs)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        liveClubs(institutionId),
        eq(schoolClubs.id, input.id),
        eq(schoolClubs.version, input.expectedVersion),
      ),
    )
    .returning({ id: schoolClubs.id })
  return rows.length === 1
}

// --- Üyelik --------------------------------------------------------------------------------------

export async function findClubMember(db: Database, institutionId: string, id: string) {
  const [row] = await db
    .select(MEMBER)
    .from(schoolClubMembers)
    .where(and(liveMembers(institutionId), eq(schoolClubMembers.id, id)))
    .limit(1)
  return row ?? null
}

/** Kulüplerin etkin üyelikleri, katılım sırasıyla. */
export async function loadClubMembers(
  db: Database,
  institutionId: string,
  clubIds: readonly string[],
): Promise<StoredClubMember[]> {
  if (clubIds.length === 0) return []
  return db
    .select(MEMBER)
    .from(schoolClubMembers)
    .where(
      and(liveMembers(institutionId), inArray(schoolClubMembers.clubId, [...new Set(clubIds)])),
    )
    .orderBy(asc(schoolClubMembers.createdAt), asc(schoolClubMembers.id))
}

/** Üyelikler kimliğe göre, arşivli olanlar da (geçmiş yoklamanın adları için). */
export async function loadClubMembersByIds(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<StoredClubMember[]> {
  if (ids.length === 0) return []
  return db
    .select(MEMBER)
    .from(schoolClubMembers)
    .where(
      and(
        eq(schoolClubMembers.institutionId, institutionId),
        inArray(schoolClubMembers.id, [...new Set(ids)]),
      ),
    )
}

/** Öğrencilerin etkin üyelikleri (veli ve öğrenci görünümü). */
export async function loadStudentMemberships(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<StoredClubMember[]> {
  if (studentIds.length === 0) return []
  return db
    .select(MEMBER)
    .from(schoolClubMembers)
    .where(
      and(
        liveMembers(institutionId),
        inArray(schoolClubMembers.studentId, [...new Set(studentIds)]),
      ),
    )
    .orderBy(asc(schoolClubMembers.createdAt), asc(schoolClubMembers.id))
}

/** Kulüp başına etkin üye sayısı. */
export async function clubMemberCounts(
  db: Database,
  institutionId: string,
  clubIds: readonly string[],
): Promise<Map<string, number>> {
  if (clubIds.length === 0) return new Map()
  const rows = await db
    .select({ clubId: schoolClubMembers.clubId, total: count() })
    .from(schoolClubMembers)
    .where(
      and(liveMembers(institutionId), inArray(schoolClubMembers.clubId, [...new Set(clubIds)])),
    )
    .groupBy(schoolClubMembers.clubId)
  return new Map(rows.map((row) => [row.clubId, row.total]))
}

export async function insertClubMember(
  tx: Database,
  institutionId: string,
  input: { id: string; clubId: string; studentId: string; joinedByUserId: string; now: Date },
) {
  const { now, ...values } = input
  await tx
    .insert(schoolClubMembers)
    .values({ ...values, institutionId, createdAt: now, updatedAt: now })
}

export async function removeClubMember(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(schoolClubMembers)
    .set({
      archivedAt: input.now,
      removedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        liveMembers(institutionId),
        eq(schoolClubMembers.id, input.id),
        eq(schoolClubMembers.version, input.expectedVersion),
      ),
    )
    .returning({ id: schoolClubMembers.id })
  return rows.length === 1
}

// --- Oturum ve yoklama ---------------------------------------------------------------------------

export async function findClubSession(db: Database, institutionId: string, id: string) {
  const [row] = await db
    .select(SESSION)
    .from(schoolClubSessions)
    .where(and(liveSessions(institutionId), eq(schoolClubSessions.id, id)))
    .limit(1)
  return row ?? null
}

export async function sessionOnDate(
  db: Database,
  institutionId: string,
  clubId: string,
  sessionDate: string,
) {
  const [row] = await db
    .select({ id: schoolClubSessions.id })
    .from(schoolClubSessions)
    .where(
      and(
        liveSessions(institutionId),
        eq(schoolClubSessions.clubId, clubId),
        eq(schoolClubSessions.sessionDate, sessionDate),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Kulübün etkin oturumları, yeni gün önce. */
export function loadClubSessions(
  db: Database,
  institutionId: string,
  clubId: string,
): Promise<StoredClubSession[]> {
  return db
    .select(SESSION)
    .from(schoolClubSessions)
    .where(and(liveSessions(institutionId), eq(schoolClubSessions.clubId, clubId)))
    .orderBy(desc(schoolClubSessions.sessionDate), asc(schoolClubSessions.id))
}

export interface StoredMark {
  sessionId: string
  memberId: string
  status: ClubAttendanceStatus
}

export async function loadMarks(
  db: Database,
  institutionId: string,
  sessionIds: readonly string[],
): Promise<StoredMark[]> {
  if (sessionIds.length === 0) return []
  return db
    .select({
      sessionId: schoolClubAttendance.sessionId,
      memberId: schoolClubAttendance.memberId,
      status: schoolClubAttendance.status,
    })
    .from(schoolClubAttendance)
    .where(
      and(
        eq(schoolClubAttendance.institutionId, institutionId),
        inArray(schoolClubAttendance.sessionId, [...new Set(sessionIds)]),
      ),
    )
}

/** Üyelerin işaretleri (yalnız etkin oturumlardan); bir üyenin devam özeti için. */
export async function loadMemberMarks(
  db: Database,
  institutionId: string,
  memberIds: readonly string[],
): Promise<StoredMark[]> {
  if (memberIds.length === 0) return []
  return db
    .select({
      sessionId: schoolClubAttendance.sessionId,
      memberId: schoolClubAttendance.memberId,
      status: schoolClubAttendance.status,
    })
    .from(schoolClubAttendance)
    .innerJoin(
      schoolClubSessions,
      and(
        eq(schoolClubSessions.institutionId, schoolClubAttendance.institutionId),
        eq(schoolClubSessions.id, schoolClubAttendance.sessionId),
      ),
    )
    .where(
      and(
        eq(schoolClubAttendance.institutionId, institutionId),
        isNull(schoolClubSessions.archivedAt),
        inArray(schoolClubAttendance.memberId, [...new Set(memberIds)]),
      ),
    )
}

export async function insertSession(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    clubId: string
    sessionDate: string
    recordedByUserId: string
    marks: readonly { memberId: string; status: ClubAttendanceStatus }[]
    now: Date
  },
) {
  const { now, marks, ...values } = input
  await tx
    .insert(schoolClubSessions)
    .values({ ...values, institutionId, createdAt: now, updatedAt: now })
  await tx.insert(schoolClubAttendance).values(
    marks.map((mark) => ({
      institutionId,
      sessionId: input.id,
      clubId: input.clubId,
      memberId: mark.memberId,
      status: mark.status,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

export async function archiveSession(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(schoolClubSessions)
    .set({ archivedAt: input.now, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        liveSessions(institutionId),
        eq(schoolClubSessions.id, input.id),
        eq(schoolClubSessions.version, input.expectedVersion),
      ),
    )
    .returning({ id: schoolClubSessions.id })
  return rows.length === 1
}
