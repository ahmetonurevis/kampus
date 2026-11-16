import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import type {
  PayrollInstitutionSet,
  PayrollParameterValues,
} from '@kampus/school-core/lib/finance-payroll-parameters.ts'

import type { Database } from './client.ts'
import { payrollParameterSets } from './schema/finance-payroll-parameters.ts'

/**
 * Bordro parametrelerinin kurum kopyası deposu (DOM-FIN-100; ON-197). Kurum kapsamlıdır: ilk
 * parametre `institutionId`; arşivli set okunmaz. Kural ve platform varsayılanı core
 * `lib/finance-payroll-parameters.ts`'tedir; depo yalnız okur ve yazar.
 */

const COLUMNS = {
  id: payrollParameterSets.id,
  version: payrollParameterSets.version,
  effectiveFrom: payrollParameterSets.effectiveFrom,
  minimumWageGrossCents: payrollParameterSets.minimumWageGrossCents,
  incomeTaxBrackets: payrollParameterSets.incomeTaxBrackets,
  sgkEmployeeRateBasisPoints: payrollParameterSets.sgkEmployeeRateBasisPoints,
  sgkEmployerRateBasisPoints: payrollParameterSets.sgkEmployerRateBasisPoints,
  sgkEmployerIncentiveBasisPoints: payrollParameterSets.sgkEmployerIncentiveBasisPoints,
  unemploymentEmployeeRateBasisPoints: payrollParameterSets.unemploymentEmployeeRateBasisPoints,
  unemploymentEmployerRateBasisPoints: payrollParameterSets.unemploymentEmployerRateBasisPoints,
  sgkFloorMultiplierBasisPoints: payrollParameterSets.sgkFloorMultiplierBasisPoints,
  sgkCeilingMultiplierBasisPoints: payrollParameterSets.sgkCeilingMultiplierBasisPoints,
  stampTaxRatePer100k: payrollParameterSets.stampTaxRatePer100k,
  minimumWageIncomeTaxExempt: payrollParameterSets.minimumWageIncomeTaxExempt,
  minimumWageStampTaxExempt: payrollParameterSets.minimumWageStampTaxExempt,
  severanceCeilingCents: payrollParameterSets.severanceCeilingCents,
  source: payrollParameterSets.source,
}

const ofInstitution = (institutionId: string) =>
  and(
    eq(payrollParameterSets.institutionId, institutionId),
    isNull(payrollParameterSets.archivedAt),
  )

/** Kurumun bütün etkin setleri, yürürlük başlangıcına göre (kurum başına birkaç satır). */
export async function listPayrollParameterSets(
  db: Database,
  institutionId: string,
): Promise<PayrollInstitutionSet[]> {
  return db
    .select(COLUMNS)
    .from(payrollParameterSets)
    .where(ofInstitution(institutionId))
    .orderBy(asc(payrollParameterSets.effectiveFrom))
}

export async function findPayrollParameterSet(
  db: Database,
  institutionId: string,
  id: string,
): Promise<PayrollInstitutionSet | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(payrollParameterSets)
    .where(and(ofInstitution(institutionId), eq(payrollParameterSets.id, id)))
    .limit(1)
  return row ?? null
}

/** Aynı yürürlük başlangıcında etkin set var mı; düzeltmede set kendisi dışlanır. */
export async function isPayrollEffectiveFromTaken(
  db: Database,
  institutionId: string,
  effectiveFrom: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: payrollParameterSets.id })
    .from(payrollParameterSets)
    .where(
      and(
        ofInstitution(institutionId),
        eq(payrollParameterSets.effectiveFrom, effectiveFrom),
        exceptId === undefined ? undefined : sql`${payrollParameterSets.id} <> ${exceptId}`,
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function insertPayrollParameterSet(
  tx: Database,
  institutionId: string,
  input: PayrollParameterValues & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, ...values } = input
  await tx
    .insert(payrollParameterSets)
    .values({ ...values, institutionId, createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). `archivedAt` verilirse set arşivlenir. */
export async function updatePayrollParameterSet(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<PayrollParameterValues> & { archivedAt?: Date }
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(payrollParameterSets)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(payrollParameterSets.id, input.id),
        eq(payrollParameterSets.version, input.expectedVersion),
      ),
    )
    .returning({ id: payrollParameterSets.id })
  return rows.length === 1
}
