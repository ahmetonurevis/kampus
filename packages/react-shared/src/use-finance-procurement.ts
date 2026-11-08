import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Tedarikçi ve satın alma talebi kancaları (`/finance/suppliers`, `/finance/purchase-requests`;
// DOM-FIN-070, DOM-FIN-071; ON-221, ON-222). Komutlar `exclusive`: alan hatası formda, yolsuz hata
// tek toast. Her yazma satın alma anahtarının tamamını tazeler: tedarikçi adı talep listesinde de
// görünür, talep geçişi aynı satırdaki öteki taleplerin bütçe kalanını değiştirir.

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

export type CreateSupplierBody = JsonBody<'createSupplier'>
export type UpdateSupplierBody = JsonBody<'updateSupplier'>
export type SupplierRow =
  operations['listSuppliers']['responses'][200]['content']['application/json']['data'][number]
export type SupplierDetail =
  operations['getSupplier']['responses'][200]['content']['application/json']['data']
export type SupplierQuery = Query<'listSuppliers'>

export type CreatePurchaseRequestBody = JsonBody<'createPurchaseRequest'>
export type UpdatePurchaseRequestBody = JsonBody<'updatePurchaseRequest'>
export type PurchaseRequestRow =
  operations['listPurchaseRequests']['responses'][200]['content']['application/json']['data'][number]
export type PurchaseRequestDetail =
  operations['getPurchaseRequest']['responses'][200]['content']['application/json']['data']
export type PurchaseRequestOptions =
  operations['getPurchaseRequestOptions']['responses'][200]['content']['application/json']['data']
export type PurchaseRequestQuery = Query<'listPurchaseRequests'>
export type PurchaseRequestTransition = 'submit' | 'approve' | 'reject' | 'cancel'

export const PROCUREMENT_CHANGED_MESSAGE =
  'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'
export const PROCUREMENT_KEY = ['finance-procurement'] as const
const MESSAGES = { version_conflict: PROCUREMENT_CHANGED_MESSAGE }
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

// --- Tedarikçi -----------------------------------------------------------------------------------

export function useSuppliers(query: SupplierQuery) {
  return useFinanceListQuery({
    key: [...PROCUREMENT_KEY, 'suppliers', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/suppliers', { params: { query }, signal }),
  })
}

/** Ayrıntı yalnız yöneticide (tam vergi numarası ve IBAN; K-126). */
export function useSupplier(supplierId: string) {
  return useApiQuery({
    key: [...PROCUREMENT_KEY, 'supplier', supplierId],
    enabled: supplierId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/suppliers/{supplierId}', {
        params: { path: { supplierId } },
        signal,
      }),
  })
}

export function useCreateSupplier() {
  return useApiCommand({
    request: (client, body: CreateSupplierBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/suppliers', { params: { header: keyOnly(headers) }, body }),
    invalidates: [PROCUREMENT_KEY],
    exclusive: true,
  })
}

export function useUpdateSupplier() {
  return useApiCommand({
    request: (
      client,
      input: { supplierId: string; version: number; body: UpdateSupplierBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/suppliers/{supplierId}', {
        params: { path: { supplierId: input.supplierId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [PROCUREMENT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

// --- Satın alma talebi ---------------------------------------------------------------------------

export function usePurchaseRequests(query: PurchaseRequestQuery) {
  return useFinanceListQuery({
    key: [...PROCUREMENT_KEY, 'requests', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/purchase-requests', { params: { query }, signal }),
  })
}

export function usePurchaseRequest(requestId: string) {
  return useApiQuery({
    key: [...PROCUREMENT_KEY, 'request', requestId],
    enabled: requestId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/purchase-requests/{requestId}', {
        params: { path: { requestId } },
        signal,
      }),
  })
}

export function usePurchaseRequestOptions(enabled = true) {
  return useApiQuery({
    key: [...PROCUREMENT_KEY, 'request-options'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/purchase-requests/options', { signal }),
  })
}

export function useCreatePurchaseRequest() {
  return useApiCommand({
    request: (client, body: CreatePurchaseRequestBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/purchase-requests', {
        params: { header: keyOnly(headers) },
        body,
      }),
    invalidates: [PROCUREMENT_KEY],
    exclusive: true,
  })
}

export function useUpdatePurchaseRequest() {
  return useApiCommand({
    request: (
      client,
      input: { requestId: string; version: number; body: UpdatePurchaseRequestBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/purchase-requests/{requestId}', {
        params: { path: { requestId: input.requestId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [PROCUREMENT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Gönder, onayla, reddet, iptal et; onay ve ret yalnız yönetici (K-129). */
export function useTransitionPurchaseRequest() {
  return useApiCommand({
    request: (
      client,
      input: {
        requestId: string
        version: number
        action: PurchaseRequestTransition
        note?: string | null
        reason?: string
      },
      headers: CommandHeaders,
    ) => {
      const params = { path: { requestId: input.requestId }, header: versioned(headers) }
      switch (input.action) {
        case 'submit':
          return client.POST('/api/v1/finance/purchase-requests/{requestId}/submit', { params })
        case 'approve':
          return client.POST('/api/v1/finance/purchase-requests/{requestId}/approve', {
            params,
            body: { note: input.note ?? null },
          })
        case 'reject':
          return client.POST('/api/v1/finance/purchase-requests/{requestId}/reject', {
            params,
            body: { reason: input.reason ?? '' },
          })
        case 'cancel':
          return client.POST('/api/v1/finance/purchase-requests/{requestId}/cancel', {
            params,
            body: { reason: input.reason ?? '' },
          })
        default:
          return input.action satisfies never
      }
    },
    invalidates: [PROCUREMENT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
