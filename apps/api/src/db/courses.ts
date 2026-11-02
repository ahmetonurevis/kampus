import { and, eq, sql } from 'drizzle-orm'

import { courseNameKey, courseProgramKey, type Course } from '@kampus/school-core/lib/courses.ts'

import type { Database } from './client.ts'
import { courses } from './schema/courses.ts'

/**
 * Kur programı deposu (IST-076; DOM-DIL-005…007). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kurumun kurları azdır (katalog, onlarca satır): işlem tutarlılık kuralları (ad ve
 * program kodu tekilliği, sonraki kur zinciri) için arşivliler dahil hepsi yüklenir; okuma
 * sıralaması ve sayfalama serviste core `orderedCourses` ile yapılır.
 */

type CourseRow = typeof courses.$inferSelect

export type StoredCourse = Course & {
  rowVersion: number
  createdAt: string
  updatedAt: string
}

const iso = (value: Date | null) => (value === null ? null : value.toISOString())
const at = (value: string | null) => (value === null ? null : new Date(value))

function toCourse(row: CourseRow): StoredCourse {
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    level: row.level,
    skillFocus: row.skillFocus,
    description: row.description,
    totalHours: row.totalHours,
    weeklyHours: row.weeklyHours,
    sessionMinutes: row.sessionMinutes,
    minLearners: row.minLearners,
    maxLearners: row.maxLearners,
    certified: row.certified,
    nextCourseId: row.nextCourseId,
    status: row.status,
    activatedAt: iso(row.activatedAt),
    archivedAt: iso(row.archivedAt),
    eOzel: {
      programCode: row.eOzelProgramCode,
      approval: row.eOzelApproval,
      recordedAt: iso(row.eOzelRecordedAt),
      recordedByUserId: row.eOzelRecordedByUserId,
    },
    rowVersion: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Kurumun bütün kurları (arşivliler dahil; görünürlük ve süzgeç servistedir). */
export async function loadCourses(db: Database, institutionId: string): Promise<StoredCourse[]> {
  const rows = await db.select().from(courses).where(eq(courses.institutionId, institutionId))
  return rows.map(toCourse)
}

/** Kurun yazılan kolonları; tekillik anahtarları core'dan türetilir. */
const columns = (course: Course) => ({
  name: course.name,
  nameKey: courseNameKey(course.name),
  language: course.language,
  level: course.level,
  skillFocus: [...course.skillFocus],
  description: course.description,
  totalHours: course.totalHours,
  weeklyHours: course.weeklyHours,
  sessionMinutes: course.sessionMinutes,
  minLearners: course.minLearners,
  maxLearners: course.maxLearners,
  certified: course.certified,
  nextCourseId: course.nextCourseId,
  status: course.status,
  activatedAt: at(course.activatedAt),
  archivedAt: at(course.archivedAt),
  eOzelProgramCode: course.eOzel.programCode,
  eOzelProgramKey:
    course.eOzel.programCode === null ? null : courseProgramKey(course.eOzel.programCode),
  eOzelApproval: course.eOzel.approval,
  eOzelRecordedAt: at(course.eOzel.recordedAt),
  eOzelRecordedByUserId: course.eOzel.recordedByUserId,
})

export async function insertCourse(
  tx: Database,
  institutionId: string,
  course: Course,
  now: Date,
): Promise<void> {
  await tx
    .insert(courses)
    .values({ institutionId, id: course.id, ...columns(course), createdAt: now, updatedAt: now })
}

/**
 * Kurun yeni hâlini yazar ve sürümü artırır; `expectedVersion` tutmazsa `false` (409). Arşiv de
 * bu yazmadır (`status = 'archived'` ve `archived_at`).
 */
export async function saveCourse(
  tx: Database,
  institutionId: string,
  course: Course,
  expectedVersion: number,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(courses)
    .set({ ...columns(course), updatedAt: now, version: sql`${courses.version} + 1` })
    .where(
      and(
        eq(courses.institutionId, institutionId),
        eq(courses.id, course.id),
        eq(courses.version, expectedVersion),
      ),
    )
    .returning({ id: courses.id })
  return rows.length === 1
}

/**
 * Örnek veri: kurlar yoksa yazılır (idempotent; var olan kur değişmez). Sonraki kur bağı yabancı
 * anahtar olduğundan önce bağsız yazılır, sonra yalnız yeni yazılan satırların bağı eklenir.
 */
export async function ensureCourses(
  db: Database,
  institutionId: string,
  list: readonly Course[],
  now: Date,
): Promise<number> {
  if (list.length === 0) return 0
  const inserted = await db
    .insert(courses)
    .values(
      list.map((course) => ({
        institutionId,
        id: course.id,
        ...columns(course),
        nextCourseId: null,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: courses.id })
  const fresh = new Set(inserted.map((row) => row.id))
  for (const course of list)
    if (fresh.has(course.id) && course.nextCourseId !== null)
      await db
        .update(courses)
        .set({ nextCourseId: course.nextCourseId })
        .where(and(eq(courses.institutionId, institutionId), eq(courses.id, course.id)))
  return fresh.size
}
