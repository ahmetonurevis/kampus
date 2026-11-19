import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { addDays } from './finance-opening-watch.ts'

/**
 * Kadro planı ve açık pozisyon (docs/domain/finans.md DOM-FIN-126; ON-188).
 *
 * - **İhtiyaç (K-433):** branş başına haftalık ders saati ihtiyacı plan satırında elle girilir.
 *   Ders programından hesap öneridir: seçilen haftanın (Europe/Istanbul pazartesi–pazar) iptal
 *   edilmemiş her ders kaydı dersinin branşına bir ders saati yazar. Plan satırı olmayan branşta
 *   ihtiyaç olarak program önerisi kullanılır (`requiredSource: 'schedule'`).
 * - **Kapasite (K-434):** branş bağlı etkin öğretmen kaydının dersidir (K-421). Tam zamanlı
 *   öğretmen (yürürlükteki ana ücret tanımı aylık; tanımı yoksa tam zamanlı sayılır) kapasiteye
 *   norm saatiyle girer; birden çok branşı varsa norm branşlarına tam sayı olarak bölünür (kalan
 *   ilk branşlara). Ana ücreti saatlik ya da ders saati olan öğretmen ayrı sayılır, kapasiteye
 *   girmez. Norm öğretmen başına haftalık zorunlu ders saatidir; plan başına, varsayılan 20.
 * - **Açık ve öneri (K-435):** açık = ihtiyaç − kapasite (eksiye düşmez; fazlası `surplusHours`).
 *   Açık ya da ilandaki pozisyonların saati açıktan düşülür, kalan öneri saattir; tam zamanlı
 *   eşdeğeri saat / norm (onda bir hassasiyet). Pozisyon açık → ilanda → dolduruldu ya da iptal;
 *   dolduruldu ve iptal sondur, yalnız açık ya da ilandaki pozisyonun saati, notu ve teklif bağı
 *   değişir. Teklif bağı (DOM-FIN-121) isteğe bağlıdır.
 *
 * Fonksiyonlar saftır.
 */

/** Kadro planını ve pozisyonları yalnız yönetici okur ve yazar. */
export const FINANCE_STAFFING_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const STAFFING_NORM_MIN = 1
export const STAFFING_NORM_MAX = 40
export const STAFFING_NORM_DEFAULT = 20
export const STAFFING_REQUIRED_HOURS_MAX = 2000
export const STAFFING_LINES_MAX = 80
export const STAFFING_POSITION_HOURS_MAX = 60
export const STAFFING_YEAR_MIN = 2000
export const STAFFING_YEAR_MAX = 2100
export const STAFFING_NOTE_MAX = 500

export const STAFFING_POSITION_STATUSES = ['open', 'posted', 'filled', 'cancelled'] as const
export type StaffingPositionStatus = (typeof STAFFING_POSITION_STATUSES)[number]

export const STAFFING_POSITION_STATUS_LABELS: Record<StaffingPositionStatus, string> = {
  open: 'Açık',
  posted: 'İlanda',
  filled: 'Dolduruldu',
  cancelled: 'İptal',
}

/** Açıktan düşülen (henüz dolmamış) durumlar. */
export const STAFFING_ACTIVE_STATUSES = [
  'open',
  'posted',
] as const satisfies StaffingPositionStatus[]

const TRANSITIONS: Record<StaffingPositionStatus, readonly StaffingPositionStatus[]> = {
  open: ['posted', 'filled', 'cancelled'],
  posted: ['open', 'filled', 'cancelled'],
  filled: [],
  cancelled: [],
}

export const STAFFING_PAY_BASES = ['full_time', 'hourly', 'unknown'] as const
export type StaffingPayBasis = (typeof STAFFING_PAY_BASES)[number]

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

// --- Şemalar ---------------------------------------------------------------------------------------

export const staffingYearSchema = z.coerce
  .number()
  .int('Eğitim yılı tam sayı olmalı.')
  .min(STAFFING_YEAR_MIN, 'Eğitim yılı geçersiz.')
  .max(STAFFING_YEAR_MAX, 'Eğitim yılı geçersiz.')

const subjectIdSchema = z
  .string()
  .trim()
  .min(1, 'Branş seçin.')
  .max(40, 'Branş kimliği en çok 40 karakter.')

export const staffingLineSchema = z.strictObject({
  subjectId: subjectIdSchema,
  requiredHours: z
    .number()
    .int('İhtiyaç saati tam sayı olmalı.')
    .min(0, 'İhtiyaç saati eksi olamaz.')
    .max(STAFFING_REQUIRED_HOURS_MAX, `İhtiyaç saati en çok ${STAFFING_REQUIRED_HOURS_MAX}.`),
})
export type StaffingLine = z.infer<typeof staffingLineSchema>

