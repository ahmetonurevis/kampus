import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { INVENTORY_KEY } from './use-finance-inventory.ts'
import { PROCUREMENT_CHANGED_MESSAGE, PROCUREMENT_KEY } from './use-finance-procurement.ts'

// Mal kabul kancaları (`/finance/purchase-orders/:orderId/receipts`; DOM-FIN-074, ON-226). Komutlar
// `exclusive`: alan hatası formda, yolsuz hata tek toast. Her yazma satın alma anahtarının tamamını
// tazeler: kabul sipariş durumunu, sipariş listesini ve talebin bütçe kalanını değiştirir; stok kartı
// seçilen kabul ve kabul iptali stok miktarını da değiştirir (K-184).

export type CreatePurchaseReceiptBody = NonNullable<
  operations['createPurchaseReceipt']['requestBody']
>['content']['application/json']
export type PurchaseReceiptBoard =
  operations['getPurchaseReceiptBoard']['responses'][200]['content']['application/json']['data']
export type PurchaseReceipt = PurchaseReceiptBoard['receipts'][number]

/** Siparişin kalem teslim durumu ve kabul geçmişi. */
export function usePurchaseReceiptBoard(orderId: string, enabled = true) {
  return useApiQuery({
    key: [...PROCUREMENT_KEY, 'receipts', orderId],
    enabled: enabled && orderId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/purchase-orders/{orderId}/receipts', {
        params: { path: { orderId } },
        signal,
      }),
  })
}

/** Yeni kabul; `Idempotency-Key` zorunlu (yinelenen tıklama ikinci kabul açmaz). */
export function useCreatePurchaseReceipt() {
  return useApiCommand({
    request: (
      client,
      input: { orderId: string; body: CreatePurchaseReceiptBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/purchase-orders/{orderId}/receipts', {
        params: {
          path: { orderId: input.orderId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [PROCUREMENT_KEY, INVENTORY_KEY],
    exclusive: true,
  })
}

/** Kabul iptali (yalnız yönetici, K-153); `If-Match` kabulün sürümüdür. */
export function useCancelPurchaseReceipt() {
  return useApiCommand({
    request: (
      client,
      input: { orderId: string; receiptId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/purchase-orders/{orderId}/receipts/{receiptId}/cancel', {
        params: {
          path: { orderId: input.orderId, receiptId: input.receiptId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { reason: input.reason },
      }),
    invalidates: [PROCUREMENT_KEY, INVENTORY_KEY],
    version: (input) => input.version,
    messages: { version_conflict: PROCUREMENT_CHANGED_MESSAGE },
    exclusive: true,
  })
}
