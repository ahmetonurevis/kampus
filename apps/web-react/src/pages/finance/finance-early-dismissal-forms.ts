import { z } from 'zod'

import type {
  EarlyDismissalCreateBody,
  EarlyDismissalDetail,
  EarlyDismissalReleaseBody,
  EarlyDismissalRow,
} from '@kampus/react-shared/use-finance-early-dismissals.ts'
import {
  EARLY_DISMISSAL_DECISION_MAX,
  EARLY_DISMISSAL_DECISION_MIN,
  EARLY_DISMISSAL_NOTE_MAX,
  EARLY_DISMISSAL_REASONS,
  EARLY_DISMISSAL_STATUS_LABELS,
  EARLY_DISMISSAL_TIME_PATTERN,
  PICKUP_ID_LAST4_PATTERN,
  PICKUP_NAME_MAX,
  PICKUP_RELATIONSHIP_LABELS,
  PICKUP_RELATIONSHIPS,
} from '@kampus/school-core/lib/finance-early-dismissals.ts'
import { istanbulInstant } from '@kampus/school-core/lib/finance-infirmary-schedule.ts'
import { dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import { GUARDIAN_RELATIONSHIPS } from '@kampus/school-core/lib/guardianship.ts'

/**
 * Erken çıkış sekmesinin saf mantığı (DOM-FIN-161; ON-168; K-538…K-540): okulun acil talep, ret
 * ve teslim formlarının şeması ve gövdesi, satır metinleri ve yoklamaya yansıma cümlesi. Kural
 * ayrıntısı sunucudadır; alan hatası `setError` ile forma döner.
 */

type Tone = 'green' | 'red' | 'amber' | 'purple' | 'gray'

/** Durum rozeti. */
export function dismissalStatusBadge(row: Pick<EarlyDismissalRow, 'status'>): {
  text: string
  tone: Tone
} {
  const text = EARLY_DISMISSAL_STATUS_LABELS[row.status]
  switch (row.status) {
    case 'pending':
      return { text, tone: 'amber' }
    case 'approved':
      return { text, tone: 'purple' }
    case 'released':
      return { text, tone: 'green' }
    case 'rejected':
      return { text, tone: 'red' }
    case 'cancelled':
      return { text, tone: 'gray' }
    default:
      return row.status satisfies never
  }
}

/** Teslim alacak kişi: ad ve yakınlık; kayıtlı olmayan kişide "(kayıtlı değil)". */
export function pickupText(
  row: Pick<EarlyDismissalRow, 'pickupKind' | 'pickupName' | 'pickupRelationship'>,
) {
  if (row.pickupKind === 'other')
    return `${row.pickupName ?? '—'} · ${
      row.pickupRelationship ? PICKUP_RELATIONSHIP_LABELS[row.pickupRelationship] : 'Diğer'
    } (kayıtlı değil)`
  return row.pickupName ?? 'Kaldırılmış veli bağı'
}

/** Teslim listesindeki kişi: ad ve yakınlık ya da velayet bilgisi. */
export function authorizedPickupText(
  option: EarlyDismissalDetail['authorizedPickups'][number],
): string {
  const relation = GUARDIAN_RELATIONSHIPS[option.relationship].label
  const right = option.custody === 'none' ? 'teslim yetkili' : 'velayetli'
  return `${option.name} · ${relation}, ${right}`
}

/** Planlanan ve gerçek çıkış: "13:40" ya da "13:40 · çıktı 13:35". */
export function dismissalTimeText(row: Pick<EarlyDismissalRow, 'plannedAt' | 'releasedAt'>) {
  const planned = timeLabel(row.plannedAt)
  return row.releasedAt === null ? planned : `${planned} · çıktı ${timeLabel(row.releasedAt)}`
}

/**
 * Yoklamaya yansıma cümlesi (K-540): "4. dersten itibaren izinli ayrıldı"; onaylı ama teslim
 * edilmemişte "ayrılacak"; etkilenen ders yoksa ders bitiminden sonra çıkış.
 */
export function effectText(effect: EarlyDismissalDetail['effect']): string | null {
  if (effect === null) return null
  if (effect.fromPeriod === null)
    return effect.basis === 'released'
      ? 'Dersler bittikten sonra ayrıldı; yoklamaya yansımaz.'
      : 'Dersler bittikten sonra ayrılacak; yoklamaya yansımaz.'
  const verb = effect.basis === 'released' ? 'izinli ayrıldı' : 'izinli ayrılacak'
  return `${String(effect.fromPeriod)}. dersten itibaren ${verb}.`
}

// --- Acil talep (okul) ---------------------------------------------------------------------------

export const requestFormSchema = z
  .object({
    studentId: z.string().min(1, 'Öğrenciyi seçin.'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Günü seçin.'),
    time: z.string().regex(EARLY_DISMISSAL_TIME_PATTERN, 'Saati SS:DD biçiminde girin.'),
    reason: z.enum(EARLY_DISMISSAL_REASONS, 'Çıkış nedenini seçin.'),
    reasonNote: z
      .string()
      .trim()
      .max(
        EARLY_DISMISSAL_NOTE_MAX,
        `Açıklama en çok ${String(EARLY_DISMISSAL_NOTE_MAX)} karakter olabilir.`,
      ),
    pickupKind: z.enum(['guardian', 'other']),
    guardianLinkId: z.string(),
    pickupName: z.string().trim(),
    idLast4: z.string().trim(),
    relationship: z.enum(['', ...PICKUP_RELATIONSHIPS]),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message })
    if (value.reason === 'other' && value.reasonNote === '')
      issue('reasonNote', '"Diğer" nedeninde açıklama yazın.')
    if (value.pickupKind === 'guardian') {
      if (value.guardianLinkId === '') issue('guardianLinkId', 'Teslim alacak kişiyi seçin.')
      return
    }
    if (value.pickupName.length < 2 || value.pickupName.length > PICKUP_NAME_MAX)
      issue('pickupName', 'Teslim alacak kişinin adını yazın (2–120 karakter).')
    if (!PICKUP_ID_LAST4_PATTERN.test(value.idLast4.toUpperCase()))
      issue('idLast4', 'Kimliğin yalnız son dört hanesini yazın.')
    if (value.relationship === '') issue('relationship', 'Öğrenciye yakınlığını seçin.')
  })
