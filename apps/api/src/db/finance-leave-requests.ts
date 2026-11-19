import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm'

import type {
  LeaveRequestLesson,
  LeaveRequestStatus,
  LeaveTeacher,
  OpenLeaveRequest,
  ScheduleLesson,
} from '@kampus/school-core/lib/finance-leave-requests.ts'
import type { LeaveKind, LeavePeriod } from '@kampus/school-core/lib/finance-staff-leave.ts'

import type { Database } from './client.ts'
import { loadRecords, type DayRangeMatch } from './records.ts'
import { memberships, users } from './schema/auth.ts'
import { staffLeaveRequestLessons, staffLeaveRequests } from './schema/finance-leave-requests.ts'
import { staffLeaveRecords } from './schema/finance-staff-leave.ts'
import { membershipLinks } from './schema/membership-links.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * İzin talebi deposu (DOM-FIN-116; ON-182). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-leave-requests.ts`'tedir; depo yalnız okur ve yazar. Ders programı ve
 * öğretmen kayıtları `records` deposundan (`schedule`, `teachers`) yalnız okunur.
 */

const OPEN_STATUSES: readonly LeaveRequestStatus[] = ['pending', 'approved']

export interface StoredLeaveRequest {
  id: string
  membershipId: string
  name: string
  role: string
  typeCode: string
  kind: LeaveKind
  typeLabel: string
  deductsFromAnnual: boolean
  startDate: string
  endDate: string
  days: number
  description: string | null
  status: LeaveRequestStatus
  decidedAt: string | null
  rejectReason: string | null
  advanceApproved: boolean
  cancelledAt: string | null
  cancelReason: string | null
  lessonCount: number
  substitutedCount: number
  createdAt: string
  version: number
}

const lessonCount = sql<number>`(select count(*)::int from ${staffLeaveRequestLessons}
  where ${staffLeaveRequestLessons.institutionId} = ${staffLeaveRequests.institutionId}
    and ${staffLeaveRequestLessons.requestId} = ${staffLeaveRequests.id})`
const substitutedCount = sql<number>`(select count(*)::int from ${staffLeaveRequestLessons}
  where ${staffLeaveRequestLessons.institutionId} = ${staffLeaveRequests.institutionId}
    and ${staffLeaveRequestLessons.requestId} = ${staffLeaveRequests.id}
    and ${staffLeaveRequestLessons.substituteTeacherId} is not null)`

const REQUEST_COLUMNS = {
  id: staffLeaveRequests.id,
  membershipId: staffLeaveRequests.membershipId,
  name: users.name,
  role: memberships.role,
  typeCode: staffLeaveRequests.typeCode,
  kind: staffLeaveRequests.kind,
  typeLabel: staffLeaveRequests.typeLabel,
  deductsFromAnnual: staffLeaveRequests.deductsFromAnnual,
  startDate: staffLeaveRequests.startDate,
  endDate: staffLeaveRequests.endDate,
  days: staffLeaveRequests.days,
  description: staffLeaveRequests.description,
  status: staffLeaveRequests.status,
  decidedAt: staffLeaveRequests.decidedAt,
  rejectReason: staffLeaveRequests.rejectReason,
  advanceApproved: staffLeaveRequests.advanceApproved,
  cancelledAt: staffLeaveRequests.cancelledAt,
  cancelReason: staffLeaveRequests.cancelReason,
  lessonCount,
  substitutedCount,
  createdAt: staffLeaveRequests.createdAt,
  version: staffLeaveRequests.version,
}

type RequestRow = Omit<StoredLeaveRequest, 'decidedAt' | 'cancelledAt' | 'createdAt'> & {
  decidedAt: Date | null
  cancelledAt: Date | null
  createdAt: Date
}
const toRequest = (row: RequestRow): StoredLeaveRequest => ({
  ...row,
  decidedAt: row.decidedAt?.toISOString() ?? null,
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

const requestBase = (db: Database) =>
  db
    .select(REQUEST_COLUMNS)
    .from(staffLeaveRequests)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, staffLeaveRequests.institutionId),
        eq(memberships.id, staffLeaveRequests.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))

export interface LeaveRequestQuery {
  page: number
  pageSize: number
  status?: LeaveRequestStatus | undefined
  membershipId?: string | undefined
  q?: string | undefined
  /** Aralığı bu güne ya da sonrasına uzanan talepler. */
  from?: string | undefined
  /** Bu güne kadar başlayan talepler. */
  to?: string | undefined
}

