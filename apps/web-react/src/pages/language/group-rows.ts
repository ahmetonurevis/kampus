// Dil okulu grup listesinin saf yardımcıları (IST-077; DOM-DIL-008, -040…043): takvim ve doluluk
// metinleri, öğretmen etiketi, süzgeçler, CSV, rol yetkisi ve birleştirme adayları.
import { CEFR_LEVELS } from '@kampus/school-core/content/taxonomy.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  GROUP_AGE_BAND_LABELS,
  GROUP_STATUS_LABELS,
  isGroupClosed,
  WEEKDAY_LABELS,
  type GroupStatus,
} from '@kampus/school-core/lib/language-groups.ts'
import type {
  GroupListQuery,
  GroupSlot,
  LanguageGroup,
} from '@kampus/react-shared/language-groups.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { FilterField } from '@/lib/list-query.ts'
import type { ListColumn } from '@/lib/list-view.ts'
import type { RoleKey } from '@/lib/navigation.ts'
import { canManageLevel } from './course-rows.ts'

export const DELIVERY_LABELS = { in_person: 'Yüz yüze', online: 'Çevrim içi' } as const

const STATUS_TONES = {
  planned: 'amber',
  open: 'green',
  running: 'purple',
  completed: 'gray',
  cancelled: 'red',
} as const satisfies Record<GroupStatus, BadgeTone>
export const groupStatusTone = (status: GroupStatus): BadgeTone => STATUS_TONES[status]

const weekdayLabel = (weekday: number) =>
  WEEKDAY_LABELS[weekday as keyof typeof WEEKDAY_LABELS] ?? `${weekday}. gün`

