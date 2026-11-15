import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Ücretsiz okutma kancaları (`/finance/free-tuition/*`; DOM-FIN-026, K-268…K-271). Dönem ve
// kontenjan, aday, kurul kararı, hak (iade ve MEBBİS işareti). Yalnız yönetici.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never
type Json200<TOperation extends keyof operations> = operations[TOperation]['responses'] extends {
  200: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type CreateFreeTuitionRoundBody = JsonBody<'createFreeTuitionRound'>
export type ConfirmFreeTuitionQuotaBody = JsonBody<'confirmFreeTuitionQuota'>
export type CreateFreeTuitionApplicationBody = JsonBody<'createFreeTuitionApplication'>
export type UpdateFreeTuitionDocumentsBody = JsonBody<'updateFreeTuitionDocuments'>
export type RecordFreeTuitionBoardBody = JsonBody<'recordFreeTuitionBoard'>
export type RecordFreeTuitionMebbisBody = JsonBody<'recordFreeTuitionMebbis'>
export type PayFreeTuitionRefundBody = JsonBody<'payFreeTuitionRefund'>
export type FreeTuitionRound = Json200<'listFreeTuitionRounds'>['data'][number]
export type FreeTuitionApplication = Json200<'listFreeTuitionApplications'>['data'][number]
export type FreeTuitionAward = Json200<'listFreeTuitionAwards'>['data'][number]
export type FreeTuitionMeeting = Json200<'getFreeTuitionBoardMeeting'>['data']

const INVALIDATES = [['free-tuition']]
/** Ödenen iade gün sonuna girer (M-13). */
const DAY_CLOSING_KEY = ['payments', 'day-closing'] as const
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useFreeTuitionRounds() {
  return useFinanceListQuery({
    key: ['free-tuition', 'rounds'],
    request: (client, signal) => client.GET('/api/v1/finance/free-tuition/rounds', { signal }),
  })
}

export function useFreeTuitionApplications(
  roundId: string,
  query: { status?: FreeTuitionApplication['status']; page?: number; pageSize?: number } = {},
) {
  return useFinanceListQuery(
    {
      key: ['free-tuition', 'applications', roundId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/free-tuition/rounds/{roundId}/applications', {
          params: { path: { roundId }, query },
          signal,
        }),
    },
    { enabled: roundId !== '' },
  )
}

export function useFreeTuitionMeetings(roundId: string) {
  return useFinanceListQuery(
    {
      key: ['free-tuition', 'meetings', roundId],
      request: (client, signal) =>
        client.GET('/api/v1/finance/free-tuition/rounds/{roundId}/board-meetings', {
          params: { path: { roundId } },
          signal,
        }),
    },
    { enabled: roundId !== '' },
  )
}

export function useFreeTuitionAwards(
  query: {
    roundId?: string
    mebbis?: 'recorded' | 'unrecorded'
    refundStatus?: 'none' | 'pending' | 'paid'
    page?: number
    pageSize?: number
  } = {},
) {
  return useFinanceListQuery({
    key: ['free-tuition', 'awards', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/free-tuition/awards', { params: { query }, signal }),
  })
}

export function useCreateFreeTuitionRound() {
  return useApiCommand({
    request: (client, body: CreateFreeTuitionRoundBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/free-tuition/rounds', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useConfirmFreeTuitionQuota() {
  return useApiCommand({
    request: (
      client,
      input: { roundId: string; version: number; body: ConfirmFreeTuitionQuotaBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/free-tuition/rounds/{roundId}/confirm-quota', {
        params: { path: { roundId: input.roundId }, header: versioned(headers) },
        body: input.body,
      }),
    version: (input) => input.version,
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useCreateFreeTuitionApplication() {
  return useApiCommand({
    request: (
      client,
      input: { roundId: string; body: CreateFreeTuitionApplicationBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/free-tuition/rounds/{roundId}/applications', {
        params: {
          path: { roundId: input.roundId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useUpdateFreeTuitionDocuments() {
  return useApiCommand({
    request: (
      client,
      input: { applicationId: string; version: number; body: UpdateFreeTuitionDocumentsBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/free-tuition/applications/{applicationId}/documents', {
        params: { path: { applicationId: input.applicationId }, header: versioned(headers) },
        body: input.body,
      }),
    version: (input) => input.version,
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useRecordFreeTuitionBoard() {
  return useApiCommand({
    request: (
      client,
      input: { roundId: string; body: RecordFreeTuitionBoardBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/free-tuition/rounds/{roundId}/board-meetings', {
        params: {
          path: { roundId: input.roundId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    // Kurul kararı taksitleri kapatır: taksit, sözleşme ve gün sonu görünümleri de tazelenir.
    invalidates: [
      ...INVALIDATES,
      collectionKeyPrefix('invoices'),
      collectionKeyPrefix('contracts'),
    ],
    exclusive: true,
  })
}

export function useRecordFreeTuitionMebbis() {
  return useApiCommand({
    request: (
      client,
      input: { awardId: string; version: number; body: RecordFreeTuitionMebbisBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/free-tuition/awards/{awardId}/mebbis-record', {
        params: { path: { awardId: input.awardId }, header: versioned(headers) },
        body: input.body,
      }),
    version: (input) => input.version,
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function usePayFreeTuitionRefund() {
  return useApiCommand({
    request: (
      client,
      input: { awardId: string; version: number; body: PayFreeTuitionRefundBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/free-tuition/awards/{awardId}/pay-refund', {
        params: { path: { awardId: input.awardId }, header: versioned(headers) },
        body: input.body,
      }),
    version: (input) => input.version,
    invalidates: [...INVALIDATES, DAY_CLOSING_KEY],
    exclusive: true,
  })
}
