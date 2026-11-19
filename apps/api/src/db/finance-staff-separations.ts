import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'

import type {
  StaffSeparationDetails,
  StaffSeparationManualStep,
  StaffSeparationPlan,
  StaffSeparationStatus,
} from '@kampus/school-core/lib/finance-staff-separations.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffSeparations } from './schema/finance-staff-separations.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * İşten ayrılış dosyası deposu (DOM-FIN-118; ON-180). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-staff-separations.ts`'tedir; depo yalnız okur ve yazar.
 * Personel adı, rolü ve pasifleştirme anı üyelikten (Better Auth `memberships`, `users`) yalnız
 * okunur. Her güncelleme `version` eşleşmesiyle yazar; 0 satır çağırana `false` döner (409).
 */

export interface StoredStaffSeparation extends StaffSeparationDetails {
  id: string
  membershipId: string
  staffName: string
  staffRole: string
  /** Üyeliğin pasifleştirildiği an (ISO); etkinse `null`. */
  deactivatedAt: string | null
  status: StaffSeparationStatus
  deductionsCheckedAt: string | null
  deductionsCheckedByUserId: string | null
  leaveCheckedAt: string | null
  leaveCheckedByUserId: string | null
  severanceCheckedAt: string | null
  severanceCheckedByUserId: string | null
  unusedLeaveDays: number | null
  completedAt: string | null
  completedByUserId: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
  version: number
}

const COLUMNS = {
  id: staffSeparations.id,
  membershipId: staffSeparations.membershipId,
  staffName: users.name,
  staffRole: memberships.role,
  deactivatedAt: memberships.deactivatedAt,
  separationDate: staffSeparations.separationDate,
  reason: staffSeparations.reason,
  sgkExitCode: staffSeparations.sgkExitCode,
  hireDate: staffSeparations.hireDate,
  noticeGivenDate: staffSeparations.noticeGivenDate,
  note: staffSeparations.note,
  status: staffSeparations.status,
  deductionsCheckedAt: staffSeparations.deductionsCheckedAt,
  deductionsCheckedByUserId: staffSeparations.deductionsCheckedByUserId,
  leaveCheckedAt: staffSeparations.leaveCheckedAt,
  leaveCheckedByUserId: staffSeparations.leaveCheckedByUserId,
  severanceCheckedAt: staffSeparations.severanceCheckedAt,
  severanceCheckedByUserId: staffSeparations.severanceCheckedByUserId,
  unusedLeaveDays: staffSeparations.unusedLeaveDays,
  completedAt: staffSeparations.completedAt,
  completedByUserId: staffSeparations.completedByUserId,
  cancelledAt: staffSeparations.cancelledAt,
  cancelReason: staffSeparations.cancelReason,
  createdAt: staffSeparations.createdAt,
  version: staffSeparations.version,
}

type TimeKey =
  | 'deactivatedAt'
  | 'deductionsCheckedAt'
  | 'leaveCheckedAt'
  | 'severanceCheckedAt'
  | 'completedAt'
  | 'cancelledAt'
type Row = Omit<StoredStaffSeparation, TimeKey | 'createdAt'> &
  Record<TimeKey, Date | null> & { createdAt: Date }

const iso = (value: Date | null) => (value === null ? null : value.toISOString())
const toSeparation = (row: Row): StoredStaffSeparation => ({
  ...row,
  deactivatedAt: iso(row.deactivatedAt),
  deductionsCheckedAt: iso(row.deductionsCheckedAt),
  leaveCheckedAt: iso(row.leaveCheckedAt),
  severanceCheckedAt: iso(row.severanceCheckedAt),
  completedAt: iso(row.completedAt),
  cancelledAt: iso(row.cancelledAt),
  createdAt: row.createdAt.toISOString(),
})

const ofInstitution = (institutionId: string) =>
  and(
    eq(staffSeparations.institutionId, institutionId),
    sql`${staffSeparations.archivedAt} is null`,
  )

const withJoins = (db: Database) =>
  db
    .select(COLUMNS)
    .from(staffSeparations)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, staffSeparations.institutionId),
        eq(memberships.id, staffSeparations.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))

export async function findStaffSeparation(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStaffSeparation | null> {
  const [row] = await withJoins(db)
    .where(and(ofInstitution(institutionId), eq(staffSeparations.id, id)))
    .limit(1)
  return row === undefined ? null : toSeparation(row)
}

/** Personelin açık dosyası var mı (kurum kilidi altında; tekil indeksten önce 409 için). */
export async function hasOpenSeparation(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: staffSeparations.id })
    .from(staffSeparations)
    .where(
      and(
        ofInstitution(institutionId),
        eq(staffSeparations.membershipId, membershipId),
        eq(staffSeparations.status, 'open'),
      ),
    )
    .limit(1)
  return row !== undefined
}

export interface StaffSeparationQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: StaffSeparationStatus | undefined
  membershipId?: string | undefined
}

/** Dosyalar: açıklar önce, sonra ayrılış günü yeni önce; arama personel adında. */
export async function listStaffSeparations(
  db: Database,
  institutionId: string,
  query: StaffSeparationQuery,
): Promise<{ items: StoredStaffSeparation[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    ofInstitution(institutionId),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
    query.status === undefined ? undefined : eq(staffSeparations.status, query.status),
    query.membershipId === undefined
      ? undefined
      : eq(staffSeparations.membershipId, query.membershipId),
  ]
  const where = and(...filters)
  const [totalRow] = await db
    .select({ total: count() })
    .from(staffSeparations)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, staffSeparations.institutionId),
        eq(memberships.id, staffSeparations.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
  const rows = await withJoins(db)
    .where(where)
    .orderBy(
      sql`${staffSeparations.status} <> 'open'`,
      desc(staffSeparations.separationDate),
      desc(staffSeparations.createdAt),
      asc(staffSeparations.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toSeparation), total: totalRow?.total ?? 0 }
}

export async function insertStaffSeparation(
  db: Database,
  institutionId: string,
  values: StaffSeparationPlan & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, ...rest } = values
  await db.insert(staffSeparations).values({
    ...rest,
    institutionId,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  })
}

const versioned = (institutionId: string, id: string, expectedVersion: number) =>
  and(
    ofInstitution(institutionId),
    eq(staffSeparations.id, id),
    eq(staffSeparations.version, expectedVersion),
    eq(staffSeparations.status, 'open'),
  )

async function updateOpen(
  db: Database,
  institutionId: string,
  id: string,
  expectedVersion: number,
  now: Date,
  set: Partial<typeof staffSeparations.$inferInsert>,
): Promise<boolean> {
  const rows = await db
    .update(staffSeparations)
    .set({ ...set, updatedAt: now, version: sql`${staffSeparations.version} + 1` })
    .where(versioned(institutionId, id, expectedVersion))
    .returning({ id: staffSeparations.id })
  return rows.length === 1
}

export function updateStaffSeparationDetails(
  db: Database,
  institutionId: string,
  values: { id: string; expectedVersion: number; details: StaffSeparationDetails; now: Date },
): Promise<boolean> {
  return updateOpen(db, institutionId, values.id, values.expectedVersion, values.now, {
    ...values.details,
  })
}

const MARK_COLUMNS = {
  deductions: { at: 'deductionsCheckedAt', by: 'deductionsCheckedByUserId' },
  leave: { at: 'leaveCheckedAt', by: 'leaveCheckedByUserId' },
  severance: { at: 'severanceCheckedAt', by: 'severanceCheckedByUserId' },
} as const satisfies Record<
  StaffSeparationManualStep,
  { at: keyof typeof staffSeparations.$inferInsert; by: keyof typeof staffSeparations.$inferInsert }
>

export function markStaffSeparationStep(
  db: Database,
  institutionId: string,
  values: {
    id: string
    expectedVersion: number
    step: StaffSeparationManualStep
    done: boolean
    userId: string
    now: Date
  },
): Promise<boolean> {
  const columns = MARK_COLUMNS[values.step]
  return updateOpen(db, institutionId, values.id, values.expectedVersion, values.now, {
    [columns.at]: values.done ? values.now : null,
    [columns.by]: values.done ? values.userId : null,
  })
}

export function completeStaffSeparation(
  db: Database,
  institutionId: string,
  values: {
    id: string
    expectedVersion: number
    unusedLeaveDays: number | null
    userId: string
    now: Date
  },
): Promise<boolean> {
  return updateOpen(db, institutionId, values.id, values.expectedVersion, values.now, {
    status: 'completed',
    completedAt: values.now,
    completedByUserId: values.userId,
    unusedLeaveDays: values.unusedLeaveDays,
  })
}

export function cancelStaffSeparation(
  db: Database,
  institutionId: string,
  values: { id: string; expectedVersion: number; reason: string; userId: string; now: Date },
): Promise<boolean> {
  return updateOpen(db, institutionId, values.id, values.expectedVersion, values.now, {
    status: 'cancelled',
    cancelledAt: values.now,
    cancelledByUserId: values.userId,
    cancelReason: values.reason,
  })
}

/** Kullanıcı adları (işaretleyen, tamamlayan); kimlik kullanıcı tablosundadır. */
export async function separationUserNames(
  db: Database,
  userIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids))
  return new Map(rows.map((row) => [row.id, row.name]))
}
