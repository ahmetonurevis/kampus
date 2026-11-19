import {
  STAFFING_NORM_MAX,
  STAFFING_NORM_MIN,
  STAFFING_POSITION_STATUS_LABELS,
  STAFFING_REQUIRED_HOURS_MAX,
  type StaffingPositionStatus,
} from '@kampus/school-core/lib/finance-staffing-plans.ts'

/**
 * Kadro planı sekmesinin saf yardımcıları (DOM-FIN-126; ON-188): eğitim yılı seçimi, plan formu
 * ve pozisyon eylemleri. Hesap sunucudadır; burada yalnız biçim ve form dönüşümü vardır.
 */

/** Eylülden itibaren yeni eğitim yılı (başlangıç yılı). */
export function currentAcademicYear(day: string): number {
  const [year, month] = day.split('-').map(Number)
  return (month ?? 1) >= 9 ? (year ?? 2000) : (year ?? 2001) - 1
}

export const academicYearLabel = (year: number) => `${String(year)}–${String(year + 1)}`

export const yearOptions = (current: number) => [current - 1, current, current + 1]

/** Tam zamanlı eşdeğeri: onda bir, Türkçe ondalık. */
export const fteText = (value: number) =>
  value.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })

export interface StaffingPlanFormValues {
  normHours: string
  /** Branş → ihtiyaç saati metni; boş = ders programı önerisi. */
  hours: Record<string, string>
}

export function planFormDefaults(plan: {
  normHours: number
  lines: readonly { subjectId: string; requiredHours: number }[]
  subjects: readonly { id: string }[]
}): StaffingPlanFormValues {
  const hours: Record<string, string> = {}
  for (const subject of plan.subjects) hours[subject.id] = ''
  for (const line of plan.lines) hours[line.subjectId] = String(line.requiredHours)
  return { normHours: String(plan.normHours), hours }
}

type Issue = { field: string; message: string }

const wholeNumber = (text: string) => (/^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : null)

/** Form → gövde; boş saat satır yazmaz (program önerisi geçerli olur). */
export function planFormBody(
  values: StaffingPlanFormValues,
):
  | { body: { normHours: number; lines: { subjectId: string; requiredHours: number }[] } }
  | { issues: Issue[] } {
  const issues: Issue[] = []
  const norm = wholeNumber(values.normHours)
  if (norm === null || norm < STAFFING_NORM_MIN || norm > STAFFING_NORM_MAX)
    issues.push({
      field: 'normHours',
      message: `Norm ${String(STAFFING_NORM_MIN)} ile ${String(STAFFING_NORM_MAX)} arası tam sayı olmalı.`,
    })
  const lines: { subjectId: string; requiredHours: number }[] = []
  for (const [subjectId, text] of Object.entries(values.hours)) {
    if (text.trim() === '') continue
    const hours = wholeNumber(text)
    if (hours === null || hours > STAFFING_REQUIRED_HOURS_MAX)
      issues.push({
        field: `hours.${subjectId}`,
        message: `İhtiyaç saati 0 ile ${String(STAFFING_REQUIRED_HOURS_MAX)} arası tam sayı olmalı.`,
      })
    else lines.push({ subjectId, requiredHours: hours })
  }
  return issues.length > 0 || norm === null ? { issues } : { body: { normHours: norm, lines } }
}

/** Pozisyonun izinli durum eylemleri (K-435); son durumlarda boş. */
export function positionActions(
  status: StaffingPositionStatus,
): { status: StaffingPositionStatus; label: string }[] {
  switch (status) {
    case 'open':
      return [
        { status: 'posted', label: 'İlana çıkar' },
        { status: 'filled', label: 'Dolduruldu' },
        { status: 'cancelled', label: 'İptal et' },
      ]
    case 'posted':
      return [
        { status: 'open', label: 'İlandan al' },
        { status: 'filled', label: 'Dolduruldu' },
        { status: 'cancelled', label: 'İptal et' },
      ]
    case 'filled':
    case 'cancelled':
      return []
    default:
      return status satisfies never
  }
}

export const positionStatusLabel = (status: StaffingPositionStatus) =>
  STAFFING_POSITION_STATUS_LABELS[status]

/** Satırın açık ya da fazla metni. */
export function balanceText(row: { gapHours: number; surplusHours: number }) {
  if (row.gapHours > 0) return `${String(row.gapHours)} saat açık`
  if (row.surplusHours > 0) return `${String(row.surplusHours)} saat fazla`
  return 'Dengede'
}
