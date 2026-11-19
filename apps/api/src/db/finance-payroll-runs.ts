import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'

import type {
  PayrollCalcAdjustment,
  PayrollCalcMember,
  PayrollCalcRow,
  PayrollSavedBase,
} from '@kampus/school-core/lib/finance-payroll-calc.ts'
import type { PayrollAdjustmentItem } from '@kampus/school-core/lib/finance-payroll-periods.ts'
import type { SgkReasonCode } from '@kampus/school-core/lib/finance-sgk-preparation.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffPayRates } from './schema/finance-pay-rates.ts'
import { payrollLessonHours } from './schema/finance-payroll-exports.ts'
import { payrollAdjustments } from './schema/finance-payroll-periods.ts'
import {
  payrollRunLines,
  payrollRuns,
  payrollTaxCarryovers,
} from './schema/finance-payroll-runs.ts'
import { sgkEmploymentDates, sgkMissingDays } from './schema/finance-sgk-preparation.ts'

/**
 * Bordro hesabı deposu (DOM-FIN-115; ON-198). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-payroll-calc.ts`'tedir; depo yalnız okur ve yazar. Arşivli hesap, devir,
 * ek ders saati, düzeltme ve elle SGK satırı okunmaz; iptal edilmiş ücret tanımı okunmaz. Ek ders
 * saatleri onay durumuyla `finance-lesson-hour-approvals.ts` (`approvedLessonHoursFor`) okur.
 */

// --- Hesap girdileri ------------------------------------------------------------------------------

export interface PayrollMonthRange {
  month: string
  firstDay: string
  lastDay: string
}

/**
 * Ayın personeli: ayda ana ücret tanımı yürürlükte olan, o ay ek ders saati, aya aktarılan
 * düzeltme ya da elle SGK satırı bulunan personel üyelikleri (pasif dahil).
 */
export async function loadPayrollCalcMembers(
  db: Database,
  institutionId: string,
  range: PayrollMonthRange,
): Promise<PayrollCalcMember[]> {
  const [waged, lessons, adjusted, missing, dated] = await Promise.all([
    db
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
      ),
    db
      .selectDistinct({ id: payrollLessonHours.membershipId })
      .from(payrollLessonHours)
      .where(
        and(
          eq(payrollLessonHours.institutionId, institutionId),
          isNull(payrollLessonHours.archivedAt),
          eq(payrollLessonHours.monthStart, range.firstDay),
        ),
      ),
    db
      .selectDistinct({ id: payrollAdjustments.membershipId })
      .from(payrollAdjustments)
      .where(
        and(
          eq(payrollAdjustments.institutionId, institutionId),
          isNull(payrollAdjustments.archivedAt),
          eq(payrollAdjustments.targetMonth, range.month),
        ),
      ),
    db
      .selectDistinct({ id: sgkMissingDays.membershipId })
      .from(sgkMissingDays)
      .where(
        and(
          eq(sgkMissingDays.institutionId, institutionId),
          isNull(sgkMissingDays.archivedAt),
          eq(sgkMissingDays.month, range.firstDay),
        ),
      ),
    db
      .selectDistinct({ id: sgkEmploymentDates.membershipId })
      .from(sgkEmploymentDates)
      .where(
        and(
          eq(sgkEmploymentDates.institutionId, institutionId),
          isNull(sgkEmploymentDates.archivedAt),
          eq(sgkEmploymentDates.month, range.firstDay),
        ),
      ),
  ])
  const ids = [
    ...new Set([...waged, ...lessons, ...adjusted, ...missing, ...dated].map((row) => row.id)),
  ]
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

/** Ayın etkin eksik gün satırları (gün ve neden). */
export function loadPayrollMissingDays(
  db: Database,
  institutionId: string,
  firstDay: string,
): Promise<{ membershipId: string; days: number; reasonCode: SgkReasonCode | null }[]> {
  return db
    .select({
      membershipId: sgkMissingDays.membershipId,
      days: sgkMissingDays.days,
      reasonCode: sgkMissingDays.reasonCode,
    })
    .from(sgkMissingDays)
    .where(
      and(
        eq(sgkMissingDays.institutionId, institutionId),
        isNull(sgkMissingDays.archivedAt),
        eq(sgkMissingDays.month, firstDay),
      ),
    )
}

