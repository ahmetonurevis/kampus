import { z } from 'zod'

import type { InstitutionType } from '../modules/collection-modules.ts'
import { dayKey } from './format.ts'
import { OPEN_PROSPECT_STAGES, type ProspectStage } from './prospects.ts'

/**
 * Kayıt sezonu nöbeti (docs/domain/kayit-ve-crm.md DOM-KAY-037; IST-079, IST-091; ON-077). Ön
 * büro ve yöneticinin bugün ve yakın günlerde ilgilenmesi gereken adaylar: penceredeki tanışma
 * görüşmeleri, (dil okulunda) deneme dersleri ve geciken takipler. Hiçbir şey saklanmaz; her satır
 * açık adayların var olan kayıtlarından türetilir. Saf modüldür: API depodan yalnız nöbette okunan
 * alanları verir; `now` ISO anıdır, günler Europe/Istanbul günüdür.
 *
 * Satır aday kimliği, adı, aşaması ve kampüs adını taşır; telefon, e-posta, veli, not metni, ilgi,
 * kaynak ve deneme sonucunun kendisi girdiye de alınmaz (K-179).
 */

z.config(z.locales.tr())

/** Pencere: bugün dahil 7 gün, 1–14 seçilebilir (K-175). */
export const SEASON_WATCH_DAYS = { min: 1, max: 14, default: 7 } as const
/** Son işlemi bu kadar gün ya da daha eski aday "temas kesildi" sayılır (K-177). */
export const SEASON_STALE_DAYS = 7
/** Bölüm başına en çok satır; tamamı aday ve görüşme listelerindedir (K-179). */
export const SEASON_WATCH_ROW_LIMIT = 50
/** Görünümü okuyan roller (K-179); modül `crm`. */
export const SEASON_WATCH_ROLES = ['yonetici', 'onburo'] as const
/** Süresi saklanmamış eski görüşmenin süresi (`lib/prospects.ts`, `lib/tutor-conflicts.ts` ile aynı). */
const LEGACY_MEETING_MINUTES = 30

export const seasonWatchQuerySchema = z.strictObject({
  days: z.coerce
    .number()
    .int('Gün sayısı tam sayı olmalı.')
    .min(SEASON_WATCH_DAYS.min, `Pencere en az ${String(SEASON_WATCH_DAYS.min)} gün olmalı.`)
    .max(SEASON_WATCH_DAYS.max, `Pencere en çok ${String(SEASON_WATCH_DAYS.max)} gün olabilir.`)
    .optional()
    .describe(
      `Bugün dahil pencere uzunluğu (gün, ${String(SEASON_WATCH_DAYS.min)}–${String(SEASON_WATCH_DAYS.max)}); verilmezse ${String(SEASON_WATCH_DAYS.default)}`,
    ),
})
export type SeasonWatchQuery = z.output<typeof seasonWatchQuerySchema>

/** Geciken takip nedenleri, öncelik sırasıyla (K-178). */
export const SEASON_FOLLOW_UP_REASONS = [
  'first_contact',
  'meeting_outcome',
  'trial_outcome',
  'stale',
] as const
export type SeasonFollowUpReason = (typeof SEASON_FOLLOW_UP_REASONS)[number]
export const SEASON_FOLLOW_UP_LABELS = {
  first_contact: 'İlk temas bekliyor',
  meeting_outcome: 'Görüşme sonucu bekleniyor',
  trial_outcome: 'Deneme sonrası takip',
  stale: 'Temas kesildi',
} as const satisfies Record<SeasonFollowUpReason, string>

const DAY_MS = 86_400_000

