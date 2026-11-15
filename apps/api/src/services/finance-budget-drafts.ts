import { randomUUID } from 'node:crypto'

import {
  budgetDraftActions,
  budgetDraftChanges,
  budgetDraftComparison,
  budgetDraftLinesSchema,
  budgetDraftNoteSchema,
  budgetDraftReasonSchema,
  budgetDraftSchema,
  budgetDraftTransition,
  canDecideBudgetDraft,
  planBudgetDraftApproval,
  planBudgetDraftCreate,
  planBudgetDraftLines,
  planBudgetDraftReopen,
  planBudgetDraftSubmit,
  planBudgetOwner,
  previousBudgetPeriod,
  type BudgetDraftActor,
  type BudgetDraftChange,
  type BudgetDraftEvent,
  type BudgetDraftLineValue,
  type BudgetDraftStatus,
} from '@kampus/school-core/lib/finance-budget-drafts.ts'
import { costCenterPath } from '@kampus/school-core/lib/finance-cost-centers.ts'

import type { Database } from '../db/client.ts'
import {
  insertBudgetLine,
  loadBudgetItems,
  loadBudgetPeriods,
  loadCostCenters,
  updateBudgetLine,
  type StoredCostCenter,
} from '../db/finance-budget.ts'
import {
  budgetDraftTotalsByDraft,
  findBudgetDraft,
  hasActiveBudgetDraft,
  insertBudgetDraft,
  insertBudgetDraftEvent,
  lastSubmittedLines,
  listBudgetDraftEvents,
  listBudgetDrafts,
  loadBudgetDraftLines,
  loadBudgetOwners,
  loadCenterBudgetLines,
  replaceBudgetDraftLines,
  setBudgetOwner,
  updateBudgetDraft,
  type BudgetDraftChanges,
  type BudgetDraftQuery,
  type BudgetDraftScope,
  type StoredBudgetDraft,
  type StoredBudgetDraftEvent,
  type StoredBudgetDraftLine,
} from '../db/finance-budget-drafts.ts'
import { findAssigneeMembership } from '../db/finance-fixed-asset-assignments.ts'
import { loadMembershipNames, loadUserNames } from '../db/finance-maintenance-requests.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { financeBudgetActualsFor } from './finance-budget-actuals.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Bütçe hazırlama ve onay (DOM-FIN-093; ON-243). Kural core `lib/finance-budget-drafts.ts`'tedir;
 * servis kurum kilidi altında taslağı, satırları, dönemi, merkezi ve bütçe satırlarını yükler, core'a
 * karar verdirir, taslağı, geçmiş satırını ve onayda bütçe satırlarını aynı transaction'da yazar.
 * Yönetici bütün taslakları, ön büro ve öğretmen yalnız bütçe sorumlusu oldukları merkezlerin
 * taslaklarını görür (başkasınınki 404; K-257). Denetim kaydına alan adları yazılır; tutar ve
 * gerekçe yazılmaz. Rol ve modül denetimi rotadadır.
 */

const DRAFT_ENTITY = 'budget_drafts'
const OWNER_ENTITY = 'budget_center_owners'
const LINE_ENTITY = 'budget_lines'

const isManager = (ctx: ServiceContext) => canDecideBudgetDraft(ctx.actor.role)

/** Görme kapsamı: yönetici her şey, diğer personel sorumlusu olduğu merkezler (K-257). */
async function scopeOf(db: Database, ctx: ServiceContext) {
  const owners = await loadBudgetOwners(db, ctx.institutionId)
  const scope: BudgetDraftScope = isManager(ctx)
    ? {}
    : {
        costCenterIds: [...owners.entries()]
          .filter(([, membershipId]) => membershipId === ctx.actor.membershipId)
          .map(([centerId]) => centerId),
      }
  return { owners, scope }
}

const actorOf = (
  ctx: ServiceContext,
  owners: ReadonlyMap<string, string>,
  costCenterId: string,
): BudgetDraftActor => ({
  role: ctx.actor.role,
  isOwner: owners.get(costCenterId) === ctx.actor.membershipId,
})

