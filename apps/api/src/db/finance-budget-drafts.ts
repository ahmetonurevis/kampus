import { and, asc, count, desc, eq, inArray, isNull, ne, sql, sum } from 'drizzle-orm'

import type { BudgetItemKind, BudgetPeriodStatus } from '@kampus/school-core/lib/finance-budget.ts'
import type {
  BudgetDraftChange,
  BudgetDraftEvent,
  BudgetDraftLineValue,
  BudgetDraftStatus,
} from '@kampus/school-core/lib/finance-budget-drafts.ts'

import type { Database } from './client.ts'
import { budgetItems, budgetLines, budgetPeriods, costCenters } from './schema/finance-budget.ts'
import {
  budgetCenterOwners,
  budgetDraftEvents,
  budgetDraftLines,
  budgetDrafts,
} from './schema/finance-budget-drafts.ts'

/**
 * Bütçe taslağı deposu (DOM-FIN-093; ON-243). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-budget-drafts.ts`'tedir; depo yalnız okur ve yazar. `costCenterIds`
 * verilirse okuma bu merkezlerle daraltılır (bütçe sorumlusu, K-257). Geçmiş satırı yalnız eklenir.
 */

const at = (value: Date | null) => (value === null ? null : value.toISOString())

// --- Bütçe sorumlusu -----------------------------------------------------------------------------

/** Merkez → sorumlu üyelik; sorumlusu olmayan merkez haritada yoktur. */
export async function loadBudgetOwners(
  db: Database,
  institutionId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      costCenterId: budgetCenterOwners.costCenterId,
      membershipId: budgetCenterOwners.membershipId,
    })
    .from(budgetCenterOwners)
    .where(eq(budgetCenterOwners.institutionId, institutionId))
  return new Map(
    rows.flatMap((row) =>
      row.membershipId === null ? [] : [[row.costCenterId, row.membershipId] as const],
    ),
  )
}

/** Merkezin sorumlusunu yazar ya da kaldırır (`null`); merkez başına tek satır. */
export async function setBudgetOwner(
  tx: Database,
  institutionId: string,
  input: { costCenterId: string; membershipId: string | null; userId: string; now: Date },
): Promise<void> {
  await tx
    .insert(budgetCenterOwners)
    .values({
      institutionId,
      costCenterId: input.costCenterId,
      membershipId: input.membershipId,
      assignedByUserId: input.userId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [budgetCenterOwners.institutionId, budgetCenterOwners.costCenterId],
      set: {
        membershipId: input.membershipId,
        assignedByUserId: input.userId,
        updatedAt: input.now,
        version: sql`${budgetCenterOwners.version} + 1`,
      },
    })
}

// --- Taslak --------------------------------------------------------------------------------------

