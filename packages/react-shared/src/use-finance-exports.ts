import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Muhasebe aktarımı kancaları (`/finance/summary`, `/finance/exports`; IST-111, ADR 0006 karar 11).

export type FinanceExportKind = 'payments' | 'refunds' | 'invoices'
export interface FinancePeriod {
  from: string
  to: string
}

export function useFinanceSummary(period: FinancePeriod, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: ['finance-summary', period],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/summary', { params: { query: period }, signal }),
  })
}

/** Finans ekranı kartları: kurum geneli, kısmi ödemeler dahil. Ödeme sonrası tazelenir. */
export function useFinanceTotals() {
  return useApiQuery({
    key: ['payments', 'finance-totals'],
    request: (client, signal) => client.GET('/api/v1/finance/totals', { signal }),
  })
}

/** Dosyayı metin olarak alır; yazma değildir, sorgu tazelenmez. Hata mesajı toast olur. */
export function useFinanceExport() {
  return useApiCommand({
    request: (client, query: FinancePeriod & { kind: FinanceExportKind }) =>
      client.GET('/api/v1/finance/exports', { params: { query }, parseAs: 'text' }),
    invalidates: [],
  })
}
