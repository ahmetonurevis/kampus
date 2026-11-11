import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  planPurchaseRequest,
  purchaseRequestNumber,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'
import {
  canSeeAllSupplyRequests,
  canViewSupplyRequest,
  planSupplyFulfillment,
  planSupplyPurchaseConversion,
  planSupplyRequest,
  planSupplyRequestApprove,
  planSupplyRequestCancel,
  planSupplyRequestReject,
  remainingOf,
  supplyRequestActions,
  supplyRequestNumber,
  type SupplyLine,
  type SupplyStockCard,
} from '@kampus/school-core/lib/finance-supply-requests.ts'

import type { Database } from '../db/client.ts'
import {
  insertStockMovements,
  loadLastReceiptPrices,
  loadStockItemsByIds,
} from '../db/finance-inventory.ts'
import {
  insertPurchaseRequest,
  nextPurchaseRequestSequence,
  purchaseActorNames,
  replacePurchaseRequestItems,
} from '../db/finance-purchase-requests.ts'
import {
  findSupplyRequest,
  insertSupplyRequest,
  insertSupplyRequestIssues,
  listSupplyRequests,
  listSupplyStockCards,
  loadSupplyRequestIssues,
  loadSupplyRequestItems,
  loadSupplyStock,
  nextSupplyRequestSequence,
  updateSupplyRequest,
  type StoredSupplyItem,
  type StoredSupplyRequest,
  type SupplyRequestQuery,
  type SupplyRequestUpdate,
} from '../db/finance-supply-requests.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { movementContext } from './finance-inventory.ts'
import { purchaseRequestRefsFor } from './finance-purchase-requests.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Sarf malzeme talebi (DOM-FIN-091; ON-233). Kural core `lib/finance-supply-requests.ts`'tedir;
 * servis kurum kilidi altında talebi, kalemleri ve stok hareketlerini yükler, core'a karar
 * verdirir, aynı transaction'da yazar ve denetim kaydı bırakır. Öğretmen yalnız kendi talebini
 * görür; başkasının talebi 404'tür (varlık sızmaz, K-244). Karşılama `supply` stok çıkışı yazar
 * (K-245); dönüştürme satın alma talebini aynı işlemde taslak açar ve iki talebi bağlar (K-246).
 * Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'supply_requests'
const PURCHASE_ENTITY = 'purchase_requests'
const MOVEMENT_ENTITY = 'stock_movements'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function visibleRequest(db: Database, ctx: ServiceContext, id: string) {
  const found = await findSupplyRequest(db, ctx.institutionId, id)
  if (found === null || !canViewSupplyRequest(found, ctx.actor)) throw new NotFoundError()
  return found
}

const linesOf = (items: readonly StoredSupplyItem[]): SupplyLine[] =>
  items.map(({ id, stockItemId, quantity, fulfilledQuantity }) => ({
    id,
    stockItemId,
    quantity,
    fulfilledQuantity,
  }))

const cardsOf = (items: readonly StoredSupplyItem[]): Map<string, SupplyStockCard> =>
  new Map(
    items.map((item) => [
      item.stockItemId,
      {
        id: item.stockItemId,
        code: item.code,
        name: item.name,
        unit: item.unit,
        isActive: item.isActive,
      },
    ]),
  )

const nameOf = (names: ReadonlyMap<string, string>, userId: string | null) =>
  userId === null ? null : (names.get(userId) ?? null)

function purchaseLink(request: StoredSupplyRequest) {
  return request.purchaseRequestId === null ||
    request.purchaseRequestSequence === null ||
    request.purchaseRequestStatus === null
    ? null
    : {
        id: request.purchaseRequestId,
        number: purchaseRequestNumber(request.purchaseRequestSequence),
        status: request.purchaseRequestStatus,
      }
}

function summaryView(
  request: StoredSupplyRequest,
  items: readonly StoredSupplyItem[],
  names: ReadonlyMap<string, string>,
) {
  const remaining = items.reduce((total, item) => total + remainingOf(item), 0)
  return {
    id: request.id,
    number: supplyRequestNumber(request.sequence),
    status: request.status,
    requestedByUserId: request.requestedByUserId,
    requestedByName: nameOf(names, request.requestedByUserId),
    neededDate: request.neededDate,
    justification: request.justification,
    itemCount: items.length,
    itemSummary: items.map((item) => item.name),
    fullyFulfilled: items.length > 0 && remaining === 0,
    purchaseRequest: purchaseLink(request),
    createdAt: request.createdAt,
    version: request.version,
  }
}

