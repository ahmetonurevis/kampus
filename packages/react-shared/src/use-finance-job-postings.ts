import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// İş ilanı ve başvuru havuzu kancaları (`/finance/job-*`; DOM-FIN-128, ON-177). İlan ve başvuru
// açılışı ile anonimleştirme `Idempotency-Key`, düzeltme, durum, aşama ve ayar `If-Match` ile gider.
// Her yazma anahtarın tamamını tazeler (sayılar, havuz ve saklama listesi birlikte değişir).

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

export type JobPostingBody = JsonBody<'createJobPosting'>
export type JobApplicationBody = JsonBody<'createJobApplication'>
export type JobApplicationUpdateBody = JsonBody<'updateJobApplication'>
export type JobApplicationSettingsBody = JsonBody<'setJobApplicationSettings'>
export type JobApplicationAnonymizationBody = JsonBody<'anonymizeJobApplications'>
export type JobPostingRow = Ok<'listJobPostings'>['data'][number]
export type JobApplicationRow = Ok<'listJobApplications'>['data'][number]
export type JobApplicationDetail = Ok<'getJobApplication'>['data']
export type JobPostingQuery = Query<'listJobPostings'>
export type JobApplicationQuery = Query<'listJobApplications'>
export type JobApplicationRetentionQuery = Query<'listJobApplicationRetention'>

export const JOB_POSTINGS_KEY = ['finance', 'job-postings'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useJobPostings(query: JobPostingQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...JOB_POSTINGS_KEY, 'postings', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/job-postings', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useJobApplications(query: JobApplicationQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...JOB_POSTINGS_KEY, 'applications', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/job-applications', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useJobApplication(applicationId: string, enabled = true) {
  return useApiQuery({
    key: [...JOB_POSTINGS_KEY, 'application', applicationId],
    enabled: enabled && applicationId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/job-applications/{applicationId}', {
        params: { path: { applicationId } },
        signal,
      }),
  })
}

export function useJobApplicationRetention(query: JobApplicationRetentionQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...JOB_POSTINGS_KEY, 'retention', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/job-application-retention', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useJobApplicationSettings(enabled = true) {
  return useApiQuery({
    key: [...JOB_POSTINGS_KEY, 'settings'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/job-application-settings', { signal }),
  })
}

export function useCreateJobPosting() {
  return useApiCommand({
    request: (client, body: JobPostingBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/job-postings', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [JOB_POSTINGS_KEY],
    exclusive: true,
  })
}

export function useUpdateJobPosting() {
  return useApiCommand({
    request: (
      client,
      input: { postingId: string; version: number; body: JobPostingBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/job-postings/{postingId}', {
        params: {
          path: { postingId: input.postingId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [JOB_POSTINGS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useChangeJobPostingStatus() {
  return useApiCommand({
    request: (
      client,
      input: { postingId: string; version: number; status: 'published' | 'closed' },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/job-postings/{postingId}/status', {
        params: {
          path: { postingId: input.postingId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { status: input.status },
      }),
    invalidates: [JOB_POSTINGS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateJobApplication() {
  return useApiCommand({
    request: (client, body: JobApplicationBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/job-applications', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [JOB_POSTINGS_KEY],
    exclusive: true,
  })
}

export function useUpdateJobApplication() {
  return useApiCommand({
    request: (
      client,
      input: { applicationId: string; version: number; body: JobApplicationUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/job-applications/{applicationId}', {
        params: {
          path: { applicationId: input.applicationId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [JOB_POSTINGS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useChangeJobApplicationStage() {
  return useApiCommand({
    request: (
      client,
      input: {
        applicationId: string
        version: number
        body: JsonBody<'changeJobApplicationStage'>
      },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/job-applications/{applicationId}/stage', {
        params: {
          path: { applicationId: input.applicationId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [JOB_POSTINGS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useAnonymizeJobApplications() {
  return useApiCommand({
    request: (client, body: JobApplicationAnonymizationBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/job-application-anonymizations', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [JOB_POSTINGS_KEY],
    exclusive: true,
  })
}

export function useSetJobApplicationSettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number; body: JobApplicationSettingsBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/job-application-settings', {
        params: {
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [JOB_POSTINGS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
