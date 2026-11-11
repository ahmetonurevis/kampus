import { and, asc, count, eq, gt, gte, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm'

import type { FinanceDayRefund } from '@kampus/school-core/lib/finance-day-closings.ts'
import type { BoardReportWithdrawal } from '@kampus/school-core/lib/finance-board-report.ts'
import type { ExportRefund } from '@kampus/school-core/lib/finance-export.ts'
import type { OpeningWithdrawal } from '@kampus/school-core/lib/finance-opening-watch.ts'
import type { ReconciliationWithdrawal } from '@kampus/school-core/lib/finance-reconciliation.ts'
import type { StatementWithdrawal } from '@kampus/school-core/lib/finance-statement.ts'
import { bankAccountLabel, type ReversalWithdrawal } from '@kampus/school-core/lib/payments.ts'
import type { WithdrawalBreakdown, WithdrawalReason } from '@kampus/school-core/lib/withdrawals.ts'

import type { Database } from './client.ts'
import { bankAccounts } from './schema/payments.ts'
import { records } from './schema/records.ts'
import { studentIdentities } from './schema/student-identities.ts'
import { studentWithdrawals } from './schema/withdrawals.ts'
import { foldSearch, foldSql } from './text-search.ts'

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
  /** İadenin ödendiği kurum hesabı (M-13); 0083 öncesi ödenmiş iadede boş. */
  refundBankAccountId: string | null
  refundBankAccountLabel: string | null
  version: number
}

/** Gün sonundaki iade ödemesi satırı (M-13); IBAN ve hesap sahibi seçilmez. */
export interface StoredDayRefund extends FinanceDayRefund {
  withdrawalId: string
  studentName: string | null
  bankAccountLabel: string | null
}

/** Ayrılışın öğrenci kaydı: yalnız ad içindir; kurum eşleşmesi zorunludur. */
const STUDENT_JOIN = and(
  eq(records.institutionId, studentWithdrawals.institutionId),
  eq(records.collection, 'students'),
  eq(records.id, studentWithdrawals.studentId),
)

/** İadenin ödendiği kurum hesabı; arşivlenmiş hesap da adıyla görünür. */
const BANK_JOIN = and(
  eq(bankAccounts.institutionId, studentWithdrawals.institutionId),
  eq(bankAccounts.id, studentWithdrawals.refundBankAccountId),
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
  refundBankAccountId: studentWithdrawals.refundBankAccountId,
  bankName: bankAccounts.bankName,
  bankIban: bankAccounts.iban,
  version: studentWithdrawals.version,
}

type Row = Omit<StoredWithdrawal, 'reason' | 'refundBankAccountLabel'> & {
  reason: string
  bankName: string | null
  bankIban: string | null
}

const labelOf = (bankName: string | null, iban: string | null) =>
  bankName === null || iban === null ? null : bankAccountLabel({ bankName, iban })

