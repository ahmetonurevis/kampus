import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'
import { PROCUREMENT_CHANGED_MESSAGE, PROCUREMENT_KEY } from './use-finance-procurement.ts'

// Satın alma teklifi ve siparişi kancaları (`/finance/purchase-requests/:id/quotes`,
// `/finance/purchase-orders`; DOM-FIN-072, DOM-FIN-073; ON-224, ON-225). Komutlar `exclusive`: alan
// hatası formda, yolsuz hata tek toast. Her yazma satın alma anahtarının tamamını tazeler: sipariş
// teklif tablosunu kilitler, teklif seçimi sipariş düğmesini açar.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never
type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never

export type CreatePurchaseQuoteBody = JsonBody<'createPurchaseQuote'>
export type UpdatePurchaseQuoteBody = JsonBody<'updatePurchaseQuote'>
export type PurchaseQuoteBoard =
  operations['getPurchaseQuoteBoard']['responses'][200]['content']['application/json']['data']
export type PurchaseQuote = PurchaseQuoteBoard['quotes'][number]
export type PurchaseOrderRow =
  operations['listPurchaseOrders']['responses'][200]['content']['application/json']['data'][number]
export type PurchaseOrderDetail =
  operations['getPurchaseOrder']['responses'][200]['content']['application/json']['data']
export type PurchaseOrderQuery = Query<'listPurchaseOrders'>
export type PurchaseOrderTransition = 'send' | 'cancel'

const MESSAGES = { version_conflict: PROCUREMENT_CHANGED_MESSAGE }
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

// --- Teklif --------------------------------------------------------------------------------------

/** Talebin karşılaştırma tablosu; talep onaylı değilse de okunur (boş tablo). */
export function usePurchaseQuoteBoard(requestId: string, enabled = true) {
  return useApiQuery({
    key: [...PROCUREMENT_KEY, 'quotes', requestId],
    enabled: enabled && requestId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/purchase-requests/{requestId}/quotes', {
        params: { path: { requestId } },
        signal,
      }),
  })
}

export function useCreatePurchaseQuote() {
  return useApiCommand({
    request: (
      client,
      input: { requestId: string; body: CreatePurchaseQuoteBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/purchase-requests/{requestId}/quotes', {
        params: { path: { requestId: input.requestId }, header: keyOnly(headers) },
        body: input.body,
      }),
    invalidates: [PROCUREMENT_KEY],
    exclusive: true,
  })
}

export function useUpdatePurchaseQuote() {
  return useApiCommand({
    request: (
      client,
      input: { requestId: string; quoteId: string; version: number; body: UpdatePurchaseQuoteBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/purchase-requests/{requestId}/quotes/{quoteId}', {
        params: {
          path: { requestId: input.requestId, quoteId: input.quoteId },
          header: versioned(headers),
        },
        body: input.body,
      }),
    invalidates: [PROCUREMENT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Teklifi siler ya da seçer; seçim yalnız yönetici (K-136), en düşük değilse gerekçe (K-137). */
export function usePurchaseQuoteAction() {
  return useApiCommand({
    request: (
      client,
      input: {
        requestId: string
        quoteId: string
        version: number
        action: 'remove' | 'select'
        reason?: string | null
      },
      headers: CommandHeaders,
    ) => {
      const path = { requestId: input.requestId, quoteId: input.quoteId }
      const params = { path, header: versioned(headers) }
      return input.action === 'remove'
        ? client.DELETE('/api/v1/finance/purchase-requests/{requestId}/quotes/{quoteId}', {
            params,
          })
        : client.POST('/api/v1/finance/purchase-requests/{requestId}/quotes/{quoteId}/select', {
            params,
            body: { reason: input.reason ?? null },
          })
    },
    invalidates: [PROCUREMENT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

// --- Sipariş -------------------------------------------------------------------------------------

export function usePurchaseOrders(query: PurchaseOrderQuery) {
  return useFinanceListQuery({
    key: [...PROCUREMENT_KEY, 'orders', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/purchase-orders', { params: { query }, signal }),
  })
}

export function usePurchaseOrder(orderId: string) {
  return useApiQuery({
    key: [...PROCUREMENT_KEY, 'order', orderId],
    enabled: orderId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/purchase-orders/{orderId}', {
        params: { path: { orderId } },
        signal,
      }),
  })
}

/** Seçili tekliften sipariş; `Idempotency-Key` zorunlu (yinelenen tıklama ikinci sipariş açmaz). */
export function useCreatePurchaseOrder() {
  return useApiCommand({
    request: (client, body: { quoteId: string; note?: string | null }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/purchase-orders', {
        params: { header: keyOnly(headers) },
        body: { quoteId: body.quoteId, note: body.note ?? null },
      }),
    invalidates: [PROCUREMENT_KEY],
    exclusive: true,
  })
}

/** Gönderildi işareti (yönetici, ön büro) ve iptal (yönetici; K-141). */
export function useTransitionPurchaseOrder() {
  return useApiCommand({
    request: (
      client,
      input: { orderId: string; version: number; action: PurchaseOrderTransition; reason?: string },
      headers: CommandHeaders,
    ) => {
      const params = { path: { orderId: input.orderId }, header: versioned(headers) }
      return input.action === 'send'
        ? client.POST('/api/v1/finance/purchase-orders/{orderId}/send', { params })
        : client.POST('/api/v1/finance/purchase-orders/{orderId}/cancel', {
            params,
            body: { reason: input.reason ?? '' },
          })
    },
    invalidates: [PROCUREMENT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
