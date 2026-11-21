import { z } from 'zod'

import type {
  IncidentCreateBody,
  IncidentDetail,
  IncidentRow,
  IncidentUpdateBody,
} from '@kampus/react-shared/use-finance-incidents.ts'
import {
  INCIDENT_ADDENDUM_MAX,
  INCIDENT_ADDENDUM_MIN,
  INCIDENT_BODY_PARTS_MAX,
  INCIDENT_DESCRIPTION_MAX,
  INCIDENT_DESCRIPTION_MIN,
  INCIDENT_FIRST_AID_MIN,
  INCIDENT_KIND_LABELS,
  INCIDENT_KINDS,
  INCIDENT_LOCATION_MAX,
  INCIDENT_LOCATION_MIN,
  INCIDENT_NOTE_MAX,
  INCIDENT_NOTIFICATION_CHANNELS,
  INCIDENT_REFERRALS,
  INCIDENT_WITNESSES_MAX,
  INJURED_KINDS,
  INJURY_BODY_PARTS,
  INJURY_SEVERITIES,
} from '@kampus/school-core/lib/finance-incidents.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'

/**
 * Kaza tutanakları sekmesinin saf mantığı (DOM-FIN-146; ON-162): form şeması, varsayılanlar,
 * gövde ve tablo metinleri. Kural ayrıntısı sunucudadır (alan hatası `setError` ile forma döner).
 * Olay günü ve saati Europe/Istanbul yerel saatidir; gövdeye `+03:00` farkıyla gider.
 */

const TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
/** Europe/Istanbul saat:dakika (`08:30`). */
export const istanbulTime = (value: Date | string) => TIME_FORMAT.format(new Date(value))
/** Yerel gün ve saatten ISO an; Türkiye 2016'dan beri sabit UTC+3'tür. */
export const istanbulInstant = (day: string, time: string) => `${day}T${time}:00+03:00`
/** Olay anının gösterimi: `6 Eki 2026 08:30`. */
export const occurredText = (value: string) => `${dateLabel(value)} ${istanbulTime(value)}`

type Tone = 'green' | 'red' | 'amber' | 'purple' | 'gray'

/** Durum rozeti: kesinleşti ya da taslak. */
export function incidentStatusBadge(row: Pick<IncidentRow, 'status'>): {
  text: string
  tone: Tone
} {
  return row.status === 'finalized'
    ? { text: 'Kesinleşti', tone: 'green' }
    : { text: 'Taslak', tone: 'amber' }
}

/** Bildirim metni: personel tutanağında yok; öğrencide sayı. */
export function notificationText(row: Pick<IncidentRow, 'injuredKind' | 'notificationCount'>) {
  if (row.injuredKind === 'staff') return '—'
  return row.notificationCount === 0 ? 'Bildirilmedi' : `${String(row.notificationCount)} kayıt`
}

export const kindText = (row: Pick<IncidentRow, 'kind' | 'location'>) =>
  `${INCIDENT_KIND_LABELS[row.kind]} · ${row.location}`

const trimmed = (max: number, message: string) => z.string().trim().max(max, message)

