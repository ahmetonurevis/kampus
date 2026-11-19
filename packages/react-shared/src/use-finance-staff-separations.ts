import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// İşten ayrılış kancaları (`/finance/staff-separations`; DOM-FIN-118, ON-180). Yalnız yönetici
// (K-403). Dosya açılışı ve tamamlama `Idempotency-Key`, düzeltme, adım işareti, tamamlama ve iptal
// `If-Match` ile gider. Zimmet iadesi demirbaş zimmeti kancasından yapılır ve bu anahtarı da tazeler.
// Komutlar `exclusive`.

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

export type CreateStaffSeparationBody = JsonBody<'createStaffSeparation'>
export type UpdateStaffSeparationBody = JsonBody<'updateStaffSeparation'>
export type MarkStaffSeparationStepBody = JsonBody<'markStaffSeparationStep'>
export type StaffSeparationRow =
  operations['listStaffSeparations']['responses'][200]['content']['application/json']['data'][number]
export type StaffSeparationDetail =
  operations['getStaffSeparation']['responses'][200]['content']['application/json']['data']
export type StaffSeparationDocument =
  operations['getStaffSeparationDocument']['responses'][200]['content']['application/json']['data']
export type StaffSeparationQuery = Query<'listStaffSeparations'>

export const STAFF_SEPARATIONS_KEY = ['finance', 'staff-separations'] as const
const MESSAGES = {
  version_conflict: 'Ayrılış dosyası başka biri tarafından değiştirildi. Dosya güncellendi.',
}

export function useStaffSeparations(query: StaffSeparationQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_SEPARATIONS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/staff-separations', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useStaffSeparation(separationId: string) {
  return useApiQuery({
    key: [...STAFF_SEPARATIONS_KEY, 'detail', separationId],
    enabled: separationId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/staff-separations/{separationId}', {
        params: { path: { separationId } },
        signal,
      }),
  })
}

export function useCreateStaffSeparation() {
  return useApiCommand({
    request: (client, body: CreateStaffSeparationBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-separations', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_SEPARATIONS_KEY],
    exclusive: true,
  })
}

type Target = { separationId: string; version: number }
const versionedHeader = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useUpdateStaffSeparation() {
  return useApiCommand({
    request: (
      client,
      input: Target & { body: UpdateStaffSeparationBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/staff-separations/{separationId}', {
        params: { path: { separationId: input.separationId }, header: versionedHeader(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_SEPARATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useMarkStaffSeparationStep() {
  return useApiCommand({
    request: (
      client,
      input: Target & { body: MarkStaffSeparationStepBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/staff-separations/{separationId}/mark-step', {
        params: { path: { separationId: input.separationId }, header: versionedHeader(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_SEPARATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCompleteStaffSeparation() {
  return useApiCommand({
    request: (client, input: Target, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-separations/{separationId}/complete', {
        params: { path: { separationId: input.separationId }, header: versionedHeader(headers) },
        body: {},
      }),
    invalidates: [STAFF_SEPARATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCancelStaffSeparation() {
  return useApiCommand({
    request: (client, input: Target & { reason: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-separations/{separationId}/cancel', {
        params: { path: { separationId: input.separationId }, header: versionedHeader(headers) },
        body: { reason: input.reason },
      }),
    invalidates: [STAFF_SEPARATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