/** Talepler: onay bekleyen önce, sonra başlangıca göre yeniden eskiye; personel adında arama. */
export async function listLeaveRequests(
  db: Database,
  institutionId: string,
  query: LeaveRequestQuery,
): Promise<{ items: StoredLeaveRequest[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    eq(staffLeaveRequests.institutionId, institutionId),
    query.status === undefined ? undefined : eq(staffLeaveRequests.status, query.status),
    query.membershipId === undefined
      ? undefined
      : eq(staffLeaveRequests.membershipId, query.membershipId),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
    query.from === undefined ? undefined : gte(staffLeaveRequests.endDate, query.from),
    query.to === undefined ? undefined : lte(staffLeaveRequests.startDate, query.to),
  ]
  const where = and(...filters)
  const [totalRow] = await db
    .select({ total: count() })
    .from(staffLeaveRequests)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, staffLeaveRequests.institutionId),
        eq(memberships.id, staffLeaveRequests.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
  const rows = await requestBase(db)
    .where(where)
    .orderBy(
      sql`(${staffLeaveRequests.status} = 'pending') desc`,
      desc(staffLeaveRequests.startDate),
      desc(staffLeaveRequests.createdAt),
      asc(staffLeaveRequests.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toRequest), total: totalRow?.total ?? 0 }
}

export async function findLeaveRequest(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredLeaveRequest | null> {
  const [row] = await requestBase(db)
    .where(and(eq(staffLeaveRequests.institutionId, institutionId), eq(staffLeaveRequests.id, id)))
    .limit(1)
  return row === undefined ? null : toRequest(row)
}

/** Personellerin bekleyen ve onaylı talepleri; `period` verilirse yalnız ona değenler. */
export async function loadOpenLeaveRequests(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
  period?: LeavePeriod,
): Promise<(OpenLeaveRequest & { membershipId: string })[]> {
  if (membershipIds.length === 0) return []
  return db
    .select({
      id: staffLeaveRequests.id,
      membershipId: staffLeaveRequests.membershipId,
      status: staffLeaveRequests.status,
      startDate: staffLeaveRequests.startDate,
      endDate: staffLeaveRequests.endDate,
    })
    .from(staffLeaveRequests)
    .where(
      and(
        eq(staffLeaveRequests.institutionId, institutionId),
        inArray(staffLeaveRequests.membershipId, [...new Set(membershipIds)]),
        inArray(staffLeaveRequests.status, [...OPEN_STATUSES]),
        ...(period === undefined
          ? []
          : [
              lte(staffLeaveRequests.startDate, period.endDate),
              gte(staffLeaveRequests.endDate, period.startDate),
            ]),
      ),
    )
}

/** Personellerin aralığa değen etkin (iptal edilmemiş) izin kayıtları. */
export async function loadActiveRecordPeriods(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
  period: LeavePeriod,
): Promise<(LeavePeriod & { membershipId: string })[]> {
  if (membershipIds.length === 0) return []
  return db
    .select({
      membershipId: staffLeaveRecords.membershipId,
      startDate: staffLeaveRecords.startDate,
      endDate: staffLeaveRecords.endDate,
    })
    .from(staffLeaveRecords)
    .where(
      and(
        eq(staffLeaveRecords.institutionId, institutionId),
        isNull(staffLeaveRecords.archivedAt),
        inArray(staffLeaveRecords.membershipId, [...new Set(membershipIds)]),
        lte(staffLeaveRecords.startDate, period.endDate),
        gte(staffLeaveRecords.endDate, period.startDate),
      ),
    )
}

export interface LeaveRequestInsert {
  id: string
  membershipId: string
  typeCode: string
  kind: LeaveKind
  typeLabel: string
  deductsFromAnnual: boolean
  startDate: string
  endDate: string
  days: number
  description: string | null
  requestedByUserId: string
  now: Date
}

export async function insertLeaveRequest(
  tx: Database,
  institutionId: string,
  input: LeaveRequestInsert,
  lessons: readonly LeaveRequestLesson[],
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(staffLeaveRequests)
    .values({ ...fields, institutionId, status: 'pending', createdAt: now, updatedAt: now })
  if (lessons.length > 0)
    await tx.insert(staffLeaveRequestLessons).values(
      lessons.map((lesson) => ({
        institutionId,
        requestId: input.id,
        lessonId: lesson.lessonId,
        startsAt: new Date(lesson.startsAt),
        duration: lesson.duration,
        classId: lesson.classId,
        subjectId: lesson.subjectId,
        title: lesson.title,
        substituteTeacherId: lesson.substituteTeacherId,
        createdAt: now,
        updatedAt: now,
      })),
    )
}

/** Talebin dersleri, başlangıca göre. */
export async function loadRequestLessons(
  db: Database,
  institutionId: string,
  requestId: string,
): Promise<LeaveRequestLesson[]> {
  const rows = await db
    .select({
      lessonId: staffLeaveRequestLessons.lessonId,
      startsAt: staffLeaveRequestLessons.startsAt,
      duration: staffLeaveRequestLessons.duration,
      classId: staffLeaveRequestLessons.classId,
      subjectId: staffLeaveRequestLessons.subjectId,
      title: staffLeaveRequestLessons.title,
      substituteTeacherId: staffLeaveRequestLessons.substituteTeacherId,
    })
    .from(staffLeaveRequestLessons)
    .where(
      and(
        eq(staffLeaveRequestLessons.institutionId, institutionId),
        eq(staffLeaveRequestLessons.requestId, requestId),
      ),
    )
    .orderBy(asc(staffLeaveRequestLessons.startsAt), asc(staffLeaveRequestLessons.lessonId))
  return rows.map((row) => ({ ...row, startsAt: row.startsAt.toISOString() }))
}

/** Yedeği değişen derslerin satırları. */
export async function updateRequestLessons(
  tx: Database,
  institutionId: string,
  requestId: string,
  changes: readonly { lessonId: string; substituteTeacherId: string | null }[],
  now: Date,
): Promise<void> {
  for (const change of changes)
    await tx
      .update(staffLeaveRequestLessons)
      .set({
        substituteTeacherId: change.substituteTeacherId,
        updatedAt: now,
        version: sql`${staffLeaveRequestLessons.version} + 1`,
      })
      .where(
        and(
          eq(staffLeaveRequestLessons.institutionId, institutionId),
          eq(staffLeaveRequestLessons.requestId, requestId),
          eq(staffLeaveRequestLessons.lessonId, change.lessonId),
        ),
      )
}

type RequestChange = Partial<
  Pick<
    typeof staffLeaveRequests.$inferInsert,
    | 'status'
    | 'decidedAt'
    | 'decidedByUserId'
    | 'rejectReason'
    | 'advanceApproved'
    | 'cancelledAt'
    | 'cancelledByUserId'
    | 'cancelReason'
  >
>

/** Talebi sürümle günceller (durum ya da yedek değişikliği); sürüm tutmazsa `false` (409). */
export async function updateLeaveRequest(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; change: RequestChange; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffLeaveRequests)
    .set({ ...input.change, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(staffLeaveRequests.institutionId, institutionId),
        eq(staffLeaveRequests.id, input.id),
        eq(staffLeaveRequests.version, input.expectedVersion),
      ),
    )
    .returning({ id: staffLeaveRequests.id })
  return rows.length === 1
}

