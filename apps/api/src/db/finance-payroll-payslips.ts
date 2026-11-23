import { and, asc, desc, eq, isNull } from 'drizzle-orm'

import type { PayrollCalcRow } from '@kampus/school-core/lib/finance-payroll-calc.ts'

import type { Database } from './client.ts'
import { institutions } from './schema/auth.ts'
import { payrollRunLines, payrollRuns } from './schema/finance-payroll-runs.ts'

/**
 * Ücret hesap pusulası deposu (DOM-FIN-119; ON-201). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Pusula kayıtlı hesabın satırından üretilir (K-406); depo satırı kimliğiyle okur
 * (her pusula satır kimliğiyle denetime yazılır, K-408).
 */

export interface StoredPayslipLine {
  id: string
  line: PayrollCalcRow
}

/** Kayıtlı hesabın satırları, ada göre; `membershipId` verilirse yalnız o personelin satırı. */
export async function loadPayslipLines(
  db: Database,
  institutionId: string,
  runId: string,
  membershipId?: string,
): Promise<StoredPayslipLine[]> {
  const rows = await db
    .select({ id: payrollRunLines.id, line: payrollRunLines.line })
    .from(payrollRunLines)
    .where(
      and(
        eq(payrollRunLines.institutionId, institutionId),
        eq(payrollRunLines.runId, runId),
        ...(membershipId === undefined ? [] : [eq(payrollRunLines.membershipId, membershipId)]),
      ),
    )
    .orderBy(asc(payrollRunLines.id))
  return rows.sort(
    (a, b) =>
      a.line.name.localeCompare(b.line.name, 'tr') ||
      a.line.membershipId.localeCompare(b.line.membershipId),
  )
}

/** Etkin kurumun adı (pusulanın başlığı). */
export async function findInstitutionName(db: Database, institutionId: string): Promise<string> {
  const [row] = await db
    .select({ name: institutions.name })
    .from(institutions)
    .where(eq(institutions.id, institutionId))
    .limit(1)
  return row?.name ?? ''
}

/**
 * Personelin satırı bulunan etkin kayıtlı hesapların ayları (self-servis, DOM-FIN-166), yeniden
 * eskiye. Dönem onayı süzgeci serviste.
 */
export async function listPayslipMonthsOf(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<{ month: string; runId: string; revision: number; calculatedAt: string }[]> {
  const rows = await db
    .select({
      month: payrollRuns.month,
      runId: payrollRuns.id,
      revision: payrollRuns.revision,
      createdAt: payrollRuns.createdAt,
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
        eq(payrollRunLines.membershipId, membershipId),
        isNull(payrollRuns.archivedAt),
      ),
    )
    .orderBy(desc(payrollRuns.month))
  return rows.map(({ createdAt, ...row }) => ({ ...row, calculatedAt: createdAt.toISOString() }))
}