/** Plan yazımı (bütün): norm ve branş satırları; aynı branş iki kez yazılamaz. */
export const staffingPlanInputSchema = z.strictObject({
  normHours: z
    .number()
    .int('Norm tam sayı olmalı.')
    .min(STAFFING_NORM_MIN, `Norm en az ${STAFFING_NORM_MIN} saat.`)
    .max(STAFFING_NORM_MAX, `Norm en çok ${STAFFING_NORM_MAX} saat.`),
  lines: z
    .array(staffingLineSchema)
    .max(STAFFING_LINES_MAX, `En çok ${STAFFING_LINES_MAX} branş satırı.`)
    .superRefine((lines, context) => {
      const seen = new Set<string>()
      for (const [index, line] of lines.entries()) {
        if (seen.has(line.subjectId))
          context.addIssue({
            code: 'custom',
            path: [index, 'subjectId'],
            message: 'Aynı branş iki kez yazılamaz.',
          })
        seen.add(line.subjectId)
      }
    }),
})
export type StaffingPlanInput = z.infer<typeof staffingPlanInputSchema>

const noteSchema = z
  .string()
  .trim()
  .max(STAFFING_NOTE_MAX, `Not en çok ${STAFFING_NOTE_MAX} karakter.`)
  .transform((value) => (value === '' ? null : value))
  .nullable()

const positionHoursSchema = z
  .number()
  .int('Saat tam sayı olmalı.')
  .min(1, 'Saat en az 1.')
  .max(STAFFING_POSITION_HOURS_MAX, `Saat en çok ${STAFFING_POSITION_HOURS_MAX}.`)

const offerIdSchema = z.uuid('Teklif kimliği geçersiz.').nullable()

export const staffingPositionInputSchema = z.strictObject({
  academicYear: staffingYearSchema,
  subjectId: subjectIdSchema,
  hours: positionHoursSchema,
  note: noteSchema.default(null),
  jobOfferId: offerIdSchema.default(null),
})
export type StaffingPositionInput = z.infer<typeof staffingPositionInputSchema>

export const staffingPositionUpdateSchema = z
  .strictObject({
    status: z.enum(STAFFING_POSITION_STATUSES).optional(),
    hours: positionHoursSchema.optional(),
    note: noteSchema.optional(),
    jobOfferId: offerIdSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan gönderin.',
  })
export type StaffingPositionUpdate = z.infer<typeof staffingPositionUpdateSchema>

// --- Plan --------------------------------------------------------------------------------------------

export interface StaffingPlanState {
  normHours: number
  lines: StaffingLine[]
}

/** Satırlar branşa göre sıralanır; değişiklik yoksa 422 (K-433). */
export function planStaffingPlan(current: StaffingPlanState, input: StaffingPlanInput) {
  const lines = [...input.lines].sort((a, b) => a.subjectId.localeCompare(b.subjectId))
  const next = { normHours: input.normHours, lines }
  const changed: string[] = []
  if (current.normHours !== next.normHours) changed.push('normHours')
  if (JSON.stringify(current.lines) !== JSON.stringify(lines)) changed.push('lines')
  if (changed.length === 0)
    throw ruleError('staffing_plan_unchanged', 'Kadro planında değişen bir alan yok.', 'lines')
  return { next, changed }
}

// --- Pozisyon ----------------------------------------------------------------------------------------

export interface StaffingPositionState {
  status: StaffingPositionStatus
  hours: number
  note: string | null
  jobOfferId: string | null
}

/** Durum geçişi ve alan değişikliği (K-435); değişen alan adları döner. */
export function planStaffingPositionUpdate(
  current: StaffingPositionState,
  update: StaffingPositionUpdate,
): { next: StaffingPositionState; changed: string[] } {
  if (TRANSITIONS[current.status].length === 0)
    throw ruleError(
      'staffing_position_closed',
      `${STAFFING_POSITION_STATUS_LABELS[current.status]} durumundaki pozisyon değişmez.`,
      'status',
    )
  if (
    update.status !== undefined &&
    update.status !== current.status &&
    !TRANSITIONS[current.status].includes(update.status)
  )
    throw ruleError('staffing_position_transition', 'Bu durum geçişi yapılamaz.', 'status')
  const next: StaffingPositionState = {
    status: update.status ?? current.status,
    hours: update.hours ?? current.hours,
    note: update.note === undefined ? current.note : update.note,
    jobOfferId: update.jobOfferId === undefined ? current.jobOfferId : update.jobOfferId,
  }
  const changed = (Object.keys(next) as (keyof StaffingPositionState)[]).filter(
    (key) => next[key] !== current[key],
  )
  if (changed.length === 0)
    throw ruleError('staffing_position_unchanged', 'Pozisyonda değişen bir alan yok.', 'status')
  return { next, changed }
}

// --- Hesap -------------------------------------------------------------------------------------------

/** Haftanın pazartesisi ve pazarı (gün `YYYY-MM-DD`, takvim günü). */
export function staffingWeek(day: string): { startDate: string; endDate: string } {
  const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay()
  const startDate = addDays(day, -((weekday + 6) % 7))
  return { startDate, endDate: addDays(startDate, 6) }
}

