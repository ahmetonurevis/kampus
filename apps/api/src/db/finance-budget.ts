import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql, sum } from 'drizzle-orm'

import type { FeeItemKind } from '@kampus/school-core/lib/fee-tariffs.ts'
import type {
  BudgetItemKind,
  BudgetItemNode,
  BudgetPeriodNode,
  BudgetPeriodStatus,
} from '@kampus/school-core/lib/finance-budget.ts'
import type { CostCenterNode } from '@kampus/school-core/lib/finance-cost-centers.ts'

import type { Database } from './client.ts'
import { academicYears } from './schema/academic-years.ts'
import { courses } from './schema/courses.ts'
import { budgetItems, budgetLines, budgetPeriods, costCenters } from './schema/finance-budget.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Bütçe ve maliyet merkezi deposu (DOM-FIN-062; ON-241, ON-242). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Merkez, kalem ve dönem sayısı kurumda küçüktür (yüzlerle sınırlı); bu yüzden
 * tamamı yüklenir, core hiyerarşi ve tekillik kararını bütün liste üzerinden verir. Satırlar
 * büyüyebilir; sorgu ve toplam SQL'dedir.
 */

const at = (value: Date | null) => (value === null ? null : value.toISOString())

// --- Maliyet merkezi -----------------------------------------------------------------------------

export type StoredCostCenter = CostCenterNode & { version: number; createdAt: string }

const CENTER_COLUMNS = {
  id: costCenters.id,
  code: costCenters.code,
  name: costCenters.name,
  type: costCenters.type,
  parentId: costCenters.parentId,
  campusId: costCenters.campusId,
  gradeLevel: costCenters.gradeLevel,
  courseId: costCenters.courseId,
  isActive: costCenters.isActive,
  version: costCenters.version,
  createdAt: costCenters.createdAt,
}

/** Kurumun bütün merkezleri (pasifler dahil), koda göre. */
export async function loadCostCenters(
  db: Database,
  institutionId: string,
): Promise<StoredCostCenter[]> {
  const rows = await db
    .select(CENTER_COLUMNS)
    .from(costCenters)
    .where(and(eq(costCenters.institutionId, institutionId), isNull(costCenters.archivedAt)))
    .orderBy(asc(costCenters.code))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export async function insertCostCenter(
  tx: Database,
  institutionId: string,
  input: Omit<CostCenterNode, 'isActive'> & { now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(costCenters)
    .values({ ...fields, institutionId, isActive: true, createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateCostCenter(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<Omit<CostCenterNode, 'id' | 'type'>>
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(costCenters)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(costCenters.institutionId, institutionId),
        eq(costCenters.id, input.id),
        isNull(costCenters.archivedAt),
        eq(costCenters.version, input.expectedVersion),
      ),
    )
    .returning({ id: costCenters.id })
  return rows.length === 1
}

/** Arşivlenmemiş kurlar (yalnız verilen kimlikler); bağ denetimi ve ad gösterimi için. */
export async function loadCourseNames(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: courses.id, name: courses.name })
    .from(courses)
    .where(
      and(
        eq(courses.institutionId, institutionId),
        inArray(courses.id, [...ids]),
        isNull(courses.archivedAt),
      ),
    )
  return new Map(rows.map((row) => [row.id, row.name]))
}

// --- Kalem ---------------------------------------------------------------------------------------

export type StoredBudgetItem = BudgetItemNode & {
  name: string
  version: number
  createdAt: string
}

const ITEM_COLUMNS = {
  id: budgetItems.id,
  code: budgetItems.code,
  name: budgetItems.name,
  kind: budgetItems.kind,
  feeKind: budgetItems.feeKind,
  isActive: budgetItems.isActive,
  version: budgetItems.version,
  createdAt: budgetItems.createdAt,
}

export async function loadBudgetItems(
  db: Database,
  institutionId: string,
): Promise<StoredBudgetItem[]> {
  const rows = await db
    .select(ITEM_COLUMNS)
    .from(budgetItems)
    .where(and(eq(budgetItems.institutionId, institutionId), isNull(budgetItems.archivedAt)))
    .orderBy(asc(budgetItems.code))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export async function insertBudgetItem(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    code: string
    name: string
    kind: BudgetItemKind
    feeKind: FeeItemKind | null
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(budgetItems)
    .values({ ...fields, institutionId, isActive: true, createdAt: now, updatedAt: now })
}

export async function updateBudgetItem(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<Omit<StoredBudgetItem, 'id' | 'version' | 'createdAt'>>
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(budgetItems)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(budgetItems.institutionId, institutionId),
        eq(budgetItems.id, input.id),
        isNull(budgetItems.archivedAt),
        eq(budgetItems.version, input.expectedVersion),
      ),
    )
    .returning({ id: budgetItems.id })
  return rows.length === 1
}