export interface StoredBudgetDraft {
  id: string
  periodId: string
  periodName: string
  periodStatus: BudgetPeriodStatus
  periodStartDate: string
  periodEndDate: string
  costCenterId: string
  costCenterCode: string
  costCenterName: string
  costCenterActive: boolean
  status: BudgetDraftStatus
  revision: number
  createdByUserId: string
  submittedAt: string | null
  submittedByUserId: string | null
  approvedRevision: number | null
  approvedAt: string | null
  approvedByUserId: string | null
  decisionNote: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const DRAFT_COLUMNS = {
  id: budgetDrafts.id,
  periodId: budgetDrafts.periodId,
  periodName: budgetPeriods.name,
  periodStatus: budgetPeriods.status,
  periodStartDate: budgetPeriods.startDate,
  periodEndDate: budgetPeriods.endDate,
  costCenterId: budgetDrafts.costCenterId,
  costCenterCode: costCenters.code,
  costCenterName: costCenters.name,
  costCenterActive: costCenters.isActive,
  status: budgetDrafts.status,
  revision: budgetDrafts.revision,
  createdByUserId: budgetDrafts.createdByUserId,
  submittedAt: budgetDrafts.submittedAt,
  submittedByUserId: budgetDrafts.submittedByUserId,
  approvedRevision: budgetDrafts.approvedRevision,
  approvedAt: budgetDrafts.approvedAt,
  approvedByUserId: budgetDrafts.approvedByUserId,
  decisionNote: budgetDrafts.decisionNote,
  createdAt: budgetDrafts.createdAt,
  updatedAt: budgetDrafts.updatedAt,
  version: budgetDrafts.version,
}

function draftQuery(db: Database) {
  return db
    .select(DRAFT_COLUMNS)
    .from(budgetDrafts)
    .innerJoin(
      budgetPeriods,
      and(
        eq(budgetPeriods.institutionId, budgetDrafts.institutionId),
        eq(budgetPeriods.id, budgetDrafts.periodId),
      ),
    )
    .innerJoin(
      costCenters,
      and(
        eq(costCenters.institutionId, budgetDrafts.institutionId),
        eq(costCenters.id, budgetDrafts.costCenterId),
      ),
    )
}

type DraftRow = Awaited<ReturnType<ReturnType<typeof draftQuery>['limit']>>[number]

const toDraft = (row: DraftRow): StoredBudgetDraft => ({
  ...row,
  submittedAt: at(row.submittedAt),
  approvedAt: at(row.approvedAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

export interface BudgetDraftScope {
  /** Verilirse yalnız bu merkezlerin taslakları (bütçe sorumlusu). */
  costCenterIds?: readonly string[] | undefined
}

export interface BudgetDraftQuery extends BudgetDraftScope {
  page: number
  pageSize: number
  periodId?: string | undefined
  costCenterId?: string | undefined
  status?: BudgetDraftStatus | undefined
}

function scopeWhere(institutionId: string, scope: BudgetDraftScope) {
  return and(
    eq(budgetDrafts.institutionId, institutionId),
    isNull(budgetDrafts.archivedAt),
    scope.costCenterIds === undefined
      ? undefined
      : scope.costCenterIds.length === 0
        ? sql`false`
        : inArray(budgetDrafts.costCenterId, [...scope.costCenterIds]),
  )
}

/** Taslaklar: yeni başlayan dönem önce, dönem içinde merkez koduna göre. */
export async function listBudgetDrafts(
  db: Database,
  institutionId: string,
  query: BudgetDraftQuery,
): Promise<{ items: StoredBudgetDraft[]; total: number }> {
  const where = and(
    scopeWhere(institutionId, query),
    query.periodId === undefined ? undefined : eq(budgetDrafts.periodId, query.periodId),
    query.costCenterId === undefined
      ? undefined
      : eq(budgetDrafts.costCenterId, query.costCenterId),
    query.status === undefined ? undefined : eq(budgetDrafts.status, query.status),
  )
  const [totalRow] = await db.select({ total: count() }).from(budgetDrafts).where(where)
  const rows = await draftQuery(db)
    .where(where)
    .orderBy(
      desc(budgetPeriods.startDate),
      asc(costCenters.code),
      desc(budgetDrafts.createdAt),
      asc(budgetDrafts.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toDraft), total: totalRow?.total ?? 0 }
}

export async function findBudgetDraft(
  db: Database,
  institutionId: string,
  id: string,
  scope: BudgetDraftScope = {},
): Promise<StoredBudgetDraft | null> {
  const [row] = await draftQuery(db)
    .where(and(scopeWhere(institutionId, scope), eq(budgetDrafts.id, id)))
    .limit(1)
  return row === undefined ? null : toDraft(row)
}

/** Dönem × merkez için reddedilmemiş taslak var mı. */
export async function hasActiveBudgetDraft(
  db: Database,
  institutionId: string,
  key: { periodId: string; costCenterId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: budgetDrafts.id })
    .from(budgetDrafts)
    .where(
      and(
        eq(budgetDrafts.institutionId, institutionId),
        eq(budgetDrafts.periodId, key.periodId),
        eq(budgetDrafts.costCenterId, key.costCenterId),
        ne(budgetDrafts.status, 'rejected'),
        isNull(budgetDrafts.archivedAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function insertBudgetDraft(
  tx: Database,
  institutionId: string,
  input: { id: string; periodId: string; costCenterId: string; userId: string; now: Date },
): Promise<void> {
  await tx.insert(budgetDrafts).values({
    institutionId,
    id: input.id,
    periodId: input.periodId,
    costCenterId: input.costCenterId,
    status: 'draft',
    revision: 0,
    createdByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export type BudgetDraftChanges = Partial<{
  status: BudgetDraftStatus
  revision: number
  submittedAt: Date
  submittedByUserId: string
  approvedRevision: number
  approvedAt: Date
  approvedByUserId: string
  decisionNote: string | null
}>

/** Sürüm tutmazsa `false` (409). Değişiklik yoksa yalnız sürüm artar (satır düzeltmesi). */
export async function updateBudgetDraft(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; changes: BudgetDraftChanges; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(budgetDrafts)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(budgetDrafts.institutionId, institutionId),
        eq(budgetDrafts.id, input.id),
        isNull(budgetDrafts.archivedAt),
        eq(budgetDrafts.version, input.expectedVersion),
      ),
    )
    .returning({ id: budgetDrafts.id })
  return rows.length === 1
}

// --- Satırlar ------------------------------------------------------------------------------------

export interface StoredBudgetDraftLine extends BudgetDraftLineValue {
  id: string
  draftId: string
  itemCode: string
  itemName: string
  itemKind: BudgetItemKind
  itemActive: boolean
  position: number
}

/** Taslakların etkin satırları, form sırasıyla. */
export async function loadBudgetDraftLines(
  db: Database,
  institutionId: string,
  draftIds: readonly string[],
): Promise<StoredBudgetDraftLine[]> {
  if (draftIds.length === 0) return []
  const rows = await db
    .select({
      id: budgetDraftLines.id,
      draftId: budgetDraftLines.draftId,
      itemId: budgetDraftLines.itemId,
      itemCode: budgetItems.code,
      itemName: budgetItems.name,
      itemKind: budgetItems.kind,
      itemActive: budgetItems.isActive,
      position: budgetDraftLines.position,
      amountCents: budgetDraftLines.amountCents,
      justification: budgetDraftLines.justification,
    })
    .from(budgetDraftLines)
    .innerJoin(
      budgetItems,
      and(
        eq(budgetItems.institutionId, budgetDraftLines.institutionId),
        eq(budgetItems.id, budgetDraftLines.itemId),
      ),
    )
    .where(
      and(
        eq(budgetDraftLines.institutionId, institutionId),
        inArray(budgetDraftLines.draftId, [...draftIds]),
        isNull(budgetDraftLines.archivedAt),
      ),
    )
    .orderBy(asc(budgetDraftLines.draftId), asc(budgetDraftLines.position))
  return rows.map((row) => ({ ...row, amountCents: Number(row.amountCents) }))
}

/** Taslakların gelir ve gider toplamı; hesaplanır, saklanmaz. */
export async function budgetDraftTotalsByDraft(
  db: Database,
  institutionId: string,
  draftIds: readonly string[],
): Promise<Map<string, { incomeCents: number; expenseCents: number; lineCount: number }>> {
  const totals = new Map<string, { incomeCents: number; expenseCents: number; lineCount: number }>()
  if (draftIds.length === 0) return totals
  const rows = await db
    .select({
      draftId: budgetDraftLines.draftId,
      kind: budgetItems.kind,
      amount: sum(budgetDraftLines.amountCents),
      lines: count(),
    })
    .from(budgetDraftLines)
    .innerJoin(
      budgetItems,
      and(
        eq(budgetItems.institutionId, budgetDraftLines.institutionId),
        eq(budgetItems.id, budgetDraftLines.itemId),
      ),
    )
    .where(
      and(
        eq(budgetDraftLines.institutionId, institutionId),
        inArray(budgetDraftLines.draftId, [...draftIds]),
        isNull(budgetDraftLines.archivedAt),
      ),
    )
    .groupBy(budgetDraftLines.draftId, budgetItems.kind)
  for (const row of rows) {
    const entry = totals.get(row.draftId) ?? { incomeCents: 0, expenseCents: 0, lineCount: 0 }
    const amount = Number(row.amount ?? 0)
    if (row.kind === 'income') entry.incomeCents += amount
    else entry.expenseCents += amount
    entry.lineCount += row.lines
    totals.set(row.draftId, entry)
  }
  return totals
}

/**
 * Satırları yerine yazar: aynı kalemin satırı güncellenir, yeni kalem eklenir, taslaktan çıkan
 * kalemin satırı arşivlenir. Önce arşiv: çıkan kalem aynı istekte yeniden eklenmez (tekil kalem).
 */
export async function replaceBudgetDraftLines(
  tx: Database,
  institutionId: string,
  input: {
    draftId: string
    current: readonly StoredBudgetDraftLine[]
    lines: readonly BudgetDraftLineValue[]
    newId: () => string
    now: Date
  },
): Promise<void> {
  const wanted = new Set(input.lines.map((line) => line.itemId))
  const removed = input.current.filter((line) => !wanted.has(line.itemId))
  if (removed.length > 0)
    await tx
      .update(budgetDraftLines)
      .set({ archivedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(budgetDraftLines.institutionId, institutionId),
          inArray(
            budgetDraftLines.id,
            removed.map((line) => line.id),
          ),
        ),
      )
  const byItem = new Map(input.current.map((line) => [line.itemId, line]))
  for (const [position, line] of input.lines.entries()) {
    const existing = byItem.get(line.itemId)
    if (existing === undefined) {
      await tx.insert(budgetDraftLines).values({
        institutionId,
        id: input.newId(),
        draftId: input.draftId,
        itemId: line.itemId,
        position,
        amountCents: line.amountCents,
        justification: line.justification,
        createdAt: input.now,
        updatedAt: input.now,
      })
      continue
    }
    if (
      existing.position === position &&
      existing.amountCents === line.amountCents &&
      existing.justification === line.justification
    )
      continue
    await tx
      .update(budgetDraftLines)
      .set({
        position,
        amountCents: line.amountCents,
        justification: line.justification,
        updatedAt: input.now,
        version: sql`${budgetDraftLines.version} + 1`,
      })
      .where(
        and(
          eq(budgetDraftLines.institutionId, institutionId),
          eq(budgetDraftLines.id, existing.id),
        ),
      )
  }
}

// --- Onaylı bütçe satırları ----------------------------------------------------------------------

/** Merkezin dönemdeki etkin bütçe satırları (onayda eşitlenir, karşılaştırmada "onaylı"). */
export async function loadCenterBudgetLines(
  db: Database,
  institutionId: string,
  key: { periodId: string; costCenterId: string },
): Promise<
  {
    id: string
    itemId: string
    amountCents: number
    monthlyCents: number[] | null
    version: number
  }[]
> {
  const rows = await db
    .select({
      id: budgetLines.id,
      itemId: budgetLines.itemId,
      amountCents: budgetLines.amountCents,
      monthlyCents: budgetLines.monthlyCents,
      version: budgetLines.version,
    })
    .from(budgetLines)
    .where(
      and(
        eq(budgetLines.institutionId, institutionId),
        eq(budgetLines.periodId, key.periodId),
        eq(budgetLines.costCenterId, key.costCenterId),
        isNull(budgetLines.archivedAt),
      ),
    )
  return rows.map((row) => ({
    ...row,
    amountCents: Number(row.amountCents),
    monthlyCents: row.monthlyCents === null ? null : row.monthlyCents.map(Number),
  }))
}

// --- Geçmiş --------------------------------------------------------------------------------------

export interface StoredBudgetDraftEvent {
  id: string
  event: BudgetDraftEvent
  fromStatus: BudgetDraftStatus | null
  toStatus: BudgetDraftStatus
  revision: number
  note: string | null
  lines: BudgetDraftLineValue[] | null
  changes: BudgetDraftChange[] | null
  actorUserId: string
  occurredAt: string
}

export async function insertBudgetDraftEvent(
  tx: Database,
  institutionId: string,
  input: Omit<StoredBudgetDraftEvent, 'occurredAt'> & { draftId: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(budgetDraftEvents)
    .values({ ...fields, institutionId, occurredAt: now, createdAt: now, updatedAt: now })
}

/** Bir sürüm içindeki adım sırası: açılış, gönderim, karar, yeni revizyon. */
const EVENT_RANK = {
  created: 0,
  submitted: 1,
  approved: 2,
  revision_requested: 2,
  rejected: 2,
  reopened: 3,
} as const satisfies Record<BudgetDraftEvent, number>

/** Taslağın geçmişi, eskiden yeniye. */
export async function listBudgetDraftEvents(
  db: Database,
  institutionId: string,
  draftId: string,
): Promise<StoredBudgetDraftEvent[]> {
  const rows = await db
    .select({
      id: budgetDraftEvents.id,
      event: budgetDraftEvents.event,
      fromStatus: budgetDraftEvents.fromStatus,
      toStatus: budgetDraftEvents.toStatus,
      revision: budgetDraftEvents.revision,
      note: budgetDraftEvents.note,
      lines: budgetDraftEvents.lines,
      changes: budgetDraftEvents.changes,
      actorUserId: budgetDraftEvents.actorUserId,
      occurredAt: budgetDraftEvents.occurredAt,
    })
    .from(budgetDraftEvents)
    .where(
      and(
        eq(budgetDraftEvents.institutionId, institutionId),
        eq(budgetDraftEvents.draftId, draftId),
      ),
    )
    .orderBy(asc(budgetDraftEvents.occurredAt))
  // Aynı anda yazılan adımlar (aynı istekte değil, aynı saniyede) sürüm ve adım sırasıyla dizilir.
  return rows
    .map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() }))
    .sort(
      (a, b) =>
        a.revision - b.revision ||
        EVENT_RANK[a.event] - EVENT_RANK[b.event] ||
        (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0),
    )
}

/** Son gönderimin satırları (sonraki sürümün değişen kalemleri buna göre); yoksa `null`. */
export async function lastSubmittedLines(
  db: Database,
  institutionId: string,
  draftId: string,
): Promise<BudgetDraftLineValue[] | null> {
  const [row] = await db
    .select({ lines: budgetDraftEvents.lines })
    .from(budgetDraftEvents)
    .where(
      and(
        eq(budgetDraftEvents.institutionId, institutionId),
        eq(budgetDraftEvents.draftId, draftId),
        eq(budgetDraftEvents.event, 'submitted'),
      ),
    )
    .orderBy(desc(budgetDraftEvents.revision))
    .limit(1)
  return row?.lines ?? null
}
