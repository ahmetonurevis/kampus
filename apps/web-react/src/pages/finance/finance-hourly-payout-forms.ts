import type {
  HourlyLessonPayoutLine,
  HourlyLessonPayoutTeacher,
} from '@kampus/react-shared/use-finance-hourly-lesson-payouts.ts'
import {
  PAYOUT_LINE_KIND_LABELS,
  PAYOUT_LINE_STATUS_LABELS,
  PAYOUT_PAY_BASIS_LABELS,
  PAYOUT_UNPRICED_LABELS,
  PAYOUT_WARNING_LABELS,
  payoutRateText,
} from '@kampus/school-core/lib/finance-hourly-lesson-payouts.ts'
import { payrollMonthSchema } from '@kampus/school-core/lib/finance-payroll-exports.ts'
import { dateLabel, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

// Ders saati hakediş dökümünün gösterimi (DOM-FIN-167; ON-075). Saf metin ve ton yardımcıları;
// hesap sunucudadır, burada yeniden yapılmaz.

/** Varsayılan ay: döküm biten ay için hazırlanır (bir önceki ay). */
export function defaultPayoutMonth(today: string): string {
  const [year, month] = today.split('-').map(Number) as [number, number]
  return month === 1
    ? `${String(year - 1)}-12`
    : `${String(year)}-${String(month - 1).padStart(2, '0')}`
}

/** Seçilen ay geçerliyse kendisi, değilse `null` (istek atılmaz). */
export const validPayoutMonth = (value: string) =>
  payrollMonthSchema.safeParse(value).success ? value : null

export const payoutDayText = (day: string) =>
  dateLabel(`${day}T09:00:00.000Z`, { weekday: 'short', day: 'numeric', month: 'short' })

/** "09:00 · 40 dk · 1 ders saati". */
export const payoutLineTimeText = (
  line: Pick<HourlyLessonPayoutLine, 'startsAt' | 'minutes' | 'hours'>,
) => `${timeLabel(line.startsAt)} · ${String(line.minutes)} dk · ${String(line.hours)} ders saati`

export const payoutStatusText = (line: Pick<HourlyLessonPayoutLine, 'status'>) =>
  PAYOUT_LINE_STATUS_LABELS[line.status]

export function payoutStatusTone(line: Pick<HourlyLessonPayoutLine, 'status'>): BadgeTone {
  switch (line.status) {
    case 'counted':
      return 'green'
    case 'cancelled':
      return 'red'
    case 'upcoming':
    case 'duplicate':
      return 'amber'
    case 'holiday':
    case 'leave':
    case 'substituted_out':
      return 'gray'
    default:
      return line.status satisfies never
  }
}

export const payoutKindText = (line: Pick<HourlyLessonPayoutLine, 'kind'>) =>
  PAYOUT_LINE_KIND_LABELS[line.kind]

/** Satırın yeri: sınıf ya da grup adı, yoksa ders kimliği. */
export const payoutPlaceText = (
  line: Pick<HourlyLessonPayoutLine, 'placeName' | 'classId' | 'groupId'>,
) => line.placeName ?? line.classId ?? line.groupId ?? '—'

/** Satır tutarı ya da neden boş olduğu. */
export function payoutAmountText(
  line: Pick<HourlyLessonPayoutLine, 'status' | 'amountCents' | 'unpriced'>,
): string {
  if (line.amountCents !== null) return money(line.amountCents)
  if (line.status !== 'counted') return 'Ödenmez'
  return line.unpriced === null ? '—' : PAYOUT_UNPRICED_LABELS[line.unpriced]
}

export const payoutLineRateText = (line: Pick<HourlyLessonPayoutLine, 'rateType' | 'rateCents'>) =>
  payoutRateText(line.rateType, line.rateCents)

export const payoutBasisText = (teacher: Pick<HourlyLessonPayoutTeacher, 'payBasis'>) =>
  PAYOUT_PAY_BASIS_LABELS[teacher.payBasis]

export const payoutWarningText = (code: HourlyLessonPayoutTeacher['warnings'][number]) =>
  PAYOUT_WARNING_LABELS[code]

export const payoutWarningTone = (
  code: HourlyLessonPayoutTeacher['warnings'][number],
): BadgeTone => (code === 'group_plan' ? 'purple' : 'amber')

/** "3 ders, 4 ders saati · 1 iptal · 1 telafi". */
export function payoutTotalsText(totals: HourlyLessonPayoutTeacher['totals']): string {
  return `${String(totals.givenLessons)} ders, ${String(totals.givenHours)} ders saati · ${String(totals.cancelledLessons)} iptal · ${String(totals.makeupLessons)} telafi`
}

/** "1 Oca 2026'dan" ya da "1 Oca – 14 Eyl 2026" (ay içindeki ücret dilimi). */
export function payoutRatePeriodText(rate: { startDate: string; endDate: string | null }): string {
  const start = dateLabel(`${rate.startDate}T09:00:00.000Z`, { year: 'numeric' })
  if (rate.endDate === null) return `${start} itibarıyla`
  return `${start} – ${dateLabel(`${rate.endDate}T09:00:00.000Z`, { year: 'numeric' })}`
}
