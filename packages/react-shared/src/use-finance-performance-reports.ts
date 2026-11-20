import type { operations } from '@kampus/api-client/schema.d.ts'

import type { CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Performans raporu kancaları (`/finance/performance-periods/{periodId}/report-summary`,
// `…/reports`, `/finance/performance-reviews/{reviewId}/report*`; DOM-FIN-137, ON-220). Özet,
// satırlar, kesinleştirme ve "okudum" kaydı yalnız yönetici; rapor okuması sunucuda denetime düşer
// (K-468). Kesinleştirme ve "okudum" kaydı `Idempotency-Key` ister. Komutlar `exclusive`; her
// yazma anahtarın tamamını tazeler (özet, satırlar ve rapor birlikte değişir).

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never
type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never
type Ok<TOperation extends keyof operations> = operations[TOperation]['responses'] extends {
  200: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type PerformanceReportSummary = Ok<'getPerformanceReportSummary'>['data']
export type PerformanceReportRow = Ok<'listPerformanceReports'>['data'][number]
export type PerformanceReportRowQuery = Query<'listPerformanceReports'>
export type PerformanceReport = Ok<'getPerformanceReport'>['data']
export type FinalizePerformanceReportBody = JsonBody<'finalizePerformanceReport'>
export type AcknowledgePerformanceReportBody = JsonBody<'acknowledgePerformanceReport'>

export const PERFORMANCE_REPORTS_KEY = ['finance', 'performance-reports'] as const

/** Dönem özeti: ortalama, dağılım, gözlem ortalaması ve rapor sayıları (kişi adı yok). */
export function usePerformanceReportSummary(periodId: string | null, enabled = true) {
  return useApiQuery({
    key: [...PERFORMANCE_REPORTS_KEY, 'summary', periodId],
    enabled: enabled && periodId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/performance-periods/{periodId}/report-summary', {
        params: { path: { periodId: periodId ?? '' } },
        signal,
      }),
  })
}

/** Dönemin personel başına rapor satırları; okuma sunucuda denetime yazılır. */
export function usePerformanceReportRows(
  periodId: string | null,
  query: PerformanceReportRowQuery,
  enabled = true,
) {
  return useFinanceListQuery(
    {
      key: [...PERFORMANCE_REPORTS_KEY, 'rows', periodId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/performance-periods/{periodId}/reports', {
          params: { path: { periodId: periodId ?? '' }, query },
          signal,
        }),
    },
    { enabled: enabled && periodId !== null },
  )
}

/** Personel × dönem raporu (ekran); her okuma sunucuda denetime yazılır. */
export function usePerformanceReport(reviewId: string | null, enabled = true) {
  return useApiQuery({
    key: [...PERFORMANCE_REPORTS_KEY, 'detail', reviewId],
    enabled: enabled && reviewId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/performance-reviews/{reviewId}/report', {
        params: { path: { reviewId: reviewId ?? '' }, query: { purpose: 'view' } },
        signal,
      }),
  })
}

export function useFinalizePerformanceReport() {
  return useApiCommand({
    request: (
      client,
      input: { reviewId: string; body: FinalizePerformanceReportBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/performance-reviews/{reviewId}/report/finalize', {
        params: {
          path: { reviewId: input.reviewId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [PERFORMANCE_REPORTS_KEY],
    exclusive: true,
  })
}

export function useAcknowledgePerformanceReport() {
  return useApiCommand({
    request: (
      client,
      input: { reviewId: string; body: AcknowledgePerformanceReportBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/performance-reviews/{reviewId}/report/acknowledge', {
        params: {
          path: { reviewId: input.reviewId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [PERFORMANCE_REPORTS_KEY],
    exclusive: true,
  })
}
