import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import type {
  SgkEmploymentDatesEntry,
  SgkMember,
  SgkMissingDayEntry,
  SgkReasonCode,
} from '@kampus/school-core/lib/finance-sgk-preparation.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffPayRates } from './schema/finance-pay-rates.ts'
import { sgkEmploymentDates, sgkMissingDays } from './schema/finance-sgk-preparation.ts'

/**
 * SGK hazırlık listesi deposu (DOM-FIN-107; ON-203). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Arşivli (kaldırılmış) elle satır okunmaz. Kural core
 * `lib/finance-sgk-preparation.ts`'tedir; depo yalnız okur ve yazar.
 */

const missingOf = (institutionId: string) =>
  and(eq(sgkMissingDays.institutionId, institutionId), isNull(sgkMissingDays.archivedAt))
const datesOf = (institutionId: string) =>
  and(eq(sgkEmploymentDates.institutionId, institutionId), isNull(sgkEmploymentDates.archivedAt))

const MISSING_COLUMNS = {
  id: sgkMissingDays.id,
  membershipId: sgkMissingDays.membershipId,
  days: sgkMissingDays.days,
  reasonCode: sgkMissingDays.reasonCode,
  note: sgkMissingDays.note,
  version: sgkMissingDays.version,
  createdAt: sgkMissingDays.createdAt,
}
const DATES_COLUMNS = {
  id: sgkEmploymentDates.id,
  membershipId: sgkEmploymentDates.membershipId,
  entryDate: sgkEmploymentDates.entryDate,
  exitDate: sgkEmploymentDates.exitDate,
  note: sgkEmploymentDates.note,
  version: sgkEmploymentDates.version,
  createdAt: sgkEmploymentDates.createdAt,
}
const iso = <T extends { createdAt: Date }>(row: T) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})

/** Ayın etkin eksik gün satırları; `membershipId` verilirse yalnız onun. */
export async function loadSgkMissingDays(
  db: Database,
  institutionId: string,
  month: string,
  membershipId?: string,
): Promise<SgkMissingDayEntry[]> {
  const rows = await db
    .select(MISSING_COLUMNS)
    .from(sgkMissingDays)
    .where(
      and(
        missingOf(institutionId),
        eq(sgkMissingDays.month, month),
        membershipId === undefined ? undefined : eq(sgkMissingDays.membershipId, membershipId),
      ),
    )
    .orderBy(sgkMissingDays.createdAt, sgkMissingDays.id)
  return rows.map(iso)
}

/** Ayın etkin giriş/çıkış satırları; `membershipId` verilirse yalnız onun. */
export async function loadSgkEmploymentDates(
  db: Database,
  institutionId: string,
  month: string,
  membershipId?: string,
): Promise<SgkEmploymentDatesEntry[]> {
  const rows = await db
    .select(DATES_COLUMNS)
    .from(sgkEmploymentDates)
    .where(
      and(
        datesOf(institutionId),
        eq(sgkEmploymentDates.month, month),
        membershipId === undefined ? undefined : eq(sgkEmploymentDates.membershipId, membershipId),
      ),
    )
  return rows.map(iso)
}

/**
 * Listenin personeli: ayda ana ücret tanımı (iptal edilmemiş) yürürlükte olan ya da ayın etkin elle
 * satırı bulunan personel üyelikleri (pasif dahil).
 */
export async function loadSgkMembers(
  db: Database,
  institutionId: string,
  range: { month: string; firstDay: string; lastDay: string },
): Promise<SgkMember[]> {
  const waged = await db
    .selectDistinct({ id: staffPayRates.membershipId })
    .from(staffPayRates)
    .where(
      and(
        eq(staffPayRates.institutionId, institutionId),
        isNull(staffPayRates.archivedAt),
        eq(staffPayRates.component, 'wage'),
        lte(staffPayRates.startDate, range.lastDay),
        or(isNull(staffPayRates.endDate), gte(staffPayRates.endDate, range.firstDay)),
      ),
    )
  const missing = await db
    .selectDistinct({ id: sgkMissingDays.membershipId })
    .from(sgkMissingDays)
    .where(and(missingOf(institutionId), eq(sgkMissingDays.month, range.firstDay)))
  const dated = await db
    .selectDistinct({ id: sgkEmploymentDates.membershipId })
    .from(sgkEmploymentDates)
    .where(and(datesOf(institutionId), eq(sgkEmploymentDates.month, range.firstDay)))
  const ids = [...new Set([...waged, ...missing, ...dated].map((row) => row.id))]
  if (ids.length === 0) return []
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
        inArray(memberships.id, ids),
        inArray(memberships.role, [...STAFF_ROLES]),
      ),
    )
  return rows.map(({ deactivatedAt, ...row }) => ({ ...row, active: deactivatedAt === null }))
}

/** Personelin ayda girilmiş eksik gün toplamı (kurum kilidi altında). */
export async function sumSgkMissingDays(
  tx: Database,
  institutionId: string,
  membershipId: string,
  month: string,
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${sgkMissingDays.days}), 0)::int` })
    .from(sgkMissingDays)
    .where(
      and(
        missingOf(institutionId),
        eq(sgkMissingDays.membershipId, membershipId),
        eq(sgkMissingDays.month, month),
      ),
    )
  return Number(row?.total ?? 0)
}

export async function insertSgkMissingDay(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    membershipId: string
    month: string
    days: number
    reasonCode: SgkReasonCode | null
    note: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(sgkMissingDays)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

export async function findSgkMissingDay(
  db: Database,
  institutionId: string,
  id: string,
): Promise<(SgkMissingDayEntry & { month: string }) | null> {
  const [row] = await db
    .select({ ...MISSING_COLUMNS, month: sgkMissingDays.month })
    .from(sgkMissingDays)
    .where(and(missingOf(institutionId), eq(sgkMissingDays.id, id)))
    .limit(1)
  return row === undefined ? null : iso(row)
}

/** Kaldırma (arşiv); sürüm tutmazsa `false` (409). */
export async function archiveSgkMissingDay(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(sgkMissingDays)
    .set({
      archivedAt: input.now,
      archivedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        missingOf(institutionId),
        eq(sgkMissingDays.id, input.id),
        eq(sgkMissingDays.version, input.expectedVersion),
      ),
    )
    .returning({ id: sgkMissingDays.id })
  return rows.length === 1
}

export async function insertSgkEmploymentDates(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    membershipId: string
    month: string
    entryDate: string | null
    exitDate: string | null
    note: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(sgkEmploymentDates)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

export async function findSgkEmploymentDates(
  db: Database,
  institutionId: string,
  id: string,
): Promise<(SgkEmploymentDatesEntry & { month: string }) | null> {
  const [row] = await db
    .select({ ...DATES_COLUMNS, month: sgkEmploymentDates.month })
    .from(sgkEmploymentDates)
    .where(and(datesOf(institutionId), eq(sgkEmploymentDates.id, id)))
    .limit(1)
  return row === undefined ? null : iso(row)
}

/** Kaldırma (arşiv); sürüm tutmazsa `false` (409). */
export async function archiveSgkEmploymentDates(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(sgkEmploymentDates)
    .set({
      archivedAt: input.now,
      archivedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        datesOf(institutionId),
        eq(sgkEmploymentDates.id, input.id),
        eq(sgkEmploymentDates.version, input.expectedVersion),
      ),
    )
    .returning({ id: sgkEmploymentDates.id })
  return rows.length === 1
}
