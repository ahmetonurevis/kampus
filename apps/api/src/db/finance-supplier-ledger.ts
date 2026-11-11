import { randomUUID } from 'node:crypto'

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'

import type {
  SupplierInstallmentInput,
  SupplierInvoiceStatus,
  SupplierPaymentMethod,
} from '@kampus/school-core/lib/finance-supplier-ledger.ts'

import type { Database } from './client.ts'
import {
  supplierInvoiceInstallments,
  supplierInvoices,
  supplierPayments,
} from './schema/finance-supplier-ledger.ts'
import { suppliers } from './schema/finance-suppliers.ts'
import { bankAccounts } from './schema/payments.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Tedarikçi carisi deposu (DOM-FIN-076; ON-143). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-supplier-ledger.ts`'tedir; ödenen, kalan ve vadesi geçmiş tutar saklanmaz,
 * taksit ve etkin ödemelerden hesaplanır.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (value: string) => UUID.test(value)
const at = (value: Date | null) => (value === null ? null : value.toISOString())
const num = (value: unknown) => Number(value ?? 0)

const activeInvoice = (institutionId: string) =>
  and(eq(supplierInvoices.institutionId, institutionId), isNull(supplierInvoices.archivedAt))
const activeInstallment = (institutionId: string) =>
  and(
    eq(supplierInvoiceInstallments.institutionId, institutionId),
    isNull(supplierInvoiceInstallments.archivedAt),
  )
const ofPayments = (institutionId: string) =>
  and(eq(supplierPayments.institutionId, institutionId), isNull(supplierPayments.archivedAt))
const effectivePayment = (institutionId: string) =>
  and(ofPayments(institutionId), isNull(supplierPayments.cancelledAt))

/** Taksit başına etkin ödeme toplamı (alt sorgu). */
function paidByInstallment(db: Database, institutionId: string) {
  return db
    .select({
      installmentId: supplierPayments.installmentId,
      paid: sql<string>`sum(${supplierPayments.amountCents})`.as('paid'),
    })
    .from(supplierPayments)
    .where(effectivePayment(institutionId))
    .groupBy(supplierPayments.installmentId)
    .as('installment_paid')
}

/** Fatura başına ödenen, vadesi geçmiş kalan, ilk açık vade ve son vade (alt sorgu). */
function invoiceFigures(db: Database, institutionId: string, today: string) {
  const paid = paidByInstallment(db, institutionId)
  const paidCents = sql`coalesce(${paid.paid}, 0)`
  const amount = supplierInvoiceInstallments.amountCents
  return db
    .select({
      invoiceId: supplierInvoiceInstallments.invoiceId,
      paidCents: sql<string>`sum(${paidCents})`.as('paid_cents'),
      overdueCents:
        sql<string>`sum(case when ${supplierInvoiceInstallments.dueDate} < ${today} and ${amount} > ${paidCents} then ${amount} - ${paidCents} else 0 end)`.as(
          'overdue_cents',
        ),
      nextDueDate: sql<
        string | null
      >`min(case when ${amount} > ${paidCents} then ${supplierInvoiceInstallments.dueDate} end)`.as(
        'next_due_date',
      ),
      lastDueDate: sql<string>`max(${supplierInvoiceInstallments.dueDate})`.as('last_due_date'),
    })
    .from(supplierInvoiceInstallments)
    .leftJoin(paid, eq(paid.installmentId, supplierInvoiceInstallments.id))
    .where(activeInstallment(institutionId))
    .groupBy(supplierInvoiceInstallments.invoiceId)
    .as('invoice_figures')
}

const dayText = (value: unknown) =>
  value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10)

// --- Fatura --------------------------------------------------------------------------------------

