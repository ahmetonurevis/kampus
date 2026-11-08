import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm'

import type { BankTransactionStatus } from '@kampus/school-core/lib/finance-bank-matching.ts'
import type { BankStatementFormat } from '@kampus/school-core/lib/finance-bank-statement.ts'
import { bankAccountLabel } from '@kampus/school-core/lib/payments.ts'

import type { Database } from './client.ts'
import { bankTransactions } from './schema/finance-bank-transactions.ts'
import { bankAccounts, payments } from './schema/payments.ts'
import { records } from './schema/records.ts'
import { studentIdentities } from './schema/student-identities.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Banka hareketi deposu (IST-115, ON-099; DOM-FIN-069). İlk parametreler veritabanı ve
 * `institutionId`'dir. Açıklama, referans ve karşı taraf kişisel veridir: loglanmaz; maskeyi servis
 * uygular. Durum değiştiren her güncelleme sürüm ve durum koşulludur; tutmazsa `null` döner.
 */

export interface StoredBankTransaction {
  id: string
  bankAccountId: string
  bankAccountLabel: string
  bookingDate: string
  amountCents: number
  statementDescription: string
  counterpartyName: string | null
  bankReference: string | null
  balanceCents: number | null
  fingerprint: string
  sourceFormat: BankStatementFormat
  status: BankTransactionStatus
  paymentId: string | null
  /** Eşleşen tahsilatın dekontu ve öğrencisi; eşleşmemişte `null`. */
  payment: {
    receiptYear: number
    receiptNumber: number
    studentId: string
    studentName: string | null
  } | null
  matchedAt: Date | null
  ignoredAt: Date | null
  ignoreReason: string | null
  createdAt: Date
  version: number
}

const PAYMENT_JOIN = and(
  eq(payments.institutionId, bankTransactions.institutionId),
  eq(payments.id, bankTransactions.paymentId),
)
const STUDENT_JOIN = and(
  eq(records.institutionId, payments.institutionId),
  eq(records.collection, 'students'),
  eq(records.id, payments.studentId),
)
const ACCOUNT_JOIN = and(
  eq(bankAccounts.institutionId, bankTransactions.institutionId),
  eq(bankAccounts.id, bankTransactions.bankAccountId),
)

const COLUMNS = {
  id: bankTransactions.id,
  bankAccountId: bankTransactions.bankAccountId,
  bankName: bankAccounts.bankName,
  iban: bankAccounts.iban,
  bookingDate: bankTransactions.bookingDate,
  amountCents: bankTransactions.amountCents,
  statementDescription: bankTransactions.statementDescription,
  counterpartyName: bankTransactions.counterpartyName,
  bankReference: bankTransactions.bankReference,
  balanceCents: bankTransactions.balanceCents,
  fingerprint: bankTransactions.fingerprint,
  sourceFormat: bankTransactions.sourceFormat,
  status: bankTransactions.status,
  paymentId: bankTransactions.paymentId,
  receiptYear: payments.receiptYear,
  receiptNumber: payments.receiptNumber,
  paymentStudentId: payments.studentId,
  studentName: sql<string | null>`${records.data} ->> 'name'`,
  matchedAt: bankTransactions.matchedAt,
  ignoredAt: bankTransactions.ignoredAt,
  ignoreReason: bankTransactions.ignoreReason,
  createdAt: bankTransactions.createdAt,
  version: bankTransactions.version,
}

function selectTransactions(db: Database) {
  return db
    .select(COLUMNS)
    .from(bankTransactions)
    .leftJoin(bankAccounts, ACCOUNT_JOIN)
    .leftJoin(payments, PAYMENT_JOIN)
    .leftJoin(records, STUDENT_JOIN)
}

type Row = Awaited<ReturnType<typeof selectTransactions>>[number]

function toStored(row: Row): StoredBankTransaction {
  const { bankName, iban, receiptYear, receiptNumber, paymentStudentId, studentName, ...rest } = row
  return {
    ...rest,
    bankAccountLabel:
      bankName !== null && iban !== null ? bankAccountLabel({ bankName, iban }) : '',
    sourceFormat: rest.sourceFormat as BankStatementFormat,
    status: rest.status as BankTransactionStatus,
    payment:
      receiptYear !== null && receiptNumber !== null && paymentStudentId !== null
        ? { receiptYear, receiptNumber, studentId: paymentStudentId, studentName }
        : null,
  }
}

