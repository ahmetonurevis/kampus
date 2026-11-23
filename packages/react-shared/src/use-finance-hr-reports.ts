import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// İK raporu kancaları (`/finance/hr-reports`; DOM-FIN-117, ON-192). Yalnız yönetici. Rapor kişi
// adı taşımaz ama kişisel veri toplamıdır: her okuma, CSV ve PDF denetime düşer; CSV taze oturum
// ister (K-401). Rapor yazma yapmaz; izin, rapor ve atama sekmeleri açılışta yeniden okunur.

type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never

export type HrReport =
  operations['getFinanceHrReport']['responses'][200]['content']['application/json']['data']
export type HrReportQuery = Omit<Query<'getFinanceHrReport'>, 'purpose'>

export const HR_REPORTS_KEY = ['finance', 'hr-reports'] as const

/** Ay aralığının raporu; geçersiz aralıkta (`enabled: false`) istek atılmaz. */
export function useHrReport(query: HrReportQuery, enabled = true) {
  return useApiQuery({
    key: [...HR_REPORTS_KEY, query],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/hr-reports', { params: { query }, signal }),
  })
}

/** Raporun CSV'si (`Accept: text/csv`); taze oturum ister, denetime düşer, sorgu tazelenmez. */
export function useHrReportExport() {
  return useApiCommand({
    request: (client, query: HrReportQuery) =>
      client.GET('/api/v1/finance/hr-reports', {
        params: { query },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}
