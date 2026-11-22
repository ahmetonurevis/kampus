import { z } from 'zod'

import type {
  SocialActivityBody,
  SocialActivityRow,
  SocialActivityUpdateBody,
  SocialHourEntryBody,
  SocialHourRow,
} from '@kampus/react-shared/use-finance-social-activities.ts'
import {
  hoursLabel,
  SOCIAL_ACTIVITY_KIND_LABELS,
  SOCIAL_ACTIVITY_KINDS,
  SOCIAL_ACTIVITY_NAME_MAX,
  SOCIAL_ACTIVITY_ORGANIZATION_MAX,
  SOCIAL_ACTIVITY_PLACE_MAX,
  SOCIAL_ACTIVITY_SCOPE_LABELS,
  SOCIAL_ACTIVITY_SCOPES,
  SOCIAL_ENTRY_MAX_HOURS,
  SOCIAL_HOUR_NOTE_MAX,
  SOCIAL_HOUR_REASON_MAX,
  SOCIAL_HOUR_REASON_MIN,
  SOCIAL_HOUR_STATUS_LABELS,
  SOCIAL_PROGRESS_STATUSES,
  SOCIAL_TARGET_MAX_HOURS,
  socialAcademicYearLabel,
  type SocialProgressStatus,
} from '@kampus/school-core/lib/finance-social-activities.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

/**
 * Sosyal etkinlik saatleri sekmesinin saf mantığı (DOM-FIN-160; ON-170; K-535…K-537): etkinlik,
 * saat girişi, gerekçe ve hedef formlarının şeması, gövdesi ve tablo metinleri. Kural ayrıntısı
 * sunucudadır.
 */

export const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

export const periodText = (row: Pick<SocialActivityRow, 'startDate' | 'endDate'>) =>
  row.endDate === null
    ? `${dayText(row.startDate)} – süren`
    : row.endDate === row.startDate
      ? dayText(row.startDate)
      : `${dayText(row.startDate)} – ${dayText(row.endDate)}`

export const minutesText = (minutes: number) => hoursLabel(minutes)

export const organizationText = (
  row: Pick<SocialActivityRow, 'organizationScope' | 'organizationName'>,
) =>
  row.organizationName === null
    ? SOCIAL_ACTIVITY_SCOPE_LABELS[row.organizationScope]
    : `${SOCIAL_ACTIVITY_SCOPE_LABELS[row.organizationScope]} · ${row.organizationName}`

/** Kayıt durumu: ters kayıt ve düzeltilmiş kayıt ayrı yazılır. */
export function hourStatusText(
  row: Pick<SocialHourRow, 'kind' | 'status' | 'reversedByEntryId'>,
): string {
  if (row.kind === 'reversal') return 'Ters kayıt (düzeltme)'
  if (row.reversedByEntryId !== null) return 'Düzeltildi'
  return SOCIAL_HOUR_STATUS_LABELS[row.status]
}

export const canReverse = (row: Pick<SocialHourRow, 'kind' | 'status' | 'reversedByEntryId'>) =>
  row.kind === 'entry' && row.status === 'approved' && row.reversedByEntryId === null

export const yearOptions = (current: number) =>
  [current, current - 1, current - 2, current - 3].map((year) => ({
    value: String(year),
    label: socialAcademicYearLabel(year),
  }))

export const isProgressStatus = (value: string): value is SocialProgressStatus =>
  (SOCIAL_PROGRESS_STATUSES as readonly string[]).includes(value)

/** `12,5 / 40 saat`. */
export const progressText = (minutes: number, targetHours: number | null) =>
  targetHours === null
    ? minutesText(minutes)
    : `${minutesText(minutes).replace(' saat', '')} / ${String(targetHours)} saat`

// --- Etkinlik formu ------------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .refine((value) => value === '' || value.length >= 2, 'En az 2 karakter girin.')
    .refine((value) => value.length <= max, `En çok ${String(max)} karakter.`)

export const activityFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Etkinlik adını en az 2 karakterle yazın.')
      .max(SOCIAL_ACTIVITY_NAME_MAX, `En çok ${String(SOCIAL_ACTIVITY_NAME_MAX)} karakter.`),
    kind: z.enum(SOCIAL_ACTIVITY_KINDS, 'Türü seçin.'),
    startDate: z.string().min(1, 'Başlangıç gününü seçin.'),
    endDate: z.string(),
    location: z
      .string()
      .trim()
      .min(2, 'Yeri en az 2 karakterle yazın.')
      .max(SOCIAL_ACTIVITY_PLACE_MAX, `En çok ${String(SOCIAL_ACTIVITY_PLACE_MAX)} karakter.`),
    responsibleMembershipId: z.string().min(1, 'Sorumlu öğretmeni seçin.'),
    organizationScope: z.enum(SOCIAL_ACTIVITY_SCOPES, 'Kurum içi ya da dışı seçin.'),
    organizationName: optionalText(SOCIAL_ACTIVITY_ORGANIZATION_MAX),
    clubId: z.string(),
  })
  .superRefine((value, context) => {
    if (value.endDate !== '' && value.startDate !== '' && value.endDate < value.startDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıçtan önce olamaz.',
      })
    if (value.organizationScope === 'external' && value.organizationName.trim() === '')
      context.addIssue({
        code: 'custom',
        path: ['organizationName'],
        message: 'Kurum dışı etkinlikte kuruluş adını girin.',
      })
  })
export type ActivityFormValues = z.infer<typeof activityFormSchema>

