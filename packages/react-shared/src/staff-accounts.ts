import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components } from '@kampus/api-client/schema.d.ts'
import {
  STAFF_ACCOUNT_MESSAGES,
  type StaffInvitationInput,
  type StaffRole,
} from '@kampus/school-core/lib/staff-accounts.ts'

import type { CommandHeaders, CommandMessages } from './commands.ts'
import { INSTITUTION_MEMBERS_KEY_ROOT } from './institution-lists.ts'

/**
 * Personel hesabı uçlarının (`/institution-members/invitations`, `…/:membershipId/role|deactivate|
 * reactivate`; IST-007, DOM-YTK-070) saf yardımcıları: istek kurucular, Türkçe hata metinleri ve
 * sorgu anahtarı. Kancalar `use-staff-accounts.ts`'tedir; burası React olmadan sahte istemciyle
 * sınanır. Uçlar taze oturum ister; 403 `reauthentication_required` çağıranın parola penceresine
 * gider (web `useReauthRetry`).
 */

export type StaffInvitation = components['schemas']['StaffInvitation']

/** Bekleyen davetler üyelerle aynı kökte: bir yazma ikisini birlikte tazeler. */
export const STAFF_INVITATIONS_KEY = [INSTITUTION_MEMBERS_KEY_ROOT, 'invitations'] as const
export const STAFF_ACCOUNTS_INVALIDATES = [[INSTITUTION_MEMBERS_KEY_ROOT]] as const

/** Bekleyen davet listesi tek sayfada (ucun üst sınırı 100): kurumda aynı anda az davet bekler. */
export const STAFF_INVITATIONS_PAGE_SIZE = 100

export const STAFF_ACCOUNT_COMMAND_MESSAGES: CommandMessages = {
  ...STAFF_ACCOUNT_MESSAGES,
  not_found: 'Kayıt bulunamadı. Liste güncellendi.',
}

export interface StaffMemberTarget {
  membershipId: string
}

export function inviteStaffRequest(
  client: KampusClient,
  body: StaffInvitationInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/institution-members/invitations', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export function cancelStaffInvitationRequest(
  client: KampusClient,
  input: { invitationId: string },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/institution-members/invitations/{invitationId}/cancel', {
    params: {
      path: { invitationId: input.invitationId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
  })
}

export function changeStaffRoleRequest(
  client: KampusClient,
  input: StaffMemberTarget & { role: StaffRole },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/institution-members/{membershipId}/role', {
    params: {
      path: { membershipId: input.membershipId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body: { role: input.role },
  })
}

export function setStaffActiveRequest(
  client: KampusClient,
  input: StaffMemberTarget & { active: boolean },
  headers: CommandHeaders,
) {
  const options = {
    params: {
      path: { membershipId: input.membershipId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
  }
  return input.active
    ? client.POST('/api/v1/institution-members/{membershipId}/reactivate', options)
    : client.POST('/api/v1/institution-members/{membershipId}/deactivate', options)
}
