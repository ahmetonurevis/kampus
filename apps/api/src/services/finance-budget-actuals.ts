import {
  budgetActuals,
  type BudgetActualBasis,
  type BudgetActuals,
} from '@kampus/school-core/lib/finance-budget-actuals.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import { loadBudgetItems, loadBudgetPeriods, loadCostCenters } from '../db/finance-budget.ts'
import {
  loadContractCourses,
  loadExpenseActuals,
  loadPeriodLines,
  loadStudentCourses,
} from '../db/finance-budget-actuals.ts'
import { paymentsForReconciliation } from '../db/payments.ts'
import { withdrawalsForReconciliation } from '../db/withdrawals.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'
import { FINANCE_TABLE_STORES, runReadOnly } from './operation-runner.ts'

/**
 * Bütçe–gerçekleşen raporu (ON-244; DOM-FIN-066). Hesap core `lib/finance-budget-actuals.ts`'tedir;
 * bütün satırlar tek salt okur görüntüden okunur, hiçbir şey yazılmaz. Kurum oturumdan gelir; başka
 * kurumun dönemi 404. Öğrenci ve sınıf kaydı yalnız merkez ataması için okunur, yanıt kişi verisi
 * taşımaz ve tutar loglanmaz.
 */

const DAY = 86_400_000

export function financeBudgetActualsFor(
  ctx: ServiceContext,
  periodId: string,
  query: { basis: BudgetActualBasis },
): Promise<BudgetActuals> {
  const today = dayKey(ctx.now)
  return runReadOnly(ctx, {
    action: 'finance.budget_actuals',
    collections: ['students', 'classes', 'invoices', 'contracts'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const periods = await loadBudgetPeriods(tx, ctx.institutionId)
      const period = periods.find((item) => item.id === periodId)
      if (period === undefined) throw new NotFoundError()
      const institution = await getInstitutionModules(tx, ctx.institutionId)
      if (institution === null) throw new NotFoundError()
      const language = institution.type === 'language_school'
      // İstanbul gününün ötesini de kapsar; kesin gün süzmesi core `dayKey` ile yapılır.
      const lastDay = period.endDate < today ? period.endDate : today
      const until = new Date(Date.parse(`${lastDay}T00:00:00.000Z`) + 2 * DAY)
      const [centers, items, lines, withdrawals, payments, expenses] = [
        await loadCostCenters(tx, ctx.institutionId),
        await loadBudgetItems(tx, ctx.institutionId),
        await loadPeriodLines(tx, ctx.institutionId, period.id),
        await withdrawalsForReconciliation(tx, ctx.institutionId),
        query.basis === 'cash' ? await paymentsForReconciliation(tx, ctx.institutionId, until) : [],
        await loadExpenseActuals(tx, ctx.institutionId, period),
      ]
      const contractCourseIds = language
        ? await loadContractCourses(tx, ctx.institutionId)
        : new Map<string, string>()
      const studentCourseIds = language
        ? await loadStudentCourses(tx, ctx.institutionId)
        : new Map<string, string[]>()
      return {
        run: (state) =>
          budgetActuals({
            period,
            basis: query.basis,
            today,
            institutionType: institution.type,
            centers,
            items,
            lines,
            invoices: state.invoices,
            contracts: state.contracts,
            students: state.students,
            classes: state.classes,
            contractCourseIds,
            studentCourseIds,
            payments,
            withdrawals,
            expenses,
          }),
      }
    },
  })
}
