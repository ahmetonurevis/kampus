import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { FIXED_ASSETS_KEY } from './use-finance-fixed-assets.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Demirbaş sayımı kancaları (`/finance/fixed-asset-counts`; DOM-FIN-087, ON-237). Anahtarlar
// demirbaş anahtarının altındadır. Okutma yalnız sayım anahtarını tazeler (demirbaş kaydı
// değişmez); tamamlama ayrıntıdaki "son sayım"ı, konum düzeltmesi demirbaşın yerini değiştirdiği
// için demirbaş anahtarının tamamını tazeler. Komutlar `exclusive`.

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

export type StartFixedAssetCountBody = JsonBody<'startFixedAssetCount'>
export type ScanFixedAssetCountBody = JsonBody<'scanFixedAssetCount'>
export type FixedAssetCount =
  operations['getFixedAssetCount']['responses'][200]['content']['application/json']['data']
export type FixedAssetCountQuery = Query<'listFixedAssetCounts'>
export type FixedAssetCountItem =
  operations['listFixedAssetCountItems']['responses'][200]['content']['application/json']['data'][number]
export type FixedAssetCountItemQuery = Query<'listFixedAssetCountItems'>
export type FixedAssetScan =
  operations['scanFixedAssetCount']['responses'][200]['content']['application/json']['data']
export type FixedAssetPlace =
  operations['listFixedAssetPlaces']['responses'][200]['content']['application/json']['data'][number]
export type FixedAssetPlaceQuery = Query<'listFixedAssetPlaces'>

export const FIXED_ASSET_COUNTS_KEY = [...FIXED_ASSETS_KEY, 'counts'] as const
const MESSAGES = {
  version_conflict: 'Sayım başka biri tarafından değiştirildi. Liste güncellendi.',
}
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useFixedAssetCounts(query: FixedAssetCountQuery) {
  return useFinanceListQuery({
    key: [...FIXED_ASSET_COUNTS_KEY, 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/fixed-asset-counts', { params: { query }, signal }),
  })
}

export function useFixedAssetCount(countId: string) {
  return useApiQuery({
    key: [...FIXED_ASSET_COUNTS_KEY, 'count', countId],
    enabled: countId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/fixed-asset-counts/{countId}', {
        params: { path: { countId } },
        signal,
      }),
  })
}

export function useFixedAssetCountItems(countId: string, query: FixedAssetCountItemQuery) {
  return useFinanceListQuery(
    {
      key: [...FIXED_ASSET_COUNTS_KEY, 'items', countId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/fixed-asset-counts/{countId}/items', {
          params: { path: { countId }, query },
          signal,
        }),
    },
    { enabled: countId !== '' },
  )
}

/** Demirbaşların bulunduğu yerler (kapsam ve sayılan oda önerisi); kapalıyken istek atılmaz. */
export function useFixedAssetPlaces(query: FixedAssetPlaceQuery, enabled = true) {
  return useApiQuery({
    key: [...FIXED_ASSET_COUNTS_KEY, 'places', query],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/fixed-asset-places', { params: { query }, signal }),
  })
}

export function useStartFixedAssetCount() {
  return useApiCommand({
    request: (client, body: StartFixedAssetCountBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/fixed-asset-counts', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [FIXED_ASSET_COUNTS_KEY],
    exclusive: true,
  })
}

export function useScanFixedAssetCount() {
  return useApiCommand({
    request: (
      client,
      input: { countId: string; body: ScanFixedAssetCountBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/fixed-asset-counts/{countId}/scans', {
        params: {
          path: { countId: input.countId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [FIXED_ASSET_COUNTS_KEY],
    exclusive: true,
  })
}

function useCloseFixedAssetCount(verb: 'complete' | 'cancel') {
  return useApiCommand({
    request: (client, input: { countId: string; version: number }, headers: CommandHeaders) =>
      verb === 'complete'
        ? client.POST('/api/v1/finance/fixed-asset-counts/{countId}/complete', {
            params: { path: { countId: input.countId }, header: versioned(headers) },
            body: {},
          })
        : client.POST('/api/v1/finance/fixed-asset-counts/{countId}/cancel', {
            params: { path: { countId: input.countId }, header: versioned(headers) },
            body: {},
          }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export const useCompleteFixedAssetCount = () => useCloseFixedAssetCount('complete')
export const useCancelFixedAssetCount = () => useCloseFixedAssetCount('cancel')

export function useRelocateFixedAssetCountItem() {
  return useApiCommand({
    request: (
      client,
      input: { countId: string; itemId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/fixed-asset-counts/{countId}/items/{itemId}/relocate', {
        params: {
          path: { countId: input.countId, itemId: input.itemId },
          header: versioned(headers),
        },
        body: {},
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: {
      version_conflict: 'Sayım satırı başka biri tarafından değiştirildi. Liste güncellendi.',
    },
    exclusive: true,
  })
}