// --- Görünüm -------------------------------------------------------------------------------------

interface ViewContext {
  centers: ReadonlyMap<string, StoredCostCenter>
  owners: ReadonlyMap<string, string>
  users: ReadonlyMap<string, string>
  members: ReadonlyMap<string, string>
  totals: ReadonlyMap<string, { incomeCents: number; expenseCents: number; lineCount: number }>
}

async function viewContext(
  db: Database,
  ctx: ServiceContext,
  owners: ReadonlyMap<string, string>,
  drafts: readonly StoredBudgetDraft[],
  events: readonly StoredBudgetDraftEvent[] = [],
): Promise<ViewContext> {
  const centers = await loadCostCenters(db, ctx.institutionId)
  const [users, members, totals] = await Promise.all([
    loadUserNames(db, ctx.institutionId, [
      ...drafts.flatMap((draft) =>
        [draft.createdByUserId, draft.submittedByUserId, draft.approvedByUserId].filter(
          (id): id is string => id !== null,
        ),
      ),
      ...events.map((event) => event.actorUserId),
    ]),
    loadMembershipNames(db, ctx.institutionId, [
      ...new Set(drafts.flatMap((draft) => owners.get(draft.costCenterId) ?? [])),
    ]),
    budgetDraftTotalsByDraft(
      db,
      ctx.institutionId,
      drafts.map((draft) => draft.id),
    ),
  ])
  return {
    centers: new Map(centers.map((center) => [center.id, center])),
    owners,
    users,
    members,
    totals,
  }
}

const userName = (names: ReadonlyMap<string, string>, id: string | null) =>
  id === null ? null : (names.get(id) ?? null)

function draftView(ctx: ServiceContext, draft: StoredBudgetDraft, view: ViewContext) {
  const ownerId = view.owners.get(draft.costCenterId) ?? null
  const totals = view.totals.get(draft.id) ?? { incomeCents: 0, expenseCents: 0, lineCount: 0 }
  return {
    id: draft.id,
    period: {
      id: draft.periodId,
      name: draft.periodName,
      status: draft.periodStatus,
      startDate: draft.periodStartDate,
      endDate: draft.periodEndDate,
    },
    costCenter: {
      id: draft.costCenterId,
      code: draft.costCenterCode,
      name: draft.costCenterName,
      path: costCenterPath(view.centers, draft.costCenterId),
      isActive: draft.costCenterActive,
    },
    owner:
      ownerId === null ? null : { membershipId: ownerId, name: view.members.get(ownerId) ?? null },
    status: draft.status,
    revision: draft.revision,
    approvedRevision: draft.approvedRevision,
    approvedAt: draft.approvedAt,
    approvedByName: userName(view.users, draft.approvedByUserId),
    createdByName: userName(view.users, draft.createdByUserId),
    submittedAt: draft.submittedAt,
    submittedByName: userName(view.users, draft.submittedByUserId),
    decisionNote: draft.decisionNote,
    ...totals,
    actions: budgetDraftActions(
      draft,
      actorOf(ctx, view.owners, draft.costCenterId),
      draft.periodStatus,
    ),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    version: draft.version,
  }
}

const lineView = (line: StoredBudgetDraftLine) => ({
  id: line.id,
  itemId: line.itemId,
  itemCode: line.itemCode,
  itemName: line.itemName,
  itemKind: line.itemKind,
  itemActive: line.itemActive,
  amountCents: line.amountCents,
  justification: line.justification,
})

function eventView(
  event: StoredBudgetDraftEvent,
  view: ViewContext,
  items: ReadonlyMap<string, { code: string; name: string }>,
) {
  return {
    id: event.id,
    event: event.event,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    revision: event.revision,
    note: event.note,
    actorName: view.users.get(event.actorUserId) ?? null,
    occurredAt: event.occurredAt,
    changes:
      event.changes === null
        ? null
        : event.changes.map((change) => ({
            ...change,
            itemCode: items.get(change.itemId)?.code ?? '',
            itemName: items.get(change.itemId)?.name ?? '',
          })),
  }
}

