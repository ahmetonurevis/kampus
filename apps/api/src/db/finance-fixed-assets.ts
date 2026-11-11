import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  min,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'

import type { DepreciationReportAsset } from '@kampus/school-core/lib/finance-fixed-asset-depreciation.ts'
import type {
  FixedAssetCategory,
  FixedAssetDraft,
  FixedAssetReceiptRef,
  FixedAssetStatus,
} from '@kampus/school-core/lib/finance-fixed-assets.ts'

import type { Database } from './client.ts'
import { fixedAssets } from './schema/finance-fixed-assets.ts'
import { purchaseOrderItems, purchaseOrders } from './schema/finance-purchase-orders.ts'
import { purchaseReceiptItems, purchaseReceipts } from './schema/finance-purchase-receipts.ts'
import { suppliers } from './schema/finance-suppliers.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Demirbaş deposu (DOM-FIN-085; ON-235). Kurum kapsamlıdır: ilk parametre `institutionId`. Kural
 * core `lib/finance-fixed-assets.ts`'tedir; depo yalnız okur ve yazar.
 */

export type StoredFixedAsset = FixedAssetDraft & {
  id: string
  supplierName: string | null
  scrappedAt: string | null
  scrapDate: string | null
  scrapReason: string | null
  createdAt: string
  version: number
}

const COLUMNS = {
  id: fixedAssets.id,
  tagNumber: fixedAssets.tagNumber,
  name: fixedAssets.name,
  category: fixedAssets.category,
  campusId: fixedAssets.campusId,
  location: fixedAssets.location,
  acquisitionValueCents: fixedAssets.acquisitionValueCents,
  acquisitionDate: fixedAssets.acquisitionDate,
  supplierId: fixedAssets.supplierId,
  supplierName: suppliers.name,
  receiptItemId: fixedAssets.receiptItemId,
  status: fixedAssets.status,
  usefulLifeYears: fixedAssets.usefulLifeYears,
  depreciationMethod: fixedAssets.depreciationMethod,
  scrappedAt: fixedAssets.scrappedAt,
  scrapDate: fixedAssets.scrapDate,
  scrapReason: fixedAssets.scrapReason,
  createdAt: fixedAssets.createdAt,
  version: fixedAssets.version,
}

type Row = Omit<StoredFixedAsset, 'createdAt' | 'scrappedAt'> & {
  createdAt: Date
  scrappedAt: Date | null
}
const toAsset = (row: Row): StoredFixedAsset => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  scrappedAt: row.scrappedAt === null ? null : row.scrappedAt.toISOString(),
})

const ofInstitution = (institutionId: string) =>
  and(eq(fixedAssets.institutionId, institutionId), isNull(fixedAssets.archivedAt))

const withSupplier = (db: Database) =>
  db
    .select(COLUMNS)
    .from(fixedAssets)
    .leftJoin(
      suppliers,
      and(
        eq(suppliers.institutionId, fixedAssets.institutionId),
        eq(suppliers.id, fixedAssets.supplierId),
      ),
    )

export async function findFixedAsset(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredFixedAsset | null> {
  const [row] = await withSupplier(db)
    .where(and(ofInstitution(institutionId), eq(fixedAssets.id, id)))
    .limit(1)
  return row === undefined ? null : toAsset(row)
}

export interface FixedAssetQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: FixedAssetStatus | undefined
  category?: FixedAssetCategory | undefined
  campusId?: string | undefined
  supplierId?: string | undefined
}

