import {
  payrollPayslip,
  type PayrollPayslip,
} from '@kampus/school-core/lib/finance-payroll-payslips.ts'

import { lockedPayrollMonths } from '../db/finance-payroll-periods.ts'
import { findInstitutionName, loadPayslipLines } from '../db/finance-payroll-payslips.ts'
import { findActivePayrollRun } from '../db/finance-payroll-runs.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'

/**
 * Ücret hesap pusulası (DOM-FIN-119; ON-201). Kural core `lib/finance-payroll-payslips.ts`'tedir.
 * Pusula yalnız ayın etkin kayıtlı hesabından üretilir (K-406): kayıt yoksa ya da personel kayıtlı
 * hesapta değilse 404; canlı önizleme kullanılmaz. Pusula ücret ve icra kesintisi taşır (K-408):
 * her üretimde pusula başına bir `finance.payroll_payslip.export` denetim kaydı (satır kimliğiyle,
 * yalnız alan adları) okumayla aynı transaction'da yazılır; denetim yazılamazsa veri dönmez. Rol,
 * modül, taze oturum ve hız sınırı rotadadır.
 */

const LINE_ENTITY = 'payroll_run_lines'
/** Denetime yazılan alan adları (değer yazılmaz). */
const PAYSLIP_FIELDS = [
  'grossCents',
  'incomeTaxBaseCents',
  'incomeTaxPayableCents',
  'netCents',
  'deductions',
  'payableCents',
]

export interface PayrollPayslipsView {
  month: string
  runId: string
  revision: number
  calculatedAt: string
  locked: boolean
  institutionName: string
  payslips: PayrollPayslip[]
}

export function payrollPayslipsFor(
  ctx: ServiceContext,
  month: string,
  membershipId: string | undefined,
): Promise<PayrollPayslipsView> {
  return ctx.db.transaction(async (tx) => {
    const run = await findActivePayrollRun(tx, ctx.institutionId, month)
    if (run === null) throw new NotFoundError()
    const lines = await loadPayslipLines(tx, ctx.institutionId, run.id, membershipId)
    if (lines.length === 0) throw new NotFoundError()
    await tx.insert(auditLog).values(
      lines.map((line) => ({
        institutionId: ctx.institutionId,
        actorUserId: ctx.actor.userId,
        actorRole: ctx.actor.role,
        action: 'finance.payroll_payslip.export',
        entityType: LINE_ENTITY,
        entityId: line.id,
        // kvkk: değer değil, pusulada dönen ücret alanlarının adı.
        changes: { fields: PAYSLIP_FIELDS },
        createdAt: ctx.now,
      })),
    )
    return {
      month,
      runId: run.id,
      revision: run.revision,
      calculatedAt: run.calculatedAt,
      locked: (await lockedPayrollMonths(tx, ctx.institutionId)).includes(month),
      institutionName: await findInstitutionName(tx, ctx.institutionId),
      payslips: lines.map((line) => payrollPayslip(line.line)),
    }
  })
}
