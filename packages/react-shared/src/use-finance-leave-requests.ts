import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { STAFF_LEAVE_KEY } from './use-finance-staff-leave.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// İzin talebi kancaları (`/finance/leave-requests`; DOM-FIN-116, ON-182). Talepler personel izin
// anahtarının altındadır: onay ve iptal kullanılmış izin kaydı ve bakiyeyi değiştirir, bu yüzden
// her yazma izin anahtarının tamamını tazeler. Komutlar `exclusive`.

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

export type LeaveRequestRow =
  operations['listLeaveRequests']['responses'][200]['content']['application/json']['data'][number]
export type LeaveRequestQuery = Query<'listLeaveRequests'>
export type LeaveRequestDetail =
  operations['getLeaveRequest']['responses'][200]['content']['application/json']['data']
export type LeaveRequestLessonView = LeaveRequestDetail['lessons'][number]
export type LeaveRequestTeacher = LeaveRequestDetail['teachers'][number]
export type LeaveRequestPreview =
  operations['previewLeaveRequest']['responses'][200]['content']['application/json']['data']
export type LeaveRequestPreviewQuery = Query<'previewLeaveRequest'>
export type CreateLeaveRequestBody = JsonBody<'createLeaveRequest'>
export type LeaveSubstituteChoice = JsonBody<'updateLeaveRequestSubstitutes'>['substitutes'][number]

export const LEAVE_REQUEST_KEY = [...STAFF_LEAVE_KEY, 'requests'] as const
const MESSAGES = {
  version_conflict: 'İzin talebi başka biri tarafından değiştirildi. Talep güncellendi.',
}

export function useLeaveRequests(query: LeaveRequestQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...LEAVE_REQUEST_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/leave-requests', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useLeaveRequest(requestId: string) {
  return useApiQuery({
    key: [...LEAVE_REQUEST_KEY, 'detail', requestId],
    enabled: requestId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/leave-requests/{requestId}', {
        params: { path: { requestId } },
        signal,
      }),
  })
}

/** Talep formu önizlemesi: etkilenen dersler, yedek adayları ve bakiye; `null` sorgu kapalı. */
export function useLeaveRequestPreview(query: LeaveRequestPreviewQuery | null) {
  return useApiQuery({
    key: [...LEAVE_REQUEST_KEY, 'preview', query],
    enabled: query !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/leave-requests/preview', {
        params: {
          query: query ?? { membershipId: '', startDate: '', endDate: '' },
        },
        signal,
      }),
  })
}

/** Talep açma; `Idempotency-Key` zorunlu. */
export function useCreateLeaveRequest() {
  return useApiCommand({
    request: (client, body: CreateLeaveRequestBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/leave-requests', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_LEAVE_KEY],
    exclusive: true,
  })
}

/** Onay; `If-Match` ve `Idempotency-Key` zorunlu (onay izin kaydı üretir). */
export function useApproveLeaveRequest() {
  return useApiCommand({
    request: (
      client,
      input: { requestId: string; version: number; allowAdvance: boolean },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/leave-requests/{requestId}/approve', {
        params: {
          path: { requestId: input.requestId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { allowAdvance: input.allowAdvance },
      }),
    invalidates: [STAFF_LEAVE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

function useDecision(verb: 'reject' | 'cancel') {
  return useApiCommand({
    request: (
      client,
      input: { requestId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST(
        verb === 'reject'
          ? '/api/v1/finance/leave-requests/{requestId}/reject'
          : '/api/v1/finance/leave-requests/{requestId}/cancel',
        {
          params: {
            path: { requestId: input.requestId },
            header: {
              'idempotency-key': headers['idempotency-key'],
              'if-match': requireIfMatch(headers),
            },
          },
          body: { reason: input.reason },
        },
      ),
    invalidates: [STAFF_LEAVE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Ret (gerekçeli). */
export const useRejectLeaveRequest = () => useDecision('reject')
/** İptal: bekleyen talep geri çekilir, onaylı talebin izin kaydı da iptal edilir. */
export const useCancelLeaveRequest = () => useDecision('cancel')

/** Derslere yedek öğretmen seçimi; `If-Match` talep sürümü. */
export function useAssignLeaveSubstitutes() {
  return useApiCommand({
    request: (
      client,
      input: { requestId: string; version: number; substitutes: LeaveSubstituteChoice[] },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/leave-requests/{requestId}/assign-substitutes', {
        params: {
          path: { requestId: input.requestId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { substitutes: input.substitutes },
      }),
    invalidates: [STAFF_LEAVE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
