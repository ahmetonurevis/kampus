import { and, asc, eq, inArray } from 'drizzle-orm'

import type { HrStaffMember } from '@kampus/school-core/lib/finance-hr-reports.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships } from './schema/auth.ts'

/**
 * İK raporu girdisi (DOM-FIN-117; ON-192). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Personel üyeliği yalnız okunur; ad ve iletişim bilgisi okunmaz (rapor kişi taşımaz). İzin,
 * maliyet merkezi ve sağlık raporu girdileri kendi depolarından okunur.
 */

/** Kurumun bütün personeli (yönetici, öğretmen, ön büro; pasifler dahil): üyelik ve pasifleştirme günü. */
export async function loadHrStaff(db: Database, institutionId: string): Promise<HrStaffMember[]> {
  const rows = await db
    .select({
      membershipId: memberships.id,
      role: memberships.role,
      createdAt: memberships.createdAt,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.role, [...STAFF_ROLES]),
      ),
    )
    .orderBy(asc(memberships.id))
  return rows.map((row) => ({
    membershipId: row.membershipId,
    role: row.role,
    joinedDay: dayKey(row.createdAt),
    deactivatedDay: row.deactivatedAt === null ? null : dayKey(row.deactivatedAt),
  }))
}
