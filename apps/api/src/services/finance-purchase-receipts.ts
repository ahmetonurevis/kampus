import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  planPurchaseReceipt,
  planPurchaseReceiptCancel,
  purchaseReceiptActions,
  receiptNetCents,
  receiptProgress,
} from '@kampus/school-core/lib/finance-purchase-receipts.ts'

import type { Database } from '../db/client.ts'
import {
  findPurchaseOrder,
  loadOrderItems,
  updatePurchaseOrder,
  type StoredOrder,
  type StoredOrderItem,
} from '../db/finance-purchase-orders.ts'
import {
  cancelReceipt,
  insertReceipt,
  loadClosedBudgetPeriods,
  loadOrderReceipts,
  type StoredReceipt,
} from '../db/finance-purchase-receipts.ts'
import { purchaseActorNames } from '../db/finance-purchase-requests.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Mal kabul (DOM-FIN-074; ON-226). Kural core `lib/finance-purchase-receipts.ts`'tedir; servis kurum
 * kilidi altında siparişi, kalemlerini, bütün kabullerini ve kapalı bütçe dönemlerini yükler, kabulü
 * yazar ve sipariş durumunu kabul edilen toplamdan yeniden hesaplayıp siparişe yazar (sipariş sürümü
 * her kabulde artar). Kurum kilidi eşzamanlı iki kabulün aynı kalanı birlikte tüketmesini önler.
 * Rol ve modül denetimi rotadadır.
 */

const RECEIPT = 'purchase_receipts'
const ORDER = 'purchase_orders'

async function loadOrder(db: Database, ctx: ServiceContext, orderId: string) {
  const order = await findPurchaseOrder(db, ctx.institutionId, orderId)
  if (order === null) throw new NotFoundError()
  const [itemsByOrder, receipts] = await Promise.all([
    loadOrderItems(db, ctx.institutionId, [orderId]),
    loadOrderReceipts(db, ctx.institutionId, orderId),
  ])
  return { order, items: itemsByOrder.get(orderId) ?? [], receipts }
}

function boardView(
  ctx: ServiceContext,
  order: StoredOrder,
  items: readonly StoredOrderItem[],
  receipts: readonly StoredReceipt[],
  names: ReadonlyMap<string, string>,
) {
  const progress = receiptProgress(items, receipts)
  const actions = purchaseReceiptActions(order, ctx.actor)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const nameOf = (userId: string | null) => (userId === null ? null : (names.get(userId) ?? null))
  const live = receipts.filter((receipt) => receipt.cancelledAt === null)
  return {
    order: { id: order.id, number: order.number, status: order.status, version: order.version },
    items: items.map((item) => {
      const entry = progress.get(item.id)
      return {
        id: item.id,
        position: item.position,
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        acceptedQuantity: entry?.accepted ?? 0,
        rejectedQuantity: entry?.rejected ?? 0,
        remainingQuantity: entry?.remaining ?? item.quantity,
      }
    }),
    receivedNetCents: live.reduce(
      (total, receipt) => total + receiptNetCents(receipt.lines, items),
      0,
    ),
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      receiptDate: receipt.receiptDate,
      receivedBy: receipt.receivedBy,
      inspectionNote: receipt.inspectionNote,
      netCents: receiptNetCents(receipt.lines, items),
      lines: receipt.lines.map((line) => {
        const item = itemById.get(line.orderItemId)
        return {
          orderItemId: line.orderItemId,
          name: item?.name ?? '',
          unit: item?.unit ?? 'piece',
          acceptedQuantity: line.acceptedQuantity,
          rejectedQuantity: line.rejectedQuantity,
          rejectReason: line.rejectReason,
        }
      }),
      createdAt: receipt.createdAt,
      createdByName: nameOf(receipt.createdByUserId),
      cancelledAt: receipt.cancelledAt,
      cancelledByName: nameOf(receipt.cancelledByUserId),
      cancelReason: receipt.cancelReason,
      actions: { cancel: actions.cancel && receipt.cancelledAt === null },
      version: receipt.version,
    })),
    actions: { receive: actions.receive },
  }
}