export async function findBankTransaction(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredBankTransaction | null> {
  const [row] = await selectTransactions(db)
    .where(
      and(
        eq(bankTransactions.institutionId, institutionId),
        eq(bankTransactions.id, id),
        isNull(bankTransactions.archivedAt),
      ),
    )
    .limit(1)
  return row === undefined ? null : toStored(row)
}

export interface BankTransactionQuery {
  status?: BankTransactionStatus | undefined
  bankAccountId?: string | undefined
  dateFrom?: string | undefined
  dateTo?: string | undefined
  q?: string | undefined
  page: number
  pageSize: number
}

/** En yeni hareket önce; `q` açıklama, karşı taraf ve referansta (Türkçe harf duyarsız). */
export async function listBankTransactions(
  db: Database,
  institutionId: string,
  query: BankTransactionQuery,
): Promise<{ items: StoredBankTransaction[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    eq(bankTransactions.institutionId, institutionId),
    isNull(bankTransactions.archivedAt),
    query.status === undefined ? undefined : eq(bankTransactions.status, query.status),
    query.bankAccountId === undefined
      ? undefined
      : eq(bankTransactions.bankAccountId, query.bankAccountId),
    query.dateFrom === undefined ? undefined : gte(bankTransactions.bookingDate, query.dateFrom),
    query.dateTo === undefined ? undefined : lte(bankTransactions.bookingDate, query.dateTo),
    search === undefined
      ? undefined
      : sql`(strpos(${foldSql(bankTransactions.statementDescription)}, ${search}) > 0 or strpos(${foldSql(sql`coalesce(${bankTransactions.counterpartyName}, '')`)}, ${search}) > 0 or strpos(${foldSql(sql`coalesce(${bankTransactions.bankReference}, '')`)}, ${search}) > 0)`,
  )
  const [total] = await db.select({ n: count() }).from(bankTransactions).where(where)
  const rows = await selectTransactions(db)
    .where(where)
    .orderBy(
      desc(bankTransactions.bookingDate),
      asc(bankTransactions.importBatchId),
      asc(bankTransactions.sourceLine),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toStored), total: total?.n ?? 0 }
}

/** Hesapta kayıtlı parmak izlerinden verilenler (mükerrer denetimi, K-107). */
export async function knownFingerprints(
  db: Database,
  institutionId: string,
  bankAccountId: string,
  fingerprints: readonly string[],
): Promise<Set<string>> {
  if (fingerprints.length === 0) return new Set()
  const rows = await db
    .select({ fingerprint: bankTransactions.fingerprint })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.institutionId, institutionId),
        eq(bankTransactions.bankAccountId, bankAccountId),
        inArray(bankTransactions.fingerprint, [...new Set(fingerprints)]),
        isNull(bankTransactions.archivedAt),
      ),
    )
  return new Set(rows.map((row) => row.fingerprint))
}

export interface NewBankTransaction {
  id: string
  bookingDate: string
  amountCents: number
  statementDescription: string
  counterpartyName: string | null
  bankReference: string | null
  balanceCents: number | null
  fingerprint: string
  sourceLine: number
}

export async function insertBankTransactions(
  tx: Database,
  institutionId: string,
  input: {
    bankAccountId: string
    sourceFormat: BankStatementFormat
    importBatchId: string
    importedByUserId: string
    rows: readonly NewBankTransaction[]
    now: Date
  },
): Promise<void> {
  const { rows, now, ...shared } = input
  // Tek ifadede 5.000 satır parametre sınırını aşar; parça parça yazılır.
  for (let start = 0; start < rows.length; start += 500)
    await tx.insert(bankTransactions).values(
      rows.slice(start, start + 500).map((row) => ({
        institutionId,
        ...shared,
        ...row,
        createdAt: now,
        updatedAt: now,
      })),
    )
}

const transition = (
  institutionId: string,
  id: string,
  expectedVersion: number,
  status: BankTransactionStatus,
) =>
  and(
    eq(bankTransactions.institutionId, institutionId),
    eq(bankTransactions.id, id),
    eq(bankTransactions.version, expectedVersion),
    eq(bankTransactions.status, status),
  )

export async function markBankTransactionMatched(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; paymentId: string; userId: string; now: Date },
): Promise<{ version: number } | null> {
  const [row] = await tx
    .update(bankTransactions)
    .set({
      status: 'matched',
      paymentId: input.paymentId,
      matchedAt: input.now,
      matchedByUserId: input.userId,
      version: sql`${bankTransactions.version} + 1`,
      updatedAt: input.now,
    })
    .where(transition(institutionId, input.id, input.expectedVersion, 'unmatched'))
    .returning({ version: bankTransactions.version })
  return row ?? null
}

