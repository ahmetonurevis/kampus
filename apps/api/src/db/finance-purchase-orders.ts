import { randomUUID } from 'node:crypto'

import { and, asc, count, desc, eq, inArray, isNull, max, ne, or, sql, type SQL } from 'drizzle-orm'

import type { PurchaseOrderStatus } from '@kampus/school-core/lib/finance-purchase-orders.ts'
import type { QuotePrice, VatRate } from '@kampus/school-core/lib/finance-purchase-quotes.ts'
import type { PurchaseUnit } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import type { SupplierType } from '@kampus/school-core/lib/finance-suppliers.ts'

import type { Database } from './client.ts'
import {
  purchaseOrderItems,
  purchaseOrders,
  purchaseQuoteItems,
  purchaseQuotes,
} from './schema/finance-purchase-orders.ts'
import { purchaseRequests } from './schema/finance-purchase-requests.ts'
import { suppliers } from './schema/finance-suppliers.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Satın alma teklifi ve siparişi deposu (DOM-FIN-072, DOM-FIN-073; ON-224, ON-225). Kurum
 * kapsamlıdır: ilk parametre `institutionId`. Kural core `lib/finance-purchase-quotes.ts` ve
 * `lib/finance-purchase-orders.ts`'tedir; tutar ve KDV saklanmaz, core kalemlerden hesaplar.
 */

const at = (value: Date | null) => (value === null ? null : value.toISOString())

// --- Teklif --------------------------------------------------------------------------------------

export interface StoredQuote {
  id: string
  requestId: string
  supplierId: string
  supplierName: string
  supplierActive: boolean
  deliveryDays: number
  validUntil: string
  note: string | null
  createdByUserId: string
  selectedAt: string | null
  selectedByUserId: string | null
  selectionReason: string | null
  createdAt: string
  version: number
  prices: QuotePrice[]
}

const activeQuote = (institutionId: string) =>
  and(eq(purchaseQuotes.institutionId, institutionId), isNull(purchaseQuotes.archivedAt))