// Değerler `student_withdrawals_reason_check` ile sınırlıdır.
const stored = ({ bankName, bankIban, ...row }: Row): StoredWithdrawal => ({
  ...row,
  reason: row.reason as WithdrawalReason,
  refundBankAccountLabel: labelOf(bankName, bankIban),
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
    .leftJoin(bankAccounts, BANK_JOIN)
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
  query: {
    refundStatus?: RefundStatus | undefined
    /** Öğrenci adında arama (Türkçe harf ve aksan duyarsız). */
    q?: string | undefined
    page: number
    pageSize: number
  },
): Promise<{ items: StoredWithdrawal[]; total: number }> {
  const where = and(
    eq(studentWithdrawals.institutionId, institutionId),
    statusFilter(query.refundStatus),
    query.q === undefined
      ? undefined
      : sql`strpos(${foldSql(sql`${records.data} ->> 'name'`)}, ${foldSearch(query.q)}) > 0`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(studentWithdrawals)
    .leftJoin(records, STUDENT_JOIN)
    .where(where)
  const items = await db
    .select(COLUMNS)
    .from(studentWithdrawals)
    .leftJoin(records, STUDENT_JOIN)
    .leftJoin(bankAccounts, BANK_JOIN)
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

/**
 * Ekstre için öğrencinin ayrılışları (IST-107, DOM-FIN-054): yalnız gün, iade ve mahsup edilen
 * dağıtılmamış tutar; gerekçe, karar ve hesap bilgisi seçilmez.
 */
export async function withdrawalsForStatement(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<StatementWithdrawal[]> {
  const rows = await db
    .select({
      id: studentWithdrawals.id,
      withdrawalDate: studentWithdrawals.withdrawalDate,
      refundCents: studentWithdrawals.refundCents,
      refundPaidDate: studentWithdrawals.refundPaidDate,
      breakdown: studentWithdrawals.breakdown,
    })
    .from(studentWithdrawals)
    .where(
      and(
        eq(studentWithdrawals.institutionId, institutionId),
        eq(studentWithdrawals.studentId, studentId),
      ),
    )
  return rows.map(({ breakdown, ...row }) => ({ ...row, creditCents: breakdown.creditCents }))
}

/**
 * Açılış nöbeti için kurumun ayrılışları (DOM-FIN-061): yalnız gün ve iade tutarı; gerekçe,
 * döküm ve hesap bilgisi seçilmez.
 */
export function withdrawalsForOpeningWatch(
  db: Database,
  institutionId: string,
): Promise<OpeningWithdrawal[]> {
  return db
    .select({
      id: studentWithdrawals.id,
      studentId: studentWithdrawals.studentId,
      withdrawalDate: studentWithdrawals.withdrawalDate,
      refundCents: studentWithdrawals.refundCents,
      refundDueDate: studentWithdrawals.refundDueDate,
      refundPaidDate: studentWithdrawals.refundPaidDate,
    })
    .from(studentWithdrawals)
    .where(eq(studentWithdrawals.institutionId, institutionId))
}

/** Mutabakat için kurumun ayrılışları (ON-085); IBAN ve hesap sahibi seçilmez. */
export function withdrawalsForReconciliation(
  db: Database,
  institutionId: string,
): Promise<ReconciliationWithdrawal[]> {
  return db
    .select({
      studentId: studentWithdrawals.studentId,
      contractId: studentWithdrawals.contractId,
      withdrawalDate: studentWithdrawals.withdrawalDate,
      refundCents: studentWithdrawals.refundCents,
      debtCents: studentWithdrawals.debtCents,
      refundPaidDate: studentWithdrawals.refundPaidDate,
      breakdown: studentWithdrawals.breakdown,
    })
    .from(studentWithdrawals)
    .where(eq(studentWithdrawals.institutionId, institutionId))
}

/**
 * Yönetim kurulu raporu için kurumun ayrılışları (DOM-FIN-064): mutabakat alanları ve neden
 * kategorisi. IBAN, hesap sahibi, hedef okul ve ödeyici kararı seçilmez.
 */
export async function withdrawalsForBoardReport(
  db: Database,
  institutionId: string,
): Promise<BoardReportWithdrawal[]> {
  const rows = await db
    .select({
      id: studentWithdrawals.id,
      studentId: studentWithdrawals.studentId,
      contractId: studentWithdrawals.contractId,
      withdrawalDate: studentWithdrawals.withdrawalDate,
      reason: studentWithdrawals.reason,
      refundCents: studentWithdrawals.refundCents,
      debtCents: studentWithdrawals.debtCents,
      refundPaidDate: studentWithdrawals.refundPaidDate,
      breakdown: studentWithdrawals.breakdown,
    })
    .from(studentWithdrawals)
    .where(eq(studentWithdrawals.institutionId, institutionId))
  // Değerler `student_withdrawals_reason_check` ile sınırlıdır.
  return rows.map((row) => ({ ...row, reason: row.reason as WithdrawalReason }))
}

/**
 * O gün ödenen iadeler (gün sonu, M-13, DOM-FIN-036): tutar, öğrenci adı ve kurum hesabı. IBAN ve
 * hesap sahibi seçilmez. Ödeme günü `date` kolonudur, gün eşitliğiyle süzülür.
 */
export async function refundsPaidOnDay(
  db: Database,
  institutionId: string,
  day: string,
): Promise<StoredDayRefund[]> {
  const rows = await db
    .select({
      withdrawalId: studentWithdrawals.id,
      studentName: sql<string | null>`${records.data} ->> 'name'`,
      amountCents: studentWithdrawals.refundCents,
      paidDate: studentWithdrawals.refundPaidDate,
      bankName: bankAccounts.bankName,
      bankIban: bankAccounts.iban,
    })
    .from(studentWithdrawals)
    .leftJoin(records, STUDENT_JOIN)
    .leftJoin(bankAccounts, BANK_JOIN)
    .where(
      and(
        eq(studentWithdrawals.institutionId, institutionId),
        eq(studentWithdrawals.refundPaidDate, day),
        gt(studentWithdrawals.refundCents, 0),
      ),
    )
    .orderBy(asc(studentWithdrawals.updatedAt), asc(studentWithdrawals.id))
  return rows.map(({ bankName, bankIban, paidDate, ...row }) => ({
    ...row,
    // Süzgeç ödeme gününü eşitler; boş olamaz.
    paidDate: paidDate ?? day,
    bankAccountLabel: labelOf(bankName, bankIban),
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
    bankAccountId: string
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
      refundBankAccountId: input.bankAccountId,
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
