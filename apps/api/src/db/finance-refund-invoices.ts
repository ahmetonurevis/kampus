import { and, count, desc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm'

import type {
  OriginalInvoiceType,
  RefundDocumentKind,
  RefundDocumentStatus,
  RefundVatRate,
} from '@kampus/school-core/lib/finance-refund-invoices.ts'

import type { Database } from './client.ts'
import { refundInvoices } from './schema/finance-refund-invoices.ts'
import { records } from './schema/records.ts'
import { studentWithdrawals } from './schema/withdrawals.ts'

/**
 * İade faturası ve iptal isteği deposu (DOM-FIN-096; ON-266). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Vazgeçilen (arşivlenmiş) belge okunmaz. Belgeyle birlikte dayandığı iadenin
 * günleri, tutarı ve öğrencinin adı okunur; IBAN ve hesap sahibi seçilmez (K-295).
 */

export interface StoredRefundInvoice {
  id: string
  withdrawalId: string
  studentName: string | null
  withdrawalDate: string
  refundCents: number
  refundPaidDate: string | null
  kind: RefundDocumentKind
  status: RefundDocumentStatus
  originalInvoiceNumber: string
  originalInvoiceDate: string
  originalInvoiceType: OriginalInvoiceType
  originalTotalCents: number
  vatRateBasisPoints: RefundVatRate
  amountCents: number
  netCents: number
  vatCents: number
  note: string | null
  documentNumber: string | null
  completedDate: string | null
  createdAt: string
  readyAt: string | null
  completedAt: string | null
  version: number
}

const WITHDRAWAL_JOIN = and(
  eq(studentWithdrawals.institutionId, refundInvoices.institutionId),
  eq(studentWithdrawals.id, refundInvoices.withdrawalId),
)
const STUDENT_JOIN = and(
  eq(records.institutionId, studentWithdrawals.institutionId),
  eq(records.collection, 'students'),
  eq(records.id, studentWithdrawals.studentId),
)

const COLUMNS = {
  id: refundInvoices.id,
  withdrawalId: refundInvoices.withdrawalId,
  studentName: sql<string | null>`${records.data} ->> 'name'`,
  withdrawalDate: studentWithdrawals.withdrawalDate,
  refundCents: studentWithdrawals.refundCents,
  refundPaidDate: studentWithdrawals.refundPaidDate,
  kind: refundInvoices.kind,
  status: refundInvoices.status,
  originalInvoiceNumber: refundInvoices.originalInvoiceNumber,
  originalInvoiceDate: refundInvoices.originalInvoiceDate,
  originalInvoiceType: refundInvoices.originalInvoiceType,
  originalTotalCents: refundInvoices.originalTotalCents,
  vatRateBasisPoints: refundInvoices.vatRateBasisPoints,
  amountCents: refundInvoices.amountCents,
  netCents: refundInvoices.netCents,
  vatCents: refundInvoices.vatCents,
  note: refundInvoices.note,
  documentNumber: refundInvoices.documentNumber,
  completedDate: refundInvoices.completedDate,
  createdAt: refundInvoices.createdAt,
  readyAt: refundInvoices.readyAt,
  completedAt: refundInvoices.completedAt,
  version: refundInvoices.version,
}

type Row = Omit<
  StoredRefundInvoice,
  | 'kind'
  | 'status'
  | 'originalInvoiceType'
  | 'vatRateBasisPoints'
  | 'createdAt'
  | 'readyAt'
  | 'completedAt'
> & {
  kind: string
  status: string
  originalInvoiceType: string
  vatRateBasisPoints: number
  createdAt: Date
  readyAt: Date | null
  completedAt: Date | null
}

// Sözlük değerleri `refund_invoices_*_check` kısıtlarıyla sınırlıdır.
const stored = (row: Row): StoredRefundInvoice => ({
  ...row,
  kind: row.kind as RefundDocumentKind,
  status: row.status as RefundDocumentStatus,
  originalInvoiceType: row.originalInvoiceType as OriginalInvoiceType,
  vatRateBasisPoints: row.vatRateBasisPoints as RefundVatRate,
  createdAt: row.createdAt.toISOString(),
  readyAt: row.readyAt?.toISOString() ?? null,
  completedAt: row.completedAt?.toISOString() ?? null,
})

const active = (institutionId: string) =>
  and(eq(refundInvoices.institutionId, institutionId), isNull(refundInvoices.archivedAt))

export async function findRefundInvoice(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredRefundInvoice | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(refundInvoices)
    .innerJoin(studentWithdrawals, WITHDRAWAL_JOIN)
    .leftJoin(records, STUDENT_JOIN)
    .where(and(active(institutionId), eq(refundInvoices.id, id)))
    .limit(1)
  return row ? stored(row) : null
}

/** İadenin arşivlenmemiş belgesi var mı (iade başına tek belge, K-293). */
export async function hasActiveRefundInvoice(
  db: Database,
  institutionId: string,
  withdrawalId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: refundInvoices.id })
    .from(refundInvoices)
    .where(and(active(institutionId), eq(refundInvoices.withdrawalId, withdrawalId)))
    .limit(1)
  return row !== undefined
}