/** Talebin silinmemiş teklifleri ve fiyatları: giriş sırası, aynı anda girilende tedarikçi adı. */
export async function loadQuotes(
  db: Database,
  institutionId: string,
  requestId: string,
): Promise<StoredQuote[]> {
  const rows = await db
    .select({
      id: purchaseQuotes.id,
      requestId: purchaseQuotes.requestId,
      supplierId: purchaseQuotes.supplierId,
      supplierName: suppliers.name,
      supplierActive: suppliers.isActive,
      deliveryDays: purchaseQuotes.deliveryDays,
      validUntil: purchaseQuotes.validUntil,
      note: purchaseQuotes.note,
      createdByUserId: purchaseQuotes.createdByUserId,
      selectedAt: purchaseQuotes.selectedAt,
      selectedByUserId: purchaseQuotes.selectedByUserId,
      selectionReason: purchaseQuotes.selectionReason,
      createdAt: purchaseQuotes.createdAt,
      version: purchaseQuotes.version,
    })
    .from(purchaseQuotes)
    .innerJoin(
      suppliers,
      and(
        eq(suppliers.institutionId, purchaseQuotes.institutionId),
        eq(suppliers.id, purchaseQuotes.supplierId),
      ),
    )
    .where(and(activeQuote(institutionId), eq(purchaseQuotes.requestId, requestId)))
    .orderBy(asc(purchaseQuotes.createdAt), asc(suppliers.name), asc(purchaseQuotes.id))
  if (rows.length === 0) return []
  const prices = await db
    .select({
      quoteId: purchaseQuoteItems.quoteId,
      requestItemId: purchaseQuoteItems.requestItemId,
      unitPriceCents: purchaseQuoteItems.unitPriceCents,
      vatRate: purchaseQuoteItems.vatRate,
    })
    .from(purchaseQuoteItems)
    .where(
      and(
        eq(purchaseQuoteItems.institutionId, institutionId),
        inArray(
          purchaseQuoteItems.quoteId,
          rows.map((row) => row.id),
        ),
        isNull(purchaseQuoteItems.archivedAt),
      ),
    )
    .orderBy(asc(purchaseQuoteItems.position))
  const byQuote = new Map<string, QuotePrice[]>()
  for (const { quoteId, ...price } of prices) {
    const list = byQuote.get(quoteId) ?? []
    list.push(price)
    byQuote.set(quoteId, list)
  }
  return rows.map((row) => ({
    ...row,
    selectedAt: at(row.selectedAt),
    createdAt: row.createdAt.toISOString(),
    prices: byQuote.get(row.id) ?? [],
  }))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Teklifin talebi; teklif yoksa, silinmişse ya da kimlik bozuksa `null`. */
export async function findQuoteRequestId(
  db: Database,
  institutionId: string,
  quoteId: string,
): Promise<string | null> {
  if (!UUID.test(quoteId)) return null
  const [row] = await db
    .select({ requestId: purchaseQuotes.requestId })
    .from(purchaseQuotes)
    .where(and(activeQuote(institutionId), eq(purchaseQuotes.id, quoteId)))
    .limit(1)
  return row?.requestId ?? null
}

export interface QuoteWrite {
  deliveryDays: number
  validUntil: string
  note: string | null
}

export async function insertQuote(
  tx: Database,
  institutionId: string,
  input: QuoteWrite & {
    id: string
    requestId: string
    supplierId: string
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(purchaseQuotes)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Teklifin etkin fiyatlarını arşivler (düzeltme ve silme). */
export async function archiveQuoteItems(
  tx: Database,
  institutionId: string,
  quoteId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(purchaseQuoteItems)
    .set({ archivedAt: now, updatedAt: now, version: sql`${purchaseQuoteItems.version} + 1` })
    .where(
      and(
        eq(purchaseQuoteItems.institutionId, institutionId),
        eq(purchaseQuoteItems.quoteId, quoteId),
        isNull(purchaseQuoteItems.archivedAt),
      ),
    )
}

/** Fiyatları yazar; varsa önceki etkin fiyatları arşivler (teklif düzeltmesi). */
export async function replaceQuoteItems(
  tx: Database,
  institutionId: string,
  quoteId: string,
  prices: readonly QuotePrice[],
  now: Date,
): Promise<void> {
  await archiveQuoteItems(tx, institutionId, quoteId, now)
  await tx.insert(purchaseQuoteItems).values(
    prices.map((price, position) => ({
      ...price,
      institutionId,
      id: randomUUID(),
      quoteId,
      position,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

export type QuoteUpdate = Partial<QuoteWrite> & {
  selectedAt?: Date | null
  selectedByUserId?: string | null
  selectionReason?: string | null
  archivedAt?: Date
}

/** Sürüm tutmazsa `false` (409). */
export async function updateQuote(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; changes: QuoteUpdate; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(purchaseQuotes)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        activeQuote(institutionId),
        eq(purchaseQuotes.id, input.id),
        eq(purchaseQuotes.version, input.expectedVersion),
      ),
    )
    .returning({ id: purchaseQuotes.id })
  return rows.length === 1
}

/** Talepteki seçimi düşürür (başka teklif seçilirken); kurum kilidi altında çağrılır. */
export async function clearQuoteSelection(
  tx: Database,
  institutionId: string,
  requestId: string,
  now: Date,
): Promise<string[]> {
  const rows = await tx
    .update(purchaseQuotes)
    .set({
      selectedAt: null,
      selectedByUserId: null,
      selectionReason: null,
      updatedAt: now,
      version: sql`${purchaseQuotes.version} + 1`,
    })
    .where(
      and(
        activeQuote(institutionId),
        eq(purchaseQuotes.requestId, requestId),
        sql`${purchaseQuotes.selectedAt} is not null`,
      ),
    )
    .returning({ id: purchaseQuotes.id })
  return rows.map((row) => row.id)
}

// --- Sipariş -------------------------------------------------------------------------------------

export interface StoredOrderItem {
  id: string
  requestItemId: string
  position: number
  name: string
  quantity: number
  unit: PurchaseUnit
  unitPriceCents: number
  vatRate: VatRate
  /** Talep kaleminden kopyalanan stok kartı bağı (ON-339); yoksa `null`. */
  stockItemId: string | null
}

export interface StoredOrder {
  id: string
  number: string
  status: PurchaseOrderStatus
  requestId: string
  requestSequence: number
  quoteId: string
  supplierId: string
  supplierName: string
  supplierType: SupplierType
  supplierTaxNumber: string
  supplierTaxOffice: string
  deliveryDays: number
  note: string | null
  createdByUserId: string
  sentAt: string | null
  sentByUserId: string | null
  cancelledAt: string | null
  cancelledByUserId: string | null
  cancelReason: string | null
  createdAt: string
  version: number
}

const ORDER_COLUMNS = {
  id: purchaseOrders.id,
  number: purchaseOrders.number,
  status: purchaseOrders.status,
  requestId: purchaseOrders.requestId,
  requestSequence: purchaseRequests.sequence,
  quoteId: purchaseOrders.quoteId,
  supplierId: purchaseOrders.supplierId,
  supplierName: purchaseOrders.supplierName,
  supplierType: purchaseOrders.supplierType,
  supplierTaxNumber: purchaseOrders.supplierTaxNumber,
  supplierTaxOffice: purchaseOrders.supplierTaxOffice,
  deliveryDays: purchaseOrders.deliveryDays,
  note: purchaseOrders.note,
  createdByUserId: purchaseOrders.createdByUserId,
  sentAt: purchaseOrders.sentAt,
  sentByUserId: purchaseOrders.sentByUserId,
  cancelledAt: purchaseOrders.cancelledAt,
  cancelledByUserId: purchaseOrders.cancelledByUserId,
  cancelReason: purchaseOrders.cancelReason,
  createdAt: purchaseOrders.createdAt,
  version: purchaseOrders.version,
}

type OrderRow = Omit<StoredOrder, 'sentAt' | 'cancelledAt' | 'createdAt'> & {
  sentAt: Date | null
  cancelledAt: Date | null
  createdAt: Date
}

const toOrder = (row: OrderRow): StoredOrder => ({
  ...row,
  sentAt: at(row.sentAt),
  cancelledAt: at(row.cancelledAt),
  createdAt: row.createdAt.toISOString(),
})

const activeOrder = (institutionId: string) =>
  and(eq(purchaseOrders.institutionId, institutionId), isNull(purchaseOrders.archivedAt))

const orderSelect = (db: Database) =>
  db
    .select(ORDER_COLUMNS)
    .from(purchaseOrders)
    .innerJoin(
      purchaseRequests,
      and(
        eq(purchaseRequests.institutionId, purchaseOrders.institutionId),
        eq(purchaseRequests.id, purchaseOrders.requestId),
      ),
    )

export async function findPurchaseOrder(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredOrder | null> {
  const [row] = await orderSelect(db)
    .where(and(activeOrder(institutionId), eq(purchaseOrders.id, id)))
    .limit(1)
  return row === undefined ? null : toOrder(row)
}

/** Talebin siparişleri (iptal edilenler dahil), yeni açılan önce. */
export async function loadRequestOrders(
  db: Database,
  institutionId: string,
  requestId: string,
): Promise<{ id: string; number: string; status: PurchaseOrderStatus }[]> {
  return db
    .select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(and(activeOrder(institutionId), eq(purchaseOrders.requestId, requestId)))
    .orderBy(desc(purchaseOrders.numberYear), desc(purchaseOrders.numberSequence))
}

/** Talepte iptal edilmemiş sipariş var mı (K-140). */
export async function hasActiveRequestOrder(
  db: Database,
  institutionId: string,
  requestId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        activeOrder(institutionId),
        eq(purchaseOrders.requestId, requestId),
        ne(purchaseOrders.status, 'cancelled'),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Siparişlerin kalemleri, sırayla; liste sayfası için toplu okuma. */
export async function loadOrderItems(
  db: Database,
  institutionId: string,
  orderIds: readonly string[],
): Promise<Map<string, StoredOrderItem[]>> {
  if (orderIds.length === 0) return new Map()
  const rows = await db
    .select({
      orderId: purchaseOrderItems.orderId,
      id: purchaseOrderItems.id,
      requestItemId: purchaseOrderItems.requestItemId,
      position: purchaseOrderItems.position,
      name: purchaseOrderItems.name,
      quantity: purchaseOrderItems.quantity,
      unit: purchaseOrderItems.unit,
      unitPriceCents: purchaseOrderItems.unitPriceCents,
      vatRate: purchaseOrderItems.vatRate,
      stockItemId: purchaseOrderItems.stockItemId,
    })
    .from(purchaseOrderItems)
    .where(
      and(
        eq(purchaseOrderItems.institutionId, institutionId),
        inArray(purchaseOrderItems.orderId, [...new Set(orderIds)]),
        isNull(purchaseOrderItems.archivedAt),
      ),
    )
    .orderBy(asc(purchaseOrderItems.position))
  const byOrder = new Map<string, StoredOrderItem[]>()
  for (const { orderId, ...item } of rows) {
    const list = byOrder.get(orderId) ?? []
    list.push(item)
    byOrder.set(orderId, list)
  }
  return byOrder
}

export interface PurchaseOrderQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: PurchaseOrderStatus | undefined
  supplierId?: string | undefined
  requestId?: string | undefined
}

/** `SA-2026-0012`, `2026-12` ya da `12` numara parçasına çevrilir; değilse `null`. */
function numberOf(search: string): { year: number | null; sequence: number } | null {
  const match = /^(?:sa-?)?(?:(\d{4})-)?0*(\d{1,9})$/i.exec(search.trim())
  if (match?.[2] === undefined) return null
  return { year: match[1] === undefined ? null : Number(match[1]), sequence: Number(match[2]) }
}

/** Siparişler, yeni açılan önce. `q` numarada ya da tedarikçi adında arar. */
export async function listPurchaseOrders(
  db: Database,
  institutionId: string,
  query: PurchaseOrderQuery,
): Promise<{ items: StoredOrder[]; total: number }> {
  const filters: SQL[] = []
  if (query.q !== undefined) {
    const matches: SQL[] = [
      sql`strpos(${foldSql(purchaseOrders.supplierName)}, ${foldSearch(query.q)}) > 0`,
    ]
    const number = numberOf(query.q)
    if (number !== null) {
      const sequence = eq(purchaseOrders.numberSequence, number.sequence)
      const byNumber =
        number.year === null ? sequence : and(sequence, eq(purchaseOrders.numberYear, number.year))
      if (byNumber) matches.push(byNumber)
    }
    const combined = or(...matches)
    if (combined) filters.push(combined)
  }
  if (query.status !== undefined) filters.push(eq(purchaseOrders.status, query.status))
  if (query.supplierId !== undefined) filters.push(eq(purchaseOrders.supplierId, query.supplierId))
  if (query.requestId !== undefined) filters.push(eq(purchaseOrders.requestId, query.requestId))
  const where = and(activeOrder(institutionId), ...filters)
  const [totalRow] = await db.select({ total: count() }).from(purchaseOrders).where(where)
  const rows = await orderSelect(db)
    .where(where)
    .orderBy(desc(purchaseOrders.numberYear), desc(purchaseOrders.numberSequence))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toOrder), total: totalRow?.total ?? 0 }
}

/** Kurumun yıl içindeki sıradaki sipariş numarası; kurum kilidi altında çağrılır (K-139). */
export async function nextPurchaseOrderSequence(
  tx: Database,
  institutionId: string,
  year: number,
): Promise<number> {
  const [row] = await tx
    .select({ last: max(purchaseOrders.numberSequence) })
    .from(purchaseOrders)
    .where(
      and(eq(purchaseOrders.institutionId, institutionId), eq(purchaseOrders.numberYear, year)),
    )
  return (row?.last ?? 0) + 1
}

export async function insertPurchaseOrder(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    number: string
    numberYear: number
    numberSequence: number
    requestId: string
    quoteId: string
    supplierId: string
    supplierName: string
    supplierType: SupplierType
    supplierTaxNumber: string
    supplierTaxOffice: string
    deliveryDays: number
    note: string | null
    createdByUserId: string
    items: readonly Omit<StoredOrderItem, 'id' | 'position'>[]
    now: Date
  },
): Promise<void> {
  const { now, items, ...fields } = input
  await tx
    .insert(purchaseOrders)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
  await tx.insert(purchaseOrderItems).values(
    items.map((item, position) => ({
      ...item,
      institutionId,
      id: randomUUID(),
      orderId: input.id,
      position,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

export type PurchaseOrderUpdate = {
  status: PurchaseOrderStatus
  sentAt?: Date
  sentByUserId?: string
  cancelledAt?: Date
  cancelledByUserId?: string
  cancelReason?: string
}

/** Sürüm tutmazsa `false` (409). */
export async function updatePurchaseOrder(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; changes: PurchaseOrderUpdate; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(purchaseOrders)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        activeOrder(institutionId),
        eq(purchaseOrders.id, input.id),
        eq(purchaseOrders.version, input.expectedVersion),
      ),
    )
    .returning({ id: purchaseOrders.id })
  return rows.length === 1
}
