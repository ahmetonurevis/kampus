import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Mezun belge talebi kancaları (`/prospects/alumni-document-requests…`; DOM-KAY-044, ON-260). Web
// Kayıt İşlemleri ekranı (yönetici, ön büro) kullanır. Komutlar `exclusive`: alan hatası formda,
// yolsuz hata tek toast. Ücret ayarı yalnız yöneticidedir (sunucu rolü ayrıca denetler).

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

export type CreateAlumniRequestBody = JsonBody<'createAlumniDocumentRequest'>
export type AlumniReadyBody = NonNullable<JsonBody<'markAlumniDocumentReady'>>
export type AlumniDeliverBody = JsonBody<'deliverAlumniDocument'>
export type UpdateAlumniFeesBody = JsonBody<'updateAlumniDocumentFees'>
export type AlumniRequestRow =
  operations['listAlumniDocumentRequests']['responses'][200]['content']['application/json']['data'][number]
export type AlumniRequestQuery = Query<'listAlumniDocumentRequests'>
export type AlumniStudent =
  operations['listAlumniDocumentStudents']['responses'][200]['content']['application/json']['data'][number]
export type AlumniStudentQuery = Query<'listAlumniDocumentStudents'>
export type AlumniFees =
  operations['getAlumniDocumentFees']['responses'][200]['content']['application/json']['data']
export type AlumniDocumentData =
  operations['getAlumniDocument']['responses'][200]['content']['application/json']['data']

export const ALUMNI_REQUESTS_KEY = ['alumni-document-requests'] as const
export const ALUMNI_REQUEST_CHANGED_MESSAGE =
  'Talep başka biri tarafından değiştirildi. Liste güncellendi.'
const MESSAGES = { version_conflict: ALUMNI_REQUEST_CHANGED_MESSAGE }
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useAlumniRequests(query: AlumniRequestQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...ALUMNI_REQUESTS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/prospects/alumni-document-requests', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useAlumniRequest(requestId: string) {
  return useApiQuery({
    key: [...ALUMNI_REQUESTS_KEY, 'detail', requestId],
    enabled: requestId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/prospects/alumni-document-requests/{requestId}', {
        params: { path: { requestId } },
        signal,
      }),
  })
}

/** Talep formunun öğrenci seçimi: mezun ve ayrılmış öğrenciler, durum, yaş ve veliler. */
export function useAlumniStudents(query: AlumniStudentQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...ALUMNI_REQUESTS_KEY, 'students', query],
      request: (client, signal) =>
        client.GET('/api/v1/prospects/alumni-document-students', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useAlumniFees(enabled = true) {
  return useApiQuery({
    key: [...ALUMNI_REQUESTS_KEY, 'fees'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/prospects/alumni-document-fees', { signal }),
  })
}

export function useUpdateAlumniFees() {
  return useApiCommand({
    request: (client, body: UpdateAlumniFeesBody, headers: CommandHeaders) =>
      client.PATCH('/api/v1/prospects/alumni-document-fees', {
        params: { header: keyOnly(headers) },
        body,
      }),
    invalidates: [ALUMNI_REQUESTS_KEY],
    exclusive: true,
  })
}

/** Talebi kaydet; `Idempotency-Key` zorunlu. */
export function useCreateAlumniRequest() {
  return useApiCommand({
    request: (client, body: CreateAlumniRequestBody, headers: CommandHeaders) =>
      client.POST('/api/v1/prospects/alumni-document-requests', {
        params: { header: keyOnly(headers) },
        body,
      }),
    invalidates: [ALUMNI_REQUESTS_KEY],
    exclusive: true,
  })
}

export type AlumniTransitionInput =
  | { action: 'start'; requestId: string; version: number }
  | { action: 'ready'; requestId: string; version: number; body: AlumniReadyBody }
  | { action: 'deliver'; requestId: string; version: number; body: AlumniDeliverBody }
  | { action: 'reject'; requestId: string; version: number; reason: string }

/** Hazırlamaya başla, hazır, teslim ve ret (`If-Match` zorunlu). */
export function useTransitionAlumniRequest() {
  return useApiCommand({
    request: (client, input: AlumniTransitionInput, headers: CommandHeaders) => {
      const params = { path: { requestId: input.requestId }, header: versioned(headers) }
      switch (input.action) {
        case 'start':
          return client.POST('/api/v1/prospects/alumni-document-requests/{requestId}/start', {
            params,
            body: {},
          })
        case 'ready':
          return client.POST('/api/v1/prospects/alumni-document-requests/{requestId}/ready', {
            params,
            body: input.body,
          })
        case 'deliver':
          return client.POST('/api/v1/prospects/alumni-document-requests/{requestId}/deliver', {
            params,
            body: input.body,
          })
        case 'reject':
          return client.POST('/api/v1/prospects/alumni-document-requests/{requestId}/reject', {
            params,
            body: { reason: input.reason },
          })
        default:
          return input satisfies never
      }
    },
    invalidates: [ALUMNI_REQUESTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
