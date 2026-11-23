import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

import type { SuggestionLesson } from '@kampus/school-core/lib/finance-lesson-hour-suggestions.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from './client.ts'
import { loadRecords, recordFilter, type DayRangeMatch } from './records.ts'
import { users } from './schema/auth.ts'
import { lessonHourSuggestions } from './schema/finance-lesson-hour-suggestions.ts'
import { records } from './schema/records.ts'

/**
 * Programdan ek ders önerisi deposu (DOM-FIN-165; ON-195). Ders programı (`schedule`) ve yoklama
 * (`attendance`) Oğuzhan'ın koleksiyonlarıdır; yalnız okunur. Aktarım satırı değişmez.
 */

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

/**
 * Aralıktaki (Europe/Istanbul günü; süzgeci servis kurar) dersler: iptal edilenler dahil, telafi
 * çıkarımı için açılış anı ve açık telafi bağı (`makeupForLessonId`; ders programında henüz yok)
 * ile.
 */
export async function loadSuggestionLessons(
  db: Database,
  institutionId: string,
  range: DayRangeMatch,
): Promise<SuggestionLesson[]> {
  const rows = await loadRecords(db, institutionId, ['schedule'], { match: [range] })
  return rows.flatMap((row) => {
    const date = text(row.data.date)
    const teacherId = text(row.data.teacherId)
    if (date === null || teacherId === null || Number.isNaN(Date.parse(date))) return []
    const createdAt = text(row.data.createdAt)
    return [
      {
        id: row.id,
        date: new Date(date).toISOString(),
        duration: typeof row.data.duration === 'number' ? row.data.duration : 0,
        classId: text(row.data.classId) ?? '',
        subjectId: text(row.data.subjectId) ?? '',
        title: text(row.data.title) ?? text(row.data.subject),
        teacherId,
        originalTeacherId: text(row.data.originalTeacherId),
        cancelledAt: text(row.data.cancelledAt),
        createdAt: createdAt !== null && !Number.isNaN(Date.parse(createdAt)) ? createdAt : null,
        makeupForLessonId: text(row.data.makeupForLessonId),
      },
    ]
  })
}

/**
 * Yoklaması alınmış sınıf günleri (`sınıf|gün`, Europe/Istanbul). Yoklama öğrenci başına satırdır;
 * yalnız farklı sınıf ve tarih çiftleri okunur, öğrenci ve durum okunmaz.
 */
export async function loadAttendanceClassDays(
  db: Database,
  institutionId: string,
  range: DayRangeMatch,
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({
      classId: sql<string | null>`${records.data} ->> 'classId'`,
      date: sql<string | null>`${records.data} ->> 'date'`,
    })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'attendance'),
        isNull(records.archivedAt),
        recordFilter(range),
      ),
    )
  const days = new Set<string>()
  for (const row of rows) {
    if (row.classId === null || row.date === null || Number.isNaN(Date.parse(row.date))) continue
    days.add(`${row.classId}|${dayKey(row.date)}`)
  }
  return days
}

export interface StoredLessonHourSuggestion {
  id: string
  monthStart: string
  membershipId: string
  lessonHoursId: string
  suggestedHours: number
  previousHours: number | null
  hours: number
  reason: string | null
  weeklyLoad: number
  weeklyCap: number
  createdByName: string | null
  createdAt: Date
}

/** Ayın aktarımları, yeniden eskiye. */
export async function listLessonHourSuggestions(
  db: Database,
  institutionId: string,
  monthStart: string,
): Promise<StoredLessonHourSuggestion[]> {
  const t = lessonHourSuggestions
  return db
    .select({
      id: t.id,
      monthStart: t.monthStart,
      membershipId: t.membershipId,
      lessonHoursId: t.lessonHoursId,
      suggestedHours: t.suggestedHours,
      previousHours: t.previousHours,
      hours: t.hours,
      reason: t.reason,
      weeklyLoad: t.weeklyLoad,
      weeklyCap: t.weeklyCap,
      createdByName: users.name,
      createdAt: t.createdAt,
    })
    .from(t)
    .leftJoin(users, eq(users.id, t.createdByUserId))
    .where(
      and(eq(t.institutionId, institutionId), isNull(t.archivedAt), eq(t.monthStart, monthStart)),
    )
    .orderBy(desc(t.createdAt), asc(t.id))
}

export async function insertLessonHourSuggestion(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    monthStart: string
    membershipId: string
    lessonHoursId: string
    suggestedHours: number
    previousHours: number | null
    hours: number
    reason: string | null
    weeklyLoad: number
    weeklyCap: number
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(lessonHourSuggestions)
    .values({ institutionId, ...fields, createdAt: now, updatedAt: now })
}
