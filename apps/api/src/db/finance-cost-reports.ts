import { and, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm'

import type {
  CostCourseMembership,
  CostExpenseLine,
} from '@kampus/school-core/lib/finance-cost-per-student.ts'

import type { Database } from './client.ts'
import { budgetItems, budgetLines } from './schema/finance-budget.ts'
import { languageGroupMembers, languageGroups } from './schema/language-groups.ts'
import { studentWithdrawals } from './schema/withdrawals.ts'

/**
 * Öğrenci başı maliyet ve kampüs konsolidasyonu okumaları (DOM-FIN-065; ON-249, ON-250). Kurum
 * kapsamlıdır: ilk parametre `institutionId`. Yalnız hesabın gerektirdiği sütunlar seçilir; kişi
 * adı, gerekçe ya da hesap bilgisi okunmaz.
 */

/** Dönemin arşivlenmemiş gider satırları, merkez başına toplanmış (gelir satırı girmez). */
export async function loadPeriodExpenseLines(
  db: Database,
  institutionId: string,
  periodId: string,
): Promise<CostExpenseLine[]> {
  const rows = await db
    .select({
      costCenterId: budgetLines.costCenterId,
      amountCents: sql<string>`sum(${budgetLines.amountCents})`,
    })
    .from(budgetLines)
    .innerJoin(
      budgetItems,
      and(
        eq(budgetItems.institutionId, budgetLines.institutionId),
        eq(budgetItems.id, budgetLines.itemId),
      ),
    )
    .where(
      and(
        eq(budgetLines.institutionId, institutionId),
        eq(budgetLines.periodId, periodId),
        isNull(budgetLines.archivedAt),
        eq(budgetItems.kind, 'expense'),
      ),
    )
    .groupBy(budgetLines.costCenterId)
  return rows.map((row) => ({
    costCenterId: row.costCenterId,
    amountCents: Number(row.amountCents),
  }))
}

/** Öğrenci → en son ayrılış günü (dönem sayımında pasif öğrencinin çıkış günü). */
export async function loadWithdrawalDays(
  db: Database,
  institutionId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      studentId: studentWithdrawals.studentId,
      day: sql<string>`max(${studentWithdrawals.withdrawalDate})::text`,
    })
    .from(studentWithdrawals)
    .where(
      and(
        eq(studentWithdrawals.institutionId, institutionId),
        isNull(studentWithdrawals.archivedAt),
      ),
    )
    .groupBy(studentWithdrawals.studentId)
  return new Map(rows.map((row) => [row.studentId, row.day]))
}

/**
 * Dönemle kesişen, iptal edilmemiş gruplardaki arşivlenmemiş üyeliklerin kur bağı (dondurulmuş
 * üyelik dahil; kursiyer kurdan ayrılmamıştır).
 */
export async function loadCourseMemberships(
  db: Database,
  institutionId: string,
  period: { startDate: string; endDate: string },
): Promise<CostCourseMembership[]> {
  return db
    .selectDistinct({
      studentId: languageGroupMembers.studentId,
      courseId: languageGroups.courseId,
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
        isNull(languageGroupMembers.archivedAt),
        isNull(languageGroups.archivedAt),
        ne(languageGroups.state, 'cancelled'),
        lte(languageGroups.startDate, period.endDate),
        gte(languageGroups.endDate, period.startDate),
      ),
    )
}
