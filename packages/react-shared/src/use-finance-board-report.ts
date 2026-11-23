import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiQuery } from './use-api-query.ts'

// Yönetim kurulu raporu kancası (`GET /finance/board-report`; DOM-FIN-064, ON-251).

export type FinanceBoardReport =
  operations['getFinanceBoardReport']['responses'][200]['content']['application/json']['data']

export interface FinanceBoardReportQuery {
  /** Eğitim yılının başlangıç yılı (2026 → 2026–2027). */
  year: number
  /** Dil okulunda yılın dönemi. */
  termId?: string
  from?: string
  to?: string
  /** Bütçe ve maliyet bölümlerinin bütçe dönemi; verilmezse rapor dönemine uyan dönem (ON-329). */
  budgetPeriodId?: string
}

/**
 * Dönem özeti. Anahtar `payments` altındadır: tahsilat ve iptal sonrası kendiliğinden tazelenir.
 * Sayılar sunucudadır; küçük grup hücresi (`suppressed`) değersiz gelir.
 */
export function useFinanceBoardReport(query: FinanceBoardReportQuery) {
  return useApiQuery({
    key: ['payments', 'finance-board-report', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/board-report', { params: { query }, signal }),
  })
}
