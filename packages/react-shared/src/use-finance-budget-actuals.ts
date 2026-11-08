import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiQuery } from './use-api-query.ts'
import { BUDGET_KEY } from './use-finance-budget.ts'

// Bütçe–gerçekleşen kancası (`/finance/budget-periods/:periodId/actuals`; DOM-FIN-066, ON-244).
// Salt okurdur; anahtar bütçe öneki altındadır, bütçe yazmaları onu da tazeler.

export type BudgetActualsReport =
  operations['getBudgetActuals']['responses'][200]['content']['application/json']['data']
export type BudgetActualBasis = BudgetActualsReport['basis']

export function useBudgetActuals(periodId: string, basis: BudgetActualBasis) {
  return useApiQuery({
    key: [...BUDGET_KEY, 'actuals', periodId, basis],
    enabled: periodId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/budget-periods/{periodId}/actuals', {
        params: { path: { periodId }, query: { basis } },
        signal,
      }),
  })
}
