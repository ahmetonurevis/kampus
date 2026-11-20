import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Gözlem sonrası görüşme ve gelişim hedefi kancaları (`/finance/lesson-observations/:id/debrief`,
// `/finance/observation-debriefs`, `/finance/development-goals`; DOM-FIN-133, ON-209). Yazma
// yalnız yönetici (K-456). Görüşme ve hedef açmak `Idempotency-Key`, düzeltme, kesinleştirme ve
// takip notu `If-Match` ister. Okumalar sunucuda denetime düşer. Komutlar `exclusive`.

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

export type CreateObservationDebriefBody = JsonBody<'createObservationDebrief'>
export type UpdateObservationDebriefBody = JsonBody<'updateObservationDebrief'>
export type CreateDevelopmentGoalBody = JsonBody<'createDevelopmentGoal'>
export type UpdateDevelopmentGoalBody = JsonBody<'updateDevelopmentGoal'>
export type DevelopmentGoalFollowUpBody = JsonBody<'followUpDevelopmentGoal'>
export type ObservationDebrief = NonNullable<
  operations['getObservationDebrief']['responses'][200]['content']['application/json']['data']
>
export type DevelopmentGoal =
  operations['listDevelopmentGoals']['responses'][200]['content']['application/json']['data'][number]
export type DevelopmentGoalDetail =
  operations['getDevelopmentGoal']['responses'][200]['content']['application/json']['data']
export type DevelopmentGoalQuery = Query<'listDevelopmentGoals'>

export const DEVELOPMENT_GOALS_KEY = ['finance', 'development-goals'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

/** Gözlemin görüşmesi (`data` boşsa görüşme yok); okuma denetime yazılır (K-456). */
export function useObservationDebrief(observationId: string | null) {
  return useFinanceListQuery(
    {
      key: [...DEVELOPMENT_GOALS_KEY, 'debrief', observationId],
      request: (client, signal) =>
        client.GET('/api/v1/finance/lesson-observations/{observationId}/debrief', {
          params: { path: { observationId: observationId ?? '' } },
          signal,
        }),
    },
    { enabled: observationId !== null, keepPreviousPage: false },
  )
}

export function useCreateObservationDebrief() {
  return useApiCommand({
    request: (
      client,
      input: { observationId: string; body: CreateObservationDebriefBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/lesson-observations/{observationId}/debrief', {
        params: {
          path: { observationId: input.observationId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [DEVELOPMENT_GOALS_KEY],
    exclusive: true,
  })
}

export function useUpdateObservationDebrief() {
  return useApiCommand({
    request: (
      client,
      input: { debriefId: string; version: number; body: UpdateObservationDebriefBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/observation-debriefs/{debriefId}', {
        params: {
          path: { debriefId: input.debriefId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [DEVELOPMENT_GOALS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Kesinleştirme (K-454); sonra görüşme değişmez. */
export function useFinalizeObservationDebrief() {
  return useApiCommand({
    request: (client, input: { debriefId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/observation-debriefs/{debriefId}/finalize', {
        params: {
          path: { debriefId: input.debriefId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: {},
      }),
    invalidates: [DEVELOPMENT_GOALS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Gelişim hedefleri; her okuma sunucuda denetime yazılır (K-456). */
export function useDevelopmentGoals(query: DevelopmentGoalQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...DEVELOPMENT_GOALS_KEY, 'goals', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/development-goals', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Tek hedef ve takip geçmişi. */
export function useDevelopmentGoal(goalId: string | null) {
  return useFinanceListQuery(
    {
      key: [...DEVELOPMENT_GOALS_KEY, 'goal', goalId],
      request: (client, signal) =>
        client.GET('/api/v1/finance/development-goals/{goalId}', {
          params: { path: { goalId: goalId ?? '' } },
          signal,
        }),
    },
    { enabled: goalId !== null, keepPreviousPage: false },
  )
}

export function useCreateDevelopmentGoal() {
  return useApiCommand({
    request: (client, body: CreateDevelopmentGoalBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/development-goals', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [DEVELOPMENT_GOALS_KEY],
    exclusive: true,
  })
}

export function useUpdateDevelopmentGoal() {
  return useApiCommand({
    request: (
      client,
      input: { goalId: string; version: number; body: UpdateDevelopmentGoalBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/development-goals/{goalId}', {
        params: {
          path: { goalId: input.goalId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [DEVELOPMENT_GOALS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Takip notu (K-455): not, isteğe bağlı durum ve sonraki takip tarihi. */
export function useFollowUpDevelopmentGoal() {
  return useApiCommand({
    request: (
      client,
      input: { goalId: string; version: number; body: DevelopmentGoalFollowUpBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/development-goals/{goalId}/follow-ups', {
        params: {
          path: { goalId: input.goalId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [DEVELOPMENT_GOALS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
