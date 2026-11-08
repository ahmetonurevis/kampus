import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiQuery } from './use-api-query.ts'

// Gelir ve nakit akışı tahmini kancaları (ON-246, ON-247; DOM-FIN-063). Salt okurdur; ödeme
// sonrası tazelenmesi için anahtar `payments` ile başlar (tahsilat komutları bu öneki geçersiz kılar).

/** Seçilen eğitim yılının gelir tahmini; `year` verilmezse kurumun kayıt yılı. */
export function useFinanceRevenueForecast(query: { year?: number }) {
  return useApiQuery({
    key: ['payments', 'finance-revenue-forecast', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/forecasts/revenue', { params: { query }, signal }),
  })
}

/** Bu aydan başlayan aylık nakit akışı tahmini; gider verilmezse gider boştur. */
export function useFinanceCashFlowForecast(query: {
  months: number
  monthlyExpenseCents?: number
}) {
  return useApiQuery({
    key: ['payments', 'finance-cash-flow-forecast', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/forecasts/cash-flow', { params: { query }, signal }),
  })
}

/**
 * Gelir senaryolarının temel ile karşılaştırması (ON-248; DOM-FIN-067). Uç `POST`'tur ama salt
 * okurdur, senaryo saklanmaz; bu yüzden sorgu olarak çalışır, anahtar gövdeyi taşır. `body` `null`
 * iken (geçerli senaryo yok) istek atılmaz.
 */
export function useFinanceScenarioComparison(body: FinanceScenarioBody | null) {
  return useApiQuery({
    key: ['payments', 'finance-scenario-comparison', body],
    enabled: body !== null,
    request: (client, signal) =>
      client.POST('/api/v1/finance/forecasts/scenarios', {
        body: body ?? { scenarios: [] },
        signal,
      }),
  })
}

export type FinanceScenarioBody =
  operations['compareFinanceScenarios']['requestBody']['content']['application/json']
