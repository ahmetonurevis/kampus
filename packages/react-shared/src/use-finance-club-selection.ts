import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { CLUBS_KEY } from './use-finance-clubs.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Kulüp tercihi kancaları (`/finance/club-selection*`; DOM-FIN-150, ON-169). Dönem, tercih, kura
// ve onay `Idempotency-Key`, düzenleme ve arşiv `If-Match` ile gider. Onay kulüp üyeliklerini
// yazdığı için kulüp anahtarlarını da tazeler.

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

export type ClubSelectionPeriodBody = JsonBody<'createClubSelectionPeriod'>
export type ClubSelectionPeriodUpdateBody = JsonBody<'updateClubSelectionPeriod'>
export type ClubSelectionPreferenceBody = JsonBody<'setClubSelectionPreference'>
export type ClubSelectionPeriodRow = Ok<'listClubSelectionPeriods'>['data'][number]
export type ClubSelectionPeriodDetail = Ok<'getClubSelectionPeriod'>['data']
export type ClubSelectionPreview = Ok<'getClubSelectionAllocation'>['data']
export type MyClubSelection = Ok<'listMyClubSelections'>['data'][number]
export type ClubSelectionQuery = Query<'listClubSelectionPeriods'>

export const CLUB_SELECTION_KEY = ['finance', 'club-selection'] as const
const MESSAGES = {
  version_conflict: 'Dönem başka biri tarafından değiştirildi. Liste güncellendi.',
}
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})
const idempotent = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
})

export function useClubSelectionPeriods(query: ClubSelectionQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...CLUB_SELECTION_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/club-selection/periods', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useClubSelectionPeriod(periodId: string, enabled = true) {
  return useApiQuery({
    key: [...CLUB_SELECTION_KEY, 'period', periodId],
    enabled: enabled && periodId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/club-selection/periods/{periodId}', {
        params: { path: { periodId } },
        signal,
      }),
  })
}

export function useClubSelectionPreview(periodId: string, enabled = true) {
  return useApiQuery({
    key: [...CLUB_SELECTION_KEY, 'preview', periodId],
    enabled: enabled && periodId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/club-selection/periods/{periodId}/allocation', {
        params: { path: { periodId } },
        signal,
      }),
  })
}

export function useMyClubSelections(enabled = true) {
  return useApiQuery({
    key: [...CLUB_SELECTION_KEY, 'my'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/club-selection/my', { signal }),
  })
}

export function useCreateClubSelectionPeriod() {
  return useApiCommand({
    request: (client, body: ClubSelectionPeriodBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/club-selection/periods', {
        params: { header: idempotent(headers) },
        body,
      }),
    invalidates: [CLUB_SELECTION_KEY],
    exclusive: true,
  })
}

export function useUpdateClubSelectionPeriod() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; version: number; body: ClubSelectionPeriodUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/club-selection/periods/{periodId}', {
        params: { path: { periodId: input.periodId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [CLUB_SELECTION_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveClubSelectionPeriod() {
  return useApiCommand({
    request: (client, input: { periodId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/club-selection/periods/{periodId}', {
        params: { path: { periodId: input.periodId }, header: versioned(headers) },
      }),
    invalidates: [CLUB_SELECTION_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useSetClubSelectionPreference() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; body: ClubSelectionPreferenceBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/club-selection/periods/{periodId}/preferences', {
        params: { path: { periodId: input.periodId }, header: idempotent(headers) },
        body: input.body,
      }),
    invalidates: [CLUB_SELECTION_KEY],
    exclusive: true,
  })
}

export function useDrawClubSelection() {
  return useApiCommand({
    request: (client, input: { periodId: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/club-selection/periods/{periodId}/draw', {
        params: { path: { periodId: input.periodId }, header: idempotent(headers) },
      }),
    invalidates: [CLUB_SELECTION_KEY],
    exclusive: true,
  })
}

export function useConfirmClubSelection() {
  return useApiCommand({
    request: (client, input: { periodId: string; digest: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/club-selection/periods/{periodId}/confirm', {
        params: { path: { periodId: input.periodId }, header: idempotent(headers) },
        body: { digest: input.digest },
      }),
    invalidates: [CLUB_SELECTION_KEY, CLUBS_KEY],
    exclusive: true,
  })
}

/**
 * Yedekteki öğrenciyi kulübe elle ekler (K-507): kulüp üyeliği ucunu (`POST
 * /finance/clubs/{clubId}/members`) çağırır, yedek listesinin durumu için dönemi de tazeler.
 */
export function useAddWaitlistedMember() {
  return useApiCommand({
    request: (client, input: { clubId: string; studentId: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/clubs/{clubId}/members', {
        params: { path: { clubId: input.clubId }, header: idempotent(headers) },
        body: { studentId: input.studentId },
      }),
    invalidates: [CLUBS_KEY, CLUB_SELECTION_KEY],
  })
}
