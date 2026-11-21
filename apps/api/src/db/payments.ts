import { and, asc, count, desc, eq, gte, inArray, isNull, lt, max, or, sql } from 'drizzle-orm'

import type { ExportPayment } from '@kampus/school-core/lib/finance-export.ts'
import type { ReconciliationPayment } from '@kampus/school-core/lib/finance-reconciliation.ts'
import {
  bankAccountLabel,
  type PaymentAllocation,
  type PaymentPlan,
} from '@kampus/school-core/lib/payments.ts'
import type { PaymentMethod } from '@kampus/school-core/lib/payments.ts'
import type { Database } from './client.ts'
import { records } from './schema/records.ts'
import { foldSearch, foldSql } from './text-search.ts'
import {
  bankAccounts,
  PAYMENT_METHOD_KEYS,
  paymentAllocations,
  payments,
  paymentSettings,
} from './schema/payments.ts'

/** Tahsilat deposu (ADR 0006). İlk parametreler veritabanı ve `institutionId`'dir. */

export interface StoredPayment {
  id: string
  studentId: string
  /** Arşivlenmemiş öğrenci kaydındaki ad; kayıt yoksa boş. */
  studentName: string | null
  amountCents: number
  method: PaymentMethod
  reference: string | null
  paidAt: Date
  receiptYear: number
  receiptNumber: number
  reversedAt: Date | null
  reversalReason: string | null
  bankAccountId: string | null
  bankAccountLabel: string | null
  mebbisRecordedAt: Date | null
  version: number
  allocations: PaymentAllocation[]
}

export const METHOD_LABELS = Object.fromEntries(
  Object.entries(PAYMENT_METHOD_KEYS).map(([label, key]) => [key, label]),
) as Record<string, PaymentMethod>

/** Tahsilatın öğrenci kaydı: ad ve arama içindir; kurum eşleşmesi zorunludur. */
const STUDENT_JOIN = and(
  eq(records.institutionId, payments.institutionId),
  eq(records.collection, 'students'),
  eq(records.id, payments.studentId),
)

/** Arşivlenmiş hesap da eşleşir: geçmiş tahsilat hesabını göstermeyi sürdürür. */
const BANK_JOIN = and(
  eq(bankAccounts.institutionId, payments.institutionId),
  eq(bankAccounts.id, payments.bankAccountId),
)

const COLUMNS = {
  id: payments.id,
  studentId: payments.studentId,
  studentName: sql<string | null>`${records.data} ->> 'name'`,
  amountCents: payments.amountCents,
  method: payments.method,
  reference: payments.reference,
  paidAt: payments.paidAt,
  receiptYear: payments.receiptYear,
  receiptNumber: payments.receiptNumber,
  reversedAt: payments.reversedAt,
  reversalReason: payments.reversalReason,
  bankAccountId: payments.bankAccountId,
  bankName: bankAccounts.bankName,
  bankIban: bankAccounts.iban,
  mebbisRecordedAt: payments.mebbisRecordedAt,
  version: payments.version,
}
type Row = {
  id: string
  studentId: string
  studentName: string | null
  amountCents: number
  method: string
  reference: string | null
  paidAt: Date
  receiptYear: number
  receiptNumber: number
  reversedAt: Date | null
  reversalReason: string | null
  bankAccountId: string | null
  bankName: string | null
  bankIban: string | null
  mebbisRecordedAt: Date | null
  version: number
}