export async function markBankTransactionIgnored(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: string; userId: string; now: Date },
): Promise<{ version: number } | null> {
  const [row] = await tx
    .update(bankTransactions)
    .set({
      status: 'ignored',
      ignoredAt: input.now,
      ignoredByUserId: input.userId,
      ignoreReason: input.reason,
      version: sql`${bankTransactions.version} + 1`,
      updatedAt: input.now,
    })
    .where(transition(institutionId, input.id, input.expectedVersion, 'unmatched'))
    .returning({ version: bankTransactions.version })
  return row ?? null
}

export async function restoreBankTransaction(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<{ version: number } | null> {
  const [row] = await tx
    .update(bankTransactions)
    .set({
      status: 'unmatched',
      ignoredAt: null,
      ignoredByUserId: null,
      ignoreReason: null,
      version: sql`${bankTransactions.version} + 1`,
      updatedAt: input.now,
    })
    .where(transition(institutionId, input.id, input.expectedVersion, 'ignored'))
    .returning({ version: bankTransactions.version })
  return row ?? null
}

/**
 * Tahsilat iptal edilince ona bağlı hareket yeniden eşleşmemiş olur (K-111); bağlı hareket yoksa
 * `null`. Tahsilat iptaliyle aynı transaction'da çağrılır.
 */
export async function reopenBankTransactionOfPayment(
  tx: Database,
  institutionId: string,
  paymentId: string,
  now: Date,
): Promise<{ id: string } | null> {
  const [row] = await tx
    .update(bankTransactions)
    .set({
      status: 'unmatched',
      paymentId: null,
      matchedAt: null,
      matchedByUserId: null,
      version: sql`${bankTransactions.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(bankTransactions.institutionId, institutionId),
        eq(bankTransactions.paymentId, paymentId),
        eq(bankTransactions.status, 'matched'),
      ),
    )
    .returning({ id: bankTransactions.id })
  return row ?? null
}

/**
 * Olası mükerrer ikizleri (K-121): aynı hesaba aynı gün aynı tutarda gelen, bu hareket dışında ve
 * aynı öğrenciye iptal edilmemiş tahsilatla eşleşmiş hareket sayısı. Onay kurum kilidi altında
 * çağırır; eşzamanlı iki onaydan ikincisi birincinin eşleşmesini görür.
 */
export async function matchedTwinCount(
  db: Database,
  institutionId: string,
  input: {
    id: string
    bankAccountId: string
    bookingDate: string
    amountCents: number
    studentId: string
  },
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(bankTransactions)
    .innerJoin(payments, PAYMENT_JOIN)
    .where(
      and(
        eq(bankTransactions.institutionId, institutionId),
        eq(bankTransactions.bankAccountId, input.bankAccountId),
        eq(bankTransactions.bookingDate, input.bookingDate),
        eq(bankTransactions.amountCents, input.amountCents),
        eq(bankTransactions.status, 'matched'),
        ne(bankTransactions.id, input.id),
        isNull(bankTransactions.archivedAt),
        eq(payments.studentId, input.studentId),
        isNull(payments.reversedAt),
      ),
    )
  return row?.n ?? 0
}

/** Verilen referanslardan iptal edilmemiş bir tahsilatta kullanılanlar (DOM-FIN-031). */
export async function referencesInUse(
  db: Database,
  institutionId: string,
  references: readonly string[],
): Promise<Set<string>> {
  if (references.length === 0) return new Set()
  const rows = await db
    .select({ reference: payments.reference })
    .from(payments)
    .where(
      and(
        eq(payments.institutionId, institutionId),
        inArray(payments.reference, [...new Set(references)]),
        isNull(payments.reversedAt),
      ),
    )
  return new Set(rows.flatMap((row) => (row.reference === null ? [] : [row.reference])))
}

/** Öğrencilerin kimlik numaraları (eşleştirme dizini); sonuç kişisel veridir, loglanmaz. */
export async function identityNumbersOf(
  db: Database,
  institutionId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      studentId: studentIdentities.studentId,
      number: studentIdentities.identityNumber,
    })
    .from(studentIdentities)
    .where(
      and(eq(studentIdentities.institutionId, institutionId), isNull(studentIdentities.archivedAt)),
    )
  return new Map(rows.map((row) => [row.studentId, row.number]))
}
