import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { INVENTORY_CHANGED_MESSAGE, INVENTORY_KEY } from './use-finance-inventory.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Laboratuvar kimyasal envanteri kancaları (DOM-FIN-090; ON-234). Partiler ve rapor stok anahtarı
// altındadır: her stok yazması (giriş, çıkış, transfer, iptal) parti miktarını değiştirir.

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

export type CreateChemicalProfileBody = JsonBody<'createStockChemicalProfile'>
export type UpdateChemicalProfileBody = JsonBody<'updateStockChemicalProfile'>
export type ChemicalLotRow =
  operations['listChemicalLots']['responses'][200]['content']['application/json']['data'][number]
export type ChemicalLotQuery = Query<'listChemicalLots'>
export type ChemicalInventoryRow =
  operations['getChemicalInventory']['responses'][200]['content']['application/json']['data'][number]
export type ChemicalInventoryQuery = Query<'getChemicalInventory'>

const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })

/** Kartı kimyasal olarak işaretler (yalnız yönetici, K-240). */
export function useCreateChemicalProfile() {
  return useApiCommand({
    request: (
      client,
      input: { itemId: string; body: CreateChemicalProfileBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/stock-items/{itemId}/chemical-profile', {
        params: { path: { itemId: input.itemId }, header: keyOnly(headers) },
        body: input.body,
      }),
    invalidates: [INVENTORY_KEY],
    exclusive: true,
  })
}

/** Kimyasal bilgisi düzeltmesi; `If-Match` kimyasal bilgisinin sürümüdür. */
export function useUpdateChemicalProfile() {
  return useApiCommand({
    request: (
      client,
      input: { itemId: string; version: number; body: UpdateChemicalProfileBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/stock-items/{itemId}/chemical-profile', {
        params: {
          path: { itemId: input.itemId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [INVENTORY_KEY],
    version: (input) => input.version,
    messages: { version_conflict: INVENTORY_CHANGED_MESSAGE },
    exclusive: true,
  })
}

/** Stoktaki kimyasal partiler; `status: 'attention'` son kullanma uyarı listesidir (K-243). */
export function useChemicalLots(query: ChemicalLotQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INVENTORY_KEY, 'chemical-lots', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/chemical-lots', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Kimyasal envanter raporu (depo × kimyasal, partileriyle). */
export function useChemicalInventory(query: ChemicalInventoryQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INVENTORY_KEY, 'chemical-inventory', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/chemical-inventory', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Raporun CSV'si (`Accept: text/csv`); kişi verisi yoktur, sorgu tazelenmez. */
export function useChemicalInventoryExport() {
  return useApiCommand({
    request: (client, query: ChemicalInventoryQuery) =>
      client.GET('/api/v1/finance/chemical-inventory', {
        params: { query },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}
