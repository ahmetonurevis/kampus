import { and, asc, eq } from 'drizzle-orm'

import type { PayrollCalcRow } from '@kampus/school-core/lib/finance-payroll-calc.ts'

import type { Database } from './client.ts'
import { institutions } from './schema/auth.ts'
import { payrollRunLines } from './schema/finance-payroll-runs.ts'

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
