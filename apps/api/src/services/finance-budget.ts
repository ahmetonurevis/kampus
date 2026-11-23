import { randomUUID } from 'node:crypto'

import { defaultAcademicYearDates } from '@kampus/school-core/lib/academic-years.ts'
import {
  budgetPeriodSchema,
  periodMonths,
  planBudgetItem,
  planBudgetItemUpdate,
  planBudgetLine,
  planBudgetLineUpdate,
  planBudgetPeriod,
  planBudgetPeriodClose,
  planBudgetPeriodOpen,
  planBudgetPeriodUpdate,
  assertPeriodWritable,
  type BudgetItemKind,
  type BudgetPeriodDates,
  type BudgetPeriodStatus,
} from '@kampus/school-core/lib/finance-budget.ts'
import {
  costCenterPath,
  costCenterSchema,
  planCostCenter,
  planCostCenterUpdate,
  updateCostCenterSchema,
  type CostCenterContext,
  type CostCenterType,
} from '@kampus/school-core/lib/finance-cost-centers.ts'

import type { Database } from '../db/client.ts'
import {
  budgetTotalsByPeriod,
  findAcademicYearDates,
  findBudgetLine,
  hasDistributedLines,
  insertBudgetItem,
  insertBudgetLine,
  insertBudgetPeriod,
  insertCostCenter,
  isBudgetItemUsed,
  isBudgetLineTaken,
  listBudgetLines,
  loadBudgetItems,
  loadBudgetPeriods,
  loadCostCenters,
  loadCourseNames,
  updateBudgetItem,
  updateBudgetLine,
  updateBudgetPeriod,
  updateCostCenter,
  type BudgetLineQuery,
  type StoredBudgetItem,
  type StoredBudgetPeriod,
  type StoredCostCenter,
} from '../db/finance-budget.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { foldSearch } from '../db/text-search.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { getInstitutionModules } from './modules.ts'
import { auditWork } from './task-work.ts'

/**
 * Maliyet merkezi, bütçe kalemi, bütçe dönemi ve bütçe satırı (DOM-FIN-062; ON-241, ON-242).
 * Kural core `lib/finance-cost-centers.ts` ve `lib/finance-budget.ts`'tedir; servis kurum kilidi
 * altında kurumun bütün merkez, kalem ve dönemlerini yükler, core'a karar verdirir ve aynı
 * transaction'da yazar, denetim kaydı bırakır. Rol ve modül denetimi rotadadır (yalnız yönetici,
 * modül `finance`; K-59, K-60).
 */

const CENTER_ENTITY = 'cost_centers'
const ITEM_ENTITY = 'budget_items'
const PERIOD_ENTITY = 'budget_periods'
const LINE_ENTITY = 'budget_lines'

interface Page {
  page: number
  pageSize: number
}

const pageOf = <T>(items: readonly T[], query: Page) => ({
  items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
  total: items.length,
})

const matches = (search: string | undefined, ...values: string[]) =>
  search === undefined || values.some((value) => foldSearch(value).includes(search))

// --- Maliyet merkezi -----------------------------------------------------------------------------

async function campusNames(db: Database, institutionId: string, ids: readonly string[]) {
  const rows = await loadRecordsByIds(db, institutionId, 'branches', [...new Set(ids)])
  return new Map(
    rows.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : row.id]),
  )
}

/** Merkez yanıtı: hiyerarşi yolu ve bağlı kampüs ya da kur adı (arşivlenmişse `null`). */
async function centerViews(
  db: Database,
  institutionId: string,
  all: readonly StoredCostCenter[],
  selected: readonly StoredCostCenter[],
) {
  const byId = new Map(all.map((center) => [center.id, center]))
  const [campuses, courseNames] = await Promise.all([
    campusNames(
      db,
      institutionId,
      selected.flatMap((center) => (center.campusId === null ? [] : [center.campusId])),
    ),
    loadCourseNames(
      db,
      institutionId,
      selected.flatMap((center) => (center.courseId === null ? [] : [center.courseId])),
    ),
  ])
  return selected.map((center) => ({
    ...center,
    path: costCenterPath(byId, center.id),
    campusName: center.campusId === null ? null : (campuses.get(center.campusId) ?? null),
    courseName: center.courseId === null ? null : (courseNames.get(center.courseId) ?? null),
  }))
}

