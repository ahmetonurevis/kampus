import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import type {
  PayrollExportFormat,
  PayrollExportProfile,
  PayrollLessonHours,
  PayrollRate,
  PayrollStaff,
} from '@kampus/school-core/lib/finance-payroll-exports.ts'
import type { LessonPayType } from '@kampus/school-core/lib/finance-pay-rates.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffPayRates } from './schema/finance-pay-rates.ts'
import {
  payrollExportProfiles,
  payrollExports,
  payrollLessonHours,
} from './schema/finance-payroll-exports.ts'

/**
 * Bordro programına aktarım deposu (DOM-FIN-105; ON-202). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-payroll-exports.ts`'tedir; depo yalnız okur ve yazar.
 * Arşivli ek ders saati ve iptal edilmiş ücret tanımı okunmaz.
 */

/** Ayla kesişen, iptal edilmemiş ücret tanımları. */
export async function loadMonthPayRates(
  db: Database,
  institutionId: string,
  range: { from: string; to: string },
): Promise<PayrollRate[]> {
  const rows = await db
    .select({
      id: staffPayRates.id,
      membershipId: staffPayRates.membershipId,
      component: staffPayRates.component,
      rateType: staffPayRates.rateType,
      amountCents: staffPayRates.amountCents,
      benefitForm: staffPayRates.benefitForm,
      taxable: staffPayRates.taxable,
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
  return rows
}

export interface StoredLessonHours extends PayrollLessonHours {
  monthStart: string
}

const HOURS_COLUMNS = {
  id: payrollLessonHours.id,
  membershipId: payrollLessonHours.membershipId,
  monthStart: payrollLessonHours.monthStart,
  lessonType: payrollLessonHours.lessonType,
  hours: payrollLessonHours.hours,
  note: payrollLessonHours.note,
  version: payrollLessonHours.version,
}

const activeHours = (institutionId: string) =>
  and(eq(payrollLessonHours.institutionId, institutionId), isNull(payrollLessonHours.archivedAt))

/** Ayın etkin ek ders saati kayıtları. */
export async function loadMonthLessonHours(
  db: Database,
  institutionId: string,
  monthStart: string,
): Promise<StoredLessonHours[]> {
  return db
    .select(HOURS_COLUMNS)
    .from(payrollLessonHours)
    .where(and(activeHours(institutionId), eq(payrollLessonHours.monthStart, monthStart)))
    .orderBy(asc(payrollLessonHours.membershipId), asc(payrollLessonHours.lessonType))
}

export async function findLessonHours(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredLessonHours | null> {
  const [row] = await db
    .select(HOURS_COLUMNS)
    .from(payrollLessonHours)
    .where(and(activeHours(institutionId), eq(payrollLessonHours.id, id)))
    .limit(1)
  return row ?? null
}

/** Aynı personel, ay ve türde etkin kayıt var mı (kurum kilidi altında). */
export async function lessonHoursExist(
  tx: Database,
  institutionId: string,
  key: { membershipId: string; monthStart: string; lessonType: LessonPayType },
): Promise<boolean> {
  const [row] = await tx
    .select({ id: payrollLessonHours.id })
    .from(payrollLessonHours)
    .where(
      and(
        activeHours(institutionId),
        eq(payrollLessonHours.membershipId, key.membershipId),
        eq(payrollLessonHours.monthStart, key.monthStart),
        eq(payrollLessonHours.lessonType, key.lessonType),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function insertLessonHours(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    membershipId: string
    monthStart: string
    lessonType: LessonPayType
    hours: number
    note: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(payrollLessonHours)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Saat ve not; sürüm tutmazsa `false` (409). */
export async function updateLessonHours(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; hours: number; note: string | null; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(payrollLessonHours)
    .set({
      hours: input.hours,
      note: input.note,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        activeHours(institutionId),
        eq(payrollLessonHours.id, input.id),
        eq(payrollLessonHours.version, input.expectedVersion),
      ),
    )
    .returning({ id: payrollLessonHours.id })
  return rows.length === 1
}

/** Arşiv (silme); sürüm tutmazsa `false` (409). */
export async function archiveLessonHours(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(payrollLessonHours)
    .set({ archivedAt: input.now, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        activeHours(institutionId),
        eq(payrollLessonHours.id, input.id),
        eq(payrollLessonHours.version, input.expectedVersion),
      ),
    )
    .returning({ id: payrollLessonHours.id })
  return rows.length === 1
}

/** Kurumdaki üyelikler (ad, rol, etkin mi); kurumda olmayan kimlik dönmez. */
export async function loadPayrollStaff(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<PayrollStaff[]> {
  if (membershipIds.length === 0) return []
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
        inArray(memberships.id, [...new Set(membershipIds)]),
      ),
    )
  return rows.map(({ deactivatedAt, ...row }) => ({ ...row, active: deactivatedAt === null }))
}

// --- Şablon --------------------------------------------------------------------------------------

export type StoredPayrollExportProfile = { profile: PayrollExportProfile | null; version: number }

/** Kurumun şablonu; satır yoksa genel dosya ve sürüm 1. */
export async function loadPayrollExportProfile(
  db: Database,
  institutionId: string,
): Promise<StoredPayrollExportProfile> {
  const [row] = await db
    .select({ profile: payrollExportProfiles.profile, version: payrollExportProfiles.version })
    .from(payrollExportProfiles)
    .where(eq(payrollExportProfiles.institutionId, institutionId))
    .limit(1)
  return row ?? { profile: null, version: 1 }
}

/** Sürüm koşuluyla yazar; ilk yazımda satır açılır. Sürüm tutmazsa `null` (409). */
export async function savePayrollExportProfile(
  tx: Database,
  institutionId: string,
  input: { profile: PayrollExportProfile | null; expectedVersion: number; now: Date },
): Promise<StoredPayrollExportProfile | null> {
  const columns = { profile: payrollExportProfiles.profile, version: payrollExportProfiles.version }
  const [updated] = await tx
    .update(payrollExportProfiles)
    .set({
      profile: input.profile,
      version: sql`${payrollExportProfiles.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(payrollExportProfiles.institutionId, institutionId),
        eq(payrollExportProfiles.version, input.expectedVersion),
      ),
    )
    .returning(columns)
  if (updated) return updated
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(payrollExportProfiles)
    .values({
      institutionId,
      profile: input.profile,
      version: 2,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning(columns)
  return created ?? null
}

// --- Üretim özeti --------------------------------------------------------------------------------

export interface PayrollExportSummary {
  id: string
  monthStart: string
  format: PayrollExportFormat
  lineCount: number
  staffCount: number
  earningCents: number
  deductionCents: number
  missingTotalCount: number
  contentSha256: string
  createdByUserId: string
  createdAt: Date
}

export async function insertPayrollExport(
  tx: Database,
  institutionId: string,
  input: PayrollExportSummary,
): Promise<void> {
  await tx.insert(payrollExports).values({ ...input, institutionId, updatedAt: input.createdAt })
}

/** Üretim geçmişi, yeni önce; isteğe bağlı ay süzgeci. Üreten adı kurumdaki kullanıcıdan. */
export async function listPayrollExports(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; monthStart?: string | undefined },
): Promise<{ items: (PayrollExportSummary & { createdByName: string | null })[]; total: number }> {
  const where = and(
    eq(payrollExports.institutionId, institutionId),
    query.monthStart === undefined ? undefined : eq(payrollExports.monthStart, query.monthStart),
  )
  const [totalRow] = await db.select({ total: count() }).from(payrollExports).where(where)
  const rows = await db
    .select({
      id: payrollExports.id,
      monthStart: payrollExports.monthStart,
      format: payrollExports.format,
      lineCount: payrollExports.lineCount,
      staffCount: payrollExports.staffCount,
      earningCents: payrollExports.earningCents,
      deductionCents: payrollExports.deductionCents,
      missingTotalCount: payrollExports.missingTotalCount,
      contentSha256: payrollExports.contentSha256,
      createdByUserId: payrollExports.createdByUserId,
      createdAt: payrollExports.createdAt,
      createdByName: users.name,
    })
    .from(payrollExports)
    .leftJoin(users, eq(users.id, payrollExports.createdByUserId))
    .where(where)
    .orderBy(desc(payrollExports.createdAt), desc(payrollExports.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows, total: totalRow?.total ?? 0 }
}
