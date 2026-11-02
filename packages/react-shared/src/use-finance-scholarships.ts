import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Burs programı kancaları (`/finance/scholarship-programs`, `/finance/scholarship-awards`;
// DOM-FIN-025). Atama kesin kayıtta yapılır (`scholarshipProgramId`).

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateScholarshipProgramBody = JsonBody<'createScholarshipProgram'>
export type NotifyScholarshipProgramBody = JsonBody<'notifyScholarshipProgram'>
export type RecordScholarshipMebbisBody = JsonBody<'recordScholarshipMebbis'>

const INVALIDATES = [['scholarships']]
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useScholarshipPrograms(
  query: { academicYear?: number; page?: number; pageSize?: number } = {},
  options: { enabled?: boolean } = {},
) {
  return useApiQuery({
    key: ['scholarships', 'programs', query],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/scholarship-programs', { params: { query }, signal }),
  })
}

export function useScholarshipAwards(
  query: { programId?: string; page?: number; pageSize?: number } = {},
) {
  return useApiQuery({
    key: ['scholarships', 'awards', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/scholarship-awards', { params: { query }, signal }),
  })
}

export function useCreateScholarshipProgram() {
  return useApiCommand({
    request: (client, body: CreateScholarshipProgramBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/scholarship-programs', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useNotifyScholarshipProgram() {
  return useApiCommand({
    request: (
      client,
      input: { programId: string; version: number; body: NotifyScholarshipProgramBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/scholarship-programs/{programId}/notify', {
        params: { path: { programId: input.programId }, header: versioned(headers) },
        body: input.body,
      }),
    version: (input) => input.version,
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useRecordScholarshipMebbis() {
  return useApiCommand({
    request: (
      client,
      input: { awardId: string; version: number; body: RecordScholarshipMebbisBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/scholarship-awards/{awardId}/mebbis-record', {
        params: { path: { awardId: input.awardId }, header: versioned(headers) },
        body: input.body,
      }),
    version: (input) => input.version,
    invalidates: INVALIDATES,
    exclusive: true,
  })
}
