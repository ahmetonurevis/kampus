import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Mesleki gelişim kataloğu kancaları (`/finance/professional-development`; DOM-FIN-125, ON-214).
// Yönetici yazar, ön büro yayındaki eğitimleri okur (K-430). Yeni eğitim ve atama
// `Idempotency-Key`, düzeltme ve durumlar `If-Match` ile gider. Komutlar `exclusive`.

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

export type ProfessionalDevelopmentProgramBody = JsonBody<'createProfessionalDevelopmentProgram'>
export type ProfessionalDevelopmentProgram =
  operations['listProfessionalDevelopmentPrograms']['responses'][200]['content']['application/json']['data'][number]
export type ProfessionalDevelopmentProgramQuery = Query<'listProfessionalDevelopmentPrograms'>
export type ProfessionalDevelopmentEnrollment =
  operations['listProfessionalDevelopmentEnrollments']['responses'][200]['content']['application/json']['data'][number]
export type ProfessionalDevelopmentEnrollmentQuery = Query<'listProfessionalDevelopmentEnrollments'>
export type ProfessionalDevelopmentEnrollmentBody =
  JsonBody<'createProfessionalDevelopmentEnrollment'>
export type ProfessionalDevelopmentAttendanceBody =
  JsonBody<'updateProfessionalDevelopmentEnrollment'>

export const PROFESSIONAL_DEVELOPMENT_KEY = ['finance', 'professional-development'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useProfessionalDevelopmentPrograms(query: ProfessionalDevelopmentProgramQuery) {
  return useFinanceListQuery({
    key: [...PROFESSIONAL_DEVELOPMENT_KEY, 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/professional-development', { params: { query }, signal }),
  })
}

export function useProfessionalDevelopmentEnrollments(
  programId: string,
  query: ProfessionalDevelopmentEnrollmentQuery,
) {
  return useFinanceListQuery({
    key: [...PROFESSIONAL_DEVELOPMENT_KEY, 'enrollments', programId, query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/professional-development/{programId}/enrollments', {
        params: { path: { programId }, query },
        signal,
      }),
  })
}

export function useCreateProfessionalDevelopmentProgram() {
  return useApiCommand({
    request: (client, body: ProfessionalDevelopmentProgramBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/professional-development', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [PROFESSIONAL_DEVELOPMENT_KEY],
    exclusive: true,
  })
}

export function useUpdateProfessionalDevelopmentProgram() {
  return useApiCommand({
    request: (
      client,
      input: { programId: string; version: number; body: ProfessionalDevelopmentProgramBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/professional-development/{programId}', {
        params: {
          path: { programId: input.programId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [PROFESSIONAL_DEVELOPMENT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useChangeProfessionalDevelopmentStatus() {
  return useApiCommand({
    request: (
      client,
      input: { programId: string; version: number; status: 'published' | 'archived' },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/professional-development/{programId}/status', {
        params: {
          path: { programId: input.programId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { status: input.status },
      }),
    invalidates: [PROFESSIONAL_DEVELOPMENT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateProfessionalDevelopmentEnrollment() {
  return useApiCommand({
    request: (
      client,
      input: { programId: string; body: ProfessionalDevelopmentEnrollmentBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/professional-development/{programId}/enrollments', {
        params: {
          path: { programId: input.programId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [PROFESSIONAL_DEVELOPMENT_KEY],
    exclusive: true,
  })
}

export function useUpdateProfessionalDevelopmentEnrollment() {
  return useApiCommand({
    request: (
      client,
      input: {
        programId: string
        enrollmentId: string
        version: number
        body: ProfessionalDevelopmentAttendanceBody
      },
      headers: CommandHeaders,
    ) =>
      client.PATCH(
        '/api/v1/finance/professional-development/{programId}/enrollments/{enrollmentId}',
        {
          params: {
            path: { programId: input.programId, enrollmentId: input.enrollmentId },
            header: {
              'idempotency-key': headers['idempotency-key'],
              'if-match': requireIfMatch(headers),
            },
          },
          body: input.body,
        },
      ),
    invalidates: [PROFESSIONAL_DEVELOPMENT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
