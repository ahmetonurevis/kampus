import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import type { Database } from './client.ts'
import { studentGuardians } from './schema/student-guardians.ts'

/**
 * Öğrencilerden etkin, iletişim kısıtsız ödeyici bağı olanlar (ON-124; DOM-ILT-074). Yetişkin
 * kursiyerin finans bildiriminin ödeyiciye de yazılıp yazılmayacağı buradan okunur
 * (`services/finance-payers.ts` `notifyFinance`). Kurum kapsamlıdır; arşivli bağ okunmaz.
 */
export async function payerStudentIdsOf(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set()
  const rows = await db
    .select({ studentId: studentGuardians.studentId })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.institutionId, institutionId),
        isNull(studentGuardians.archivedAt),
        eq(studentGuardians.isPayer, true),
        eq(studentGuardians.isContactRestricted, false),
        inArray(studentGuardians.studentId, [...new Set(studentIds)]),
      ),
    )
    .orderBy(asc(studentGuardians.studentId))
  return new Set(rows.map((row) => row.studentId))
}
