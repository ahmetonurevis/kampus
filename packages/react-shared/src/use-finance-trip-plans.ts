import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Gezi planı ve onay dosyası kancaları (`/finance/trip-plans`; DOM-FIN-111, ON-155). Seçenek
// listesi ücretli etkinliğin bağlı planını taşıdığı için her yazma bütün anahtarı tazeler.
// Komutlar `exclusive`.

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

export type CreateTripPlanBody = JsonBody<'createTripPlan'>
export type UpdateTripPlanBody = JsonBody<'updateTripPlan'>
export type TripPlanNoteBody = JsonBody<'submitTripPlan'>
export type TripPlanReasonBody = JsonBody<'rejectTripPlan'>
export type TripPlanNoticeBody = JsonBody<'recordTripPlanAuthorityNotice'>
export type TripPlanRow =
  operations['listTripPlans']['responses'][200]['content']['application/json']['data'][number]
export type TripPlanDetail =
  operations['getTripPlan']['responses'][200]['content']['application/json']['data']
export type TripPlanOptions =
  operations['getTripPlanOptions']['responses'][200]['content']['application/json']['data']
export type TripPlanQuery = Query<'listTripPlans'>

export const TRIP_PLANS_KEY = ['finance', 'trip-plans'] as const
const MESSAGES = {
  version_conflict: 'Plan başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useTripPlans(query: TripPlanQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...TRIP_PLANS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/trip-plans', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useTripPlan(planId: string) {
  return useApiQuery({
    key: [...TRIP_PLANS_KEY, 'detail', planId],
    enabled: planId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/trip-plans/{planId}', { params: { path: { planId } }, signal }),
  })
}

export function useTripPlanOptions(enabled = true) {
  return useApiQuery({
    key: [...TRIP_PLANS_KEY, 'options'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/trip-plan-options', { signal }),
  })
}

export function useCreateTripPlan() {
  return useApiCommand({
    request: (client, body: CreateTripPlanBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/trip-plans', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [TRIP_PLANS_KEY],
    exclusive: true,
  })
}

type Versioned<TBody> = { planId: string; version: number; body: TBody }
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useUpdateTripPlan() {
  return useApiCommand({
    request: (client, input: Versioned<UpdateTripPlanBody>, headers: CommandHeaders) =>
      client.PATCH('/api/v1/finance/trip-plans/{planId}', {
        params: { path: { planId: input.planId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [TRIP_PLANS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Not alan geçişler: onaya gönderme, onay ve tamamlama. */
export type TripPlanNoteStep = 'submit' | 'approve' | 'complete'
/** Gerekçe alan geçişler: ret ve iptal. */
export type TripPlanReasonStep = 'reject' | 'cancel'

export function useTripPlanNoteStep(step: TripPlanNoteStep) {
  return useApiCommand({
    request: (client, input: Versioned<TripPlanNoteBody>, headers: CommandHeaders) => {
      const params = { path: { planId: input.planId }, header: versioned(headers) }
      switch (step) {
        case 'submit':
          return client.POST('/api/v1/finance/trip-plans/{planId}/submit', {
            params,
            body: input.body,
          })
        case 'approve':
          return client.POST('/api/v1/finance/trip-plans/{planId}/approve', {
            params,
            body: input.body,
          })
        case 'complete':
          return client.POST('/api/v1/finance/trip-plans/{planId}/complete', {
            params,
            body: input.body,
          })
        default:
          return step satisfies never
      }
    },
    invalidates: [TRIP_PLANS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useTripPlanReasonStep(step: TripPlanReasonStep) {
  return useApiCommand({
    request: (client, input: Versioned<TripPlanReasonBody>, headers: CommandHeaders) => {
      const params = { path: { planId: input.planId }, header: versioned(headers) }
      return step === 'reject'
        ? client.POST('/api/v1/finance/trip-plans/{planId}/reject', { params, body: input.body })
        : client.POST('/api/v1/finance/trip-plans/{planId}/cancel', { params, body: input.body })
    },
    invalidates: [TRIP_PLANS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useTripPlanNotice() {
  return useApiCommand({
    request: (client, input: Versioned<TripPlanNoticeBody>, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/trip-plans/{planId}/authority-notice', {
        params: { path: { planId: input.planId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [TRIP_PLANS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
