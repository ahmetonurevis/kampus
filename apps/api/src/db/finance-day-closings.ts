import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'

import type {
  FinanceDayCash,
  FinanceDayClosingPlan,
  FinanceDayMethodTotal,
  FinanceDaySummary,
} from '@kampus/school-core/lib/finance-day-closings.ts'

import type { Database } from './client.ts'
import { METHOD_LABELS } from './payments.ts'
import { memberships, users } from './schema/auth.ts'
import { financeDayClosings } from './schema/finance-day-closings.ts'
import { PAYMENT_METHOD_KEYS } from './schema/payments.ts'

/** Gün kapanışı deposu (IST-113, DOM-FIN-036). İlk parametreler veritabanı ve `institutionId`'dir. */

export interface StoredDayClosing {
  id: string
  closingDate: string
  summary: FinanceDaySummary
  cash: FinanceDayCash | null
  note: string | null
  closedAt: Date
  closedByUserId: string
  reopenedAt: Date | null
  reopenedByUserId: string | null
  reopenReason: string | null
  version: number
}

type Row = typeof financeDayClosings.$inferSelect

function closingOf(row: Row): StoredDayClosing {
  const methods = row.methodTotals.map((item): FinanceDayMethodTotal => {
    const method = METHOD_LABELS[item.method]
    if (method === undefined) throw new Error(`unknown payment method: ${item.method}`)
    // 0083 öncesi kapanışta iade, 0086 öncesinde tedarikçi ödemesi alanı yoktur; o gün bunlar gün
    // sonuna girmiyordu (M-13, K-166).
    return {
      ...item,
      method,
      refundPaidCount: item.refundPaidCount ?? 0,
      refundPaidCents: item.refundPaidCents ?? 0,
      supplierPaidCount: item.supplierPaidCount ?? 0,
      supplierPaidCents: item.supplierPaidCents ?? 0,
    }
  })
  return {
    id: row.id,
    closingDate: row.closingDate,
    summary: {
      methods,
      collectedCount: row.collectedCount,
      collectedCents: row.collectedCents,
      reversedCount: row.reversedCount,
      reversedCents: row.reversedCents,
      refundPaidCount: row.refundPaidCount,
      refundPaidCents: row.refundPaidCents,
      supplierPaidCount: row.supplierPaidCount,
      supplierPaidCents: row.supplierPaidCents,
      netCents: row.netCents,
    },
    // Kısıt dört kolonu birlikte dolu ya da birlikte boş tutar.
    cash:
      row.countedCashCents === null ||
      row.openingCashCents === null ||
      row.expectedCashCents === null ||
      row.cashDifferenceCents === null
        ? null
        : {
            openingCents: row.openingCashCents,
            countedCents: row.countedCashCents,
            expectedCents: row.expectedCashCents,
            differenceCents: row.cashDifferenceCents,
          },
    note: row.note,
    closedAt: row.closedAt,
    closedByUserId: row.closedByUserId,
    reopenedAt: row.reopenedAt,
    reopenedByUserId: row.reopenedByUserId,
    reopenReason: row.reopenReason,
    version: row.version,
  }
}

/** Günün bütün kapanışları, en yeni önce; geçerli olan (varsa) ilkidir. */
export async function dayClosingsOf(
  db: Database,
  institutionId: string,
  closingDate: string,
): Promise<StoredDayClosing[]> {
  const rows = await db
    .select()
    .from(financeDayClosings)
    .where(
      and(
        eq(financeDayClosings.institutionId, institutionId),
        eq(financeDayClosings.closingDate, closingDate),
      ),
    )
    .orderBy(desc(financeDayClosings.closedAt), asc(financeDayClosings.id))
  return rows.map(closingOf)
}

/** Tahsilat ve iptal denetimi: gün şu an kapalı mı. Benzersiz kısmi indekse iner. */
export async function isFinanceDayClosed(
  db: Database,
  institutionId: string,
  closingDate: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: financeDayClosings.id })
    .from(financeDayClosings)
    .where(
      and(
        eq(financeDayClosings.institutionId, institutionId),
        eq(financeDayClosings.closingDate, closingDate),
        isNull(financeDayClosings.reopenedAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Bu günden önceki son geçerli kapanışta sayılan nakit; açılış kasası önerisidir. */
export async function lastCountedCash(
  db: Database,
  institutionId: string,
  closingDate: string,
): Promise<number | null> {
  const [row] = await db
    .select({ counted: financeDayClosings.countedCashCents })
    .from(financeDayClosings)
    .where(
      and(
        eq(financeDayClosings.institutionId, institutionId),
        lt(financeDayClosings.closingDate, closingDate),
        isNull(financeDayClosings.reopenedAt),
        isNotNull(financeDayClosings.countedCashCents),
      ),
    )
    .orderBy(desc(financeDayClosings.closingDate))
    .limit(1)
  return row?.counted ?? null
}

/** Kapanışı yazar; aynı güne ikinci kapanışı benzersiz indeks de engeller. */
export async function insertDayClosing(
  tx: Database,
  institutionId: string,
  input: { id: string; plan: FinanceDayClosingPlan; closedByUserId: string; now: Date },
): Promise<StoredDayClosing> {
  const { id, plan, closedByUserId, now } = input
  const { summary, cash } = plan
  const [row] = await tx
    .insert(financeDayClosings)
    .values({
      institutionId,
      id,
      closingDate: plan.closingDate,
      methodTotals: summary.methods.map((item) => ({
        ...item,
        method: PAYMENT_METHOD_KEYS[item.method],
      })),
      collectedCount: summary.collectedCount,
      collectedCents: summary.collectedCents,
      reversedCount: summary.reversedCount,
      reversedCents: summary.reversedCents,
      refundPaidCount: summary.refundPaidCount,
      refundPaidCents: summary.refundPaidCents,
      supplierPaidCount: summary.supplierPaidCount,
      supplierPaidCents: summary.supplierPaidCents,
      netCents: summary.netCents,
      openingCashCents: cash?.openingCents ?? null,
      countedCashCents: cash?.countedCents ?? null,
      expectedCashCents: cash?.expectedCents ?? null,
      cashDifferenceCents: cash?.differenceCents ?? null,
      note: plan.note,
      closedAt: now,
      closedByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  if (row === undefined) throw new Error('day closing was not written')
  return closingOf(row)
}

/** Yeniden açmayı aynı satıra yazar; sürüm koşulu tutmazsa `null` döner. */
export async function markDayClosingReopened(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    reopenedByUserId: string
    reason: string
    now: Date
  },
): Promise<StoredDayClosing | null> {
  const [row] = await tx
    .update(financeDayClosings)
    .set({
      reopenedAt: input.now,
      reopenedByUserId: input.reopenedByUserId,
      reopenReason: input.reason,
      version: sql`${financeDayClosings.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(financeDayClosings.institutionId, institutionId),
        eq(financeDayClosings.id, input.id),
        eq(financeDayClosings.version, input.expectedVersion),
        isNull(financeDayClosings.reopenedAt),
      ),
    )
    .returning()
  return row === undefined ? null : closingOf(row)
}

/** Kapatan ve açan kişilerin adı; kurum üyeliği olmayan kimlik görünmez. */
export async function closingActorNames(
  db: Database,
  institutionId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ userId: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.userId, [...new Set(userIds)]),
      ),
    )
  return new Map(rows.map((row) => [row.userId, row.name]))
}
