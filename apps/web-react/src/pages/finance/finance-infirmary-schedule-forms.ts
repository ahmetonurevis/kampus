import { z } from 'zod'

import type {
  AdministrationCorrectionBody,
  MedicationChartItem,
  MedicationDoseRecord,
  MedicationDoseSkipBody,
  SkipCorrectionBody,
} from '@kampus/react-shared/use-finance-infirmary-schedule.ts'
import {
  CORRECTION_REASON_MAX,
  CORRECTION_REASON_MIN,
  DOSE_CORRECTION_KINDS,
  DOSE_SKIP_REASON_LABELS,
  DOSE_SKIP_REASONS,
  DOSE_STATE_LABELS,
  DOSE_STATES,
  LATE_TOLERANCE_MAX_MINUTES,
  LATE_TOLERANCE_MIN_MINUTES,
  SKIP_OTHER_NOTE_MIN,
  type DoseState,
} from '@kampus/school-core/lib/finance-infirmary-schedule.ts'
import { MEDICATION_NOTE_MAX } from '@kampus/school-core/lib/finance-infirmary.ts'

import { istanbulInstant, istanbulTime } from './finance-incident-forms.ts'

/**
 * "Bugünkü ilaçlar" görünümünün saf mantığı (DOM-FIN-152; ON-161; K-511…K-513): durum rozeti,
 * sonuç metinleri, özet sayıları ve atlama/düzeltme/gecikme payı form şemaları ile gövdeleri.
 * Kural ayrıntısı sunucudadır (alan hatası `setError` ile forma döner). Düzeltilmiş saat
 * Europe/Istanbul yerel saatidir; gövdeye kaydın doz günüyle `+03:00` farkıyla gider.
 */

type Tone = 'green' | 'red' | 'amber' | 'purple' | 'gray'

const STATE_TONES = {
  overdue: 'red',
  pending: 'amber',
  administered: 'green',
  skipped: 'purple',
} as const satisfies Record<DoseState, Tone>

export const doseStateBadge = (state: DoseState) => ({
  text: DOSE_STATE_LABELS[state],
  tone: STATE_TONES[state],
})

/** Doz saatinin etkin kaydı (iptal edilmemiş son kayıt). */
export const activeRecord = (item: Pick<MedicationChartItem, 'records'>) =>
  item.records.findLast((record) => !record.voided) ?? null

/** Sonuç metni: `Verildi 12:34 · Selin Kaya` ya da `Atlandı · Öğrenci reddetti`. */
export function doseRecordText(
  record: Pick<
    MedicationDoseRecord,
    'kind' | 'administeredAt' | 'administeredByName' | 'skipReason'
  >,
) {
  if (record.kind === 'administration')
    return `Verildi ${record.administeredAt === null ? '—' : istanbulTime(record.administeredAt)} · ${record.administeredByName ?? '—'}`
  return `Atlandı · ${record.skipReason === null ? '—' : DOSE_SKIP_REASON_LABELS[record.skipReason]}`
}

/** Gün özeti: `2 gecikti · 1 bekliyor · 3 verildi`; olmayan durum yazılmaz. */
export function chartSummaryText(items: readonly Pick<MedicationChartItem, 'state'>[]) {
  const parts = DOSE_STATES.flatMap((state) => {
    const count = items.filter((item) => item.state === state).length
    return count === 0
      ? []
      : [`${String(count)} ${DOSE_STATE_LABELS[state].toLocaleLowerCase('tr-TR')}`]
  })
  return parts.join(' · ')
}

const noteField = z
  .string()
  .trim()
  .max(MEDICATION_NOTE_MAX, `Açıklama en çok ${String(MEDICATION_NOTE_MAX)} karakter olabilir.`)
const OTHER_NOTE = `"Diğer" gerekçede en az ${String(SKIP_OTHER_NOTE_MIN)} karakterlik açıklama yazın.`

// --- Atlama --------------------------------------------------------------------------------------

export const skipFormSchema = z
  .object({
    reason: z.enum(DOSE_SKIP_REASONS, 'Atlama gerekçesini seçin.'),
    note: noteField,
  })
  .refine((value) => value.reason !== 'other' || value.note.length >= SKIP_OTHER_NOTE_MIN, {
    message: OTHER_NOTE,
    path: ['note'],
  })