export const incidentFormSchema = z
  .object({
    injuredKind: z.enum(INJURED_KINDS),
    studentId: z.string(),
    injuredMembershipId: z.string(),
    occurredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Olay gününü seçin.'),
    occurredTime: z.string().regex(/^\d{2}:\d{2}$/, 'Olay saatini girin.'),
    location: trimmed(
      INCIDENT_LOCATION_MAX,
      `Olay yeri en çok ${String(INCIDENT_LOCATION_MAX)} karakter olabilir.`,
    ).min(INCIDENT_LOCATION_MIN, 'Olay yerini yazın.'),
    kind: z.enum(INCIDENT_KINDS, 'Olay türünü seçin.'),
    description: trimmed(
      INCIDENT_DESCRIPTION_MAX,
      `Açıklama en çok ${String(INCIDENT_DESCRIPTION_MAX)} karakter olabilir.`,
    ).min(
      INCIDENT_DESCRIPTION_MIN,
      `Olayı en az ${String(INCIDENT_DESCRIPTION_MIN)} karakterle anlatın.`,
    ),
    bodyParts: z
      .array(z.enum(INJURY_BODY_PARTS))
      .min(1, 'En az bir yaralanma bölgesi seçin.')
      .max(
        INCIDENT_BODY_PARTS_MAX,
        `En çok ${String(INCIDENT_BODY_PARTS_MAX)} yaralanma bölgesi seçilir.`,
      ),
    severity: z.enum(INJURY_SEVERITIES, 'Yaralanmanın şiddetini seçin.'),
    injuryNote: trimmed(
      INCIDENT_NOTE_MAX,
      `Not en çok ${String(INCIDENT_NOTE_MAX)} karakter olabilir.`,
    ),
    firstAidGiven: z.boolean(),
    firstAidBy: z.string(),
    firstAidAction: trimmed(
      INCIDENT_NOTE_MAX,
      `Müdahale en çok ${String(INCIDENT_NOTE_MAX)} karakter olabilir.`,
    ),
    referral: z.enum(INCIDENT_REFERRALS, 'Sevk durumunu seçin.'),
    witnessMembershipIds: z
      .array(z.string())
      .max(INCIDENT_WITNESSES_MAX, `En çok ${String(INCIDENT_WITNESSES_MAX)} tanık eklenir.`),
    responsibleMembershipId: z.string().min(1, 'Sorumlu personeli seçin.'),
  })
  .superRefine((value, context) => {
    if (value.injuredKind === 'student' && value.studentId === '')
      context.addIssue({
        code: 'custom',
        path: ['studentId'],
        message: 'Yaralanan öğrenciyi seçin.',
      })
    if (value.injuredKind === 'staff' && value.injuredMembershipId === '')
      context.addIssue({
        code: 'custom',
        path: ['injuredMembershipId'],
        message: 'Yaralanan personeli seçin.',
      })
    if (value.firstAidGiven && value.firstAidAction.length < INCIDENT_FIRST_AID_MIN)
      context.addIssue({
        code: 'custom',
        path: ['firstAidAction'],
        message: 'Yapılan müdahaleyi yazın.',
      })
  })
export type IncidentFormValues = z.infer<typeof incidentFormSchema>

/** Yeni tutanak: öğrenci, bugün ve şimdiki saat, düşme, hafif, sevk yok. */
export function incidentDefaults(now = new Date()): IncidentFormValues {
  return {
    injuredKind: 'student',
    studentId: '',
    injuredMembershipId: '',
    occurredDate: dayKey(now),
    occurredTime: istanbulTime(now),
    location: '',
    kind: 'fall',
    description: '',
    bodyParts: [],
    severity: 'minor',
    injuryNote: '',
    firstAidGiven: false,
    firstAidBy: '',
    firstAidAction: '',
    referral: 'none',
    witnessMembershipIds: [],
    responsibleMembershipId: '',
  }
}

/** Düzenleme formu: taslağın değerleri (sağlık grubu taslakta açana da döner). */
export function incidentEditDefaults(detail: IncidentDetail): IncidentFormValues {
  const health = detail.health
  return {
    injuredKind: detail.injuredKind,
    studentId: detail.studentId ?? '',
    injuredMembershipId: detail.injuredMembershipId ?? '',
    occurredDate: dayKey(detail.occurredAt),
    occurredTime: istanbulTime(detail.occurredAt),
    location: detail.location,
    kind: detail.kind,
    description: detail.description,
    bodyParts: health?.bodyParts ?? [],
    severity: health?.severity ?? 'minor',
    injuryNote: health?.injuryNote ?? '',
    firstAidGiven: health?.firstAid != null,
    firstAidBy: health?.firstAid?.byMembershipId ?? '',
    firstAidAction: health?.firstAid?.action ?? '',
    referral: health?.referral ?? 'none',
    witnessMembershipIds: detail.witnesses.map((item) => item.membershipId),
    responsibleMembershipId: detail.responsibleMembershipId,
  }
}

