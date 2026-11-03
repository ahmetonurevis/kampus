// Ayarlar sekmelerinin (Kullanıcı & Yetkiler, İşlem Geçmişi) satır hesapları. Saf işlevlerdir:
// API satırı girer, tablo/CSV satırı çıkar. Tarihler UTC gelir, gösterim Europe/Istanbul.
import type {
  AuditEvent,
  InstitutionMember,
  MemberRole,
  MemberSort,
} from '@kampus/react-shared/institution-lists.ts'
import { z } from 'zod'
import type { StaffInvitation } from '@kampus/react-shared/staff-accounts.ts'
import {
  isStaffRole,
  STAFF_ROLES,
  staffInvitationInputSchema,
  staffRoleSchema,
  type StaffInvitationInput,
  type StaffRole,
} from '@kampus/school-core/lib/staff-accounts.ts'
import { roles } from '@kampus/school-core/modules/navigation.ts'
import { actionLabel, entityLabel, fieldsLabel } from './audit-labels.ts'

const dateTime = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** ISO anı → "30 Eki 2026 14:05" (Europe/Istanbul); geçersiz değer "—". */
export function formatInstant(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date)
}

export const ROLE_OPTIONS: ReadonlyArray<{ value: MemberRole; label: string }> = (
  ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'] as const
).map((value) => ({ value, label: roles[value].label }))

export const roleLabel = (role: string): string =>
  role in roles ? roles[role as MemberRole].label : role

export const STATUS_OPTIONS = [
  { value: 'active', label: 'Etkin' },
  { value: 'passive', label: 'Pasif' },
] as const

export const isMemberRole = (value: unknown): value is MemberRole =>
  ROLE_OPTIONS.some((option) => option.value === value)

export const isMemberStatus = (value: unknown): value is 'active' | 'passive' =>
  value === 'active' || value === 'passive'

const LINK_LABELS = { student: 'Öğrenci', child: 'Çocuk', teacher: 'Öğretmen' } as const

export type MemberRow = {
  id: string
  userId: string
  name: string
  email: string
  role: string
  roleLabel: string
  status: string
  links: string
  linkNames: string[]
  createdAt: string
  createdLabel: string
  /** Yöneticinin pasifleştirdiği personel hesabı (DOM-YTK-070); bağlı kişi pasifliği değil. */
  deactivated: boolean
  /** Personel rolü (yönetici, öğretmen, ön büro): rol ve pasifleştirme işlemleri yalnız bunlarda. */
  staff: boolean
}

export function memberRow(member: InstitutionMember): MemberRow {
  const linkNames = member.links.map((link) => link.name ?? LINK_LABELS[link.kind])
  return {
    id: member.id,
    userId: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
    roleLabel: roleLabel(member.role),
    status: member.status === 'active' ? 'Etkin' : 'Pasif',
    links: linkNames.join(', ') || '—',
    linkNames,
    createdAt: member.createdAt,
    createdLabel: formatInstant(member.createdAt),
    deactivated: member.deactivatedAt !== null,
    staff: isStaffRole(member.role),
  }
}

export const STAFF_ROLE_OPTIONS: ReadonlyArray<{ value: StaffRole; label: string }> =
  STAFF_ROLES.map((value) => ({ value, label: roles[value].label }))

/**
 * Satırın personel işlemleri (DOM-YTK-070): öğrenci ve veli hesabı kayıttan yönetilir; yönetici
 * kendi rolünü değiştiremez, kendini pasifleştiremez; pasif hesabın rolü değişmez. Son yönetici
 * kuralını sunucu uygular (422).
 */
export function staffActions(
  row: Pick<MemberRow, 'userId' | 'deactivated' | 'staff'>,
  selfUserId: string | null,
) {
  const manageable = row.staff && row.userId !== selfUserId
  return {
    changeRole: manageable && !row.deactivated,
    deactivate: manageable && !row.deactivated,
    reactivate: manageable && row.deactivated,
  }
}