/** Demirbaşlar: hurdaya ayrılmamışlar önce, etiket numarasına göre. `q` etiket, ad ve konumda. */
export async function listFixedAssets(
  db: Database,
  institutionId: string,
  query: FixedAssetQuery,
): Promise<{ items: StoredFixedAsset[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const searchBy: SQL | undefined =
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(fixedAssets.tagNumber)}, ${search}) > 0`,
          sql`strpos(${foldSql(fixedAssets.name)}, ${search}) > 0`,
          sql`strpos(${foldSql(fixedAssets.location)}, ${search}) > 0`,
        )
  const where = and(
    ofInstitution(institutionId),
    searchBy,
    query.status === undefined ? undefined : eq(fixedAssets.status, query.status),
    query.category === undefined ? undefined : eq(fixedAssets.category, query.category),
    query.campusId === undefined ? undefined : eq(fixedAssets.campusId, query.campusId),
    query.supplierId === undefined ? undefined : eq(fixedAssets.supplierId, query.supplierId),
  )
  const [totalRow] = await db.select({ total: count() }).from(fixedAssets).where(where)
  const rows = await withSupplier(db)
    .where(where)
    .orderBy(
      sql`${fixedAssets.status} = 'scrapped'`,
      asc(fixedAssets.tagNumber),
      asc(fixedAssets.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toAsset), total: totalRow?.total ?? 0 }
}

/** Yılın `DB-<yıl>-…` biçimli etiketleri (sıradaki öneri core'da hesaplanır; kurum kilidi altında). */
export async function loadYearTags(
  tx: Database,
  institutionId: string,
  year: number,
): Promise<string[]> {
  const rows = await tx
    .select({ tagNumber: fixedAssets.tagNumber })
    .from(fixedAssets)
    .where(and(ofInstitution(institutionId), like(fixedAssets.tagNumber, `DB-${String(year)}-%`)))
  return rows.map((row) => row.tagNumber)
}

/** Etiket başka bir demirbaşta (hurdaya ayrılanlar dahil) kullanılıyor mu; düzeltmede kendisi hariç. */
export async function isFixedAssetTagTaken(
  db: Database,
  institutionId: string,
  tagNumber: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: fixedAssets.id })
    .from(fixedAssets)
    .where(
      and(
        ofInstitution(institutionId),
        eq(fixedAssets.tagNumber, tagNumber),
        exceptId === undefined ? undefined : ne(fixedAssets.id, exceptId),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Kalemdeki bağlı demirbaş sayısı (hurdaya ayrılanlar dahil); `exceptId` sayılmaz. */
const linkedCount = (institutionId: string, exceptId?: string) =>
  sql<number>`(select count(*)::int from ${fixedAssets}
    where ${fixedAssets.institutionId} = ${institutionId}
      and ${fixedAssets.receiptItemId} = ${purchaseReceiptItems.id}
      and ${fixedAssets.archivedAt} is null
      ${exceptId === undefined ? sql`` : sql`and ${fixedAssets.id} <> ${exceptId}`})`

// Kabul kalemi → kabul → sipariş kalemi → sipariş birleşimi; her sorguda aynı koşullar.
const RECEIPT_ON = and(
  eq(purchaseReceipts.institutionId, purchaseReceiptItems.institutionId),
  eq(purchaseReceipts.id, purchaseReceiptItems.receiptId),
)
const ORDER_ITEM_ON = and(
  eq(purchaseOrderItems.institutionId, purchaseReceiptItems.institutionId),
  eq(purchaseOrderItems.id, purchaseReceiptItems.orderItemId),
)
const ORDER_ON = and(
  eq(purchaseOrders.institutionId, purchaseOrderItems.institutionId),
  eq(purchaseOrders.id, purchaseOrderItems.orderId),
)

/** Bağlanacak kabul kaleminin denetim girdisi (core `FixedAssetReceiptRef`); yoksa `null`. */
export async function loadReceiptRef(
  tx: Database,
  institutionId: string,
  receiptItemId: string,
  exceptAssetId?: string,
): Promise<FixedAssetReceiptRef | null> {
  const [row] = await tx
    .select({
      receiptItemId: purchaseReceiptItems.id,
      receiptDate: purchaseReceipts.receiptDate,
      cancelledAt: purchaseReceipts.cancelledAt,
      acceptedQuantity: purchaseReceiptItems.acceptedQuantity,
      linkedAssetCount: linkedCount(institutionId, exceptAssetId),
      supplierId: purchaseOrders.supplierId,
    })
    .from(purchaseReceiptItems)
    .innerJoin(purchaseReceipts, RECEIPT_ON)
    .innerJoin(purchaseOrderItems, ORDER_ITEM_ON)
    .innerJoin(purchaseOrders, ORDER_ON)
    .where(
      and(
        eq(purchaseReceiptItems.institutionId, institutionId),
        eq(purchaseReceiptItems.id, receiptItemId),
        isNull(purchaseReceiptItems.archivedAt),
      ),
    )
    .limit(1)
  if (row === undefined) return null
  const { cancelledAt, ...ref } = row
  return { ...ref, cancelled: cancelledAt !== null }
}

export interface ReceiptItemView {
  receiptItemId: string
  receiptId: string
  receiptDate: string
  receiptCancelled: boolean
  orderId: string
  orderNumber: string
  supplierId: string
  supplierName: string
  itemName: string
  unitPriceCents: number
  acceptedQuantity: number
  linkedAssetCount: number
}

const RECEIPT_VIEW = (institutionId: string) => ({
  receiptItemId: purchaseReceiptItems.id,
  receiptId: purchaseReceipts.id,
  receiptDate: purchaseReceipts.receiptDate,
  cancelledAt: purchaseReceipts.cancelledAt,
  orderId: purchaseOrders.id,
  orderNumber: purchaseOrders.number,
  supplierId: purchaseOrders.supplierId,
  supplierName: purchaseOrders.supplierName,
  itemName: purchaseOrderItems.name,
  unitPriceCents: purchaseOrderItems.unitPriceCents,
  acceptedQuantity: purchaseReceiptItems.acceptedQuantity,
  linkedAssetCount: linkedCount(institutionId),
})
type ReceiptViewRow = Omit<ReceiptItemView, 'receiptCancelled'> & { cancelledAt: Date | null }
const toReceiptView = ({ cancelledAt, ...row }: ReceiptViewRow): ReceiptItemView => ({
  ...row,
  receiptCancelled: cancelledAt !== null,
})

/** Demirbaşın bağlı olduğu kabul kalemleri (ayrıntı ve listede gösterim). */
export async function loadReceiptItemViews(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<Map<string, ReceiptItemView>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select(RECEIPT_VIEW(institutionId))
    .from(purchaseReceiptItems)
    .innerJoin(purchaseReceipts, RECEIPT_ON)
    .innerJoin(purchaseOrderItems, ORDER_ITEM_ON)
    .innerJoin(purchaseOrders, ORDER_ON)
    .where(
      and(
        eq(purchaseReceiptItems.institutionId, institutionId),
        inArray(purchaseReceiptItems.id, [...new Set(ids)]),
      ),
    )
  return new Map(rows.map((row) => [row.receiptItemId, toReceiptView(row)]))
}

/**
 * Demirbaş bağlanabilecek kabul kalemleri: iptal edilmemiş kabulde kabul edilen miktarı olan ve
 * bağlı demirbaş sayısı bu miktarın altında kalan kalemler, yeni kabul önce. `q` kalem adı, sipariş
 * numarası ve tedarikçi unvanında.
 */
export async function listLinkableReceiptItems(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; q?: string | undefined },
): Promise<{ items: ReceiptItemView[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    eq(purchaseReceiptItems.institutionId, institutionId),
    isNull(purchaseReceiptItems.archivedAt),
    isNull(purchaseReceipts.archivedAt),
    isNull(purchaseReceipts.cancelledAt),
    sql`${purchaseReceiptItems.acceptedQuantity} > ${linkedCount(institutionId)}`,
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(purchaseOrderItems.name)}, ${search}) > 0`,
          sql`strpos(${foldSql(purchaseOrders.number)}, ${search}) > 0`,
          sql`strpos(${foldSql(purchaseOrders.supplierName)}, ${search}) > 0`,
        ),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(purchaseReceiptItems)
    .innerJoin(purchaseReceipts, RECEIPT_ON)
    .innerJoin(purchaseOrderItems, ORDER_ITEM_ON)
    .innerJoin(purchaseOrders, ORDER_ON)
    .where(where)
  const rows = await db
    .select(RECEIPT_VIEW(institutionId))
    .from(purchaseReceiptItems)
    .innerJoin(purchaseReceipts, RECEIPT_ON)
    .innerJoin(purchaseOrderItems, ORDER_ITEM_ON)
    .innerJoin(purchaseOrders, ORDER_ON)
    .where(where)
    .orderBy(
      desc(purchaseReceipts.receiptDate),
      desc(purchaseReceipts.createdAt),
      asc(purchaseOrderItems.position),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toReceiptView), total: totalRow?.total ?? 0 }
}

