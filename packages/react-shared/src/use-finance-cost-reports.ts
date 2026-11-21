import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiQuery } from './use-api-query.ts'
import { BUDGET_KEY } from './use-finance-budget.ts'

// Öğrenci başı maliyet ve kampüs konsolidasyonu kancaları (`/finance/cost-per-student`,
// `/finance/campus-consolidation`; DOM-FIN-065, ON-249, ON-250). Yalnız yönetici, salt okur.
// Anahtar bütçe anahtarıyla başlar: merkez, kalem ya da satır yazması raporu da tazeler.

export type CostPerStudentReport =
  operations['getFinanceCostPerStudent']['responses'][200]['content']['application/json']['data']
export type CampusConsolidationReport =
  operations['getFinanceCampusConsolidation']['responses'][200]['content']['application/json']['data']
export type CostReportQuery = NonNullable<
  operations['getFinanceCostPerStudent']['parameters']['query']
>

/** Bütçe dönemi seçilmeden istek atılmaz. */
export function useFinanceCostPerStudent(query: CostReportQuery | null) {
  return useApiQuery({
    key: [...BUDGET_KEY, 'cost-per-student', query],
    enabled: query !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/cost-per-student', {
        params: { query: query ?? { periodId: '' } },
        signal,
      }),
  })
}

export function useFinanceCampusConsolidation(query: CostReportQuery | null) {
  return useApiQuery({
    key: [...BUDGET_KEY, 'campus-consolidation', query],
    enabled: query !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/campus-consolidation', {
        params: { query: query ?? { periodId: '' } },
        signal,
      }),
  })
}