export type RequestFormValues = z.infer<typeof requestFormSchema>

/** Varsayılan: bugün, şimdiden yarım saat sonrası (5 dakikaya yuvarlanır), randevu. */
export function requestDefaults(now: Date): RequestFormValues {
  const later = new Date(Math.ceil((now.getTime() + 30 * 60_000) / 300_000) * 300_000)
  const sameDay = dayKey(later) === dayKey(now)
  return {
    studentId: '',
    date: dayKey(now),
    time: sameDay ? timeLabel(later) : '23:55',
    reason: 'appointment',
    reasonNote: '',
    pickupKind: 'guardian',
    guardianLinkId: '',
    pickupName: '',
    idLast4: '',
    relationship: '',
  }
}

export function requestBody(values: RequestFormValues): EarlyDismissalCreateBody {
  return {
    studentId: values.studentId,
    date: values.date,
    time: values.time,
    reason: values.reason,
    reasonNote: values.reasonNote === '' ? null : values.reasonNote,
    pickup:
      values.pickupKind === 'guardian'
        ? { kind: 'guardian', guardianLinkId: values.guardianLinkId }
        : {
            kind: 'other',
            name: values.pickupName,
            idLast4: values.idLast4.toUpperCase(),
            relationship: values.relationship === '' ? 'other' : values.relationship,
          },
  }
}

const REQUEST_FIELDS = ['studentId', 'date', 'time', 'reason', 'reasonNote'] as const
/** Sunucu alanını forma eşler (`pickup.*` teslim alanlarına); eşleşmeyen alan kök hatadır. */
export function requestFormField(name: string): keyof RequestFormValues | null {
  const direct = REQUEST_FIELDS.find((field) => field === name)
  if (direct) return direct
  if (name === 'pickup.guardianLinkId' || name === 'pickup.kind') return 'guardianLinkId'
  if (name === 'pickup.name') return 'pickupName'
  if (name === 'pickup.idLast4') return 'idLast4'
  if (name === 'pickup.relationship') return 'relationship'
  return null
}

// --- Ret -----------------------------------------------------------------------------------------

export const rejectFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(
      EARLY_DISMISSAL_DECISION_MIN,
      `Gerekçe en az ${String(EARLY_DISMISSAL_DECISION_MIN)} karakter olmalı.`,
    )
    .max(
      EARLY_DISMISSAL_DECISION_MAX,
      `Gerekçe en çok ${String(EARLY_DISMISSAL_DECISION_MAX)} karakter olabilir.`,
    ),
})
export type RejectFormValues = z.infer<typeof rejectFormSchema>

// --- Teslim --------------------------------------------------------------------------------------

/** Teslim alan seçimi: bağ kimliği ya da talepte onaylanan kişi (`other`). */
export const OTHER_PICKUP = 'other'

export const releaseFormSchema = z
  .object({
    pickup: z.string().min(1, 'Teslim alan kişiyi listeden seçin.'),
    idLast4: z.string().trim(),
    identityVerified: z
      .boolean()
      .refine((value) => value, 'Teslim alan kişinin kimliğini görüp işaretleyin.'),
    /** Gerçek çıkış saati (SS:DD); boşsa şimdi. */
    time: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Saati SS:DD biçiminde girin.'),
  })
  .superRefine((value, context) => {
    if (value.pickup === OTHER_PICKUP && !PICKUP_ID_LAST4_PATTERN.test(value.idLast4.toUpperCase()))
      context.addIssue({
        code: 'custom',
        path: ['idLast4'],
        message: 'Görülen kimliğin son dört hanesini yazın.',
      })
  })
export type ReleaseFormValues = z.infer<typeof releaseFormSchema>

export const releaseDefaults = (
  detail: Pick<EarlyDismissalDetail, 'pickupKind' | 'pickupGuardianLinkId' | 'authorizedPickups'>,
): ReleaseFormValues => ({
  pickup:
    detail.pickupKind === 'other'
      ? OTHER_PICKUP
      : detail.authorizedPickups.some((item) => item.guardianLinkId === detail.pickupGuardianLinkId)
        ? (detail.pickupGuardianLinkId ?? '')
        : '',
  idLast4: '',
  identityVerified: false,
  time: '',
})

export function releaseBody(values: ReleaseFormValues, day: string): EarlyDismissalReleaseBody {
  return {
    pickup:
      values.pickup === OTHER_PICKUP
        ? { kind: 'other', idLast4: values.idLast4.toUpperCase() }
        : { kind: 'guardian', guardianLinkId: values.pickup },
    identityVerified: true,
    releasedAt: values.time === '' ? null : istanbulInstant(day, values.time),
  }
}

/** Sunucu alanını teslim formuna eşler. */
export function releaseFormField(name: string): keyof ReleaseFormValues | null {
  if (name === 'pickup.guardianLinkId' || name === 'pickup.kind') return 'pickup'
  if (name === 'pickup.idLast4') return 'idLast4'
  if (name === 'releasedAt') return 'time'
  if (name === 'identityVerified') return 'identityVerified'
  return null
}
