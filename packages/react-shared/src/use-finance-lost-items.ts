import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Kayıp eşya kancaları (`/finance/lost-item*`; DOM-FIN-145, ON-171). Kayıt, bildirim ve bağış/imha
// `Idempotency-Key`, diğer yazmalar `If-Match` ile gider. Her yazma anahtarın tamamını tazeler
// (liste, özet, bildirimler, galeri ve saklama listesi birlikte değişir).

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

export type LostItemCreateBody = JsonBody<'createLostItem'>
export type LostItemUpdateBody = JsonBody<'updateLostItem'>
export type LostItemHandoverBody = JsonBody<'handOverLostItem'>
export type LostItemDisposalBody = JsonBody<'disposeLostItems'>
export type LostItemSettingsBody = JsonBody<'setLostItemSettings'>
export type LostReportCreateBody = JsonBody<'createLostItemReport'>
export type LostItemRow = Ok<'listLostItems'>['data'][number]
export type LostItemDetail = Ok<'getLostItem'>['data']
export type LostItemSummary = Ok<'getLostItemSummary'>['data']
export type LostItemSettingsData = Ok<'getLostItemSettings'>['data']
export type LostItemRecipients = Ok<'getLostItemRecipients'>['data']
export type LostItemFinder = Ok<'listLostItemFinders'>['data'][number]
export type LostReportRow = Ok<'listLostItemReports'>['data'][number]
export type LostItemGalleryRow = Ok<'listLostItemGallery'>['data'][number]
export type LostItemQuery = Query<'listLostItems'>
export type LostItemFinderQuery = Query<'listLostItemFinders'>
export type LostReportQuery = Query<'listLostItemReports'>
export type LostItemGalleryQuery = Query<'listLostItemGallery'>
export type LostItemRetentionQuery = Query<'listLostItemRetention'>

export const LOST_ITEMS_KEY = ['finance', 'lost-items'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useLostItems(query: LostItemQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...LOST_ITEMS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/lost-items', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useLostItem(itemId: string, enabled = true) {
  return useApiQuery({
    key: [...LOST_ITEMS_KEY, 'item', itemId],
    enabled: enabled && itemId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/lost-items/{itemId}', { params: { path: { itemId } }, signal }),
  })
}

export function useLostItemSummary(enabled = true) {
  return useApiQuery({
    key: [...LOST_ITEMS_KEY, 'summary'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/lost-item-summary', { signal }),
  })
}

export function useLostItemFinders(query: LostItemFinderQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...LOST_ITEMS_KEY, 'finders', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/lost-item-finders', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useLostItemRecipients(studentId: string, enabled = true) {
  return useApiQuery({
    key: [...LOST_ITEMS_KEY, 'recipients', studentId],
    enabled: enabled && studentId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/lost-item-recipients', {
        params: { query: { studentId } },
        signal,
      }),
  })
}

export function useLostReports(query: LostReportQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...LOST_ITEMS_KEY, 'reports', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/lost-item-reports', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useLostItemGallery(query: LostItemGalleryQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...LOST_ITEMS_KEY, 'gallery', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/lost-item-gallery', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useLostItemRetention(query: LostItemRetentionQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...LOST_ITEMS_KEY, 'retention', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/lost-item-retention', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useLostItemSettings(enabled = true) {
  return useApiQuery({
    key: [...LOST_ITEMS_KEY, 'settings'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/lost-item-settings', { signal }),
  })
}

const versionHeaders = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useCreateLostItem() {
  return useApiCommand({
    request: (client, body: LostItemCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lost-items', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [LOST_ITEMS_KEY],
    exclusive: true,
  })
}

export function useUpdateLostItem() {
  return useApiCommand({
    request: (
      client,
      input: { itemId: string; version: number; body: LostItemUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/lost-items/{itemId}', {
        params: { path: { itemId: input.itemId }, header: versionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [LOST_ITEMS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useAddLostItemPhoto() {
  return useApiCommand({
    request: (
      client,
      input: { itemId: string; version: number; fileId: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/lost-items/{itemId}/photos', {
        params: { path: { itemId: input.itemId }, header: versionHeaders(headers) },
        body: { fileId: input.fileId },
      }),
    invalidates: [LOST_ITEMS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useRemoveLostItemPhoto() {
  return useApiCommand({
    request: (
      client,
      input: { itemId: string; version: number; fileId: string },
      headers: CommandHeaders,
    ) =>
      client.DELETE('/api/v1/finance/lost-items/{itemId}/photos/{fileId}', {
        params: {
          path: { itemId: input.itemId, fileId: input.fileId },
          header: versionHeaders(headers),
        },
      }),
    invalidates: [LOST_ITEMS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useHandOverLostItem() {
  return useApiCommand({
    request: (
      client,
      input: { itemId: string; version: number; body: LostItemHandoverBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/lost-items/{itemId}/handover', {
        params: { path: { itemId: input.itemId }, header: versionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [LOST_ITEMS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useDisposeLostItems() {
  return useApiCommand({
    request: (client, body: LostItemDisposalBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lost-item-disposals', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [LOST_ITEMS_KEY],
    exclusive: true,
  })
}

export function useSetLostItemSettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number; body: LostItemSettingsBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/lost-item-settings', {
        params: { header: versionHeaders(headers) },
        body: input.body,
      }),
    invalidates: [LOST_ITEMS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateLostReport() {
  return useApiCommand({
    request: (client, body: LostReportCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lost-item-reports', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [LOST_ITEMS_KEY],
    exclusive: true,
  })
}

export function useMatchLostReport() {
  return useApiCommand({
    request: (
      client,
      input: { reportId: string; version: number; itemId: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/lost-item-reports/{reportId}/match', {
        params: { path: { reportId: input.reportId }, header: versionHeaders(headers) },
        body: { itemId: input.itemId },
      }),
    invalidates: [LOST_ITEMS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useUnmatchLostReport() {
  return useApiCommand({
    request: (client, input: { reportId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lost-item-reports/{reportId}/unmatch', {
        params: { path: { reportId: input.reportId }, header: versionHeaders(headers) },
      }),
    invalidates: [LOST_ITEMS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCloseLostReport() {
  return useApiCommand({
    request: (client, input: { reportId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lost-item-reports/{reportId}/close', {
        params: { path: { reportId: input.reportId }, header: versionHeaders(headers) },
      }),
    invalidates: [LOST_ITEMS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
