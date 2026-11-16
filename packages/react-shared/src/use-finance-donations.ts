import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Bağış kampanyası, bağışçı ve makbuz kancaları (`/finance/donation-campaigns`, `/finance/donors`,
// `/finance/donation-settings`; DOM-FIN-097, ON-258). Yalnız yönetici. Bağış kaydı ve iptali
// `Idempotency-Key` ile gider (para kaydı, makbuz numarası); her yazma bağış anahtarının tamamını
// tazeler. Komutlar `exclusive`: alan hatası formda, yolsuz hata tek toast.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateDonationCampaignBody = JsonBody<'createDonationCampaign'>
export type UpdateDonationCampaignBody = JsonBody<'updateDonationCampaign'>
export type CreateDonorBody = JsonBody<'createDonor'>
export type UpdateDonorBody = JsonBody<'updateDonor'>
export type DonationBody = JsonBody<'recordDonation'>
export type DonationSettingsBody = JsonBody<'setDonationSettings'>
export type DonationCampaign =
  operations['getDonationCampaign']['responses'][200]['content']['application/json']['data']
export type Donor =
  operations['listDonors']['responses'][200]['content']['application/json']['data'][number]
export type Donation =
  operations['listCampaignDonations']['responses'][200]['content']['application/json']['data'][number]
export type DonationReceipt =
  operations['getDonationReceipt']['responses'][200]['content']['application/json']['data']
export type DonationSettings =
  operations['getDonationSettings']['responses'][200]['content']['application/json']['data']

export const DONATION_CHANGED_MESSAGE =
  'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'

export const DONATIONS_KEY = ['finance-donations'] as const
const INVALIDATES = [DONATIONS_KEY]
const MESSAGES = { version_conflict: DONATION_CHANGED_MESSAGE }
const keyed = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useDonationCampaigns(query: {
  page: number
  pageSize: number
  q?: string
  status?: 'draft' | 'open' | 'closed'
}) {
  return useFinanceListQuery({
    key: [...DONATIONS_KEY, 'campaigns', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/donation-campaigns', { params: { query }, signal }),
  })
}

export function useDonationCampaign(campaignId: string) {
  return useApiQuery({
    key: [...DONATIONS_KEY, 'campaign', campaignId],
    enabled: campaignId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/donation-campaigns/{campaignId}', {
        params: { path: { campaignId } },
        signal,
      }),
  })
}

export function useCampaignDonations(
  campaignId: string,
  query: { page: number; pageSize: number },
) {
  return useApiQuery({
    key: [...DONATIONS_KEY, 'donations', campaignId, query],
    enabled: campaignId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/donation-campaigns/{campaignId}/donations', {
        params: { path: { campaignId }, query },
        signal,
      }),
  })
}

export function useDonors(query: { page: number; pageSize: number; q?: string }, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...DONATIONS_KEY, 'donors', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/donors', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useDonationSettings(enabled = true) {
  return useApiQuery({
    key: [...DONATIONS_KEY, 'settings'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/donation-settings', { signal }),
  })
}

export function useCreateDonationCampaign() {
  return useApiCommand({
    request: (client, body: CreateDonationCampaignBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/donation-campaigns', {
        params: { header: keyed(headers) },
        body,
      }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useUpdateDonationCampaign() {
  return useApiCommand({
    request: (
      client,
      input: { campaignId: string; version: number; body: UpdateDonationCampaignBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/donation-campaigns/{campaignId}', {
        params: { path: { campaignId: input.campaignId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

type CampaignVersion = { campaignId: string; version: number }

export function useOpenDonationCampaign() {
  return useApiCommand({
    request: (client, input: CampaignVersion, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/donation-campaigns/{campaignId}/open', {
        params: { path: { campaignId: input.campaignId }, header: versioned(headers) },
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCloseDonationCampaign() {
  return useApiCommand({
    request: (client, input: CampaignVersion, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/donation-campaigns/{campaignId}/close', {
        params: { path: { campaignId: input.campaignId }, header: versioned(headers) },
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useRecordDonation() {
  return useApiCommand({
    request: (client, input: { campaignId: string; body: DonationBody }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/donation-campaigns/{campaignId}/donations', {
        params: { path: { campaignId: input.campaignId }, header: keyed(headers) },
        body: input.body,
      }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useCancelDonation() {
  return useApiCommand({
    request: (
      client,
      input: { donationId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/donations/{donationId}/cancel', {
        params: { path: { donationId: input.donationId }, header: versioned(headers) },
        body: { reason: input.reason },
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateDonor() {
  return useApiCommand({
    request: (client, body: CreateDonorBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/donors', { params: { header: keyed(headers) }, body }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useUpdateDonor() {
  return useApiCommand({
    request: (
      client,
      input: { donorId: string; version: number; body: UpdateDonorBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/donors/{donorId}', {
        params: { path: { donorId: input.donorId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useSetDonationSettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number; body: DonationSettingsBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/donation-settings', {
        params: { header: versioned(headers) },
        body: input.body,
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Kampanyanın bağış dökümü CSV (`Accept: text/csv`); taze oturum ister, denetime düşer. */
export function useCampaignDonationsExport() {
  return useApiCommand({
    request: (client, campaignId: string) =>
      client.GET('/api/v1/finance/donation-campaigns/{campaignId}/donations', {
        params: { path: { campaignId }, query: { page: 1, pageSize: 100 } },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}
