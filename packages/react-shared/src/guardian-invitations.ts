import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components } from '@kampus/api-client/schema.d.ts'
import {
  GUARDIAN_INVITATION_MESSAGES,
  type GuardianInvitationInput,
} from '@kampus/school-core/lib/guardian-invitations.ts'
import { STAFF_ACCOUNT_MESSAGES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { CommandHeaders, CommandMessages } from './commands.ts'
import { INSTITUTION_MEMBERS_KEY_ROOT } from './institution-lists.ts'

/**
 * Veli hesabı daveti ucunun (`POST /institution-members/guardian-invitations`; DOM-YTK-071) saf
 * yardımcıları: istek kurucu, Türkçe hata metinleri ve tazelenecek sorgu önekleri. Kanca
 * `use-guardian-invitations.ts`'tedir; burası React olmadan sahte istemciyle sınanır. Uç taze
 * oturum ister; 403 `reauthentication_required` çağıranın parola penceresine gider.
 */

export type GuardianInvitation = components['schemas']['GuardianInvitation']

/** Veli bağı sorgularının kökü (`/students/:studentId/guardians`). */
export const STUDENT_GUARDIANS_KEY_ROOT = 'student-guardians'

export function studentGuardiansKey(studentId: string) {
  return [STUDENT_GUARDIANS_KEY_ROOT, studentId] as const
}

/** Veli davetleri üyelerle aynı kökte; bir davet üyeleri, davetleri ve veli bağlarını tazeler. */
export const GUARDIAN_INVITATIONS_KEY = [
  INSTITUTION_MEMBERS_KEY_ROOT,
  'guardian-invitations',
] as const
export const GUARDIAN_INVITATION_INVALIDATES = [
  [INSTITUTION_MEMBERS_KEY_ROOT],
  [STUDENT_GUARDIANS_KEY_ROOT],
] as const

export const GUARDIAN_INVITATION_COMMAND_MESSAGES: CommandMessages = {
  member_exists: `${STAFF_ACCOUNT_MESSAGES.member_exists} Mevcut veli hesabını öğrencinin veli bağından bağlayın.`,
  invitation_exists: STAFF_ACCOUNT_MESSAGES.invitation_exists,
  ...GUARDIAN_INVITATION_MESSAGES,
  guardian_identity_mismatch: 'Veli kaydı başka bir veli hesabıyla eşleşmiş.',
  not_found: 'Öğrenci ya da veli kaydı bulunamadı. Liste güncellendi.',
}

export function inviteGuardianRequest(
  client: KampusClient,
  body: GuardianInvitationInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/institution-members/guardian-invitations', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}
