// İzin talebi formları ve gösterimi (DOM-FIN-116; ON-182; K-397…K-399). Form düz metin
// alanlarıdır; gövde core şemasıyla (`leaveRequestCreateSchema`) aynı mesajlarla denetlenir. Yedek
// öğretmen seçimi ders kimliğinden öğretmen kaydına haritadır; boş metin "seçilmedi"dir.
import { z } from 'zod'
import type {
  CreateLeaveRequestBody,
  LeaveRequestLessonView,
  LeaveRequestTeacher,
  LeaveSubstituteChoice,
} from '@kampus/react-shared/use-finance-leave-requests.ts'
import {
  LEAVE_REQUEST_DESCRIPTION_MAX,
  LEAVE_REQUEST_STATUS_LABELS,
  leaveRequestCreateSchema,
  SUBSTITUTE_WARNING_LABELS,
  weekdayCount,
  type LeaveRequestStatus,
  type SubstituteWarning,
} from '@kampus/school-core/lib/finance-leave-requests.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

type Issue = { path: PropertyKey[]; message: string }

const integerText = /^\d{1,3}$/
const parseInteger = (text: string) => (integerText.test(text.trim()) ? Number(text.trim()) : null)

const requestFields = z.object({
  membershipId: z.string().min(1, 'Personel seçin.'),
  typeCode: z.string().min(1, 'İzin türünü seçin.'),
  startDate: z.string(),
  endDate: z.string(),
  days: z.string(),
  description: z
    .string()
    .max(
      LEAVE_REQUEST_DESCRIPTION_MAX,
      `En fazla ${String(LEAVE_REQUEST_DESCRIPTION_MAX)} karakter girebilirsiniz.`,
    ),
})
export type LeaveRequestFormValues = z.input<typeof requestFields>
type RequestField = keyof LeaveRequestFormValues
const REQUEST_FIELDS: Readonly<Record<string, RequestField>> = {
  membershipId: 'membershipId',
  typeCode: 'typeCode',
  startDate: 'startDate',
  endDate: 'endDate',
  days: 'days',
  description: 'description',
}
export const leaveRequestFormField = (path: string): RequestField | undefined =>
  REQUEST_FIELDS[path]

export function leaveRequestDefaults(today: string): LeaveRequestFormValues {
  return {
    membershipId: '',
    typeCode: 'annual',
    startDate: today,
    endDate: today,
    days: String(Math.max(1, weekdayCount(today, today))),
    description: '',
  }
}

/** Yedek seçimi: ders kimliği → öğretmen kaydı (`''` seçilmedi). */
export type SubstituteChoices = Readonly<Record<string, string>>

/** Seçilmiş yedekler gövde biçiminde (seçilmeyen ders gönderilmez). */
export const chosenSubstitutes = (choices: SubstituteChoices): LeaveSubstituteChoice[] =>
  Object.entries(choices)
    .filter(([, teacherId]) => teacherId !== '')
    .map(([lessonId, teacherId]) => ({ lessonId, substituteTeacherId: teacherId }))

export function leaveRequestBody(
  values: LeaveRequestFormValues,
  choices: SubstituteChoices = {},
): CreateLeaveRequestBody {
  return {
    membershipId: values.membershipId,
    typeCode: values.typeCode,
    startDate: values.startDate,
    endDate: values.endDate,
    days: parseInteger(values.days) ?? Number.NaN,
    description: values.description.trim() === '' ? null : values.description.trim(),
    substitutes: chosenSubstitutes(choices),
  }
}

export const leaveRequestFormSchema = requestFields.superRefine((values, context) => {
  if (parseInteger(values.days) === null) {
    context.addIssue({
      code: 'custom',
      path: ['days'],
      message: 'Gün sayısı tam sayı olmalıdır; yarım gün izin yoktur.',
    })
    return
  }
  const parsed = leaveRequestCreateSchema.safeParse(leaveRequestBody(values))
  if (!parsed.success)
    for (const issue of parsed.error.issues as readonly Issue[]) {
      const field = leaveRequestFormField(issue.path.map(String).join('.'))
      context.addIssue({ code: 'custom', path: field ? [field] : [], message: issue.message })
    }
})

/** Önizleme sorgusu: personel ve geçerli aralık varsa; yoksa `null` (sorgu kapalı). */
export function previewQuery(
  values: Pick<
    LeaveRequestFormValues,
    'membershipId' | 'typeCode' | 'startDate' | 'endDate' | 'days'
  >,
) {
  if (values.membershipId === '') return null
  if (!daySchema.safeParse(values.startDate).success) return null
  if (!daySchema.safeParse(values.endDate).success) return null
  if (values.endDate < values.startDate) return null
  const days = parseInteger(values.days)
  return {
    membershipId: values.membershipId,
    startDate: values.startDate,
    endDate: values.endDate,
    ...(values.typeCode === '' ? {} : { typeCode: values.typeCode }),
    ...(days === null || days < 1 ? {} : { days }),
  }
}

