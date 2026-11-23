import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import type {
  PayrollAdjustmentItem,
  PayrollInputSummary,
  PayrollSummaryAdjustment,
  PayrollSummaryRate,
  StoredPayrollPeriodStatus,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffPayRates } from './schema/finance-pay-rates.ts'
import { payrollAdjustments, payrollPeriods } from './schema/finance-payroll-periods.ts'

/**
 * Bordro dönemi ve düzeltme kaydı deposu (DOM-FIN-108; ON-200). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-payroll-periods.ts`'tedir; depo yalnız okur ve yazar.
 * İptal edilmiş (arşivli) düzeltme okunmaz.
 */

export interface StoredPayrollPeriod extends PayrollInputSummary {
  id: string
  month: string
  status: StoredPayrollPeriodStatus
  approvedAt: string
  approvedByUserId: string
  approvalCount: number
  inputsHash: string
  reopenedAt: string | null
  reopenedByUserId: string | null
  reopenReason: string | null
  version: number
}

const PERIOD_COLUMNS = {
  id: payrollPeriods.id,
  month: payrollPeriods.month,
  status: payrollPeriods.status,
  approvedAt: payrollPeriods.approvedAt,
  approvedByUserId: payrollPeriods.approvedByUserId,
  approvalCount: payrollPeriods.approvalCount,
  staffCount: payrollPeriods.staffCount,
  rateCount: payrollPeriods.rateCount,
  monthlyGrossTotalCents: payrollPeriods.monthlyGrossTotalCents,
  adjustmentCount: payrollPeriods.adjustmentCount,
  adjustmentTotalCents: payrollPeriods.adjustmentTotalCents,
  parameterSetId: payrollPeriods.parameterSetId,
  parameterEffectiveFrom: payrollPeriods.parameterEffectiveFrom,
  inputsHash: payrollPeriods.inputsHash,
  reopenedAt: payrollPeriods.reopenedAt,
  reopenedByUserId: payrollPeriods.reopenedByUserId,
  reopenReason: payrollPeriods.reopenReason,
  version: payrollPeriods.version,
}
type PeriodRow = Omit<StoredPayrollPeriod, 'approvedAt' | 'reopenedAt'> & {
  approvedAt: Date
  reopenedAt: Date | null
}
const toPeriod = (row: PeriodRow): StoredPayrollPeriod => ({
  ...row,
  approvedAt: row.approvedAt.toISOString(),
  reopenedAt: row.reopenedAt?.toISOString() ?? null,
})

const periodsOf = (institutionId: string) =>
  and(eq(payrollPeriods.institutionId, institutionId), isNull(payrollPeriods.archivedAt))

/** Yılın dönem kayıtları (en çok 12). */
export async function listPayrollPeriods(
  db: Database,
  institutionId: string,
  year: number,
): Promise<StoredPayrollPeriod[]> {
  const rows = await db
    .select(PERIOD_COLUMNS)
    .from(payrollPeriods)
    .where(and(periodsOf(institutionId), sql`${payrollPeriods.month} like ${`${String(year)}-%`}`))
    .orderBy(asc(payrollPeriods.month))
  return rows.map(toPeriod)
}

export async function findPayrollPeriod(
  db: Database,
  institutionId: string,
  month: string,
): Promise<StoredPayrollPeriod | null> {
  const [row] = await db
    .select(PERIOD_COLUMNS)
    .from(payrollPeriods)
    .where(and(periodsOf(institutionId), eq(payrollPeriods.month, month)))
    .limit(1)
  return row === undefined ? null : toPeriod(row)
}

/**
 * Kurumun onaylı (kilitli) ayları, artan (K-357). Bordroya girdi yazan her servis bu listeyi kurum
 * kilidi altında okur ve core `assertPayrollDaysUnlocked` ile denetler.
 */
export async function lockedPayrollMonths(db: Database, institutionId: string): Promise<string[]> {
  const rows = await db
    .select({ month: payrollPeriods.month })
    .from(payrollPeriods)
    .where(and(periodsOf(institutionId), eq(payrollPeriods.status, 'approved')))
    .orderBy(asc(payrollPeriods.month))
  return rows.map((row) => row.month)
}

