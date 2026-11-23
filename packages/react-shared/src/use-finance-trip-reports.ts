import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Gezi sonrası rapor kancaları (`/finance/trip-plans/:planId/report*`, `/finance/trip-reports*`,
// `/finance/trip-evaluations`; DOM-FIN-158, ON-158). Rapor açma, fotoğraf ekleme ve değerlendirme
// `Idempotency-Key` ile gider: belirsiz hatadan sonra yeniden gönderim aynı anahtarı kullanır (çift
// rapor, fotoğraf ya da değerlendirme yazılmaz). Düzeltme, geçişler ve fotoğraf düzeltme/kaldırma
// `If-Match` ister. Fotoğraf bağlantıları kısa ömürlüdür; görünüm her açılışta yeniden okunur.

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

export type TripReportView = Ok<'getTripReport'>['data']
export type TripReport = NonNullable<TripReportView['report']>
export type TripReportPhoto = TripReport['photos'][number]
export type TripReportOptions = NonNullable<TripReportView['options']>
export type TripReportCreateBody = JsonBody<'createTripReport'>
export type TripReportUpdateBody = JsonBody<'updateTripReport'>
export type TripReportPhotoBody = JsonBody<'addTripReportPhoto'>
export type TripReportPhotoUpdateBody = JsonBody<'updateTripReportPhoto'>
export type TripReportRow = Ok<'listTripReports'>['data'][number]
export type TripReportQuery = Query<'listTripReports'>
export type MyTripReport = Ok<'listMyTripReports'>['data'][number]
export type TripEvaluationBody = JsonBody<'createTripEvaluation'>

export const TRIP_REPORTS_KEY = ['finance', 'trip-reports'] as const
const MESSAGES = {
  version_conflict: 'Rapor başka biri tarafından değiştirildi. Görünüm güncellendi.',
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useTripReport(planId: string, enabled = true) {
  return useApiQuery({
    key: [...TRIP_REPORTS_KEY, 'plan', planId],
    enabled: enabled && planId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/trip-plans/{planId}/report', {
        params: { path: { planId } },
        signal,
      }),
  })
}

export function useTripReports(query: TripReportQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...TRIP_REPORTS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/trip-reports', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useMyTripReports(enabled = true) {
  return useApiQuery({
    key: [...TRIP_REPORTS_KEY, 'my'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/trip-reports/my', { signal }),
  })
}

export function useCreateTripReport() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; body: TripReportCreateBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/trip-plans/{planId}/report', {
        params: {
          path: { planId: input.planId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [TRIP_REPORTS_KEY],
  })
}

export function useUpdateTripReport() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; version: number; body: TripReportUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/trip-plans/{planId}/report', {
        params: { path: { planId: input.planId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [TRIP_REPORTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export type TripReportTransition = 'submit' | 'approve' | 'return'

export function useTransitionTripReport() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; version: number; transition: TripReportTransition; reason?: string },
      headers: CommandHeaders,
    ) => {
      const params = { path: { planId: input.planId }, header: versioned(headers) }
      switch (input.transition) {
        case 'submit':
          return client.POST('/api/v1/finance/trip-plans/{planId}/report/submit', {
            params,
            body: {},
          })
        case 'approve':
          return client.POST('/api/v1/finance/trip-plans/{planId}/report/approve', {
            params,
            body: {},
          })
        case 'return':
          return client.POST('/api/v1/finance/trip-plans/{planId}/report/return', {
            params,
            body: { reason: input.reason ?? '' },
          })
        default:
          return input.transition satisfies never
      }
    },
    invalidates: [TRIP_REPORTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useAddTripReportPhoto() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; body: TripReportPhotoBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/trip-plans/{planId}/report/photos', {
        params: {
          path: { planId: input.planId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [TRIP_REPORTS_KEY],
  })
}

export function useUpdateTripReportPhoto() {
  return useApiCommand({
    request: (
      client,
      input: {
        planId: string
        photoId: string
        version: number
        body: TripReportPhotoUpdateBody
      },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/trip-plans/{planId}/report/photos/{photoId}', {
        params: {
          path: { planId: input.planId, photoId: input.photoId },
          header: versioned(headers),
        },
        body: input.body,
      }),
    invalidates: [TRIP_REPORTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useRemoveTripReportPhoto() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; photoId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.DELETE('/api/v1/finance/trip-plans/{planId}/report/photos/{photoId}', {
        params: {
          path: { planId: input.planId, photoId: input.photoId },
          header: versioned(headers),
        },
      }),
    invalidates: [TRIP_REPORTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useCreateTripEvaluation() {
  return useApiCommand({
    request: (client, input: TripEvaluationBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/trip-evaluations', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body: input,
      }),
    invalidates: [TRIP_REPORTS_KEY],
  })
}
