import { and, asc, count, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'

import type {
  FreezeReason,
  FreezeRejectionCategory,
  FreezeStatus,
} from '@kampus/school-core/lib/enrollment-freezes.ts'
import type { GroupMemberStatus } from '@kampus/school-core/lib/language-groups.ts'

import type { Database } from './client.ts'
import { enrollmentFreezes } from './schema/enrollment-freezes.ts'
import { languageGroupMembers, languageGroups } from './schema/language-groups.ts'
import { records } from './schema/records.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Kayıt dondurma deposu (DOM-DIL-052). Serbest metin tutulmaz (K-20). Grup üyeliğinin durum yazması
 * kayıt akışındadır (`language_group_members`, DOM-DIL-040): satırın grubu ve kursiyeri değişmez.
 */

export interface StoredFreeze {
  id: string
  studentId: string
  studentName: string | null
  status: FreezeStatus
  reason: FreezeReason
  startDate: string
  returnDate: string
  endedDate: string | null
  midCourse: boolean
  documentReceived: boolean
  decidedByUserId: string | null
  decidedAt: string | null
  rejectionCategory: FreezeRejectionCategory | null
  startedAt: string | null
  needsPlacement: boolean
  createdAt: string
  version: number
}

const STUDENT_JOIN = and(
  eq(records.institutionId, enrollmentFreezes.institutionId),
  eq(records.collection, 'students'),
  eq(records.id, enrollmentFreezes.studentId),
)

const COLUMNS = {
  id: enrollmentFreezes.id,
  studentId: enrollmentFreezes.studentId,
  studentName: sql<string | null>`${records.data} ->> 'name'`,
  status: enrollmentFreezes.status,
  reason: enrollmentFreezes.reason,
  startDate: enrollmentFreezes.startDate,
  returnDate: enrollmentFreezes.returnDate,
  endedDate: enrollmentFreezes.endedDate,
  midCourse: enrollmentFreezes.midCourse,
  documentReceived: enrollmentFreezes.documentReceived,
  decidedByUserId: enrollmentFreezes.decidedByUserId,
  decidedAt: enrollmentFreezes.decidedAt,
  rejectionCategory: enrollmentFreezes.rejectionCategory,
  startedAt: enrollmentFreezes.startedAt,
  needsPlacement: enrollmentFreezes.needsPlacement,
  createdAt: enrollmentFreezes.createdAt,
  version: enrollmentFreezes.version,
}

type FreezeRow = Omit<StoredFreeze, 'decidedAt' | 'startedAt' | 'createdAt'> & {
  decidedAt: Date | null
  startedAt: Date | null
  createdAt: Date
}

const stored = (row: FreezeRow): StoredFreeze => ({
  ...row,
  decidedAt: row.decidedAt?.toISOString() ?? null,
  startedAt: row.startedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

const inInstitution = (institutionId: string) =>
  and(eq(enrollmentFreezes.institutionId, institutionId), isNull(enrollmentFreezes.archivedAt))

export async function findFreeze(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredFreeze | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(enrollmentFreezes)
    .leftJoin(records, STUDENT_JOIN)
    .where(and(inInstitution(institutionId), eq(enrollmentFreezes.id, id)))
    .limit(1)
  return row ? stored(row) : null
}

/** Kursiyerin bütün dondurmaları: açık kayıt ve 6 ay sınırı denetimi (DOM-DIL-052). */
export async function listStudentFreezes(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<StoredFreeze[]> {
  const rows = await db
    .select(COLUMNS)
    .from(enrollmentFreezes)
    .leftJoin(records, STUDENT_JOIN)
    .where(and(inInstitution(institutionId), eq(enrollmentFreezes.studentId, studentId)))
    .orderBy(asc(enrollmentFreezes.createdAt), asc(enrollmentFreezes.id))
  return rows.map(stored)
}

/** En yeni kayıt önce; `studentIds` verilirse (öğrenci, veli) kapsamla sınırlıdır. */
export async function listFreezes(
  db: Database,
  institutionId: string,
  query: {
    status?: FreezeStatus | undefined
    q?: string | undefined
    studentIds: readonly string[] | null
    page: number
    pageSize: number
  },
): Promise<{ items: StoredFreeze[]; total: number }> {
  if (query.studentIds !== null && query.studentIds.length === 0) return { items: [], total: 0 }
  const where = and(
    inInstitution(institutionId),
    query.status === undefined ? undefined : eq(enrollmentFreezes.status, query.status),
    query.studentIds === null
      ? undefined
      : inArray(enrollmentFreezes.studentId, [...query.studentIds]),
    query.q === undefined
      ? undefined
      : sql`strpos(${foldSql(sql`${records.data} ->> 'name'`)}, ${foldSearch(query.q)}) > 0`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(enrollmentFreezes)
    .leftJoin(records, STUDENT_JOIN)
    .where(where)
  const items = await db
    .select(COLUMNS)
    .from(enrollmentFreezes)
    .leftJoin(records, STUDENT_JOIN)
    .where(where)
    .orderBy(desc(enrollmentFreezes.createdAt), asc(enrollmentFreezes.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: items.map(stored), total: totalRow?.total ?? 0 }
}

export async function insertFreeze(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    studentId: string
    reason: FreezeReason
    startDate: string
    returnDate: string
    midCourse: boolean
    documentReceived: boolean
    requestedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...values } = input
  await tx.insert(enrollmentFreezes).values({
    institutionId,
    status: 'requested',
    createdAt: now,
    updatedAt: now,
    ...values,
  })
}

/** Sürüm kontrollü güncelleme; satır değişmediyse `false` (409). */
export async function updateFreeze(
  tx: Database,
  institutionId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<
    Pick<
      typeof enrollmentFreezes.$inferInsert,
      | 'status'
      | 'midCourse'
      | 'decidedByUserId'
      | 'decidedAt'
      | 'rejectionCategory'
      | 'startedAt'
      | 'endedDate'
      | 'needsPlacement'
    >
  >,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(enrollmentFreezes)
    .set({ ...patch, updatedAt: now, version: sql`${enrollmentFreezes.version} + 1` })
    .where(
      and(
        inInstitution(institutionId),
        eq(enrollmentFreezes.id, id),
        eq(enrollmentFreezes.version, expectedVersion),
      ),
    )
    .returning({ id: enrollmentFreezes.id })
  return rows.length === 1
}

/** Ayrılış açık kaydı kapatır: karara bağlanmamış talep iptal, onaylı kayıt sona erer. */
export async function closeOpenFreezes(
  tx: Database,
  institutionId: string,
  studentId: string,
  endedDate: string,
  now: Date,
): Promise<void> {
  const open = and(inInstitution(institutionId), eq(enrollmentFreezes.studentId, studentId))
  const touched = { updatedAt: now, version: sql`${enrollmentFreezes.version} + 1` }
  await tx
    .update(enrollmentFreezes)
    .set({ status: 'cancelled', ...touched })
    .where(and(open, eq(enrollmentFreezes.status, 'requested')))
  await tx
    .update(enrollmentFreezes)
    .set({ status: 'ended', endedDate, ...touched })
    .where(and(open, eq(enrollmentFreezes.status, 'approved')))
}

/** Başlangıç günü gelmiş, etkisi doğmamış onaylı kayıtlar (günlük iş). */
export async function dueFreezes(
  db: Database,
  institutionId: string,
  today: string,
): Promise<StoredFreeze[]> {
  const rows = await db
    .select(COLUMNS)
    .from(enrollmentFreezes)
    .leftJoin(records, STUDENT_JOIN)
    .where(
      and(
        inInstitution(institutionId),
        eq(enrollmentFreezes.status, 'approved'),
        isNull(enrollmentFreezes.startedAt),
        lte(enrollmentFreezes.startDate, today),
      ),
    )
    .orderBy(asc(enrollmentFreezes.startDate), asc(enrollmentFreezes.id))
  return rows.map(stored)
}

export interface LearnerGroup {
  groupId: string
  studentId: string
  memberStatus: GroupMemberStatus
  name: string
  courseId: string
  state: 'planned' | 'open' | 'cancelled'
  startDate: string
  endDate: string
}

/** Kursiyerlerin arşivlenmemiş grup üyelikleri, grubun tarihleriyle. */
export async function loadLearnerGroups(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<LearnerGroup[]> {
  if (studentIds.length === 0) return []
  return db
    .select({
      groupId: languageGroupMembers.groupId,
      studentId: languageGroupMembers.studentId,
      memberStatus: languageGroupMembers.status,
      name: languageGroups.name,
      courseId: languageGroups.courseId,
      state: languageGroups.state,
      startDate: languageGroups.startDate,
      endDate: languageGroups.endDate,
    })
    .from(languageGroupMembers)
    .innerJoin(
      languageGroups,
      and(
        eq(languageGroups.institutionId, languageGroupMembers.institutionId),
        eq(languageGroups.id, languageGroupMembers.groupId),
      ),
    )
    .where(
      and(
        eq(languageGroupMembers.institutionId, institutionId),
        isNull(languageGroupMembers.archivedAt),
        inArray(languageGroupMembers.studentId, [...studentIds]),
      ),
    )
    .orderBy(asc(languageGroups.startDate), asc(languageGroups.id))
}

const learnerRows = (institutionId: string, studentId: string, groupIds: readonly string[]) =>
  and(
    eq(languageGroupMembers.institutionId, institutionId),
    eq(languageGroupMembers.studentId, studentId),
    isNull(languageGroupMembers.archivedAt),
    inArray(languageGroupMembers.groupId, [...groupIds]),
  )

/** Üyeliğin durumunu yazar: dondurulan kapasiteye sayılmaz (`groupOccupancy`, DOM-DIL-040). */
export async function setLearnerGroupStatus(
  tx: Database,
  institutionId: string,
  studentId: string,
  groupIds: readonly string[],
  status: GroupMemberStatus,
  now: Date,
): Promise<void> {
  if (groupIds.length === 0) return
  await tx
    .update(languageGroupMembers)
    .set({ status, updatedAt: now, version: sql`${languageGroupMembers.version} + 1` })
    .where(learnerRows(institutionId, studentId, groupIds))
}

/**
 * Dönüşte eski gruba geçemeyen kursiyerin üyeliği kapanır (arşiv; geçmiş korunur): aynı kurda başka
 * gruba yerleşmesi engellenmesin (`group_member_same_course`).
 */
export async function releaseLearnerGroups(
  tx: Database,
  institutionId: string,
  studentId: string,
  groupIds: readonly string[],
  now: Date,
): Promise<void> {
  if (groupIds.length === 0) return
  await tx
    .update(languageGroupMembers)
    .set({ archivedAt: now, updatedAt: now, version: sql`${languageGroupMembers.version} + 1` })
    .where(learnerRows(institutionId, studentId, groupIds))
}
