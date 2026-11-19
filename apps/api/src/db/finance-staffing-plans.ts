import { and, asc, desc, eq, sql } from 'drizzle-orm'

import {
  STAFFING_NORM_DEFAULT,
  type StaffingLine,
  type StaffingPositionStatus,
} from '@kampus/school-core/lib/finance-staffing-plans.ts'

import type { Database } from './client.ts'
import { staffJobOffers } from './schema/finance-staff-onboarding.ts'
import { staffingPlans, staffingPositions } from './schema/finance-staffing-plans.ts'

/**
 * Kadro planı ve açık pozisyon deposu (DOM-FIN-126; ON-188). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-staffing-plans.ts`'tedir; depo yalnız okur ve yazar.
 */

export interface StoredStaffingPlan {
  academicYear: number
  normHours: number
  lines: StaffingLine[]
  /** `If-Match` sürümü; plan hiç kaydedilmediyse 1. */
  version: number
  updatedAt: string | null
}

/** Plan; satır yoksa varsayılan (norm 20, satır yok, sürüm 1). */
export async function loadStaffingPlan(
  db: Database,
  institutionId: string,
  academicYear: number,
): Promise<StoredStaffingPlan> {
  const [row] = await db
    .select({
      normHours: staffingPlans.normHours,
      lines: staffingPlans.lines,
      version: staffingPlans.version,
      updatedAt: staffingPlans.updatedAt,
    })
    .from(staffingPlans)
    .where(
      and(
        eq(staffingPlans.institutionId, institutionId),
        eq(staffingPlans.academicYear, academicYear),
      ),
    )
    .limit(1)
  return row === undefined
    ? { academicYear, normHours: STAFFING_NORM_DEFAULT, lines: [], version: 1, updatedAt: null }
    : { academicYear, ...row, updatedAt: row.updatedAt.toISOString() }
}

/** Planı sürüm koşuluyla yazar; tutmazsa `null` (409). İlk kayıt satırı sürüm 2 ile açar. */
export async function saveStaffingPlan(
  tx: Database,
  institutionId: string,
  input: {
    academicYear: number
    normHours: number
    lines: StaffingLine[]
    expectedVersion: number
    userId: string
    now: Date
  },
): Promise<number | null> {
  const values = {
    normHours: input.normHours,
    lines: input.lines,
    updatedByUserId: input.userId,
    updatedAt: input.now,
  }
  const [updated] = await tx
    .update(staffingPlans)
    .set({ ...values, version: sql`${staffingPlans.version} + 1` })
    .where(
      and(
        eq(staffingPlans.institutionId, institutionId),
        eq(staffingPlans.academicYear, input.academicYear),
        eq(staffingPlans.version, input.expectedVersion),
      ),
    )
    .returning({ version: staffingPlans.version })
  if (updated !== undefined) return updated.version
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(staffingPlans)
    .values({
      ...values,
      institutionId,
      academicYear: input.academicYear,
      version: 2,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ version: staffingPlans.version })
  return created?.version ?? null
}

export interface StoredStaffingPosition {
  id: string
  academicYear: number
  subjectId: string
  hours: number
  status: StaffingPositionStatus
  jobOfferId: string | null
  jobOfferPosition: string | null
  note: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const p = staffingPositions

/** Pozisyon sütunları ve teklif adı; kurum süzgecini çağıran ekler. */
function positionQuery(db: Database) {
  return db
    .select({
      id: p.id,
      academicYear: p.academicYear,
      subjectId: p.subjectId,
      hours: p.hours,
      status: p.status,
      jobOfferId: p.jobOfferId,
      jobOfferPosition: staffJobOffers.position,
      note: p.note,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      version: p.version,
    })
    .from(p)
    .leftJoin(
      staffJobOffers,
      and(eq(staffJobOffers.institutionId, p.institutionId), eq(staffJobOffers.id, p.jobOfferId)),
    )
    .$dynamic()
}

type PositionRow = Awaited<ReturnType<typeof positionQuery>>[number]
const toPosition = (row: PositionRow): StoredStaffingPosition => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

/** Eğitim yılının pozisyonları, yeni açılan önce. */
export async function listStaffingPositions(
  db: Database,
  institutionId: string,
  academicYear: number,
): Promise<StoredStaffingPosition[]> {
  const rows = await positionQuery(db)
    .where(and(eq(p.institutionId, institutionId), eq(p.academicYear, academicYear)))
    .orderBy(desc(p.createdAt), asc(p.id))
  return rows.map(toPosition)
}

export async function findStaffingPosition(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStaffingPosition | null> {
  const [row] = await positionQuery(db)
    .where(and(eq(p.institutionId, institutionId), eq(p.id, id)))
    .limit(1)
  return row === undefined ? null : toPosition(row)
}

/** Kurumun iş teklifi var mı (DOM-FIN-121); başka kurumun teklifi yok sayılır. */
export async function jobOfferExists(
  db: Database,
  institutionId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: staffJobOffers.id })
    .from(staffJobOffers)
    .where(and(eq(staffJobOffers.institutionId, institutionId), eq(staffJobOffers.id, id)))
    .limit(1)
  return row !== undefined
}

export async function insertStaffingPosition(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    academicYear: number
    subjectId: string
    hours: number
    note: string | null
    jobOfferId: string | null
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(staffingPositions).values({
    institutionId,
    id: input.id,
    academicYear: input.academicYear,
    subjectId: input.subjectId,
    hours: input.hours,
    status: 'open',
    note: input.note,
    jobOfferId: input.jobOfferId,
    createdByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Sürüm koşuluyla günceller; tutmazsa `false` (409). */
export async function updateStaffingPosition(
  tx: Database,
  institutionId: string,
  id: string,
  input: {
    status: StaffingPositionStatus
    hours: number
    note: string | null
    jobOfferId: string | null
    expectedVersion: number
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(staffingPositions)
    .set({
      status: input.status,
      hours: input.hours,
      note: input.note,
      jobOfferId: input.jobOfferId,
      updatedAt: input.now,
      version: sql`${staffingPositions.version} + 1`,
    })
    .where(
      and(
        eq(staffingPositions.institutionId, institutionId),
        eq(staffingPositions.id, id),
        eq(staffingPositions.version, input.expectedVersion),
      ),
    )
    .returning({ id: staffingPositions.id })
  return rows.length === 1
}
