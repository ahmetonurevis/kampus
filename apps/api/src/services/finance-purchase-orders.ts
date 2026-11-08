import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  expectedDeliveryDate,
  planPurchaseOrder,
  planPurchaseOrderCancel,
  planPurchaseOrderSend,
  purchaseOrderActions,
  purchaseOrderAmounts,
  purchaseOrderNumber,
  purchaseOrderYear,
} from '@kampus/school-core/lib/finance-purchase-orders.ts'
import { purchaseRequestNumber } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { maskSupplierTaxNumber } from '@kampus/school-core/lib/finance-suppliers.ts'

import type { Database } from '../db/client.ts'
import {
  findPurchaseOrder,
  findQuoteRequestId,
  hasActiveRequestOrder,
  insertPurchaseOrder,
  listPurchaseOrders,
  loadOrderItems,
  loadQuotes,
  nextPurchaseOrderSequence,
  updatePurchaseOrder,
  type PurchaseOrderQuery,
  type PurchaseOrderUpdate,
  type StoredOrder,
  type StoredOrderItem,
} from '../db/finance-purchase-orders.ts'
import {
  findPurchaseRequest,
  loadPurchaseRequestItems,
  purchaseActorNames,
} from '../db/finance-purchase-requests.ts'
import { findSupplier } from '../db/finance-suppliers.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Satın alma siparişi (DOM-FIN-073; ON-225). Kural core `lib/finance-purchase-orders.ts`'tedir;
 * servis kurum kilidi altında seçili teklifi, talebi, tedarikçiyi ve etkin siparişi yükler, numarayı
 * (`SA-<yıl>-<sıra>`, K-139) verir ve siparişi kalemlerinin kopyasıyla yazar. Tedarikçiye e-posta
 * gönderilmez (IST-132 yok): "gönderildi" işareti PDF'in kurum dışından iletildiğini kaydeder (K-142).
 * Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'purchase_orders'

/** Şahıs tedarikçinin TCKN'si yalnız yöneticiye açık döner (K-141, DOM-FIN-070). */
const taxNumberFor = (ctx: ServiceContext, order: StoredOrder) =>
  ctx.actor.role === 'yonetici'
    ? order.supplierTaxNumber
    : maskSupplierTaxNumber(order.supplierType, order.supplierTaxNumber)

function amountsOf(items: readonly StoredOrderItem[]) {
  return purchaseOrderAmounts(items)
}

function summaryView(ctx: ServiceContext, order: StoredOrder, items: readonly StoredOrderItem[]) {
  const { totals } = amountsOf(items)
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    request: { id: order.requestId, number: purchaseRequestNumber(order.requestSequence) },
    supplier: { id: order.supplierId, name: order.supplierName },
    itemCount: items.length,
    ...totals,
    deliveryDays: order.deliveryDays,
    expectedDeliveryDate: expectedDeliveryDate(order),
    createdAt: order.createdAt,
    sentAt: order.sentAt,
    cancelledAt: order.cancelledAt,
    actions: purchaseOrderActions(order, ctx.actor),
    version: order.version,
  }
}

export async function listPurchaseOrdersFor(ctx: ServiceContext, query: PurchaseOrderQuery) {
  const { items, total } = await listPurchaseOrders(ctx.db, ctx.institutionId, query)
  const lines = await loadOrderItems(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.id),
  )
  return {
    items: items.map((order) => summaryView(ctx, order, lines.get(order.id) ?? [])),
    total,
  }
}

async function detailView(db: Database, ctx: ServiceContext, id: string) {
  const order = await findPurchaseOrder(db, ctx.institutionId, id)
  if (order === null) throw new NotFoundError()
  const [itemsByOrder, names] = await Promise.all([
    loadOrderItems(db, ctx.institutionId, [id]),
    purchaseActorNames(
      db,
      ctx.institutionId,
      [order.createdByUserId, order.sentByUserId, order.cancelledByUserId].filter(
        (value): value is string => value !== null,
      ),
    ),
  ])
  const items = itemsByOrder.get(id) ?? []
  const { lines } = amountsOf(items)
  const nameOf = (userId: string | null) => (userId === null ? null : (names.get(userId) ?? null))
  return {
    ...summaryView(ctx, order, items),
    quoteId: order.quoteId,
    supplier: {
      id: order.supplierId,
      name: order.supplierName,
      type: order.supplierType,
      taxNumber: taxNumberFor(ctx, order),
      taxOffice: order.supplierTaxOffice,
    },
    note: order.note,
    items: items.map((item, index) => {
      const line = lines[index]
      return {
        id: item.id,
        position: item.position,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        unitPriceCents: item.unitPriceCents,
        vatRate: item.vatRate,
        netCents: line?.netCents ?? 0,
        vatCents: line?.vatCents ?? 0,
        grossCents: line?.grossCents ?? 0,
      }
    }),
    createdByName: nameOf(order.createdByUserId),
    sentByName: nameOf(order.sentByUserId),
    cancelledByName: nameOf(order.cancelledByUserId),
    cancelReason: order.cancelReason,
  }
}