async function draftOf(db: Database, ctx: ServiceContext, id: string) {
  const { owners, scope } = await scopeOf(db, ctx)
  const draft = await findBudgetDraft(db, ctx.institutionId, id, scope)
  if (draft === null) throw new NotFoundError()
  return { draft, owners }
}

async function detailOf(db: Database, ctx: ServiceContext, id: string) {
  const { draft, owners } = await draftOf(db, ctx, id)
  const [lines, events, items] = await Promise.all([
    loadBudgetDraftLines(db, ctx.institutionId, [id]),
    listBudgetDraftEvents(db, ctx.institutionId, id),
    loadBudgetItems(db, ctx.institutionId),
  ])
  const view = await viewContext(db, ctx, owners, [draft], events)
  const itemMap = new Map(items.map((item) => [item.id, item]))
  return {
    ...draftView(ctx, draft, view),
    lines: lines.map(lineView),
    events: events.map((event) => eventView(event, view, itemMap)),
  }
}

export async function listBudgetDraftsFor(
  ctx: ServiceContext,
  query: Omit<BudgetDraftQuery, keyof BudgetDraftScope>,
) {
  const { owners, scope } = await scopeOf(ctx.db, ctx)
  const { items, total } = await listBudgetDrafts(ctx.db, ctx.institutionId, {
    ...query,
    ...scope,
  })
  const view = await viewContext(ctx.db, ctx, owners, items)
  return { items: items.map((draft) => draftView(ctx, draft, view)), total }
}

export const getBudgetDraftFor = (ctx: ServiceContext, id: string) => detailOf(ctx.db, ctx, id)

/**
 * Formun seçenekleri: kapalı olmayan dönemler, görülen etkin merkezler (sorumlusuyla ve hazırlama
 * hakkıyla) ve etkin kalemler. Ön büro ve öğretmen yalnız sorumlusu olduğu merkezleri görür (K-257);
 * bütçe kalem ve dönem uçları yalnız yöneticide olduğu için seçenekler buradan gelir.
 */
export async function budgetDraftOptionsFor(ctx: ServiceContext) {
  const [periods, centers, items, owners] = await Promise.all([
    loadBudgetPeriods(ctx.db, ctx.institutionId),
    loadCostCenters(ctx.db, ctx.institutionId),
    loadBudgetItems(ctx.db, ctx.institutionId),
    loadBudgetOwners(ctx.db, ctx.institutionId),
  ])
  const byId = new Map(centers.map((center) => [center.id, center]))
  const visible = centers.filter(
    (center) =>
      center.isActive && (isManager(ctx) || owners.get(center.id) === ctx.actor.membershipId),
  )
  const members = await loadMembershipNames(ctx.db, ctx.institutionId, [
    ...new Set(visible.flatMap((center) => owners.get(center.id) ?? [])),
  ])
  return {
    periods: periods
      .filter((period) => period.status !== 'closed')
      .map((period) => ({
        id: period.id,
        name: period.name,
        status: period.status,
        startDate: period.startDate,
        endDate: period.endDate,
      })),
    centers: visible
      .map((center) => {
        const ownerId = owners.get(center.id) ?? null
        return {
          id: center.id,
          code: center.code,
          name: center.name,
          path: costCenterPath(byId, center.id),
          owner:
            ownerId === null ? null : { membershipId: ownerId, name: members.get(ownerId) ?? null },
          canPrepare: isManager(ctx) || ownerId === ctx.actor.membershipId,
        }
      })
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    items: items
      .filter((item) => item.isActive)
      .map((item) => ({ id: item.id, code: item.code, name: item.name, kind: item.kind })),
  }
}

