import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import type { ParentBond } from '@kampus/school-core/lib/enrollment.ts'

import type { Database } from './client.ts'
import { studentGuardians } from './schema/student-guardians.ts'

/**
 * Veli kayıtlarının (`parents`) kurumdaki etkin veli–öğrenci bağları; kesin kayıtta seçilen ya da
 * önerilen velinin bir öğrencisinde velayetsiz ya da iletişim kısıtlı olup olmadığı bunlardan
 * okunur (core `hasNonCustodialBond`; DOM-ILT-070, -074). Bağ veli kaydının `studentIds` listesinde
 * olmayan öğrenciye de kurulabildiği için (`POST /students/:studentId/guardians`) veli kimliğiyle
 * sorgulanır. Arşivli bağ okunmaz; yalnız kural için gereken alanlar döner. Yalnız ödeyici bağın
 * öğrencisinin yaşı (`learnerMinor`) serviste doldurulur (`services/finance-payers.ts`
 * `withLearnerAge`; ON-124).
 */
export async function loadParentBonds(
  db: Database,
  institutionId: string,
  parentIds: readonly string[],
): Promise<(ParentBond & { parentId: string; studentId: string })[]> {
  if (parentIds.length === 0) return []
  const rows = await db
    .select({
      parentId: studentGuardians.parentId,
      studentId: studentGuardians.studentId,
      custody: studentGuardians.custody,
      contactRestricted: studentGuardians.isContactRestricted,
      isPayer: studentGuardians.isPayer,
    })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.institutionId, institutionId),
        isNull(studentGuardians.archivedAt),
        inArray(studentGuardians.parentId, [...new Set(parentIds)]),
      ),
    )
    .orderBy(asc(studentGuardians.parentId), asc(studentGuardians.id))
  return rows.flatMap((row) => (row.parentId === null ? [] : [{ ...row, parentId: row.parentId }]))
}
