import { z } from 'zod'

import { DomainError } from './errors.ts'

/**
 * Personel hesabı yönetimi (IST-007; docs/domain/yetki-ve-kapsam.md DOM-YTK-070). Hesabı kurum
 * açar: yönetici personeli (yönetici, öğretmen, ön büro) davet eder, rolünü değiştirir,
 * pasifleştirir ve geri alır. Öğrenci ve veli hesapları kayıt aktarımıyla açılır (ON-060); bu
 * kurallar onlara uygulanmaz. Saf fonksiyonlardır: API kurum kilidi altında okuduğu üyelikleri
 * verir, karar burada verilir.
 */

export const STAFF_ROLES = ['yonetici', 'ogretmen', 'onburo'] as const
export const staffRoleSchema = z.enum(STAFF_ROLES)
export type StaffRole = z.infer<typeof staffRoleSchema>

export const STAFF_ROLE_LABELS: Readonly<Record<StaffRole, string>> = {
  yonetici: 'Yönetici',
  ogretmen: 'Öğretmen',
  onburo: 'Ön büro',
}

export function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role)
}

/** Personel e-postası: kırpılır, küçük harfe çevrilir, en çok 254 karakter. */
export const staffEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'E-posta en çok 254 karakter olabilir.')
  .pipe(z.email('Geçerli bir e-posta adresi girin.'))

/** Personel adı (davette girilen): 2–120 karakter. */
export const staffNameSchema = z
  .string()
  .trim()
  .min(2, 'Ad en az 2 karakter olmalı.')
  .max(120, 'Ad en çok 120 karakter olabilir.')

/** Ad 2–120, e-posta en çok 254 karakter; öğretmen kaydı yalnız öğretmen rolünde bağlanır. */
export const staffInvitationInputSchema = z
  .strictObject({
    // kvkk: K
    email: staffEmailSchema,
    // kvkk: K
    name: staffNameSchema,
    role: staffRoleSchema,
    teacherId: z.string().trim().min(1).max(200).optional(),
  })
  .refine((input) => input.teacherId === undefined || input.role === 'ogretmen', {
    path: ['teacherId'],
    message: 'Öğretmen kaydı yalnız öğretmen rolüne bağlanır.',
  })
export type StaffInvitationInput = z.infer<typeof staffInvitationInputSchema>

export const staffRoleChangeInputSchema = z.strictObject({ role: staffRoleSchema })
export type StaffRoleChangeInput = z.infer<typeof staffRoleChangeInputSchema>

/** Kural kararının gördüğü üyelik: kimlik, rol ve pasif olup olmadığı. */
export interface StaffMember {
  id: string
  role: string
  deactivated: boolean
}

export const STAFF_ACCOUNT_MESSAGES = {
  member_not_staff:
    'Bu işlem yalnız personel hesaplarında yapılır. Öğrenci ve veli hesapları kayıttan yönetilir.',
  self_role_change: 'Kendi rolünüzü değiştiremezsiniz.',
  self_deactivate: 'Kendi hesabınızı pasifleştiremezsiniz.',
  self_reactivate: 'Kendi hesabınızı etkinleştiremezsiniz.',
  last_admin: 'Kurumdaki son etkin yönetici düşürülemez ya da pasifleştirilemez.',
  member_deactivated: 'Pasif hesabın rolü değiştirilemez. Önce hesabı etkinleştirin.',
  member_exists: 'Bu e-posta adresi kurumda zaten kayıtlı.',
  invitation_exists: 'Bu e-posta adresine bekleyen bir davet var.',
  invitation_not_pending: 'Bu davet artık beklemede değil.',
  teacher_already_linked: 'Bu öğretmen kaydı başka bir hesaba bağlı.',
} as const satisfies Record<string, string>

export type StaffAccountErrorCode = keyof typeof STAFF_ACCOUNT_MESSAGES

function reject(code: StaffAccountErrorCode, kind: 'rule' | 'conflict' = 'rule'): never {
  throw new DomainError(code, STAFF_ACCOUNT_MESSAGES[code], { kind })
}

/** Etkin (pasif olmayan) yönetici sayısı; son yönetici kuralının ölçüsü. */
function activeAdminCount(members: readonly StaffMember[]): number {
  return members.filter((member) => member.role === 'yonetici' && !member.deactivated).length
}

/**
 * Rol değişikliği (DOM-YTK-070). Değişmeyen rol `null` döner (işlem yazmaz). Yalnız personel;
 * kişi kendi rolünü değiştiremez (yönetici kendini düşürüp kurumu yöneticisiz bırakmasın); pasif
 * hesabın rolü değişmez; son etkin yönetici başka role geçemez.
 */
export function planStaffRoleChange(input: {
  actorMembershipId: string
  target: StaffMember
  members: readonly StaffMember[]
  role: StaffRole
}): { from: StaffRole; to: StaffRole } | null {
  const { target, role } = input
  if (!isStaffRole(target.role)) reject('member_not_staff')
  if (target.role === role) return null
  if (target.id === input.actorMembershipId) reject('self_role_change')
  if (target.deactivated) reject('member_deactivated')
  if (target.role === 'yonetici' && activeAdminCount(input.members) <= 1) reject('last_admin')
  return { from: target.role, to: role }
}

/**
 * Pasifleştirme ya da geri alma (DOM-YTK-070). Durumu zaten istenen olan hesap `false` döner
 * (işlem yazmaz). Yalnız personel; kişi kendi hesabının durumunu iki yönde de değiştiremez
 * (pasifleştirilen yönetici, kurum kilidinde bekleyen kendi geri alma isteğiyle kendini geri
 * alamasın); son etkin yönetici pasifleştirilemez. Başkasını geri almada sınır yoktur.
 */
export function planStaffActivation(input: {
  actorMembershipId: string
  target: StaffMember
  members: readonly StaffMember[]
  active: boolean
}): boolean {
  const { target, active } = input
  if (!isStaffRole(target.role)) reject('member_not_staff')
  if (target.id === input.actorMembershipId) reject(active ? 'self_reactivate' : 'self_deactivate')
  if (target.deactivated === !active) return false
  if (active) return true
  if (target.role === 'yonetici' && activeAdminCount(input.members) <= 1) reject('last_admin')
  return true
}

/**
 * Davet ön koşulları: e-posta kurumda üye değil, bekleyen davet yok, bağlanacak öğretmen kaydı
 * başka hesaba bağlı değil (kayıt varlığını çağıran denetler, yoksa 404).
 */
export function assertStaffInvitation(input: {
  alreadyMember: boolean
  pendingInvitation: boolean
  teacherLinked: boolean
}): void {
  if (input.alreadyMember) reject('member_exists', 'conflict')
  if (input.pendingInvitation) reject('invitation_exists', 'conflict')
  if (input.teacherLinked) reject('teacher_already_linked', 'conflict')
}

/** Davet iptali: yalnız bekleyen davet. */
export function assertInvitationPending(status: string): void {
  if (status !== 'pending') reject('invitation_not_pending', 'conflict')
}
