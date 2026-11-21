import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { TRANSPORT_KEY } from './use-finance-transport.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Servis seferi ve biniş-iniş kancaları (`/finance/transport/trips*`; DOM-FIN-149, ON-145).
// Başlatma ve işaret `Idempotency-Key` ile gider: belirsiz hatadan sonra aynı işaretin yeniden
// gönderimi aynı anahtarı kullanır (çift sefer ya da çift işaret yazılmaz). Kapatma `If-Match` ister.
// Her yazma sefer anahtarını tazeler (liste, özet ve veli görünümü birlikte değişir).

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

export type TransportTripMarkBody = JsonBody<'markTransportTrip'>
export type TransportTripDayRow = Ok<'listTransportTrips'>['data'][number]
export type TransportTripDetail = Ok<'getTransportTrip'>['data']
export type TransportTripRosterRow = TransportTripDetail['roster'][number]
export type MyTransportTripRow = Ok<'listMyTransportTrips'>['data'][number]
export type TransportTripDayQuery = Query<'listTransportTrips'>

export const TRANSPORT_TRIPS_KEY = [...TRANSPORT_KEY, 'trips'] as const
const MESSAGES = {
  version_conflict: 'Sefer başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useTransportTrips(query: TransportTripDayQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...TRANSPORT_TRIPS_KEY, 'day', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/transport/trips', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useTransportTrip(tripId: string, enabled = true) {
  return useApiQuery({
    key: [...TRANSPORT_TRIPS_KEY, 'trip', tripId],
    enabled: enabled && tripId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/transport/trips/{tripId}', {
        params: { path: { tripId } },
        signal,
      }),
  })
}

export function useMyTransportTrips(enabled = true) {
  return useApiQuery({
    key: [...TRANSPORT_TRIPS_KEY, 'my'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/transport/trips/my', { signal }),
  })
}

export function useStartTransportTrip() {
  return useApiCommand({
    request: (client, input: { routeId: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/transport/routes/{routeId}/trips', {
        params: {
          path: { routeId: input.routeId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: {},
      }),
    invalidates: [TRANSPORT_TRIPS_KEY],
  })
}

export function useMarkTransportTrip() {
  return useApiCommand({
    request: (
      client,
      input: { tripId: string; body: TransportTripMarkBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/transport/trips/{tripId}/marks', {
        params: {
          path: { tripId: input.tripId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [TRANSPORT_TRIPS_KEY],
  })
}

export function useCorrectTransportTrip() {
  return useApiCommand({
    request: (
      client,
      input: { tripId: string; body: TransportTripMarkBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/transport/trips/{tripId}/marks', {
        params: {
          path: { tripId: input.tripId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [TRANSPORT_TRIPS_KEY],
    exclusive: true,
  })
}

export function useCloseTransportTrip() {
  return useApiCommand({
    request: (client, input: { tripId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/transport/trips/{tripId}/close', {
        params: {
          path: { tripId: input.tripId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: {},
      }),
    invalidates: [TRANSPORT_TRIPS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}