export interface CostCenterQuery extends Page {
  q?: string | undefined
  type?: CostCenterType | undefined
  status?: 'active' | 'inactive' | undefined
}

/** Merkezler hiyerarşi yoluna göre (üst merkez altındakilerden önce). `q` kod ve adda. */
export async function listCostCentersFor(ctx: ServiceContext, query: CostCenterQuery) {
  const all = await loadCostCenters(ctx.db, ctx.institutionId)
  const byId = new Map(all.map((center) => [center.id, center]))
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filtered = all
    .filter(
      (center) =>
        (query.type === undefined || center.type === query.type) &&
        (query.status === undefined || center.isActive === (query.status === 'active')) &&
        matches(search, center.code, center.name),
    )
    .map((center) => ({ center, path: costCenterPath(byId, center.id) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ center }) => center)
  const { items, total } = pageOf(filtered, query)
  return { items: await centerViews(ctx.db, ctx.institutionId, all, items), total }
}

/** Core bağlamı: kurum türü, bütün merkezler ve yalnız istenen kampüs ve kurun varlığı. */
async function centerContext(
  tx: Database,
  ctx: ServiceContext,
  link: { campusId?: string | null | undefined; courseId?: string | null | undefined },
  centers: readonly StoredCostCenter[],
): Promise<CostCenterContext> {
  const institution = await getInstitutionModules(tx, ctx.institutionId)
  if (institution === null) throw new NotFoundError()
  const campusId = link.campusId ?? null
  const courseId = link.courseId ?? null
  const [campuses, courseNames] = await Promise.all([
    campusId === null ? new Map<string, string>() : campusNames(tx, ctx.institutionId, [campusId]),
    courseId === null
      ? new Map<string, string>()
      : loadCourseNames(tx, ctx.institutionId, [courseId]),
  ])
  return {
    institutionType: institution.type,
    centers,
    campusIds: new Set(campuses.keys()),
    courseIds: new Set(courseNames.keys()),
  }
}

async function centerBody(tx: Database, ctx: ServiceContext, id: string) {
  const all = await loadCostCenters(tx, ctx.institutionId)
  const center = all.find((item) => item.id === id)
  if (center === undefined) throw new NotFoundError()
  const [view] = await centerViews(tx, ctx.institutionId, all, [center])
  return { data: view }
}

