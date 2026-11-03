import { and, asc, count, eq, isNull, sql } from 'drizzle-orm'

import type { CoordinatorDutyDraft } from '@kampus/school-core/lib/coordinator-duties.ts'

import type { Database } from './client.ts'
import { memberships } from './schema/auth.ts'
import { membershipLinks } from './schema/membership-links.ts'
import { coordinatorDuties } from './schema/coordinator-duties.ts'

/**
 * Koordinatör görevi deposu (DOM-YTK-027). Kurum kapsamlıdır: ilk parametre `institutionId`;
 * arşivli (kaldırılmış) görev okunmaz ve kapsam vermez.
 */

type DutyRow = typeof coordinatorDuties.$inferSelect

export type StoredCoordinatorDuty = {
  id: string
  membershipId: string
  kind: DutyRow['kind']
  scopeId: string
  assignedByUserId: string
  createdAt: string
  rowVersion: number
}

const toDuty = (row: DutyRow): StoredCoordinatorDuty => ({
  id: row.id,
  membershipId: row.membershipId,
  kind: row.kind,
  scopeId: row.scopeId,
  assignedByUserId: row.assignedByUserId,
  createdAt: row.createdAt.toISOString(),
  rowVersion: row.version,
})

const active = (institutionId: string) =>
  and(eq(coordinatorDuties.institutionId, institutionId), isNull(coordinatorDuties.archivedAt))

/** Üyeliğin etkin görevleri (koordinatör kapsamı; her puanlama isteğinde okunur). */
export async function activeDutiesOf(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<StoredCoordinatorDuty[]> {
  const rows = await db
    .select()
    .from(coordinatorDuties)
    .where(and(active(institutionId), eq(coordinatorDuties.membershipId, membershipId)))
    .orderBy(asc(coordinatorDuties.kind), asc(coordinatorDuties.scopeId))
  return rows.map(toDuty)
}

/**
 * Öğretmen kaydına (`teacher` bağlantısı) bağlı üyeliklerin etkin görevleri. Öğretmen kaydı
 * değişirken (branş) görev kapsamının tutarlı kalması için okunur (DOM-YTK-027); arşivli
 * bağlantı ve arşivli görev sayılmaz.
 */
export async function activeDutiesOfTeacherRecord(
  db: Database,
  institutionId: string,
  teacherRecordId: string,
): Promise<StoredCoordinatorDuty[]> {
  const rows = await db
    .select({ duty: coordinatorDuties })
    .from(coordinatorDuties)
    .innerJoin(
      membershipLinks,
      and(
        eq(membershipLinks.institutionId, coordinatorDuties.institutionId),
        eq(membershipLinks.membershipId, coordinatorDuties.membershipId),
      ),
    )
    .where(
      and(
        active(institutionId),
        eq(membershipLinks.kind, 'teacher'),
        eq(membershipLinks.recordId, teacherRecordId),
        isNull(membershipLinks.archivedAt),
      ),
    )
    .orderBy(asc(coordinatorDuties.kind), asc(coordinatorDuties.scopeId))
  return rows.map((row) => toDuty(row.duty))
}

export async function listCoordinatorDuties(
  db: Database,
  institutionId: string,
  query: { membershipId?: string | undefined; page: number; pageSize: number },
): Promise<{ rows: StoredCoordinatorDuty[]; total: number }> {
  const where = and(
    active(institutionId),
    ...(query.membershipId === undefined
      ? []
      : [eq(coordinatorDuties.membershipId, query.membershipId)]),
  )
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(coordinatorDuties)
      .where(where)
      .orderBy(
        asc(coordinatorDuties.membershipId),
        asc(coordinatorDuties.scopeId),
        asc(coordinatorDuties.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(coordinatorDuties).where(where),
  ])
  return { rows: rows.map(toDuty), total: totals?.total ?? 0 }
}

/** Etkin görev; kaldırılmış, olmayan veya başka kurumun görevi `null`. */
export async function findCoordinatorDuty(
  db: Database,
  institutionId: string,
  dutyId: string,
): Promise<StoredCoordinatorDuty | null> {
  const [row] = await db
    .select()
    .from(coordinatorDuties)
    .where(and(active(institutionId), eq(coordinatorDuties.id, dutyId)))
    .limit(1)
  return row ? toDuty(row) : null
}

/** Kurumdaki üyelik (rolüyle); başka kurumun üyeliği `null`. */
export async function findInstitutionMembership(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<{ id: string; userId: string; role: string } | null> {
  const [row] = await db
    .select({ id: memberships.id, userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.id, membershipId)))
    .limit(1)
  return row ?? null
}

export async function insertCoordinatorDuty(
  tx: Database,
  institutionId: string,
  duty: CoordinatorDutyDraft & { id: string; assignedByUserId: string },
  now: Date,
): Promise<void> {
  await tx.insert(coordinatorDuties).values({
    institutionId,
    ...duty,
    createdAt: now,
    updatedAt: now,
  })
}

/** Görevi kaldırır (arşiv); sürüm tutmazsa `false` (409). */
export async function archiveCoordinatorDuty(
  tx: Database,
  institutionId: string,
  duty: Pick<StoredCoordinatorDuty, 'id' | 'rowVersion'>,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(coordinatorDuties)
    .set({ archivedAt: now, updatedAt: now, version: sql`${coordinatorDuties.version} + 1` })
    .where(
      and(
        active(institutionId),
        eq(coordinatorDuties.id, duty.id),
        eq(coordinatorDuties.version, duty.rowVersion),
      ),
    )
    .returning({ id: coordinatorDuties.id })
  return rows.length === 1
}
