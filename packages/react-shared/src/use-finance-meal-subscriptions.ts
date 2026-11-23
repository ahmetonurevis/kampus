import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Yemek aboneliği kancaları (`/finance/meal-subscriptions*`, `/finance/meal-daily-counts`,
// `/finance/meal-monthly-summary`, `/finance/meal-subscription-settings`; DOM-FIN-164, ON-150).
// Abonelik ve gün iptali `Idempotency-Key`; düzenleme, arşiv, geri alma ve kesim `If-Match` ile
// gider. Her yazma anahtarın tamamını tazeler (liste, ayrıntı, sayım, özet ve aile görünümü).

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

export type MealSubscriptionBody = JsonBody<'createMealSubscription'>
export type MealSubscriptionUpdateBody = JsonBody<'updateMealSubscription'>
export type MealCutoffBody = JsonBody<'setMealSubscriptionSettings'>
export type MealSubscriptionRow = Ok<'listMealSubscriptions'>['data'][number]
export type MealSubscriptionDetail = Ok<'getMealSubscription'>['data']
export type MealSubscriptionDay = MealSubscriptionDetail['days'][number]
export type MealDailyCount = Ok<'getMealDailyCount'>['data']
export type MealMonthlyRow = Ok<'listMealMonthlySummary'>['data'][number]
export type MealCutoffSettings = Ok<'getMealSubscriptionSettings'>['data']
export type MyMealSubscriptions = Ok<'listMyMealSubscriptions'>['data']
export type MealSubscriptionQuery = Query<'listMealSubscriptions'>
export type MealMonthlyQuery = Query<'listMealMonthlySummary'>

export const MEAL_SUBSCRIPTIONS_KEY = ['finance', 'meal-subscriptions'] as const
const MESSAGES = {
  version_conflict: 'Abonelik başka biri tarafından değiştirildi. Bilgiler güncellendi.',
}
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useMealSubscriptions(query: MealSubscriptionQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...MEAL_SUBSCRIPTIONS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/meal-subscriptions', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useMealSubscription(subscriptionId: string, enabled = true) {
  return useApiQuery({
    key: [...MEAL_SUBSCRIPTIONS_KEY, 'subscription', subscriptionId],
    enabled: enabled && subscriptionId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/meal-subscriptions/{subscriptionId}', {
        params: { path: { subscriptionId } },
        signal,
      }),
  })
}

/** Veli ve öğrencinin abonelikleri ve 28 günlük yemek takvimi. */
export function useMyMealSubscriptions(enabled = true) {
  return useApiQuery({
    key: [...MEAL_SUBSCRIPTIONS_KEY, 'my'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/meal-subscriptions/my', { signal }),
  })
}

/** Günlük mutfak sayısı; `date` verilmezse bugün. */
export function useMealDailyCount(date: string, enabled = true) {
  return useApiQuery({
    key: [...MEAL_SUBSCRIPTIONS_KEY, 'daily', date],
    enabled: enabled && date !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/meal-daily-counts', { params: { query: { date } }, signal }),
  })
}

export function useMealMonthlySummary(query: MealMonthlyQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...MEAL_SUBSCRIPTIONS_KEY, 'monthly', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/meal-monthly-summary', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useMealCutoffSettings(enabled = true) {
  return useApiQuery({
    key: [...MEAL_SUBSCRIPTIONS_KEY, 'settings'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/meal-subscription-settings', { signal }),
  })
}

export function useCreateMealSubscription() {
  return useApiCommand({
    request: (client, body: MealSubscriptionBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/meal-subscriptions', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [MEAL_SUBSCRIPTIONS_KEY],
    exclusive: true,
  })
}

export function useUpdateMealSubscription() {
  return useApiCommand({
    request: (
      client,
      input: { subscriptionId: string; version: number; body: MealSubscriptionUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/meal-subscriptions/{subscriptionId}', {
        params: { path: { subscriptionId: input.subscriptionId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [MEAL_SUBSCRIPTIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveMealSubscription() {
  return useApiCommand({
    request: (
      client,
      input: { subscriptionId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.DELETE('/api/v1/finance/meal-subscriptions/{subscriptionId}', {
        params: { path: { subscriptionId: input.subscriptionId }, header: versioned(headers) },
      }),
    invalidates: [MEAL_SUBSCRIPTIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

/** Gün iptali (okul ya da veli); kesimden sonra okulun iptali geç iptaldir. */
export function useCancelMealDays() {
  return useApiCommand({
    request: (
      client,
      input: { subscriptionId: string; dates: string[] },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/meal-subscriptions/{subscriptionId}/cancellations', {
        params: {
          path: { subscriptionId: input.subscriptionId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: { dates: input.dates },
      }),
    invalidates: [MEAL_SUBSCRIPTIONS_KEY],
    exclusive: true,
  })
}

export function useRestoreMealDay() {
  return useApiCommand({
    request: (
      client,
      input: { subscriptionId: string; cancellationId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.DELETE(
        '/api/v1/finance/meal-subscriptions/{subscriptionId}/cancellations/{cancellationId}',
        {
          params: {
            path: { subscriptionId: input.subscriptionId, cancellationId: input.cancellationId },
            header: versioned(headers),
          },
        },
      ),
    invalidates: [MEAL_SUBSCRIPTIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useSetMealCutoff() {
  return useApiCommand({
    request: (client, input: { version: number; body: MealCutoffBody }, headers: CommandHeaders) =>
      client.PATCH('/api/v1/finance/meal-subscription-settings', {
        params: { header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [MEAL_SUBSCRIPTIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}