/** Kalem etkin bir bütçe satırında kullanılıyor mu (tür değişmez). */
export async function isBudgetItemUsed(
  db: Database,
  institutionId: string,
  itemId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: budgetLines.id })
    .from(budgetLines)
    .where(
      and(
        eq(budgetLines.institutionId, institutionId),
        eq(budgetLines.itemId, itemId),
        isNull(budgetLines.archivedAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

// --- Dönem ---------------------------------------------------------------------------------------

export type StoredBudgetPeriod = BudgetPeriodNode & {
  openedAt: string | null
  closedAt: string | null
  version: number
  createdAt: string
}

const PERIOD_COLUMNS = {
  id: budgetPeriods.id,
  name: budgetPeriods.name,
  academicYear: budgetPeriods.academicYear,
  startDate: budgetPeriods.startDate,
  endDate: budgetPeriods.endDate,
  status: budgetPeriods.status,
  openedAt: budgetPeriods.openedAt,
  closedAt: budgetPeriods.closedAt,
  version: budgetPeriods.version,
  createdAt: budgetPeriods.createdAt,
}

/** Kurumun bütün dönemleri, yeni başlayan önce. */
export async function loadBudgetPeriods(
  db: Database,
  institutionId: string,
): Promise<StoredBudgetPeriod[]> {
  const rows = await db
    .select(PERIOD_COLUMNS)
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.institutionId, institutionId), isNull(budgetPeriods.archivedAt)))
    .orderBy(sql`${budgetPeriods.startDate} desc`, asc(budgetPeriods.name))
  return rows.map((row) => ({
    ...row,
    openedAt: at(row.openedAt),
    closedAt: at(row.closedAt),
    createdAt: row.createdAt.toISOString(),
  }))
}

/** Eğitim yılı kaydının günleri; kayıt yoksa `null` (servis varsayılan aralığı kullanır). */
export async function findAcademicYearDates(
  db: Database,
  institutionId: string,
  startYear: number,
): Promise<{ startDate: string; endDate: string } | null> {
  const [row] = await db
    .select({ startDate: academicYears.startDate, endDate: academicYears.endDate })
    .from(academicYears)
    .where(
      and(
        eq(academicYears.institutionId, institutionId),
        eq(academicYears.startYear, startYear),
        isNull(academicYears.archivedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function insertBudgetPeriod(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    name: string
    academicYear: number | null
    startDate: string
    endDate: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(budgetPeriods)
    .values({ ...fields, institutionId, status: 'draft', createdAt: now, updatedAt: now })
}

export async function updateBudgetPeriod(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<{
      name: string
      academicYear: number | null
      startDate: string
      endDate: string
      status: BudgetPeriodStatus
      openedAt: Date
      openedByUserId: string
      closedAt: Date
      closedByUserId: string
    }>
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(budgetPeriods)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(budgetPeriods.institutionId, institutionId),
        eq(budgetPeriods.id, input.id),
        isNull(budgetPeriods.archivedAt),
        eq(budgetPeriods.version, input.expectedVersion),
      ),
    )
    .returning({ id: budgetPeriods.id })
  return rows.length === 1
}

export interface BudgetTotals {
  incomeCents: number
  expenseCents: number
  lineCount: number
}

/** Dönem başına gelir ve gider toplamı ve satır sayısı; hesaplanır, saklanmaz. */
export async function budgetTotalsByPeriod(
  db: Database,
  institutionId: string,
  periodIds: readonly string[],
): Promise<Map<string, BudgetTotals>> {
  const totals = new Map<string, BudgetTotals>()
  if (periodIds.length === 0) return totals
  const rows = await db
    .select({
      periodId: budgetLines.periodId,
      kind: budgetItems.kind,
      amount: sum(budgetLines.amountCents),
      lines: count(),
    })
    .from(budgetLines)
    .innerJoin(
      budgetItems,
      and(
        eq(budgetItems.institutionId, budgetLines.institutionId),
        eq(budgetItems.id, budgetLines.itemId),
      ),
    )
    .where(
      and(
        eq(budgetLines.institutionId, institutionId),
        inArray(budgetLines.periodId, [...periodIds]),
        isNull(budgetLines.archivedAt),
      ),
    )
    .groupBy(budgetLines.periodId, budgetItems.kind)
  for (const row of rows) {
    const entry = totals.get(row.periodId) ?? { incomeCents: 0, expenseCents: 0, lineCount: 0 }
    const amount = Number(row.amount ?? 0)
    if (row.kind === 'income') entry.incomeCents += amount
    else entry.expenseCents += amount
    entry.lineCount += row.lines
    totals.set(row.periodId, entry)
  }
  return totals
}

/** Dönemde aylık dağılımlı etkin satır var mı (günler değişemez). */
export async function hasDistributedLines(
  db: Database,
  institutionId: string,
  periodId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: budgetLines.id })
    .from(budgetLines)
    .where(
      and(
        eq(budgetLines.institutionId, institutionId),
        eq(budgetLines.periodId, periodId),
        isNull(budgetLines.archivedAt),
        isNotNull(budgetLines.monthlyCents),
      ),
    )
    .limit(1)
  return row !== undefined
}

