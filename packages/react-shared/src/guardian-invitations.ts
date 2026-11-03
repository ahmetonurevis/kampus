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
 * Veli hesabı daveti uçlarının (`POST|GET /institution-members/guardian-invitations`, iptal
 * `…/:invitationId/cancel`; DOM-YTK-071) saf yardımcıları: istek kurucular, Türkçe hata metinleri ve tazelenecek sorgu önekleri. Kanca
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

/** Bekleyen davet listesi sayfa boyutu (ucun üst sınırı 100). */
export const GUARDIAN_INVITATIONS_PAGE_SIZE = 25

/** Bekleyen veli davetlerinin sayfa sorgusu anahtarı (`useInviteGuardianAccount` ile aynı kök). */
export function guardianInvitationsKey(page: number) {
  return [
    ...GUARDIAN_INVITATIONS_KEY,
    'pending',
    { page, pageSize: GUARDIAN_INVITATIONS_PAGE_SIZE },
  ] as const
}

/** İptal hataları: davet zaten kapanmış ya da başka kurumun/personel daveti. */
export const GUARDIAN_INVITATION_CANCEL_MESSAGES: CommandMessages = {
  invitation_not_pending: STAFF_ACCOUNT_MESSAGES.invitation_not_pending,
  not_found: 'Davet bulunamadı. Liste güncellendi.',
}

export function listGuardianInvitationsRequest(
  client: KampusClient,
  page: number,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/institution-members/guardian-invitations', {
    params: { query: { page, pageSize: GUARDIAN_INVITATIONS_PAGE_SIZE } },
    ...(signal === undefined ? {} : { signal }),
  })
}

export function cancelGuardianInvitationRequest(
  client: KampusClient,
  input: { invitationId: string },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/institution-members/guardian-invitations/{invitationId}/cancel', {
    params: {
      path: { invitationId: input.invitationId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
  })
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
