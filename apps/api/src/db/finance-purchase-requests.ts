import { randomUUID } from 'node:crypto'

import { and, asc, count, desc, eq, inArray, isNull, max, or, sql, type SQL } from 'drizzle-orm'

import type {
  PurchaseBudgetFigures,
  PurchaseRequestItem,
  PurchaseRequestStatus,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { budgetItems, budgetLines, budgetPeriods, costCenters } from './schema/finance-budget.ts'
import { purchaseRequestItems, purchaseRequests } from './schema/finance-purchase-requests.ts'
import { suppliers } from './schema/finance-suppliers.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Satın alma talebi deposu (DOM-FIN-071; ON-222). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-purchase-requests.ts`'tedir; depo okur, yazar ve bütçe kalanı için plan ve
 * talep toplamlarını SQL ile toplar. Talep tutarı saklanmaz, kalemlerden hesaplanır.
 */

const at = (value: Date | null) => (value === null ? null : value.toISOString())

const LINE_TOTAL = sql<string>`coalesce(sum(${purchaseRequestItems.quantity}::bigint * ${purchaseRequestItems.estimatedUnitPriceCents}), 0)`

/** Talep başına etkin kalem sayısı ve toplamı. */
const totalsOf = (db: Database, institutionId: string) =>
  db
    .select({
      requestId: purchaseRequestItems.requestId,
      itemCount: count().as('item_count'),
      totalCents: LINE_TOTAL.as('total_cents'),
    })
    .from(purchaseRequestItems)
    .where(
      and(
        eq(purchaseRequestItems.institutionId, institutionId),
        isNull(purchaseRequestItems.archivedAt),
      ),
    )
    .groupBy(purchaseRequestItems.requestId)
    .as('totals')

export interface StoredPurchaseRequest {
  id: string
  sequence: number
  status: PurchaseRequestStatus
  costCenterId: string
  costCenterCode: string
  costCenterName: string
  periodId: string
  periodName: string
  budgetItemId: string
  budgetItemCode: string
  budgetItemName: string
  supplierId: string | null
  supplierName: string | null
  justification: string
  requestedByUserId: string
  submittedAt: string | null
  submittedByUserId: string | null
  decidedAt: string | null
  decidedByUserId: string | null
  decisionNote: string | null
  cancelledAt: string | null
  cancelledByUserId: string | null
  cancelReason: string | null
  itemCount: number
  totalCents: number
  version: number
  createdAt: string
}

function requestQuery(db: Database, institutionId: string) {
  const totals = totalsOf(db, institutionId)
  return {
    totals,
    select: db
      .select({
        id: purchaseRequests.id,
        sequence: purchaseRequests.sequence,
        status: purchaseRequests.status,
        costCenterId: purchaseRequests.costCenterId,
        costCenterCode: costCenters.code,
        costCenterName: costCenters.name,
        periodId: purchaseRequests.periodId,
        periodName: budgetPeriods.name,
        budgetItemId: purchaseRequests.budgetItemId,
        budgetItemCode: budgetItems.code,
        budgetItemName: budgetItems.name,
        supplierId: purchaseRequests.supplierId,
        supplierName: suppliers.name,
        justification: purchaseRequests.justification,
        requestedByUserId: purchaseRequests.requestedByUserId,
        submittedAt: purchaseRequests.submittedAt,
        submittedByUserId: purchaseRequests.submittedByUserId,
        decidedAt: purchaseRequests.decidedAt,
        decidedByUserId: purchaseRequests.decidedByUserId,
        decisionNote: purchaseRequests.decisionNote,
        cancelledAt: purchaseRequests.cancelledAt,
        cancelledByUserId: purchaseRequests.cancelledByUserId,
        cancelReason: purchaseRequests.cancelReason,
        itemCount: totals.itemCount,
        totalCents: totals.totalCents,
        version: purchaseRequests.version,
        createdAt: purchaseRequests.createdAt,
      })
      .from(purchaseRequests)
      .innerJoin(
        costCenters,
        and(
          eq(costCenters.institutionId, purchaseRequests.institutionId),
          eq(costCenters.id, purchaseRequests.costCenterId),
        ),
      )
      .innerJoin(
        budgetPeriods,
        and(
          eq(budgetPeriods.institutionId, purchaseRequests.institutionId),
          eq(budgetPeriods.id, purchaseRequests.periodId),
        ),
      )
      .innerJoin(
        budgetItems,
        and(
          eq(budgetItems.institutionId, purchaseRequests.institutionId),
          eq(budgetItems.id, purchaseRequests.budgetItemId),
        ),
      )
      .leftJoin(
        suppliers,
        and(
          eq(suppliers.institutionId, purchaseRequests.institutionId),
          eq(suppliers.id, purchaseRequests.supplierId),
        ),
      )
      .leftJoin(totals, eq(totals.requestId, purchaseRequests.id)),
  }
}

type RequestRow = Omit<
  StoredPurchaseRequest,
  'submittedAt' | 'decidedAt' | 'cancelledAt' | 'createdAt' | 'itemCount' | 'totalCents'
> & {
  submittedAt: Date | null
  decidedAt: Date | null
  cancelledAt: Date | null
  createdAt: Date
  itemCount: number | null
  totalCents: string | number | null
}

const toRequest = (row: RequestRow): StoredPurchaseRequest => ({
  ...row,
  submittedAt: at(row.submittedAt),
  decidedAt: at(row.decidedAt),
  cancelledAt: at(row.cancelledAt),
  createdAt: row.createdAt.toISOString(),
  itemCount: Number(row.itemCount ?? 0),
  totalCents: Number(row.totalCents ?? 0),
})

const ofInstitution = (institutionId: string) =>
  and(eq(purchaseRequests.institutionId, institutionId), isNull(purchaseRequests.archivedAt))

export async function findPurchaseRequest(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPurchaseRequest | null> {
  const { select } = requestQuery(db, institutionId)
  const [row] = await select
    .where(and(ofInstitution(institutionId), eq(purchaseRequests.id, id)))
    .limit(1)
  return row === undefined ? null : toRequest(row)
}

export interface PurchaseRequestQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: PurchaseRequestStatus | undefined
  costCenterId?: string | undefined
  periodId?: string | undefined
}

/** `ST-0012`, `st12` ya da `12` sıra numarasına çevrilir; değilse `null`. */
function sequenceOf(search: string): number | null {
  const match = /^(?:st-?)?0*(\d{1,9})$/i.exec(search.trim())
  return match?.[1] === undefined ? null : Number(match[1])
}

/** Talepler, yeni açılan önce. `q` numarada, gerekçede ya da merkez adında arar. */
export async function listPurchaseRequests(
  db: Database,
  institutionId: string,
  query: PurchaseRequestQuery,
): Promise<{ items: StoredPurchaseRequest[]; total: number }> {
  const filters: SQL[] = []
  if (query.q !== undefined) {
    const search = foldSearch(query.q)
    const sequence = sequenceOf(query.q)
    const matches: SQL[] = [
      sql`strpos(${foldSql(purchaseRequests.justification)}, ${search}) > 0`,
      sql`strpos(${foldSql(costCenters.name)}, ${search}) > 0`,
    ]
    if (sequence !== null) matches.push(eq(purchaseRequests.sequence, sequence))
    const combined = or(...matches)
    if (combined) filters.push(combined)
  }
  if (query.status !== undefined) filters.push(eq(purchaseRequests.status, query.status))
  if (query.costCenterId !== undefined)
    filters.push(eq(purchaseRequests.costCenterId, query.costCenterId))
  if (query.periodId !== undefined) filters.push(eq(purchaseRequests.periodId, query.periodId))
  const where = and(ofInstitution(institutionId), ...filters)
  const [totalRow] = await db
    .select({ total: count() })
    .from(purchaseRequests)
    .innerJoin(
      costCenters,
      and(
        eq(costCenters.institutionId, purchaseRequests.institutionId),
        eq(costCenters.id, purchaseRequests.costCenterId),
      ),
    )
    .where(where)
  const { select } = requestQuery(db, institutionId)
  const rows = await select
    .where(where)
    .orderBy(desc(purchaseRequests.sequence))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toRequest), total: totalRow?.total ?? 0 }
}