/**
 * Karşılaştırma (K-259): taslak, bu dönemin onaylı bütçesi ve önceki dönemin (bu dönemden önce biten
 * son açık ya da kapalı dönem) planı ile tahakkuk esaslı gerçekleşeni (DOM-FIN-066), merkez ve kalem
 * bazında. Salt okur.
 */
export async function budgetDraftComparisonFor(ctx: ServiceContext, id: string) {
  const { draft } = await draftOf(ctx.db, ctx, id)
  const [lines, approvedLines, periods, items] = await Promise.all([
    loadBudgetDraftLines(ctx.db, ctx.institutionId, [id]),
    loadCenterBudgetLines(ctx.db, ctx.institutionId, {
      periodId: draft.periodId,
      costCenterId: draft.costCenterId,
    }),
    loadBudgetPeriods(ctx.db, ctx.institutionId),
    loadBudgetItems(ctx.db, ctx.institutionId),
  ])
  const previousPeriod = previousBudgetPeriod(periods, {
    id: draft.periodId,
    startDate: draft.periodStartDate,
  })
  const previous =
    previousPeriod === null
      ? null
      : new Map(
          (
            await financeBudgetActualsFor(ctx, previousPeriod.id, { basis: 'accrual' })
          ).rows.flatMap((row) =>
            row.costCenterId === draft.costCenterId
              ? [
                  [
                    row.itemId,
                    {
                      plannedCents: row.hasLine ? row.plannedCents : null,
                      actualCents: row.actualCents,
                    },
                  ] as const,
                ]
              : [],
          ),
        )
  const comparison = budgetDraftComparison({
    items,
    draft: lines,
    approved: new Map(approvedLines.map((line) => [line.itemId, line.amountCents])),
    previous,
  })
  return {
    draftId: draft.id,
    basis: 'accrual' as const,
    previousPeriod:
      previousPeriod === null
        ? null
        : {
            id: previousPeriod.id,
            name: previousPeriod.name,
            startDate: previousPeriod.startDate,
            endDate: previousPeriod.endDate,
          },
    ...comparison,
  }
}

// --- Bütçe sorumlusu -----------------------------------------------------------------------------

