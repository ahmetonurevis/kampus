// Ayarlar sekmelerinin (Kullanıcı & Yetkiler, İşlem Geçmişi) satır hesapları. Saf işlevlerdir:
// API satırı girer, tablo/CSV satırı çıkar. Tarihler UTC gelir, gösterim Europe/Istanbul.
import type {
  AuditEvent,
  InstitutionMember,
  MemberRole,
  MemberSort,
} from '@kampus/react-shared/institution-lists.ts'
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