export type StoredPurchaseItem = PurchaseRequestItem & { id: string; position: number }

/** Talebin etkin kalemleri, sırayla. */
export async function loadPurchaseRequestItems(
  db: Database,
  institutionId: string,
  requestId: string,
): Promise<StoredPurchaseItem[]> {
  return db
    .select({
      id: purchaseRequestItems.id,
      position: purchaseRequestItems.position,
      name: purchaseRequestItems.name,
      quantity: purchaseRequestItems.quantity,
      unit: purchaseRequestItems.unit,
      estimatedUnitPriceCents: purchaseRequestItems.estimatedUnitPriceCents,
    })
    .from(purchaseRequestItems)
    .where(
      and(
        eq(purchaseRequestItems.institutionId, institutionId),
        eq(purchaseRequestItems.requestId, requestId),
        isNull(purchaseRequestItems.archivedAt),
      ),
    )
    .orderBy(asc(purchaseRequestItems.position))
}

/** Kurumun sıradaki talep numarası; kurum kilidi altında çağrılır. */
export async function nextPurchaseRequestSequence(
  tx: Database,
  institutionId: string,
): Promise<number> {
  const [row] = await tx
    .select({ last: max(purchaseRequests.sequence) })
    .from(purchaseRequests)
    .where(eq(purchaseRequests.institutionId, institutionId))
  return (row?.last ?? 0) + 1
}

