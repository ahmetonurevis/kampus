import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'

import type { Database } from './client.ts'
import { scholarshipAwards, scholarshipPrograms } from './schema/finance-scholarships.ts'

/** Burs programı ve ataması deposu (DOM-FIN-025); her sorgu kurum kapsamlıdır. */

const PROGRAM_COLUMNS = {
  id: scholarshipPrograms.id,
  academicYear: scholarshipPrograms.academicYear,
  name: scholarshipPrograms.name,
  conditions: scholarshipPrograms.conditions,
  terminationConditions: scholarshipPrograms.terminationConditions,
  durationNote: scholarshipPrograms.durationNote,
  percentBasisPoints: scholarshipPrograms.percentBasisPoints,
  amountCents: scholarshipPrograms.amountCents,
  capacity: scholarshipPrograms.capacity,
  notifiedDate: scholarshipPrograms.notifiedDate,
  version: scholarshipPrograms.version,
}
const AWARD_COLUMNS = {
  id: scholarshipAwards.id,
  programId: scholarshipAwards.programId,
  studentId: scholarshipAwards.studentId,
  academicYear: scholarshipAwards.academicYear,
  amountCents: scholarshipAwards.amountCents,
  mebbisRecordedDate: scholarshipAwards.mebbisRecordedDate,
  version: scholarshipAwards.version,
}

export type StoredScholarshipProgram = {
  id: string
  academicYear: number
  name: string
  conditions: string
  terminationConditions: string
  durationNote: string
  percentBasisPoints: number | null
  amountCents: number | null
  capacity: number
  notifiedDate: string | null
  version: number
}
export type StoredScholarshipAward = {
  id: string
  programId: string
  studentId: string
  academicYear: number
  amountCents: number
  mebbisRecordedDate: string | null
  version: number
}

const activeProgram = (institutionId: string) =>
  and(eq(scholarshipPrograms.institutionId, institutionId), isNull(scholarshipPrograms.archivedAt))
const activeAward = (institutionId: string) =>
  and(eq(scholarshipAwards.institutionId, institutionId), isNull(scholarshipAwards.archivedAt))

export async function findScholarshipProgram(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredScholarshipProgram | null> {
  const [row] = await db
    .select(PROGRAM_COLUMNS)
    .from(scholarshipPrograms)
    .where(and(activeProgram(institutionId), eq(scholarshipPrograms.id, id)))
    .limit(1)
  return row ?? null
}

export async function scholarshipProgramNames(
  db: Database,
  institutionId: string,
  academicYear: number,
): Promise<string[]> {
  const rows = await db
    .select({ name: scholarshipPrograms.name })
    .from(scholarshipPrograms)
    .where(and(activeProgram(institutionId), eq(scholarshipPrograms.academicYear, academicYear)))
  return rows.map((row) => row.name)
}

export async function listScholarshipPrograms(
  db: Database,
  institutionId: string,
  query: { academicYear?: number | undefined; page: number; pageSize: number },
): Promise<{ items: (StoredScholarshipProgram & { awardedCount: number })[]; total: number }> {
  const where = and(
    activeProgram(institutionId),
    query.academicYear === undefined
      ? undefined
      : eq(scholarshipPrograms.academicYear, query.academicYear),
  )
  const [totalRow] = await db.select({ total: count() }).from(scholarshipPrograms).where(where)
  const rows = await db
    .select(PROGRAM_COLUMNS)
    .from(scholarshipPrograms)
    .where(where)
    .orderBy(desc(scholarshipPrograms.academicYear), asc(scholarshipPrograms.name))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  const counts = await db
    .select({ programId: scholarshipAwards.programId, total: count() })
    .from(scholarshipAwards)
    .where(activeAward(institutionId))
    .groupBy(scholarshipAwards.programId)
  const byProgram = new Map(counts.map((row) => [row.programId, row.total]))
  return {
    items: rows.map((row) => ({ ...row, awardedCount: byProgram.get(row.id) ?? 0 })),
    total: totalRow?.total ?? 0,
  }
}

export async function insertScholarshipProgram(
  tx: Database,
  institutionId: string,
  input: Omit<StoredScholarshipProgram, 'version' | 'notifiedDate'> & { now: Date },
): Promise<void> {
  const { now, ...program } = input
  await tx
    .insert(scholarshipPrograms)
    .values({ institutionId, ...program, createdAt: now, updatedAt: now })
}

/** Bildirim gününü yazar; sürüm tutmazsa `false` (409). */
export async function setScholarshipProgramNotified(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; notifiedDate: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(scholarshipPrograms)
    .set({
      notifiedDate: input.notifiedDate,
      version: sql`${scholarshipPrograms.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        activeProgram(institutionId),
        eq(scholarshipPrograms.id, input.id),
        eq(scholarshipPrograms.version, input.expectedVersion),
      ),
    )
    .returning({ id: scholarshipPrograms.id })
  return rows.length === 1
}

export async function countScholarshipAwards(
  db: Database,
  institutionId: string,
  programId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(scholarshipAwards)
    .where(and(activeAward(institutionId), eq(scholarshipAwards.programId, programId)))
  return row?.total ?? 0
}

export async function insertScholarshipAward(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    programId: string
    studentId: string
    academicYear: number
    amountCents: number
    awardedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...award } = input
  await tx
    .insert(scholarshipAwards)
    .values({ institutionId, ...award, createdAt: now, updatedAt: now })
}

export async function findScholarshipAward(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredScholarshipAward | null> {
  const [row] = await db
    .select(AWARD_COLUMNS)
    .from(scholarshipAwards)
    .where(and(activeAward(institutionId), eq(scholarshipAwards.id, id)))
    .limit(1)
  return row ?? null
}

export async function listScholarshipAwards(
  db: Database,
  institutionId: string,
  query: { programId?: string | undefined; page: number; pageSize: number },
): Promise<{ items: StoredScholarshipAward[]; total: number }> {
  const where = and(
    activeAward(institutionId),
    query.programId === undefined ? undefined : eq(scholarshipAwards.programId, query.programId),
  )
  const [totalRow] = await db.select({ total: count() }).from(scholarshipAwards).where(where)
  const items = await db
    .select(AWARD_COLUMNS)
    .from(scholarshipAwards)
    .where(where)
    .orderBy(desc(scholarshipAwards.createdAt), asc(scholarshipAwards.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

/** MEBBİS gününü yazar; sürüm tutmazsa `false` (409). */
export async function setScholarshipAwardMebbis(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; recordedDate: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(scholarshipAwards)
    .set({
      mebbisRecordedDate: input.recordedDate,
      version: sql`${scholarshipAwards.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        activeAward(institutionId),
        eq(scholarshipAwards.id, input.id),
        eq(scholarshipAwards.version, input.expectedVersion),
      ),
    )
    .returning({ id: scholarshipAwards.id })
  return rows.length === 1
}
