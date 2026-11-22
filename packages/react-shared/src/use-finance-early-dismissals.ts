import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Erken çıkış kancaları (`/finance/early-dismissal*`, `/finance/my-early-dismissals`; DOM-FIN-161,
// ON-168). Talep `Idempotency-Key`, onay, ret, iptal ve teslim `If-Match` ile gider. Her yazma
// anahtarın tamamını tazeler (liste, özet, ayrıntı ve yoklamaya yansıma birlikte değişir). Veli
// ekranı aynı talep, iptal ve `useMyEarlyDismissals` kancalarını kullanır.

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

export type EarlyDismissalCreateBody = JsonBody<'createEarlyDismissal'>
export type EarlyDismissalRejectBody = JsonBody<'rejectEarlyDismissal'>
export type EarlyDismissalCancelBody = JsonBody<'cancelEarlyDismissal'>
export type EarlyDismissalReleaseBody = JsonBody<'releaseEarlyDismissal'>
export type EarlyDismissalRow = Ok<'listEarlyDismissals'>['data'][number]
export type EarlyDismissalDetail = Ok<'getEarlyDismissal'>['data']
export type EarlyDismissalSummary = Ok<'getEarlyDismissalSummary'>['data']
export type EarlyDismissalPickupOption = Ok<'listEarlyDismissalPickupOptions'>['data'][number]
export type EarlyDismissalEffects = Ok<'listEarlyDismissalAttendanceEffects'>['data']
export type MyEarlyDismissal = Ok<'listMyEarlyDismissals'>['data'][number]
export type EarlyDismissalQuery = Query<'listEarlyDismissals'>
export type MyEarlyDismissalQuery = Query<'listMyEarlyDismissals'>
export type EarlyDismissalEffectsQuery = Query<'listEarlyDismissalAttendanceEffects'>

export const EARLY_DISMISSALS_KEY = ['finance', 'early-dismissals'] as const
const MESSAGES = {
  version_conflict: 'Talep başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useEarlyDismissals(query: EarlyDismissalQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...EARLY_DISMISSALS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/early-dismissals', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useEarlyDismissal(dismissalId: string, enabled = true) {
  return useApiQuery({
    key: [...EARLY_DISMISSALS_KEY, 'detail', dismissalId],
    enabled: enabled && dismissalId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/early-dismissals/{dismissalId}', {
        params: { path: { dismissalId } },
        signal,
      }),
  })
}

export function useEarlyDismissalSummary(date: string, enabled = true) {
  return useApiQuery({
    key: [...EARLY_DISMISSALS_KEY, 'summary', date],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/early-dismissal-summary', {
        params: { query: { date } },
        signal,
      }),
  })
}

export function useEarlyDismissalPickupOptions(studentId: string, enabled = true) {
  return useApiQuery({
    key: [...EARLY_DISMISSALS_KEY, 'pickup-options', studentId],
    enabled: enabled && studentId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/early-dismissal-pickup-options', {
        params: { query: { studentId } },
        signal,
      }),
  })
}

export function useEarlyDismissalEffects(query: EarlyDismissalEffectsQuery, enabled = true) {
  return useApiQuery({
    key: [...EARLY_DISMISSALS_KEY, 'effects', query],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/early-dismissal-attendance-effects', {
        params: { query },
        signal,
      }),
  })
}

export function useMyEarlyDismissals(query: MyEarlyDismissalQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...EARLY_DISMISSALS_KEY, 'mine', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/my-early-dismissals', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useCreateEarlyDismissal() {
  return useApiCommand({
    request: (client, body: EarlyDismissalCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/early-dismissals', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [EARLY_DISMISSALS_KEY],
    exclusive: true,
  })
}

const versionedHeaders = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useApproveEarlyDismissal() {
  return useApiCommand({
    request: (client, input: { dismissalId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/early-dismissals/{dismissalId}/approve', {
        params: { path: { dismissalId: input.dismissalId }, header: versionedHeaders(headers) },
        body: {},
      }),
    invalidates: [EARLY_DISMISSALS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useRejectEarlyDismissal() {
  return useApiCommand({
    request: (
      client,
      input: { dismissalId: string; version: number; body: EarlyDismissalRejectBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/early-dismissals/{dismissalId}/reject', {
        params: { path: { dismissalId: input.dismissalId }, header: versionedHeaders(headers) },
        body: input.body,
      }),
    invalidates: [EARLY_DISMISSALS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCancelEarlyDismissal() {
  return useApiCommand({
    request: (
      client,
      input: { dismissalId: string; version: number; body: EarlyDismissalCancelBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/early-dismissals/{dismissalId}/cancel', {
        params: { path: { dismissalId: input.dismissalId }, header: versionedHeaders(headers) },
        body: input.body,
      }),
    invalidates: [EARLY_DISMISSALS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useReleaseEarlyDismissal() {
  return useApiCommand({
    request: (
      client,
      input: { dismissalId: string; version: number; body: EarlyDismissalReleaseBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/early-dismissals/{dismissalId}/release', {
        params: { path: { dismissalId: input.dismissalId }, header: versionedHeaders(headers) },
        body: input.body,
      }),
    invalidates: [EARLY_DISMISSALS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