const groupItems = (items: readonly StoredSupplyItem[]) => {
  const map = new Map<string, StoredSupplyItem[]>()
  for (const item of items) map.set(item.requestId, [...(map.get(item.requestId) ?? []), item])
  return map
}

/** Liste: yönetici ve ön büro bütün talepleri, diğer personel yalnız kendi taleplerini görür. */
export async function listSupplyRequestsFor(
  ctx: ServiceContext,
  query: Omit<SupplyRequestQuery, 'requestedByUserId'> & { mine?: boolean | undefined },
) {
  const { mine, ...rest } = query
  const own = mine === true || !canSeeAllSupplyRequests(ctx.actor.role)
  const { items, total } = await listSupplyRequests(ctx.db, ctx.institutionId, {
    ...rest,
    ...(own ? { requestedByUserId: ctx.actor.userId } : {}),
  })
  const [lines, names] = await Promise.all([
    loadSupplyRequestItems(
      ctx.db,
      ctx.institutionId,
      items.map((item) => item.id),
    ),
    purchaseActorNames(
      ctx.db,
      ctx.institutionId,
      items.map((item) => item.requestedByUserId),
    ),
  ])
  const byRequest = groupItems(lines)
  return {
    items: items.map((item) => summaryView(item, byRequest.get(item.id) ?? [], names)),
    total,
  }
}

async function detailView(db: Database, ctx: ServiceContext, id: string) {
  const request = await visibleRequest(db, ctx, id)
  const manager = canSeeAllSupplyRequests(ctx.actor.role)
  const items = await loadSupplyRequestItems(db, ctx.institutionId, [id])
  const cardIds = items.map((item) => item.stockItemId)
  const [issues, stock, prices] = await Promise.all([
    loadSupplyRequestIssues(db, ctx.institutionId, id),
    manager ? loadSupplyStock(db, ctx.institutionId, cardIds) : Promise.resolve([]),
    manager ? loadLastReceiptPrices(db, ctx.institutionId, cardIds) : Promise.resolve(new Map()),
  ])
  const names = await purchaseActorNames(
    db,
    ctx.institutionId,
    [
      request.requestedByUserId,
      request.decidedByUserId,
      request.fulfilledByUserId,
      request.cancelledByUserId,
      ...issues.map((issue) => issue.createdByUserId),
    ].filter((value): value is string => value !== null),
  )
  const itemName = new Map(items.map((item) => [item.id, item.name]))
  return {
    ...summaryView(request, items, names),
    items: items.map((item) => ({
      id: item.id,
      position: item.position,
      stockItem: {
        id: item.stockItemId,
        code: item.code,
        name: item.name,
        isActive: item.isActive,
      },
      unit: item.unit,
      quantity: item.quantity,
      fulfilledQuantity: item.fulfilledQuantity,
      remainingQuantity: remainingOf(item),
      stock: manager
        ? stock
            .filter((row) => row.itemId === item.stockItemId)
            .map(({ warehouseId, warehouseName, quantity }) => ({
              warehouseId,
              warehouseName,
              quantity,
            }))
        : null,
      lastPriceCents: manager ? (prices.get(item.stockItemId)?.unitPriceCents ?? null) : null,
    })),
    issues: issues.map((issue) => ({
      movementId: issue.movementId,
      itemId: issue.requestItemId,
      itemName: itemName.get(issue.requestItemId) ?? '',
      warehouseName: issue.warehouseName,
      quantity: issue.quantity,
      movementDate: issue.movementDate,
      createdByName: nameOf(names, issue.createdByUserId),
      createdAt: issue.createdAt,
      cancelled: issue.cancelledAt !== null,
    })),
    decidedAt: request.decidedAt,
    decidedByName: nameOf(names, request.decidedByUserId),
    decisionNote: request.decisionNote,
    fulfilledAt: request.fulfilledAt,
    fulfilledByName: nameOf(names, request.fulfilledByUserId),
    fulfillmentNote: request.fulfillmentNote,
    cancelledAt: request.cancelledAt,
    cancelledByName: nameOf(names, request.cancelledByUserId),
    cancelReason: request.cancelReason,
    actions: supplyRequestActions(
      { ...request, lines: items, purchaseRequestStatus: request.purchaseRequestStatus },
      ctx.actor,
    ),
  }
}

