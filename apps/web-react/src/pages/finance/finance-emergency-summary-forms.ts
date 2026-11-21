import { z } from 'zod'

import type { EmergencySummaryRow } from '@kampus/react-shared/use-finance-emergency-summaries.ts'
import {
  EMERGENCY_SUMMARY_STATE_LABELS,
  emergencyActionTextSchema,
  type EmergencySummaryState,
} from '@kampus/school-core/lib/finance-emergency-summaries.ts'

/**
 * Acil durum özetleri sekmesinin saf mantığı (DOM-FIN-155; ON-165): form şemaları, rozetler ve kart
 * metinleri. Kural ayrıntısı sunucudadır; alan hatası `setError` ile forma döner.
 */

type Tone = 'green' | 'red' | 'amber' | 'purple' | 'gray'

const STATE_TONES = {
  draft: 'amber',
  published: 'green',
  pending_revision: 'purple',
} as const satisfies Record<EmergencySummaryState, Tone>

/** Durum rozeti; yayındaki özette profil değiştiyse "Gözden geçirilmeli" (kırmızı). */
export function summaryStateBadge(row: Pick<EmergencySummaryRow, 'state' | 'needsReview'>): {
  text: string
  tone: Tone
} {
  if (row.needsReview) return { text: 'Gözden geçirilmeli', tone: 'red' }
  return { text: EMERGENCY_SUMMARY_STATE_LABELS[row.state], tone: STATE_TONES[row.state] }
}

export const summaryFormSchema = z.object({
  studentId: z.string().trim().min(1, 'Öğrenciyi seçin.'),
  actionText: emergencyActionTextSchema,
})
export type SummaryFormValues = z.input<typeof summaryFormSchema>

export const actionFormSchema = z.object({ actionText: emergencyActionTextSchema })
export type ActionFormValues = z.input<typeof actionFormSchema>

/** Sunucu alan adını forma eşler; bilinmeyen alan kök hatasıdır. */
export const summaryFormField = (name: string): keyof SummaryFormValues | null =>
  name === 'studentId' || name === 'actionText' ? name : null
