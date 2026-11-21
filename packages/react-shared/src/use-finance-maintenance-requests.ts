import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { FIXED_ASSETS_KEY } from './use-finance-fixed-assets.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Arıza ve bakım talebi kancaları (`/finance/maintenance-requests`; DOM-FIN-089, ON-239). Anahtar
// demirbaş anahtarının altındadır: bildirim ve çözüm demirbaş listesindeki "açık arıza" işaretini de
// değiştirir, her yazma demirbaş anahtarının tamamını tazeler. Komutlar `exclusive`.

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

export type ReportMaintenanceBody = JsonBody<'reportMaintenanceRequest'>
export type AssignMaintenanceBody = JsonBody<'assignMaintenanceRequest'>
export type ResolveMaintenanceBody = JsonBody<'resolveMaintenanceRequest'>
export type CancelMaintenanceBody = JsonBody<'cancelMaintenanceRequest'>
export type MaintenanceNoteBody = JsonBody<'startMaintenanceRequest'>
export type MaintenanceRequestRow =
  operations['listMaintenanceRequests']['responses'][200]['content']['application/json']['data'][number]
export type MaintenanceRequestDetail =
  operations['getMaintenanceRequest']['responses'][200]['content']['application/json']['data']
export type MaintenanceRequestQuery = Query<'listMaintenanceRequests'>

const MAINTENANCE_KEY = [...FIXED_ASSETS_KEY, 'maintenance'] as const
const MESSAGES = {
  version_conflict: 'Talep başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useMaintenanceRequests(query: MaintenanceRequestQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...MAINTENANCE_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/maintenance-requests', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useMaintenanceRequest(requestId: string) {
  return useApiQuery({
    key: [...MAINTENANCE_KEY, 'request', requestId],
    enabled: requestId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/maintenance-requests/{requestId}', {
        params: { path: { requestId } },
        signal,
      }),
  })
}

export function useReportMaintenance() {
  return useApiCommand({
    request: (client, body: ReportMaintenanceBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/maintenance-requests', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    exclusive: true,
  })
}

type Versioned<TBody> = { requestId: string; version: number; body: TBody }
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useAssignMaintenance() {
  return useApiCommand({
    request: (client, input: Versioned<AssignMaintenanceBody>, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/maintenance-requests/{requestId}/assign', {
        params: { path: { requestId: input.requestId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useStartMaintenance() {
  return useApiCommand({
    request: (client, input: Versioned<MaintenanceNoteBody>, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/maintenance-requests/{requestId}/start', {
        params: { path: { requestId: input.requestId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useResolveMaintenance() {
  return useApiCommand({
    request: (client, input: Versioned<ResolveMaintenanceBody>, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/maintenance-requests/{requestId}/resolve', {
        params: { path: { requestId: input.requestId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCloseMaintenance() {
  return useApiCommand({
    request: (client, input: Versioned<MaintenanceNoteBody>, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/maintenance-requests/{requestId}/close', {
        params: { path: { requestId: input.requestId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCancelMaintenance() {
  return useApiCommand({
    request: (client, input: Versioned<CancelMaintenanceBody>, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/maintenance-requests/{requestId}/cancel', {
        params: { path: { requestId: input.requestId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