export function activityDefaults(row?: SocialActivityRow, today = ''): ActivityFormValues {
  return {
    name: row?.name ?? '',
    kind: row?.kind ?? 'volunteering',
    startDate: row?.startDate ?? today,
    endDate: row?.endDate ?? '',
    location: row?.location ?? '',
    responsibleMembershipId: row?.responsibleMembershipId ?? '',
    organizationScope: row?.organizationScope ?? 'internal',
    organizationName: row?.organizationName ?? '',
    clubId: row?.clubId ?? '',
  }
}

export function activityCreateBody(values: ActivityFormValues): SocialActivityBody {
  const organizationName = values.organizationName.trim()
  return {
    name: values.name.trim(),
    kind: values.kind,
    startDate: values.startDate,
    endDate: values.endDate === '' ? null : values.endDate,
    location: values.location.trim(),
    responsibleMembershipId: values.responsibleMembershipId,
    organizationScope: values.organizationScope,
    organizationName: organizationName === '' ? null : organizationName,
    // Kulüp bağı yalnız kulüp çalışmasında gider.
    clubId: values.kind === 'club' && values.clubId !== '' ? values.clubId : null,
  }
}

/** Yalnız değişen alanlar; değişiklik yoksa `null`. */
export function activityUpdateBody(
  values: ActivityFormValues,
  row: SocialActivityRow,
): SocialActivityUpdateBody | null {
  const next = activityCreateBody(values)
  const body = Object.fromEntries(
    (Object.keys(next) as (keyof SocialActivityBody)[])
      .filter((key) => next[key] !== row[key])
      .map((key) => [key, next[key]]),
  ) as SocialActivityUpdateBody
  return Object.keys(body).length === 0 ? null : body
}

const ACTIVITY_FIELDS = [
  'name',
  'kind',
  'startDate',
  'endDate',
  'location',
  'responsibleMembershipId',
  'organizationScope',
  'organizationName',
  'clubId',
] as const
export function activityFormField(name: string): (typeof ACTIVITY_FIELDS)[number] | null {
  return ACTIVITY_FIELDS.find((field) => field === name) ?? null
}

export const KIND_OPTIONS = SOCIAL_ACTIVITY_KINDS.map((kind) => ({
  value: kind,
  label: SOCIAL_ACTIVITY_KIND_LABELS[kind],
}))
export const SCOPE_OPTIONS = SOCIAL_ACTIVITY_SCOPES.map((scope) => ({
  value: scope,
  label: SOCIAL_ACTIVITY_SCOPE_LABELS[scope],
}))

// --- Saat girişi ---------------------------------------------------------------------------------

/** Virgüllü ya da noktalı saat: `2,5` → 2.5; geçersizse `null`. */
export function parseHours(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d{1,2}(\.\d)?$/.test(normalized)) return null
  const hours = Number(normalized)
  if (hours < 0.5 || hours > SOCIAL_ENTRY_MAX_HOURS || (hours * 2) % 1 !== 0) return null
  return hours
}

export const entryFormSchema = z.object({
  activityDate: z.string().min(1, 'Çalışma gününü seçin.'),
  hours: z
    .string()
    .refine(
      (value) => parseHours(value) !== null,
      `Saati 0,5 ile ${String(SOCIAL_ENTRY_MAX_HOURS)} arasında, yarım saat adımıyla girin.`,
    ),
  studentIds: z.array(z.string()).min(1, 'En az bir öğrenci ekleyin.'),
  note: z
    .string()
    .trim()
    .max(SOCIAL_HOUR_NOTE_MAX, `En çok ${String(SOCIAL_HOUR_NOTE_MAX)} karakter.`),
})
export type EntryFormValues = z.infer<typeof entryFormSchema>

export function entryBody(values: EntryFormValues): SocialHourEntryBody {
  const note = values.note.trim()
  return {
    activityDate: values.activityDate,
    hours: parseHours(values.hours) ?? 0,
    studentIds: [...new Set(values.studentIds)],
    note: note === '' ? null : note,
  }
}

/** Sunucu `studentIds.<n>` hatasını öğrenci listesine, diğerlerini alanına eşler. */
export function entryFormField(name: string): keyof EntryFormValues | null {
  if (name.startsWith('studentIds')) return 'studentIds'
  return (['activityDate', 'hours', 'note'] as const).find((field) => field === name) ?? null
}

// --- Gerekçe ve hedef ----------------------------------------------------------------------------

export const reasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(
      SOCIAL_HOUR_REASON_MIN,
      `Gerekçeyi en az ${String(SOCIAL_HOUR_REASON_MIN)} karakterle yazın.`,
    )
    .max(SOCIAL_HOUR_REASON_MAX, `En çok ${String(SOCIAL_HOUR_REASON_MAX)} karakter.`),
})
export type ReasonFormValues = z.infer<typeof reasonSchema>

const targetText = (optional: boolean) =>
  z
    .string()
    .trim()
    .refine(
      (value) =>
        (optional && value === '') ||
        (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= SOCIAL_TARGET_MAX_HOURS),
      `Hedef 1 ile ${String(SOCIAL_TARGET_MAX_HOURS)} arasında tam saat olmalı.`,
    )

export const targetsFormSchema = z.object({
  totalTargetHours: targetText(false),
  yearlyTargetHours: targetText(true),
})
export type TargetsFormValues = z.infer<typeof targetsFormSchema>

export const targetsBody = (values: TargetsFormValues) => ({
  totalTargetHours: Number(values.totalTargetHours),
  yearlyTargetHours:
    values.yearlyTargetHours.trim() === '' ? null : Number(values.yearlyTargetHours),
})
