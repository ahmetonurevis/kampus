import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Personel izin kancaları (`/finance/leave-types`, `/finance/leave-staff`, `/finance/leave-profiles`,
// `/finance/leave-records`; DOM-FIN-109, ON-181). Her yazma izin anahtarının tamamını tazeler
// (tür ayarı, profil ve kayıt bakiyeyi birlikte etkiler). Komutlar `exclusive`.

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

export type LeaveTypeView =
  operations['listLeaveTypes']['responses'][200]['content']['application/json']['data'][number]
export type CreateLeaveTypeBody = JsonBody<'createLeaveType'>
export type UpdateLeaveTypeBody = JsonBody<'updateLeaveType'>
export type LeaveStaffRow =
  operations['listLeaveStaff']['responses'][200]['content']['application/json']['data'][number]
export type LeaveStaffQuery = Query<'listLeaveStaff'>
export type LeaveStaffDetail =
  operations['getLeaveStaff']['responses'][200]['content']['application/json']['data']
export type LeaveRecordView = LeaveStaffDetail['records'][number]
export type CreateLeaveProfileBody = JsonBody<'createLeaveProfile'>
export type UpdateLeaveProfileBody = JsonBody<'updateLeaveProfile'>
export type CreateLeaveRecordBody = JsonBody<'createLeaveRecord'>

export const STAFF_LEAVE_KEY = ['finance', 'staff-leave'] as const
const MESSAGES = {
  version_conflict: 'İzin bilgisi başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useLeaveTypes(enabled = true) {
  return useApiQuery({
    key: [...STAFF_LEAVE_KEY, 'types'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/leave-types', { signal }),
  })
}

export function useLeaveStaff(query: LeaveStaffQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_LEAVE_KEY, 'staff', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/leave-staff', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Personelin profili, hak ediş dökümü, bakiyesi ve kayıtları (`date` gününe göre). */
export function useLeaveStaffDetail(membershipId: string, date: string | undefined) {
  return useApiQuery({
    key: [...STAFF_LEAVE_KEY, 'detail', membershipId, date ?? ''],
    enabled: membershipId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/leave-staff/{membershipId}', {
        params: { path: { membershipId }, query: date === undefined ? {} : { date } },
        signal,
      }),
  })
}

export function useCreateLeaveType() {
  return useApiCommand({
    request: (client, body: CreateLeaveTypeBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/leave-types', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_LEAVE_KEY],
    exclusive: true,
  })
}

export function useUpdateLeaveType() {
  return useApiCommand({
    request: (
      client,
      input: { code: string; version: number; body: UpdateLeaveTypeBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/leave-types/{code}', {
        params: {
          path: { code: input.code },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [STAFF_LEAVE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateLeaveProfile() {
  return useApiCommand({
    request: (client, body: CreateLeaveProfileBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/leave-profiles', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_LEAVE_KEY],
    exclusive: true,
  })
}

export function useUpdateLeaveProfile() {
  return useApiCommand({
    request: (
      client,
      input: { membershipId: string; version: number; body: UpdateLeaveProfileBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/leave-profiles/{membershipId}', {
        params: {
          path: { membershipId: input.membershipId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [STAFF_LEAVE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Kullanılmış izin kaydı; `Idempotency-Key` zorunlu (çift gönderim izni iki kez düşmez). */
export function useCreateLeaveRecord() {
  return useApiCommand({
    request: (client, body: CreateLeaveRecordBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/leave-records', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_LEAVE_KEY],
    exclusive: true,
  })
}

export function useCancelLeaveRecord() {
  return useApiCommand({
    request: (
      client,
      input: { recordId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/leave-records/{recordId}/cancel', {
        params: {
          path: { recordId: input.recordId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { reason: input.reason },
      }),
    invalidates: [STAFF_LEAVE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