/** Oturumun saat aralığı: "18:00–19:30". */
export function slotRange(slot: GroupSlot, sessionMinutes: number): string {
  const [hours = 0, minutes = 0] = slot.startTime.split(':').map(Number)
  const end = hours * 60 + minutes + sessionMinutes
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${slot.startTime}–${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`
}

/** Gün ve saate göre sıralı oturumlar: "Salı 18:00–19:30". */
export function slotLines(slots: readonly GroupSlot[], sessionMinutes: number): string[] {
  return [...slots]
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
    .map((slot) => `${weekdayLabel(slot.weekday)} ${slotRange(slot, sessionMinutes)}`)
}

export const scheduleText = (slots: readonly GroupSlot[], sessionMinutes: number) =>
  slotLines(slots, sessionMinutes).join(', ') || '—'

/** "2026-11-10" → "10 Kas 2026" (takvim günü; UTC gece yarısı İstanbul'da aynı gündür). */
export const dayText = (day: string | null | undefined) =>
  day ? dateLabel(`${day}T12:00:00.000Z`, { year: 'numeric' }) : '—'

export const periodText = (group: Pick<LanguageGroup, 'startDate' | 'endDate'>) =>
  `${dayText(group.startDate)} – ${dayText(group.endDate)}`

/** Doluluk: etkin kursiyer / kapasite; personel dışında veri yoktur. */
export function occupancyText(group: LanguageGroup): string {
  if (group.capacity === undefined) return '—'
  return `${group.activeLearners ?? 0} / ${group.capacity}`
}

export type TeacherNames = ReadonlyMap<string, string>

/**
 * Öğretmen etiketi. Kurum kullanıcı listesi yalnız yöneticide okunur; diğer rollerde kimlik
 * gösterilmez, nötr metin çıkar. Öğretmenin kendi grubunda "Siz".
 * TODO(ogretmen-adi-okuma): ön büro ve öğretmen için öğretmen adı okuma ucu gelince ad gösterilir.
 */
export function teacherLabel(
  membershipId: string | null | undefined,
  names: TeacherNames | null,
  selfMembershipId?: string,
): string {
  if (!membershipId) return 'Atanmamış'
  if (membershipId === selfMembershipId) return 'Siz'
  return names?.get(membershipId) ?? 'Atanmış öğretmen'
}

export type GroupRow = {
  id: string
  name: string
  course: string
  level: string
  status: string
  statusKey: GroupStatus
  ageBand: string
  schedule: string
  period: string
  teacher: string
  room: string
  occupancy: string
  group: LanguageGroup
}

export function groupRow(
  group: LanguageGroup,
  names: TeacherNames | null,
  selfMembershipId?: string,
): GroupRow {
  return {
    id: group.id,
    name: group.name,
    course: group.courseName,
    level: CEFR_LEVELS[group.level].label,
    status: GROUP_STATUS_LABELS[group.status],
    statusKey: group.status,
    ageBand: GROUP_AGE_BAND_LABELS[group.ageBand],
    schedule: scheduleText(group.schedule, group.sessionMinutes),
    period: periodText(group),
    teacher: teacherLabel(group.teacherMembershipId, names, selfMembershipId),
    room: group.delivery === 'online' ? DELIVERY_LABELS.online : (group.room ?? '—'),
    occupancy: occupancyText(group),
    group,
  }
}

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)

/** Liste durumundan sunucu süzgeçleri (sayfasız): CSV bütün süzülmüş sonucu bununla çeker. */
export function groupFilters(
  filters: Readonly<Record<string, unknown>>,
): Omit<GroupListQuery, 'page' | 'pageSize'> {
  const courseId = text(filters.courseId)
  const status = text(filters.status) as GroupListQuery['status']
  return {
    ...(courseId ? { courseId } : {}),
    ...(status ? { status } : {}),
  }
}

/** Liste durumundan sayfalı sunucu sorgusu (sayfa, kur ve durum süzgeci). */
export function groupQuery(state: {
  page: number
  pageSize: number
  filters: Readonly<Record<string, unknown>>
}): GroupListQuery {
  return { page: state.page, pageSize: state.pageSize, ...groupFilters(state.filters) }
}

/** Sunucu süzgeci: durum (verilmezse iptaller dışlanır). */
export const GROUP_STATUS_FILTER: FilterField = {
  key: 'status',
  label: 'Durum',
  options: Object.entries(GROUP_STATUS_LABELS).map(([value, label]) => ({ value, label })),
}

export const GROUP_CSV_COLUMNS: readonly ListColumn[] = [
  { key: 'name', label: 'Grup' },
  { key: 'course', label: 'Kur' },
  { key: 'level', label: 'Seviye' },
  { key: 'status', label: 'Durum' },
  { key: 'ageBand', label: 'Yaş bandı' },
  { key: 'schedule', label: 'Haftalık program' },
  { key: 'period', label: 'Tarih aralığı' },
  { key: 'teacher', label: 'Öğretmen' },
  { key: 'room', label: 'Derslik' },
  { key: 'occupancy', label: 'Doluluk' },
]

export function groupCsvRow(row: GroupRow): Record<string, string> {
  return Object.fromEntries(
    GROUP_CSV_COLUMNS.map((column) => [column.key, String(row[column.key as keyof GroupRow])]),
  )
}

/** CSV satırları: verilen bütün grup (sayfa dışı kalanlar dahil), ekrandaki metinlerle aynı. */
export function groupCsvRows(
  groups: readonly LanguageGroup[],
  names: TeacherNames | null,
  selfMembershipId?: string,
): Record<string, string>[] {
  return groups.map((group) => groupCsvRow(groupRow(group, names, selfMembershipId)))
}

/** Grup işlemleri: yönetici ya da seviyenin koordinatörü öğretmen; kapanmış grupta işlem yok. */
export function groupActions(
  group: Pick<LanguageGroup, 'status' | 'level'>,
  role: RoleKey | undefined,
  coordinatedLevels: ReadonlySet<string>,
) {
  const manage =
    canManageLevel(role, coordinatedLevels, group.level) && !isGroupClosed(group.status)
  return {
    edit: manage,
    open: manage && group.status === 'planned',
    cancel: manage,
    merge: manage,
  }
}

/** Yeni grup planlayabilir mi: yönetici ya da en az bir seviyenin koordinatörü. */
export const canCreateGroup = (role: RoleKey | undefined, levels: ReadonlySet<string>) =>
  role === 'yonetici' || (role === 'ogretmen' && levels.size > 0)

/** `?grup-form=` adresiyle açılan formun etkin hedefi: yazma yetkisi yoksa form açılmaz (`''`). */
export function groupFormTarget(
  target: string,
  role: RoleKey | undefined,
  levels: ReadonlySet<string>,
): string {
  return canCreateGroup(role, levels) ? target : ''
}

/**
 * Birleştirilebilecek kaynak gruplar (DOM-DIL-042): aynı kur ve yaş bandı, kapanmamış, hedefin
 * kendisi değil. Kapasite ve kursiyer çakışması sunucuda denetlenir.
 */
export function mergeCandidates(
  target: LanguageGroup,
  groups: readonly LanguageGroup[],
): LanguageGroup[] {
  return groups.filter(
    (group) =>
      group.id !== target.id &&
      group.courseId === target.courseId &&
      group.ageBand === target.ageBand &&
      !isGroupClosed(group.status),
  )
}

const slotKey = (slots: readonly GroupSlot[]) =>
  [...slots]
    .map((slot) => `${slot.weekday}@${slot.startTime}`)
    .sort()
    .join('|')

/** Gün ya da saat farklıysa kursiyer onayı gerekir (`learnersConsented`, DOM-DIL-042). */
export const mergeNeedsConsent = (
  target: Pick<LanguageGroup, 'schedule'>,
  source: Pick<LanguageGroup, 'schedule'>,
) => slotKey(target.schedule) !== slotKey(source.schedule)
