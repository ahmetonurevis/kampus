import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm'

import type {
  BudgetActualsLine,
  BudgetExpenseActual,
} from '@kampus/school-core/lib/finance-budget-actuals.ts'
import { receiptExpenseActuals } from '@kampus/school-core/lib/finance-purchase-receipts.ts'

import type { Database } from './client.ts'
import { loadReceiptExpenseRows } from './finance-purchase-receipts.ts'
import { budgetLines } from './schema/finance-budget.ts'
import { lessonPackageSales } from './schema/finance-packages.ts'
import { languageGroupMembers, languageGroups } from './schema/language-groups.ts'

/**
 * Bütçe–gerçekleşen raporunun (DOM-FIN-066; ON-244) kurum kapsamlı okumaları. Yalnız kimlik ve tutar
 * okunur: öğrenci adı, iletişim ve ödeme ayrıntısı belleğe yüklenmez.
 */

/** Dönemin arşivlenmemiş bütün satırları (rapor sayfalanmaz; satır sayısı merkez × kalemle sınırlı). */
export async function loadPeriodLines(
  db: Database,
  institutionId: string,
  periodId: string,
): Promise<BudgetActualsLine[]> {
  const rows = await db
    .select({
      costCenterId: budgetLines.costCenterId,
      itemId: budgetLines.itemId,
      amountCents: budgetLines.amountCents,
      monthlyCents: budgetLines.monthlyCents,
    })
    .from(budgetLines)
    .where(
      and(
        eq(budgetLines.institutionId, institutionId),
        eq(budgetLines.periodId, periodId),
        isNull(budgetLines.archivedAt),
      ),
    )
    .orderBy(asc(budgetLines.id))
  return rows.map((row) => ({
    ...row,
    amountCents: Number(row.amountCents),
    monthlyCents: row.monthlyCents === null ? null : row.monthlyCents.map(Number),
  }))
}

/** Dil okulunda sözleşme → paket satışının kuru (sözleşme başına tek satış). */
export async function loadContractCourses(
  db: Database,
  institutionId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ contractId: lessonPackageSales.contractId, courseId: lessonPackageSales.courseId })
    .from(lessonPackageSales)
    .where(
      and(
        eq(lessonPackageSales.institutionId, institutionId),
        isNotNull(lessonPackageSales.courseId),
        isNull(lessonPackageSales.archivedAt),
      ),
    )
  return new Map(
    rows.flatMap((row) => (row.courseId === null ? [] : [[row.contractId, row.courseId] as const])),
  )
}

/** Dil okulunda öğrenci → arşivlenmemiş, iptal edilmemiş grup üyeliklerinin farklı kurları. */
export async function loadStudentCourses(
  db: Database,
  institutionId: string,
): Promise<Map<string, string[]>> {
  const rows = await db
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
      ),
    )
  const byStudent = new Map<string, string[]>()
  for (const row of rows) {
    const list = byStudent.get(row.studentId)
    if (list) list.push(row.courseId)
    else byStudent.set(row.studentId, [row.courseId])
  }
  return byStudent
}

/**
 * Gider gerçekleşeni kaynağı (DOM-FIN-066). `null` "gerçekleşen verisi yok" demektir; bugünkü kaynak
 * satın alma mal kabulüdür (DOM-FIN-074, K-151): dönem günlerindeki iptal edilmemiş kabullerde kabul
 * edilen miktar × sipariş birim fiyatı, KDV hariç, kabul gününde tahakkuk eder. Elle gider kaydı
 * ve tedarikçi ödemesi (ON-143) geldiğinde aynı biçimde eklenir; hesap ve ekran değişmez.
 */
export type ExpenseActualsSource = (
  db: Database,
  institutionId: string,
  period: { startDate: string; endDate: string },
) => Promise<BudgetExpenseActual[] | null>

export const loadExpenseActuals: ExpenseActualsSource = async (db, institutionId, period) =>
  receiptExpenseActuals(await loadReceiptExpenseRows(db, institutionId, period))
