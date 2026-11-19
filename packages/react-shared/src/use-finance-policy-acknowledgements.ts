import type { operations } from '@kampus/api-client/schema.d.ts'

import type { CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Politika belgesi okundu onayı kancaları (`/finance/policy-*`; DOM-FIN-127, ON-190). Belge PDF'i
// ve ıslak imza taraması platform dosya bağlantısıyla açılır (`useFileUrlFetcher`). Her yazma
// anahtarın tamamını tazeler (oran, onaylamayan listesi ve personel eksikleri birlikte değişir).

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

export type CreatePolicyDocumentBody = JsonBody<'createPolicyDocument'>
export type CreatePolicyAcknowledgementBody = JsonBody<'createPolicyAcknowledgement'>
export type PolicyDocumentRow = Ok<'listPolicyDocuments'>['data'][number]
export type PolicyDocumentDetail = Ok<'getPolicyDocument'>['data']
export type PolicyDocumentStaffRow = Ok<'listPolicyDocumentStaff'>['data'][number]
export type PolicyStaffRow = Ok<'listPolicyAcknowledgementStaff'>['data'][number]
export type PolicyDocumentQuery = Query<'listPolicyDocuments'>
export type PolicyDocumentStaffQuery = Query<'listPolicyDocumentStaff'>
export type PolicyStaffQuery = Query<'listPolicyAcknowledgementStaff'>

export const POLICY_ACKNOWLEDGEMENTS_KEY = ['finance', 'policy-acknowledgements'] as const

export function usePolicyDocuments(query: PolicyDocumentQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...POLICY_ACKNOWLEDGEMENTS_KEY, 'documents', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/policy-documents', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function usePolicyDocument(documentId: string, enabled = true) {
  return useApiQuery({
    key: [...POLICY_ACKNOWLEDGEMENTS_KEY, 'document', documentId],
    enabled: enabled && documentId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/policy-documents/{documentId}', {
        params: { path: { documentId } },
        signal,
      }),
  })
}

export function usePolicyDocumentStaff(
  documentId: string,
  query: PolicyDocumentStaffQuery,
  enabled = true,
) {
  return useFinanceListQuery(
    {
      key: [...POLICY_ACKNOWLEDGEMENTS_KEY, 'document-staff', documentId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/policy-documents/{documentId}/staff', {
          params: { path: { documentId }, query },
          signal,
        }),
    },
    { enabled: enabled && documentId !== '' },
  )
}

export function usePolicyStaff(query: PolicyStaffQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...POLICY_ACKNOWLEDGEMENTS_KEY, 'staff', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/policy-acknowledgement-staff', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useCreatePolicyDocument() {
  return useApiCommand({
    request: (client, body: CreatePolicyDocumentBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/policy-documents', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [POLICY_ACKNOWLEDGEMENTS_KEY],
    exclusive: true,
  })
}

export function useCreatePolicyAcknowledgement() {
  return useApiCommand({
    request: (client, body: CreatePolicyAcknowledgementBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/policy-acknowledgements', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [POLICY_ACKNOWLEDGEMENTS_KEY],
    exclusive: true,
  })
}