export interface RefundInvoiceFilters {
  status?: RefundDocumentStatus | undefined
  kind?: RefundDocumentKind | undefined
  withdrawalId?: string | undefined
}

function where(institutionId: string, filters: RefundInvoiceFilters): SQL | undefined {
  return and(
    active(institutionId),
    filters.status === undefined ? undefined : eq(refundInvoices.status, filters.status),
    filters.kind === undefined ? undefined : eq(refundInvoices.kind, filters.kind),
    filters.withdrawalId === undefined
      ? undefined
      : eq(refundInvoices.withdrawalId, filters.withdrawalId),
  )
}

/** En yeni belge önce gelir; sayfalıdır (CSV en çok `REFUND_INVOICE_CSV_MAX` satır ister). */
export async function listRefundInvoices(
  db: Database,
  institutionId: string,
  query: RefundInvoiceFilters & { page: number; pageSize: number },
): Promise<{ items: StoredRefundInvoice[]; total: number }> {
  const filter = where(institutionId, query)
  const [totalRow] = await db.select({ total: count() }).from(refundInvoices).where(filter)
  const items = await db
    .select(COLUMNS)
    .from(refundInvoices)
    .innerJoin(studentWithdrawals, WITHDRAWAL_JOIN)
    .leftJoin(records, STUDENT_JOIN)
    .where(filter)
    .orderBy(desc(refundInvoices.createdAt), desc(refundInvoices.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: items.map(stored), total: totalRow?.total ?? 0 }
}

export async function insertRefundInvoice(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    withdrawalId: string
    kind: RefundDocumentKind
    originalInvoice: {
      number: string
      date: string
      type: OriginalInvoiceType
      totalCents: number
      vatRateBasisPoints: number
    }
    amountCents: number
    netCents: number
    vatCents: number
    note: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(refundInvoices).values({
    institutionId,
    id: input.id,
    withdrawalId: input.withdrawalId,
    kind: input.kind,
    status: 'draft',
    originalInvoiceNumber: input.originalInvoice.number,
    originalInvoiceDate: input.originalInvoice.date,
    originalInvoiceType: input.originalInvoice.type,
    originalTotalCents: input.originalInvoice.totalCents,
    vatRateBasisPoints: input.originalInvoice.vatRateBasisPoints,
    amountCents: input.amountCents,
    netCents: input.netCents,
    vatCents: input.vatCents,
    note: input.note,
    createdByUserId: input.createdByUserId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Durum geçişi: beklenen sürüm ve durumda bir satır güncellenir; tutmazsa `false` (409). */
export async function updateRefundInvoice(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    fromStatus: RefundDocumentStatus
    changes: Partial<
      Pick<
        typeof refundInvoices.$inferInsert,
        | 'status'
        | 'readyAt'
        | 'readyByUserId'
        | 'completedDate'
        | 'completedAt'
        | 'completedByUserId'
        | 'documentNumber'
        | 'discardReason'
        | 'discardedByUserId'
        | 'archivedAt'
      >
    >
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(refundInvoices)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        active(institutionId),
        eq(refundInvoices.id, input.id),
        eq(refundInvoices.version, input.expectedVersion),
        eq(refundInvoices.status, input.fromStatus),
      ),
    )
    .returning({ id: refundInvoices.id })
  return rows.length === 1
}

/** İade faturası numarası kurumda başka bir belgede kayıtlı mı (`refund_invoices_document_number_key`). */
export async function refundInvoiceNumberTaken(
  db: Database,
  institutionId: string,
  documentNumber: string,
  exceptId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: refundInvoices.id })
    .from(refundInvoices)
    .where(
      and(
        eq(refundInvoices.institutionId, institutionId),
        eq(refundInvoices.documentNumber, documentNumber),
        ne(refundInvoices.id, exceptId),
      ),
    )
    .limit(1)
  return row !== undefined
}
