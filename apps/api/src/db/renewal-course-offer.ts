import { and, eq, isNull } from 'drizzle-orm'

import type { CourseOfferEnrollment } from '@kampus/school-core/lib/renewal-course-offer.ts'

import type { Database } from './client.ts'
import { languageGroupMembers, languageGroups } from './schema/language-groups.ts'

/**
 * Yenileme teklifinin kur kayıtları (DOM-DIL-070; ON-295): öğrencinin arşivlenmemiş dil grubu
 * satırları, grubun kuru ve başlangıcıyla. Kurum kapsamlıdır; başka kurumun satırı okunmaz. Yalnız
 * okur; kur kaydı OG-086'nın tablosudur.
 */
export async function listStudentCourseEnrollments(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<CourseOfferEnrollment[]> {
  const rows = await db
    .select({
      id: languageGroupMembers.id,
      studentId: languageGroupMembers.studentId,
      courseId: languageGroups.courseId,
      startDate: languageGroups.startDate,
      state: languageGroups.state,
    })
    .from(languageGroupMembers)
    .innerJoin(
      languageGroups,
      and(
        eq(languageGroups.institutionId, languageGroupMembers.institutionId),
        eq(languageGroups.id, languageGroupMembers.groupId),
      ),
    )
    .where(
      and(
        eq(languageGroupMembers.institutionId, institutionId),
        eq(languageGroupMembers.studentId, studentId),
        isNull(languageGroupMembers.archivedAt),
        isNull(languageGroups.archivedAt),
      ),
    )
  return rows.map(({ state, ...row }) => ({ ...row, cancelled: state === 'cancelled' }))
}