export type SkipFormValues = z.input<typeof skipFormSchema>
export const skipDefaults = (): SkipFormValues => ({ reason: 'student_absent', note: '' })

export function skipBody(
  item: Pick<MedicationChartItem, 'scheduledTime'>,
  day: string,
  values: SkipFormValues,
): MedicationDoseSkipBody {
  const note = values.note.trim()
  return {
    scheduledTime: item.scheduledTime,
    doseDay: day,
    reason: values.reason,
    note: note === '' ? null : note,
  }
}

// --- Düzeltme ------------------------------------------------------------------------------------

const reasonField = z
  .string()
  .trim()
  .min(CORRECTION_REASON_MIN, `Gerekçe en az ${String(CORRECTION_REASON_MIN)} karakter olmalı.`)
  .max(CORRECTION_REASON_MAX, `Gerekçe en çok ${String(CORRECTION_REASON_MAX)} karakter olabilir.`)

export const correctionFormSchema = z
  .object({
    kind: z.enum(DOSE_CORRECTION_KINDS, 'Düzeltme türünü seçin.'),
    reason: reasonField,
    time: z.union([
      z.literal(''),
      z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Saati SS:DD biçiminde girin.'),
    ]),
    skipReason: z.enum(DOSE_SKIP_REASONS),
    note: noteField,
  })
  .refine(
    (value) =>
      value.kind === 'void' ||
      value.skipReason !== 'other' ||
      value.note.length >= SKIP_OTHER_NOTE_MIN,
    {
      message: OTHER_NOTE,
      path: ['note'],
    },
  )
export type CorrectionFormValues = z.input<typeof correctionFormSchema>

export function correctionDefaults(record: MedicationDoseRecord): CorrectionFormValues {
  return {
    kind: 'amend',
    reason: '',
    time: record.administeredAt === null ? '' : istanbulTime(record.administeredAt),
    skipReason: record.skipReason ?? 'other',
    note: record.note ?? '',
  }
}

/** Uygulama düzeltmesi gövdesi: iptalde yalnız gerekçe, düzeltmede yalnız değişen alanlar. */
export function administrationCorrectionBody(
  record: MedicationDoseRecord,
  values: CorrectionFormValues,
): AdministrationCorrectionBody {
  const reason = values.reason.trim()
  if (values.kind === 'void') return { kind: 'void', reason }
  const note = values.note.trim()
  const time = values.time
  const currentTime = record.administeredAt === null ? '' : istanbulTime(record.administeredAt)
  return {
    kind: 'amend',
    reason,
    ...(time === '' || time === currentTime
      ? {}
      : { administeredAt: istanbulInstant(record.doseDay, time) }),
    ...(note === (record.note ?? '') ? {} : { note: note === '' ? null : note }),
  }
}

/** Atlama düzeltmesi gövdesi: iptalde yalnız gerekçe, düzeltmede yalnız değişen alanlar. */
export function skipCorrectionBody(
  record: MedicationDoseRecord,
  values: CorrectionFormValues,
): SkipCorrectionBody {
  const reason = values.reason.trim()
  if (values.kind === 'void') return { kind: 'void', reason }
  const note = values.note.trim()
  return {
    kind: 'amend',
    reason,
    ...(values.skipReason === record.skipReason ? {} : { skipReason: values.skipReason }),
    ...(note === (record.note ?? '') ? {} : { note: note === '' ? null : note }),
  }
}

/** Sunucu alan adını forma eşler; eşleşmeyen alan genel hata olur. */
export function correctionFormField(name: string): keyof CorrectionFormValues | null {
  if (name === 'administeredAt') return 'time'
  if (name === 'kind' || name === 'reason' || name === 'skipReason' || name === 'note') return name
  return null
}

// --- Gecikme payı --------------------------------------------------------------------------------

export const toleranceFormSchema = z.object({
  lateToleranceMinutes: z
    .number('Gecikme payını dakika olarak girin.')
    .int('Gecikme payı tam dakika olmalı.')
    .min(LATE_TOLERANCE_MIN_MINUTES, `En az ${String(LATE_TOLERANCE_MIN_MINUTES)} dakika olmalı.`)
    .max(
      LATE_TOLERANCE_MAX_MINUTES,
      `En çok ${String(LATE_TOLERANCE_MAX_MINUTES)} dakika olabilir.`,
    ),
})
export type ToleranceFormValues = z.infer<typeof toleranceFormSchema>
