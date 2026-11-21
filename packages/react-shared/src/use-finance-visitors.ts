import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Ziyaretçi kaydı kancaları (`/finance/visitor*`; DOM-FIN-141, ON-166). Giriş ve anonimleştirme
// `Idempotency-Key`, çıkış, kart iadesi ve ayar `If-Match` ile gider. Her yazma anahtarın tamamını
// tazeler (liste, özet, kart havuzu ve saklama listesi birlikte değişir).

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

export type VisitorCheckInBody = JsonBody<'checkInVisitor'>
export type VisitorCheckOutBody = JsonBody<'checkOutVisitor'>
export type VisitorBadgeReleaseBody = JsonBody<'releaseVisitorBadge'>
export type VisitorSettingsBody = JsonBody<'setVisitorSettings'>
export type VisitorAnonymizationBody = JsonBody<'anonymizeVisitors'>
export type VisitorRow = Ok<'listVisitors'>['data'][number]
export type VisitorDetail = Ok<'getVisitor'>['data']
export type VisitorSummary = Ok<'getVisitorSummary'>['data']
export type VisitorSettingsData = Ok<'getVisitorSettings'>['data']
export type VisitorHost = Ok<'listVisitorHosts'>['data'][number]
export type VisitorQuery = Query<'listVisitors'>
export type VisitorHostQuery = Query<'listVisitorHosts'>
export type VisitorRetentionQuery = Query<'listVisitorRetention'>

export const VISITORS_KEY = ['finance', 'visitors'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useVisitors(query: VisitorQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...VISITORS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/visitors', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useVisitor(visitorId: string, enabled = true) {
  return useApiQuery({
    key: [...VISITORS_KEY, 'visitor', visitorId],
    enabled: enabled && visitorId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/visitors/{visitorId}', {
        params: { path: { visitorId } },
        signal,
      }),
  })
}

export function useVisitorSummary(enabled = true) {
  return useApiQuery({
    key: [...VISITORS_KEY, 'summary'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/visitor-summary', { signal }),
  })
}

export function useVisitorHosts(query: VisitorHostQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...VISITORS_KEY, 'hosts', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/visitor-hosts', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useVisitorRetention(query: VisitorRetentionQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...VISITORS_KEY, 'retention', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/visitor-retention', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useVisitorSettings(enabled = true) {
  return useApiQuery({
    key: [...VISITORS_KEY, 'settings'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/visitor-settings', { signal }),
  })
}

export function useCheckInVisitor() {
  return useApiCommand({
    request: (client, body: VisitorCheckInBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/visitors', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [VISITORS_KEY],
    exclusive: true,
  })
}

export function useCheckOutVisitor() {
  return useApiCommand({
    request: (
      client,
      input: { visitorId: string; version: number; body: VisitorCheckOutBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/visitors/{visitorId}/check-out', {
        params: {
          path: { visitorId: input.visitorId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [VISITORS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useReleaseVisitorBadge() {
  return useApiCommand({
    request: (
      client,
      input: { visitorId: string; version: number; body: VisitorBadgeReleaseBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/visitors/{visitorId}/badge-release', {
        params: {
          path: { visitorId: input.visitorId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [VISITORS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useAnonymizeVisitors() {
  return useApiCommand({
    request: (client, body: VisitorAnonymizationBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/visitor-anonymizations', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [VISITORS_KEY],
    exclusive: true,
  })
}

export function useSetVisitorSettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number; body: VisitorSettingsBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/visitor-settings', {
        params: {
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [VISITORS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
