import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  compareQuotes,
  planPurchaseQuote,
  planPurchaseQuoteRemove,
  planPurchaseQuoteUpdate,
  planQuoteSelection,
  purchaseQuoteActions,
  quoteListActions,
  type QuoteContext,
} from '@kampus/school-core/lib/finance-purchase-quotes.ts'
import { purchaseRequestNumber } from '@kampus/school-core/lib/finance-purchase-requests.ts'

import type { Database } from '../db/client.ts'
import {
  archiveQuoteItems,
  clearQuoteSelection,
  hasActiveRequestOrder,
  insertQuote,
  loadQuotes,
  loadRequestOrders,
  replaceQuoteItems,
  updateQuote,
  type QuoteUpdate,
  type StoredQuote,
} from '../db/finance-purchase-orders.ts'
import {
  findPurchaseRequest,
  loadPurchaseRequestItems,
  purchaseActorNames,
} from '../db/finance-purchase-requests.ts'
import { loadSupplierRefs } from '../db/finance-suppliers.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Satın alma teklifi ve karşılaştırması (DOM-FIN-072; ON-224). Kural core
 * `lib/finance-purchase-quotes.ts`'tedir; servis kurum kilidi altında talebi, kalemleri, teklifleri
 * ve etkin siparişi yükler, core'a karar verdirir, aynı transaction'da yazar ve denetim kaydı
 * bırakır. Her komut karşılaştırma tablosunun tamamını döndürür. Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'purchase_quotes'

/** Talep ve teklif bağlamı; talep yoksa ya da başka kurumdaysa 404. */
async function contextOf(db: Database, ctx: ServiceContext, requestId: string) {
  const request = await findPurchaseRequest(db, ctx.institutionId, requestId)
  if (request === null) throw new NotFoundError()
  const [items, quotes, orderActive] = await Promise.all([
    loadPurchaseRequestItems(db, ctx.institutionId, requestId),
    loadQuotes(db, ctx.institutionId, requestId),
    hasActiveRequestOrder(db, ctx.institutionId, requestId),
  ])
  const context: QuoteContext = {
    request: { status: request.status },
    items: items.map(({ id, name, quantity, unit }) => ({ id, name, quantity, unit })),
    orderActive,
    today: dayKey(ctx.now),
  }
  return { request, quotes, context }
}

function quoteOf(quotes: readonly StoredQuote[], quoteId: string): StoredQuote {
  const quote = quotes.find((item) => item.id === quoteId)
  if (quote === undefined) throw new NotFoundError()
  return quote
}

/** Karşılaştırma tablosu (DOM-FIN-072): kalemler, teklifler, en düşük vurgusu ve siparişler. */
async function boardView(db: Database, ctx: ServiceContext, requestId: string) {
  const { request, quotes, context } = await contextOf(db, ctx, requestId)
  const [orders, names] = await Promise.all([
    loadRequestOrders(db, ctx.institutionId, requestId),
    purchaseActorNames(
      db,
      ctx.institutionId,
      quotes.flatMap((quote) =>
        quote.selectedByUserId === null
          ? [quote.createdByUserId]
          : [quote.createdByUserId, quote.selectedByUserId],
      ),
    ),
  ])
  const comparison = compareQuotes(
    context.items,
    quotes.map(({ id, validUntil, prices }) => ({ id, validUntil, prices })),
    context.today,
  )
  const summaries = new Map(comparison.quotes.map((summary) => [summary.quoteId, summary]))
  const nameOf = (userId: string | null) => (userId === null ? null : (names.get(userId) ?? null))
  return {
    request: {
      id: request.id,
      number: purchaseRequestNumber(request.sequence),
      status: request.status,
    },
    items: [...context.items],
    quotes: quotes.map((quote) => {
      const summary = summaries.get(quote.id)
      return {
        id: quote.id,
        supplier: {
          id: quote.supplierId,
          name: quote.supplierName,
          isActive: quote.supplierActive,
        },
        deliveryDays: quote.deliveryDays,
        validUntil: quote.validUntil,
        note: quote.note,
        expired: summary?.expired ?? false,
        lowest: summary?.lowest ?? false,
        netCents: summary?.netCents ?? 0,
        vatCents: summary?.vatCents ?? 0,
        grossCents: summary?.grossCents ?? 0,
        selected: quote.selectedAt !== null,
        selectedAt: quote.selectedAt,
        selectedByName: nameOf(quote.selectedByUserId),
        selectionReason: quote.selectionReason,
        createdByUserId: quote.createdByUserId,
        createdByName: nameOf(quote.createdByUserId),
        createdAt: quote.createdAt,
        lines: comparison.rows.flatMap((row) =>
          row.cells
            .filter((cell) => cell.quoteId === quote.id)
            .map((cell) => ({
              requestItemId: cell.requestItemId,
              unitPriceCents: cell.unitPriceCents,
              vatRate: cell.vatRate,
              netCents: cell.netCents,
              vatCents: cell.vatCents,
              grossCents: cell.grossCents,
              lowest: cell.lowest,
            })),
        ),
        actions: purchaseQuoteActions(
          { ...quote, selected: quote.selectedAt !== null },
          context,
          ctx.actor,
        ),
        version: quote.version,
      }
    }),
    lowestGrossCents: comparison.lowestGrossCents,
    orders,
    actions: quoteListActions(
      {
        ...context,
        quoteCount: quotes.length,
        hasSelection: quotes.some((quote) => quote.selectedAt !== null),
      },
      ctx.actor,
    ),
  }
}

