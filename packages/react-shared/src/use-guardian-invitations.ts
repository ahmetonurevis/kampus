import type { GuardianInvitationInput } from '@kampus/school-core/lib/guardian-invitations.ts'

import {
  GUARDIAN_INVITATION_COMMAND_MESSAGES,
  GUARDIAN_INVITATION_INVALIDATES,
  inviteGuardianRequest,
} from './guardian-invitations.ts'
import { useApiCommand } from './use-api-command.ts'

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