/** Hafta içi gün önerisi metni (genel tatil bilinmez). */
export function weekdayHint(startDate: string, endDate: string): string | undefined {
  if (!daySchema.safeParse(startDate).success || !daySchema.safeParse(endDate).success)
    return undefined
  if (endDate < startDate) return undefined
  return `Aralıkta ${String(weekdayCount(startDate, endDate))} hafta içi gün var; genel tatilleri düşün.`
}

// --- Gösterim ------------------------------------------------------------------------------------

export const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
export const daysText = (days: number) => `${String(days)} gün`
export const rangeText = (item: { startDate: string; endDate: string }) =>
  item.startDate === item.endDate
    ? dayText(item.startDate)
    : `${dayText(item.startDate)} – ${dayText(item.endDate)}`

export const statusLabel = (status: LeaveRequestStatus) => LEAVE_REQUEST_STATUS_LABELS[status]
export function statusTone(status: LeaveRequestStatus): BadgeTone {
  switch (status) {
    case 'pending':
      return 'amber'
    case 'approved':
      return 'green'
    case 'rejected':
      return 'red'
    case 'cancelled':
      return 'gray'
    default:
      return status satisfies never
  }
}

export const STATUS_OPTIONS = (
  Object.entries(LEAVE_REQUEST_STATUS_LABELS) as [LeaveRequestStatus, string][]
).map(([value, label]) => ({ value, label }))

/** Ders satırı: "2 Kas 2026 09.00 · 9-A · Matematik". */
export function lessonText(
  lesson: Pick<LeaveRequestLessonView, 'startsAt' | 'className' | 'classId' | 'title'>,
) {
  return `${dateLabel(lesson.startsAt, { year: 'numeric' })} ${timeLabel(lesson.startsAt)} · ${lesson.className ?? lesson.classId} · ${lesson.title}`
}

export const warningText = (warnings: readonly SubstituteWarning[]) =>
  warnings.map((warning) => SUBSTITUTE_WARNING_LABELS[warning]).join(', ')

/** Adayın bu dersteki uyarıları. */
export const candidateWarnings = (
  lesson: Pick<LeaveRequestLessonView, 'candidateWarnings'>,
  teacherId: string,
): SubstituteWarning[] =>
  lesson.candidateWarnings.find((item) => item.teacherId === teacherId)?.warnings ?? []

/** Yedek seçeneğinin etiketi: "Murat Demir (bu saatte başka dersi var)". */
export function substituteOptionLabel(
  teacher: LeaveRequestTeacher,
  lesson: Pick<LeaveRequestLessonView, 'candidateWarnings'>,
) {
  const warnings = candidateWarnings(lesson, teacher.id)
  return warnings.length === 0
    ? teacher.name
    : `${teacher.name} (${warningText(warnings).toLocaleLowerCase('tr')})`
}

/** Mevcut seçim haritası (detayda). */
export const currentChoices = (
  lessons: readonly Pick<LeaveRequestLessonView, 'lessonId' | 'substituteTeacherId'>[],
): Record<string, string> =>
  Object.fromEntries(lessons.map((lesson) => [lesson.lessonId, lesson.substituteTeacherId ?? '']))

/** Değişen yedek seçimleri (detayda kaydedilecekler; `''` yedeği kaldırır). */
export function changedSubstitutes(
  lessons: readonly Pick<LeaveRequestLessonView, 'lessonId' | 'substituteTeacherId'>[],
  choices: SubstituteChoices,
): LeaveSubstituteChoice[] {
  return lessons.flatMap((lesson) => {
    const chosen = choices[lesson.lessonId]
    if (chosen === undefined || chosen === (lesson.substituteTeacherId ?? '')) return []
    return [{ lessonId: lesson.lessonId, substituteTeacherId: chosen === '' ? null : chosen }]
  })
}

/** Onay sonrası kalan yıllık izin metni; eksi avans izindir. */
export function balanceText(balanceAfterDays: number | null): string | null {
  if (balanceAfterDays === null) return null
  return balanceAfterDays < 0
    ? `Onaylanırsa yıllık izin ${daysText(balanceAfterDays)} olur (avans izin).`
    : `Onaylanırsa kalan yıllık izin ${daysText(balanceAfterDays)}.`
}

/** Liste satırındaki ders özeti: "2 ders · 1 yedek" ya da "Ders yok". */
export const lessonSummary = (item: { lessonCount: number; substitutedCount: number }) =>
  item.lessonCount === 0
    ? 'Ders yok'
    : `${String(item.lessonCount)} ders · ${String(item.substitutedCount)} yedek`