/** Kullanıcı adları (onaylayan, yeniden açan, düzeltmeyi yazan). */
export async function userNames(
  db: Database,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids))
  return new Map(rows.map((row) => [row.id, row.name]))
}

export interface PayrollApprovalWrite extends PayrollInputSummary {
  inputsHash: string
  userId: string
  now: Date
}

export async function insertPayrollPeriod(
  tx: Database,
  institutionId: string,
  input: PayrollApprovalWrite & { id: string; month: string },
): Promise<void> {
  const { now, userId, ...fields } = input
  await tx.insert(payrollPeriods).values({
    ...fields,
    institutionId,
    status: 'approved',
    approvedAt: now,
    approvedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Yeniden açılmış ayı yeniden onaylar; özet ve damga yenilenir. Sürüm tutmazsa `false`. */
export async function reapprovePayrollPeriod(
  tx: Database,
  institutionId: string,
  input: PayrollApprovalWrite & { id: string; expectedVersion: number },
): Promise<boolean> {
  const { now, userId, id, expectedVersion, ...fields } = input
  const rows = await tx
    .update(payrollPeriods)
    .set({
      ...fields,
      status: 'approved',
      approvedAt: now,
      approvedByUserId: userId,
      approvalCount: sql`${payrollPeriods.approvalCount} + 1`,
      updatedAt: now,
      version: sql`${payrollPeriods.version} + 1`,
    })
    .where(
      and(
        periodsOf(institutionId),
        eq(payrollPeriods.id, id),
        eq(payrollPeriods.version, expectedVersion),
        eq(payrollPeriods.status, 'reopened'),
      ),
    )
    .returning({ id: payrollPeriods.id })
  return rows.length === 1
}

export async function reopenPayrollPeriod(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: string; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(payrollPeriods)
    .set({
      status: 'reopened',
      reopenedAt: input.now,
      reopenedByUserId: input.userId,
      reopenReason: input.reason,
      updatedAt: input.now,
      version: sql`${payrollPeriods.version} + 1`,
    })
    .where(
      and(
        periodsOf(institutionId),
        eq(payrollPeriods.id, input.id),
        eq(payrollPeriods.version, input.expectedVersion),
        eq(payrollPeriods.status, 'approved'),
      ),
    )
    .returning({ id: payrollPeriods.id })
  return rows.length === 1
}

// --- Özet girdileri -------------------------------------------------------------------------------

/** Gün aralığıyla kesişen, iptal edilmemiş ücret tanımları (özet için). */
export async function loadRatesBetween(
  db: Database,
  institutionId: string,
  from: string,
  to: string,
): Promise<PayrollSummaryRate[]> {
  return db
    .select({
      id: staffPayRates.id,
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
        lte(staffPayRates.startDate, to),
        or(isNull(staffPayRates.endDate), gte(staffPayRates.endDate, from)),
      ),
    )
}

const adjustmentsOf = (institutionId: string) =>
  and(eq(payrollAdjustments.institutionId, institutionId), isNull(payrollAdjustments.archivedAt))

/** Hedef ayı aralıkta olan, iptal edilmemiş düzeltmeler (dönem özeti ve bordro aktarımı). */
export async function loadAdjustmentsTargeting(
  db: Database,
  institutionId: string,
  fromMonth: string,
  toMonth: string,
): Promise<
  (PayrollSummaryAdjustment & {
    item: PayrollAdjustmentItem
    sourceMonth: string
    targetMonth: string
  })[]
> {
  return db
    .select({
      id: payrollAdjustments.id,
      membershipId: payrollAdjustments.membershipId,
      item: payrollAdjustments.item,
      amountCents: payrollAdjustments.amountCents,
      sourceMonth: payrollAdjustments.sourceMonth,
      targetMonth: payrollAdjustments.targetMonth,
    })
    .from(payrollAdjustments)
    .where(
      and(
        adjustmentsOf(institutionId),
        gte(payrollAdjustments.targetMonth, fromMonth),
        lte(payrollAdjustments.targetMonth, toMonth),
      ),
    )
}

/** Kaynak aya göre iptal edilmemiş düzeltme sayısı (yılın ayları). */
export async function countAdjustmentsBySource(
  db: Database,
  institutionId: string,
  year: number,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ month: payrollAdjustments.sourceMonth, total: count() })
    .from(payrollAdjustments)
    .where(
      and(
        adjustmentsOf(institutionId),
        sql`${payrollAdjustments.sourceMonth} like ${`${String(year)}-%`}`,
      ),
    )
    .groupBy(payrollAdjustments.sourceMonth)
  return new Map(rows.map((row) => [row.month, row.total]))
}

export async function countPeriodAdjustments(
  db: Database,
  institutionId: string,
  periodId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(payrollAdjustments)
    .where(and(adjustmentsOf(institutionId), eq(payrollAdjustments.periodId, periodId)))
  return row?.total ?? 0
}

// --- Düzeltme kaydı -------------------------------------------------------------------------------

export interface StoredPayrollAdjustment {
  id: string
  sourceMonth: string
  targetMonth: string
  membershipId: string
  staffName: string
  item: PayrollAdjustmentItem
  amountCents: number
  currency: string
  reason: string
  createdByUserId: string
  createdAt: string
  version: number
}

const ADJUSTMENT_COLUMNS = {
  id: payrollAdjustments.id,
  sourceMonth: payrollAdjustments.sourceMonth,
  targetMonth: payrollAdjustments.targetMonth,
  membershipId: payrollAdjustments.membershipId,
  staffName: users.name,
  item: payrollAdjustments.item,
  amountCents: payrollAdjustments.amountCents,
  currency: payrollAdjustments.currency,
  reason: payrollAdjustments.reason,
  createdByUserId: payrollAdjustments.createdByUserId,
  createdAt: payrollAdjustments.createdAt,
  version: payrollAdjustments.version,
}

function adjustmentQuery(db: Database) {
  return db
    .select(ADJUSTMENT_COLUMNS)
    .from(payrollAdjustments)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, payrollAdjustments.institutionId),
        eq(memberships.id, payrollAdjustments.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
}

const toAdjustment = (
  row: Omit<StoredPayrollAdjustment, 'createdAt'> & { createdAt: Date },
): StoredPayrollAdjustment => ({ ...row, createdAt: row.createdAt.toISOString() })

/** Ayın (kaynak) iptal edilmemiş düzeltmeleri, yeniden eskiye; sayfalı. */
export async function listPeriodAdjustments(
  db: Database,
  institutionId: string,
  periodId: string,
  page: { page: number; pageSize: number },
): Promise<{ items: StoredPayrollAdjustment[]; total: number }> {
  const where = and(adjustmentsOf(institutionId), eq(payrollAdjustments.periodId, periodId))
  const [totalRow] = await db.select({ total: count() }).from(payrollAdjustments).where(where)
  const rows = await adjustmentQuery(db)
    .where(where)
    .orderBy(desc(payrollAdjustments.createdAt), asc(payrollAdjustments.id))
    .limit(page.pageSize)
    .offset((page.page - 1) * page.pageSize)
  return { items: rows.map(toAdjustment), total: totalRow?.total ?? 0 }
}

export async function findPayrollAdjustment(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPayrollAdjustment | null> {
  const [row] = await adjustmentQuery(db)
    .where(and(adjustmentsOf(institutionId), eq(payrollAdjustments.id, id)))
    .limit(1)
  return row === undefined ? null : toAdjustment(row)
}

export async function insertPayrollAdjustment(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    periodId: string
    sourceMonth: string
    targetMonth: string
    membershipId: string
    item: PayrollAdjustmentItem
    amountCents: number
    reason: string
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(payrollAdjustments)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Gerekçeyle iptal (arşiv). Sürüm tutmazsa ya da iptal edilmişse `false`. */
export async function cancelPayrollAdjustment(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: string; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(payrollAdjustments)
    .set({
      archivedAt: input.now,
      cancelReason: input.reason,
      cancelledByUserId: input.userId,
      updatedAt: input.now,
      version: sql`${payrollAdjustments.version} + 1`,
    })
    .where(
      and(
        adjustmentsOf(institutionId),
        eq(payrollAdjustments.id, input.id),
        eq(payrollAdjustments.version, input.expectedVersion),
      ),
    )
    .returning({ id: payrollAdjustments.id })
  return rows.length === 1
}
