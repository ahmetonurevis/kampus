import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Okul sağlığı taraması kancaları (`/finance/health-screenings*`; DOM-FIN-153, ON-163). Oturum ve
// toplu sonuç girişi `Idempotency-Key`; düzeltme ve yayımlama `If-Match` ile gider. Her yazma
// anahtarın tamamını tazeler (liste, ayrıntı ve rapor birlikte değişir). Ölçüm dönen okumalar
// (ayrıntı, veli sonuçları) sunucuda denetime düşer.

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

export type HealthScreeningCreateBody = JsonBody<'createHealthScreening'>
export type HealthScreeningUpdateBody = JsonBody<'updateHealthScreening'>
export type HealthScreeningResultsBody = JsonBody<'recordHealthScreeningResults'>
export type HealthScreeningResultItemBody = HealthScreeningResultsBody['results'][number]
export type HealthScreeningRow = Ok<'listHealthScreenings'>['data'][number]
export type HealthScreeningDetail = Ok<'getHealthScreening'>['data']
export type HealthScreeningStudentRow = HealthScreeningDetail['students'][number]
export type HealthScreeningReport = Ok<'getHealthScreeningReport'>['data']
export type HealthScreeningClass = Ok<'listHealthScreeningClasses'>['data'][number]
export type HealthScreeningStaffMember = Ok<'listHealthScreeningStaff'>['data'][number]
export type GuardianHealthScreeningResult = Ok<'listGuardianHealthScreeningResults'>['data'][number]
export type HealthScreeningQuery = Query<'listHealthScreenings'>
export type HealthScreeningStaffQuery = Query<'listHealthScreeningStaff'>
export type HealthScreeningClassQuery = Query<'listHealthScreeningClasses'>
export type GuardianHealthScreeningQuery = Query<'listGuardianHealthScreeningResults'>

export const HEALTH_SCREENING_KEY = ['finance', 'health-screenings'] as const
const SESSION_MESSAGES = {
  version_conflict: 'Tarama başka biri tarafından değiştirildi. Tarama güncellendi.',
}
const RESULT_MESSAGES = {
  version_conflict: 'Bir sonuç başka biri tarafından değiştirildi. Liste güncellendi.',
  health_screening_result_exists:
    'Bir öğrencinin sonucu başka biri tarafından girildi. Liste güncellendi.',
}

export function useHealthScreenings(query: HealthScreeningQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...HEALTH_SCREENING_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/health-screenings', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useHealthScreening(sessionId: string, enabled = true) {
  return useApiQuery({
    key: [...HEALTH_SCREENING_KEY, 'detail', sessionId],
    enabled: enabled && sessionId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/health-screenings/{sessionId}', {
        params: { path: { sessionId } },
        signal,
      }),
  })
}

export function useHealthScreeningReport(sessionId: string, enabled = true) {
  return useApiQuery({
    key: [...HEALTH_SCREENING_KEY, 'report', sessionId],
    enabled: enabled && sessionId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/health-screenings/{sessionId}/report', {
        params: { path: { sessionId } },
        signal,
      }),
  })
}

export function useHealthScreeningClasses(query: HealthScreeningClassQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...HEALTH_SCREENING_KEY, 'classes', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/health-screening-classes', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useHealthScreeningStaff(query: HealthScreeningStaffQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...HEALTH_SCREENING_KEY, 'staff', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/health-screening-staff', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useGuardianHealthScreeningResults(
  query: GuardianHealthScreeningQuery,
  enabled = true,
) {
  return useFinanceListQuery(
    {
      key: [...HEALTH_SCREENING_KEY, 'mine', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/health-screening-results', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useCreateHealthScreening() {
  return useApiCommand({
    request: (client, body: HealthScreeningCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/health-screenings', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [HEALTH_SCREENING_KEY],
    exclusive: true,
  })
}

export function useUpdateHealthScreening() {
  return useApiCommand({
    request: (
      client,
      input: { sessionId: string; version: number; body: HealthScreeningUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/health-screenings/{sessionId}', {
        params: {
          path: { sessionId: input.sessionId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [HEALTH_SCREENING_KEY],
    version: (input) => input.version,
    messages: SESSION_MESSAGES,
    exclusive: true,
  })
}

export function useRecordHealthScreeningResults() {
  return useApiCommand({
    request: (
      client,
      input: { sessionId: string; body: HealthScreeningResultsBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/health-screenings/{sessionId}/results', {
        params: {
          path: { sessionId: input.sessionId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [HEALTH_SCREENING_KEY],
    refreshOn: (error) => error.code === 'health_screening_result_exists',
    messages: RESULT_MESSAGES,
  })
}

export function usePublishHealthScreening() {
  return useApiCommand({
    request: (client, input: { sessionId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/health-screenings/{sessionId}/publish', {
        params: {
          path: { sessionId: input.sessionId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: {},
      }),
    invalidates: [HEALTH_SCREENING_KEY],
    version: (input) => input.version,
    messages: SESSION_MESSAGES,
    exclusive: true,
  })
}
