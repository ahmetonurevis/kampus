import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { PROCUREMENT_KEY } from './use-finance-procurement.ts'

// Satın alma raporu kancaları (`/finance/purchase-report`; DOM-FIN-075, ON-227). Yalnız yönetici,
// salt okur. Anahtar satın alma anahtarıyla başlar: sipariş açma, iptal ve mal kabul raporu da
// tazeler; tedarikçi faturası ve ödemesi raporu ayrıca tazeler (ON-336).

/** Rapor sorgularının ortak öneki; tedarikçi carisi yazıları bunu da geçersiz kılar. */
export const PURCHASE_REPORT_KEY = [...PROCUREMENT_KEY, 'report'] as const

export type PurchaseReport =
  operations['getFinancePurchaseReport']['responses'][200]['content']['application/json']['data']
export type PurchaseReportQuery = NonNullable<
  operations['getFinancePurchaseReport']['parameters']['query']
>

/** Sorgu geçersizken (`null`) istek atılmaz. */
export function usePurchaseReport(query: PurchaseReportQuery | null) {
  return useApiQuery({
    key: [...PURCHASE_REPORT_KEY, query],
    enabled: query !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/purchase-report', { params: { query: query ?? {} }, signal }),
  })
}

/** Raporun CSV dosyası (`Accept: text/csv`); şahıs tedarikçi adı taşır, taze oturum ister, denetime düşer. */
export function usePurchaseReportExport() {
  return useApiCommand({
    request: (client, query: PurchaseReportQuery) =>
      client.GET('/api/v1/finance/purchase-report', {
        params: { query },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}
