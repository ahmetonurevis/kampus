// Ek ders çizelgesi onayı ekranının saf mantığı (DOM-FIN-120; ON-196): durum tonu, öğretmen
// yanıtı metni, eylem uygunluğu ve yanıt formu. Gerekçe sınırları core şemasıyla aynıdır.
import { z } from 'zod'
import type {
  LessonHourSheet,
  LessonHourSheetStaff,
} from '@kampus/react-shared/use-finance-lesson-hour-sheets.ts'
import {
  LESSON_CONFIRMATION_CHANNEL_LABELS,
  LESSON_CONFIRMATION_CHANNELS,
  LESSON_CONFIRMATION_OUTCOME_LABELS,
  type LessonConfirmationOutcome,
  type LessonSheetStatus,
  type LessonTeacherState,
} from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'
import {
  PAYROLL_REASON_MAX,
  PAYROLL_REASON_MIN,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

export const SHEET_STATUS_TONES = {
  draft: 'gray',
  teacher_review: 'amber',
  approved: 'green',
} as const satisfies Record<LessonSheetStatus, BadgeTone>

export const TEACHER_STATE_TONES = {
  pending: 'amber',
  confirmed: 'green',
  disputed: 'red',
} as const satisfies Record<LessonTeacherState, BadgeTone>

const when = (iso: string) =>
  dateLabel(iso, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** "İtiraz etti · Telefon · 06.10.2026 10:00 · Test Yönetici"; eski yanıt işaretlenir. */
export function responseText(staff: LessonHourSheetStaff): string {
  const last = staff.lastResponse
  if (last === null) return 'Yanıt yok'
  const parts = [
    LESSON_CONFIRMATION_OUTCOME_LABELS[last.outcome],
    LESSON_CONFIRMATION_CHANNEL_LABELS[last.channel],
    when(last.recordedAt),
    ...(last.recordedByName === null ? [] : [last.recordedByName]),
  ]
  const text = parts.join(' · ')
  return last.current ? text : `${text} (saat sonradan değişti)`
}

/** Çizelge geçmişinin satırları: gönderme, son onay, son yeniden açma. */
export function sheetTimeline(sheet: LessonHourSheet): [string, string][] {
  const rows: [string, string][] = []
  const by = (name: string | null) => (name === null ? '' : ` · ${name}`)
  if (sheet.submittedAt !== null)
    rows.push([
      'Öğretmen kontrolüne gönderildi',
      `${when(sheet.submittedAt)}${by(sheet.submittedByName)}`,
    ])
  if (sheet.approvedAt !== null)
    rows.push([
      sheet.approvalCount > 1 ? `Müdür onayı (${String(sheet.approvalCount)}.)` : 'Müdür onayı',
      `${when(sheet.approvedAt)}${by(sheet.approvedByName)}`,
    ])
  if (sheet.reopenedAt !== null)
    rows.push([
      'Yeniden açıldı',
      `${when(sheet.reopenedAt)}${by(sheet.reopenedByName)} · ${sheet.reopenReason ?? ''}`,
    ])
  return rows
}

/** Ekrandaki eylemler: kilitli ay ve durum düğmeleri belirler. */
export function sheetActions(sheet: LessonHourSheet) {
  const unconfirmed = sheet.staff.filter((item) => item.state !== 'confirmed').length
  return {
    /** Saat ekleme, düzeltme ve silme (K-410). */
    hoursLocked: sheet.status === 'approved' || sheet.payrollLocked,
    canSubmit: sheet.status === 'draft' && sheet.entries.length > 0 && !sheet.payrollLocked,
    canRespond: sheet.status === 'teacher_review',
    canApprove: sheet.status === 'teacher_review' && unconfirmed === 0 && !sheet.payrollLocked,
    canReopen: sheet.status === 'approved' && !sheet.payrollLocked,
    unconfirmed,
  }
}

const reasonText = z
  .string()
  .trim()
  .min(PAYROLL_REASON_MIN, `Gerekçeyi en az ${String(PAYROLL_REASON_MIN)} karakterle yazın.`)
  .max(PAYROLL_REASON_MAX, `En fazla ${String(PAYROLL_REASON_MAX)} karakter girebilirsiniz.`)

export const confirmationFormSchema = z.object({
  channel: z.enum(LESSON_CONFIRMATION_CHANNELS, 'Yanıtın alındığı kanalı seçin.'),
  reason: z.string(),
})
export const disputeFormSchema = confirmationFormSchema.extend({ reason: reasonText })
export type ConfirmationFormValues = z.input<typeof confirmationFormSchema>

export const confirmationDefaults = (): ConfirmationFormValues => ({
  channel: 'in_person',
  reason: '',
})

export function confirmationBody(
  month: string,
  membershipId: string,
  outcome: LessonConfirmationOutcome,
  values: ConfirmationFormValues,
) {
  return {
    month,
    membershipId,
    outcome,
    channel: values.channel,
    reason: outcome === 'disputed' ? values.reason.trim() : null,
  }
}

export const reopenFormSchema = z.object({ reason: reasonText })