export interface StoredInvoice {
  id: string
  supplierId: string
  supplierName: string
  invoiceNumber: string
  invoiceDate: string
  netCents: number
  vatCents: number
  grossCents: number
  amountIncludesVat: boolean
  purchaseOrderId: string | null
  note: string | null
  createdByUserId: string
  createdAt: string
  cancelledAt: string | null
  cancelledByUserId: string | null
  cancelReason: string | null
  version: number
  paidCents: number
  overdueCents: number
  nextDueDate: string | null
  dueDate: string
}

function invoiceSelect(db: Database, institutionId: string, today: string) {
  const figures = invoiceFigures(db, institutionId, today)
  const query = db
    .select({
      id: supplierInvoices.id,
      supplierId: supplierInvoices.supplierId,
      supplierName: suppliers.name,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      netCents: supplierInvoices.netCents,
      vatCents: supplierInvoices.vatCents,
      grossCents: supplierInvoices.grossCents,
      amountIncludesVat: supplierInvoices.amountIncludesVat,
      purchaseOrderId: supplierInvoices.purchaseOrderId,
      note: supplierInvoices.note,
      createdByUserId: supplierInvoices.createdByUserId,
      createdAt: supplierInvoices.createdAt,
      cancelledAt: supplierInvoices.cancelledAt,
      cancelledByUserId: supplierInvoices.cancelledByUserId,
      cancelReason: supplierInvoices.cancelReason,
      version: supplierInvoices.version,
      paidCents: figures.paidCents,
      overdueCents: figures.overdueCents,
      nextDueDate: figures.nextDueDate,
      dueDate: figures.lastDueDate,
    })
    .from(supplierInvoices)
    .innerJoin(
      suppliers,
      and(
        eq(suppliers.institutionId, supplierInvoices.institutionId),
        eq(suppliers.id, supplierInvoices.supplierId),
      ),
    )
    .leftJoin(figures, eq(figures.invoiceId, supplierInvoices.id))
  return { query, figures }
}

type InvoiceRow = Awaited<ReturnType<ReturnType<typeof invoiceSelect>['query']['execute']>>[number]

const toInvoice = (row: InvoiceRow): StoredInvoice => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  cancelledAt: at(row.cancelledAt),
  paidCents: num(row.paidCents),
  overdueCents: num(row.overdueCents),
  nextDueDate: dayText(row.nextDueDate),
  dueDate: dayText(row.dueDate) ?? row.invoiceDate,
})

export async function findSupplierInvoice(
  db: Database,
  institutionId: string,
  id: string,
  today: string,
): Promise<StoredInvoice | null> {
  if (!isUuid(id)) return null
  const { query } = invoiceSelect(db, institutionId, today)
  const [row] = await query
    .where(and(activeInvoice(institutionId), eq(supplierInvoices.id, id)))
    .limit(1)
  return row === undefined ? null : toInvoice(row)
}

export interface SupplierInvoiceQuery {
  page: number
  pageSize: number
  q?: string | undefined
  supplierId?: string | undefined
  purchaseOrderId?: string | undefined
  status?: SupplierInvoiceStatus | undefined
}