export const getPurchaseOrderFor = (ctx: ServiceContext, id: string) => detailView(ctx.db, ctx, id)

const orderBody = async (tx: Database, ctx: ServiceContext, id: string) => ({
  data: await detailView(tx, ctx, id),
})

/** Teklif kimliği şemadan önce okunur; bozuksa teklif bulunmaz, şema 400 verir. */
const rawQuoteId = (input: unknown) => {
  const value = (input ?? {}) as Record<string, unknown>
  return typeof value.quoteId === 'string' ? value.quoteId : ''
}

/** Kurumun teklifini kimlikle bulur (talep bilinmeden); yoksa `null`. */
async function quoteById(tx: Database, ctx: ServiceContext, quoteId: string) {
  const requestId = await findQuoteRequestId(tx, ctx.institutionId, quoteId)
  if (requestId === null) return null
  const quotes = await loadQuotes(tx, ctx.institutionId, requestId)
  return quotes.find((quote) => quote.id === quoteId) ?? null
}

/**
 * Seçili tekliften sipariş (DOM-FIN-073): numara kurum kilidi altında verilir, kalemler ve tedarikçi
 * açılış anının kopyasıdır. `Idempotency-Key` aynı isteği tekrarlar. 201.
 */
export function createPurchaseOrderCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  const year = purchaseOrderYear(ctx.now)
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'purchase_order.create',
      collections: [],
      entity,
      load: async (tx) => {
        const quote = await quoteById(tx, ctx, rawQuoteId(input))
        const [request, items, supplier, orderActive, sequence] = await Promise.all([
          quote === null ? null : findPurchaseRequest(tx, ctx.institutionId, quote.requestId),
          quote === null ? [] : loadPurchaseRequestItems(tx, ctx.institutionId, quote.requestId),
          quote === null ? null : findSupplier(tx, ctx.institutionId, quote.supplierId),
          quote === null ? false : hasActiveRequestOrder(tx, ctx.institutionId, quote.requestId),
          nextPurchaseOrderSequence(tx, ctx.institutionId, year),
        ])
        return {
          run: () => {
            const plan = planPurchaseOrder(input, {
              request: { status: request?.status ?? 'draft' },
              quote:
                quote === null
                  ? null
                  : { selected: quote.selectedAt !== null, validUntil: quote.validUntil },
              supplier,
              orderActive,
              today: dayKey(ctx.now),
            })
            // planPurchaseOrder teklif, talep ve tedarikçinin varlığını denetledi.
            if (quote === null || request === null || supplier === null) throw new NotFoundError()
            const prices = new Map(quote.prices.map((price) => [price.requestItemId, price]))
            const lines = items.map((item) => {
              const price = prices.get(item.id)
              if (price === undefined) throw new ConflictError()
              return {
                requestItemId: item.id,
                name: item.name,
                quantity: item.quantity,
                unit: item.unit,
                unitPriceCents: price.unitPriceCents,
                vatRate: price.vatRate,
              }
            })
            return { plan, quote, supplier, lines, sequence }
          },
        }
      },
      after: async (tx, { plan, quote, supplier, lines, sequence }) => {
        await insertPurchaseOrder(tx, ctx.institutionId, {
          id,
          number: purchaseOrderNumber(year, sequence),
          numberYear: year,
          numberSequence: sequence,
          requestId: quote.requestId,
          quoteId: quote.id,
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierType: supplier.type,
          supplierTaxNumber: supplier.taxNumber,
          supplierTaxOffice: supplier.taxOffice,
          deliveryDays: quote.deliveryDays,
          note: plan.note,
          createdByUserId: ctx.actor.userId,
          items: lines,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'purchase_order.create', entity, [
          'requestId',
          'quoteId',
          'supplierId',
          'number',
          'items',
          ...(plan.note === null ? [] : ['note']),
        ])
        body = await orderBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

type Transition = 'send' | 'cancel'

/** Gönderildi işareti ve iptal (DOM-FIN-073). */
export function transitionPurchaseOrderCommand(
  ctx: ServiceContext,
  id: string,
  transition: Transition,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const action = `purchase_order.${transition}`
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const order = await findPurchaseOrder(tx, ctx.institutionId, id)
        if (order === null) throw new NotFoundError()
        if (order.version !== expectedVersion) throw new ConflictError()
        return {
          run: (): PurchaseOrderUpdate => {
            switch (transition) {
              case 'send':
                planPurchaseOrderSend(order)
                return { status: 'sent', sentAt: ctx.now, sentByUserId: ctx.actor.userId }
              case 'cancel': {
                const { reason } = planPurchaseOrderCancel(order, input)
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
        const saved = await updatePurchaseOrder(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, action, entity, Object.keys(changes))
        body = await orderBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