async function board(db: Database, ctx: ServiceContext, orderId: string) {
  const { order, items, receipts } = await loadOrder(db, ctx, orderId)
  const names = await purchaseActorNames(
    db,
    ctx.institutionId,
    receipts.flatMap((receipt) =>
      receipt.cancelledByUserId === null
        ? [receipt.createdByUserId]
        : [receipt.createdByUserId, receipt.cancelledByUserId],
    ),
  )
  return boardView(ctx, order, items, receipts, names)
}

export const getPurchaseReceiptBoardFor = (ctx: ServiceContext, orderId: string) =>
  board(ctx.db, ctx, orderId)

async function contextOf(tx: Database, ctx: ServiceContext, orderId: string) {
  const [loaded, closedPeriods] = await Promise.all([
    loadOrder(tx, ctx, orderId),
    loadClosedBudgetPeriods(tx, ctx.institutionId),
  ])
  return { ...loaded, closedPeriods }
}

/** Sipariş durumunu ve sürümünü yazar; durum değiştiyse denetim kaydı da düşer. */
async function writeOrderStatus(
  tx: Database,
  ctx: ServiceContext,
  order: StoredOrder,
  status: StoredOrder['status'],
) {
  const saved = await updatePurchaseOrder(tx, ctx.institutionId, {
    id: order.id,
    expectedVersion: order.version,
    changes: { status },
    now: ctx.now,
  })
  if (!saved) throw new ConflictError()
  if (status !== order.status)
    await auditWork(tx, ctx, 'purchase_order.receive', { type: ORDER, id: order.id }, ['status'])
}

/**
 * Yeni kabul (DOM-FIN-074): kalan miktar kurum kilidi altında hesaplanır; sipariş durumu aynı
 * işlemde güncellenir. `Idempotency-Key` aynı isteği tekrarlar (çift tıklama iki kabul açmaz). 201.
 */
export function createPurchaseReceiptCommand(
  ctx: ServiceContext,
  orderId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: RECEIPT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'purchase_receipt.create',
      collections: [],
      entity,
      load: async (tx) => {
        const { order, items, receipts, closedPeriods } = await contextOf(tx, ctx, orderId)
        return {
          run: () => ({
            order,
            ...planPurchaseReceipt(input, {
              order,
              items,
              receipts,
              closedPeriods,
              today: dayKey(ctx.now),
            }),
          }),
        }
      },
      after: async (tx, { order, data, status }) => {
        await insertReceipt(tx, ctx.institutionId, {
          id,
          orderId,
          receiptDate: data.receiptDate,
          receivedBy: data.receivedBy,
          inspectionNote: data.inspectionNote,
          createdByUserId: ctx.actor.userId,
          lines: data.lines,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'purchase_receipt.create', entity, [
          'orderId',
          'receiptDate',
          'receivedBy',
          'lines',
          ...(data.inspectionNote === null ? [] : ['inspectionNote']),
        ])
        await writeOrderStatus(tx, ctx, order, status)
        body = { data: await board(tx, ctx, orderId) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kabul iptali (DOM-FIN-074, K-153): gerekçeyle; sipariş durumu kalan kabullerden yeniden hesaplanır. */
export function cancelPurchaseReceiptCommand(
  ctx: ServiceContext,
  orderId: string,
  receiptId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: RECEIPT, id: receiptId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'purchase_receipt.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const { order, items, receipts, closedPeriods } = await contextOf(tx, ctx, orderId)
        const receipt = receipts.find((item) => item.id === receiptId)
        if (receipt === undefined) throw new NotFoundError()
        if (receipt.version !== expectedVersion) throw new ConflictError()
        return {
          run: () => ({
            order,
            ...planPurchaseReceiptCancel(receipt, input, { order, items, receipts, closedPeriods }),
          }),
        }
      },
      after: async (tx, { order, reason, status }) => {
        const saved = await cancelReceipt(tx, ctx.institutionId, {
          id: receiptId,
          expectedVersion,
          cancelledByUserId: ctx.actor.userId,
          cancelReason: reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'purchase_receipt.cancel', entity, ['cancelledAt', 'cancelReason'])
        await writeOrderStatus(tx, ctx, order, status)
        body = { data: await board(tx, ctx, orderId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
