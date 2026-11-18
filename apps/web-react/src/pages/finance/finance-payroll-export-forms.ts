// Bordro aktarımı ekranının saf mantığı (DOM-FIN-105; ON-202, ON-343): önizleme satırının gösterimi
// (ücret, ek ders, kesinti ve düzeltme) ve ek ders saati formu. Sınırlar ve mesajlar core
// `payrollLessonHoursInputSchema` ile aynıdır.
import { z } from 'zod'
import type {
  CreatePayrollLessonHoursBody,
  PayrollLine,
} from '@kampus/react-shared/use-finance-payroll-exports.ts'
import {
  PAYROLL_DEDUCTION_BASE_LABELS,
  PAYROLL_LESSON_HOURS_MAX,
  PAYROLL_LESSON_NOTE_MAX,
  PAYROLL_LINE_DIRECTION_LABELS,
  PAYROLL_UNIT_LABELS,
  PAYROLL_WARNING_LABELS,
  payrollItemLabel,
} from '@kampus/school-core/lib/finance-payroll-exports.ts'
import { LESSON_PAY_TYPES } from '@kampus/school-core/lib/finance-pay-rates.ts'
import { payrollMonthLabel } from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { rateLabel } from '@kampus/school-core/lib/finance-staff-deductions.ts'
import { money } from '@kampus/school-core/lib/format.ts'

export const PAYROLL_EXPORT_VIEW = 'bordro-aktarim'
const MONTH_PATTERN = /^20[2-9]\d-(0[1-9]|1[0-2])$/

/** `<input type="month">` değeri geçerli bordro ayı mı (2020–2099). */
export const isPayrollMonth = (value: string) => MONTH_PATTERN.test(value)

export const payrollFileName = (month: string) => `bordro-girdi-${month}.csv`

const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`

export interface PayrollRow {
  [key: string]: unknown
  id: string
  staff: string
  item: string
  direction: string
  unit: string
  rate: string
  quantity: string
  total: string
  period: string
  warnings: string
  lessonHoursId: string | null
}

/**
 * Ay içindeki dönem: "01.10–14.10 · 14/31 gün"; avans taksitinde "Taksit 2/3", düzeltmede
 * "Eylül 2026 farkı", ek ders ve öteki kesintilerde "Ay toplamı".
 */
export function payrollPeriodText(line: PayrollLine): string {
  if (line.installmentNo !== null && line.installmentCount !== null)
    return `Taksit ${String(line.installmentNo)}/${String(line.installmentCount)}`
  if (line.sourceMonth !== null) return `${payrollMonthLabel(line.sourceMonth)} farkı`
  if (line.startDate === null || line.endDate === null || line.days === null) return 'Ay toplamı'
  return `${shortDay(line.startDate)}–${shortDay(line.endDate)} · ${String(line.days)}/${String(line.monthDays)} gün`
}

/** Birim ücret ya da oranlı kesintide oran, matrah ve üst sınır: "%25 · Net ücret · en çok …". */
export function payrollRateText(line: PayrollLine): string {
  if (line.rateBasisPoints !== null) {
    const base =
      line.deductionBase === null ? '' : ` · ${PAYROLL_DEDUCTION_BASE_LABELS[line.deductionBase]}`
    const cap = line.capCents === null ? '' : ` · en çok ${money(line.capCents)}`
    return `${rateLabel(line.rateBasisPoints)}${base}${cap}`
  }
  return line.rateCents === null ? '—' : money(line.rateCents)
}

/** Tutar: kesinti eksi işaretle; hesaplanamıyorsa bordroya bırakılır. */
export function payrollTotalText(line: Pick<PayrollLine, 'direction' | 'totalCents'>): string {
  if (line.totalCents === null) return 'Bordroda hesaplanır'
  return money(line.direction === 'deduction' ? -line.totalCents : line.totalCents)
}

export function payrollRow(line: PayrollLine): PayrollRow {
  return {
    id: line.key,
    staff: line.staffActive ? line.staffName : `${line.staffName} (pasif)`,
    item: payrollItemLabel(line),
    direction: PAYROLL_LINE_DIRECTION_LABELS[line.direction],
    unit: PAYROLL_UNIT_LABELS[line.unit],
    rate: payrollRateText(line),
    quantity: line.quantity === null ? '—' : `${String(line.quantity)} saat`,
    total: payrollTotalText(line),
    period: payrollPeriodText(line),
    warnings: line.warnings.map((code) => PAYROLL_WARNING_LABELS[code]).join('; '),
    lessonHoursId: line.lessonHoursId,
  }
}

const hoursText = z
  .string()
  .trim()
  .refine(
    (value) =>
      /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= PAYROLL_LESSON_HOURS_MAX,
    `Saati 1 ile ${String(PAYROLL_LESSON_HOURS_MAX)} arasında tam sayı girin.`,
  )
const noteText = z
  .string()
  .max(
    PAYROLL_LESSON_NOTE_MAX,
    `En fazla ${String(PAYROLL_LESSON_NOTE_MAX)} karakter girebilirsiniz.`,
  )

export const lessonHoursFormSchema = z.object({
  membershipId: z.string().min(1, 'Personel seçin.'),
  lessonType: z.enum(LESSON_PAY_TYPES, 'Ek ders türünü seçin.'),
  hours: hoursText,
  note: noteText,
})
export type LessonHoursFormValues = z.input<typeof lessonHoursFormSchema>

export const lessonHoursEditSchema = z.object({ hours: hoursText, note: noteText })
export type LessonHoursEditValues = z.input<typeof lessonHoursEditSchema>

export const lessonHoursDefaults = (): LessonHoursFormValues => ({
  membershipId: '',
  lessonType: 'extra',
  hours: '',
  note: '',
})

export function lessonHoursBody(
  month: string,
  values: LessonHoursFormValues,
): CreatePayrollLessonHoursBody {
  const note = values.note.trim()
  return {
    membershipId: values.membershipId,
    month,
    lessonType: values.lessonType,
    hours: Number(values.hours.trim()),
    note: note === '' ? null : note,
  }
}

/** Gövde alanı → form alanı (`month` formda yok; ay seçimi sayfadadır). */
export function lessonHoursFormField(path: string): keyof LessonHoursFormValues | undefined {
  return path === 'membershipId' || path === 'lessonType' || path === 'hours' || path === 'note'
    ? path
    : undefined
}
