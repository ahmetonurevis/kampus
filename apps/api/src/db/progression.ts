import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'

import {
  type CourseAssessmentDraft,
  type CourseAssessmentRow,
  type LessonHourAttendance,
  type LessonAttendanceStatus,
} from '@kampus/school-core/cefr/progression.ts'
import { CORE_SKILLS } from '@kampus/school-core/cefr/suggestion.ts'
import type { GroupMemberStatus } from '@kampus/school-core/lib/language-groups.ts'

import type { Database } from './client.ts'
import { courseAssessments, lessonHourAttendances } from './schema/cefr.ts'
import { languageGroupMembers } from './schema/language-groups.ts'

/**
 * Kur ilerlemesi deposu (OG-086; IST-062; DOM-DIL-013, 060, 061, 070). Kurum kapsamlıdır: ilk
 * parametre `institutionId`. Kur kaydı (`language_group_members` satırı), kur içi ölçmeler
 * (`course_assessments`, değişmez) ve ders saati yoklaması (`lesson_hour_attendances`) okunur ve
 * yazılır; kural core `cefr/progression.ts`'tedir. Arşivlenmiş satır okunmaz.
 */

/** Kur kaydı: dil grubundaki kursiyer satırı (core `CourseEnrollment.id`). */
export type StoredEnrollment = {
  id: string
  groupId: string
  // kvkk: K
  studentId: string
  status: GroupMemberStatus
}

const enrollmentColumns = {
  id: languageGroupMembers.id,
  groupId: languageGroupMembers.groupId,
  studentId: languageGroupMembers.studentId,
  status: languageGroupMembers.status,
}

/** Kurumun arşivlenmemiş kur kaydı; yoksa ya da başka kurumunsa `null`. */
export async function findEnrollment(
  db: Database,
  institutionId: string,
  enrollmentId: string,
): Promise<StoredEnrollment | null> {
  const [row] = await db
    .select(enrollmentColumns)
    .from(languageGroupMembers)
    .where(
      and(
        eq(languageGroupMembers.institutionId, institutionId),
        eq(languageGroupMembers.id, enrollmentId),
        isNull(languageGroupMembers.archivedAt),
      ),
    )
  return row ?? null
}

/** Grubun arşivlenmemiş kur kayıtları, katılım sırasıyla. */
export async function listGroupEnrollments(
  db: Database,
  institutionId: string,
  groupId: string,
): Promise<StoredEnrollment[]> {
  return db
    .select(enrollmentColumns)
    .from(languageGroupMembers)
    .where(
      and(
        eq(languageGroupMembers.institutionId, institutionId),
        eq(languageGroupMembers.groupId, groupId),
        isNull(languageGroupMembers.archivedAt),
      ),
    )
    .orderBy(asc(languageGroupMembers.joinedAt), asc(languageGroupMembers.studentId))
}

/** Kurumun arşivlenmemiş aktif kur kayıtları (tüm gruplar), katılım sırasıyla; günlük iş tek okur. */
export async function listActiveEnrollments(
  db: Database,
  institutionId: string,
): Promise<StoredEnrollment[]> {
  return db
    .select(enrollmentColumns)
    .from(languageGroupMembers)
    .where(
      and(
        eq(languageGroupMembers.institutionId, institutionId),
        eq(languageGroupMembers.status, 'active'),
        isNull(languageGroupMembers.archivedAt),
      ),
    )
    .orderBy(asc(languageGroupMembers.joinedAt), asc(languageGroupMembers.studentId))
}

// --- Kur içi ölçme ------------------------------------------------------------------------

/** jsonb'deki beceri satırları core sırasıyla doğrulanır; bozuk satır beklenmeyen hatadır. */
const skillsSchema = z
  .array(
    z.object({
      skill: z.enum(CORE_SKILLS),
      score: z.number().min(0).max(100),
      feedback: z.string().nullable(),
    }),
  )
  .length(CORE_SKILLS.length)

type AssessmentRow = typeof courseAssessments.$inferSelect

function toAssessment(row: AssessmentRow): CourseAssessmentRow {
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    point: row.point,
    score: row.score,
    skills: skillsSchema.parse(row.skills),
    assessedAt: row.assessedAt.toISOString(),
    assessedByUserId: row.assessedByUserId,
  }
}