const sharedBody = (values: IncidentFormValues) => ({
  occurredAt: istanbulInstant(values.occurredDate, values.occurredTime),
  location: values.location.trim(),
  kind: values.kind,
  description: values.description.trim(),
  bodyParts: values.bodyParts,
  severity: values.severity,
  injuryNote: values.injuryNote.trim() === '' ? null : values.injuryNote.trim(),
  firstAid: values.firstAidGiven
    ? {
        byMembershipId: values.firstAidBy === '' ? null : values.firstAidBy,
        action: values.firstAidAction.trim(),
      }
    : null,
  referral: values.referral,
  witnessMembershipIds: values.witnessMembershipIds,
  responsibleMembershipId: values.responsibleMembershipId,
})

export function incidentCreateBody(values: IncidentFormValues): IncidentCreateBody {
  return {
    injured:
      values.injuredKind === 'student'
        ? { kind: 'student', studentId: values.studentId }
        : { kind: 'staff', membershipId: values.injuredMembershipId },
    ...sharedBody(values),
  }
}

/** Düzeltme gövdesi: yalnız değişen alanlar (sunucu değişmeyeni reddeder). */
export function incidentUpdateBody(
  values: IncidentFormValues,
  initial: IncidentFormValues,
): IncidentUpdateBody {
  const next = sharedBody(values)
  const before = sharedBody(initial)
  const body: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof typeof next)[])
    if (JSON.stringify(next[key]) !== JSON.stringify(before[key])) body[key] = next[key]
  return body as IncidentUpdateBody
}

const FORM_FIELDS = [
  'location',
  'kind',
  'description',
  'bodyParts',
  'severity',
  'injuryNote',
  'referral',
  'witnessMembershipIds',
  'responsibleMembershipId',
] as const satisfies readonly (keyof IncidentFormValues)[]

/** Sunucu alan yolu → form alanı; eşlenmeyen kök hataya gider. */
export function incidentFormField(name: string): keyof IncidentFormValues | null {
  if (name === 'occurredAt') return 'occurredTime'
  if (name === 'injured.studentId') return 'studentId'
  if (name === 'injured.membershipId') return 'injuredMembershipId'
  if (name.startsWith('firstAid.byMembershipId')) return 'firstAidBy'
  if (name.startsWith('firstAid')) return 'firstAidAction'
  if (name.startsWith('witnessMembershipIds')) return 'witnessMembershipIds'
  return FORM_FIELDS.find((field) => field === name) ?? null
}

export const notificationFormSchema = z.object({
  channel: z.enum(INCIDENT_NOTIFICATION_CHANNELS, 'Kanalı seçin.'),
  notifiedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bildirim gününü seçin.'),
  notifiedTime: z.string().regex(/^\d{2}:\d{2}$/, 'Bildirim saatini girin.'),
})
export type NotificationFormValues = z.infer<typeof notificationFormSchema>
export const notificationDefaults = (now = new Date()): NotificationFormValues => ({
  channel: 'phone',
  notifiedDate: dayKey(now),
  notifiedTime: istanbulTime(now),
})

export const addendumFormSchema = z.object({
  note: z
    .string()
    .trim()
    .min(INCIDENT_ADDENDUM_MIN, `Ek not en az ${String(INCIDENT_ADDENDUM_MIN)} karakter olmalı.`)
    .max(
      INCIDENT_ADDENDUM_MAX,
      `Ek not en çok ${String(INCIDENT_ADDENDUM_MAX)} karakter olabilir.`,
    ),
})
export type AddendumFormValues = z.infer<typeof addendumFormSchema>
