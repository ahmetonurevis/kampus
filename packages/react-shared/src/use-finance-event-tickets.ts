import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Etkinlik bileti ve oturma kancaları (`/finance/ticketed-events`, `/finance/event-tickets`;
// DOM-FIN-103, ON-159). Her yazma etkinlik anahtarının tamamını tazeler: bilet ayırma, ödeme,
// iptal ve giriş etkinlik özetini ve koltuk haritasını da değiştirir. Komutlar `exclusive`.

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

export type CreateTicketedEventBody = JsonBody<'createTicketedEvent'>
export type UpdateTicketedEventBody = JsonBody<'updateTicketedEvent'>
export type AllocateEventTicketsBody = JsonBody<'allocateEventTickets'>
export type PayEventTicketBody = JsonBody<'payEventTicket'>
export type TicketedEventRow =
  operations['listTicketedEvents']['responses'][200]['content']['application/json']['data'][number]
export type EventTicketRow =
  operations['listEventTickets']['responses'][200]['content']['application/json']['data'][number]
export type TicketedEventQuery = Query<'listTicketedEvents'>
export type EventTicketQuery = Query<'listEventTickets'>

export const EVENT_TICKETS_KEY = ['finance-event-tickets'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useTicketedEvents(query: TicketedEventQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...EVENT_TICKETS_KEY, 'events', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/ticketed-events', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useTicketedEvent(eventId: string) {
  return useApiQuery({
    key: [...EVENT_TICKETS_KEY, 'event', eventId],
    enabled: eventId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/ticketed-events/{eventId}', {
        params: { path: { eventId } },
        signal,
      }),
  })
}

export function useEventTickets(eventId: string, query: EventTicketQuery) {
  return useFinanceListQuery(
    {
      key: [...EVENT_TICKETS_KEY, 'tickets', eventId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/ticketed-events/{eventId}/tickets', {
          params: { path: { eventId }, query },
          signal,
        }),
    },
    { enabled: eventId !== '' },
  )
}

/** Satış listesinin CSV'si (`Accept: text/csv`); taze oturum ister, sorgu tazelenmez. */
export function useEventTicketsExport() {
  return useApiCommand({
    request: (client, input: { eventId: string; query: EventTicketQuery }) =>
      client.GET('/api/v1/finance/ticketed-events/{eventId}/tickets', {
        params: { path: { eventId: input.eventId }, query: input.query },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}

export function useCreateTicketedEvent() {
  return useApiCommand({
    request: (client, body: CreateTicketedEventBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/ticketed-events', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [EVENT_TICKETS_KEY],
    exclusive: true,
  })
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useUpdateTicketedEvent() {
  return useApiCommand({
    request: (
      client,
      input: { eventId: string; version: number; body: UpdateTicketedEventBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/ticketed-events/{eventId}', {
        params: { path: { eventId: input.eventId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [EVENT_TICKETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveTicketedEvent() {
  return useApiCommand({
    request: (client, input: { eventId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/ticketed-events/{eventId}', {
        params: { path: { eventId: input.eventId }, header: versioned(headers) },
      }),
    invalidates: [EVENT_TICKETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useAllocateEventTickets() {
  return useApiCommand({
    request: (
      client,
      input: { eventId: string; body: AllocateEventTicketsBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/ticketed-events/{eventId}/tickets', {
        params: {
          path: { eventId: input.eventId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [EVENT_TICKETS_KEY],
    exclusive: true,
  })
}

export function useCheckInEventTicket() {
  return useApiCommand({
    request: (client, input: { eventId: string; code: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/ticketed-events/{eventId}/check-in', {
        params: {
          path: { eventId: input.eventId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: { code: input.code },
      }),
    invalidates: [EVENT_TICKETS_KEY],
    exclusive: true,
  })
}

export function usePayEventTicket() {
  return useApiCommand({
    request: (
      client,
      input: { ticketId: string; body: PayEventTicketBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/event-tickets/{ticketId}/pay', {
        params: {
          path: { ticketId: input.ticketId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [EVENT_TICKETS_KEY],
    exclusive: true,
  })
}

export function useCancelEventTicket() {
  return useApiCommand({
    request: (
      client,
      input: { ticketId: string; reason: string | null },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/event-tickets/{ticketId}/cancel', {
        params: {
          path: { ticketId: input.ticketId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: { reason: input.reason },
      }),
    invalidates: [EVENT_TICKETS_KEY],
    exclusive: true,
  })
}