export interface PurchaseRequestWrite {
  costCenterId: string
  periodId: string
  budgetItemId: string
  supplierId: string | null
  justification: string
}

export async function insertPurchaseRequest(
  tx: Database,
  institutionId: string,
  input: PurchaseRequestWrite & {
    id: string
    sequence: number
    requestedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(purchaseRequests)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Kalemleri yazar; varsa önceki etkin kalemleri arşivler (taslak düzeltmesi). */
export async function replacePurchaseRequestItems(
  tx: Database,
  institutionId: string,
  requestId: string,
  items: readonly PurchaseRequestItem[],
  now: Date,
): Promise<void> {
  await tx
    .update(purchaseRequestItems)
    .set({ archivedAt: now, updatedAt: now, version: sql`${purchaseRequestItems.version} + 1` })
    .where(
      and(
        eq(purchaseRequestItems.institutionId, institutionId),
        eq(purchaseRequestItems.requestId, requestId),
        isNull(purchaseRequestItems.archivedAt),
      ),
    )
  await tx.insert(purchaseRequestItems).values(
    items.map((item, position) => ({
      ...item,
      institutionId,
      id: randomUUID(),
      requestId,
      position,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

export type PurchaseRequestUpdate = Partial<PurchaseRequestWrite> & {
  status?: PurchaseRequestStatus
  submittedAt?: Date
  submittedByUserId?: string
  decidedAt?: Date
  decidedByUserId?: string
  decisionNote?: string | null
  cancelledAt?: Date
  cancelledByUserId?: string
  cancelReason?: string
}

/** Sürüm tutmazsa `false` (409). */
export async function updatePurchaseRequest(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; changes: PurchaseRequestUpdate; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(purchaseRequests)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(purchaseRequests.id, input.id),
        eq(purchaseRequests.version, input.expectedVersion),
      ),
    )
    .returning({ id: purchaseRequests.id })
  return rows.length === 1
}

/**
 * Bütçe kalanının girdileri (DOM-FIN-071, ON-245, K-145): dönem × merkez × kalem satırının planı ve
 * aynı üçlüdeki onaylanmış ve kararı bekleyen taleplerin toplamı; hesaplanan talep (`exceptId`)
 * hariç tutulur. Gönderim ve onayda kurum kilidi altında okunur.
 */
export async function loadPurchaseBudgetFigures(
  db: Database,
  institutionId: string,
  key: { periodId: string; costCenterId: string; budgetItemId: string; exceptId: string | null },
): Promise<PurchaseBudgetFigures> {
  const [line] = await db
    .select({ amountCents: budgetLines.amountCents })
    .from(budgetLines)
    .where(
      and(
        eq(budgetLines.institutionId, institutionId),
        eq(budgetLines.periodId, key.periodId),
        eq(budgetLines.costCenterId, key.costCenterId),
        eq(budgetLines.itemId, key.budgetItemId),
        isNull(budgetLines.archivedAt),
      ),
    )
    .limit(1)
  const sums = await db
    .select({ status: purchaseRequests.status, totalCents: LINE_TOTAL })
    .from(purchaseRequests)
    .innerJoin(
      purchaseRequestItems,
      and(
        eq(purchaseRequestItems.institutionId, purchaseRequests.institutionId),
        eq(purchaseRequestItems.requestId, purchaseRequests.id),
        isNull(purchaseRequestItems.archivedAt),
      ),
    )
    .where(
      and(
        ofInstitution(institutionId),
        eq(purchaseRequests.periodId, key.periodId),
        eq(purchaseRequests.costCenterId, key.costCenterId),
        eq(purchaseRequests.budgetItemId, key.budgetItemId),
        inArray(purchaseRequests.status, ['submitted', 'approved']),
        key.exceptId === null ? undefined : sql`${purchaseRequests.id} <> ${key.exceptId}`,
      ),
    )
    .groupBy(purchaseRequests.status)
  const sumOf = (status: PurchaseRequestStatus) =>
    Number(sums.find((row) => row.status === status)?.totalCents ?? 0)
  return {
    plannedCents: line?.amountCents ?? null,
    approvedCents: sumOf('approved'),
    pendingCents: sumOf('submitted'),
  }
}

/** Talepteki kişilerin adı; kurum üyeliği olmayan kimlik görünmez. */
export async function purchaseActorNames(
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