export const getSupplyRequestFor = (ctx: ServiceContext, id: string) => detailView(ctx.db, ctx, id)

const requestBody = async (tx: Database, ctx: ServiceContext, id: string) => ({
  data: await detailView(tx, ctx, id),
})

/** Talep formunun kart seçimi; öğretmen stok uçlarını okumaz, yalnız etkin kartın adını görür. */
export const listSupplyStockCardsFor = (
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) => listSupplyStockCards(ctx.db, ctx.institutionId, query)

/** Gövdedeki kart kimlikleri şemadan önce okunur; bozuk kimlik kart bulamaz, şema 400 verir. */
function rawCardIds(input: unknown): string[] {
  const raw = (input ?? {}) as Record<string, unknown>
  return Array.isArray(raw.items)
    ? raw.items.flatMap((item: unknown) => {
        const value = (item ?? {}) as Record<string, unknown>
        return typeof value.stockItemId === 'string' && UUID.test(value.stockItemId)
          ? [value.stockItemId]
          : []
      })
    : []
}

/** Yeni talep (DOM-FIN-091): açan kişi adına, onay bekler durumda; sıra kilit altında. 201. */
export function createSupplyRequestCommand(
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
      action: 'supply_request.create',
      collections: [],
      entity,
      load: async (tx) => {
        const cards = await loadStockItemsByIds(tx, ctx.institutionId, rawCardIds(input))
        const sequence = await nextSupplyRequestSequence(tx, ctx.institutionId)
        return {
          run: () => ({
            plan: planSupplyRequest(input, {
              cards: new Map(cards.map((card) => [card.id, card])),
              today: dayKey(ctx.now),
            }),
            sequence,
          }),
        }
      },
      after: async (tx, { plan, sequence }) => {
        await insertSupplyRequest(tx, ctx.institutionId, {
          id,
          sequence,
          requestedByUserId: ctx.actor.userId,
          neededDate: plan.neededDate,
          justification: plan.justification,
          items: plan.items,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'supply_request.create', entity, Object.keys(plan))
        body = await requestBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

type Transition = 'approve' | 'reject' | 'cancel'

/** Onay, ret ve iptal (DOM-FIN-091). */
export function transitionSupplyRequestCommand(
  ctx: ServiceContext,
  id: string,
  transition: Transition,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const action = `supply_request.${transition}`
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const current = await visibleRequest(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        return {
          run: (): SupplyRequestUpdate => {
            switch (transition) {
              case 'approve': {
                const { note } = planSupplyRequestApprove(current, input)
                return {
                  status: 'approved',
                  decidedAt: ctx.now,
                  decidedByUserId: ctx.actor.userId,
                  decisionNote: note,
                }
              }
              case 'reject': {
                const { reason } = planSupplyRequestReject(current, input)
                return {
                  status: 'rejected',
                  decidedAt: ctx.now,
                  decidedByUserId: ctx.actor.userId,
                  decisionNote: reason,
                }
              }
              case 'cancel': {
                const { reason } = planSupplyRequestCancel(current, input, ctx.actor)
                return {
                  status: 'cancelled',
                  cancelledAt: ctx.now,
                  cancelledByUserId: ctx.actor.userId,
                  cancelReason: reason,
                }
              }
              default:
                return transition satisfies never
            }
          },
        }
      },
      after: async (tx, changes) => {
        const saved = await updateSupplyRequest(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, action, entity, Object.keys(changes))
        body = await requestBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Karşılama (DOM-FIN-091, K-245): talep, kalemler ve seçilen depodaki hareketler kurum kilidi
 * altında yüklenir; çıkışlar, bağları ve durum tek işlemde yazılır.
 */
export function fulfillSupplyRequestCommand(
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
      action: 'supply_request.fulfill',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await visibleRequest(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const items = await loadSupplyRequestItems(tx, ctx.institutionId, [id])
        const raw = (input ?? {}) as Record<string, unknown>
        const warehouseId =
          typeof raw.warehouseId === 'string' && UUID.test(raw.warehouseId)
            ? raw.warehouseId
            : undefined
        const stock = await movementContext(
          tx,
          ctx,
          items.map((item) => item.stockItemId),
          warehouseId === undefined
            ? []
            : items.map((item) => ({ itemId: item.stockItemId, warehouseId })),
        )
        return {
          run: () =>
            planSupplyFulfillment({ ...current, lines: linesOf(items) }, input, {
              ...stock,
              today: dayKey(ctx.now),
            }),
        }
      },
      after: async (tx, plan) => {
        const issues = plan.issues.map((issue) => ({ ...issue, movementId: randomUUID() }))
        await insertStockMovements(tx, ctx.institutionId, {
          movements: issues.map((issue) => ({
            id: issue.movementId,
            itemId: issue.stockItemId,
            warehouseId: plan.warehouseId,
            type: 'supply',
            quantity: issue.quantity,
            movementDate: plan.movementDate,
            reason: null,
            note: null,
            transferId: null,
            receiptId: null,
            receiptItemId: null,
          })),
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await insertSupplyRequestIssues(tx, ctx.institutionId, {
          requestId: id,
          issues: issues.map((issue) => ({
            requestItemId: issue.requestItemId,
            stockMovementId: issue.movementId,
          })),
          now: ctx.now,
        })
        const changes: SupplyRequestUpdate =
          plan.status === 'fulfilled'
            ? {
                status: 'fulfilled',
                fulfilledAt: ctx.now,
                fulfilledByUserId: ctx.actor.userId,
                fulfillmentNote: plan.closeNote,
              }
            : {}
        // Ara karşılamada da sürüm artar: aynı okuma ile ikinci karşılama 409 alır.
        const saved = await updateSupplyRequest(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'supply_request.fulfill', entity, [
          'warehouseId',
          'movementDate',
          ...(issues.length > 0 ? ['lines'] : []),
          ...Object.keys(changes),
          ...(plan.partial ? ['close'] : []),
        ])
        for (const issue of issues)
          await auditWork(
            tx,
            ctx,
            'stock_movement.supply',
            { type: MOVEMENT_ENTITY, id: issue.movementId },
            ['itemId', 'warehouseId', 'quantity', 'movementDate'],
          )
        body = await requestBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Satın alma talebine dönüştürme (DOM-FIN-091, K-246): kalanı olan kalemler taslak satın alma
 * talebi olur (DOM-FIN-071 kuralları aynen işler), iki talep aynı işlemde bağlanır.
 */
export function convertSupplyRequestCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const purchaseId = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'supply_request.convert',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await visibleRequest(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const items = await loadSupplyRequestItems(tx, ctx.institutionId, [id])
        const raw = (input ?? {}) as Record<string, unknown>
        const text = (value: unknown) => (typeof value === 'string' ? value : '')
        const refs = await purchaseRequestRefsFor(tx, ctx, {
          costCenterId: text(raw.costCenterId),
          periodId: text(raw.periodId),
          budgetItemId: text(raw.budgetItemId),
          supplierId: typeof raw.supplierId === 'string' ? raw.supplierId : null,
          stockItemIds: items.map((item) => item.stockItemId),
        })
        const sequence = await nextPurchaseRequestSequence(tx, ctx.institutionId)
        return {
          run: () => {
            const purchaseInput = planSupplyPurchaseConversion(
              {
                ...current,
                lines: linesOf(items),
                purchaseRequestStatus: current.purchaseRequestStatus,
              },
              input,
              cardsOf(items),
            )
            return { purchase: planPurchaseRequest(purchaseInput, refs), sequence }
          },
        }
      },
      after: async (tx, { purchase, sequence }) => {
        const { items, ...fields } = purchase
        await insertPurchaseRequest(tx, ctx.institutionId, {
          ...fields,
          id: purchaseId,
          sequence,
          requestedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await replacePurchaseRequestItems(tx, ctx.institutionId, purchaseId, items, ctx.now)
        const saved = await updateSupplyRequest(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: { purchaseRequestId: purchaseId },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'purchase_request.create',
          { type: PURCHASE_ENTITY, id: purchaseId },
          [...Object.keys(purchase), 'supplyRequestId'],
        )
        await auditWork(tx, ctx, 'supply_request.convert', entity, ['purchaseRequestId'])
        body = await requestBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
