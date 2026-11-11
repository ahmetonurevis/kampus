import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { INVENTORY_KEY } from './use-finance-inventory.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Materyal seti kancaları (`/finance/material-sets…`, `/finance/material-deliveries…`;
// DOM-FIN-080, ON-232). Komutlar `exclusive`: alan hatası formda, yolsuz hata tek toast. Teslim ve
// iptal stok miktarını değiştirdiği için stok anahtarı da tazelenir.

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

export type CreateMaterialSetBody = JsonBody<'createMaterialSet'>
export type UpdateMaterialSetBody = JsonBody<'updateMaterialSet'>
export type MaterialSetRow =
  operations['listMaterialSets']['responses'][200]['content']['application/json']['data'][number]
export type MaterialSetDetail =
  operations['getMaterialSet']['responses'][200]['content']['application/json']['data']
export type MaterialSetQuery = Query<'listMaterialSets'>
export type MaterialStudentRow =
  operations['listMaterialSetStudents']['responses'][200]['content']['application/json']['data'][number]
export type MaterialStudentQuery = Query<'listMaterialSetStudents'>
export type MaterialDeliveryBody = JsonBody<'createMaterialDelivery'>
export type MaterialDelivery =
  operations['createMaterialDelivery']['responses'][201]['content']['application/json']['data']
/** Teslim ayrıntısı (iptal edilmiş dahil); teslim tutanağı PDF'inin verisi (ON-338). */
export type MaterialDeliveryDetail =
  operations['getMaterialDelivery']['responses'][200]['content']['application/json']['data']
export type MaterialRecipient =
  operations['listMaterialRecipients']['responses'][200]['content']['application/json']['data'][number]

export const MATERIAL_SET_CHANGED_MESSAGE =
  'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'
export const MATERIAL_SETS_KEY = ['finance-material-sets'] as const
const MESSAGES = { version_conflict: MATERIAL_SET_CHANGED_MESSAGE }
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useMaterialSets(query: MaterialSetQuery) {
  return useFinanceListQuery({
    key: [...MATERIAL_SETS_KEY, 'sets', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/material-sets', { params: { query }, signal }),
  })
}

export function useMaterialSet(setId: string) {
  return useApiQuery({
    key: [...MATERIAL_SETS_KEY, 'set', setId],
    enabled: setId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/material-sets/{setId}', {
        params: { path: { setId } },
        signal,
      }),
  })
}

export function useCreateMaterialSet() {
  return useApiCommand({
    request: (client, body: CreateMaterialSetBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/material-sets', { params: { header: keyOnly(headers) }, body }),
    invalidates: [MATERIAL_SETS_KEY],
    exclusive: true,
  })
}

export function useUpdateMaterialSet() {
  return useApiCommand({
    request: (
      client,
      input: { setId: string; version: number; body: UpdateMaterialSetBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/material-sets/{setId}', {
        params: { path: { setId: input.setId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [MATERIAL_SETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useMaterialStudents(setId: string, query: MaterialStudentQuery) {
  return useFinanceListQuery(
    {
      key: [...MATERIAL_SETS_KEY, 'students', setId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/material-sets/{setId}/students', {
          params: { path: { setId }, query },
          signal,
        }),
    },
    { enabled: setId !== '' },
  )
}

/** Öğrenci listesi CSV'si (`Accept: text/csv`); taze oturum ister, denetime düşer. */
export function useMaterialStudentsExport() {
  return useApiCommand({
    request: (client, input: { setId: string; query: MaterialStudentQuery }) =>
      client.GET('/api/v1/finance/material-sets/{setId}/students', {
        params: { path: { setId: input.setId }, query: input.query },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}

/** Öğrencinin teslim alabilecek kayıtlı velileri (iletişim kısıtlı veli listelenmez). */
export function useMaterialRecipients(studentId: string) {
  return useApiQuery({
    key: [...MATERIAL_SETS_KEY, 'recipients', studentId],
    enabled: studentId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/material-recipients', {
        params: { query: { studentId } },
        signal,
      }),
  })
}

/** Teslim (yönetici ve ön büro); `Idempotency-Key` zorunlu. */
export function useCreateMaterialDelivery() {
  return useApiCommand({
    request: (
      client,
      input: { setId: string; body: MaterialDeliveryBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/material-sets/{setId}/deliveries', {
        params: { path: { setId: input.setId }, header: keyOnly(headers) },
        body: input.body,
      }),
    invalidates: [MATERIAL_SETS_KEY, INVENTORY_KEY],
    exclusive: true,
  })
}

/** Teslim iptali (yalnız yönetici, K-209); `If-Match` teslimin sürümüdür. */
export function useCancelMaterialDelivery() {
  return useApiCommand({
    request: (
      client,
      input: { deliveryId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/material-deliveries/{deliveryId}/cancel', {
        params: { path: { deliveryId: input.deliveryId }, header: versioned(headers) },
        body: { reason: input.reason },
      }),
    invalidates: [MATERIAL_SETS_KEY, INVENTORY_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Kâğıt imzası sonradan getirildi (yönetici ve ön büro, K-206). */
export function useSignMaterialDelivery() {
  return useApiCommand({
    request: (client, input: { deliveryId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/material-deliveries/{deliveryId}/signature', {
        params: { path: { deliveryId: input.deliveryId }, header: versioned(headers) },
      }),
    invalidates: [MATERIAL_SETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