export interface StaffingLesson {
  subjectId: string
  cancelled: boolean
}

/** Programdan branş başına haftalık ders saati önerisi (K-433): iptal edilmemiş her ders bir saat. */
export function scheduleHoursBySubject(lessons: readonly StaffingLesson[]): Map<string, number> {
  const hours = new Map<string, number>()
  for (const lesson of lessons)
    if (!lesson.cancelled && lesson.subjectId !== '')
      hours.set(lesson.subjectId, (hours.get(lesson.subjectId) ?? 0) + 1)
  return hours
}

export interface StaffingTeacher {
  membershipId: string
  /** Branşlar (K-421), sıralı. */
  subjectIds: readonly string[]
  payBasis: StaffingPayBasis
}

export interface StaffingPositionHours {
  subjectId: string
  hours: number
  status: StaffingPositionStatus
}

export interface StaffingRow {
  subjectId: string
  requiredHours: number
  requiredSource: 'plan' | 'schedule'
  scheduleHours: number
  fullTimeTeachers: number
  hourlyTeachers: number
  capacityHours: number
  gapHours: number
  surplusHours: number
  openPositionHours: number
  suggestedHours: number
  suggestedFte: number
}

const tenths = (hours: number, norm: number) => Math.round((hours * 10) / norm) / 10

/**
 * Branş satırları (K-433…K-435): plan, program, öğretmen ve pozisyonlardaki bütün branşlar.
 * Sıra branş kimliğine göredir (ad istemcide).
 */
export function staffingRows(input: {
  normHours: number
  lines: readonly StaffingLine[]
  scheduleHours: ReadonlyMap<string, number>
  teachers: readonly StaffingTeacher[]
  positions: readonly StaffingPositionHours[]
}): StaffingRow[] {
  const { normHours } = input
  const planned = new Map(input.lines.map((line) => [line.subjectId, line.requiredHours]))
  const fullTime = new Map<string, number>()
  const hourly = new Map<string, number>()
  const capacity = new Map<string, number>()
  const add = (map: Map<string, number>, key: string, value: number) =>
    map.set(key, (map.get(key) ?? 0) + value)
  for (const teacher of input.teachers) {
    const branches = [...new Set(teacher.subjectIds)]
    if (branches.length === 0) continue
    if (teacher.payBasis === 'hourly') {
      for (const subjectId of branches) add(hourly, subjectId, 1)
      continue
    }
    const share = Math.floor(normHours / branches.length)
    const remainder = normHours % branches.length
    for (const [index, subjectId] of branches.entries()) {
      add(fullTime, subjectId, 1)
      add(capacity, subjectId, share + (index < remainder ? 1 : 0))
    }
  }
  const openHours = new Map<string, number>()
  for (const position of input.positions)
    if ((STAFFING_ACTIVE_STATUSES as readonly string[]).includes(position.status))
      add(openHours, position.subjectId, position.hours)
  const subjects = new Set([
    ...planned.keys(),
    ...input.scheduleHours.keys(),
    ...fullTime.keys(),
    ...hourly.keys(),
    ...input.positions.map((position) => position.subjectId),
  ])
  return [...subjects].sort().map((subjectId) => {
    const scheduleHours = input.scheduleHours.get(subjectId) ?? 0
    const plannedHours = planned.get(subjectId)
    const requiredHours = plannedHours ?? scheduleHours
    const capacityHours = capacity.get(subjectId) ?? 0
    const gapHours = Math.max(0, requiredHours - capacityHours)
    const openPositionHours = openHours.get(subjectId) ?? 0
    const suggestedHours = Math.max(0, gapHours - openPositionHours)
    return {
      subjectId,
      requiredHours,
      requiredSource: plannedHours === undefined ? 'schedule' : 'plan',
      scheduleHours,
      fullTimeTeachers: fullTime.get(subjectId) ?? 0,
      hourlyTeachers: hourly.get(subjectId) ?? 0,
      capacityHours,
      gapHours,
      surplusHours: Math.max(0, capacityHours - requiredHours),
      openPositionHours,
      suggestedHours,
      suggestedFte: tenths(suggestedHours, normHours),
    }
  })
}

/** Toplam satırı (öğretmen sayıları kişi değil branş kaydıdır; birden çok branşlı iki kez sayılır). */
export function staffingTotals(rows: readonly StaffingRow[], normHours: number) {
  const sum = (key: keyof StaffingRow) =>
    rows.reduce((total, row) => total + (typeof row[key] === 'number' ? row[key] : 0), 0)
  const suggestedHours = sum('suggestedHours')
  return {
    requiredHours: sum('requiredHours'),
    scheduleHours: sum('scheduleHours'),
    capacityHours: sum('capacityHours'),
    gapHours: sum('gapHours'),
    surplusHours: sum('surplusHours'),
    openPositionHours: sum('openPositionHours'),
    suggestedHours,
    suggestedFte: tenths(suggestedHours, normHours),
  }
}
