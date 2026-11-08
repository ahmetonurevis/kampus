import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Demirbaş kancaları (`/finance/fixed-assets`; DOM-FIN-085, ON-235). Komutlar `exclusive`: alan
// hatası formda, yolsuz hata tek toast. Her yazma demirbaş anahtarının tamamını tazeler: kabul
// kalemine bağlanan demirbaş bağlanabilir kalem listesindeki kalan adedi de değiştirir.

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

export type CreateFixedAssetBody = JsonBody<'createFixedAsset'>
export type UpdateFixedAssetBody = JsonBody<'updateFixedAsset'>
export type ScrapFixedAssetBody = JsonBody<'scrapFixedAsset'>
export type FixedAssetRow =
  operations['listFixedAssets']['responses'][200]['content']['application/json']['data'][number]
export type FixedAssetDetail =
  operations['getFixedAsset']['responses'][200]['content']['application/json']['data']
export type FixedAssetQuery = Query<'listFixedAssets'>
export type FixedAssetReceiptItem =
  operations['listFixedAssetReceiptItems']['responses'][200]['content']['application/json']['data'][number]
export type FixedAssetReceiptItemQuery = Query<'listFixedAssetReceiptItems'>

export const FIXED_ASSETS_KEY = ['finance-fixed-assets'] as const
const MESSAGES = {
  version_conflict: 'Demirbaş başka biri tarafından değiştirildi. Liste güncellendi.',
}
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useFixedAssets(query: FixedAssetQuery) {
  return useFinanceListQuery({
    key: [...FIXED_ASSETS_KEY, 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/fixed-assets', { params: { query }, signal }),
  })
}

export function useFixedAsset(assetId: string) {
  return useApiQuery({
    key: [...FIXED_ASSETS_KEY, 'asset', assetId],
    enabled: assetId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/fixed-assets/{assetId}', {
        params: { path: { assetId } },
        signal,
      }),
  })
}

/** Bağlanabilir mal kabul kalemleri (form seçimi); kapalıyken istek atılmaz. */
export function useFixedAssetReceiptItems(query: FixedAssetReceiptItemQuery, enabled = true) {
  return useApiQuery({
    key: [...FIXED_ASSETS_KEY, 'receipt-items', query],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/fixed-assets/receipt-items', { params: { query }, signal }),
  })
}

export function useCreateFixedAsset() {
  return useApiCommand({
    request: (client, body: CreateFixedAssetBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/fixed-assets', { params: { header: keyOnly(headers) }, body }),
    invalidates: [FIXED_ASSETS_KEY],
    exclusive: true,
  })
}

export function useUpdateFixedAsset() {
  return useApiCommand({
    request: (
      client,
      input: { assetId: string; version: number; body: UpdateFixedAssetBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/fixed-assets/{assetId}', {
        params: { path: { assetId: input.assetId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useScrapFixedAsset() {
  return useApiCommand({
    request: (
      client,
      input: { assetId: string; version: number; body: ScrapFixedAssetBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/fixed-assets/{assetId}/scrap', {
        params: { path: { assetId: input.assetId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
