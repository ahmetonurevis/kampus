import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { LESSON_OBSERVATIONS_KEY } from './use-finance-lesson-observations.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Ders gözlem planı kancaları (`/finance/observation-plans`; DOM-FIN-139, ON-207). Yazma yalnız
// yönetici (K-474). Plan açmak `Idempotency-Key`, düzeltme, erteleme, iptal ve başlatma
// `If-Match` ister. Anahtar ders gözlemi anahtarının altındadır: gözlem tamamlanınca ya da taslak
// arşivlenince plan da tazelenir (plan gerçekleşir ya da bağı kalkar; K-473).

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

export type CreateObservationPlanBody = JsonBody<'createObservationPlan'>
export type UpdateObservationPlanBody = JsonBody<'updateObservationPlan'>
export type PostponeObservationPlanBody = JsonBody<'postponeObservationPlan'>
export type CancelObservationPlanBody = JsonBody<'cancelObservationPlan'>
export type ObservationPlan =
  operations['listObservationPlans']['responses'][200]['content']['application/json']['data'][number]
export type ObservationPlanDetail =
  operations['getObservationPlan']['responses'][200]['content']['application/json']['data']
export type ObservationPlanQuery = Query<'listObservationPlans'>

export const OBSERVATION_PLANS_KEY = [...LESSON_OBSERVATIONS_KEY, 'plans'] as const
const MESSAGES = {
  version_conflict: 'Plan başka biri tarafından değiştirildi. Takvim güncellendi.',
}

/** Planlar (takvim aralığı ya da geciken planlar). */
export function useObservationPlans(query: ObservationPlanQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...OBSERVATION_PLANS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/observation-plans', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Tek plan ve öğretmene giden bildirimleri. */
export function useObservationPlan(planId: string | null) {
  return useFinanceListQuery(
    {
      key: [...OBSERVATION_PLANS_KEY, 'plan', planId],
      request: (client, signal) =>
        client.GET('/api/v1/finance/observation-plans/{planId}', {
          params: { path: { planId: planId ?? '' } },
          signal,
        }),
    },
    { enabled: planId !== null, keepPreviousPage: false },
  )
}

export function useCreateObservationPlan() {
  return useApiCommand({
    request: (client, body: CreateObservationPlanBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/observation-plans', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [OBSERVATION_PLANS_KEY],
    exclusive: true,
  })
}

const pathHeaders = (planId: string, headers: CommandHeaders) => ({
  path: { planId },
  header: {
    'idempotency-key': headers['idempotency-key'],
    'if-match': requireIfMatch(headers),
  },
})

export function useUpdateObservationPlan() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; version: number; body: UpdateObservationPlanBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/observation-plans/{planId}', {
        params: pathHeaders(input.planId, headers),
        body: input.body,
      }),
    invalidates: [OBSERVATION_PLANS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Erteleme (K-472): yeni gün ve saat, gerekçe. */
export function usePostponeObservationPlan() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; version: number; body: PostponeObservationPlanBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/observation-plans/{planId}/postpone', {
        params: pathHeaders(input.planId, headers),
        body: input.body,
      }),
    invalidates: [OBSERVATION_PLANS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** İptal (K-472): gerekçe. */
export function useCancelObservationPlan() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; version: number; body: CancelObservationPlanBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/observation-plans/{planId}/cancel', {
        params: pathHeaders(input.planId, headers),
        body: input.body,
      }),
    invalidates: [OBSERVATION_PLANS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Plandan gözlemi başlatır (K-473); gözlem listesi de tazelenir. */
export function useStartObservationPlan() {
  return useApiCommand({
    request: (client, input: { planId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/observation-plans/{planId}/start', {
        params: pathHeaders(input.planId, headers),
        body: {},
      }),
    invalidates: [LESSON_OBSERVATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
