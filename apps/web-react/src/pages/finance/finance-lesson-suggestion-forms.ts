// Programdan ek ders önerisi ekranının saf mantığı (DOM-FIN-165; ON-195): parametre doğrulama,
// tablo satırı, aktarılabilirlik, toplu aktarım satırları, düzeltme formu ve döküm metinleri.
// Sınırlar core şemalarıyla aynıdır.
import { z } from 'zod'
import type {
  LessonHourSuggestionItem,
  LessonHourSuggestions,
  LessonHourSuggestionTeacher,
  TransferLessonHourSuggestionsBody,
} from '@kampus/react-shared/use-finance-lesson-hour-suggestions.ts'
import {
  LESSON_ITEM_KIND_LABELS,
  LESSON_ITEM_STATUS_LABELS,
  lessonSuggestionQuerySchema,
  SUGGESTION_PAY_BASIS_LABELS,
  SUGGESTION_WARNING_LABELS,
  WEEKLY_CAP_DEFAULT,
  WEEKLY_LOAD_DEFAULT,
  type LessonSuggestionParams,
} from '@kampus/school-core/lib/finance-lesson-hour-suggestions.ts'
import { PAYROLL_LESSON_HOURS_MAX } from '@kampus/school-core/lib/finance-payroll-exports.ts'
import {
  PAYROLL_REASON_MAX,
  PAYROLL_REASON_MIN,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'

export type SuggestionParamValues = { weeklyLoad: string; weeklyCap: string }

export const SUGGESTION_PARAM_DEFAULTS: SuggestionParamValues = {
  weeklyLoad: String(WEEKLY_LOAD_DEFAULT),
  weeklyCap: String(WEEKLY_CAP_DEFAULT),
}

/** Parametre alanları: geçerliyse sorgu parametreleri, değilse alan başına Türkçe hata. */
export function suggestionParams(values: SuggestionParamValues): {
  params: LessonSuggestionParams | null
  errors: Partial<Record<keyof SuggestionParamValues, string>>
} {
  const errors: Partial<Record<keyof SuggestionParamValues, string>> = {}
  for (const key of ['weeklyLoad', 'weeklyCap'] as const)
    if (!/^\d+$/.test(values[key].trim())) errors[key] = 'Tam sayı girin.'
  if (Object.keys(errors).length > 0) return { params: null, errors }
  const parsed = lessonSuggestionQuerySchema.safeParse({
    weeklyLoad: values.weeklyLoad.trim(),
    weeklyCap: values.weeklyCap.trim(),
  })
  if (parsed.success) return { params: parsed.data, errors }
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] === 'weeklyLoad' ? 'weeklyLoad' : 'weeklyCap'
    errors[key] ??= issue.message
  }
  return { params: null, errors }
}

/** Fark metni: "+2", "−3", "0"; öneri yoksa "—". */
export function differenceText(value: number | null): string {
  if (value === null) return '—'
  if (value > 0) return `+${String(value)}`
  if (value < 0) return `−${String(-value)}`
  return '0'
}

export type SuggestionRow = {
  id: string
  staff: string
  payBasis: string
  counted: string
  load: string
  suggested: string
  current: string
  difference: string
  warnings: string
}

export function suggestionRow(teacher: LessonHourSuggestionTeacher): SuggestionRow {
  return {
    id: teacher.membershipId,
    staff: teacher.staffActive ? teacher.staffName : `${teacher.staffName} (pasif)`,
    payBasis: SUGGESTION_PAY_BASIS_LABELS[teacher.payBasis],
    counted: `${String(teacher.totals.countedHours)} saat`,
    load: teacher.applicable ? `${String(teacher.totals.loadHours)} saat` : '—',
    suggested:
      teacher.suggestedHours === null ? 'Öneri yok' : `${String(teacher.suggestedHours)} saat`,
    current: teacher.currentHours === null ? 'Girilmedi' : `${String(teacher.currentHours)} saat`,
    difference: differenceText(teacher.difference),
    warnings: teacher.warnings.map((code) => SUGGESTION_WARNING_LABELS[code]).join('; '),
  }
}

/** Öneri tek tıkla aktarılabilir mi: ay açık, öneri var ve sıfırdan büyük, elle giriş farklı. */
export function canTransfer(
  data: Pick<LessonHourSuggestions, 'transferable'>,
  teacher: LessonHourSuggestionTeacher,
): boolean {
  return (
    data.transferable &&
    teacher.suggestedHours !== null &&
    teacher.suggestedHours > 0 &&
    teacher.currentHours !== teacher.suggestedHours
  )
}

/** Düzeltilerek aktarılabilir mi: ay açık ve öneri verilebilen öğretmen. */
export const canCorrect = (
  data: Pick<LessonHourSuggestions, 'transferable'>,
  teacher: LessonHourSuggestionTeacher,
) => data.transferable && teacher.suggestedHours !== null

/** Toplu aktarım: tek tıkla aktarılabilen bütün öğretmenler, öneriyle. */
export function bulkTransferBody(data: LessonHourSuggestions): TransferLessonHourSuggestionsBody {
  return {
    weeklyLoad: data.weeklyLoad,
    weeklyCap: data.weeklyCap,
    items: data.teachers
      .filter((teacher) => canTransfer(data, teacher))
      .map((teacher) => ({
        membershipId: teacher.membershipId,
        suggestedHours: teacher.suggestedHours ?? 0,
        hours: teacher.suggestedHours ?? 0,
        reason: null,
      })),
  }
}