export const getQuoteBoardFor = (ctx: ServiceContext, requestId: string) =>
  boardView(ctx.db, ctx, requestId)

const boardBody = async (tx: Database, ctx: ServiceContext, requestId: string) => ({
  data: await boardView(tx, ctx, requestId),
})

/** Gövdedeki tedarikçi kimliği şemadan önce okunur; bozuksa bağlı kayıt bulunmaz, şema 400 verir. */
const rawSupplierId = (input: unknown) => {
  const value = (input ?? {}) as Record<string, unknown>
  return typeof value.supplierId === 'string' ? value.supplierId : ''
}

/** Yeni teklif (DOM-FIN-072). 201. */
export function createQuoteCommand(
  ctx: ServiceContext,
  requestId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'purchase_quote.create',
      collections: [],
      entity,
      load: async (tx) => {
        const { quotes, context } = await contextOf(tx, ctx, requestId)
        const supplierId = rawSupplierId(input)
        const supplierRefs = await loadSupplierRefs(
          tx,
          ctx.institutionId,
          supplierId === '' ? [] : [supplierId],
        )
        return {
          run: () =>
            planPurchaseQuote(input, {
              ...context,
              supplier: supplierRefs.get(supplierId) ?? null,
              quoteCount: quotes.length,
              supplierTaken: quotes.some((quote) => quote.supplierId === supplierId),
            }),
        }
      },
      after: async (tx, plan) => {
        const { items, ...fields } = plan
        await insertQuote(tx, ctx.institutionId, {
          ...fields,
          id,
          requestId,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await replaceQuoteItems(tx, ctx.institutionId, id, items, ctx.now)
        await auditWork(tx, ctx, 'purchase_quote.create', entity, Object.keys(plan))
        body = await boardBody(tx, ctx, requestId)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Teklif düzeltmesi; seçili teklif düzeltilince seçim düşer (K-137). */
export function updateQuoteCommand(
  ctx: ServiceContext,
  requestId: string,
  quoteId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id: quoteId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'purchase_quote.update',
      collections: [],
      entity,
      load: async (tx) => {
        const { quotes, context } = await contextOf(tx, ctx, requestId)
        const quote = quoteOf(quotes, quoteId)
        if (quote.version !== expectedVersion) throw new ConflictError()
        return {
          run: () => ({
            changes: planPurchaseQuoteUpdate(quote, input, context, ctx.actor),
            selected: quote.selectedAt !== null,
          }),
        }
      },
      after: async (tx, { changes, selected }) => {
        const { items, ...fields } = changes
        const update: QuoteUpdate = selected
          ? { ...fields, selectedAt: null, selectedByUserId: null, selectionReason: null }
          : fields
        const saved = await updateQuote(tx, ctx.institutionId, {
          id: quoteId,
          expectedVersion,
          changes: update,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        if (items !== undefined)
          await replaceQuoteItems(tx, ctx.institutionId, quoteId, items, ctx.now)
        await auditWork(tx, ctx, 'purchase_quote.update', entity, Object.keys(update))
        body = await boardBody(tx, ctx, requestId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Teklif silme (arşiv); seçili teklif silinince seçim de düşer. */
export function removeQuoteCommand(
  ctx: ServiceContext,
  requestId: string,
  quoteId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id: quoteId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'purchase_quote.remove',
      collections: [],
      entity,
      load: async (tx) => {
        const { quotes, context } = await contextOf(tx, ctx, requestId)
        const quote = quoteOf(quotes, quoteId)
        if (quote.version !== expectedVersion) throw new ConflictError()
        return { run: () => planPurchaseQuoteRemove(quote, context, ctx.actor) }
      },
      after: async (tx) => {
        const saved = await updateQuote(tx, ctx.institutionId, {
          id: quoteId,
          expectedVersion,
          changes: {
            archivedAt: ctx.now,
            selectedAt: null,
            selectedByUserId: null,
            selectionReason: null,
          },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await archiveQuoteItems(tx, ctx.institutionId, quoteId, ctx.now)
        await auditWork(tx, ctx, 'purchase_quote.remove', entity, ['archivedAt'])
        body = await boardBody(tx, ctx, requestId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Teklif seçimi (K-137): önceki seçim düşer, en düşük değilse gerekçe zorunlu. */
export function selectQuoteCommand(
  ctx: ServiceContext,
  requestId: string,
  quoteId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id: quoteId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'purchase_quote.select',
      collections: [],
      entity,
      load: async (tx) => {
        const { quotes, context } = await contextOf(tx, ctx, requestId)
        const quote = quoteOf(quotes, quoteId)
        if (quote.version !== expectedVersion) throw new ConflictError()
        const comparison = compareQuotes(
          context.items,
          quotes.map(({ id, validUntil, prices }) => ({ id, validUntil, prices })),
          context.today,
        )
        return {
          run: () =>
            planQuoteSelection(input, {
              ...context,
              comparison,
              quote: {
                id: quote.id,
                validUntil: quote.validUntil,
                selected: quote.selectedAt !== null,
              },
            }),
        }
      },
      after: async (tx, { reason, lowest }) => {
        await clearQuoteSelection(tx, ctx.institutionId, requestId, ctx.now)
        const saved = await updateQuote(tx, ctx.institutionId, {
          id: quoteId,
          expectedVersion,
          changes: {
            selectedAt: ctx.now,
            selectedByUserId: ctx.actor.userId,
            selectionReason: reason,
          },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'purchase_quote.select',
          entity,
          lowest ? ['selectedAt'] : ['selectedAt', 'selectionReason'],
        )
        body = await boardBody(tx, ctx, requestId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