export type InvitationRow = {
  id: string
  name: string
  email: string
  roleLabel: string
  createdLabel: string
  expiresLabel: string
}

export function invitationRow(invitation: StaffInvitation): InvitationRow {
  return {
    id: invitation.id,
    name: invitation.name ?? invitation.email,
    email: invitation.email,
    roleLabel: roleLabel(invitation.role),
    createdLabel: formatInstant(invitation.createdAt),
    expiresLabel: formatInstant(invitation.expiresAt),
  }
}

/** Davet formunun değerleri: öğretmen kaydı seçilmediyse boş metin. */
export type InviteFormValues = { email: string; name: string; role: StaffRole; teacherId: string }

/** Davet formu doğrulaması: e-posta ve ad kuralları core davet şemasındandır. */
export const inviteFormSchema = z.object({
  email: staffInvitationInputSchema.shape.email,
  name: staffInvitationInputSchema.shape.name,
  role: staffRoleSchema,
  teacherId: z.string(),
})

export const INVITE_DEFAULTS: InviteFormValues = {
  email: '',
  name: '',
  role: 'ogretmen',
  teacherId: '',
}

/** Form → istek gövdesi: öğretmen kaydı yalnız öğretmen rolünde ve seçildiyse gider. */
export function inviteBody(values: InviteFormValues): StaffInvitationInput {
  const teacherId = values.role === 'ogretmen' ? values.teacherId.trim() : ''
  return {
    email: values.email,
    name: values.name,
    role: values.role,
    ...(teacherId ? { teacherId } : {}),
  }
}

export const memberCsvRow = (row: MemberRow) => ({
  name: row.name,
  email: row.email,
  roleLabel: row.roleLabel,
  links: row.links,
  status: row.status,
  createdLabel: row.createdLabel,
})

/** Sütun anahtarı + yön → API sıralaması; sıralanamayan sütun `undefined`. */
export function memberSort(key: string, direction: 1 | -1): MemberSort | undefined {
  if (key !== 'name' && key !== 'role' && key !== 'createdAt') return undefined
  return direction === -1 ? `-${key}` : key
}

export type AuditRow = {
  id: string
  createdAt: string
  createdLabel: string
  action: string
  actionLabel: string
  entityType: string
  entityLabel: string
  entityId: string
  actorUserId: string
  actorName: string
  actorRole: string
  actorRoleLabel: string
  fields: string
  fieldNames: string[]
  reason: string
}

export function auditRow(event: AuditEvent): AuditRow {
  return {
    id: event.id,
    createdAt: event.createdAt,
    createdLabel: formatInstant(event.createdAt),
    action: event.action,
    actionLabel: actionLabel(event.action),
    entityType: event.entityType ?? '',
    entityLabel: entityLabel(event.entityType),
    entityId: event.entityId ?? '',
    actorUserId: event.actor?.userId ?? '',
    actorName: event.actor ? (event.actor.name ?? 'Bilinmeyen kullanıcı') : 'Sistem',
    actorRole: event.actor?.role ?? '',
    actorRoleLabel: event.actor?.role ? roleLabel(event.actor.role) : '',
    fields: fieldsLabel(event.fields),
    fieldNames: event.fields,
    reason: event.reason ?? '',
  }
}

export const auditCsvRow = (row: AuditRow) => ({
  createdLabel: row.createdLabel,
  actionLabel: row.actionLabel,
  entityLabel: row.entityLabel,
  actorName: row.actorName,
  actorRoleLabel: row.actorRoleLabel,
  fields: row.fields,
  reason: row.reason,
})

/** `YYYY-MM-DD` gün değeri mi (tarayıcı `date` girdisi); aksi halde süzgeç gönderilmez. */
export const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** Başlangıç, bitişten sonraysa API 400 verir; arayüz bu durumu kullanıcıya bildirir. */
export const reversedRange = (from: string, to: string): boolean =>
  isDay(from) && isDay(to) && from > to
