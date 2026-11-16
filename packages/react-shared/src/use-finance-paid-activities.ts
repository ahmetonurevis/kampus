import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Gezi ve etkinlik ücreti kancaları (`/finance/paid-activities…`,
// `/finance/paid-activity-participants…`; DOM-FIN-098, ON-142). Katılım ve iptaller taksit yazar:
// taksit görünümleri de tazelenir; iade ödemesi gün sonuna girer.

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

export type CreatePaidActivityBody = JsonBody<'createPaidActivity'>
export type CancelPaidActivityBody = JsonBody<'cancelPaidActivity'>
export type PayPaidActivityRefundBody = JsonBody<'payPaidActivityRefund'>
export type PaidActivityRow =
  operations['listPaidActivities']['responses'][200]['content']['application/json']['data'][number]
export type PaidActivityQuery = Query<'listPaidActivities'>
export type PaidActivityParticipant =
  operations['listPaidActivityParticipants']['responses'][200]['content']['application/json']['data'][number]
export type PaidActivityParticipantQuery = Query<'listPaidActivityParticipants'>

export const PAID_ACTIVITIES_KEY = ['finance-paid-activities'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}
/** Ödenen iade gün sonuna girer (M-13). */
const DAY_CLOSING_KEY = ['payments', 'day-closing'] as const
const INVOICE_KEYS = [PAID_ACTIVITIES_KEY, collectionKeyPrefix('invoices')]
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function usePaidActivities(query: PaidActivityQuery) {
  return useFinanceListQuery({
    key: [...PAID_ACTIVITIES_KEY, 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/paid-activities', { params: { query }, signal }),
  })
}

export function usePaidActivityParticipants(
  activityId: string,
  query: PaidActivityParticipantQuery,
) {
  return useFinanceListQuery(
    {
      key: [...PAID_ACTIVITIES_KEY, 'participants', activityId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/paid-activities/{activityId}/participants', {
          params: { path: { activityId }, query },
          signal,
        }),
    },
    { enabled: activityId !== '' },
  )
}

export function useCreatePaidActivity() {
  return useApiCommand({
    request: (client, body: CreatePaidActivityBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/paid-activities', {
        params: { header: keyOnly(headers) },
        body,
      }),
    invalidates: [PAID_ACTIVITIES_KEY],
    exclusive: true,
  })
}

export function useCancelPaidActivity() {
  return useApiCommand({
    request: (
      client,
      input: { activityId: string; version: number; body: CancelPaidActivityBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/paid-activities/{activityId}/cancel', {
        params: { path: { activityId: input.activityId }, header: versioned(headers) },
        body: input.body,
      }),
    version: (input) => input.version,
    invalidates: INVOICE_KEYS,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useJoinPaidActivity() {
  return useApiCommand({
    request: (client, input: { activityId: string; studentId: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/paid-activities/{activityId}/participants', {
        params: { path: { activityId: input.activityId }, header: keyOnly(headers) },
        body: { studentId: input.studentId },
      }),
    invalidates: INVOICE_KEYS,
    exclusive: true,
  })
}

export function useCancelPaidActivityParticipation() {
  return useApiCommand({
    request: (client, input: { participantId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/paid-activity-participants/{participantId}/cancel', {
        params: { path: { participantId: input.participantId }, header: versioned(headers) },
      }),
    version: (input) => input.version,
    invalidates: INVOICE_KEYS,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function usePayPaidActivityRefund() {
  return useApiCommand({
    request: (
      client,
      input: { participantId: string; version: number; body: PayPaidActivityRefundBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/paid-activity-participants/{participantId}/pay-refund', {
        params: { path: { participantId: input.participantId }, header: versioned(headers) },
        body: input.body,
      }),
    version: (input) => input.version,
    invalidates: [PAID_ACTIVITIES_KEY, DAY_CLOSING_KEY],
    messages: MESSAGES,
    exclusive: true,
  })
}
