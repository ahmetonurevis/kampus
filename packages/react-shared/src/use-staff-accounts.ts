import type { StaffInvitationInput, StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'
import type { StaffImportInput } from '@kampus/school-core/lib/staff-import.ts'

import {
  cancelStaffInvitationRequest,
  changeStaffRoleRequest,
  importStaffRequest,
  inviteStaffRequest,
  setStaffActiveRequest,
  STAFF_ACCOUNT_COMMAND_MESSAGES,
  STAFF_ACCOUNTS_INVALIDATES,
  STAFF_INVITATIONS_KEY,
  STAFF_INVITATIONS_PAGE_SIZE,
  type StaffMemberTarget,
} from './staff-accounts.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Personel hesabı kancaları (IST-007, DOM-YTK-070). Yalnız yönetici; `Idempotency-Key` kanca
// içinde yönetilir (`useApiCommand`). Taze oturum hatası (403 `reauthentication_required`)
// çağıranın parola penceresine bırakılır: `submit(…, { silent: isReauthenticationRequired })`.

/** Bekleyen personel davetleri (yeni önce). */
export function useStaffInvitations(options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: [...STAFF_INVITATIONS_KEY, 'pending'],
    request: (client, signal) =>
      client.GET('/api/v1/institution-members/invitations', {
        params: { query: { page: 1, pageSize: STAFF_INVITATIONS_PAGE_SIZE } },
        signal,
      }),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

const base = {
  invalidates: STAFF_ACCOUNTS_INVALIDATES,
  messages: STAFF_ACCOUNT_COMMAND_MESSAGES,
} as const

export function useInviteStaff() {
  return useApiCommand({
    request: (client, body: StaffInvitationInput, headers) =>
      inviteStaffRequest(client, body, headers),
    ...base,
  })
}

export function useCancelStaffInvitation() {
  return useApiCommand({
    request: (client, input: { invitationId: string }, headers) =>
      cancelStaffInvitationRequest(client, input, headers),
    ...base,
  })
}

export function useChangeStaffRole() {
  return useApiCommand({
    request: (client, input: StaffMemberTarget & { role: StaffRole }, headers) =>
      changeStaffRoleRequest(client, input, headers),
    ...base,
  })
}

export function useSetStaffActive() {
  return useApiCommand({
    request: (client, input: StaffMemberTarget & { active: boolean }, headers) =>
      setStaffActiveRequest(client, input, headers),
    ...base,
  })
}

/**
 * Toplu personel aktarımı (IST-007): önizleme (`dryRun: true`) ve onay aynı kancadır; her çağrı
 * yeni istek anahtarıyla gider. Önizleme yazmaz, tazeleme zararsızdır.
 */
export function useImportStaff() {
  return useApiCommand({
    request: (client, body: StaffImportInput, headers) => importStaffRequest(client, body, headers),
    ...base,
  })
}
