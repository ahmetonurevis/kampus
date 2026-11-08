import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Burs fonu kancaları (`/finance/scholarship-funds`; DOM-FIN-068, ON-259). Okuma yönetici ve ön
// büro, yazma yönetici. Bağış, atama ve iptaller `Idempotency-Key` ile gider (para hareketi);
// her yazma fon anahtarının tamamını ve burs atama listesini tazeler. Komutlar `exclusive`: alan
// hatası formda, yolsuz hata tek toast.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateScholarshipFundBody = JsonBody<'createScholarshipFund'>
export type ScholarshipFundDonationBody = JsonBody<'donateToScholarshipFund'>
export type ScholarshipFundAllocationBody = JsonBody<'allocateFromScholarshipFund'>
export type ScholarshipFundSummary =
  operations['listScholarshipFunds']['responses'][200]['content']['application/json']['data'][number]
export type ScholarshipFundReport =
  operations['getScholarshipFundReport']['responses'][200]['content']['application/json']['data']
export type ScholarshipFundMovement = ScholarshipFundReport['movements'][number]

export const SCHOLARSHIP_FUND_CHANGED_MESSAGE =
  'Kayıt başka biri tarafından değiştirildi. Fon güncellendi.'

export const SCHOLARSHIP_FUNDS_KEY = ['finance-scholarship-funds'] as const
const INVALIDATES = [SCHOLARSHIP_FUNDS_KEY, ['scholarships']]
const MESSAGES = { version_conflict: SCHOLARSHIP_FUND_CHANGED_MESSAGE }
const keyed = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useScholarshipFunds(query: {
  page: number
  pageSize: number
  q?: string
  status?: 'active' | 'closed'
}) {
  return useFinanceListQuery({
    key: [...SCHOLARSHIP_FUNDS_KEY, 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/scholarship-funds', { params: { query }, signal }),
  })
}

export function useScholarshipFundReport(fundId: string) {
  return useApiQuery({
    key: [...SCHOLARSHIP_FUNDS_KEY, 'report', fundId],
    enabled: fundId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/scholarship-funds/{fundId}/report', {
        params: { path: { fundId } },
        signal,
      }),
  })
}

export function useCreateScholarshipFund() {
  return useApiCommand({
    request: (client, body: CreateScholarshipFundBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/scholarship-funds', {
        params: { header: keyed(headers) },
        body,
      }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useDonateToScholarshipFund() {
  return useApiCommand({
    request: (
      client,
      input: { fundId: string; body: ScholarshipFundDonationBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/scholarship-funds/{fundId}/donations', {
        params: { path: { fundId: input.fundId }, header: keyed(headers) },
        body: input.body,
      }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useAllocateFromScholarshipFund() {
  return useApiCommand({
    request: (
      client,
      input: { fundId: string; body: ScholarshipFundAllocationBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/scholarship-funds/{fundId}/allocations', {
        params: { path: { fundId: input.fundId }, header: keyed(headers) },
        body: input.body,
      }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

type CancelInput = { fundId: string; movementId: string; version: number; reason: string }

export function useCancelScholarshipFundDonation() {
  return useApiCommand({
    request: (client, input: CancelInput, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/scholarship-funds/{fundId}/donations/{donationId}/cancel', {
        params: {
          path: { fundId: input.fundId, donationId: input.movementId },
          header: versioned(headers),
        },
        body: { reason: input.reason },
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCancelScholarshipFundAllocation() {
  return useApiCommand({
    request: (client, input: CancelInput, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/scholarship-funds/{fundId}/allocations/{allocationId}/cancel', {
        params: {
          path: { fundId: input.fundId, allocationId: input.movementId },
          header: versioned(headers),
        },
        body: { reason: input.reason },
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCloseScholarshipFund() {
  return useApiCommand({
    request: (client, input: { fundId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/scholarship-funds/{fundId}/close', {
        params: { path: { fundId: input.fundId }, header: versioned(headers) },
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Fon raporu CSV (`Accept: text/csv`); taze oturum ister, denetime düşer. */
export function useScholarshipFundExport() {
  return useApiCommand({
    request: (client, fundId: string) =>
      client.GET('/api/v1/finance/scholarship-funds/{fundId}/report', {
        params: { path: { fundId } },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}