/** Yeni maliyet merkezi (DOM-FIN-062, ON-242). 201. */
export function createCostCenterCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: CENTER_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'cost_center.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = costCenterSchema.parse(input)
        const centers = await loadCostCenters(tx, ctx.institutionId)
        const context = await centerContext(tx, ctx, data, centers)
        return { run: () => planCostCenter(input, context) }
      },
      after: async (tx, plan) => {
        await insertCostCenter(tx, ctx.institutionId, { ...plan, id, now: ctx.now })
        await auditWork(tx, ctx, 'cost_center.create', entity, Object.keys(plan))
        body = await centerBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Merkez düzeltmesi ve pasifleştirme; tür değişmez. Sürüm tutmazsa 409. */
export function updateCostCenterCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CENTER_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'cost_center.update',
      collections: [],
      entity,
      load: async (tx) => {
        const changes = updateCostCenterSchema.parse(input)
        const centers = await loadCostCenters(tx, ctx.institutionId)
        const current = centers.find((center) => center.id === id)
        if (current === undefined) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        const context = await centerContext(
          tx,
          ctx,
          {
            campusId: changes.campusId === undefined ? current.campusId : changes.campusId,
            courseId: changes.courseId === undefined ? current.courseId : changes.courseId,
          },
          centers,
        )
        return { run: () => planCostCenterUpdate(current, input, context) }
      },
      after: async (tx, changes) => {
        const saved = await updateCostCenter(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'cost_center.update', entity, Object.keys(changes))
        body = await centerBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Kalem ---------------------------------------------------------------------------------------

export interface BudgetItemQuery extends Page {
  q?: string | undefined
  kind?: BudgetItemKind | undefined
  status?: 'active' | 'inactive' | undefined
}

/** Kalemler koda göre. `q` kod ve adda. */
export async function listBudgetItemsFor(ctx: ServiceContext, query: BudgetItemQuery) {
  const all = await loadBudgetItems(ctx.db, ctx.institutionId)
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  return pageOf(
    all.filter(
      (item) =>
        (query.kind === undefined || item.kind === query.kind) &&
        (query.status === undefined || item.isActive === (query.status === 'active')) &&
        matches(search, item.code, item.name),
    ),
    query,
  )
}

async function itemBody(tx: Database, ctx: ServiceContext, id: string) {
  const item = (await loadBudgetItems(tx, ctx.institutionId)).find((row) => row.id === id)
  if (item === undefined) throw new NotFoundError()
  return { data: item }
}

/** Yeni bütçe kalemi (DOM-FIN-062, ON-241). 201. */
export function createBudgetItemCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ITEM_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'budget_item.create',
      collections: [],
      entity,
      load: async (tx) => {
        const items = await loadBudgetItems(tx, ctx.institutionId)
        return { run: () => planBudgetItem(input, items) }
      },
      after: async (tx, plan) => {
        await insertBudgetItem(tx, ctx.institutionId, { ...plan, id, now: ctx.now })
        await auditWork(tx, ctx, 'budget_item.create', entity, Object.keys(plan))
        body = await itemBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kalem düzeltmesi ve pasifleştirme; kullanılan kalemin türü değişmez. */
export function updateBudgetItemCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ITEM_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'budget_item.update',
      collections: [],
      entity,
      load: async (tx) => {
        const items: StoredBudgetItem[] = await loadBudgetItems(tx, ctx.institutionId)
        const current = items.find((item) => item.id === id)
        if (current === undefined) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        const inUse = await isBudgetItemUsed(tx, ctx.institutionId, id)
        return { run: () => planBudgetItemUpdate(current, input, { items, inUse }) }
      },
      after: async (tx, changes) => {
        const saved = await updateBudgetItem(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'budget_item.update', entity, Object.keys(changes))
        body = await itemBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Dönem ---------------------------------------------------------------------------------------

const EMPTY_TOTALS = { incomeCents: 0, expenseCents: 0, lineCount: 0 }

async function periodViews(
  db: Database,
  institutionId: string,
  periods: readonly StoredBudgetPeriod[],
) {
  const totals = await budgetTotalsByPeriod(
    db,
    institutionId,
    periods.map((period) => period.id),
  )
  return periods.map((period) => {
    const sums = totals.get(period.id) ?? EMPTY_TOTALS
    return {
      ...period,
      ...sums,
      balanceCents: sums.incomeCents - sums.expenseCents,
      months: periodMonths(period),
    }
  })
}

async function periodOf(db: Database, ctx: ServiceContext, id: string) {
  const periods = await loadBudgetPeriods(db, ctx.institutionId)
  const period = periods.find((item) => item.id === id)
  if (period === undefined) throw new NotFoundError()
  return { period, periods }
}

/** Dönemler yeni başlayan önce; toplamlar satırlardan hesaplanır. */
export async function listBudgetPeriodsFor(
  ctx: ServiceContext,
  query: Page & { status?: BudgetPeriodStatus | undefined },
) {
  const all = await loadBudgetPeriods(ctx.db, ctx.institutionId)
  const { items, total } = pageOf(
    all.filter((period) => query.status === undefined || period.status === query.status),
    query,
  )
  return { items: await periodViews(ctx.db, ctx.institutionId, items), total }
}

/** Tek dönemin görünümü; toplamlar ve ay listesiyle. */
async function periodView(db: Database, ctx: ServiceContext, id: string) {
  const { period } = await periodOf(db, ctx, id)
  const [view] = await periodViews(db, ctx.institutionId, [period])
  if (view === undefined) throw new NotFoundError()
  return view
}

export const getBudgetPeriodFor = (ctx: ServiceContext, id: string) => periodView(ctx.db, ctx, id)

const periodBody = async (tx: Database, ctx: ServiceContext, id: string) => ({
  data: await periodView(tx, ctx, id),
})

/** Eğitim yılının günleri: kurumun yıl kaydı, yoksa 1 Eylül – 31 Ağustos (K-63). */
async function yearDatesFor(
  tx: Database,
  ctx: ServiceContext,
  startYear: number | null | undefined,
): Promise<(year: number) => BudgetPeriodDates> {
  const found =
    startYear === null || startYear === undefined
      ? null
      : await findAcademicYearDates(tx, ctx.institutionId, startYear)
  return (year) => (found !== null && year === startYear ? found : defaultAcademicYearDates(year))
}

/** Yeni bütçe dönemi taslak açılır (DOM-FIN-062, ON-241). 201. */
export function createBudgetPeriodCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: PERIOD_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'budget_period.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = budgetPeriodSchema.parse(input)
        const [periods, yearDates] = await Promise.all([
          loadBudgetPeriods(tx, ctx.institutionId),
          yearDatesFor(tx, ctx, data.academicYear),
        ])
        return { run: () => planBudgetPeriod(input, { periods, yearDates }) }
      },
      after: async (tx, plan) => {
        await insertBudgetPeriod(tx, ctx.institutionId, { ...plan, id, now: ctx.now })
        await auditWork(tx, ctx, 'budget_period.create', entity, Object.keys(plan))
        body = await periodBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Ad taslakta ve açıkken, günler yalnız taslakta değişir; kapalı dönem 422. */
export function updateBudgetPeriodCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PERIOD_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'budget_period.update',
      collections: [],
      entity,
      load: async (tx) => {
        const { period, periods } = await periodOf(tx, ctx, id)
        if (period.version !== expectedVersion) throw new ConflictError()
        const raw = (input ?? {}) as { academicYear?: unknown }
        const year = typeof raw.academicYear === 'number' ? raw.academicYear : null
        const [yearDates, distributed] = await Promise.all([
          yearDatesFor(tx, ctx, year),
          hasDistributedLines(tx, ctx.institutionId, id),
        ])
        return {
          run: () =>
            planBudgetPeriodUpdate(period, input, {
              periods,
              yearDates,
              hasDistributedLines: distributed,
            }),
        }
      },
      after: async (tx, changes) => {
        const saved = await updateBudgetPeriod(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'budget_period.update', entity, Object.keys(changes))
        body = await periodBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Taslak dönemi açar (açık dönemler örtüşmez, K-62) ya da açık dönemi kapatır (K-61). */
export function changeBudgetPeriodStatusCommand(
  ctx: ServiceContext,
  id: string,
  target: 'open' | 'closed',
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PERIOD_ENTITY, id }
  const action = target === 'open' ? 'budget_period.open' : 'budget_period.close'
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const { period, periods } = await periodOf(tx, ctx, id)
        if (period.version !== expectedVersion) throw new ConflictError()
        return {
          run: () => {
            if (target === 'open') planBudgetPeriodOpen(period, periods)
            else planBudgetPeriodClose(period)
            return target
          },
        }
      },
      after: async (tx) => {
        const changes =
          target === 'open'
            ? { status: target, openedAt: ctx.now, openedByUserId: ctx.actor.userId }
            : { status: target, closedAt: ctx.now, closedByUserId: ctx.actor.userId }
        const saved = await updateBudgetPeriod(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, action, entity, Object.keys(changes))
        body = await periodBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Satır ---------------------------------------------------------------------------------------

/** Dönemin satırları; olmayan ya da başka kurumun dönemi 404. */
export async function listBudgetLinesFor(
  ctx: ServiceContext,
  periodId: string,
  query: BudgetLineQuery,
) {
  await periodOf(ctx.db, ctx, periodId)
  return listBudgetLines(ctx.db, ctx.institutionId, periodId, query)
}

async function lineBody(tx: Database, ctx: ServiceContext, periodId: string, lineId: string) {
  const line = await findBudgetLine(tx, ctx.institutionId, periodId, lineId)
  if (line === null) throw new NotFoundError()
  return { data: line }
}

/** Planlanan tutar: dönem kapalı değil, merkez ve kalem etkin, aynı üçlü yok. 201. */
export function createBudgetLineCommand(
  ctx: ServiceContext,
  periodId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: LINE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'budget_line.create',
      collections: [],
      entity,
      load: async (tx) => {
        const { period } = await periodOf(tx, ctx, periodId)
        const raw = (input ?? {}) as { costCenterId?: unknown; itemId?: unknown }
        const costCenterId = typeof raw.costCenterId === 'string' ? raw.costCenterId : ''
        const itemId = typeof raw.itemId === 'string' ? raw.itemId : ''
        const [centers, items, duplicate] = await Promise.all([
          loadCostCenters(tx, ctx.institutionId),
          loadBudgetItems(tx, ctx.institutionId),
          isBudgetLineTaken(tx, ctx.institutionId, { periodId, costCenterId, itemId }),
        ])
        const center = centers.find((row) => row.id === costCenterId) ?? null
        const item = items.find((row) => row.id === itemId) ?? null
        return { run: () => planBudgetLine(input, { period, center, item, duplicate }) }
      },
      after: async (tx, plan) => {
        await insertBudgetLine(tx, ctx.institutionId, { ...plan, id, periodId, now: ctx.now })
        await auditWork(tx, ctx, 'budget_line.create', entity, Object.keys(plan))
        body = await lineBody(tx, ctx, periodId, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Tutar ve dağılım düzeltmesi; kapalı dönemde 422, sürüm tutmazsa 409. */
export function updateBudgetLineCommand(
  ctx: ServiceContext,
  periodId: string,
  lineId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: LINE_ENTITY, id: lineId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'budget_line.update',
      collections: [],
      entity,
      load: async (tx) => {
        const { period } = await periodOf(tx, ctx, periodId)
        const line = await findBudgetLine(tx, ctx.institutionId, periodId, lineId)
        if (line === null) throw new NotFoundError()
        if (line.version !== expectedVersion) throw new ConflictError()
        return { run: () => planBudgetLineUpdate(line, input, period) }
      },
      after: async (tx, changes) => {
        const saved = await updateBudgetLine(tx, ctx.institutionId, {
          id: lineId,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'budget_line.update', entity, ['amountCents', 'monthlyCents'])
        body = await lineBody(tx, ctx, periodId, lineId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Satırı kaldırır (arşiv); kapalı dönemde 422. */
export function removeBudgetLineCommand(
  ctx: ServiceContext,
  periodId: string,
  lineId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: LINE_ENTITY, id: lineId }
  return runCommand(
    ctx,
    {
      action: 'budget_line.remove',
      collections: [],
      entity,
      load: async (tx) => {
        const { period } = await periodOf(tx, ctx, periodId)
        const line = await findBudgetLine(tx, ctx.institutionId, periodId, lineId)
        if (line === null) throw new NotFoundError()
        if (line.version !== expectedVersion) throw new ConflictError()
        return { run: () => assertPeriodWritable(period) }
      },
      after: async (tx) => {
        const saved = await updateBudgetLine(tx, ctx.institutionId, {
          id: lineId,
          expectedVersion,
          changes: { archivedAt: ctx.now },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'budget_line.remove', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id: lineId } } }),
    idempotency,
  )
}
