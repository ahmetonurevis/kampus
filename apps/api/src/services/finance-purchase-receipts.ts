import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  createPurchaseReceiptSchema,
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
import {
  cancelReceiptStock,
  planReceiptStock,
  planReceiptStockCancellation,
  receiptStockLinks,
  writeReceiptStock,
} from './finance-inventory.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Mal kabul (DOM-FIN-074; ON-226). Kural core `lib/finance-purchase-receipts.ts`'tedir; servis kurum
 * kilidi altında siparişi, kalemlerini, bütün kabullerini ve kapalı bütçe dönemlerini yükler, kabulü
 * yazar ve sipariş durumunu kabul edilen toplamdan yeniden hesaplayıp siparişe yazar (sipariş sürümü
 * her kabulde artar). Kurum kilidi eşzamanlı iki kabulün aynı kalanı birlikte tüketmesini önler.
 * Stok kartı seçilen kalemin kabul edilen miktarı seçilen depoya giriş yazar; kabul iptali bu
 * girişleri de iptal eder (DOM-FIN-078, K-184). Rol ve modül denetimi rotadadır.
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
  stock: Awaited<ReturnType<typeof receiptStockLinks>>,
) {
  const progress = receiptProgress(items, receipts)
  const actions = purchaseReceiptActions(order, ctx.actor)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const nameOf = (userId: string | null) => (userId === null ? null : (names.get(userId) ?? null))
  const live = receipts.filter((receipt) => receipt.cancelledAt === null)
  // Tutanak numarası kayıt sırasıdır (K-216): kabuller silinmez, geriye tarihli kabul de sırayı
  // bozmaz; liste ise kabul günü sırasıyla döner.
  const sequenceOf = new Map(
    receipts
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((receipt, index) => [receipt.id, index + 1]),
  )
  const individual = order.supplierType === 'individual'
  return {
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      // Şahıs tedarikçinin TCKN'si tutanağa girmez (K-215, KVKK veri en azlığı).
      supplier: {
        name: order.supplierName,
        type: order.supplierType,
        taxOffice: individual ? null : order.supplierTaxOffice,
        taxNumber: individual ? null : order.supplierTaxNumber,
      },
      version: order.version,
    },
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
    receipts: receipts.map((receipt) => {
      const linked = receipt.lines.flatMap((line) => {
        const link = stock.get(line.id)
        return link === undefined ? [] : [link]
      })
      return {
        id: receipt.id,
        sequence: sequenceOf.get(receipt.id) ?? 0,
        receiptDate: receipt.receiptDate,
        warehouseId: linked[0]?.warehouseId ?? null,
        warehouseName: linked[0]?.warehouseName ?? null,
        receivedBy: receipt.receivedBy,
        inspectionNote: receipt.inspectionNote,
        netCents: receiptNetCents(receipt.lines, items),
        lines: receipt.lines.map((line) => {
          const item = itemById.get(line.orderItemId)
          return {
            orderItemId: line.orderItemId,
            name: item?.name ?? '',
            unit: item?.unit ?? 'piece',
            orderedQuantity: item?.quantity ?? 0,
            unitPriceCents: item?.unitPriceCents ?? 0,
            acceptedQuantity: line.acceptedQuantity,
            rejectedQuantity: line.rejectedQuantity,
            rejectReason: line.rejectReason,
            netCents: receiptNetCents([line], items),
            stockItemId: stock.get(line.id)?.stockItemId ?? null,
            stockItemName: stock.get(line.id)?.stockItemName ?? null,
          }
        }),
        createdAt: receipt.createdAt,
        createdByName: nameOf(receipt.createdByUserId),
        cancelledAt: receipt.cancelledAt,
        cancelledByName: nameOf(receipt.cancelledByUserId),
        cancelReason: receipt.cancelReason,
        actions: { cancel: actions.cancel && receipt.cancelledAt === null },
        version: receipt.version,
      }
    }),
    actions: { receive: actions.receive },
  }
}

async function board(db: Database, ctx: ServiceContext, orderId: string) {
  const { order, items, receipts } = await loadOrder(db, ctx, orderId)
  const [names, stock] = await Promise.all([
    purchaseActorNames(
      db,
      ctx.institutionId,
      receipts.flatMap((receipt) =>
        receipt.cancelledByUserId === null
          ? [receipt.createdByUserId]
          : [receipt.createdByUserId, receipt.cancelledByUserId],
      ),
    ),
    receiptStockLinks(
      db,
      ctx,
      receipts.map((receipt) => receipt.id),
    ),
  ])
  return boardView(ctx, order, items, receipts, names, stock)
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
        const parsed = createPurchaseReceiptSchema.safeParse(input)
        const stockPlan = parsed.success
          ? await planReceiptStock(
              tx,
              ctx,
              parsed.data,
              new Map(items.map((item) => [item.id, item.unit])),
            )
          : () => []
        return {
          run: () => {
            const planned = planPurchaseReceipt(input, {
              order,
              items,
              receipts,
              closedPeriods,
              today: dayKey(ctx.now),
            })
            return { order, ...planned, stock: stockPlan() }
          },
        }
      },
      after: async (tx, { order, data, status, stock }) => {
        const lineIds = await insertReceipt(tx, ctx.institutionId, {
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
          ...(stock.length === 0 ? [] : ['warehouseId', 'stockItemId']),
        ])
        await writeReceiptStock(tx, ctx, { id, receiptDate: data.receiptDate, lineIds }, stock)
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
        const stockPlan = await planReceiptStockCancellation(tx, ctx, receiptId)
        return {
          run: () => {
            const planned = planPurchaseReceiptCancel(receipt, input, {
              order,
              items,
              receipts,
              closedPeriods,
            })
            return { order, ...planned, stock: stockPlan() }
          },
        }
      },
      after: async (tx, { order, reason, status, stock }) => {
        const saved = await cancelReceipt(tx, ctx.institutionId, {
          id: receiptId,
          expectedVersion,
          cancelledByUserId: ctx.actor.userId,
          cancelReason: reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'purchase_receipt.cancel', entity, ['cancelledAt', 'cancelReason'])
        await cancelReceiptStock(tx, ctx, stock, reason)
        await writeOrderStatus(tx, ctx, order, status)
        body = { data: await board(tx, ctx, orderId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
