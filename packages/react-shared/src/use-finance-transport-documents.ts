import type { operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { TRANSPORT_KEY } from './use-finance-transport.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Servis belgesi kancaları (`/finance/transport/documents*`; DOM-FIN-147, ON-147). Anahtar servis
// anahtarının altındadır: araç düzenlemesi (sürücü değişikliği) uyarıları da tazeler, belge kaydı
// güzergâh listesindeki "uygun değil" işaretini günceller. Dosya bağlantısı her istekte denetime
// düştüğü için önceden değil, kullanıcı "Dosyayı aç" deyince istenir.

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

export type TransportDocumentBody = JsonBody<'createTransportDocument'>
export type TransportDocumentSettingsBody = JsonBody<'updateTransportDocumentSettings'>
export type TransportDocumentRow = Ok<'listTransportDocuments'>['data'][number]
export type TransportDocumentQuery = Query<'listTransportDocuments'>
export type TransportDocumentAlerts = Ok<'getTransportDocumentAlerts'>['data']
export type TransportVehicleFitness = TransportDocumentAlerts['vehicles'][number]
export type TransportDocumentSettingsData = Ok<'getTransportDocumentSettings'>['data']

export const TRANSPORT_DOCUMENTS_KEY = [...TRANSPORT_KEY, 'documents'] as const
const MESSAGES = {
  version_conflict: 'Ayar başka biri tarafından değiştirildi. Güncel değer yüklendi.',
}

export function useTransportDocuments(query: TransportDocumentQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...TRANSPORT_DOCUMENTS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/transport/documents', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Uyarı sayıları ve araç uygunluğu (sekme rozeti, güzergâh "Belge" sütunu). */
export function useTransportDocumentAlerts(enabled = true) {
  return useApiQuery({
    key: [...TRANSPORT_DOCUMENTS_KEY, 'alerts'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/transport/document-alerts', { signal }),
  })
}

export function useTransportDocumentSettings(enabled = true) {
  return useApiQuery({
    key: [...TRANSPORT_DOCUMENTS_KEY, 'settings'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/transport/document-settings', { signal }),
  })
}

export function useCreateTransportDocument() {
  return useApiCommand({
    request: (client, body: TransportDocumentBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/transport/documents', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [TRANSPORT_DOCUMENTS_KEY],
    exclusive: true,
  })
}

export function useSetTransportDocumentSettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number; body: TransportDocumentSettingsBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/transport/document-settings', {
        params: {
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [TRANSPORT_DOCUMENTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Belgenin dosyası için imzalı bağlantı (her istek denetim kaydıdır); hata `ApiError` fırlar. */
export function useTransportDocumentFileUrlFetcher() {
  const client = useKampusClient()
  return async (documentId: string) => {
    const body = await runRequest(() =>
      client.GET('/api/v1/finance/transport/documents/{documentId}/file-url', {
        params: { path: { documentId } },
      }),
    )
    return body.data
  }
}
