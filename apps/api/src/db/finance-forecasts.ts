import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import type { ForecastProspect, PendingRefund } from '@kampus/school-core/lib/finance-forecast.ts'

import type { Database } from './client.ts'
import { institutionSettings } from './schema/institution-settings.ts'
import { records } from './schema/records.ts'
import { studentWithdrawals } from './schema/withdrawals.ts'

/**
 * Gelir ve nakit akışı tahmininin (DOM-FIN-063) kurum kapsamlı okumaları. Adaydan yalnız huni adımı,
 * açılış günü ve ilgi alanı (düzey eşleşmesi için) okunur: ad, iletişim, not ve veli bilgisi belleğe
 * yüklenmez. İadeden yalnız tutar ve son ödeme günü okunur; IBAN ve öğrenci seçilmez.
 */

const isObject = (field: string) =>
  sql<boolean>`coalesce(jsonb_typeof(${records.data} -> ${field}::text), 'null') = 'object'`
const textField = (field: string) => sql<string | null>`(${records.data} ->> ${field}::text)`

/** Kurumun arşivlenmemiş bütün adayları; pencere ve açık/kapalı ayrımı core'dadır. */
export async function loadForecastProspects(
  db: Database,
  institutionId: string,
): Promise<ForecastProspect[]> {
  const rows = await db
    .select({
      stage: textField('stage'),
      studentId: textField('studentId'),
      trialAt: textField('trialAt'),
      interest: textField('interest'),
      createdAt: textField('createdAt'),
      hasMeeting: isObject('meeting'),
      hasTrialLesson: isObject('trialLesson'),
    })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'prospects'),
        isNull(records.archivedAt),
      ),
    )
  return rows.map(({ hasMeeting, hasTrialLesson, ...row }) => ({
    ...row,
    meeting: hasMeeting ? {} : null,
    trialLesson: hasTrialLesson ? {} : null,
  }))
}

/** Ödenmemiş ayrılış iadeleri (ekstredeki `refundDueCents`'in kurum geneli; DOM-FIN-041). */
export async function loadPendingRefunds(
  db: Database,
  institutionId: string,
): Promise<PendingRefund[]> {
  return db
    .select({
      refundCents: studentWithdrawals.refundCents,
      refundDueDate: studentWithdrawals.refundDueDate,
    })
    .from(studentWithdrawals)
    .where(
      and(
        eq(studentWithdrawals.institutionId, institutionId),
        gt(studentWithdrawals.refundCents, 0),
        isNull(studentWithdrawals.refundPaidDate),
        isNull(studentWithdrawals.archivedAt),
      ),
    )
}

/** Kesin kaydın yazıldığı eğitim yılı (kurum ayarı); satır yoksa `null`. */
export async function loadEnrollmentYear(
  db: Database,
  institutionId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ academicYear: institutionSettings.academicYear })
    .from(institutionSettings)
    .where(eq(institutionSettings.institutionId, institutionId))
    .limit(1)
  return row?.academicYear ?? null
}