/** Talebin ürettiği etkin kayıt (onaylı talebin iptali için). */
export async function findRecordOfRequest(
  db: Database,
  institutionId: string,
  requestId: string,
): Promise<{ id: string; version: number } | null> {
  const [row] = await db
    .select({ id: staffLeaveRecords.id, version: staffLeaveRecords.version })
    .from(staffLeaveRecords)
    .where(
      and(
        eq(staffLeaveRecords.institutionId, institutionId),
        isNull(staffLeaveRecords.archivedAt),
        eq(staffLeaveRecords.requestId, requestId),
      ),
    )
    .limit(1)
  return row ?? null
}

// --- Ders programı ve öğretmenler ----------------------------------------------------------------

/** Üyeliklerin bağlı öğretmen kayıtları (`membership_links`, `teacher`). */
export async function teacherLinks(
  db: Database,
  institutionId: string,
  membershipIds?: readonly string[],
): Promise<{ membershipId: string; teacherId: string }[]> {
  if (membershipIds !== undefined && membershipIds.length === 0) return []
  return db
    .select({ membershipId: membershipLinks.membershipId, teacherId: membershipLinks.recordId })
    .from(membershipLinks)
    .where(
      and(
        eq(membershipLinks.institutionId, institutionId),
        eq(membershipLinks.kind, 'teacher'),
        isNull(membershipLinks.archivedAt),
        ...(membershipIds === undefined
          ? []
          : [inArray(membershipLinks.membershipId, [...new Set(membershipIds)])]),
      ),
    )
    .orderBy(asc(membershipLinks.membershipId), asc(membershipLinks.recordId))
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** Ders programının gün aralığındaki (Europe/Istanbul; süzgeci servis kurar) dersleri. */
export async function loadScheduleLessons(
  db: Database,
  institutionId: string,
  range: DayRangeMatch,
): Promise<ScheduleLesson[]> {
  const rows = await loadRecords(db, institutionId, ['schedule'], { match: [range] })
  return rows.flatMap((row) => {
    const date = text(row.data.date)
    const teacherId = text(row.data.teacherId)
    if (date === null || teacherId === null || Number.isNaN(Date.parse(date))) return []
    return [
      {
        id: row.id,
        date: new Date(date).toISOString(),
        duration: typeof row.data.duration === 'number' ? row.data.duration : 0,
        classId: text(row.data.classId) ?? '',
        subjectId: text(row.data.subjectId) ?? '',
        title: text(row.data.title) ?? text(row.data.subject),
        teacherId,
        originalTeacherId: text(row.data.originalTeacherId),
        cancelledAt: text(row.data.cancelledAt) || null,
      },
    ]
  })
}

/** Kurumun öğretmen kayıtları (yedek adayları), ada göre. */
export async function loadTeachers(db: Database, institutionId: string): Promise<LeaveTeacher[]> {
  const rows = await loadRecords(db, institutionId, ['teachers'])
  return rows
    .map((row) => ({
      id: row.id,
      name: text(row.data.name) ?? row.id,
      subjectId: text(row.data.subjectId),
      isActive: row.data.isActive !== false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id))
}
