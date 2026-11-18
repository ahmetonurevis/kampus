import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm'

import type { PayRateComponent, PayRateType } from '@kampus/school-core/lib/finance-pay-rates.ts'
import { monthOf, monthStart } from '@kampus/school-core/lib/finance-staff-costs.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffPayRates } from './schema/finance-pay-rates.ts'
import { staffCostAllocations, staffCostAllocationShares } from './schema/finance-staff-costs.ts'

/**
 * Personel maliyet ataması deposu ve rapor girdileri (DOM-FIN-104; ON-204). Kurum kapsamlıdır: ilk
 * parametre `institutionId`. İptal edilmiş (arşivli) atama okunmaz. Kural core
 * `lib/finance-staff-costs.ts` ve `lib/finance-staff-cost-report.ts`'tedir; depo yalnız okur ve
 * yazar. Ay `YYYY-MM` olarak döner, veritabanında ayın ilk günüdür.
 */

export interface StoredStaffCostAllocation {
  id: string
  membershipId: string
  startMonth: string
  shares: { costCenterId: string; shareBasisPoints: number }[]
  wageHours: number | null
  extraLessonHours: number | null
  dutyHours: number | null
  createdAt: string
  version: number
}

const COLUMNS = {
  id: staffCostAllocations.id,
  membershipId: staffCostAllocations.membershipId,
  startMonth: staffCostAllocations.startMonth,
  wageHours: staffCostAllocations.wageHours,
  extraLessonHours: staffCostAllocations.extraLessonHours,
  dutyHours: staffCostAllocations.dutyHours,
  createdAt: staffCostAllocations.createdAt,
  version: staffCostAllocations.version,
}

const ofInstitution = (institutionId: string) =>
  and(
    eq(staffCostAllocations.institutionId, institutionId),
    isNull(staffCostAllocations.archivedAt),
  )

