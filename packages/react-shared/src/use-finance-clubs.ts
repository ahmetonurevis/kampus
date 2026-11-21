import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Kulüp kancaları (`/finance/clubs*`; DOM-FIN-142, ON-098). Kulüp, üye ve yoklama `Idempotency-Key`,
// düzenleme ve arşivler `If-Match` ile gider. Her yazma anahtarın tamamını tazeler.

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

export type ClubBody = JsonBody<'createClub'>
export type ClubUpdateBody = JsonBody<'updateClub'>
export type ClubAttendanceBody = JsonBody<'recordClubAttendance'>
export type ClubRow = Ok<'listClubs'>['data'][number]
export type ClubDetail = Ok<'getClub'>['data']
export type ClubSession = Ok<'getClubSession'>['data']
export type MyClubRow = Ok<'listMyClubs'>['data'][number]
export type ClubQuery = Query<'listClubs'>

export const CLUBS_KEY = ['finance', 'clubs'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useClubs(query: ClubQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...CLUBS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/clubs', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useClub(clubId: string, enabled = true) {
  return useApiQuery({
    key: [...CLUBS_KEY, 'club', clubId],
    enabled: enabled && clubId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/clubs/{clubId}', { params: { path: { clubId } }, signal }),
  })
}

export function useClubSession(clubId: string, sessionId: string, enabled = true) {
  return useApiQuery({
    key: [...CLUBS_KEY, 'session', clubId, sessionId],
    enabled: enabled && clubId !== '' && sessionId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/clubs/{clubId}/sessions/{sessionId}', {
        params: { path: { clubId, sessionId } },
        signal,
      }),
  })
}

export function useMyClubs(enabled = true) {
  return useApiQuery({
    key: [...CLUBS_KEY, 'my'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/clubs/my', { signal }),
  })
}

export function useCreateClub() {
  return useApiCommand({
    request: (client, body: ClubBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/clubs', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [CLUBS_KEY],
    exclusive: true,
  })
}

export function useUpdateClub() {
  return useApiCommand({
    request: (
      client,
      input: { clubId: string; version: number; body: ClubUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/clubs/{clubId}', {
        params: { path: { clubId: input.clubId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [CLUBS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveClub() {
  return useApiCommand({
    request: (client, input: { clubId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/clubs/{clubId}', {
        params: { path: { clubId: input.clubId }, header: versioned(headers) },
      }),
    invalidates: [CLUBS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useAddClubMember() {
  return useApiCommand({
    request: (client, input: { clubId: string; studentId: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/clubs/{clubId}/members', {
        params: {
          path: { clubId: input.clubId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: { studentId: input.studentId },
      }),
    invalidates: [CLUBS_KEY],
  })
}

export function useRemoveClubMember() {
  return useApiCommand({
    request: (
      client,
      input: { clubId: string; memberId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.DELETE('/api/v1/finance/clubs/{clubId}/members/{memberId}', {
        params: {
          path: { clubId: input.clubId, memberId: input.memberId },
          header: versioned(headers),
        },
      }),
    invalidates: [CLUBS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useRecordClubAttendance() {
  return useApiCommand({
    request: (
      client,
      input: { clubId: string; body: ClubAttendanceBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/clubs/{clubId}/sessions', {
        params: {
          path: { clubId: input.clubId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [CLUBS_KEY],
    exclusive: true,
  })
}

export function useArchiveClubSession() {
  return useApiCommand({
    request: (
      client,
      input: { clubId: string; sessionId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.DELETE('/api/v1/finance/clubs/{clubId}/sessions/{sessionId}', {
        params: {
          path: { clubId: input.clubId, sessionId: input.sessionId },
          header: versioned(headers),
        },
      }),
    invalidates: [CLUBS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}
