import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { INVENTORY_KEY } from './use-finance-inventory.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Stok sayımı kancaları (`/finance/stock-counts…`; DOM-FIN-081, ON-231). Sayım stok anahtarı
// altındadır: tamamlama stok miktarını ve hareket listesini değiştirir, her yazma stok anahtarının
// tamamını tazeler. Okutma ve miktar girişi `exclusive` değildir: barkod okuyucu art arda gönderir,
// her okutma kendi `Idempotency-Key`'iyle sıraya girer.

type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never

export type StockCountRow =
  operations['listStockCounts']['responses'][200]['content']['application/json']['data'][number]
export type StockCountQuery = Query<'listStockCounts'>
export type StockCountDetail =
  operations['getStockCount']['responses'][200]['content']['application/json']['data']
export type StockCountLine =
  operations['scanStockCount']['responses'][200]['content']['application/json']['data']

export const STOCK_COUNT_CHANGED_MESSAGE =
  'Sayım başka biri tarafından değiştirildi. Sayım güncellendi.'
const COUNTS_KEY = [...INVENTORY_KEY, 'counts'] as const
const MESSAGES = { version_conflict: STOCK_COUNT_CHANGED_MESSAGE }
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useStockCounts(query: StockCountQuery) {
  return useFinanceListQuery({
    key: [...COUNTS_KEY, 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/stock-counts', { params: { query }, signal }),
  })
}

export function useStockCount(countId: string) {
  return useApiQuery({
    key: [...COUNTS_KEY, 'count', countId],
    enabled: countId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/stock-counts/{countId}', {
        params: { path: { countId } },
        signal,
      }),
  })
}

/** Sayım başlatma (yalnız yönetici, K-228). */
export function useStartStockCount() {
  return useApiCommand({
    request: (
      client,
      body: { warehouseId: string; note: string | null },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/stock-counts', { params: { header: keyOnly(headers) }, body }),
    invalidates: [INVENTORY_KEY],
    exclusive: true,
  })
}

/** Okutma (K-229): kart kodu ve eklenecek miktar; `Idempotency-Key` zorunlu. */
export function useScanStockCount() {
  return useApiCommand({
    request: (
      client,
      input: { countId: string; code: string; quantity: number },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/stock-counts/{countId}/scans', {
        params: { path: { countId: input.countId }, header: keyOnly(headers) },
        body: { code: input.code, quantity: input.quantity },
      }),
    invalidates: [COUNTS_KEY],
  })
}

/** Sayılan miktarı doğrudan yazar ya da (`null`) geri alır (K-229). */
export function useSetStockCountQuantity() {
  return useApiCommand({
    request: (
      client,
      input: { countId: string; itemId: string; countedQuantity: number | null },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/stock-counts/{countId}/quantities', {
        params: { path: { countId: input.countId }, header: keyOnly(headers) },
        body: { itemId: input.itemId, countedQuantity: input.countedQuantity },
      }),
    invalidates: [COUNTS_KEY],
  })
}

/** Tamamlama (yalnız yönetici, K-230); `If-Match` sayımın sürümüdür. */
export function useCompleteStockCount() {
  return useApiCommand({
    request: (client, input: { countId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/stock-counts/{countId}/complete', {
        params: { path: { countId: input.countId }, header: versioned(headers) },
        body: {},
      }),
    invalidates: [INVENTORY_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** İptal (yalnız yönetici, K-230); `If-Match` sayımın sürümüdür. */
export function useCancelStockCount() {
  return useApiCommand({
    request: (
      client,
      input: { countId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/stock-counts/{countId}/cancel', {
        params: { path: { countId: input.countId }, header: versioned(headers) },
        body: { reason: input.reason },
      }),
    invalidates: [INVENTORY_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
