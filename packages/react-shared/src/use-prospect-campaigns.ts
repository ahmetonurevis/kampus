import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Kampanya kodu ve kayıt hunisinin kampanya kırılımı kancaları (`/campaign-codes`,
// `/prospects/funnel/campaigns`; DOM-KAY-041, ON-134). Kırılım aday koleksiyonunun anahtarı
// altındadır: aday komutlarının tazelemesi onu da kapsar. Kampanya yazması listeyi ve kırılımı
// (kampanya adı, maliyet) tazeler.

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

export type CreateCampaignBody = JsonBody<'createCampaignCode'>
export type UpdateCampaignBody = JsonBody<'updateCampaignCode'>
export type CampaignRow =
  operations['listCampaignCodes']['responses'][200]['content']['application/json']['data'][number]
export type CampaignQuery = Query<'listCampaignCodes'>
export type CampaignFunnelQuery = Query<'getProspectCampaignFunnel'>
export type CampaignFunnel =
  operations['getProspectCampaignFunnel']['responses'][200]['content']['application/json']['data']

export const CAMPAIGN_KEY = ['campaign-codes'] as const
export const CAMPAIGN_CHANGED_MESSAGE =
  'Kampanya başka biri tarafından değiştirildi. Liste güncellendi.'
const INVALIDATES = [CAMPAIGN_KEY, collectionKeyPrefix('prospects')] as const
const MESSAGES = { version_conflict: CAMPAIGN_CHANGED_MESSAGE }
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

/** Kampanya listesi; `status: 'usable'` aday formunun seçenekleridir. */
export function useCampaigns(query: CampaignQuery, options: { enabled?: boolean } = {}) {
  return useFinanceListQuery(
    {
      key: [...CAMPAIGN_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/campaign-codes', { params: { query }, signal }),
    },
    options,
  )
}

export function useCreateCampaign() {
  return useApiCommand({
    request: (client, body: CreateCampaignBody, headers: CommandHeaders) =>
      client.POST('/api/v1/campaign-codes', { params: { header: keyOnly(headers) }, body }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useUpdateCampaign() {
  return useApiCommand({
    request: (
      client,
      input: { campaignId: string; version: number; body: UpdateCampaignBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/campaign-codes/{campaignId}', {
        params: { path: { campaignId: input.campaignId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Arşiv: kod yeni adaya bağlanmaz; adayları kırılımda kalır. */
export function useArchiveCampaign() {
  return useApiCommand({
    request: (client, input: { campaignId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/campaign-codes/{campaignId}', {
        params: { path: { campaignId: input.campaignId }, header: versioned(headers) },
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

/** Kayıt hunisinin kampanya kırılımı; sayı ve oranlar sunucudan gelir. */
export function useCampaignFunnel(query: CampaignFunnelQuery, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: [...collectionKeyPrefix('prospects'), 'campaign-funnel', query],
    request: (client, signal) =>
      client.GET('/api/v1/prospects/funnel/campaigns', { params: { query }, signal }),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

/** Kırılımın CSV'si (`Accept: text/csv`); kişi verisi yoktur, sorgu tazelenmez. */
export function useCampaignFunnelExport() {
  return useApiCommand({
    request: (client, query: CampaignFunnelQuery) =>
      client.GET('/api/v1/prospects/funnel/campaigns', {
        params: { query },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}
