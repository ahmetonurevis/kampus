import type { operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Aday belgeleri kancaları (`/prospects/document-types`, `/prospects/document-gaps`,
// `/prospects/:id/documents`, `/prospects/:id/document-consent`; DOM-KAY-043, ON-263). Belge
// yazmaları adayın belge görünümünü, eksik belge listesini ve aday koleksiyonunu tazeler. İmzalı
// bağlantı önbelleğe yazılmaz: her üretimi denetim kaydıdır (K-322).

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

export type DocumentTypeRow =
  operations['listProspectDocumentTypes']['responses'][200]['content']['application/json']['data'][number]
export type CreateDocumentTypeBody = JsonBody<'createProspectDocumentType'>
export type UpdateDocumentTypeBody = JsonBody<'updateProspectDocumentType'>
export type ProspectDocuments =
  operations['getProspectDocuments']['responses'][200]['content']['application/json']['data']
export type ProspectDocumentRow = ProspectDocuments['documents'][number]
export type ReviewDocumentBody = JsonBody<'reviewProspectDocument'>
export type DocumentGapRow =
  operations['listProspectDocumentGaps']['responses'][200]['content']['application/json']['data'][number]
export type DocumentGapQuery = Query<'listProspectDocumentGaps'>

export const DOCUMENT_TYPES_KEY = ['prospect-document-types'] as const
export const PROSPECT_DOCUMENTS_KEY = ['prospect-documents'] as const
export const DOCUMENT_CHANGED_MESSAGE =
  'Belge başka biri tarafından değiştirildi. Liste güncellendi.'
const DOCUMENT_INVALIDATES = [PROSPECT_DOCUMENTS_KEY, collectionKeyPrefix('prospects')] as const
const TYPE_INVALIDATES = [DOCUMENT_TYPES_KEY, PROSPECT_DOCUMENTS_KEY] as const
const MESSAGES = { version_conflict: DOCUMENT_CHANGED_MESSAGE }
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

/** Kurumun belge türleri (ilk okumada varsayılan liste yazılır; K-320). */
export function useDocumentTypes(options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: [...DOCUMENT_TYPES_KEY, 'list'],
    request: (client, signal) => client.GET('/api/v1/prospects/document-types', { signal }),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

export function useCreateDocumentType() {
  return useApiCommand({
    request: (client, body: CreateDocumentTypeBody, headers: CommandHeaders) =>
      client.POST('/api/v1/prospects/document-types', {
        params: { header: keyOnly(headers) },
        body,
      }),
    invalidates: TYPE_INVALIDATES,
    exclusive: true,
  })
}

export function useUpdateDocumentType() {
  return useApiCommand({
    request: (
      client,
      input: { typeId: string; version: number; body: UpdateDocumentTypeBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/prospects/document-types/{typeId}', {
        params: { path: { typeId: input.typeId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: TYPE_INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Arşiv: tür yeni belge almaz, eksik hesabına girmez; var olan belgeler kalır. */
export function useArchiveDocumentType() {
  return useApiCommand({
    request: (client, input: { typeId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/prospects/document-types/{typeId}', {
        params: { path: { typeId: input.typeId }, header: versioned(headers) },
      }),
    invalidates: TYPE_INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

/** Adayın belgeleri, eksikleri ve özel nitelikli belge rızası. */
export function useProspectDocuments(prospectId: string | null) {
  return useApiQuery({
    key: [...PROSPECT_DOCUMENTS_KEY, 'item', prospectId],
    request: (client, signal) =>
      client.GET('/api/v1/prospects/{prospectId}/documents', {
        params: { path: { prospectId: prospectId ?? '' } },
        signal,
      }),
    enabled: prospectId !== null && prospectId !== '',
  })
}

/** Eksik zorunlu belgesi olan açık adaylar; `prospectId` verilirse yalnız onlar (rozet). */
export function useDocumentGaps(query: DocumentGapQuery, options: { enabled?: boolean } = {}) {
  return useFinanceListQuery(
    {
      key: [...PROSPECT_DOCUMENTS_KEY, 'gaps', query],
      request: (client, signal) =>
        client.GET('/api/v1/prospects/document-gaps', { params: { query }, signal }),
    },
    options,
  )
}

/** Yüklenmiş (`POST /files`, amaç `document`) dosyayı adayın belge türüne bağlar. */
export function useAddProspectDocument() {
  return useApiCommand({
    request: (
      client,
      input: { prospectId: string; documentTypeId: string; fileId: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/prospects/{prospectId}/documents', {
        params: { path: { prospectId: input.prospectId }, header: keyOnly(headers) },
        body: { documentTypeId: input.documentTypeId, fileId: input.fileId },
      }),
    invalidates: DOCUMENT_INVALIDATES,
    exclusive: true,
  })
}

export function useReviewProspectDocument() {
  return useApiCommand({
    request: (
      client,
      input: { prospectId: string; documentId: string; version: number; body: ReviewDocumentBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/prospects/{prospectId}/documents/{documentId}/review', {
        params: {
          path: { prospectId: input.prospectId, documentId: input.documentId },
          header: versioned(headers),
        },
        body: input.body,
      }),
    invalidates: DOCUMENT_INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useRecordDocumentConsent() {
  return useApiCommand({
    request: (client, input: { prospectId: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/prospects/{prospectId}/document-consent', {
        params: { path: { prospectId: input.prospectId }, header: keyOnly(headers) },
        body: { method: 'wet_signature' },
      }),
    invalidates: DOCUMENT_INVALIDATES,
  })
}

export function useWithdrawDocumentConsent() {
  return useApiCommand({
    request: (client, input: { prospectId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/prospects/{prospectId}/document-consent/withdraw', {
        params: { path: { prospectId: input.prospectId }, header: versioned(headers) },
      }),
    invalidates: DOCUMENT_INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

/** Belgenin imzalı bağlantısını ister; her istek denetim kaydıdır, hata `ApiError` olarak fırlar. */
export function useProspectDocumentUrlFetcher() {
  const client = useKampusClient()
  return async (prospectId: string, documentId: string) =>
    (
      await runRequest(() =>
        client.GET('/api/v1/prospects/{prospectId}/documents/{documentId}/url', {
          params: { path: { prospectId, documentId } },
        }),
      )
    ).data
}