/** Merkezin bütçe sorumlusunu atar ya da kaldırır (K-257); yalnız yönetici (rotada). */
export function setBudgetOwnerCommand(
  ctx: ServiceContext,
  costCenterId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: OWNER_ENTITY, id: costCenterId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'budget_owner.set',
      collections: [],
      entity,
      load: async (tx) => {
        const centers = await loadCostCenters(tx, ctx.institutionId)
        if (!centers.some((center) => center.id === costCenterId)) throw new NotFoundError()
        const raw = (input ?? {}) as { membershipId?: unknown }
        const staff =
          typeof raw.membershipId === 'string' && raw.membershipId.trim() !== ''
            ? await findAssigneeMembership(tx, ctx.institutionId, raw.membershipId.trim())
            : undefined
        return { run: () => planBudgetOwner(input, staff) }
      },
      after: async (tx, membershipId) => {
        await setBudgetOwner(tx, ctx.institutionId, {
          costCenterId,
          membershipId,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'budget_owner.set', entity, ['membershipId'])
        const names =
          membershipId === null
            ? new Map<string, string>()
            : await loadMembershipNames(tx, ctx.institutionId, [membershipId])
        body = {
          data: {
            costCenterId,
            owner:
              membershipId === null
                ? null
                : { membershipId, name: names.get(membershipId) ?? null },
          },
        }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Taslak komutları ----------------------------------------------------------------------------

const byItemCode = <T extends { itemCode: string }>(a: T, b: T) =>
  a.itemCode < b.itemCode ? -1 : a.itemCode > b.itemCode ? 1 : 0

/**
 * Yeni taslak (K-257): satırlar merkezin dönemdeki onaylı bütçe satırlarından (kalem koduna göre)
 * doldurulur. 201.
 */
export function createBudgetDraftCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: DRAFT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'budget_draft.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = budgetDraftSchema.parse(input)
        const [periods, centers, owners, exists, items] = await Promise.all([
          loadBudgetPeriods(tx, ctx.institutionId),
          loadCostCenters(tx, ctx.institutionId),
          loadBudgetOwners(tx, ctx.institutionId),
          hasActiveBudgetDraft(tx, ctx.institutionId, data),
          loadBudgetItems(tx, ctx.institutionId),
        ])
        const baseline = await loadCenterBudgetLines(tx, ctx.institutionId, data)
        const codes = new Map(items.map((item) => [item.id, item.code]))
        return {
          run: () => {
            planBudgetDraftCreate(input, {
              period: periods.find((period) => period.id === data.periodId) ?? null,
              center: centers.find((center) => center.id === data.costCenterId) ?? null,
              actor: actorOf(ctx, owners, data.costCenterId),
              exists,
            })
            const lines: BudgetDraftLineValue[] = baseline
              .map((line) => ({ ...line, itemCode: codes.get(line.itemId) ?? '' }))
              .sort(byItemCode)
              .map((line) => ({
                itemId: line.itemId,
                amountCents: line.amountCents,
                justification: null,
              }))
            return { data, lines }
          },
        }
      },
      after: async (tx, { data, lines }) => {
        await insertBudgetDraft(tx, ctx.institutionId, {
          id,
          ...data,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await replaceBudgetDraftLines(tx, ctx.institutionId, {
          draftId: id,
          current: [],
          lines,
          newId: randomUUID,
          now: ctx.now,
        })
        await insertBudgetDraftEvent(tx, ctx.institutionId, {
          id: randomUUID(),
          draftId: id,
          event: 'created',
          fromStatus: null,
          toStatus: 'draft',
          revision: 0,
          note: null,
          lines: null,
          changes: null,
          actorUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'budget_draft.create', entity, [
          'periodId',
          'costCenterId',
          ...(lines.length === 0 ? [] : ['lines']),
        ])
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Satırların yerine yazılması: yalnız taslak ya da revizyonu istenen taslakta. */
export function updateBudgetDraftLinesCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DRAFT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'budget_draft.update',
      collections: [],
      entity,
      load: async (tx) => {
        budgetDraftLinesSchema.parse(input)
        const { draft } = await draftOf(tx, ctx, id)
        if (draft.version !== expectedVersion) throw new ConflictError()
        const [current, items] = await Promise.all([
          loadBudgetDraftLines(tx, ctx.institutionId, [id]),
          loadBudgetItems(tx, ctx.institutionId),
        ])
        return {
          run: () => ({
            current,
            lines: planBudgetDraftLines(input, {
              status: draft.status,
              period: { status: draft.periodStatus },
              items: new Map(items.map((item) => [item.id, item])),
              currentItemIds: new Set(current.map((line) => line.itemId)),
            }),
          }),
        }
      },
      after: async (tx, { current, lines }) => {
        const saved = await updateBudgetDraft(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: {},
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await replaceBudgetDraftLines(tx, ctx.institutionId, {
          draftId: id,
          current,
          lines,
          newId: randomUUID,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'budget_draft.update', entity, ['lines'])
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Geçişin planı: taslağa yazılacak alanlar, geçmiş satırı ve onayda bütçe satırı yazımı. */
interface TransitionPlan {
  changes: BudgetDraftChanges & { status: BudgetDraftStatus }
  event: BudgetDraftEvent
  revision: number
  note: string | null
  snapshot?: { lines: BudgetDraftLineValue[]; changes: BudgetDraftChange[] }
  fields: string[]
  write?: (tx: Database) => Promise<void>
}

type Planner = (tx: Database, draft: StoredBudgetDraft) => Promise<() => TransitionPlan>

/**
 * Durum geçişi: taslak görme kapsamıyla yüklenir (sorumlu başkasının taslağında 404), sürüm
 * `If-Match` ile karşılaştırılır, core kuralı çalışır; taslak, geçmiş satırı ve onayda bütçe
 * satırları aynı transaction'da yazılır.
 */
function transitionCommand(
  ctx: ServiceContext,
  id: string,
  action: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
  planner: Planner,
): Promise<CommandResponse> {
  const entity = { type: DRAFT_ENTITY, id }
  const auditAction = `budget_draft.${action}`
  let body: unknown
  return runCommand(
    ctx,
    {
      action: auditAction,
      collections: [],
      entity,
      load: async (tx) => {
        const { draft } = await draftOf(tx, ctx, id)
        if (draft.version !== expectedVersion) throw new ConflictError()
        const plan = await planner(tx, draft)
        return { run: () => ({ draft, planned: plan() }) }
      },
      after: async (tx, { draft, planned }) => {
        const saved = await updateBudgetDraft(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: planned.changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        if (planned.write) await planned.write(tx)
        await insertBudgetDraftEvent(tx, ctx.institutionId, {
          id: randomUUID(),
          draftId: id,
          event: planned.event,
          fromStatus: draft.status,
          toStatus: planned.changes.status,
          revision: planned.revision,
          note: planned.note,
          lines: planned.snapshot?.lines ?? null,
          changes: planned.snapshot?.changes ?? null,
          actorUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, auditAction, entity, planned.fields)
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

const withNote = (fields: string[], note: string | null) =>
  note === null ? fields : [...fields, 'note']
const centerKey = (draft: StoredBudgetDraft) => ({
  periodId: draft.periodId,
  costCenterId: draft.costCenterId,
})

/**
 * Onaya gönderim (K-257): sürüm bir artar; geçmişe sürümün satırları ve önceki sürüme (ilk
 * gönderimde onaylı bütçeye) göre değişen kalemler yazılır.
 */
export function submitBudgetDraftCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) {
  return transitionCommand(ctx, id, 'submit', expectedVersion, idempotency, async (tx, draft) => {
    const { note } = budgetDraftNoteSchema.parse(input ?? {})
    const [lines, approvedLines, previous] = await Promise.all([
      loadBudgetDraftLines(tx, ctx.institutionId, [id]),
      loadCenterBudgetLines(tx, ctx.institutionId, centerKey(draft)),
      lastSubmittedLines(tx, ctx.institutionId, id),
    ])
    return () => {
      const values = lines.map((line) => ({
        itemId: line.itemId,
        amountCents: line.amountCents,
        justification: line.justification,
      }))
      const planned = planBudgetDraftSubmit({
        status: draft.status,
        revision: draft.revision,
        period: { status: draft.periodStatus },
        lines: values,
        approved: new Map(approvedLines.map((line) => [line.itemId, line.amountCents])),
      })
      return {
        changes: {
          status: planned.status,
          revision: planned.revision,
          submittedAt: ctx.now,
          submittedByUserId: ctx.actor.userId,
          decisionNote: null,
        },
        event: 'submitted',
        revision: planned.revision,
        note: note === null || note === '' ? null : note,
        snapshot: { lines: values, changes: budgetDraftChanges(previous ?? approvedLines, values) },
        fields: withNote(['status', 'revision'], note === '' ? null : note),
      }
    }
  })
}

/**
 * Onay (K-256, K-258): merkezin dönemdeki bütçe satırları taslağa eşitlenir (yeni satır, tutar
 * düzeltmesi, taslakta olmayan satırın kaldırılması); bütçe satırı denetimi satır başına yazılır.
 */
export function approveBudgetDraftCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) {
  return transitionCommand(ctx, id, 'approve', expectedVersion, idempotency, async (tx, draft) => {
    const { note } = budgetDraftNoteSchema.parse(input ?? {})
    const [lines, current, items] = await Promise.all([
      loadBudgetDraftLines(tx, ctx.institutionId, [id]),
      loadCenterBudgetLines(tx, ctx.institutionId, centerKey(draft)),
      loadBudgetItems(tx, ctx.institutionId),
    ])
    return () => {
      const plan = planBudgetDraftApproval({
        status: draft.status,
        period: { status: draft.periodStatus },
        center: { isActive: draft.costCenterActive },
        items: new Map(items.map((item) => [item.id, item])),
        lines,
        current,
      })
      const decision = note === null || note === '' ? null : note
      return {
        changes: {
          status: plan.status,
          approvedRevision: draft.revision,
          approvedAt: ctx.now,
          approvedByUserId: ctx.actor.userId,
          decisionNote: decision,
        },
        event: 'approved',
        revision: draft.revision,
        note: decision,
        fields: withNote(['status', 'approvedRevision', 'budgetLines'], decision),
        write: async (writer) => {
          for (const line of plan.inserts) {
            const lineId = randomUUID()
            await insertBudgetLine(writer, ctx.institutionId, {
              id: lineId,
              periodId: draft.periodId,
              costCenterId: draft.costCenterId,
              itemId: line.itemId,
              amountCents: line.amountCents,
              monthlyCents: null,
              now: ctx.now,
            })
            await auditWork(writer, ctx, 'budget_line.create', { type: LINE_ENTITY, id: lineId }, [
              'amountCents',
            ])
          }
          for (const line of plan.updates) {
            const saved = await updateBudgetLine(writer, ctx.institutionId, {
              id: line.id,
              expectedVersion: line.version,
              changes: { amountCents: line.amountCents, monthlyCents: line.monthlyCents },
              now: ctx.now,
            })
            if (!saved) throw new ConflictError()
            await auditWork(writer, ctx, 'budget_line.update', { type: LINE_ENTITY, id: line.id }, [
              'amountCents',
              'monthlyCents',
            ])
          }
          for (const line of plan.removals) {
            const saved = await updateBudgetLine(writer, ctx.institutionId, {
              id: line.id,
              expectedVersion: line.version,
              changes: { archivedAt: ctx.now },
              now: ctx.now,
            })
            if (!saved) throw new ConflictError()
            await auditWork(writer, ctx, 'budget_line.remove', { type: LINE_ENTITY, id: line.id }, [
              'archivedAt',
            ])
          }
        },
      }
    }
  })
}

function decisionCommand(
  action: 'request_revision' | 'reject',
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) {
  return transitionCommand(ctx, id, action, expectedVersion, idempotency, async (_tx, draft) => {
    const { reason } = budgetDraftReasonSchema.parse(input)
    return () => ({
      changes: {
        status: budgetDraftTransition(
          draft.status,
          action === 'reject' ? 'reject' : 'requestRevision',
        ),
        decisionNote: reason,
      },
      event: action === 'reject' ? 'rejected' : 'revision_requested',
      revision: draft.revision,
      note: reason,
      fields: ['status', 'decisionNote'],
    })
  })
}

/** Revizyon isteği (K-256): gerekçe zorunlu; sorumlu düzeltip yeniden gönderir. */
export const requestBudgetDraftRevisionCommand = (
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) => decisionCommand('request_revision', ctx, id, input, expectedVersion, idempotency)

/** Ret (K-256): gerekçe zorunlu; reddedilen taslak kapanır, birim yeni taslak açabilir. */
export const rejectBudgetDraftCommand = (
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) => decisionCommand('reject', ctx, id, input, expectedVersion, idempotency)

/** Yeni revizyon (K-258): onaylı taslak yeniden taslak olur; onaylı bütçe yeni onaya kadar kalır. */
export function reopenBudgetDraftCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) {
  return transitionCommand(ctx, id, 'reopen', expectedVersion, idempotency, async (_tx, draft) => {
    const { note } = budgetDraftNoteSchema.parse(input ?? {})
    return () => {
      const decision = note === null || note === '' ? null : note
      return {
        changes: {
          status: planBudgetDraftReopen({
            status: draft.status,
            period: { status: draft.periodStatus },
          }),
          decisionNote: null,
        },
        event: 'reopened',
        revision: draft.revision,
        note: decision,
        fields: withNote(['status'], decision),
      }
    }
  })
}