/** `YYYY-MM-DD` güne gün ekler (takvim günü; saat dilimi yok). */
export function addDays(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** İki takvim günü arasındaki gün farkı (`to − from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS,
  )
}

export interface SeasonWindow {
  /** Bugün (Europe/Istanbul). */
  from: string
  /** Pencerenin son günü (dahil). */
  to: string
  days: number
}

/** Pencere bugünden başlar; `days` verilmezse 7 gün (K-175). */
export function seasonWatchWindow(now: string, days?: number): SeasonWindow {
  const length = days ?? SEASON_WATCH_DAYS.default
  const from = dayKey(now)
  return { from, to: addDays(from, length - 1), days: length }
}

// --- Girdi satırları -------------------------------------------------------------------------

/** Adaydan nöbette okunan alanlar; iletişim, veli, not metni ve ilgi yok. */
export interface SeasonProspect {
  id: string
  name: string
  stage: string
  branchId: string | null
  createdAt: string | null
  updatedAt: string | null
  /** Görüşme anı (eski okuyucular için `meeting.date` kopyası; eski kayıtta tek bilgi). */
  trialAt: string | null
  meeting: {
    date: string
    duration: number | null
    room: string | null
    teacherId: string | null
  } | null
  trialLesson: {
    lessonId: string
    classId: string | null
    /** Öğretmen sonucu yazdı mı (DOM-DIL-031); sonucun kendisi okunmaz. */
    hasResult: boolean
  } | null
  /** En yeni notun anı; not yoksa `null`. */
  lastNoteAt: string | null
}

/** Deneme dersinin bağlı olduğu dersin güncel kaydı. */
export interface SeasonLesson {
  id: string
  classId: string | null
  date: string
  duration: number
  cancelledAt: string | null
}

export interface SeasonWatchInput {
  now: string
  window: SeasonWindow
  institutionType: InstitutionType
  prospects: readonly SeasonProspect[]
  lessons: readonly SeasonLesson[]
  branches: ReadonlyMap<string, string>
  classes: ReadonlyMap<string, string>
  teachers: ReadonlyMap<string, string>
}

// --- Çıktı ---------------------------------------------------------------------------------

interface ProspectBase {
  prospectId: string
  name: string
  stage: ProspectStage
  branchName: string | null
}

export interface SeasonMeetingRow extends ProspectBase {
  date: string
  duration: number
  room: string | null
  teacherName: string | null
  /** Bitişi geçmiş (bugünün yapılmış görüşmesi). */
  held: boolean
}

export interface SeasonTrialRow extends ProspectBase {
  date: string
  duration: number
  groupName: string | null
  held: boolean
  resultRecorded: boolean
}

export interface SeasonFollowUpRow extends ProspectBase {
  reason: SeasonFollowUpReason
  /** Nedenin dayandığı gün (açılış, görüşme, deneme ya da son işlem günü). */
  sinceDate: string
  /** Dayanak günden bugüne geçen gün. */
  days: number
  /** Yalnız `trial_outcome`: öğretmen sonucu yazdı mı; diğer nedenlerde `null`. */
  trialResultRecorded: boolean | null
}

export interface SeasonWatch {
  window: SeasonWindow
  trialsEnabled: boolean
  summary: {
    meetingsToday: number
    meetingsInWindow: number
    trialsToday: number
    trialsInWindow: number
    followUps: number
    followUpsByReason: Record<SeasonFollowUpReason, number>
    newToday: number
  }
  meetings: { total: number; rows: SeasonMeetingRow[] }
  trials: { total: number; rows: SeasonTrialRow[] }
  followUps: { total: number; rows: SeasonFollowUpRow[] }
}

// --- Hesap ---------------------------------------------------------------------------------

const OPEN = new Set<string>(OPEN_PROSPECT_STAGES)
const isOpen = (stage: string): stage is ProspectStage => OPEN.has(stage)
const at = (value: string | null | undefined) => {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}
const later = (...values: (number | null)[]) =>
  values.reduce<number | null>(
    (max, value) => (value !== null && (max === null || value > max) ? value : max),
    null,
  )

interface Slot {
  date: string
  start: number
  end: number
}

/** Görüşme: `trialAt` görüşmenin anıdır (`scheduleProspectMeeting` ikisini birlikte yazar). */
function meetingSlot(prospect: SeasonProspect): Slot | null {
  const date = prospect.trialAt ?? prospect.meeting?.date ?? null
  const start = at(date)
  if (date === null || start === null) return null
  const minutes = prospect.meeting?.duration ?? LEGACY_MEETING_MINUTES
  return { date, start, end: start + minutes * 60_000 }
}

/** Deneme: gün ve saat dersin güncel kaydından; iptal edilen ya da kalkan ders deneme değildir. */
function trialSlot(
  prospect: SeasonProspect,
  lessons: ReadonlyMap<string, SeasonLesson>,
): (Slot & { lesson: SeasonLesson }) | null {
  const trial = prospect.trialLesson
  if (!trial) return null
  const lesson = lessons.get(trial.lessonId)
  if (!lesson || lesson.cancelledAt) return null
  const start = at(lesson.date)
  if (start === null) return null
  return { date: lesson.date, start, end: start + lesson.duration * 60_000, lesson }
}

/**
 * Takip nedeni (DOM-KAY-037; K-176…K-178). Şu andan sonra başlayan görüşmesi ya da denemesi olan
 * aday takip listesine girmez; yoksa nedenler öncelik sırasıyla denenir.
 */
export function followUpReason(input: {
  prospect: SeasonProspect
  meeting: Slot | null
  trial: Slot | null
  trialsEnabled: boolean
  now: number
  today: string
}): { reason: SeasonFollowUpReason; sinceDate: string } | null {
  const { prospect, meeting, trial, now, today } = input
  const usableTrial = input.trialsEnabled ? trial : null
  if ((meeting && meeting.start > now) || (usableTrial && usableTrial.start > now)) return null
  const created = at(prospect.createdAt)
  if (prospect.stage === 'Yeni aday' && created !== null) {
    const createdDay = dayKey(created)
    if (createdDay < today) return { reason: 'first_contact', sinceDate: createdDay }
  }
  const lastNote = at(prospect.lastNoteAt)
  if (prospect.stage === 'Görüşme planlandı') {
    // Görüşme ve deneme ikisi de yapıldıysa sonraki geçerlidir.
    const events = [
      meeting ? { reason: 'meeting_outcome' as const, slot: meeting } : null,
      usableTrial ? { reason: 'trial_outcome' as const, slot: usableTrial } : null,
    ].filter((item) => item !== null)
    const latest = events.sort((left, right) => right.slot.start - left.slot.start)[0]
    if (latest) {
      const eventDay = dayKey(latest.slot.start)
      if (eventDay < today && (lastNote === null || lastNote <= latest.slot.start))
        return { reason: latest.reason, sinceDate: eventDay }
    }
  }
  const last = later(
    created,
    at(prospect.updatedAt),
    lastNote,
    meeting && meeting.start <= now ? meeting.start : null,
    usableTrial && usableTrial.start <= now ? usableTrial.start : null,
  )
  if (last === null) return null
  const lastDay = dayKey(last)
  if (daysBetween(lastDay, today) >= SEASON_STALE_DAYS)
    return { reason: 'stale', sinceDate: lastDay }
  return null
}

const byDate = <T extends { date: string; name: string }>(left: T, right: T) =>
  Date.parse(left.date) - Date.parse(right.date) || left.name.localeCompare(right.name, 'tr')

/** Kayıt sezonu nöbeti (DOM-KAY-037). Girdi değişmez; sonuç her okumada yeniden hesaplanır. */
export function prospectSeasonWatch(input: SeasonWatchInput): SeasonWatch {
  const { window } = input
  const now = Date.parse(input.now)
  const today = window.from
  const trialsEnabled = input.institutionType === 'language_school'
  const lessons = new Map(input.lessons.map((lesson) => [lesson.id, lesson]))
  const inWindow = (day: string) => day >= window.from && day <= window.to

  const meetings: SeasonMeetingRow[] = []
  const trials: SeasonTrialRow[] = []
  const followUps: SeasonFollowUpRow[] = []
  let newToday = 0

  for (const prospect of input.prospects) {
    if (!isOpen(prospect.stage)) continue
    const base: ProspectBase = {
      prospectId: prospect.id,
      name: prospect.name,
      stage: prospect.stage,
      branchName:
        prospect.branchId === null ? null : (input.branches.get(prospect.branchId) ?? null),
    }
    if (
      prospect.createdAt &&
      at(prospect.createdAt) !== null &&
      dayKey(prospect.createdAt) === today
    )
      newToday += 1
    const meeting = meetingSlot(prospect)
    if (meeting && inWindow(dayKey(meeting.start)))
      meetings.push({
        ...base,
        date: meeting.date,
        duration: (meeting.end - meeting.start) / 60_000,
        room: prospect.meeting?.room ?? null,
        teacherName:
          prospect.meeting?.teacherId == null
            ? null
            : (input.teachers.get(prospect.meeting.teacherId) ?? null),
        held: meeting.end <= now,
      })
    const trial = trialsEnabled ? trialSlot(prospect, lessons) : null
    if (trial && inWindow(dayKey(trial.start))) {
      const classId = trial.lesson.classId ?? prospect.trialLesson?.classId ?? null
      trials.push({
        ...base,
        date: trial.date,
        duration: trial.lesson.duration,
        groupName: classId === null ? null : (input.classes.get(classId) ?? null),
        held: trial.end <= now,
        resultRecorded: prospect.trialLesson?.hasResult === true,
      })
    }
    const due = followUpReason({ prospect, meeting, trial, trialsEnabled, now, today })
    if (due)
      followUps.push({
        ...base,
        reason: due.reason,
        sinceDate: due.sinceDate,
        days: daysBetween(due.sinceDate, today),
        trialResultRecorded:
          due.reason === 'trial_outcome' ? prospect.trialLesson?.hasResult === true : null,
      })
  }

  meetings.sort(byDate)
  trials.sort(byDate)
  followUps.sort(
    (left, right) =>
      right.days - left.days ||
      SEASON_FOLLOW_UP_REASONS.indexOf(left.reason) -
        SEASON_FOLLOW_UP_REASONS.indexOf(right.reason) ||
      left.name.localeCompare(right.name, 'tr'),
  )
  const followUpsByReason = Object.fromEntries(
    SEASON_FOLLOW_UP_REASONS.map((reason) => [
      reason,
      followUps.filter((row) => row.reason === reason).length,
    ]),
  ) as Record<SeasonFollowUpReason, number>
  const isToday = (row: { date: string }) => dayKey(row.date) === today

  return {
    window,
    trialsEnabled,
    summary: {
      meetingsToday: meetings.filter(isToday).length,
      meetingsInWindow: meetings.length,
      trialsToday: trials.filter(isToday).length,
      trialsInWindow: trials.length,
      followUps: followUps.length,
      followUpsByReason,
      newToday,
    },
    meetings: { total: meetings.length, rows: meetings.slice(0, SEASON_WATCH_ROW_LIMIT) },
    trials: { total: trials.length, rows: trials.slice(0, SEASON_WATCH_ROW_LIMIT) },
    followUps: { total: followUps.length, rows: followUps.slice(0, SEASON_WATCH_ROW_LIMIT) },
  }
}