/** Faturalar, yeni tarihli önce. `q` fatura numarasında ya da tedarikçi adında arar. */
export async function listSupplierInvoices(
  db: Database,
  institutionId: string,
  query: SupplierInvoiceQuery,
  today: string,
): Promise<{ items: StoredInvoice[]; total: number }> {
  const { query: select, figures } = invoiceSelect(db, institutionId, today)
  const paid = sql`coalesce(${figures.paidCents}, 0)`
  const overdue = sql`coalesce(${figures.overdueCents}, 0)`
  const filters: SQL[] = []
  if (query.q !== undefined) {
    const folded = foldSearch(query.q)
    const match = or(
      sql`strpos(${foldSql(suppliers.name)}, ${folded}) > 0`,
      sql`strpos(lower(${supplierInvoices.invoiceNumber}), ${query.q.replace(/\s+/g, '').toLowerCase()}) > 0`,
    )
    if (match) filters.push(match)
  }
  if (query.supplierId !== undefined)
    filters.push(eq(supplierInvoices.supplierId, query.supplierId))
  if (query.purchaseOrderId !== undefined)
    filters.push(eq(supplierInvoices.purchaseOrderId, query.purchaseOrderId))
  const active = isNull(supplierInvoices.cancelledAt)
  switch (query.status) {
    case undefined:
      break
    case 'cancelled':
      filters.push(isNotNull(supplierInvoices.cancelledAt))
      break
    case 'paid':
      filters.push(sql`${active} and ${paid} >= ${supplierInvoices.grossCents}`)
      break
    case 'overdue':
      filters.push(sql`${active} and ${overdue} > 0`)
      break
    case 'partially_paid':
      filters.push(
        sql`${active} and ${overdue} = 0 and ${paid} > 0 and ${paid} < ${supplierInvoices.grossCents}`,
      )
      break
    case 'open':
      filters.push(sql`${active} and ${overdue} = 0 and ${paid} = 0`)
      break
    default:
      return query.status satisfies never
  }
  const where = and(activeInvoice(institutionId), ...filters)
  const [totalRow] = await db
    .select({ total: count() })
    .from(supplierInvoices)
    .innerJoin(
      suppliers,
      and(
        eq(suppliers.institutionId, supplierInvoices.institutionId),
        eq(suppliers.id, supplierInvoices.supplierId),
      ),
    )
    .leftJoin(figures, eq(figures.invoiceId, supplierInvoices.id))
    .where(where)
  const rows = await select
    .where(where)
    .orderBy(
      desc(supplierInvoices.invoiceDate),
      desc(supplierInvoices.createdAt),
      asc(supplierInvoices.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toInvoice), total: totalRow?.total ?? 0 }
}