export async function insertFixedAsset(
  tx: Database,
  institutionId: string,
  input: FixedAssetDraft & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(fixedAssets).values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateFixedAsset(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<FixedAssetDraft> & {
      scrappedAt?: Date
      scrapDate?: string
      scrappedByUserId?: string
      scrapReason?: string
    }
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(fixedAssets)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(fixedAssets.id, input.id),
        eq(fixedAssets.version, input.expectedVersion),
      ),
    )
    .returning({ id: fixedAssets.id })
  return rows.length === 1
}

/**
 * Amortisman raporunun demirbaşları (DOM-FIN-088): yıl sonuna kadar alınmış, yıl başından önce
 * hurdaya ayrılmamış kayıtlar. Hesap core'dadır (`depreciationReport`).
 */
export async function loadDepreciationAssets(
  db: Database,
  institutionId: string,
  year: number,
): Promise<DepreciationReportAsset[]> {
  return db
    .select({
      id: fixedAssets.id,
      tagNumber: fixedAssets.tagNumber,
      name: fixedAssets.name,
      category: fixedAssets.category,
      status: fixedAssets.status,
      acquisitionValueCents: fixedAssets.acquisitionValueCents,
      acquisitionDate: fixedAssets.acquisitionDate,
      usefulLifeYears: fixedAssets.usefulLifeYears,
      depreciationMethod: fixedAssets.depreciationMethod,
      scrapDate: fixedAssets.scrapDate,
    })
    .from(fixedAssets)
    .where(
      and(
        ofInstitution(institutionId),
        lte(fixedAssets.acquisitionDate, `${String(year)}-12-31`),
        or(isNull(fixedAssets.scrapDate), gte(fixedAssets.scrapDate, `${String(year)}-01-01`)),
      ),
    )
    .orderBy(asc(fixedAssets.tagNumber), asc(fixedAssets.id))
}

/** Kurumdaki en eski alım yılı (rapor yıl seçimi); demirbaş yoksa `null`. */
export async function loadFirstAcquisitionYear(
  db: Database,
  institutionId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ first: min(fixedAssets.acquisitionDate) })
    .from(fixedAssets)
    .where(ofInstitution(institutionId))
  return row?.first == null ? null : Number(row.first.slice(0, 4))
}
