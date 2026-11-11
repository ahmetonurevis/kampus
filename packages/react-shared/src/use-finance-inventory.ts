import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Stok kartı, depo ve hareket kancaları (`/finance/stock-*`; DOM-FIN-077, DOM-FIN-078; ON-228,
// ON-229). Komutlar `exclusive`: alan hatası formda, yolsuz hata tek toast. Her yazma stok
// anahtarının tamamını tazeler: hareket kartın miktarını, deponun ürün sayısını ve listeyi değiştirir.

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

export type CreateStockItemBody = JsonBody<'createStockItem'>
export type UpdateStockItemBody = JsonBody<'updateStockItem'>
export type StockItemRow =
  operations['listStockItems']['responses'][200]['content']['application/json']['data'][number]
export type StockItemDetail =
  operations['getStockItem']['responses'][200]['content']['application/json']['data']
export type StockItemQuery = Query<'listStockItems'>
export type CriticalStockRow =
  operations['listCriticalStockItems']['responses'][200]['content']['application/json']['data'][number]
export type CriticalStockQuery = Query<'listCriticalStockItems'>

export type CreateStockWarehouseBody = JsonBody<'createStockWarehouse'>
export type UpdateStockWarehouseBody = JsonBody<'updateStockWarehouse'>
export type StockWarehouseRow =
  operations['listStockWarehouses']['responses'][200]['content']['application/json']['data'][number]
export type StockWarehouseQuery = Query<'listStockWarehouses'>

export type StockMovementRow =
  operations['listStockMovements']['responses'][200]['content']['application/json']['data'][number]
export type StockMovementQuery = Query<'listStockMovements'>
export type StockEntryBody = JsonBody<'createStockEntry'>
export type StockIssueBody = JsonBody<'createStockIssue'>
export type StockTransferBody = JsonBody<'createStockTransfer'>

export const INVENTORY_CHANGED_MESSAGE =
  'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'
export const INVENTORY_KEY = ['finance-inventory'] as const
const MESSAGES = { version_conflict: INVENTORY_CHANGED_MESSAGE }
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

// --- Stok kartı ----------------------------------------------------------------------------------

export function useStockItems(query: StockItemQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INVENTORY_KEY, 'items', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/stock-items', { params: { query }, signal }),
    },
    { enabled },
  )
}

/**
 * Kritik stok listesi (DOM-FIN-079, K-200): kurum toplamı kritik seviyede ya da altında olan etkin
 * kartlar; stok anahtarı altında olduğundan her stok yazması listeyi tazeler.
 */
export function useCriticalStockItems(query: CriticalStockQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INVENTORY_KEY, 'critical', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/stock-items/critical', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useStockItem(itemId: string) {
  return useApiQuery({
    key: [...INVENTORY_KEY, 'item', itemId],
    enabled: itemId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/stock-items/{itemId}', {
        params: { path: { itemId } },
        signal,
      }),
  })
}

export function useCreateStockItem() {
  return useApiCommand({
    request: (client, body: CreateStockItemBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/stock-items', { params: { header: keyOnly(headers) }, body }),
    invalidates: [INVENTORY_KEY],
    exclusive: true,
  })
}

export function useUpdateStockItem() {
  return useApiCommand({
    request: (
      client,
      input: { itemId: string; version: number; body: UpdateStockItemBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/stock-items/{itemId}', {
        params: { path: { itemId: input.itemId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [INVENTORY_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

// --- Depo ----------------------------------------------------------------------------------------

export function useStockWarehouses(query: StockWarehouseQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INVENTORY_KEY, 'warehouses', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/stock-warehouses', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useCreateStockWarehouse() {
  return useApiCommand({
    request: (client, body: CreateStockWarehouseBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/stock-warehouses', {
        params: { header: keyOnly(headers) },
        body,
      }),
    invalidates: [INVENTORY_KEY],
    exclusive: true,
  })
}

export function useUpdateStockWarehouse() {
  return useApiCommand({
    request: (
      client,
      input: { warehouseId: string; version: number; body: UpdateStockWarehouseBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/stock-warehouses/{warehouseId}', {
        params: { path: { warehouseId: input.warehouseId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [INVENTORY_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

// --- Hareket -------------------------------------------------------------------------------------

export function useStockMovements(query: StockMovementQuery) {
  return useFinanceListQuery({
    key: [...INVENTORY_KEY, 'movements', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/stock-movements', { params: { query }, signal }),
  })
}

/** Elle giriş (yalnız yönetici); `Idempotency-Key` zorunlu. */
export function useCreateStockEntry() {
  return useApiCommand({
    request: (client, body: StockEntryBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/stock-entries', { params: { header: keyOnly(headers) }, body }),
    invalidates: [INVENTORY_KEY],
    exclusive: true,
  })
}

/** Çıkış (yönetici ve ön büro); `Idempotency-Key` zorunlu. */
export function useCreateStockIssue() {
  return useApiCommand({
    request: (client, body: StockIssueBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/stock-issues', { params: { header: keyOnly(headers) }, body }),
    invalidates: [INVENTORY_KEY],
    exclusive: true,
  })
}

/** Depolar arası transfer (yalnız yönetici); `Idempotency-Key` zorunlu. */
export function useCreateStockTransfer() {
  return useApiCommand({
    request: (client, body: StockTransferBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/stock-transfers', {
        params: { header: keyOnly(headers) },
        body,
      }),
    invalidates: [INVENTORY_KEY],
    exclusive: true,
  })
}

/** Hareket iptali (yalnız yönetici, K-183); `If-Match` hareketin sürümüdür. */
export function useCancelStockMovement() {
  return useApiCommand({
    request: (
      client,
      input: { movementId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/stock-movements/{movementId}/cancel', {
        params: { path: { movementId: input.movementId }, header: versioned(headers) },
        body: { reason: input.reason },
      }),
    invalidates: [INVENTORY_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