/** Ayın etkin elle giriş/çıkış günleri. */
export function loadPayrollEmploymentDates(
  db: Database,
  institutionId: string,
  firstDay: string,
): Promise<{ membershipId: string; entryDate: string | null; exitDate: string | null }[]> {
  return db
    .select({
      membershipId: sgkEmploymentDates.membershipId,
      entryDate: sgkEmploymentDates.entryDate,
      exitDate: sgkEmploymentDates.exitDate,
    })
    .from(sgkEmploymentDates)
    .where(
      and(
        eq(sgkEmploymentDates.institutionId, institutionId),
        isNull(sgkEmploymentDates.archivedAt),
        eq(sgkEmploymentDates.month, firstDay),
      ),
    )
}

/** Bu aya aktarılan, iptal edilmemiş düzeltmeler (DOM-FIN-108). */
export async function loadPayrollAdjustmentsInto(
  db: Database,
  institutionId: string,
  month: string,
): Promise<PayrollCalcAdjustment[]> {
  const rows = await db
    .select({
      membershipId: payrollAdjustments.membershipId,
      item: payrollAdjustments.item,
      amountCents: payrollAdjustments.amountCents,
    })
    .from(payrollAdjustments)
    .where(
      and(
        eq(payrollAdjustments.institutionId, institutionId),
        isNull(payrollAdjustments.archivedAt),
        eq(payrollAdjustments.targetMonth, month),
      ),
    )
  return rows.map((row) => ({ ...row, item: row.item as PayrollAdjustmentItem }))
}

/** Yılın bu aydan önceki etkin hesaplarının satır matrahları (kümülatif için). */
export function loadSavedIncomeTaxBases(
  db: Database,
  institutionId: string,
  month: string,
): Promise<PayrollSavedBase[]> {
  return db
    .select({
      membershipId: payrollRunLines.membershipId,
      month: payrollRunLines.month,
      incomeTaxBaseCents: payrollRunLines.incomeTaxBaseCents,
    })
    .from(payrollRunLines)
    .innerJoin(
      payrollRuns,
      and(
        eq(payrollRuns.institutionId, payrollRunLines.institutionId),
        eq(payrollRuns.id, payrollRunLines.runId),
      ),
    )
    .where(
      and(
        eq(payrollRunLines.institutionId, institutionId),
        isNull(payrollRuns.archivedAt),
        gte(payrollRunLines.month, `${month.slice(0, 4)}-01`),
        lt(payrollRunLines.month, month),
      ),
    )
}

// --- Kayıtlı hesap --------------------------------------------------------------------------------

export interface StoredPayrollRun {
  id: string
  month: string
  revision: number
  parameterSetId: string
  parameterEffectiveFrom: string
  staffCount: number
  skippedCount: number
  grossTotalCents: number
  netTotalCents: number
  payableTotalCents: number
  employerCostTotalCents: number
  calculatedByUserId: string
  calculatedByName: string | null
  calculatedAt: string
  version: number
}

const RUN_COLUMNS = {
  id: payrollRuns.id,
  month: payrollRuns.month,
  revision: payrollRuns.revision,
  parameterSetId: payrollRuns.parameterSetId,
  parameterEffectiveFrom: payrollRuns.parameterEffectiveFrom,
  staffCount: payrollRuns.staffCount,
  skippedCount: payrollRuns.skippedCount,
  grossTotalCents: payrollRuns.grossTotalCents,
  netTotalCents: payrollRuns.netTotalCents,
  payableTotalCents: payrollRuns.payableTotalCents,
  employerCostTotalCents: payrollRuns.employerCostTotalCents,
  calculatedByUserId: payrollRuns.calculatedByUserId,
  calculatedByName: users.name,
  createdAt: payrollRuns.createdAt,
  version: payrollRuns.version,
}

