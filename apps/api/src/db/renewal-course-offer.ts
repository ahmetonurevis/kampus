import { and, eq, isNull, type SQL } from 'drizzle-orm'

import type { LessonPackage } from '@kampus/school-core/lib/finance-packages.ts'
import type { CourseOfferSale } from '@kampus/school-core/lib/renewal-course-offer-list.ts'
import type { CourseOfferEnrollment } from '@kampus/school-core/lib/renewal-course-offer.ts'

import type { Database } from './client.ts'
import { lessonPackages, lessonPackageSales } from './schema/finance-packages.ts'
import { languageGroupMembers, languageGroups } from './schema/language-groups.ts'

/**
 * Yenileme teklifinin kur kayıtları (DOM-DIL-070; ON-295, ON-082): arşivlenmemiş dil grubu satırları,
 * grubun kuru ve başlangıcıyla. Kurum kapsamlıdır; başka kurumun satırı okunmaz. Yalnız okur; kur
 * kaydı OG-086'nın tablosudur.
 */
async function courseEnrollments(
  db: Database,
  institutionId: string,
  studentFilter: SQL | undefined,
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
        studentFilter,
        isNull(languageGroupMembers.archivedAt),
        isNull(languageGroups.archivedAt),
      ),
    )
  return rows.map(({ state, ...row }) => ({ ...row, cancelled: state === 'cancelled' }))
}

/** Tek öğrencinin kur kayıtları (tek öğrenci yenilemesi). */
export const listStudentCourseEnrollments = (
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<CourseOfferEnrollment[]> =>
  courseEnrollments(db, institutionId, eq(languageGroupMembers.studentId, studentId))

/** Kurumun bütün kur kayıtları (kur yenileme teklif listesi, ON-082). */
export const listCourseEnrollments = (
  db: Database,
  institutionId: string,
): Promise<CourseOfferEnrollment[]> => courseEnrollments(db, institutionId, undefined)

/** Kurumun etkin (arşivlenmemiş) paketleri; teklif listesi uyan paketi bunlardan seçer. */
export function listActiveLessonPackages(
  db: Database,
  institutionId: string,
): Promise<LessonPackage[]> {
  return db
    .select({
      id: lessonPackages.id,
      kind: lessonPackages.kind,
      name: lessonPackages.name,
      courseId: lessonPackages.courseId,
      level: lessonPackages.level,
      lessonHours: lessonPackages.lessonHours,
      hourlyCents: lessonPackages.hourlyCents,
      validityDays: lessonPackages.validityDays,
    })
    .from(lessonPackages)
    .where(and(eq(lessonPackages.institutionId, institutionId), isNull(lessonPackages.archivedAt)))
}

/** Kurumun arşivlenmemiş paket satışlarının kur ve seviye kopyası; teklifin satışa dönüştüğünü gösterir. */
export async function listCourseOfferSales(
  db: Database,
  institutionId: string,
): Promise<CourseOfferSale[]> {
  const rows = await db
    .select({
      id: lessonPackageSales.id,
      studentId: lessonPackageSales.studentId,
      courseId: lessonPackageSales.courseId,
      level: lessonPackageSales.level,
      soldAt: lessonPackageSales.soldAt,
    })
    .from(lessonPackageSales)
    .where(
      and(
        eq(lessonPackageSales.institutionId, institutionId),
        isNull(lessonPackageSales.archivedAt),
      ),
    )
  return rows.map((row) => ({ ...row, soldAt: row.soldAt.toISOString() }))
}
