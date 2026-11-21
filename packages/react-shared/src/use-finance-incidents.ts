import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Kaza ve yaralanma tutanağı kancaları (`/finance/incident*`; DOM-FIN-146, ON-162). Açma, veli
// bildirimi ve ek not `Idempotency-Key`, düzeltme ve kesinleştirme `If-Match` ile gider. Her yazma
// anahtarın tamamını tazeler (liste ve ayrıntı birlikte değişir). Ayrıntı okuması sunucuda
// denetime düşer; önbellek kısa tutulmaz ama pencere odaklanınca yeniden okunmaz.

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

export type IncidentCreateBody = JsonBody<'createIncidentReport'>
export type IncidentUpdateBody = JsonBody<'updateIncidentReport'>
export type IncidentNotificationBody = JsonBody<'recordIncidentNotification'>
export type IncidentAddendumBody = JsonBody<'addIncidentAddendum'>
export type IncidentRow = Ok<'listIncidentReports'>['data'][number]
export type IncidentDetail = Ok<'getIncidentReport'>['data']
export type IncidentStaffMember = Ok<'listIncidentStaff'>['data'][number]
export type GuardianIncidentSummary = Ok<'listGuardianIncidentSummaries'>['data'][number]
export type IncidentQuery = Query<'listIncidentReports'>
export type IncidentStaffQuery = Query<'listIncidentStaff'>
export type GuardianIncidentQuery = Query<'listGuardianIncidentSummaries'>

export const INCIDENTS_KEY = ['finance', 'incidents'] as const
const MESSAGES = {
  version_conflict: 'Tutanak başka biri tarafından değiştirildi. Tutanak güncellendi.',
}

export function useIncidents(query: IncidentQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INCIDENTS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/incidents', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useIncident(incidentId: string, enabled = true) {
  return useApiQuery({
    key: [...INCIDENTS_KEY, 'incident', incidentId],
    enabled: enabled && incidentId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/incidents/{incidentId}', {
        params: { path: { incidentId } },
        signal,
      }),
  })
}

export function useIncidentStaff(query: IncidentStaffQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INCIDENTS_KEY, 'staff', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/incident-staff', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useGuardianIncidentSummaries(query: GuardianIncidentQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INCIDENTS_KEY, 'summaries', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/incident-summaries', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useCreateIncident() {
  return useApiCommand({
    request: (client, body: IncidentCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/incidents', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [INCIDENTS_KEY],
    exclusive: true,
  })
}

export function useUpdateIncident() {
  return useApiCommand({
    request: (
      client,
      input: { incidentId: string; version: number; body: IncidentUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/incidents/{incidentId}', {
        params: {
          path: { incidentId: input.incidentId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [INCIDENTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useFinalizeIncident() {
  return useApiCommand({
    request: (client, input: { incidentId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/incidents/{incidentId}/finalize', {
        params: {
          path: { incidentId: input.incidentId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: {},
      }),
    invalidates: [INCIDENTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useRecordIncidentNotification() {
  return useApiCommand({
    request: (
      client,
      input: { incidentId: string; body: IncidentNotificationBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/incidents/{incidentId}/notifications', {
        params: {
          path: { incidentId: input.incidentId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [INCIDENTS_KEY],
    exclusive: true,
  })
}

export function useAddIncidentAddendum() {
  return useApiCommand({
    request: (
      client,
      input: { incidentId: string; body: IncidentAddendumBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/incidents/{incidentId}/addenda', {
        params: {
          path: { incidentId: input.incidentId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [INCIDENTS_KEY],
    exclusive: true,
  })
}
