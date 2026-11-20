import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Zümre toplantısı tutanağı kancaları (`/finance/department-meetings`; DOM-FIN-132, ON-217).
// Yalnız yönetici (K-451). Yeni tutanak ve karar `Idempotency-Key`; düzeltme, kesinleştirme,
// kaldırma ve takip `If-Match` ile gider. Komutlar `exclusive`.

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
  200: { content: { 'application/json': { data: infer TData } } }
}
  ? TData
  : never

export type DepartmentMeetingBody = JsonBody<'createDepartmentMeeting'>
export type DepartmentMeetingRow =
  Ok<'listDepartmentMeetings'> extends readonly (infer T)[] ? T : never
export type DepartmentMeetingQuery = Query<'listDepartmentMeetings'>
export type DepartmentMeeting = Ok<'getDepartmentMeeting'>
export type DepartmentMeetingDecision = DepartmentMeeting['decisions'][number]
export type DepartmentDecisionBody = JsonBody<'createDepartmentMeetingDecision'>
export type DepartmentDecisionFollowUpBody = JsonBody<'followUpDepartmentMeetingDecision'>
export type DepartmentDecisionQuery = Query<'listDepartmentMeetingDecisions'>
export type DepartmentDecisionRow =
  Ok<'listDepartmentMeetingDecisions'> extends readonly (infer T)[] ? T : never

export const DEPARTMENT_MEETINGS_KEY = ['finance', 'department-meetings'] as const
const MESSAGES = {
  version_conflict: 'Tutanak başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useDepartmentMeetings(query: DepartmentMeetingQuery) {
  return useFinanceListQuery({
    key: [...DEPARTMENT_MEETINGS_KEY, 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/department-meetings', { params: { query }, signal }),
  })
}

/** Tutanak ayrıntısı (gündem, katılım, numaralı kararlar). */
export function useDepartmentMeeting(meetingId: string) {
  return useApiQuery({
    key: [...DEPARTMENT_MEETINGS_KEY, 'detail', meetingId],
    enabled: meetingId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/department-meetings/{meetingId}', {
        params: { path: { meetingId } },
        signal,
      }),
  })
}

export function useDepartmentMeetingSubjects(enabled = true) {
  return useFinanceListQuery(
    {
      key: [...DEPARTMENT_MEETINGS_KEY, 'subjects'],
      request: (client, signal) =>
        client.GET('/api/v1/finance/department-meeting-subjects', { signal }),
    },
    { enabled, keepPreviousPage: false },
  )
}

/** Kesinleşmiş tutanakların kararları; `overdue: 'true'` termini geçmiş açık kararlar. */
export function useDepartmentDecisions(query: DepartmentDecisionQuery) {
  return useFinanceListQuery({
    key: [...DEPARTMENT_MEETINGS_KEY, 'decisions', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/department-meeting-decisions', { params: { query }, signal }),
  })
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useCreateDepartmentMeeting() {
  return useApiCommand({
    request: (client, body: DepartmentMeetingBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/department-meetings', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [DEPARTMENT_MEETINGS_KEY],
    exclusive: true,
  })
}

export function useUpdateDepartmentMeeting() {
  return useApiCommand({
    request: (
      client,
      input: { meetingId: string; version: number; body: DepartmentMeetingBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/department-meetings/{meetingId}', {
        params: { path: { meetingId: input.meetingId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [DEPARTMENT_MEETINGS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useFinalizeDepartmentMeeting() {
  return useApiCommand({
    request: (
      client,
      input: { meetingId: string; version: number; signedDate: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/department-meetings/{meetingId}/finalize', {
        params: { path: { meetingId: input.meetingId }, header: versioned(headers) },
        body: { signedDate: input.signedDate },
      }),
    invalidates: [DEPARTMENT_MEETINGS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateDepartmentDecision() {
  return useApiCommand({
    request: (
      client,
      input: { meetingId: string; body: DepartmentDecisionBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/department-meetings/{meetingId}/decisions', {
        params: {
          path: { meetingId: input.meetingId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [DEPARTMENT_MEETINGS_KEY],
    exclusive: true,
  })
}

export function useUpdateDepartmentDecision() {
  return useApiCommand({
    request: (
      client,
      input: {
        meetingId: string
        decisionId: string
        version: number
        body: DepartmentDecisionBody
      },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/department-meetings/{meetingId}/decisions/{decisionId}', {
        params: {
          path: { meetingId: input.meetingId, decisionId: input.decisionId },
          header: versioned(headers),
        },
        body: input.body,
      }),
    invalidates: [DEPARTMENT_MEETINGS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useRemoveDepartmentDecision() {
  return useApiCommand({
    request: (
      client,
      input: { meetingId: string; decisionId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.DELETE('/api/v1/finance/department-meetings/{meetingId}/decisions/{decisionId}', {
        params: {
          path: { meetingId: input.meetingId, decisionId: input.decisionId },
          header: versioned(headers),
        },
      }),
    invalidates: [DEPARTMENT_MEETINGS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useFollowUpDepartmentDecision() {
  return useApiCommand({
    request: (
      client,
      input: {
        meetingId: string
        decisionId: string
        version: number
        body: DepartmentDecisionFollowUpBody
      },
      headers: CommandHeaders,
    ) =>
      client.POST(
        '/api/v1/finance/department-meetings/{meetingId}/decisions/{decisionId}/follow-up',
        {
          params: {
            path: { meetingId: input.meetingId, decisionId: input.decisionId },
            header: versioned(headers),
          },
          body: input.body,
        },
      ),
    invalidates: [DEPARTMENT_MEETINGS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
