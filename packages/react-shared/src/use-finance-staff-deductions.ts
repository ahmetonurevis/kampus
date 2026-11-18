import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiMutation } from './use-api-mutation.ts'
import { useApiQuery } from './use-api-query.ts'

// Avans ve kesinti kancaları (`/finance/staff-deductions`, `/finance/staff-advances`,
// `/finance/staff-garnishments`, `/finance/staff-pension-enrollments`; DOM-FIN-101, ON-199). Bütün
// yazmalar personel listesini ve ayrıntısını tazeler. Ay için kesinti listesi `POST`'tur ama
// hiçbir şey yazmaz; net ücret kişisel veri olduğundan sorgu önbelleğine girmez, mutasyondur.

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

export type StaffDeductionStaffQuery = Query<'listStaffDeductionStaff'>
export type StaffDeductionStaff =
  operations['listStaffDeductionStaff']['responses'][200]['content']['application/json']['data'][number]
export type StaffDeductions =
  operations['getStaffDeductions']['responses'][200]['content']['application/json']['data']
export type StaffAdvance = StaffDeductions['advances'][number]
export type StaffGarnishment = StaffDeductions['garnishments'][number]
export type StaffPension = StaffDeductions['pensions'][number]
export type MonthlyDeductionBody = JsonBody<'previewStaffMonthlyDeductions'>
export type MonthlyDeductionResult =
  operations['previewStaffMonthlyDeductions']['responses'][200]['content']['application/json']['data']
export type CreateStaffAdvanceBody = JsonBody<'createStaffAdvance'>
export type CloseStaffAdvanceBody = JsonBody<'closeStaffAdvance'>
export type CancelStaffAdvanceBody = JsonBody<'cancelStaffAdvance'>
export type CreateStaffGarnishmentBody = JsonBody<'createStaffGarnishment'>
export type UpdateStaffGarnishmentBody = JsonBody<'updateStaffGarnishment'>
export type CloseStaffGarnishmentBody = JsonBody<'closeStaffGarnishment'>
export type CreateStaffPensionBody = JsonBody<'createStaffPensionEnrollment'>
export type PauseStaffPensionBody = JsonBody<'pauseStaffPensionEnrollment'>
export type OptOutStaffPensionBody = JsonBody<'optOutStaffPensionEnrollment'>

export const STAFF_DEDUCTIONS_KEY = ['finance', 'staff-deductions'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useStaffDeductionStaff(query: StaffDeductionStaffQuery, enabled = true) {
  return useApiQuery({
    key: [...STAFF_DEDUCTIONS_KEY, 'staff', query],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/staff-deductions', { params: { query }, signal }),
  })
}

export function useStaffDeductions(membershipId: string, enabled = true) {
  return useApiQuery({
    key: [...STAFF_DEDUCTIONS_KEY, 'detail', membershipId],
    enabled: enabled && membershipId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/staff-deductions/{membershipId}', {
        params: { path: { membershipId } },
        signal,
      }),
  })
}

const previewRequest = (
  client: KampusClient,
  input: { membershipId: string; body: MonthlyDeductionBody },
) =>
  client.POST('/api/v1/finance/staff-deductions/{membershipId}/month-preview', {
    params: { path: { membershipId: input.membershipId } },
    body: input.body,
  })

/** Ay için kesinti listesi (salt hesap). */
export function useMonthlyDeductionPreview() {
  return useApiMutation({ request: previewRequest })
}

const keyHeader = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versionHeaders = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useCreateStaffAdvance() {
  return useApiCommand({
    request: (client, body: CreateStaffAdvanceBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-advances', {
        params: { header: keyHeader(headers) },
        body,
      }),
    invalidates: [STAFF_DEDUCTIONS_KEY],
    exclusive: true,
  })
}

type Versioned<TBody> = { id: string; version: number; body: TBody }

export function useCloseStaffAdvance() {
  return useApiCommand({
    request: (client, input: Versioned<CloseStaffAdvanceBody>, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-advances/{advanceId}/close', {
        params: { path: { advanceId: input.id }, header: versionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_DEDUCTIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCancelStaffAdvance() {
  return useApiCommand({
    request: (client, input: Versioned<CancelStaffAdvanceBody>, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-advances/{advanceId}/cancel', {
        params: { path: { advanceId: input.id }, header: versionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_DEDUCTIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateStaffGarnishment() {
  return useApiCommand({
    request: (client, body: CreateStaffGarnishmentBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-garnishments', {
        params: { header: keyHeader(headers) },
        body,
      }),
    invalidates: [STAFF_DEDUCTIONS_KEY],
    exclusive: true,
  })
}

export function useUpdateStaffGarnishment() {
  return useApiCommand({
    request: (client, input: Versioned<UpdateStaffGarnishmentBody>, headers: CommandHeaders) =>
      client.PATCH('/api/v1/finance/staff-garnishments/{garnishmentId}', {
        params: { path: { garnishmentId: input.id }, header: versionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_DEDUCTIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCloseStaffGarnishment() {
  return useApiCommand({
    request: (client, input: Versioned<CloseStaffGarnishmentBody>, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-garnishments/{garnishmentId}/close', {
        params: { path: { garnishmentId: input.id }, header: versionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_DEDUCTIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateStaffPension() {
  return useApiCommand({
    request: (client, body: CreateStaffPensionBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-pension-enrollments', {
        params: { header: keyHeader(headers) },
        body,
      }),
    invalidates: [STAFF_DEDUCTIONS_KEY],
    exclusive: true,
  })
}

export function usePauseStaffPension() {
  return useApiCommand({
    request: (client, input: Versioned<PauseStaffPensionBody>, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-pension-enrollments/{enrollmentId}/pause', {
        params: { path: { enrollmentId: input.id }, header: versionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_DEDUCTIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useOptOutStaffPension() {
  return useApiCommand({
    request: (client, input: Versioned<OptOutStaffPensionBody>, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-pension-enrollments/{enrollmentId}/opt-out', {
        params: { path: { enrollmentId: input.id }, header: versionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_DEDUCTIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
