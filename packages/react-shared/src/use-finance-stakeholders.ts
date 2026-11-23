import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Paydaş ve sponsorluk anlaşması kancaları (`/finance/stakeholders`,
// `/finance/stakeholder-agreements`; DOM-FIN-102, ON-262). Paydaş satırı anlaşma sayılarını
// taşıdığı için her yazma iki listenin ortak anahtarını tazeler. Komutlar `exclusive`.

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

export type CreateStakeholderBody = JsonBody<'createStakeholder'>
export type UpdateStakeholderBody = JsonBody<'updateStakeholder'>
export type CreateAgreementBody = JsonBody<'createStakeholderAgreement'>
export type UpdateAgreementBody = JsonBody<'updateStakeholderAgreement'>
export type TerminateAgreementBody = JsonBody<'terminateStakeholderAgreement'>
export type StakeholderRow =
  operations['listStakeholders']['responses'][200]['content']['application/json']['data'][number]
export type StakeholderDetail =
  operations['getStakeholder']['responses'][200]['content']['application/json']['data']
export type AgreementRow =
  operations['listStakeholderAgreements']['responses'][200]['content']['application/json']['data'][number]
export type AgreementDetail =
  operations['getStakeholderAgreement']['responses'][200]['content']['application/json']['data']
export type StakeholderQuery = Query<'listStakeholders'>
export type AgreementQuery = Query<'listStakeholderAgreements'>

export const STAKEHOLDERS_KEY = ['finance', 'stakeholders'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useStakeholders(query: StakeholderQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAKEHOLDERS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/stakeholders', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useStakeholder(stakeholderId: string) {
  return useApiQuery({
    key: [...STAKEHOLDERS_KEY, 'detail', stakeholderId],
    enabled: stakeholderId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/stakeholders/{stakeholderId}', {
        params: { path: { stakeholderId } },
        signal,
      }),
  })
}

export function useStakeholderAgreements(query: AgreementQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAKEHOLDERS_KEY, 'agreements', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/stakeholder-agreements', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useStakeholderAgreement(agreementId: string) {
  return useApiQuery({
    key: [...STAKEHOLDERS_KEY, 'agreement', agreementId],
    enabled: agreementId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/stakeholder-agreements/{agreementId}', {
        params: { path: { agreementId } },
        signal,
      }),
  })
}

/** Paydaş ve anlaşma CSV'si (`Accept: text/csv`); sorgu tazelenmez. */
export function useStakeholdersExport() {
  return useApiCommand({
    request: (client, query: StakeholderQuery) =>
      client.GET('/api/v1/finance/stakeholders', {
        params: { query },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}

export function useStakeholderAgreementsExport() {
  return useApiCommand({
    request: (client, query: AgreementQuery) =>
      client.GET('/api/v1/finance/stakeholder-agreements', {
        params: { query },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useCreateStakeholder() {
  return useApiCommand({
    request: (client, body: CreateStakeholderBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/stakeholders', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAKEHOLDERS_KEY],
    exclusive: true,
  })
}

export function useUpdateStakeholder() {
  return useApiCommand({
    request: (
      client,
      input: { stakeholderId: string; version: number; body: UpdateStakeholderBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/stakeholders/{stakeholderId}', {
        params: { path: { stakeholderId: input.stakeholderId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [STAKEHOLDERS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateStakeholderAgreement() {
  return useApiCommand({
    request: (
      client,
      input: { stakeholderId: string; body: CreateAgreementBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/stakeholders/{stakeholderId}/agreements', {
        params: {
          path: { stakeholderId: input.stakeholderId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [STAKEHOLDERS_KEY],
    exclusive: true,
  })
}

type AgreementTarget = { agreementId: string; version: number }

export function useUpdateStakeholderAgreement() {
  return useApiCommand({
    request: (
      client,
      input: AgreementTarget & { body: UpdateAgreementBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/stakeholder-agreements/{agreementId}', {
        params: { path: { agreementId: input.agreementId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [STAKEHOLDERS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useActivateStakeholderAgreement() {
  return useApiCommand({
    request: (client, input: AgreementTarget, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/stakeholder-agreements/{agreementId}/activate', {
        params: { path: { agreementId: input.agreementId }, header: versioned(headers) },
      }),
    invalidates: [STAKEHOLDERS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useTerminateStakeholderAgreement() {
  return useApiCommand({
    request: (
      client,
      input: AgreementTarget & { body: TerminateAgreementBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/stakeholder-agreements/{agreementId}/terminate', {
        params: { path: { agreementId: input.agreementId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [STAKEHOLDERS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveStakeholderAgreement() {
  return useApiCommand({
    request: (client, input: AgreementTarget, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/stakeholder-agreements/{agreementId}', {
        params: { path: { agreementId: input.agreementId }, header: versioned(headers) },
      }),
    invalidates: [STAKEHOLDERS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
