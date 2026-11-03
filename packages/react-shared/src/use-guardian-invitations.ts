import type { GuardianInvitationInput } from '@kampus/school-core/lib/guardian-invitations.ts'

import {
  cancelGuardianInvitationRequest,
  GUARDIAN_INVITATION_CANCEL_MESSAGES,
  GUARDIAN_INVITATION_COMMAND_MESSAGES,
  GUARDIAN_INVITATION_INVALIDATES,
  guardianInvitationsKey,
  inviteGuardianRequest,
  listGuardianInvitationsRequest,
} from './guardian-invitations.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Veli hesabı daveti (DOM-YTK-071): yönetici ve ön büro. `Idempotency-Key` kanca içinde yönetilir
 * (`useApiCommand`); başarıda üye listesi, davetler ve veli bağı sorguları geçersiz kılınır. Taze
 * oturum hatası (403 `reauthentication_required`) çağıranın parola penceresine bırakılır:
 * `submit(…, { silent: isReauthenticationRequired })`.
 */
export function useInviteGuardianAccount() {
  return useApiCommand({
    request: (client, body: GuardianInvitationInput, headers) =>
      inviteGuardianRequest(client, body, headers),
    invalidates: GUARDIAN_INVITATION_INVALIDATES,
    messages: GUARDIAN_INVITATION_COMMAND_MESSAGES,
  })
}

/** Bekleyen veli davetleri (yeni önce, sayfalı; yönetici ve ön büro). */
export function useGuardianInvitations(page: number, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: guardianInvitationsKey(page),
    request: (client, signal) => listGuardianInvitationsRequest(client, page, signal),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

/**
 * Bekleyen veli davetini iptal eder. Davetle açılmış hesap, üyelik ve velayet bağı korunur; yalnız
 * davet kapanır. Başarıda davetler, üyeler ve veli bağı sorguları geçersiz kılınır.
 */
export function useCancelGuardianInvitation() {
  return useApiCommand({
    request: (client, input: { invitationId: string }, headers) =>
      cancelGuardianInvitationRequest(client, input, headers),
    invalidates: GUARDIAN_INVITATION_INVALIDATES,
    messages: GUARDIAN_INVITATION_CANCEL_MESSAGES,
  })
}
