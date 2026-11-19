import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Personel performans dönemi kancaları (`/finance/performance-periods`,
// `/finance/performance-reviews`; DOM-FIN-124, ON-211). Yalnız yönetici (K-429). Dönem ve personel
// kaydı açmak `Idempotency-Key`, aşama geçişi ve kayıt düzeltmesi `If-Match` ister. Kayıt listesi
// okuması sunucuda denetime düşer. Komutlar `exclusive`.

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

export type CreatePerformancePeriodBody = JsonBody<'createPerformancePeriod'>
export type CreatePerformanceReviewBody = JsonBody<'createPerformanceReview'>
export type UpdatePerformanceReviewBody = JsonBody<'updatePerformanceReview'>
export type PerformancePeriod =
  operations['listPerformancePeriods']['responses'][200]['content']['application/json']['data'][number]
export type PerformanceReview =
  operations['listPerformanceReviews']['responses'][200]['content']['application/json']['data'][number]
export type PerformancePeriodQuery = Query<'listPerformancePeriods'>
export type PerformanceReviewQuery = Query<'listPerformanceReviews'>

export const PERFORMANCE_KEY = ['finance', 'performance'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function usePerformancePeriods(query: PerformancePeriodQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...PERFORMANCE_KEY, 'periods', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/performance-periods', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Dönemin personel kayıtları; her okuma sunucuda denetime yazılır (K-429). */
export function usePerformanceReviews(
  periodId: string | null,
  query: PerformanceReviewQuery,
  enabled = true,
) {
  return useFinanceListQuery(
    {
      key: [...PERFORMANCE_KEY, 'reviews', periodId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/performance-periods/{periodId}/reviews', {
          params: { path: { periodId: periodId ?? '' }, query },
          signal,
        }),
    },
    { enabled: enabled && periodId !== null },
  )
}

export function useCreatePerformancePeriod() {
  return useApiCommand({
    request: (client, body: CreatePerformancePeriodBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/performance-periods', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [PERFORMANCE_KEY],
    exclusive: true,
  })
}

export function useChangePerformancePeriodStatus() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; version: number; status: PerformancePeriod['status'] },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/performance-periods/{periodId}/status', {
        params: {
          path: { periodId: input.periodId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { status: input.status },
      }),
    invalidates: [PERFORMANCE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreatePerformanceReview() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; body: CreatePerformanceReviewBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/performance-periods/{periodId}/reviews', {
        params: {
          path: { periodId: input.periodId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [PERFORMANCE_KEY],
    exclusive: true,
  })
}

export function useUpdatePerformanceReview() {
  return useApiCommand({
    request: (
      client,
      input: { reviewId: string; version: number; body: UpdatePerformanceReviewBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/performance-reviews/{reviewId}', {
        params: {
          path: { reviewId: input.reviewId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [PERFORMANCE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
