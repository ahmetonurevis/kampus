import { randomUUID } from 'node:crypto'

import { supplyRequestNumber } from '@kampus/school-core/lib/finance-supply-requests.ts'
import {
  confirmPurchaseBudget,
  itemTotalCents,
  planPurchaseRequest,
  planPurchaseRequestApprove,
  planPurchaseRequestCancel,
  planPurchaseRequestReject,
  planPurchaseRequestSubmit,
  planPurchaseRequestUpdate,
  purchaseBudgetInfo,
  purchaseRequestActions,
  purchaseRequestNumber,
  type PurchaseBudgetWarning,
  type PurchaseRequestRefs,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'

import type { Database } from '../db/client.ts'
import { loadBudgetItems, loadBudgetPeriods, loadCostCenters } from '../db/finance-budget.ts'
import { loadStockItemLabels, loadStockItemsByIds } from '../db/finance-inventory.ts'
import {
  findPurchaseRequest,
  insertPurchaseRequest,
  listPurchaseRequests,
  loadPurchaseBudgetFigures,
  loadPurchaseRequestItems,
  nextPurchaseRequestSequence,
  purchaseActorNames,
  replacePurchaseRequestItems,
  updatePurchaseRequest,
  type PurchaseRequestQuery,
  type PurchaseRequestUpdate,
  type StoredPurchaseRequest,
} from '../db/finance-purchase-requests.ts'
import { listSuppliers, loadSupplierRefs } from '../db/finance-suppliers.ts'
import { findSupplyRequestForPurchase } from '../db/finance-supply-requests.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Satın alma talebi (DOM-FIN-071; ON-222). Kural core `lib/finance-purchase-requests.ts`'tedir;
 * servis kurum kilidi altında talebi ve bağlı kayıtları (merkez, dönem, gider kalemi, tedarikçi)
 * yükler, core'a karar verdirir, aynı transaction'da yazar ve denetim kaydı bırakır. Bütçe kalanı
 * okumada hesaplanır, saklanmaz (K-145). Gönderim ve onayda kalan kurum kilidi altında yeniden
 * hesaplanır; aşım ya da bütçesiz talep açık onay ister (ON-245, K-146). Kalem isteğe bağlı olarak
 * kurumun stok kartına bağlanır; bağ siparişe kopyalanır (ON-339, K-221). Rol ve modül denetimi
 * rotadadır.
 */

const ENTITY = 'purchase_requests'

type Key = {
  costCenterId: string
  periodId: string
  budgetItemId: string
  supplierId: string | null
  /** Kalemlerin bağladığı stok kartları (ON-339); yalnız kurumun kartları yüklenir. */
  stockItemIds?: readonly string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Talebin bağlı kayıtları; kurumun merkez, kalem ve dönem sayısı küçüktür, tamamı yüklenir. Stok
 * kartı yalnız etkin kurumda aranır: başka kurumun kartı bulunmaz (K-221).
 */
export async function purchaseRequestRefsFor(
  tx: Database,
  ctx: ServiceContext,
  key: Key,
): Promise<PurchaseRequestRefs> {
  const [centers, items, periods, supplierRefs, cards] = await Promise.all([
    loadCostCenters(tx, ctx.institutionId),
    loadBudgetItems(tx, ctx.institutionId),
    loadBudgetPeriods(tx, ctx.institutionId),
    loadSupplierRefs(tx, ctx.institutionId, key.supplierId === null ? [] : [key.supplierId]),
    loadStockItemsByIds(
      tx,
      ctx.institutionId,
      (key.stockItemIds ?? []).filter((id) => UUID.test(id)),
    ),
  ])
  return {
    period: periods.find((row) => row.id === key.periodId) ?? null,
    costCenter: centers.find((row) => row.id === key.costCenterId) ?? null,
    budgetItem: items.find((row) => row.id === key.budgetItemId) ?? null,
    ...(key.supplierId === null ? {} : { supplier: supplierRefs.get(key.supplierId) ?? null }),
    stockItems: new Map(
      cards.map((card) => [card.id, { name: card.name, unit: card.unit, isActive: card.isActive }]),
    ),
  }
}

/** Gövdedeki kimlikler şemadan önce okunur; bozuksa boş kimlik bağlı kayıt bulamaz, şema 400 verir. */
function rawKey(input: unknown): Key {
  const raw = (input ?? {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  return {
    costCenterId: text(raw.costCenterId),
    periodId: text(raw.periodId),
    budgetItemId: text(raw.budgetItemId),
    supplierId: typeof raw.supplierId === 'string' ? raw.supplierId : null,
    stockItemIds: Array.isArray(raw.items)
      ? raw.items.flatMap((item: unknown) => {
          const value = (item ?? {}) as Record<string, unknown>
          return typeof value.stockItemId === 'string' ? [value.stockItemId] : []
        })
      : [],
  }
}

async function requestOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findPurchaseRequest(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

function summaryView(request: StoredPurchaseRequest, names: ReadonlyMap<string, string>) {
  return {
    id: request.id,
    number: purchaseRequestNumber(request.sequence),
    status: request.status,
    costCenter: {
      id: request.costCenterId,
      code: request.costCenterCode,
      name: request.costCenterName,
    },
    period: { id: request.periodId, name: request.periodName },
    budgetItem: {
      id: request.budgetItemId,
      code: request.budgetItemCode,
      name: request.budgetItemName,
    },
    supplier:
      request.supplierId === null
        ? null
        : { id: request.supplierId, name: request.supplierName ?? '' },
    justification: request.justification,
    itemCount: request.itemCount,
    totalCents: request.totalCents,
    requestedByUserId: request.requestedByUserId,
    requestedByName: names.get(request.requestedByUserId) ?? null,
    submittedAt: request.submittedAt,
    decidedAt: request.decidedAt,
    cancelledAt: request.cancelledAt,
    createdAt: request.createdAt,
    version: request.version,
  }
}

export async function listPurchaseRequestsFor(ctx: ServiceContext, query: PurchaseRequestQuery) {
  const { items, total } = await listPurchaseRequests(ctx.db, ctx.institutionId, query)
  const names = await purchaseActorNames(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.requestedByUserId),
  )
  return { items: items.map((item) => summaryView(item, names)), total }
}

async function detailView(db: Database, ctx: ServiceContext, id: string) {
  const request = await requestOf(db, ctx, id)
  const [items, figures, names] = await Promise.all([
    loadPurchaseRequestItems(db, ctx.institutionId, id),
    loadPurchaseBudgetFigures(db, ctx.institutionId, {
      periodId: request.periodId,
      costCenterId: request.costCenterId,
      budgetItemId: request.budgetItemId,
      exceptId: id,
    }),
    purchaseActorNames(
      db,
      ctx.institutionId,
      [
        request.requestedByUserId,
        request.submittedByUserId,
        request.decidedByUserId,
        request.cancelledByUserId,
      ].filter((value): value is string => value !== null),
    ),
  ])
  const nameOf = (userId: string | null) => (userId === null ? null : (names.get(userId) ?? null))
  const [cards, supply] = await Promise.all([
    loadStockItemLabels(
      db,
      ctx.institutionId,
      items.map((item) => item.stockItemId),
    ),
    findSupplyRequestForPurchase(db, ctx.institutionId, id),
  ])
  return {
    ...summaryView(request, names),
    items: items.map(({ stockItemId, ...item }) => ({
      ...item,
      totalCents: itemTotalCents(item),
      stockItem: stockItemId === null ? null : (cards.get(stockItemId) ?? null),
    })),
    budget: purchaseBudgetInfo(figures, request.totalCents),
    submittedByName: nameOf(request.submittedByUserId),
    decidedByName: nameOf(request.decidedByUserId),
    decisionNote: request.decisionNote,
    cancelledByName: nameOf(request.cancelledByUserId),
    cancelReason: request.cancelReason,
    actions: purchaseRequestActions(request, ctx.actor),
    // Talep bir sarf talebinin kalanından açıldıysa (DOM-FIN-091, K-246) o talep.
    supplyRequest:
      supply === null ? null : { id: supply.id, number: supplyRequestNumber(supply.sequence) },
  }
}

export const getPurchaseRequestFor = (ctx: ServiceContext, id: string) =>
  detailView(ctx.db, ctx, id)

const requestBody = async (tx: Database, ctx: ServiceContext, id: string) => ({
  data: await detailView(tx, ctx, id),
})

/**
 * Talep formunun seçenekleri: etkin maliyet merkezleri, etkin gider kalemleri, kapalı olmayan
 * dönemler ve etkin tedarikçiler. Ön büro bütçe uçlarını okumaz (K-60); yalnız ad ve kod görür.
 */
export async function purchaseRequestOptionsFor(ctx: ServiceContext) {
  const [centers, items, periods, supplierList] = await Promise.all([
    loadCostCenters(ctx.db, ctx.institutionId),
    loadBudgetItems(ctx.db, ctx.institutionId),
    loadBudgetPeriods(ctx.db, ctx.institutionId),
    listSuppliers(ctx.db, ctx.institutionId, {
      page: 1,
      pageSize: 1000,
      status: 'active',
      searchTaxNumber: false,
    }),
  ])
  return {
    costCenters: centers
      .filter((center) => center.isActive)
      .map(({ id, code, name }) => ({ id, code, name })),
    budgetItems: items
      .filter((item) => item.isActive && item.kind === 'expense')
      .map(({ id, code, name }) => ({ id, code, name })),
    periods: periods
      .filter((period) => period.status !== 'closed')
      .map(({ id, name, status, startDate, endDate }) => ({
        id,
        name,
        status,
        startDate,
        endDate,
      })),
    suppliers: supplierList.items.map(({ id, name }) => ({ id, name })),
  }
}

/**
 * Talep formunun bütçe durumu (ON-245, K-148): seçilen dönem × merkez × kalem satırının planı ve
 * taahhüdü. Bilinmeyen ya da başka kurumun kimliği plansız ve taahhütsüz döner (sızıntı yok).
 */
export async function purchaseBudgetStatusFor(
  ctx: ServiceContext,
  key: { periodId: string; costCenterId: string; budgetItemId: string },
) {
  const figures = await loadPurchaseBudgetFigures(ctx.db, ctx.institutionId, {
    ...key,
    exceptId: null,
  })
  const info = purchaseBudgetInfo(figures, 0)
  return {
    plannedCents: info.plannedCents,
    approvedCents: info.approvedCents,
    pendingCents: info.pendingCents,
    orderedCents: info.orderedCents,
    receivedCents: info.receivedCents,
    committedCents: info.committedCents,
    remainingCents: info.remainingCents,
  }
}

/** Yeni taslak (DOM-FIN-071); kurum içi sıra numarası kilit altında verilir. 201. */
export function createPurchaseRequestCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'purchase_request.create',
      collections: [],
      entity,
      load: async (tx) => {
        const refs = await purchaseRequestRefsFor(tx, ctx, rawKey(input))
        const sequence = await nextPurchaseRequestSequence(tx, ctx.institutionId)
        return { run: () => ({ plan: planPurchaseRequest(input, refs), sequence }) }
      },
      after: async (tx, { plan, sequence }) => {
        const { items, ...fields } = plan
        await insertPurchaseRequest(tx, ctx.institutionId, {
          ...fields,
          id,
          sequence,
          requestedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await replacePurchaseRequestItems(tx, ctx.institutionId, id, items, ctx.now)
        await auditWork(tx, ctx, 'purchase_request.create', entity, Object.keys(plan))
        body = await requestBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Taslağın düzeltmesi; kalemler bütün olarak yazılır. */
export function updatePurchaseRequestCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'purchase_request.update',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await requestOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const raw = (input ?? {}) as Record<string, unknown>
        const given = rawKey(input)
        const refs = await purchaseRequestRefsFor(tx, ctx, {
          costCenterId: 'costCenterId' in raw ? given.costCenterId : current.costCenterId,
          periodId: 'periodId' in raw ? given.periodId : current.periodId,
          budgetItemId: 'budgetItemId' in raw ? given.budgetItemId : current.budgetItemId,
          supplierId: 'supplierId' in raw ? given.supplierId : current.supplierId,
          stockItemIds: given.stockItemIds ?? [],
        })
        return { run: () => planPurchaseRequestUpdate(current, input, refs, ctx.actor) }
      },
      after: async (tx, changes) => {
        const { items, ...fields } = changes
        const saved = await updatePurchaseRequest(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: fields,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        if (items !== undefined)
          await replacePurchaseRequestItems(tx, ctx.institutionId, id, items, ctx.now)
        await auditWork(tx, ctx, 'purchase_request.update', entity, Object.keys(changes))
        body = await requestBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

type Transition = 'submit' | 'approve' | 'reject' | 'cancel'

type TransitionPlan = {
  changes: PurchaseRequestUpdate
  /** Açık onayla geçilen bütçe uyarısı; denetim kaydına `confirmOverBudget` olarak düşer (K-146). */
  budgetWarning: PurchaseBudgetWarning | null
}

/**
 * Durum geçişi: gönder, onayla, reddet, iptal et (DOM-FIN-071). Gönderim ve onayda bütçe kalanı
 * kurum kilidi altında yüklenir: eşzamanlı iki talep aynı kalanı birlikte tüketemez (ON-245).
 */
export function transitionPurchaseRequestCommand(
  ctx: ServiceContext,
  id: string,
  transition: Transition,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const action = `purchase_request.${transition}`
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const current = await requestOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const refs = await purchaseRequestRefsFor(tx, ctx, current)
        const budget =
          transition === 'submit' || transition === 'approve'
            ? purchaseBudgetInfo(
                await loadPurchaseBudgetFigures(tx, ctx.institutionId, {
                  periodId: current.periodId,
                  costCenterId: current.costCenterId,
                  budgetItemId: current.budgetItemId,
                  exceptId: id,
                }),
                current.totalCents,
              )
            : null
        const checkBudget = (confirmed: boolean | undefined) =>
          budget === null ? null : confirmPurchaseBudget(budget, confirmed)
        return {
          run: (): TransitionPlan => {
            switch (transition) {
              case 'submit': {
                const { confirmOverBudget } = planPurchaseRequestSubmit(
                  current,
                  refs,
                  ctx.actor,
                  input,
                )
                return {
                  budgetWarning: checkBudget(confirmOverBudget),
                  changes: {
                    status: 'submitted',
                    submittedAt: ctx.now,
                    submittedByUserId: ctx.actor.userId,
                  },
                }
              }
              case 'approve': {
                const { note, confirmOverBudget } = planPurchaseRequestApprove(current, input, refs)
                return {
                  budgetWarning: checkBudget(confirmOverBudget),
                  changes: {
                    status: 'approved',
                    decidedAt: ctx.now,
                    decidedByUserId: ctx.actor.userId,
                    decisionNote: note,
                  },
                }
              }
              case 'reject': {
                const { reason } = planPurchaseRequestReject(current, input)
                return {
                  budgetWarning: null,
                  changes: {
                    status: 'rejected',
                    decidedAt: ctx.now,
                    decidedByUserId: ctx.actor.userId,
                    decisionNote: reason,
                  },
                }
              }
              case 'cancel': {
                const { reason } = planPurchaseRequestCancel(current, input, ctx.actor)
                return {
                  budgetWarning: null,
                  changes: {
                    status: 'cancelled',
                    cancelledAt: ctx.now,
                    cancelledByUserId: ctx.actor.userId,
                    cancelReason: reason,
                  },
                }
              }
              default:
                return transition satisfies never
            }
          },
        }
      },
      after: async (tx, { changes, budgetWarning }) => {
        const saved = await updatePurchaseRequest(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, action, entity, [
          ...Object.keys(changes),
          ...(budgetWarning === null ? [] : ['confirmOverBudget']),
        ])
        body = await requestBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