async function withAllocations(
  db: Database,
  institutionId: string,
  rows: readonly Row[],
): Promise<StoredPayment[]> {
  if (rows.length === 0) return []
  const allocations = await db
    .select({
      paymentId: paymentAllocations.paymentId,
      invoiceId: paymentAllocations.invoiceId,
      amountCents: paymentAllocations.amountCents,
    })
    .from(paymentAllocations)
    .where(
      and(
        eq(paymentAllocations.institutionId, institutionId),
        inArray(
          paymentAllocations.paymentId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(paymentAllocations.createdAt), asc(paymentAllocations.invoiceId))
  return rows.map((row) => {
    const method = METHOD_LABELS[row.method]
    if (method === undefined) throw new Error(`unknown payment method: ${row.method}`)
    const { bankName, bankIban, ...rest } = row
    return {
      ...rest,
      method,
      bankAccountLabel:
        bankName !== null && bankIban !== null
          ? bankAccountLabel({ bankName, iban: bankIban })
          : null,
      allocations: allocations
        .filter((item) => item.paymentId === row.id)
        .map(({ invoiceId, amountCents }) => ({ invoiceId, amountCents })),
    }
  })
}

/** Öğrencinin taksitlerine iptal edilmemiş tahsilatlardan dağıtılmış toplamlar. */
export async function allocatedByInvoice(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      invoiceId: paymentAllocations.invoiceId,
      total: sql<string>`sum(${paymentAllocations.amountCents})`,
    })
    .from(paymentAllocations)
    .innerJoin(
      payments,
      and(
        eq(payments.institutionId, paymentAllocations.institutionId),
        eq(payments.id, paymentAllocations.paymentId),
      ),
    )
    .where(
      and(
        eq(paymentAllocations.institutionId, institutionId),
        eq(payments.studentId, studentId),
        isNull(payments.reversedAt),
      ),
    )
    .groupBy(paymentAllocations.invoiceId)
  return new Map(rows.map((row) => [row.invoiceId, Number(row.total)]))
}

/** Öğrencinin iptal edilmemiş tahsilatlarının toplamı. */
export async function paymentTotal(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`sum(${payments.amountCents})` })
    .from(payments)
    .where(
      and(
        eq(payments.institutionId, institutionId),
        eq(payments.studentId, studentId),
        isNull(payments.reversedAt),
      ),
    )
  return Number(row?.total ?? 0)
}

/** Kurumun bütün taksitlerine iptal edilmemiş tahsilatlardan dağıtılmış toplamlar. */
export async function allocatedTotals(
  db: Database,
  institutionId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      invoiceId: paymentAllocations.invoiceId,
      total: sql<string>`sum(${paymentAllocations.amountCents})`,
    })
    .from(paymentAllocations)
    .innerJoin(
      payments,
      and(
        eq(payments.institutionId, paymentAllocations.institutionId),
        eq(payments.id, paymentAllocations.paymentId),
      ),
    )
    .where(and(eq(paymentAllocations.institutionId, institutionId), isNull(payments.reversedAt)))
    .groupBy(paymentAllocations.invoiceId)
  return new Map(rows.map((row) => [row.invoiceId, Number(row.total)]))
}

/** Verilen taksitlere iptal edilmemiş tahsilatlardan dağıtılmış toplamlar. */
export async function allocatedForInvoices(
  db: Database,
  institutionId: string,
  invoiceIds: readonly string[],
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map()
  const rows = await db
    .select({
      invoiceId: paymentAllocations.invoiceId,
      total: sql<string>`sum(${paymentAllocations.amountCents})`,
    })
    .from(paymentAllocations)
    .innerJoin(
      payments,
      and(
        eq(payments.institutionId, paymentAllocations.institutionId),
        eq(payments.id, paymentAllocations.paymentId),
      ),
    )
    .where(
      and(
        eq(paymentAllocations.institutionId, institutionId),
        inArray(paymentAllocations.invoiceId, [...invoiceIds]),
        isNull(payments.reversedAt),
      ),
    )
    .groupBy(paymentAllocations.invoiceId)
  return new Map(rows.map((row) => [row.invoiceId, Number(row.total)]))
}

/** Ödeme veya iptal anı aralığa düşen tahsilatlar; kesin gün süzmesi core'dadır. */
export async function paymentsTouchingPeriod(
  db: Database,
  institutionId: string,
  fromInstant: Date,
  toInstant: Date,
): Promise<ExportPayment[]> {
  const rows = await db
    .select({
      studentId: payments.studentId,
      amountCents: payments.amountCents,
      method: payments.method,
      reference: payments.reference,
      paidAt: payments.paidAt,
      receiptYear: payments.receiptYear,
      receiptNumber: payments.receiptNumber,
      reversedAt: payments.reversedAt,
    })
    .from(payments)
    .where(
      and(
        eq(payments.institutionId, institutionId),
        or(
          and(gte(payments.paidAt, fromInstant), lt(payments.paidAt, toInstant)),
          and(gte(payments.reversedAt, fromInstant), lt(payments.reversedAt, toInstant)),
        ),
      ),
    )
  return rows.map((row) => ({
    ...row,
    method: METHOD_LABELS[row.method] ?? '',
    paidAt: row.paidAt.toISOString(),
    reversedAt: row.reversedAt?.toISOString() ?? null,
  }))
}

