import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm'

import type {
  BudgetActualsLine,
  BudgetExpenseActual,
} from '@kampus/school-core/lib/finance-budget-actuals.ts'

import type { Database } from './client.ts'
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
 * Gider gerçekleşeni kaynağı (DOM-FIN-066). Satın alma (K23) ve elle gider kaydı tabloları henüz
 * yoktur; `null` "gerçekleşen verisi yok" demektir. Kaynak eklenince bu fonksiyon dönemin
 * kayıtlarını `BudgetExpenseActual` biçiminde döndürür; hesap ve ekran değişmez.
 */
export type ExpenseActualsSource = (
  db: Database,
  institutionId: string,
  period: { startDate: string; endDate: string },
) => Promise<BudgetExpenseActual[] | null>

export const loadExpenseActuals: ExpenseActualsSource = () => Promise.resolve(null)
