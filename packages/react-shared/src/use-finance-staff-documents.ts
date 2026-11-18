import type { operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import type { CommandHeaders } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Personel özlük belgesi kancaları (`/finance/staff-document*`; DOM-FIN-113, ON-173). Özel
// nitelikli belgenin dosyası yalnız yöneticide açılır ve her açılış denetime düşer (K-374); bu
// yüzden bağlantı önceden değil, kullanıcı "Aç" deyince istenir. Her yazma anahtarın tamamını tazeler.

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
type Ok<TOperation extends keyof operations> = operations[TOperation]['responses'] extends {
  200: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type CreateStaffDocumentBody = JsonBody<'createStaffDocument'>
export type UpdateStaffDocumentTypesBody = JsonBody<'updateStaffDocumentTypes'>
export type StaffDocumentTypeSettingRow = Ok<'getStaffDocumentTypes'>['data'][number]
export type StaffDocumentDetail = Ok<'getStaffDocuments'>['data']
export type StaffDocument = StaffDocumentDetail['documents'][number]
export type StaffDocumentRow = Ok<'listStaffDocuments'>['data'][number]
export type StaffDocumentStaffRow = Ok<'listStaffDocumentStaff'>['data'][number]
export type StaffDocumentQuery = Query<'listStaffDocuments'>
export type StaffDocumentStaffQuery = Query<'listStaffDocumentStaff'>
export type StaffDocumentAlerts = Ok<'getStaffDocumentAlerts'>['data']

export const STAFF_DOCUMENTS_KEY = ['finance', 'staff-documents'] as const

export function useStaffDocumentTypes(enabled = true) {
  return useApiQuery({
    key: [...STAFF_DOCUMENTS_KEY, 'types'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/staff-document-types', { signal }),
  })
}

export function useStaffDocumentAlerts(enabled = true) {
  return useApiQuery({
    key: [...STAFF_DOCUMENTS_KEY, 'alerts'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/staff-document-alerts', { signal }),
  })
}

export function useStaffDocuments(query: StaffDocumentQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_DOCUMENTS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/staff-documents', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useStaffDocumentStaff(query: StaffDocumentStaffQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_DOCUMENTS_KEY, 'staff', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/staff-document-staff', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Personelin bütün belgeleri (geçmiş dahil) ve eksik zorunlu türleri. */
export function useStaffDocumentDetail(membershipId: string, enabled = true) {
  return useApiQuery({
    key: [...STAFF_DOCUMENTS_KEY, 'detail', membershipId],
    enabled: enabled && membershipId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/staff-document-staff/{membershipId}', {
        params: { path: { membershipId } },
        signal,
      }),
  })
}

export function useCreateStaffDocument() {
  return useApiCommand({
    request: (client, body: CreateStaffDocumentBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-documents', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_DOCUMENTS_KEY],
    exclusive: true,
  })
}

export function useUpdateStaffDocumentTypes() {
  return useApiCommand({
    request: (client, body: UpdateStaffDocumentTypesBody, headers: CommandHeaders) =>
      client.PATCH('/api/v1/finance/staff-document-types', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_DOCUMENTS_KEY],
    exclusive: true,
  })
}

/**
 * Belgenin dosyası için imzalı bağlantıyı isteyen işlev (her istek denetim kaydıdır); hata
 * `ApiError` olarak fırlar.
 */
export function useStaffDocumentFileUrlFetcher() {
  const client = useKampusClient()
  return async (documentId: string) => {
    const body = await runRequest(() =>
      client.GET('/api/v1/finance/staff-documents/{documentId}/file-url', {
        params: { path: { documentId } },
      }),
    )
    return body.data
  }
}