// --- Satır ---------------------------------------------------------------------------------------

export interface StoredBudgetLine {
  id: string
  periodId: string
  costCenterId: string
  costCenterCode: string
  costCenterName: string
  itemId: string
  itemCode: string
  itemName: string
  itemKind: BudgetItemKind
  amountCents: number
  monthlyCents: number[] | null
  version: number
}

const LINE_COLUMNS = {
  id: budgetLines.id,
  periodId: budgetLines.periodId,
  costCenterId: budgetLines.costCenterId,
  costCenterCode: costCenters.code,
  costCenterName: costCenters.name,
  itemId: budgetLines.itemId,
  itemCode: budgetItems.code,
  itemName: budgetItems.name,
  itemKind: budgetItems.kind,
  amountCents: budgetLines.amountCents,
  monthlyCents: budgetLines.monthlyCents,
  version: budgetLines.version,
}

function lineQuery(db: Database) {
  return db
    .select(LINE_COLUMNS)
    .from(budgetLines)
    .innerJoin(
      costCenters,
      and(
        eq(costCenters.institutionId, budgetLines.institutionId),
        eq(costCenters.id, budgetLines.costCenterId),
      ),
    )
    .innerJoin(
      budgetItems,
      and(
        eq(budgetItems.institutionId, budgetLines.institutionId),
        eq(budgetItems.id, budgetLines.itemId),
      ),
    )
}

const toLine = (row: StoredBudgetLine): StoredBudgetLine => ({
  ...row,
  amountCents: Number(row.amountCents),
  monthlyCents: row.monthlyCents === null ? null : row.monthlyCents.map(Number),
})

export interface BudgetLineQuery {
  page: number
  pageSize: number
  costCenterId?: string | undefined
  kind?: BudgetItemKind | undefined
  q?: string | undefined
}

/** Dönemin etkin satırları, merkez ve kalem koduna göre. `q` merkez ya da kalem kodu ve adında. */
export async function listBudgetLines(
  db: Database,
  institutionId: string,
  periodId: string,
  query: BudgetLineQuery,
): Promise<{ items: StoredBudgetLine[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    eq(budgetLines.institutionId, institutionId),
    eq(budgetLines.periodId, periodId),
    isNull(budgetLines.archivedAt),
    query.costCenterId === undefined ? undefined : eq(budgetLines.costCenterId, query.costCenterId),
    query.kind === undefined ? undefined : eq(budgetItems.kind, query.kind),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(costCenters.name)}, ${search}) > 0`,
          sql`strpos(${foldSql(costCenters.code)}, ${search}) > 0`,
          sql`strpos(${foldSql(budgetItems.name)}, ${search}) > 0`,
          sql`strpos(${foldSql(budgetItems.code)}, ${search}) > 0`,
        ),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(budgetLines)
    .innerJoin(
      costCenters,
      and(
        eq(costCenters.institutionId, budgetLines.institutionId),
        eq(costCenters.id, budgetLines.costCenterId),
      ),
    )
    .innerJoin(
      budgetItems,
      and(
        eq(budgetItems.institutionId, budgetLines.institutionId),
        eq(budgetItems.id, budgetLines.itemId),
      ),
    )
    .where(where)
  const rows = await lineQuery(db)
    .where(where)
    .orderBy(asc(costCenters.code), asc(budgetItems.code), asc(budgetLines.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toLine), total: totalRow?.total ?? 0 }
}

export async function findBudgetLine(
  db: Database,
  institutionId: string,
  periodId: string,
  lineId: string,
): Promise<StoredBudgetLine | null> {
  const [row] = await lineQuery(db)
    .where(
      and(
        eq(budgetLines.institutionId, institutionId),
        eq(budgetLines.periodId, periodId),
        eq(budgetLines.id, lineId),
        isNull(budgetLines.archivedAt),
      ),
    )
    .limit(1)
  return row === undefined ? null : toLine(row)
}

/** Dönemde aynı merkez ve kalem için etkin satır var mı. */
export async function isBudgetLineTaken(
  db: Database,
  institutionId: string,
  key: { periodId: string; costCenterId: string; itemId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: budgetLines.id })
    .from(budgetLines)
    .where(
      and(
        eq(budgetLines.institutionId, institutionId),
        eq(budgetLines.periodId, key.periodId),
        eq(budgetLines.costCenterId, key.costCenterId),
        eq(budgetLines.itemId, key.itemId),
        isNull(budgetLines.archivedAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function insertBudgetLine(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    periodId: string
    costCenterId: string
    itemId: string
    amountCents: number
    monthlyCents: number[] | null
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(budgetLines).values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

export async function updateBudgetLine(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: { amountCents: number; monthlyCents: number[] | null } | { archivedAt: Date }
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(budgetLines)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(budgetLines.institutionId, institutionId),
        eq(budgetLines.id, input.id),
        isNull(budgetLines.archivedAt),
        eq(budgetLines.version, input.expectedVersion),
      ),
    )
    .returning({ id: budgetLines.id })
  return rows.length === 1
}
