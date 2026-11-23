import { z } from 'zod'

import type {
  ClubSelectionPeriodBody,
  ClubSelectionPeriodDetail,
  ClubSelectionPeriodRow,
  ClubSelectionPeriodUpdateBody,
} from '@kampus/react-shared/use-finance-club-selection.ts'
import {
  CLUB_SELECTION_CHOICES_MAX,
  CLUB_SELECTION_GRADE_MAX,
  CLUB_SELECTION_GRADE_MIN,
  CLUB_SELECTION_NAME_MAX,
  CLUB_SELECTION_PHASE_LABELS,
  CLUB_SELECTION_SEATS_MAX,
  clubSelectionTermLabel,
  WAITLIST_STATUS_LABELS,
  type ClubSelectionPhase,
  type WaitlistStatus,
} from '@kampus/school-core/lib/finance-club-selection.ts'

/**
 * Kulüp tercih dönemi görünümünün saf mantığı (DOM-FIN-150; ON-169; K-505…K-507): dönem formunun
 * şeması ve gövdesi, adına tercih taslağı ve liste metinleri. Kural ayrıntısı sunucudadır.
 */

export const GRADE_OPTIONS = Array.from(
  { length: CLUB_SELECTION_GRADE_MAX - CLUB_SELECTION_GRADE_MIN + 1 },
  (_, index) => CLUB_SELECTION_GRADE_MIN + index,
)

/** Bugünün eğitim yılı: Eylülden itibaren o yıl, öncesinde bir önceki yıl. */
export function currentAcademicYear(today: string): number {
  const [year, month] = today.split('-').map(Number)
  if (year === undefined || month === undefined) return new Date().getFullYear()
  return month >= 9 ? year : year - 1
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const count = (max: number, label: string) =>
  z
    .string()
    .trim()
    .refine(
      (value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max,
      `${label} 1 ile ${String(max)} arasında bir tam sayı olmalı.`,
    )

export const periodFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Dönem adını en az 2 karakterle yazın.')
      .max(CLUB_SELECTION_NAME_MAX, `En çok ${String(CLUB_SELECTION_NAME_MAX)} karakter.`),
    academicYear: z.string().regex(/^\d{4}$/, 'Eğitim yılını seçin.'),
    term: z.enum(['', '1', '2']),
    openDate: z.string().regex(DAY, 'Açılış gününü seçin.'),
    closeDate: z.string().regex(DAY, 'Kapanış gününü seçin.'),
    clubIds: z.array(z.string()).min(1, 'En az bir kulüp seçin.'),
    maxChoices: count(CLUB_SELECTION_CHOICES_MAX, 'Tercih sayısı'),
    seatsPerStudent: count(CLUB_SELECTION_SEATS_MAX, 'Atanacak kulüp sayısı'),
    gradeLevels: z.array(z.string()),
  })
  .superRefine((value, context) => {
    if (DAY.test(value.openDate) && DAY.test(value.closeDate) && value.closeDate < value.openDate)
      context.addIssue({
        code: 'custom',
        path: ['closeDate'],
        message: 'Kapanış günü açılıştan önce olamaz.',
      })
    const choices = Number(value.maxChoices)
    if (Number.isInteger(choices) && value.clubIds.length > 0 && choices > value.clubIds.length)
      context.addIssue({
        code: 'custom',
        path: ['maxChoices'],
        message: 'Tercih sayısı seçilen kulüp sayısını aşamaz.',
      })
    const seats = Number(value.seatsPerStudent)
    if (Number.isInteger(seats) && Number.isInteger(choices) && choices >= 1 && seats > choices)
      context.addIssue({
        code: 'custom',
        path: ['seatsPerStudent'],
        message: 'Atanacak kulüp sayısı tercih sayısını aşamaz.',
      })
  })
export type PeriodFormValues = z.infer<typeof periodFormSchema>

export function periodDefaults(
  today: string,
  period?: ClubSelectionPeriodDetail,
): PeriodFormValues {
  if (period === undefined)
    return {
      name: '',
      academicYear: String(currentAcademicYear(today)),
      term: '',
      openDate: today,
      closeDate: '',
      clubIds: [],
      maxChoices: '3',
      seatsPerStudent: '1',
      gradeLevels: [],
    }
  return {
    name: period.name,
    academicYear: String(period.academicYear),
    term: period.term === 1 ? '1' : period.term === 2 ? '2' : '',
    openDate: period.openDate,
    closeDate: period.closeDate,
    clubIds: period.clubs.map((club) => club.id),
    maxChoices: String(period.maxChoices),
    seatsPerStudent: String(period.seatsPerStudent),
    gradeLevels: period.gradeLevels.map(String),
  }
}

