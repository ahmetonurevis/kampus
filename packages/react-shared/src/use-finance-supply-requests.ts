import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { INVENTORY_KEY } from './use-finance-inventory.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'
import { PROCUREMENT_KEY } from './use-finance-procurement.ts'

// Sarf malzeme talebi kancaları (`/finance/supply-requests…`; DOM-FIN-091, ON-233). Web finans
// ekranı (yönetici, ön büro) ve öğretmen ekranı aynı kancaları kullanır: öğretmen listede yalnız
// kendi taleplerini görür, açar ve onaydan önce iptal eder; onay, ret, karşılama ve dönüştürme
// yönetici ve ön büro içindir (sunucu rolü ayrıca denetler). Komutlar `exclusive`: alan hatası
// formda, yolsuz hata tek toast. Karşılama stok miktarını, dönüştürme satın alma taleplerini
// değiştirdiği için o anahtarlar da tazelenir.

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

export type CreateSupplyRequestBody = JsonBody<'createSupplyRequest'>
export type FulfillSupplyRequestBody = JsonBody<'fulfillSupplyRequest'>
export type ConvertSupplyRequestBody = JsonBody<'convertSupplyRequest'>
export type SupplyRequestRow =
  operations['listSupplyRequests']['responses'][200]['content']['application/json']['data'][number]
export type SupplyRequestDetail =
  operations['getSupplyRequest']['responses'][200]['content']['application/json']['data']
export type SupplyRequestQuery = Query<'listSupplyRequests'>
export type SupplyStockCard =
  operations['listSupplyStockItems']['responses'][200]['content']['application/json']['data'][number]
export type SupplyStockCardQuery = Query<'listSupplyStockItems'>
export type SupplyRequestTransition = 'approve' | 'reject' | 'cancel'

export const SUPPLY_REQUEST_CHANGED_MESSAGE =
  'Talep başka biri tarafından değiştirildi. Liste güncellendi.'
export const SUPPLY_REQUESTS_KEY = ['finance-supply-requests'] as const
const MESSAGES = { version_conflict: SUPPLY_REQUEST_CHANGED_MESSAGE }
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

/** Talepler; öğretmen yalnız kendininkileri alır, yönetici ve ön büro `mine` ile daraltır. */
export function useSupplyRequests(query: SupplyRequestQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...SUPPLY_REQUESTS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/supply-requests', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useSupplyRequest(requestId: string) {
  return useApiQuery({
    key: [...SUPPLY_REQUESTS_KEY, 'detail', requestId],
    enabled: requestId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/supply-requests/{requestId}', {
        params: { path: { requestId } },
        signal,
      }),
  })
}

/** Talep formunun etkin stok kartları (kod, ad, birim; miktar yok). */
export function useSupplyStockCards(query: SupplyStockCardQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...SUPPLY_REQUESTS_KEY, 'stock-cards', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/supply-requests/stock-items', {
          params: { query },
          signal,
        }),
    },
    { enabled },
  )
}

/** Talep aç (açan kişi adına); `Idempotency-Key` zorunlu. */
export function useCreateSupplyRequest() {
  return useApiCommand({
    request: (client, body: CreateSupplyRequestBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/supply-requests', {
        params: { header: keyOnly(headers) },
        body,
      }),
    invalidates: [SUPPLY_REQUESTS_KEY],
    exclusive: true,
  })
}

/** Onay, ret (yönetici) ve iptal (talep eden, onaydan önce). */
export function useTransitionSupplyRequest() {
  return useApiCommand({
    request: (
      client,
      input: {
        requestId: string
        version: number
        action: SupplyRequestTransition
        note?: string | null
        reason?: string
      },
      headers: CommandHeaders,
    ) => {
      const params = { path: { requestId: input.requestId }, header: versioned(headers) }
      switch (input.action) {
        case 'approve':
          return client.POST('/api/v1/finance/supply-requests/{requestId}/approve', {
            params,
            body: { note: input.note ?? null },
          })
        case 'reject':
          return client.POST('/api/v1/finance/supply-requests/{requestId}/reject', {
            params,
            body: { reason: input.reason ?? '' },
          })
        case 'cancel':
          return client.POST('/api/v1/finance/supply-requests/{requestId}/cancel', {
            params,
            body: { reason: input.reason ?? '' },
          })
        default:
          return input.action satisfies never
      }
    },
    invalidates: [SUPPLY_REQUESTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Depodan karşılama (yönetici, ön büro); stok çıkışı yazdığı için stok anahtarı da tazelenir. */
export function useFulfillSupplyRequest() {
  return useApiCommand({
    request: (
      client,
      input: { requestId: string; version: number; body: FulfillSupplyRequestBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/supply-requests/{requestId}/fulfill', {
        params: { path: { requestId: input.requestId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [SUPPLY_REQUESTS_KEY, INVENTORY_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Kalanı satın alma talebine dönüştür (yönetici, ön büro); satın alma listesi de tazelenir. */
export function useConvertSupplyRequest() {
  return useApiCommand({
    request: (
      client,
      input: { requestId: string; version: number; body: ConvertSupplyRequestBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/supply-requests/{requestId}/convert', {
        params: { path: { requestId: input.requestId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [SUPPLY_REQUESTS_KEY, PROCUREMENT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
