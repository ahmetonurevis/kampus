import { and, asc, count, eq, gt, gte, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm'

import type { ExportRefund } from '@kampus/school-core/lib/finance-export.ts'
import type { ReversalWithdrawal } from '@kampus/school-core/lib/payments.ts'
import type { WithdrawalBreakdown, WithdrawalReason } from '@kampus/school-core/lib/withdrawals.ts'

import type { Database } from './client.ts'
import { records } from './schema/records.ts'
import { studentIdentities } from './schema/student-identities.ts'
import { studentWithdrawals } from './schema/withdrawals.ts'

/** Ayrılış ve iade deposu (ADR 0006 karar 10). IBAN ve döküm loglanmaz. */

export type RefundStatus = 'none' | 'pending' | 'paid'

export interface StoredWithdrawal {
  id: string
  studentId: string
  studentName: string | null
  contractId: string
  withdrawalDate: string
  reason: WithdrawalReason
  targetSchool: string | null
  breakdown: WithdrawalBreakdown
  refundCents: number
  debtCents: number
  refundDueDate: string
  refundPaidDate: string | null
  refundIban: string | null
  refundAccountHolder: string | null
  version: number
}

/** Ayrılışın öğrenci kaydı: yalnız ad içindir; kurum eşleşmesi zorunludur. */
const STUDENT_JOIN = and(
  eq(records.institutionId, studentWithdrawals.institutionId),
  eq(records.collection, 'students'),
  eq(records.id, studentWithdrawals.studentId),
)

const COLUMNS = {
  id: studentWithdrawals.id,
  studentId: studentWithdrawals.studentId,
  studentName: sql<string | null>`${records.data} ->> 'name'`,
  contractId: studentWithdrawals.contractId,
  withdrawalDate: studentWithdrawals.withdrawalDate,
  reason: studentWithdrawals.reason,
  targetSchool: studentWithdrawals.targetSchool,
  breakdown: studentWithdrawals.breakdown,
  refundCents: studentWithdrawals.refundCents,
  debtCents: studentWithdrawals.debtCents,
  refundDueDate: studentWithdrawals.refundDueDate,
  refundPaidDate: studentWithdrawals.refundPaidDate,
  refundIban: studentWithdrawals.refundIban,
  refundAccountHolder: studentWithdrawals.refundAccountHolder,
  version: studentWithdrawals.version,
}

// Değerler `student_withdrawals_reason_check` ile sınırlıdır.
const stored = (row: Omit<StoredWithdrawal, 'reason'> & { reason: string }): StoredWithdrawal => ({
  ...row,
  reason: row.reason as WithdrawalReason,
})

export async function findWithdrawal(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredWithdrawal | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(studentWithdrawals)
    .leftJoin(records, STUDENT_JOIN)
    .where(and(eq(studentWithdrawals.institutionId, institutionId), eq(studentWithdrawals.id, id)))
    .limit(1)
  return row ? stored(row) : null
}

/**
 * Öğrencinin ayrılış kayıtlarından tahsilat iptalinin denetimi (DOM-FIN-041, core `reversePayment`):
 * borç taksiti dökümde saklanır; eski kayıtta yoktur ve `null` döner.
 */
export async function withdrawalsForReversal(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<ReversalWithdrawal[]> {
  const rows = await db
    .select({ breakdown: studentWithdrawals.breakdown })
    .from(studentWithdrawals)
    .where(
      and(
        eq(studentWithdrawals.institutionId, institutionId),
        eq(studentWithdrawals.studentId, studentId),
      ),
    )
  return rows.map((row) => ({ debtInvoiceId: row.breakdown.debtInvoiceId ?? null }))
}

function statusFilter(status: RefundStatus | undefined): SQL | undefined {
  switch (status) {
    case undefined:
      return undefined
    case 'none':
      return eq(studentWithdrawals.refundCents, 0)
    case 'pending':
      return and(gt(studentWithdrawals.refundCents, 0), isNull(studentWithdrawals.refundPaidDate))
    case 'paid':
      return isNotNull(studentWithdrawals.refundPaidDate)
    default:
      return status satisfies never
  }
}

/** Vadesi en yakın iade önce gelir; süresi yaklaşan iade listenin başındadır (DOM-FIN-040). */
export async function listWithdrawals(
  db: Database,
  institutionId: string,
  query: { refundStatus?: RefundStatus | undefined; page: number; pageSize: number },
): Promise<{ items: StoredWithdrawal[]; total: number }> {
  const where = and(
    eq(studentWithdrawals.institutionId, institutionId),
    statusFilter(query.refundStatus),
  )
  const [totalRow] = await db.select({ total: count() }).from(studentWithdrawals).where(where)
  const items = await db
    .select(COLUMNS)
    .from(studentWithdrawals)
    .leftJoin(records, STUDENT_JOIN)
    .where(where)
    .orderBy(asc(studentWithdrawals.refundDueDate), asc(studentWithdrawals.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: items.map(stored), total: totalRow?.total ?? 0 }
}

export async function insertWithdrawal(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    studentId: string
    contractId: string
    withdrawalDate: string
    reason: string
    targetSchool: string | null
    breakdown: WithdrawalBreakdown
    refundDueDate: string
    approvedByUserId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(studentWithdrawals).values({
    institutionId,
    id: input.id,
    studentId: input.studentId,
    contractId: input.contractId,
    withdrawalDate: input.withdrawalDate,
    reason: input.reason,
    targetSchool: input.targetSchool,
    breakdown: input.breakdown,
    refundCents: input.breakdown.refundCents,
    debtCents: input.breakdown.debtCents,
    refundDueDate: input.refundDueDate,
    approvedByUserId: input.approvedByUserId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Ayrılan öğrencinin kimliği arşivlenir; aynı kişi yeniden kayıt olabilir (DOM-KAY-011). */
export async function archiveStudentIdentity(
  tx: Database,
  institutionId: string,
  studentId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(studentIdentities)
    .set({ archivedAt: now, updatedAt: now, version: sql`${studentIdentities.version} + 1` })
    .where(
      and(
        eq(studentIdentities.institutionId, institutionId),
        eq(studentIdentities.studentId, studentId),
      ),
    )
}

/** Ödeme günü dönemde olan iadeler; IBAN yalnız maskeli çıkar (IST-111). */
export async function refundsPaidInPeriod(
  db: Database,
  institutionId: string,
  period: { from: string; to: string },
): Promise<ExportRefund[]> {
  const rows = await db
    .select({
      studentId: studentWithdrawals.studentId,
      withdrawalDate: studentWithdrawals.withdrawalDate,
      refundCents: studentWithdrawals.refundCents,
      refundPaidDate: studentWithdrawals.refundPaidDate,
      refundIban: studentWithdrawals.refundIban,
      accountHolder: studentWithdrawals.refundAccountHolder,
    })
    .from(studentWithdrawals)
    .where(
      and(
        eq(studentWithdrawals.institutionId, institutionId),
        gte(studentWithdrawals.refundPaidDate, period.from),
        lte(studentWithdrawals.refundPaidDate, period.to),
      ),
    )
  return rows.map(({ refundIban, ...row }) => ({
    ...row,
    maskedIban: refundIban === null ? null : `TR** **** ${refundIban.slice(-4)}`,
  }))
}

/** Yalnız ödenmemiş iade ve beklenen sürüm güncellenir; tutmazsa `false`. */
export async function markRefundPaid(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    paidDate: string
    iban: string
    accountHolder: string
    paidByUserId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(studentWithdrawals)
    .set({
      refundPaidDate: input.paidDate,
      refundIban: input.iban,
      refundAccountHolder: input.accountHolder,
      refundPaidByUserId: input.paidByUserId,
      version: sql`${studentWithdrawals.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(studentWithdrawals.institutionId, institutionId),
        eq(studentWithdrawals.id, input.id),
        eq(studentWithdrawals.version, input.expectedVersion),
        isNull(studentWithdrawals.refundPaidDate),
      ),
    )
    .returning({ id: studentWithdrawals.id })
  return rows.length === 1
}