export function periodCreateBody(values: PeriodFormValues): ClubSelectionPeriodBody {
  return {
    name: values.name.trim(),
    academicYear: Number(values.academicYear),
    term: values.term === '' ? null : values.term === '1' ? 1 : 2,
    openDate: values.openDate,
    closeDate: values.closeDate,
    clubIds: [...values.clubIds],
    maxChoices: Number(values.maxChoices),
    seatsPerStudent: Number(values.seatsPerStudent),
    gradeLevels: values.gradeLevels.map(Number).sort((a, b) => a - b),
  }
}

const sameList = (a: readonly (string | number)[], b: readonly (string | number)[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

/** Yalnız değişen alanlar; değişiklik yoksa `null`. Kulüp listesinde sıra da değişiklik sayılır. */
export function periodUpdateBody(
  values: PeriodFormValues,
  period: ClubSelectionPeriodDetail,
): ClubSelectionPeriodUpdateBody | null {
  const next = periodCreateBody(values)
  const body: ClubSelectionPeriodUpdateBody = {}
  if (next.name !== period.name) body.name = next.name
  if (next.academicYear !== period.academicYear) body.academicYear = next.academicYear
  if (next.term !== period.term) body.term = next.term ?? null
  if (next.openDate !== period.openDate) body.openDate = next.openDate
  if (next.closeDate !== period.closeDate) body.closeDate = next.closeDate
  const clubIds = next.clubIds
  if (
    !sameList(
      clubIds,
      period.clubs.map((club) => club.id),
    )
  )
    body.clubIds = clubIds
  if (next.maxChoices !== period.maxChoices) body.maxChoices = next.maxChoices
  if (next.seatsPerStudent !== period.seatsPerStudent) body.seatsPerStudent = next.seatsPerStudent
  const grades = next.gradeLevels ?? []
  if (!sameList(grades, period.gradeLevels)) body.gradeLevels = grades
  return Object.keys(body).length === 0 ? null : body
}

const PERIOD_FIELDS = [
  'name',
  'academicYear',
  'term',
  'openDate',
  'closeDate',
  'clubIds',
  'maxChoices',
  'seatsPerStudent',
  'gradeLevels',
] as const
export function periodFormField(name: string): (typeof PERIOD_FIELDS)[number] | null {
  return PERIOD_FIELDS.find((field) => field === name) ?? null
}

/** Seçim kutusu listesine öğe ekler ya da çıkarır (sıra korunur). */
export function toggled(values: readonly string[], value: string, on: boolean): string[] {
  if (on) return values.includes(value) ? [...values] : [...values, value]
  return values.filter((item) => item !== value)
}

/**
 * Adına tercih taslağı (K-505): `maxChoices` uzunlukta sıralı seçimler; boş kutular atlanır,
 * yinelenen kulüp bir kez sayılır. Boş sonuç tercihi geri çeker.
 */
export function choicesFromSlots(slots: readonly string[]): string[] {
  const seen = new Set<string>()
  return slots.filter((clubId) => {
    if (clubId === '' || seen.has(clubId)) return false
    seen.add(clubId)
    return true
  })
}

export function slotsFor(maxChoices: number, choices: readonly string[] = []): string[] {
  return Array.from({ length: maxChoices }, (_, index) => choices[index] ?? '')
}

export const phaseText = (phase: ClubSelectionPhase) => CLUB_SELECTION_PHASE_LABELS[phase]
export const waitlistStatusText = (status: WaitlistStatus) => WAITLIST_STATUS_LABELS[status]

export const termText = (row: Pick<ClubSelectionPeriodRow, 'academicYear' | 'term'>) =>
  clubSelectionTermLabel(row.academicYear, row.term)

export const gradesText = (grades: readonly number[]) =>
  grades.length === 0
    ? 'Bütün sınıflar'
    : grades.map((grade) => `${String(grade)}.`).join(', ') + ' sınıf'

/** Tercih durumu: `12 / 40 öğrenci tercih yaptı`. */
export const progressText = (submitted: number, eligible: number) =>
  `${String(submitted)} / ${String(eligible)} öğrenci tercih yaptı`

/** Kulüp adlarıyla sıralı tercih: `1. Robotik · 2. Satranç`. */
export function choicesText(choices: readonly string[], names: ReadonlyMap<string, string>) {
  if (choices.length === 0) return 'Tercih yok'
  return choices
    .map((clubId, index) => `${String(index + 1)}. ${names.get(clubId) ?? '—'}`)
    .join(' · ')
}