/** Tek öğretmenin aktarımı (öneriyle ya da düzeltilmiş saat ve gerekçeyle). */
export function transferBody(
  data: Pick<LessonHourSuggestions, 'weeklyLoad' | 'weeklyCap'>,
  teacher: LessonHourSuggestionTeacher,
  values?: TransferFormValues,
): TransferLessonHourSuggestionsBody {
  const suggested = teacher.suggestedHours ?? 0
  const reason = values?.reason.trim() ?? ''
  return {
    weeklyLoad: data.weeklyLoad,
    weeklyCap: data.weeklyCap,
    items: [
      {
        membershipId: teacher.membershipId,
        suggestedHours: suggested,
        hours: values === undefined ? suggested : Number(values.hours.trim()),
        reason: reason === '' ? null : reason,
      },
    ],
  }
}

export type TransferFormValues = { hours: string; reason: string }

export const transferDefaults = (teacher: LessonHourSuggestionTeacher): TransferFormValues => ({
  hours: teacher.suggestedHours === null ? '' : String(teacher.suggestedHours),
  reason: '',
})

/** Düzeltme formu: saat 1–400 tam sayı; öneriden farklı saatte gerekçe 5–500. */
export function transferFormSchema(suggested: number) {
  return z.object({ hours: z.string(), reason: z.string() }).superRefine((values, ctx) => {
    const text = values.hours.trim()
    const hours = Number(text)
    if (!/^\d+$/.test(text) || hours < 1 || hours > PAYROLL_LESSON_HOURS_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: ['hours'],
        message: `Saati 1 ile ${String(PAYROLL_LESSON_HOURS_MAX)} arasında tam sayı girin.`,
      })
      return
    }
    const reason = values.reason.trim()
    if (hours !== suggested && reason.length < PAYROLL_REASON_MIN)
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message:
          reason === ''
            ? 'Öneriden farklı saat için gerekçe yazın.'
            : `Gerekçe en az ${String(PAYROLL_REASON_MIN)} karakter olmalıdır.`,
      })
    if (reason.length > PAYROLL_REASON_MAX)
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: `Gerekçe en fazla ${String(PAYROLL_REASON_MAX)} karakter olabilir.`,
      })
  })
}

/** Aktarımın neden kapalı olduğu; açıksa `null`. */
export function transferNotice(
  data: Pick<LessonHourSuggestions, 'transferable' | 'payrollLocked' | 'sheetStatus'>,
): string | null {
  if (data.transferable) return null
  if (data.payrollLocked)
    return 'Bu ayın bordro dönemi kilitli; öneri aktarılamaz. Fark için bordro dönemlerinde düzeltme kaydı girin.'
  if (data.sheetStatus === 'approved')
    return 'Bu ayın ek ders çizelgesi müdür onaylı; aktarmak için çizelgeyi yeniden açın.'
  return 'Gelecek ayın önerisi aktarılmaz.'
}

/** Döküm satırı: "09.00 · Matematik · 9-A sınıfı · 1 ders saati" ve durum metni. */
export function lessonItemText(item: LessonHourSuggestionItem): {
  main: string
  status: string
} {
  const title = item.title ?? 'Ders'
  const main = [
    timeLabel(item.startsAt),
    title,
    item.className ?? (item.classId === '' ? null : item.classId),
    `${String(item.hours)} ders saati`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
  const parts: string[] = [LESSON_ITEM_STATUS_LABELS[item.status]]
  if (item.kind !== 'own') parts.push(LESSON_ITEM_KIND_LABELS[item.kind])
  if (item.status === 'holiday' && item.holidayTitle !== null) parts.push(item.holidayTitle)
  if (item.status === 'counted') {
    const split: string[] = []
    if (item.loadHours > 0) split.push(`${String(item.loadHours)} maaş karşılığı`)
    if (item.extraHours > 0) split.push(`${String(item.extraHours)} ek ders`)
    if (item.overCapHours > 0) split.push(`${String(item.overCapHours)} üst sınır üstü`)
    if (split.length > 0) parts.push(split.join(', '))
  }
  if (item.attendanceMissing === true) parts.push('Sınıfın yoklaması alınmamış')
  return { main, status: parts.join(' · ') }
}

/** Gün başlığı: "14 Eylül Pazartesi". */
export const dayHeading = (day: string) =>
  dateLabel(`${day}T09:00:00.000Z`, { month: 'long', weekday: 'long' })

/** Hafta özeti: "7–13 Eylül: 20 saat · 15 maaş karşılığı · 5 ek ders (bu aya 5)". */
export function weekText(week: LessonHourSuggestionTeacher['weeks'][number]): string {
  const range = `${dateLabel(`${week.startDate}T09:00:00.000Z`)} – ${dateLabel(`${week.endDate}T09:00:00.000Z`)}`
  const parts = [
    `${String(week.countedHours)} saat`,
    `${String(week.loadHours)} maaş karşılığı`,
    `${String(week.extraHours)} ek ders (bu aya ${String(week.extraInMonth)})`,
  ]
  if (week.overCapHours > 0) parts.push(`${String(week.overCapHours)} üst sınır üstü`)
  return `${range}: ${parts.join(' · ')}`
}