/** Ayın etkin hesabı; yoksa `null`. */
export async function findActivePayrollRun(
  db: Database,
  institutionId: string,
  month: string,
): Promise<StoredPayrollRun | null> {
  const [row] = await db
    .select(RUN_COLUMNS)
    .from(payrollRuns)
    .leftJoin(users, eq(users.id, payrollRuns.calculatedByUserId))
    .where(
      and(
        eq(payrollRuns.institutionId, institutionId),
        isNull(payrollRuns.archivedAt),
        eq(payrollRuns.month, month),
      ),
    )
    .limit(1)
  if (row === undefined) return null
  const { createdAt, ...rest } = row
  return { ...rest, calculatedAt: createdAt.toISOString() }
}

/** Ayın en büyük revizyonu (arşivliler dahil); hesap yoksa 0. */
export async function lastPayrollRevision(
  db: Database,
  institutionId: string,
  month: string,
): Promise<number> {
  const [row] = await db
    .select({ revision: payrollRuns.revision })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.institutionId, institutionId), eq(payrollRuns.month, month)))
    .orderBy(desc(payrollRuns.revision))
    .limit(1)
  return row?.revision ?? 0
}

/** Hesabın satırları (ada göre). */
export async function loadPayrollRunLines(
  db: Database,
  institutionId: string,
  runId: string,
): Promise<PayrollCalcRow[]> {
  const rows = await db
    .select({ line: payrollRunLines.line })
    .from(payrollRunLines)
    .where(and(eq(payrollRunLines.institutionId, institutionId), eq(payrollRunLines.runId, runId)))
    .orderBy(asc(payrollRunLines.id))
  return rows
    .map((row) => row.line)
    .sort(
      (a, b) => a.name.localeCompare(b.name, 'tr') || a.membershipId.localeCompare(b.membershipId),
    )
}

/** Eski hesabı arşivler (yeniden hesaplama); sürüm tutmazsa `false`. */
export async function archivePayrollRun(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(payrollRuns)
    .set({
      archivedAt: input.now,
      archivedByUserId: input.userId,
      updatedAt: input.now,
      version: sql`${payrollRuns.version} + 1`,
    })
    .where(
      and(
        eq(payrollRuns.institutionId, institutionId),
        eq(payrollRuns.id, input.id),
        isNull(payrollRuns.archivedAt),
        eq(payrollRuns.version, input.expectedVersion),
      ),
    )
    .returning({ id: payrollRuns.id })
  return rows.length === 1
}

export interface PayrollRunInsert {
  id: string
  month: string
  revision: number
  parameterSetId: string
  parameterEffectiveFrom: string
  skippedCount: number
  lines: { id: string; line: PayrollCalcRow }[]
  userId: string
  now: Date
}