/**
 * Core `planCourseAssessment` çıktısını yazar. Kayıtta aynı noktanın ikinci ölçmesi 23505
 * (`course_assessments_enrollment_point_key`), kaydın grubu ya da kursiyeri olmayan değer 23503 ile
 * reddedilir.
 */
export async function insertCourseAssessment(
  db: Database,
  institutionId: string,
  draft: CourseAssessmentDraft & { groupId: string; learnerId: string },
  id: string = randomUUID(),
): Promise<CourseAssessmentRow> {
  const [row] = await db
    .insert(courseAssessments)
    .values({
      institutionId,
      id,
      enrollmentId: draft.enrollmentId,
      groupId: draft.groupId,
      learnerId: draft.learnerId,
      point: draft.point,
      score: draft.score,
      skills: skillsSchema.parse(draft.skills),
      assessedByUserId: draft.assessedByUserId,
      assessedAt: new Date(draft.assessedAt),
    })
    .returning()
  if (row === undefined) throw new Error('course assessment insert returned no row')
  return toAssessment(row)
}

/** Kayıtların ölçmeleri, ölçme anına göre eskiden yeniye. */
export async function listCourseAssessments(
  db: Database,
  institutionId: string,
  enrollmentIds: readonly string[],
): Promise<CourseAssessmentRow[]> {
  if (enrollmentIds.length === 0) return []
  const rows = await db
    .select()
    .from(courseAssessments)
    .where(
      and(
        eq(courseAssessments.institutionId, institutionId),
        inArray(courseAssessments.enrollmentId, [...enrollmentIds]),
        isNull(courseAssessments.archivedAt),
      ),
    )
    .orderBy(asc(courseAssessments.assessedAt), asc(courseAssessments.id))
  return rows.map(toAssessment)
}

// --- Ders saati yoklaması -----------------------------------------------------------------

/** Kayıt başına ders saati satırları (core `attendanceSummary` girdisi). */
export async function listLessonHourAttendances(
  db: Database,
  institutionId: string,
  enrollmentIds: readonly string[],
): Promise<Map<string, LessonHourAttendance[]>> {
  const byEnrollment = new Map<string, LessonHourAttendance[]>()
  if (enrollmentIds.length === 0) return byEnrollment
  const rows = await db
    .select({
      enrollmentId: lessonHourAttendances.enrollmentId,
      lessonHourId: lessonHourAttendances.lessonHourId,
      status: lessonHourAttendances.status,
      excused: lessonHourAttendances.excused,
    })
    .from(lessonHourAttendances)
    .where(
      and(
        eq(lessonHourAttendances.institutionId, institutionId),
        inArray(lessonHourAttendances.enrollmentId, [...enrollmentIds]),
        isNull(lessonHourAttendances.archivedAt),
      ),
    )
    .orderBy(asc(lessonHourAttendances.lessonHourId))
  for (const row of rows) {
    const list = byEnrollment.get(row.enrollmentId) ?? []
    list.push({ lessonHourId: row.lessonHourId, status: row.status, excused: row.excused })
    byEnrollment.set(row.enrollmentId, list)
  }
  return byEnrollment
}

/**
 * Ders saati satırlarını yazar. Bugün yalnız testler ve örnek veri çağırır; yoklama alma ucu ders
 * saati yoklamasıyla gelir (`TODO(cefr-ders-saati-yoklamasi)`, OG-269). Aynı ders saatinin ikinci
 * satırı 23505 (`lesson_hour_attendances_enrollment_hour_key`).
 */
export async function insertLessonHourAttendances(
  db: Database,
  institutionId: string,
  enrollment: { id: string; groupId: string; studentId: string },
  rows: readonly {
    lessonHourId: string
    status: LessonAttendanceStatus
    excused?: boolean
  }[],
  recorded: { userId: string; at: Date },
): Promise<void> {
  if (rows.length === 0) return
  await db.insert(lessonHourAttendances).values(
    rows.map((row) => ({
      institutionId,
      id: randomUUID(),
      enrollmentId: enrollment.id,
      groupId: enrollment.groupId,
      learnerId: enrollment.studentId,
      lessonHourId: row.lessonHourId,
      status: row.status,
      excused: row.excused ?? false,
      recordedByUserId: recorded.userId,
      recordedAt: recorded.at,
    })),
  )
}
