import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import { OPEN_PROSPECT_STAGES } from '@kampus/school-core/lib/prospects.ts'
import type { SeasonLesson, SeasonProspect } from '@kampus/school-core/lib/prospect-season-watch.ts'

import type { Database } from './client.ts'
import { records } from './schema/records.ts'

/**
 * Kayıt sezonu nöbetinin (DOM-KAY-037) kurum kapsamlı okumaları. Adaydan yalnız nöbette okunan
 * alanlar çekilir: telefon, e-posta, veli, ilgi, kaynak ve not metni belleğe yüklenmez; notlardan
 * yalnız en yeni notun anı, deneme sonucundan yalnız varlığı okunur. Arşivlenen kayıt sayılmaz.
 */

const text = (path: string) => sql<string | null>`(${records.data} ->> ${path}::text)`
const nested = (parent: string, field: string) =>
  sql<string | null>`(${records.data} -> ${parent}::text ->> ${field}::text)`
const isObject = (parent: string) =>
  sql<boolean>`coalesce(jsonb_typeof(${records.data} -> ${parent}::text), 'null') = 'object'`

const toNumber = (value: string | null) => {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Kurumun açık aşamadaki adayları (DOM-KAY-037). */
export async function loadSeasonProspects(
  db: Database,
  institutionId: string,
): Promise<SeasonProspect[]> {
  const rows = await db
    .select({
      id: records.id,
      name: text('name'),
      stage: text('stage'),
      branchId: text('branchId'),
      createdAt: text('createdAt'),
      updatedAt: text('updatedAt'),
      trialAt: text('trialAt'),
      hasMeeting: isObject('meeting'),
      meetingDate: nested('meeting', 'date'),
      meetingDuration: nested('meeting', 'duration'),
      meetingRoom: nested('meeting', 'room'),
      meetingTeacherId: nested('meeting', 'teacherId'),
      hasTrial: isObject('trialLesson'),
      trialLessonId: nested('trialLesson', 'lessonId'),
      trialClassId: nested('trialLesson', 'classId'),
      trialHasResult: sql<boolean>`coalesce(jsonb_typeof(${records.data} -> 'trialLesson' -> 'result'), 'null') = 'object'`,
      // ISO anları aynı biçimde saklandığı için metin olarak en büyüğü en yenisidir.
      lastNoteAt: sql<
        string | null
      >`(select max(note ->> 'date') from jsonb_array_elements(case when jsonb_typeof(${records.data} -> 'notes') = 'array' then ${records.data} -> 'notes' else '[]'::jsonb end) as note)`,
    })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'prospects'),
        isNull(records.archivedAt),
        inArray(text('stage'), [...OPEN_PROSPECT_STAGES]),
      ),
    )
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? '',
    stage: row.stage ?? '',
    branchId: row.branchId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    trialAt: row.trialAt,
    meeting:
      row.hasMeeting && row.meetingDate !== null
        ? {
            date: row.meetingDate,
            duration: toNumber(row.meetingDuration),
            room: row.meetingRoom,
            teacherId: row.meetingTeacherId,
          }
        : null,
    trialLesson:
      row.hasTrial && row.trialLessonId !== null
        ? { lessonId: row.trialLessonId, classId: row.trialClassId, hasResult: row.trialHasResult }
        : null,
    lastNoteAt: row.lastNoteAt,
  }))
}

/** Deneme derslerinin bağlı olduğu derslerin güncel kaydı; programdan kalkan ders dönmez. */
export async function loadSeasonLessons(
  db: Database,
  institutionId: string,
  lessonIds: readonly string[],
): Promise<SeasonLesson[]> {
  if (lessonIds.length === 0) return []
  const rows = await db
    .select({
      id: records.id,
      classId: text('classId'),
      date: text('date'),
      duration: text('duration'),
      cancelledAt: text('cancelledAt'),
    })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'schedule'),
        isNull(records.archivedAt),
        inArray(records.id, [...new Set(lessonIds)]),
      ),
    )
  return rows.flatMap((row) =>
    row.date === null
      ? []
      : [
          {
            id: row.id,
            classId: row.classId,
            date: row.date,
            duration: toNumber(row.duration) ?? 0,
            cancelledAt: row.cancelledAt,
          },
        ],
  )
}

/** Kampüs, grup ya da öğretmen adları (personel ve kurum bilgisi); arşivlenen kayıt dahil. */
export async function loadRecordNames(
  db: Database,
  institutionId: string,
  collection: 'branches' | 'classes' | 'teachers',
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: records.id, name: text('name') })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, collection),
        inArray(records.id, [...new Set(ids)]),
      ),
    )
  return new Map(rows.flatMap((row) => (row.name === null ? [] : [[row.id, row.name] as const])))
}