/** Aynı tedarikçide aynı numaralı iptal edilmemiş fatura var mı (K-161). */
export async function isInvoiceNumberTaken(
  db: Database,
  institutionId: string,
  supplierId: string,
  invoiceNumber: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: supplierInvoices.id })
    .from(supplierInvoices)
    .where(
      and(
        activeInvoice(institutionId),
        isNull(supplierInvoices.cancelledAt),
        eq(supplierInvoices.supplierId, supplierId),
        eq(supplierInvoices.invoiceNumber, invoiceNumber),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Siparişe bağlı iptal edilmemiş faturaların KDV dahil toplamı (K-162). */
export async function orderInvoicedCents(
  db: Database,
  institutionId: string,
  purchaseOrderId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${supplierInvoices.grossCents}), 0)` })
    .from(supplierInvoices)
    .where(
      and(
        activeInvoice(institutionId),
        isNull(supplierInvoices.cancelledAt),
        eq(supplierInvoices.purchaseOrderId, purchaseOrderId),
      ),
    )
  return num(row?.total)
}

async function insertInstallments(
  tx: Database,
  institutionId: string,
  invoiceId: string,
  installments: readonly SupplierInstallmentInput[],
  now: Date,
): Promise<void> {
  await tx.insert(supplierInvoiceInstallments).values(
    installments.map((item, position) => ({
      institutionId,
      id: randomUUID(),
      invoiceId,
      position,
      dueDate: item.dueDate,
      amountCents: item.amountCents,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

export async function insertSupplierInvoice(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    supplierId: string
    invoiceNumber: string
    invoiceDate: string
    netCents: number
    vatCents: number
    grossCents: number
    amountIncludesVat: boolean
    purchaseOrderId: string | null
    note: string | null
    createdByUserId: string
    installments: readonly SupplierInstallmentInput[]
    now: Date
  },
): Promise<void> {
  const { now, installments, ...fields } = input
  await tx
    .insert(supplierInvoices)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
  await insertInstallments(tx, institutionId, input.id, installments, now)
}

/** Planı yeniden yazar: etkin taksitler arşivlenir, yenileri yazılır. */
export async function replaceInstallments(
  tx: Database,
  institutionId: string,
  invoiceId: string,
  installments: readonly SupplierInstallmentInput[],
  now: Date,
): Promise<void> {
  await tx
    .update(supplierInvoiceInstallments)
    .set({
      archivedAt: now,
      updatedAt: now,
      version: sql`${supplierInvoiceInstallments.version} + 1`,
    })
    .where(
      and(activeInstallment(institutionId), eq(supplierInvoiceInstallments.invoiceId, invoiceId)),
    )
  await insertInstallments(tx, institutionId, invoiceId, installments, now)
}

/** Sürüm tutmazsa `false` (409). `changes` boşsa yalnız sürüm artar (plan değişikliği). */
export async function updateSupplierInvoice(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: { cancelledAt?: Date; cancelledByUserId?: string; cancelReason?: string }
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(supplierInvoices)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        activeInvoice(institutionId),
        eq(supplierInvoices.id, input.id),
        eq(supplierInvoices.version, input.expectedVersion),
      ),
    )
    .returning({ id: supplierInvoices.id })
  return rows.length === 1
}

// --- Taksit --------------------------------------------------------------------------------------

export interface StoredInstallment {
  id: string
  invoiceId: string
  position: number
  dueDate: string
  amountCents: number
  paidCents: number
}

/** Faturaların etkin taksitleri ve her taksite yazılmış etkin ödeme toplamı, vade sırasıyla. */
export async function loadInstallments(
  db: Database,
  institutionId: string,
  invoiceIds: readonly string[],
): Promise<Map<string, StoredInstallment[]>> {
  if (invoiceIds.length === 0) return new Map()
  const paid = paidByInstallment(db, institutionId)
  const rows = await db
    .select({
      id: supplierInvoiceInstallments.id,
      invoiceId: supplierInvoiceInstallments.invoiceId,
      position: supplierInvoiceInstallments.position,
      dueDate: supplierInvoiceInstallments.dueDate,
      amountCents: supplierInvoiceInstallments.amountCents,
      paidCents: paid.paid,
    })
    .from(supplierInvoiceInstallments)
    .leftJoin(paid, eq(paid.installmentId, supplierInvoiceInstallments.id))
    .where(
      and(
        activeInstallment(institutionId),
        inArray(supplierInvoiceInstallments.invoiceId, [...new Set(invoiceIds)]),
      ),
    )
    .orderBy(asc(supplierInvoiceInstallments.position))
  const byInvoice = new Map<string, StoredInstallment[]>()
  for (const row of rows) {
    const list = byInvoice.get(row.invoiceId) ?? []
    list.push({ ...row, paidCents: num(row.paidCents) })
    byInvoice.set(row.invoiceId, list)
  }
  return byInvoice
}

/** Ödeme girişi için taksit, faturası ve taksite yazılmış etkin ödeme toplamı; yoksa `null`. */
export async function findInstallmentForPayment(
  db: Database,
  institutionId: string,
  installmentId: string,
): Promise<{
  installment: StoredInstallment
  supplierId: string
  invoiceNumber: string
  invoiceDate: string
  invoiceCancelled: boolean
} | null> {
  if (!isUuid(installmentId)) return null
  const [row] = await db
    .select({
      invoiceId: supplierInvoiceInstallments.invoiceId,
      supplierId: supplierInvoices.supplierId,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      cancelledAt: supplierInvoices.cancelledAt,
    })
    .from(supplierInvoiceInstallments)
    .innerJoin(
      supplierInvoices,
      and(
        eq(supplierInvoices.institutionId, supplierInvoiceInstallments.institutionId),
        eq(supplierInvoices.id, supplierInvoiceInstallments.invoiceId),
      ),
    )
    .where(
      and(
        activeInstallment(institutionId),
        isNull(supplierInvoices.archivedAt),
        eq(supplierInvoiceInstallments.id, installmentId),
      ),
    )
    .limit(1)
  if (row === undefined) return null
  const installment = (await loadInstallments(db, institutionId, [row.invoiceId]))
    .get(row.invoiceId)
    ?.find((item) => item.id === installmentId)
  if (installment === undefined) return null
  return {
    installment,
    supplierId: row.supplierId,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    invoiceCancelled: row.cancelledAt !== null,
  }
}

// --- Ödeme ---------------------------------------------------------------------------------------

export interface StoredSupplierPayment {
  id: string
  supplierId: string
  supplierName: string
  invoiceId: string
  invoiceNumber: string
  installmentId: string
  paidDate: string
  amountCents: number
  method: SupplierPaymentMethod
  bankAccountId: string | null
  bankAccountLabel: string | null
  description: string | null
  createdByUserId: string
  createdAt: string
  cancelledAt: string | null
  cancelledByUserId: string | null
  cancelReason: string | null
  instructionExportedAt: string | null
  instructionExportCount: number
  version: number
}

const paymentSelect = (db: Database) =>
  db
    .select({
      id: supplierPayments.id,
      supplierId: supplierPayments.supplierId,
      supplierName: suppliers.name,
      invoiceId: supplierPayments.invoiceId,
      invoiceNumber: supplierInvoices.invoiceNumber,
      installmentId: supplierPayments.installmentId,
      paidDate: supplierPayments.paidDate,
      amountCents: supplierPayments.amountCents,
      method: supplierPayments.method,
      bankAccountId: supplierPayments.bankAccountId,
      bankName: bankAccounts.bankName,
      bankIban: bankAccounts.iban,
      description: supplierPayments.description,
      createdByUserId: supplierPayments.createdByUserId,
      createdAt: supplierPayments.createdAt,
      cancelledAt: supplierPayments.cancelledAt,
      cancelledByUserId: supplierPayments.cancelledByUserId,
      cancelReason: supplierPayments.cancelReason,
      instructionExportedAt: supplierPayments.instructionExportedAt,
      instructionExportCount: supplierPayments.instructionExportCount,
      version: supplierPayments.version,
    })
    .from(supplierPayments)
    .innerJoin(
      suppliers,
      and(
        eq(suppliers.institutionId, supplierPayments.institutionId),
        eq(suppliers.id, supplierPayments.supplierId),
      ),
    )
    .innerJoin(
      supplierInvoices,
      and(
        eq(supplierInvoices.institutionId, supplierPayments.institutionId),
        eq(supplierInvoices.id, supplierPayments.invoiceId),
      ),
    )
    .leftJoin(
      bankAccounts,
      and(
        eq(bankAccounts.institutionId, supplierPayments.institutionId),
        eq(bankAccounts.id, supplierPayments.bankAccountId),
      ),
    )

type PaymentRow = Awaited<ReturnType<ReturnType<typeof paymentSelect>['execute']>>[number]

/** Kurum hesabı etiketi: banka adı ve IBAN'ın son dört hanesi (hesap kurumundur, kişisel veri değil). */
const accountLabel = (bankName: string | null, iban: string | null) =>
  bankName === null || iban === null ? null : `${bankName} ·${iban.slice(-4)}`

const toPayment = ({ bankName, bankIban, ...row }: PaymentRow): StoredSupplierPayment => ({
  ...row,
  bankAccountLabel: accountLabel(bankName, bankIban),
  createdAt: row.createdAt.toISOString(),
  cancelledAt: at(row.cancelledAt),
  instructionExportedAt: at(row.instructionExportedAt),
})

export async function findSupplierPayment(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredSupplierPayment | null> {
  if (!isUuid(id)) return null
  const [row] = await paymentSelect(db)
    .where(and(ofPayments(institutionId), eq(supplierPayments.id, id)))
    .limit(1)
  return row === undefined ? null : toPayment(row)
}

/** Faturanın bütün ödemeleri (iptal edilenler dahil), ödeme gününe göre. */
export async function loadInvoicePayments(
  db: Database,
  institutionId: string,
  invoiceId: string,
): Promise<StoredSupplierPayment[]> {
  const rows = await paymentSelect(db)
    .where(and(ofPayments(institutionId), eq(supplierPayments.invoiceId, invoiceId)))
    .orderBy(asc(supplierPayments.paidDate), asc(supplierPayments.createdAt))
  return rows.map(toPayment)
}

/** Faturaya yazılmış etkin ödeme var mı. */
export async function invoiceHasPayments(
  db: Database,
  institutionId: string,
  invoiceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: supplierPayments.id })
    .from(supplierPayments)
    .where(and(effectivePayment(institutionId), eq(supplierPayments.invoiceId, invoiceId)))
    .limit(1)
  return row !== undefined
}

export interface SupplierPaymentQuery {
  page: number
  pageSize: number
  supplierId?: string | undefined
  invoiceId?: string | undefined
  method?: SupplierPaymentMethod | undefined
  from?: string | undefined
  to?: string | undefined
  /** `pending`: talimat dosyası alınmamış etkin havale/EFT; `exported`: alınmış. */
  instruction?: 'pending' | 'exported' | undefined
  status?: 'active' | 'cancelled' | undefined
}

/** Ödemeler, yeni gün önce. */
export async function listSupplierPayments(
  db: Database,
  institutionId: string,
  query: SupplierPaymentQuery,
): Promise<{ items: StoredSupplierPayment[]; total: number }> {
  const filters: SQL[] = []
  if (query.supplierId !== undefined)
    filters.push(eq(supplierPayments.supplierId, query.supplierId))
  if (query.invoiceId !== undefined) filters.push(eq(supplierPayments.invoiceId, query.invoiceId))
  if (query.method !== undefined) filters.push(eq(supplierPayments.method, query.method))
  if (query.from !== undefined) filters.push(gte(supplierPayments.paidDate, query.from))
  if (query.to !== undefined) filters.push(lte(supplierPayments.paidDate, query.to))
  if (query.status === 'active') filters.push(isNull(supplierPayments.cancelledAt))
  if (query.status === 'cancelled') filters.push(isNotNull(supplierPayments.cancelledAt))
  if (query.instruction !== undefined) {
    filters.push(isNull(supplierPayments.cancelledAt))
    filters.push(inArray(supplierPayments.method, ['transfer', 'eft']))
    filters.push(
      query.instruction === 'pending'
        ? isNull(supplierPayments.instructionExportedAt)
        : isNotNull(supplierPayments.instructionExportedAt),
    )
  }
  const where = and(ofPayments(institutionId), ...filters)
  const [totalRow] = await db.select({ total: count() }).from(supplierPayments).where(where)
  const rows = await paymentSelect(db)
    .where(where)
    .orderBy(
      desc(supplierPayments.paidDate),
      desc(supplierPayments.createdAt),
      asc(supplierPayments.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toPayment), total: totalRow?.total ?? 0 }
}

export async function insertSupplierPayment(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    supplierId: string
    invoiceId: string
    installmentId: string
    paidDate: string
    amountCents: number
    method: SupplierPaymentMethod
    bankAccountId: string | null
    description: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(supplierPayments)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** İptal; sürüm tutmazsa `false` (409). */
export async function cancelSupplierPaymentRow(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; reason: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(supplierPayments)
    .set({
      cancelledAt: input.now,
      cancelledByUserId: input.userId,
      cancelReason: input.reason,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        ofPayments(institutionId),
        eq(supplierPayments.id, input.id),
        eq(supplierPayments.version, input.expectedVersion),
      ),
    )
    .returning({ id: supplierPayments.id })
  return rows.length === 1
}

/** Gün sonuna giren nakit tedarikçi ödemesi (K-166); IBAN ve vergi numarası yoktur. */
export interface StoredDaySupplierPayment {
  paymentId: string
  supplierName: string
  invoiceNumber: string
  amountCents: number
  paidDate: string
  method: SupplierPaymentMethod
  cancelledAt: string | null
}

/**
 * O gün kasadan ödenen etkin nakit tedarikçi ödemeleri (DOM-FIN-036, K-166), giriş sırasıyla.
 * İptal edilen ödeme ödeme gününün raporundan çıkar; `supplier_payments_paid_date_idx`'e iner.
 */
export async function cashSupplierPaymentsOnDay(
  db: Database,
  institutionId: string,
  day: string,
): Promise<StoredDaySupplierPayment[]> {
  const rows = await db
    .select({
      paymentId: supplierPayments.id,
      supplierName: suppliers.name,
      invoiceNumber: supplierInvoices.invoiceNumber,
      amountCents: supplierPayments.amountCents,
      paidDate: supplierPayments.paidDate,
      method: supplierPayments.method,
      cancelledAt: supplierPayments.cancelledAt,
    })
    .from(supplierPayments)
    .innerJoin(
      suppliers,
      and(
        eq(suppliers.institutionId, supplierPayments.institutionId),
        eq(suppliers.id, supplierPayments.supplierId),
      ),
    )
    .innerJoin(
      supplierInvoices,
      and(
        eq(supplierInvoices.institutionId, supplierPayments.institutionId),
        eq(supplierInvoices.id, supplierPayments.invoiceId),
      ),
    )
    .where(
      and(
        effectivePayment(institutionId),
        eq(supplierPayments.paidDate, day),
        eq(supplierPayments.method, 'cash'),
      ),
    )
    .orderBy(asc(supplierPayments.createdAt), asc(supplierPayments.id))
  return rows.map((row) => ({ ...row, cancelledAt: at(row.cancelledAt) }))
}

export interface StoredInstructionPayment {
  id: string
  method: SupplierPaymentMethod
  cancelled: boolean
  exported: boolean
  supplierName: string
  iban: string | null
  amountCents: number
  paidDate: string
  description: string | null
  invoiceNumber: string
  sourceIban: string | null
}

/** Talimat dosyası satırları: tedarikçinin IBAN'ı ve kurum hesabının IBAN'ı açık okunur (K-164). */
export async function loadInstructionPayments(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<StoredInstructionPayment[]> {
  const valid = ids.filter(isUuid)
  if (valid.length === 0) return []
  const rows = await db
    .select({
      id: supplierPayments.id,
      method: supplierPayments.method,
      cancelledAt: supplierPayments.cancelledAt,
      exportedAt: supplierPayments.instructionExportedAt,
      supplierName: suppliers.name,
      iban: suppliers.iban,
      amountCents: supplierPayments.amountCents,
      paidDate: supplierPayments.paidDate,
      description: supplierPayments.description,
      invoiceNumber: supplierInvoices.invoiceNumber,
      sourceIban: bankAccounts.iban,
    })
    .from(supplierPayments)
    .innerJoin(
      suppliers,
      and(
        eq(suppliers.institutionId, supplierPayments.institutionId),
        eq(suppliers.id, supplierPayments.supplierId),
      ),
    )
    .innerJoin(
      supplierInvoices,
      and(
        eq(supplierInvoices.institutionId, supplierPayments.institutionId),
        eq(supplierInvoices.id, supplierPayments.invoiceId),
      ),
    )
    .leftJoin(
      bankAccounts,
      and(
        eq(bankAccounts.institutionId, supplierPayments.institutionId),
        eq(bankAccounts.id, supplierPayments.bankAccountId),
      ),
    )
    .where(and(ofPayments(institutionId), inArray(supplierPayments.id, [...new Set(valid)])))
  return rows.map(({ cancelledAt, exportedAt, ...row }) => ({
    ...row,
    cancelled: cancelledAt !== null,
    exported: exportedAt !== null,
  }))
}

/** Talimat dosyasına alınan ödemeleri işaretler; ilk alanı ve zamanı korur, sayacı artırır. */
export async function markInstructionExported(
  tx: Database,
  institutionId: string,
  ids: readonly string[],
  userId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(supplierPayments)
    .set({
      instructionExportedAt: sql`coalesce(${supplierPayments.instructionExportedAt}, ${now})`,
      instructionExportedByUserId: sql`coalesce(${supplierPayments.instructionExportedByUserId}, ${userId})`,
      instructionExportCount: sql`${supplierPayments.instructionExportCount} + 1`,
      updatedAt: now,
      version: sql`${supplierPayments.version} + 1`,
    })
    .where(and(ofPayments(institutionId), inArray(supplierPayments.id, [...ids])))
}

// --- Cari ----------------------------------------------------------------------------------------

export interface SupplierLedgerFigures {
  supplierId: string
  invoicedCents: number
  paidCents: number
  overdueCents: number
  nextDueDate: string | null
  invoiceCount: number
}

/** Faturası olan tedarikçilerin etkin fatura, ödeme ve vadesi geçmiş toplamı. */
export async function supplierLedgerFigures(
  db: Database,
  institutionId: string,
  today: string,
): Promise<SupplierLedgerFigures[]> {
  const figures = invoiceFigures(db, institutionId, today)
  const rows = await db
    .select({
      supplierId: supplierInvoices.supplierId,
      invoicedCents: sql<string>`sum(${supplierInvoices.grossCents})`,
      paidCents: sql<string>`sum(coalesce(${figures.paidCents}, 0))`,
      overdueCents: sql<string>`sum(coalesce(${figures.overdueCents}, 0))`,
      nextDueDate: sql<string | null>`min(${figures.nextDueDate})`,
      invoiceCount: count(),
    })
    .from(supplierInvoices)
    .leftJoin(figures, eq(figures.invoiceId, supplierInvoices.id))
    .where(and(activeInvoice(institutionId), isNull(supplierInvoices.cancelledAt)))
    .groupBy(supplierInvoices.supplierId)
  return rows.map((row) => ({
    supplierId: row.supplierId,
    invoicedCents: num(row.invoicedCents),
    paidCents: num(row.paidCents),
    overdueCents: num(row.overdueCents),
    nextDueDate: dayText(row.nextDueDate),
    invoiceCount: row.invoiceCount,
  }))
}

/** Tedarikçinin ekstresi için bütün faturaları ve ödemeleri (iptaller dahil). */
export async function loadSupplierStatementRows(
  db: Database,
  institutionId: string,
  supplierId: string,
) {
  const invoices = await db
    .select({
      id: supplierInvoices.id,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      grossCents: supplierInvoices.grossCents,
      createdAt: supplierInvoices.createdAt,
      cancelledAt: supplierInvoices.cancelledAt,
    })
    .from(supplierInvoices)
    .where(and(activeInvoice(institutionId), eq(supplierInvoices.supplierId, supplierId)))
  const payments = await db
    .select({
      id: supplierPayments.id,
      invoiceId: supplierPayments.invoiceId,
      invoiceNumber: supplierInvoices.invoiceNumber,
      paidDate: supplierPayments.paidDate,
      amountCents: supplierPayments.amountCents,
      method: supplierPayments.method,
      createdAt: supplierPayments.createdAt,
      cancelledAt: supplierPayments.cancelledAt,
    })
    .from(supplierPayments)
    .innerJoin(
      supplierInvoices,
      and(
        eq(supplierInvoices.institutionId, supplierPayments.institutionId),
        eq(supplierInvoices.id, supplierPayments.invoiceId),
      ),
    )
    .where(and(ofPayments(institutionId), eq(supplierPayments.supplierId, supplierId)))
  return {
    invoices: invoices.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      cancelledAt: at(row.cancelledAt),
    })),
    payments: payments.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      cancelledAt: at(row.cancelledAt),
    })),
  }
}