/** Yeni hesap ve satırları. */
export async function insertPayrollRun(
  tx: Database,
  institutionId: string,
  input: PayrollRunInsert,
): Promise<void> {
  const total = (pick: (line: PayrollCalcRow) => number) =>
    input.lines.reduce((sum, item) => sum + pick(item.line), 0)
  await tx.insert(payrollRuns).values({
    institutionId,
    id: input.id,
    month: input.month,
    revision: input.revision,
    parameterSetId: input.parameterSetId,
    parameterEffectiveFrom: input.parameterEffectiveFrom,
    staffCount: input.lines.length,
    skippedCount: input.skippedCount,
    grossTotalCents: total((line) => line.grossCents),
    netTotalCents: total((line) => line.netCents),
    payableTotalCents: total((line) => line.payableCents),
    employerCostTotalCents: total((line) => line.employerCostCents),
    calculatedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
  await tx.insert(payrollRunLines).values(
    input.lines.map(({ id, line }) => ({
      institutionId,
      id,
      runId: input.id,
      membershipId: line.membershipId,
      month: input.month,
      grossCents: line.grossCents,
      incomeTaxBaseCents: line.incomeTaxBaseCents,
      netCents: line.netCents,
      payableCents: line.payableCents,
      employerCostCents: line.employerCostCents,
      line,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

// --- Matrah devri ---------------------------------------------------------------------------------

export interface StoredTaxCarryover {
  id: string
  membershipId: string
  staffName: string
  year: number
  incomeTaxBaseCents: number
  note: string | null
  createdAt: string
  version: number
}

const CARRYOVER_COLUMNS = {
  id: payrollTaxCarryovers.id,
  membershipId: payrollTaxCarryovers.membershipId,
  staffName: users.name,
  year: payrollTaxCarryovers.year,
  incomeTaxBaseCents: payrollTaxCarryovers.incomeTaxBaseCents,
  note: payrollTaxCarryovers.note,
  createdAt: payrollTaxCarryovers.createdAt,
  version: payrollTaxCarryovers.version,
}
const carryoversOf = (institutionId: string) =>
  and(
    eq(payrollTaxCarryovers.institutionId, institutionId),
    isNull(payrollTaxCarryovers.archivedAt),
  )

function carryoverQuery(db: Database) {
  return db
    .select(CARRYOVER_COLUMNS)
    .from(payrollTaxCarryovers)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, payrollTaxCarryovers.institutionId),
        eq(memberships.id, payrollTaxCarryovers.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
}
const toCarryover = (row: Omit<StoredTaxCarryover, 'createdAt'> & { createdAt: Date }) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})

/** Yılın etkin devirleri (ada göre). */
export async function listTaxCarryovers(
  db: Database,
  institutionId: string,
  year: number,
): Promise<StoredTaxCarryover[]> {
  const rows = await carryoverQuery(db)
    .where(and(carryoversOf(institutionId), eq(payrollTaxCarryovers.year, year)))
    .orderBy(asc(users.name), asc(payrollTaxCarryovers.id))
  return rows.map(toCarryover)
}

export async function findTaxCarryover(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredTaxCarryover | null> {
  const [row] = await carryoverQuery(db)
    .where(and(carryoversOf(institutionId), eq(payrollTaxCarryovers.id, id)))
    .limit(1)
  return row === undefined ? null : toCarryover(row)
}

/** Personelin yıldaki etkin devri var mı (kurum kilidi altında). */
export async function taxCarryoverExists(
  db: Database,
  institutionId: string,
  membershipId: string,
  year: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: payrollTaxCarryovers.id })
    .from(payrollTaxCarryovers)
    .where(
      and(
        carryoversOf(institutionId),
        eq(payrollTaxCarryovers.membershipId, membershipId),
        eq(payrollTaxCarryovers.year, year),
      ),
    )
    .limit(1)
  return rows.length === 1
}

export async function insertTaxCarryover(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    membershipId: string
    year: number
    incomeTaxBaseCents: number
    note: string | null
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(payrollTaxCarryovers).values({
    institutionId,
    id: input.id,
    membershipId: input.membershipId,
    year: input.year,
    incomeTaxBaseCents: input.incomeTaxBaseCents,
    note: input.note,
    createdByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Devri kaldırır (arşiv); sürüm tutmazsa ya da kaldırılmışsa `false`. */
export async function archiveTaxCarryover(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(payrollTaxCarryovers)
    .set({
      archivedAt: input.now,
      archivedByUserId: input.userId,
      updatedAt: input.now,
      version: sql`${payrollTaxCarryovers.version} + 1`,
    })
    .where(
      and(
        carryoversOf(institutionId),
        eq(payrollTaxCarryovers.id, input.id),
        eq(payrollTaxCarryovers.version, input.expectedVersion),
      ),
    )
    .returning({ id: payrollTaxCarryovers.id })
  return rows.length === 1
}

/** Yılın devirleri (hesap için; ad gerekmez). */
export function loadYearCarryovers(
  db: Database,
  institutionId: string,
  year: number,
): Promise<{ membershipId: string; incomeTaxBaseCents: number }[]> {
  return db
    .select({
      membershipId: payrollTaxCarryovers.membershipId,
      incomeTaxBaseCents: payrollTaxCarryovers.incomeTaxBaseCents,
    })
    .from(payrollTaxCarryovers)
    .where(and(carryoversOf(institutionId), eq(payrollTaxCarryovers.year, year)))
}
