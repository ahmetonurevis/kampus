import type { operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'
import { PERSONNEL_FILES_KEY } from './use-finance-personnel-files.ts'
import { STAFF_DOCUMENTS_KEY } from './use-finance-staff-documents.ts'
import { STAFF_LEAVE_KEY } from './use-finance-staff-leave.ts'

// Personel self-servisi kancaları (`/finance/my-*`, `/finance/staff-change-requests`;
// DOM-FIN-166, ON-189). Kendi kayıtları oturumdaki üyeliktir; personel kimliği gönderilmez.
// Talep yazmaları self-servis ve özlük kartı anahtarlarını, onay ayrıca belge anahtarını tazeler.
// Pusula verisi her okumada denetime düşer ve taze oturum ister; önbelleğe alınmaz.

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
type Ok<TOperation extends keyof operations> = operations[TOperation]['responses']
type Data<TOperation extends keyof operations> =
  Ok<TOperation> extends { 200: { content: { 'application/json': { data: infer TData } } } }
    ? TData
    : never

export type OwnStaffProfile = Data<'getOwnStaffProfile'>
export type StaffChangeRequest = Data<'listStaffChangeRequests'>[number]
export type StaffChangeRequestQuery = Query<'listStaffChangeRequests'>
export type OwnChangeRequestQuery = Query<'listOwnChangeRequests'>
export type CreateOwnChangeRequestBody = JsonBody<'createOwnChangeRequest'>
export type OwnStaffDocuments = Data<'listOwnStaffDocuments'>
export type OwnLeave = Data<'getOwnLeave'>
export type CreateOwnLeaveRequestBody = JsonBody<'createOwnLeaveRequest'>
export type OwnPayslipMonth = Data<'listOwnPayslipMonths'>[number]

export const STAFF_SELF_SERVICE_KEY = ['finance', 'staff-self-service'] as const
const MESSAGES = {
  version_conflict: 'Talep başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useOwnStaffProfile(enabled = true) {
  return useApiQuery({
    key: [...STAFF_SELF_SERVICE_KEY, 'profile'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/my-staff-profile', { signal }),
  })
}

export function useOwnChangeRequests(query: OwnChangeRequestQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_SELF_SERVICE_KEY, 'own-requests', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/my-change-requests', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useOwnStaffDocuments(enabled = true) {
  return useApiQuery({
    key: [...STAFF_SELF_SERVICE_KEY, 'documents'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/my-staff-documents', { signal }),
  })
}

export function useOwnLeave(enabled = true) {
  return useApiQuery({
    key: [...STAFF_SELF_SERVICE_KEY, 'leave'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/my-leave', { params: { query: {} }, signal }),
  })
}

export function useOwnPayslipMonths(enabled = true) {
  return useApiQuery({
    key: [...STAFF_SELF_SERVICE_KEY, 'payslips'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/my-payslips', { signal }),
  })
}

/** Değişiklik talebi; IBAN talebi taze oturum ister (`reauthentication_required` çağırana). */
export function useCreateOwnChangeRequest() {
  return useApiCommand({
    request: (client, body: CreateOwnChangeRequestBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/my-change-requests', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_SELF_SERVICE_KEY],
    exclusive: true,
  })
}

/** Bekleyen talebi geri çekme; `If-Match` zorunlu. */
export function useCancelOwnChangeRequest() {
  return useApiCommand({
    request: (client, input: { requestId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/my-change-requests/{requestId}/cancel', {
        params: {
          path: { requestId: input.requestId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
      }),
    invalidates: [STAFF_SELF_SERVICE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Kendi izin talebi; `Idempotency-Key` zorunlu. */
export function useCreateOwnLeaveRequest() {
  return useApiCommand({
    request: (client, body: CreateOwnLeaveRequestBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/my-leave-requests', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_SELF_SERVICE_KEY, STAFF_LEAVE_KEY],
    exclusive: true,
  })
}

/**
 * Kendi pusulam (PDF verisi): taze oturum ister, her çağrı denetime düşer; önbelleğe alınmaz.
 * Biçim yönetici pusulasıyla aynıdır (`PayrollPayslips`), aynı PDF şablonu çizer.
 */
export function useOwnPayslip() {
  return useApiCommand({
    request: (client, input: { month: string }) =>
      client.GET('/api/v1/finance/my-payslips/{month}', {
        params: { path: { month: input.month } },
      }),
    invalidates: [],
    messages: { not_found: 'Bu ay için onaylı dönemde pusulanız yok.' },
  })
}

// --- Onay kuyruğu (yönetici) ---------------------------------------------------------------------

export function useStaffChangeRequests(query: StaffChangeRequestQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_SELF_SERVICE_KEY, 'queue', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/staff-change-requests', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Onay; kart ya da belge aynı işlemde yazılır. `If-Match` zorunlu. */
export function useApproveStaffChangeRequest() {
  return useApiCommand({
    request: (client, input: { requestId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-change-requests/{requestId}/approve', {
        params: {
          path: { requestId: input.requestId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
      }),
    invalidates: [STAFF_SELF_SERVICE_KEY, PERSONNEL_FILES_KEY, STAFF_DOCUMENTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Gerekçeli ret; `If-Match` zorunlu. */
export function useRejectStaffChangeRequest() {
  return useApiCommand({
    request: (
      client,
      input: { requestId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/staff-change-requests/{requestId}/reject', {
        params: {
          path: { requestId: input.requestId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { reason: input.reason },
      }),
    invalidates: [STAFF_SELF_SERVICE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Belge talebinin dosya bağlantısı; her açılış denetime düşer, "Aç" deyince istenir. */
export function useStaffChangeRequestFileUrlFetcher() {
  const client = useKampusClient()
  return async (requestId: string) => {
    const body = await runRequest(() =>
      client.GET('/api/v1/finance/staff-change-requests/{requestId}/file-url', {
        params: { path: { requestId } },
      }),
    )
    return body.data
  }
}
