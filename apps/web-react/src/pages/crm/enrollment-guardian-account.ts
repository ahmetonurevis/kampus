import type { z } from 'zod'
import type { ApiError } from '@kampus/api-client/errors.ts'
import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import type { LearnerWords } from '@kampus/school-core/lib/enrollment-learner.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  guardianInvitationInputSchema,
  type GuardianInvitationInput,
} from '@kampus/school-core/lib/guardian-invitations.ts'
import type { GuardianInvitation } from '@kampus/react-shared/guardian-invitations.ts'

// Kesin kayıttan veli hesabı açma (ON-290; DOM-YTK-071, DOM-KAY-012, DOM-KAY-013; kullanıcı kararı
// 2026-11-03, K-05): personel veli kaydını seçer, hesabın göreceği öğrencileri işaretler. Saf
// işlevlerdir; bileşenler `GuardianAccountPanel.tsx` ve `GuardianInvitationsSection.tsx`'tedir.

/** Form doğrulaması: e-posta, ad ve öğrenci kuralları core davet şemasındandır. */
export const guardianAccountFormSchema = guardianInvitationInputSchema.pick({
  name: true,
  email: true,
  studentIds: true,
})
export type GuardianAccountFormValues = z.input<typeof guardianAccountFormSchema>

/**
 * Kurumda bu e-postayla bir hesap (veli ya da personel) zaten var. Mevcut hesabı öğrenciye
 * bağlayan web ekranı henüz yok (bağ ucu `POST /students/:studentId/guardians` `membershipId`);
 * bu yüzden ileti yöneticiye yönlendirir. Okulda "öğrenci", dil okulu ve kursta "kursiyer" der
 * (DOM-KAY-012).
 */
export function memberExistsMessage(learner: LearnerWords): string {
  return `Bu e-posta adresiyle kurumda zaten bir hesap var; ikinci hesap açılmaz. Var olan hesabın bu ${learner.dative} bağlanması için kurum yöneticisine başvurun ya da başka bir e-posta girin.`
}

/** Sunucu hata kodunun formdaki yeri; listede olmayan kod toast olur. */
const FIELD_BY_CODE: Readonly<Record<string, keyof GuardianAccountFormValues | 'root.server'>> = {
  member_exists: 'email',
  invitation_exists: 'email',
  guardian_record_not_linked: 'studentIds',
  guardian_link_exists: 'root.server',
  guardian_identity_mismatch: 'root.server',
}

/** Gövde doğrulaması (400) maddeleri alanlara kendiliğinden yazılır; burada yalnız kodlar. */
export function guardianAccountFieldFor(error: Pick<ApiError, 'code'>): string | undefined {
  return FIELD_BY_CODE[error.code]
}

/** Alan hatasının iletisi: `member_exists` yöneticiye yönlendiren metinle değişir. */
export function guardianAccountErrorMessage(
  code: string,
  message: string,
  learner: LearnerWords,
): string {
  return code === 'member_exists' ? memberExistsMessage(learner) : message
}

/** Odak verilebilecek alan mı (kök hata bir giriş değildir). */
export function focusableField(
  field: string | undefined,
): field is keyof GuardianAccountFormValues {
  return field === 'name' || field === 'email' || field === 'studentIds'
}

/** Formun ilk değerleri: ad ve e-posta veli kaydından, kayıttaki öğrenci seçili. */
export function guardianAccountDefaults(
  parent: { name?: string | null; email?: string | null } | null | undefined,
  studentId: string,
): GuardianAccountFormValues {
  return { name: parent?.name ?? '', email: parent?.email ?? '', studentIds: [studentId] }
}

/** Davet gövdesi: veli kaydı her zaman gönderilir ki velayet bağı hesaba bağlansın (DOM-YTK-071). */
export function guardianAccountBody(
  values: z.output<typeof guardianAccountFormSchema>,
  parentId: string,
): GuardianInvitationInput {
  return { name: values.name, email: values.email, studentIds: values.studentIds, parentId }
}

export interface GuardianAccountStudent {
  id: string
  name: string
}

/**
 * Seçilebilecek öğrenciler: kayıttaki öğrenci başta, sonra veli kaydına bağlı kardeşler ada göre.
 * Kardeş listesi henüz gelmediyse kayıttaki öğrenci yine seçilebilir.
 */
export function guardianAccountStudents(
  student: GuardianAccountStudent,
  siblings: readonly GuardianAccountStudent[],
): GuardianAccountStudent[] {
  const others = siblings
    .filter((row) => row.id !== student.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  return [student, ...others]
}

/** Yetişkin kursiyerin kendi satırı (`relationship: 'self'`) veli değildir; hesap açılmaz. */
export function isGuardianRecord(parent: { relationship?: string | null } | null | undefined) {
  return parent !== null && parent !== undefined && parent.relationship !== 'self'
}

/**
 * Kesin kayıt yanıtından veli kaydı: mevcut veliye bağlamada seçilen kayıt, yeni velide yazılan
 * `parents` kaydı; kursiyerin kendisi seçildiyse veli yoktur (bağ yazılmaz, DOM-KAY-012).
 */
export function enrollmentParentId(
  guardianMode: 'new' | 'existing' | 'self',
  existingParentId: string,
  records: readonly { collection: string; id: string }[],
): string | null {
  switch (guardianMode) {
    case 'self':
      return null
    case 'existing':
      return existingParentId || null
    case 'new':
      return records.find((row) => row.collection === 'parents')?.id ?? null
    default:
      return guardianMode satisfies never
  }
}

/** Veli davetini açma, listeleme ve iptal yetkisi (yönetici ve ön büro; `guardian.invite*`). */
export function canManageGuardianAccounts(role: string | null | undefined): boolean {
  const allowed: readonly string[] = WRITE_ACTION_ROLES['guardian.invite']
  return role !== null && role !== undefined && allowed.includes(role)
}

/** Öğrencinin bekleyen veli daveti var mı (rıza bilgilendirmesi hesabın açıldığını söyler). */
export function hasPendingInvitation(
  invitations: readonly Pick<GuardianInvitation, 'status' | 'studentIds'>[],
  studentId: string,
): boolean {
  return invitations.some(
    (invitation) => invitation.status === 'pending' && invitation.studentIds.includes(studentId),
  )
}

export interface GuardianInvitationRow {
  id: string
  name: string
  email: string
  studentIds: string[]
  createdLabel: string
  /** Süresi dolmuş ama bekleyen davet: yeni daveti engellemez, iptalle temizlenir. */
  expired: boolean
}

const STAMP = { year: 'numeric', hour: '2-digit', minute: '2-digit' } as const

export function guardianInvitationRow(
  invitation: GuardianInvitation,
  now: number = Date.now(),
): GuardianInvitationRow {
  const expiresAt = Date.parse(invitation.expiresAt)
  return {
    id: invitation.id,
    name: invitation.name ?? invitation.email,
    email: invitation.email,
    studentIds: invitation.studentIds,
    createdLabel: dateLabel(invitation.createdAt, STAMP),
    expired: Number.isFinite(expiresAt) && expiresAt <= now,
  }
}
