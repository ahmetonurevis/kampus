import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Servis güzergâhı kancaları (`/finance/transport/*`; DOM-FIN-142, ON-098). Araç, güzergâh ve
// atama oluşturma `Idempotency-Key`, düzenleme, arşiv ve atama kaldırma `If-Match` ile gider. Her
// yazma anahtarın tamamını tazeler (doluluk, durak sayısı ve araç özeti birlikte değişir).

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

export type TransportVehicleBody = JsonBody<'createTransportVehicle'>
export type TransportVehicleUpdateBody = JsonBody<'updateTransportVehicle'>
export type TransportRouteBody = JsonBody<'createTransportRoute'>
export type TransportRouteUpdateBody = JsonBody<'updateTransportRoute'>
export type TransportAssignBody = JsonBody<'assignTransportStudent'>
export type TransportVehicle = Ok<'listTransportVehicles'>['data'][number]
export type TransportRouteRow = Ok<'listTransportRoutes'>['data'][number]
export type TransportRouteDetail = Ok<'getTransportRoute'>['data']
export type MyTransportRow = Ok<'listMyTransport'>['data'][number]
export type TransportVehicleQuery = Query<'listTransportVehicles'>
export type TransportRouteQuery = Query<'listTransportRoutes'>

export const TRANSPORT_KEY = ['finance', 'transport'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useTransportVehicles(query: TransportVehicleQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...TRANSPORT_KEY, 'vehicles', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/transport/vehicles', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useTransportRoutes(query: TransportRouteQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...TRANSPORT_KEY, 'routes', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/transport/routes', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useTransportRoute(routeId: string, enabled = true) {
  return useApiQuery({
    key: [...TRANSPORT_KEY, 'route', routeId],
    enabled: enabled && routeId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/transport/routes/{routeId}', {
        params: { path: { routeId } },
        signal,
      }),
  })
}

export function useMyTransport(enabled = true) {
  return useApiQuery({
    key: [...TRANSPORT_KEY, 'my'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/transport/my', { signal }),
  })
}

export function useCreateTransportVehicle() {
  return useApiCommand({
    request: (client, body: TransportVehicleBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/transport/vehicles', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [TRANSPORT_KEY],
    exclusive: true,
  })
}

export function useUpdateTransportVehicle() {
  return useApiCommand({
    request: (
      client,
      input: { vehicleId: string; version: number; body: TransportVehicleUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/transport/vehicles/{vehicleId}', {
        params: { path: { vehicleId: input.vehicleId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [TRANSPORT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveTransportVehicle() {
  return useApiCommand({
    request: (client, input: { vehicleId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/transport/vehicles/{vehicleId}', {
        params: { path: { vehicleId: input.vehicleId }, header: versioned(headers) },
      }),
    invalidates: [TRANSPORT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useCreateTransportRoute() {
  return useApiCommand({
    request: (client, body: TransportRouteBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/transport/routes', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [TRANSPORT_KEY],
    exclusive: true,
  })
}

export function useUpdateTransportRoute() {
  return useApiCommand({
    request: (
      client,
      input: { routeId: string; version: number; body: TransportRouteUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/transport/routes/{routeId}', {
        params: { path: { routeId: input.routeId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [TRANSPORT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveTransportRoute() {
  return useApiCommand({
    request: (client, input: { routeId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/transport/routes/{routeId}', {
        params: { path: { routeId: input.routeId }, header: versioned(headers) },
      }),
    invalidates: [TRANSPORT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useAssignTransportStudent() {
  return useApiCommand({
    request: (
      client,
      input: { routeId: string; body: TransportAssignBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/transport/routes/{routeId}/assignments', {
        params: {
          path: { routeId: input.routeId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [TRANSPORT_KEY],
    exclusive: true,
  })
}

export function useRemoveTransportAssignment() {
  return useApiCommand({
    request: (client, input: { assignmentId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/transport/assignments/{assignmentId}', {
        params: { path: { assignmentId: input.assignmentId }, header: versioned(headers) },
      }),
    invalidates: [TRANSPORT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}