async function withShares(
  db: Database,
  institutionId: string,
  rows: (Omit<StoredStaffCostAllocation, 'shares' | 'createdAt'> & { createdAt: Date })[],
): Promise<StoredStaffCostAllocation[]> {
  if (rows.length === 0) return []
  const shares = await db
    .select({
      allocationId: staffCostAllocationShares.allocationId,
      costCenterId: staffCostAllocationShares.costCenterId,
      shareBasisPoints: staffCostAllocationShares.shareBasisPoints,
    })
    .from(staffCostAllocationShares)
    .where(
      and(
        eq(staffCostAllocationShares.institutionId, institutionId),
        inArray(
          staffCostAllocationShares.allocationId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(
      asc(staffCostAllocationShares.allocationId),
      asc(staffCostAllocationShares.shareBasisPoints),
    )
  const byAllocation = new Map<string, StoredStaffCostAllocation['shares']>()
  for (const { allocationId, ...share } of shares)
    byAllocation.set(allocationId, [...(byAllocation.get(allocationId) ?? []), share])
  return rows.map((row) => ({
    ...row,
    startMonth: monthOf(row.startMonth),
    createdAt: row.createdAt.toISOString(),
    // Büyük pay önce; eşit payda merkez kimliği sırası.
    shares: (byAllocation.get(row.id) ?? []).sort(
      (a, b) =>
        b.shareBasisPoints - a.shareBasisPoints || a.costCenterId.localeCompare(b.costCenterId),
    ),
  }))
}

/** Personellerin iptal edilmemiş atamaları (başlangıca göre); `null` bütün kurum. */
export async function loadStaffCostAllocations(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[] | null,
): Promise<StoredStaffCostAllocation[]> {
  if (membershipIds !== null && membershipIds.length === 0) return []
  const rows = await db
    .select(COLUMNS)
    .from(staffCostAllocations)
    .where(
      and(
        ofInstitution(institutionId),
        membershipIds === null
          ? undefined
          : inArray(staffCostAllocations.membershipId, [...new Set(membershipIds)]),
      ),
    )
    .orderBy(
      asc(staffCostAllocations.membershipId),
      asc(staffCostAllocations.startMonth),
      asc(staffCostAllocations.id),
    )
  return withShares(db, institutionId, rows)
}

export async function findStaffCostAllocation(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStaffCostAllocation | null> {
  const rows = await db
    .select(COLUMNS)
    .from(staffCostAllocations)
    .where(and(ofInstitution(institutionId), eq(staffCostAllocations.id, id)))
    .limit(1)
  const [found] = await withShares(db, institutionId, rows)
  return found ?? null
}

/** Personelin aynı başlangıç aylı iptal edilmemiş ataması var mı. */
export async function isStaffCostMonthTaken(
  tx: Database,
  institutionId: string,
  membershipId: string,
  startMonth: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: staffCostAllocations.id })
    .from(staffCostAllocations)
    .where(
      and(
        ofInstitution(institutionId),
        eq(staffCostAllocations.membershipId, membershipId),
        eq(staffCostAllocations.startMonth, monthStart(startMonth)),
      ),
    )
    .limit(1)
  return row !== undefined
}

export interface StaffCostAllocationInsert {
  id: string
  membershipId: string
  startMonth: string
  shares: readonly { costCenterId: string; shareBasisPoints: number }[]
  wageHours: number | null
  extraLessonHours: number | null
  dutyHours: number | null
  createdByUserId: string
  now: Date
}

export async function insertStaffCostAllocation(
  tx: Database,
  institutionId: string,
  input: StaffCostAllocationInsert,
): Promise<void> {
  const { now, shares, startMonth, ...fields } = input
  await tx.insert(staffCostAllocations).values({
    ...fields,
    startMonth: monthStart(startMonth),
    institutionId,
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(staffCostAllocationShares).values(
    shares.map((share) => ({
      institutionId,
      allocationId: input.id,
      costCenterId: share.costCenterId,
      shareBasisPoints: share.shareBasisPoints,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/** İptal (arşiv) gerekçeyle; sürüm tutmazsa `false` (409). */
export async function cancelStaffCostAllocation(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: string; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffCostAllocations)
    .set({
      archivedAt: input.now,
      cancelReason: input.reason,
      cancelledByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        ofInstitution(institutionId),
        eq(staffCostAllocations.id, input.id),
        eq(staffCostAllocations.version, input.expectedVersion),
      ),
    )
    .returning({ id: staffCostAllocations.id })
  return rows.length === 1
}

// --- Rapor girdileri -----------------------------------------------------------------------------

export interface StaffCostMemberRow {
  membershipId: string
  name: string
  role: string
  /** Pasifleştirme günü (Europe/Istanbul); etkin personelde `null`. */
  deactivatedDay: string | null
}

/** Kurumun bütün personeli (yönetici, öğretmen, ön büro; pasifler dahil), ada göre. */
export async function loadStaffCostMembers(
  db: Database,
  institutionId: string,
): Promise<StaffCostMemberRow[]> {
  const rows = await db
    .select({
      membershipId: memberships.id,
      name: users.name,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.role, [...STAFF_ROLES]),
      ),
    )
    .orderBy(asc(users.name), asc(memberships.id))
  return rows.map(({ deactivatedAt, ...row }) => ({
    ...row,
    deactivatedDay: deactivatedAt === null ? null : dayKey(deactivatedAt),
  }))
}

export interface StaffCostRateRow {
  membershipId: string
  component: PayRateComponent
  rateType: PayRateType
  amountCents: number
  startDate: string
  endDate: string | null
}

/** `from`–`to` günleriyle kesişen, iptal edilmemiş ücret tanımları (DOM-FIN-099). */
export async function loadStaffCostRates(
  db: Database,
  institutionId: string,
  range: { from: string; to: string },
): Promise<StaffCostRateRow[]> {
  return db
    .select({
      membershipId: staffPayRates.membershipId,
      component: staffPayRates.component,
      rateType: staffPayRates.rateType,
      amountCents: staffPayRates.amountCents,
      startDate: staffPayRates.startDate,
      endDate: staffPayRates.endDate,
    })
    .from(staffPayRates)
    .where(
      and(
        eq(staffPayRates.institutionId, institutionId),
        isNull(staffPayRates.archivedAt),
        lte(staffPayRates.startDate, range.to),
        or(isNull(staffPayRates.endDate), gte(staffPayRates.endDate, range.from)),
      ),
    )
    .orderBy(asc(staffPayRates.membershipId), asc(staffPayRates.slot), asc(staffPayRates.startDate))
}
