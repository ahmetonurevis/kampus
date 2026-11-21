import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Öğretmen çalışma onayı kancaları (`/finance/work-permits`, `/finance/work-permit-teachers`;
// DOM-FIN-114, ON-174). Yalnız yönetici (K-377). Her yazma çalışma onayı anahtarının tamamını
// tazeler (takip listesi ve kayıtlar aynı veriden hesaplanır). Komutlar `exclusive`.

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

export type CreateWorkPermitBody = JsonBody<'createWorkPermit'>
export type UpdateWorkPermitBody = JsonBody<'updateWorkPermit'>
export type ApproveWorkPermitBody = JsonBody<'approveWorkPermit'>
export type RejectWorkPermitBody = JsonBody<'rejectWorkPermit'>
export type WorkPermitDetail =
  operations['getWorkPermit']['responses'][200]['content']['application/json']['data']
export type WorkPermit =
  operations['listWorkPermits']['responses'][200]['content']['application/json']['data'][number]
export type WorkPermitTeacherList =
  operations['listWorkPermitTeachers']['responses'][200]['content']['application/json']
export type WorkPermitTeacher = WorkPermitTeacherList['data'][number]
export type WorkPermitTeacherQuery = Query<'listWorkPermitTeachers'>
export type WorkPermitQuery = Query<'listWorkPermits'>

export const WORK_PERMITS_KEY = ['finance', 'work-permits'] as const
const MESSAGES = {
  version_conflict: 'Çalışma onayı kaydı başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useWorkPermitTeachers(query: WorkPermitTeacherQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...WORK_PERMITS_KEY, 'teachers', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/work-permit-teachers', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useWorkPermits(query: WorkPermitQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...WORK_PERMITS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/work-permits', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useWorkPermit(permitId: string, enabled = true) {
  return useApiQuery({
    key: [...WORK_PERMITS_KEY, 'detail', permitId],
    enabled: enabled && permitId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/work-permits/{permitId}', {
        params: { path: { permitId } },
        signal,
      }),
  })
}

export function useCreateWorkPermit() {
  return useApiCommand({
    request: (client, body: CreateWorkPermitBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/work-permits', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [WORK_PERMITS_KEY],
    exclusive: true,
  })
}

const transitionHeaders = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useUpdateWorkPermit() {
  return useApiCommand({
    request: (
      client,
      input: { permitId: string; version: number; body: UpdateWorkPermitBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/work-permits/{permitId}', {
        params: { path: { permitId: input.permitId }, header: transitionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [WORK_PERMITS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useApplyWorkPermit() {
  return useApiCommand({
    request: (
      client,
      input: { permitId: string; version: number; applicationDate: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/work-permits/{permitId}/apply', {
        params: { path: { permitId: input.permitId }, header: transitionHeaders(headers) },
        body: { applicationDate: input.applicationDate },
      }),
    invalidates: [WORK_PERMITS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useApproveWorkPermit() {
  return useApiCommand({
    request: (
      client,
      input: { permitId: string; version: number; body: ApproveWorkPermitBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/work-permits/{permitId}/approve', {
        params: { path: { permitId: input.permitId }, header: transitionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [WORK_PERMITS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useRejectWorkPermit() {
  return useApiCommand({
    request: (
      client,
      input: { permitId: string; version: number; body: RejectWorkPermitBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/work-permits/{permitId}/reject', {
        params: { path: { permitId: input.permitId }, header: transitionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [WORK_PERMITS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCancelWorkPermit() {
  return useApiCommand({
    request: (
      client,
      input: { permitId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/work-permits/{permitId}/cancel', {
        params: { path: { permitId: input.permitId }, header: transitionHeaders(headers) },
        body: { reason: input.reason },
      }),
    invalidates: [WORK_PERMITS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