/**
 * Gün sonu raporunun tahsilatları (IST-113): ödeme veya iptal anı aralığa düşenler, ad ve hesapla.
 * Kesin gün süzmesi core'dadır. `payments_paid_at_idx` ödeme anına iner; iptal anı için indeks yok,
 * satırlar kurum içinde taranır (kurum kilidi altında ve günde bir kez).
 */
export async function paymentsTouchingDay(
  db: Database,
  institutionId: string,
  fromInstant: Date,
  toInstant: Date,
): Promise<StoredPayment[]> {
  const rows = await db
    .select(COLUMNS)
    .from(payments)
    .leftJoin(records, STUDENT_JOIN)
    .leftJoin(bankAccounts, BANK_JOIN)
    .where(
      and(
        eq(payments.institutionId, institutionId),
        or(
          and(gte(payments.paidAt, fromInstant), lt(payments.paidAt, toInstant)),
          and(gte(payments.reversedAt, fromInstant), lt(payments.reversedAt, toInstant)),
        ),
      ),
    )
    .orderBy(asc(payments.paidAt), asc(payments.receiptNumber))
  return withAllocations(db, institutionId, rows)
}

export async function isReferenceInUse(
  db: Database,
  institutionId: string,
  reference: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.institutionId, institutionId),
        eq(payments.reference, reference),
        isNull(payments.reversedAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Ardışık numara kurum kilidi altında okunur; benzersiz indeks ikinci güvencedir (ADR 0006). */
async function nextReceiptNumber(db: Database, institutionId: string, year: number) {
  const [row] = await db
    .select({ last: max(payments.receiptNumber) })
    .from(payments)
    .where(and(eq(payments.institutionId, institutionId), eq(payments.receiptYear, year)))
  return (row?.last ?? 0) + 1
}

export async function insertPayment(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    plan: PaymentPlan
    receiptYear: number
    recordedByUserId: string
    now: Date
  },
): Promise<void> {
  const { id, plan, receiptYear, recordedByUserId, now } = input
  const receiptNumber = await nextReceiptNumber(tx, institutionId, receiptYear)
  await tx.insert(payments).values({
    institutionId,
    id,
    studentId: plan.studentId,
    amountCents: plan.amountCents,
    method: PAYMENT_METHOD_KEYS[plan.method],
    reference: plan.reference,
    bankAccountId: plan.bankAccountId,
    paidAt: new Date(plan.paidAt),
    receiptYear,
    receiptNumber,
    recordedByUserId,
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(paymentAllocations).values(
    plan.allocations.map((allocation) => ({
      institutionId,
      paymentId: id,
      invoiceId: allocation.invoiceId,
      amountCents: allocation.amountCents,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

export async function findPayment(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPayment | null> {
  const rows = await db
    .select(COLUMNS)
    .from(payments)
    .leftJoin(records, STUDENT_JOIN)
    .leftJoin(bankAccounts, BANK_JOIN)
    .where(and(eq(payments.institutionId, institutionId), eq(payments.id, id)))
    .limit(1)
  const [found] = await withAllocations(db, institutionId, rows)
  return found ?? null
}

/** `studentIds` verilirse liste bu öğrencilerle sınırlıdır (veli ve öğrenci kapsamı). */
export async function listPayments(
  db: Database,
  institutionId: string,
  query: {
    studentId?: string | undefined
    studentIds: readonly string[] | null
    q?: string | undefined
    /** Yalnız MEBBİS'e işlenmemiş geçerli tahsilatlar. */
    mebbisPending?: boolean
    /** Yalnız bu ödeme yöntemiyle alınanlar. */
    method?: PaymentMethod | undefined
    /** Ödeme anı aralığı: başlangıç dahil, bitiş hariç (Europe/Istanbul günlerinden çevrilmiş). */
    paidFrom?: Date | undefined
    paidBefore?: Date | undefined
    page: number
    pageSize: number
  },
): Promise<{ items: StoredPayment[]; total: number }> {
  const where = and(
    eq(payments.institutionId, institutionId),
    query.studentId === undefined ? undefined : eq(payments.studentId, query.studentId),
    query.studentIds === null ? undefined : inArray(payments.studentId, [...query.studentIds]),
    query.mebbisPending
      ? and(isNull(payments.mebbisRecordedAt), isNull(payments.reversedAt))
      : undefined,
    query.method === undefined ? undefined : eq(payments.method, PAYMENT_METHOD_KEYS[query.method]),
    query.paidFrom === undefined ? undefined : gte(payments.paidAt, query.paidFrom),
    query.paidBefore === undefined ? undefined : lt(payments.paidAt, query.paidBefore),
    query.q === undefined
      ? undefined
      : sql`(strpos(${foldSql(sql`${records.data} ->> 'name'`)}, ${foldSearch(query.q)}) > 0 or strpos(${foldSql(payments.reference)}, ${foldSearch(query.q)}) > 0)`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(payments)
    .leftJoin(records, STUDENT_JOIN)
    .where(where)
  const rows = await db
    .select(COLUMNS)
    .from(payments)
    .leftJoin(records, STUDENT_JOIN)
    .leftJoin(bankAccounts, BANK_JOIN)
    .where(where)
    .orderBy(desc(payments.paidAt), desc(payments.receiptNumber))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: await withAllocations(db, institutionId, rows),
    total: totalRow?.total ?? 0,
  }
}

/** Sürüm koşulu tutmazsa `null` döner. */
/**
 * Mutabakat için verilen andan önceki bütün tahsilatlar ve dağılımları (ON-085): dönem başı açık borç
 * geçmişin tamamından hesaplanır. İptal edilenler de gelir; iptal günü core'da değerlendirilir.
 */
export async function paymentsForReconciliation(
  db: Database,
  institutionId: string,
  toInstant: Date,
): Promise<ReconciliationPayment[]> {
  const where = and(eq(payments.institutionId, institutionId), lt(payments.paidAt, toInstant))
  const rows = await db
    .select({
      id: payments.id,
      studentId: payments.studentId,
      amountCents: payments.amountCents,
      paidAt: payments.paidAt,
      reversedAt: payments.reversedAt,
    })
    .from(payments)
    .where(where)
  const allocations = await db
    .select({
      paymentId: paymentAllocations.paymentId,
      invoiceId: paymentAllocations.invoiceId,
      amountCents: paymentAllocations.amountCents,
    })
    .from(paymentAllocations)
    .innerJoin(
      payments,
      and(
        eq(payments.institutionId, paymentAllocations.institutionId),
        eq(payments.id, paymentAllocations.paymentId),
      ),
    )
    .where(where)
  const byPayment = new Map<string, { invoiceId: string; amountCents: number }[]>()
  for (const { paymentId, ...allocation } of allocations) {
    const list = byPayment.get(paymentId)
    if (list) list.push(allocation)
    else byPayment.set(paymentId, [allocation])
  }
  return rows.map(({ id, ...row }) => ({
    ...row,
    paidAt: row.paidAt.toISOString(),
    reversedAt: row.reversedAt?.toISOString() ?? null,
    allocations: byPayment.get(id) ?? [],
  }))
}

/** Öğrencinin bütün tahsilatları, iptal edilenler dahil; ekstre sayfalanmaz (IST-107). */
export async function paymentsOfStudent(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<StoredPayment[]> {
  const rows = await db
    .select(COLUMNS)
    .from(payments)
    .leftJoin(records, STUDENT_JOIN)
    .leftJoin(bankAccounts, BANK_JOIN)
    .where(and(eq(payments.institutionId, institutionId), eq(payments.studentId, studentId)))
    .orderBy(asc(payments.paidAt), asc(payments.receiptNumber))
  return withAllocations(db, institutionId, rows)
}

export async function markPaymentReversed(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    reversedByUserId: string
    reason: string
    now: Date
  },
): Promise<{ version: number } | null> {
  const [row] = await tx
    .update(payments)
    .set({
      reversedAt: input.now,
      reversedByUserId: input.reversedByUserId,
      reversalReason: input.reason,
      version: sql`${payments.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(payments.institutionId, institutionId),
        eq(payments.id, input.id),
        eq(payments.version, input.expectedVersion),
      ),
    )
    .returning({ version: payments.version })
  return row ?? null
}

export interface StoredPaymentSettings {
  cashPaymentsEnabled: boolean
  version: number
}

/** Satır yoksa varsayılan: nakit kapalı, sürüm 1 (`If-Match` 1'den başlar). */
export async function loadPaymentSettings(
  db: Database,
  institutionId: string,
): Promise<StoredPaymentSettings> {
  const [row] = await db
    .select({
      cashPaymentsEnabled: paymentSettings.cashPaymentsEnabled,
      version: paymentSettings.version,
    })
    .from(paymentSettings)
    .where(eq(paymentSettings.institutionId, institutionId))
    .limit(1)
  return row ?? { cashPaymentsEnabled: false, version: 1 }
}

/** Sürüm koşulu tutmazsa `null` döner. İlk yazım satırı açar; varsayılanın sürümü 1'dir, satırın 2. */
export async function savePaymentSettings(
  tx: Database,
  institutionId: string,
  input: { cashPaymentsEnabled: boolean; expectedVersion: number; now: Date },
): Promise<StoredPaymentSettings | null> {
  const columns = {
    cashPaymentsEnabled: paymentSettings.cashPaymentsEnabled,
    version: paymentSettings.version,
  }
  const [updated] = await tx
    .update(paymentSettings)
    .set({
      cashPaymentsEnabled: input.cashPaymentsEnabled,
      version: sql`${paymentSettings.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(paymentSettings.institutionId, institutionId),
        eq(paymentSettings.version, input.expectedVersion),
      ),
    )
    .returning(columns)
  if (updated) return updated
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(paymentSettings)
    .values({
      institutionId,
      cashPaymentsEnabled: input.cashPaymentsEnabled,
      version: 2,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning(columns)
  return created ?? null
}

/**
 * MEBBİS işaretini yazar veya kaldırır; sürüm koşulu tutmazsa `null` döner (DOM-FIN-032). Parmak izini
 * yalnız e-Özel işareti verir (IST-085); verilmezse önceki özet de silinir.
 */
export async function setPaymentMebbis(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    recordedByUserId: string | null
    fingerprint?: string | null
    now: Date
  },
): Promise<{ version: number } | null> {
  const [row] = await tx
    .update(payments)
    .set({
      mebbisRecordedAt: input.recordedByUserId === null ? null : input.now,
      mebbisRecordedByUserId: input.recordedByUserId,
      mebbisFingerprint: input.fingerprint ?? null,
      version: sql`${payments.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(payments.institutionId, institutionId),
        eq(payments.id, input.id),
        eq(payments.version, input.expectedVersion),
      ),
    )
    .returning({ version: payments.version })
  return row ?? null
}

export interface StoredBankAccount {
  id: string
  bankName: string
  iban: string
  accountHolder: string
  version: number
}

const BANK_ACCOUNT_COLUMNS = {
  id: bankAccounts.id,
  bankName: bankAccounts.bankName,
  iban: bankAccounts.iban,
  accountHolder: bankAccounts.accountHolder,
  version: bankAccounts.version,
}

/** Kurumun arşivlenmemiş hesapları, ilk eklenen önce. */
export function listBankAccounts(
  db: Database,
  institutionId: string,
): Promise<StoredBankAccount[]> {
  return db
    .select(BANK_ACCOUNT_COLUMNS)
    .from(bankAccounts)
    .where(and(eq(bankAccounts.institutionId, institutionId), isNull(bankAccounts.archivedAt)))
    .orderBy(asc(bankAccounts.createdAt), asc(bankAccounts.id))
}

export async function insertBankAccount(
  tx: Database,
  institutionId: string,
  input: { id: string; bankName: string; iban: string; accountHolder: string; now: Date },
): Promise<StoredBankAccount> {
  const { now, ...values } = input
  const [row] = await tx
    .insert(bankAccounts)
    .values({ institutionId, ...values, createdAt: now, updatedAt: now })
    .returning(BANK_ACCOUNT_COLUMNS)
  if (row === undefined) throw new Error('bank account was not written')
  return row
}

/** Sürüm koşulu tutmazsa `null` döner. */
export async function archiveBankAccount(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<{ version: number } | null> {
  const [row] = await tx
    .update(bankAccounts)
    .set({
      archivedAt: input.now,
      version: sql`${bankAccounts.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(bankAccounts.institutionId, institutionId),
        eq(bankAccounts.id, input.id),
        eq(bankAccounts.version, input.expectedVersion),
      ),
    )
    .returning({ version: bankAccounts.version })
  return row ?? null
}
