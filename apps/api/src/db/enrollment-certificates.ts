import { and, eq, gte, isNull, ne } from 'drizzle-orm'

import type { Database } from './client.ts'
import { courses } from './schema/courses.ts'
import { languageGroupMembers, languageGroups } from './schema/language-groups.ts'

/**
 * Kursiyerin belgeye yazılan kurları (DOM-KAY-027): bitmemiş ve iptal edilmemiş gruplardaki etkin
 * üyelikler. Dondurulan üyelik (DOM-DIL-052) ve biten kur yazılmaz. Kurum kapsamlıdır, yalnız okur.
 */
export async function listCurrentCourseNames(
  db: Database,
  institutionId: string,
  studentId: string,
  today: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: courses.name })
    .from(languageGroupMembers)
    .innerJoin(
      languageGroups,
      and(
        eq(languageGroups.institutionId, languageGroupMembers.institutionId),
        eq(languageGroups.id, languageGroupMembers.groupId),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.institutionId, languageGroups.institutionId),
        eq(courses.id, languageGroups.courseId),
      ),
    )
    .where(
      and(
        eq(languageGroupMembers.institutionId, institutionId),
        eq(languageGroupMembers.studentId, studentId),
        eq(languageGroupMembers.status, 'active'),
        isNull(languageGroupMembers.archivedAt),
        isNull(languageGroups.archivedAt),
        ne(languageGroups.state, 'cancelled'),
        gte(languageGroups.endDate, today),
      ),
    )
  return rows.map((row) => row.name)
}
