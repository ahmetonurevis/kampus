import { z } from 'zod'

import type {
  InfirmaryDischargeBody,
  InfirmaryVisitCreateBody,
  InfirmaryVisitRow,
  MedicationConsentRow,
  MedicationScheduleSlot,
} from '@kampus/react-shared/use-finance-infirmary.ts'
import {
  CONSENT_REASON_MAX,
  CONSENT_REASON_MIN,
  CONSENT_STATUS_LABELS,
  VISIT_ACTION_LABELS,
  VISIT_ACTIONS,
  VISIT_COMPLAINT_MAX,
  VISIT_COMPLAINT_MIN,
  VISIT_NOTE_MAX,
  VISIT_OUTCOME_LABELS,
  VISIT_OUTCOMES,
  type ConsentStatus,
  type VisitAction,
} from '@kampus/school-core/lib/finance-infirmary.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'

import { istanbulInstant, istanbulTime, occurredText } from './finance-incident-forms.ts'

/**
 * Revir sekmesinin saf mantığı (DOM-FIN-151; ON-101): form şemaları, varsayılanlar, gövdeler ve
 * tablo metinleri. Kural ayrıntısı sunucudadır (alan hatası `setError` ile forma döner). Geliş
 * günü ve saati Europe/Istanbul yerel saatidir; gövdeye `+03:00` farkıyla gider.
 */

type Tone = 'green' | 'red' | 'amber' | 'purple' | 'gray'

/** Ziyaret durumu rozeti: revirde (sarı) ya da sonuç. */
export function visitStatusBadge(row: Pick<InfirmaryVisitRow, 'status' | 'outcome'>): {
  text: string
  tone: Tone
} {
  if (row.status === 'open') return { text: 'Revirde', tone: 'amber' }
  if (row.outcome === 'referred') return { text: VISIT_OUTCOME_LABELS.referred, tone: 'red' }
  if (row.outcome === 'went_home') return { text: VISIT_OUTCOME_LABELS.went_home, tone: 'purple' }
  return { text: VISIT_OUTCOME_LABELS.returned_to_class, tone: 'green' }
}

const CONSENT_TONES = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
  withdrawn: 'gray',
} as const satisfies Record<ConsentStatus, Tone>

export const consentStatusBadge = (row: Pick<MedicationConsentRow, 'status'>) => ({
  text: CONSENT_STATUS_LABELS[row.status],
  tone: CONSENT_TONES[row.status],
})

/** Ziyaret süresi metni: `08:30 – 09:10` ya da `08:30 – revirde`. */
export function visitTimeText(row: Pick<InfirmaryVisitRow, 'arrivedAt' | 'returnedAt'>) {
  const end = row.returnedAt === null ? 'revirde' : istanbulTime(row.returnedAt)
  return `${occurredText(row.arrivedAt)} – ${end}`
}

export const actionsText = (actions: readonly VisitAction[]) =>
  actions.length === 0 ? 'Henüz yok' : actions.map((item) => VISIT_ACTION_LABELS[item]).join(', ')

/** Talep dönemi metni: `6 Eki – 8 Eki · 09:00, 12:30`. */
export const consentPeriodText = (
  row: Pick<MedicationConsentRow, 'startDate' | 'endDate' | 'times'>,
) =>
  `${dateLabel(`${row.startDate}T09:00:00Z`)} – ${dateLabel(`${row.endDate}T09:00:00Z`)} · ${row.times.join(', ')}`

/** Gün planı satırının durum metni. */
export function scheduleSlotText(slot: Pick<MedicationScheduleSlot, 'administration'>) {
  if (slot.administration === null) return 'Verilmedi'
  return `Verildi ${istanbulTime(slot.administration.administeredAt)} · ${slot.administration.administeredByName ?? '—'}`
}

const actionList = z
  .array(z.enum(VISIT_ACTIONS))
  .refine((items) => new Set(items).size === items.length, 'Aynı işlem iki kez seçilmiş.')

export const visitFormSchema = z.object({
  studentId: z.string().min(1, 'Öğrenciyi seçin.'),
  arrivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geliş gününü seçin.'),
  arrivedTime: z.string().regex(/^\d{2}:\d{2}$/, 'Geliş saatini girin.'),
  referredByMembershipId: z.string(),
  complaint: z
    .string()
    .trim()
    .min(VISIT_COMPLAINT_MIN, 'Şikâyeti yazın.')
    .max(VISIT_COMPLAINT_MAX, `Şikâyet en çok ${String(VISIT_COMPLAINT_MAX)} karakter olabilir.`),
  actions: actionList,
  note: z
    .string()
    .trim()
    .max(VISIT_NOTE_MAX, `Not en çok ${String(VISIT_NOTE_MAX)} karakter olabilir.`),
})
export type VisitFormValues = z.infer<typeof visitFormSchema>

export const visitDefaults = (now = new Date()): VisitFormValues => ({
  studentId: '',
  arrivedDate: dayKey(now),
  arrivedTime: istanbulTime(now),
  referredByMembershipId: '',
  complaint: '',
  actions: [],
  note: '',
})

export const visitCreateBody = (values: VisitFormValues): InfirmaryVisitCreateBody => ({
  studentId: values.studentId,
  arrivedAt: istanbulInstant(values.arrivedDate, values.arrivedTime),
  referredByMembershipId:
    values.referredByMembershipId === '' ? null : values.referredByMembershipId,
  complaint: values.complaint.trim(),
  actions: values.actions,
  note: values.note.trim() === '' ? null : values.note.trim(),
})

const VISIT_FIELDS: Readonly<Record<string, keyof VisitFormValues>> = {
  studentId: 'studentId',
  arrivedAt: 'arrivedTime',
  referredByMembershipId: 'referredByMembershipId',
  complaint: 'complaint',
  actions: 'actions',
  note: 'note',
}
/** Sunucu alan yolunu forma eşler; eşlenmeyen yol genel hatadır. */
export const visitFormField = (name: string): keyof VisitFormValues | null =>
  VISIT_FIELDS[name.split('.')[0] ?? ''] ?? null

export const dischargeFormSchema = z.object({
  outcome: z.enum(VISIT_OUTCOMES, 'Sonucu seçin.'),
  actions: actionList.min(1, 'Revirde yapılanı en az bir seçin.'),
  note: z
    .string()
    .trim()
    .max(VISIT_NOTE_MAX, `Not en çok ${String(VISIT_NOTE_MAX)} karakter olabilir.`),
})
export type DischargeFormValues = z.infer<typeof dischargeFormSchema>

export const dischargeDefaults = (detail: {
  actions: readonly VisitAction[]
  note: string | null
}): DischargeFormValues => ({
  outcome: 'returned_to_class',
  actions: [...detail.actions],
  note: detail.note ?? '',
})

/** Kapatma gövdesi: dönüş anı sunucu saatidir; not boşaltılırsa kaldırılır. */
export const dischargeBody = (values: DischargeFormValues): InfirmaryDischargeBody => ({
  outcome: values.outcome,
  actions: values.actions,
  note: values.note.trim() === '' ? null : values.note.trim(),
})

export const rejectFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(CONSENT_REASON_MIN, `Gerekçe en az ${String(CONSENT_REASON_MIN)} karakter olmalı.`)
    .max(CONSENT_REASON_MAX, `Gerekçe en çok ${String(CONSENT_REASON_MAX)} karakter olabilir.`),
})
export type RejectFormValues = z.infer<typeof rejectFormSchema>
