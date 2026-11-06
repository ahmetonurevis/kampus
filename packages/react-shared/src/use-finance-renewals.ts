import { useQuery } from '@tanstack/react-query'

import type { operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { CollectionTooLargeError, collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

// Kayıt yenileme kancaları (`/finance/renewals`; IST-100, DOM-FIN-005, DOM-KAY-020). Önizleme
// yazmaz; plan sözleşme ve taksit açar (`Idempotency-Key`), sınıf geçişi ayrı komuttur.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type RenewalQuoteBody = JsonBody<'quoteRenewal'>
export type PlanRenewalBody = JsonBody<'planRenewal'>
export type CreatePriceIndexBody = JsonBody<'createPriceIndex'>
export type UpdatePriceIndexBody = JsonBody<'updatePriceIndex'>
export type RenewalListQuery = NonNullable<operations['listRenewals']['parameters']['query']>
export type OpenRenewalInvitationsBody = JsonBody<'openRenewalInvitations'>
export type RespondRenewalInvitationBody = JsonBody<'respondRenewalInvitation'>
export type RenewalInvitationListQuery = NonNullable<
  operations['listRenewalInvitations']['parameters']['query']
>

export const RENEWAL_CHANGED_MESSAGE =
  'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'

const RENEWALS_KEY = ['renewals'] as const
const PRICE_INDEXES_KEY = ['price-indexes'] as const
const RENEWAL_INVITATIONS_KEY = ['renewal-invitations'] as const
/** Plan ve geçiş sözleşme, taksit ve öğrencinin sınıfını değiştirir; finans listeleri de tazelenir. */
const RENEWAL_WRITES = [
  RENEWALS_KEY,
  // Davet durumu yenileme kaydından türer (DOM-KAY-027): plan listeyi `planned` yapar.
  RENEWAL_INVITATIONS_KEY,
  collectionKeyPrefix('renewals'),
  collectionKeyPrefix('contracts'),
  collectionKeyPrefix('invoices'),
  collectionKeyPrefix('students'),
  ['scholarships'],
]

export function useRenewals(query: RenewalListQuery, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: [...RENEWALS_KEY, 'list', query],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/renewals', { params: { query }, signal }),
  })
}

/** CSV için bütün sayfalar, aynı süzgeç ve sıralamayla; 5000 kaydı aşan liste reddedilir. */
const FETCH_ALL_LIMIT = 5_000
const FETCH_PAGE_SIZE = 100

export function useFetchAllRenewals() {
  const client = useKampusClient()
  return async (query: Omit<RenewalListQuery, 'page' | 'pageSize'>) => {
    const first = await runRequest(() =>
      client.GET('/api/v1/finance/renewals', {
        params: { query: { ...query, page: 1, pageSize: FETCH_PAGE_SIZE } },
      }),
    )
    if (first.meta.total > FETCH_ALL_LIMIT) throw new CollectionTooLargeError()
    const rows = [...first.data]
    for (let page = 2; rows.length < first.meta.total; page += 1) {
      const next = await runRequest(() =>
        client.GET('/api/v1/finance/renewals', {
          params: { query: { ...query, page, pageSize: FETCH_PAGE_SIZE } },
        }),
      )
      if (next.data.length === 0) break
      rows.push(...next.data)
    }
    return rows
  }
}

export function useRenewal(renewalId: string) {
  return useApiQuery({
    key: [...RENEWALS_KEY, 'item', renewalId],
    enabled: renewalId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/renewals/{renewalId}', {
        params: { path: { renewalId } },
        signal,
      }),
  })
}

/** Ücret özeti; yazma değildir, sorgu tazelenmez. */
export function useQuoteRenewal() {
  return useApiCommand({
    request: (client, body: RenewalQuoteBody) =>
      client.POST('/api/v1/finance/renewals/quote', { body }),
    invalidates: [],
    exclusive: true,
  })
}

export function usePlanRenewal() {
  return useApiCommand({
    request: (client, body: PlanRenewalBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/renewals', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: RENEWAL_WRITES,
    exclusive: true,
  })
}

export function useActivateRenewal() {
  return useApiCommand({
    request: (client, input: { renewalId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/renewals/{renewalId}/activate', {
        params: { path: { renewalId: input.renewalId }, header: headers },
        body: {},
      }),
    version: (input) => input.version,
    invalidates: RENEWAL_WRITES,
    messages: { version_conflict: RENEWAL_CHANGED_MESSAGE },
  })
}

// --- Yenileme daveti (K-10; DOM-KAY-027) -----------------------------------------------------

export function useRenewalInvitations(
  query: RenewalInvitationListQuery,
  options: { enabled?: boolean } = {},
) {
  return useApiQuery({
    key: [...RENEWAL_INVITATIONS_KEY, 'list', query],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/renewal-invitations', { params: { query }, signal }),
  })
}

/** Yılın bütün davetleri: davet formu daveti olan öğrenciyi sunmaz. */
export function useAllRenewalInvitations(academicYear: number) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...RENEWAL_INVITATIONS_KEY, 'all', academicYear),
    enabled: institutionId !== null,
    queryFn: async ({ signal }) => {
      const read = (page: number) =>
        runRequest(() =>
          client.GET('/api/v1/finance/renewal-invitations', {
            params: { query: { academicYear, page, pageSize: FETCH_PAGE_SIZE } },
            signal,
          }),
        )
      const first = await read(1)
      if (first.meta.total > FETCH_ALL_LIMIT) throw new CollectionTooLargeError()
      const rows = [...first.data]
      for (let page = 2; rows.length < first.meta.total; page += 1) {
        const next = await read(page)
        if (next.data.length === 0) break
        rows.push(...next.data)
      }
      return rows
    },
  })
}

export function useOpenRenewalInvitations() {
  return useApiCommand({
    request: (client, body: OpenRenewalInvitationsBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/renewal-invitations', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [RENEWAL_INVITATIONS_KEY],
  })
}

export function useRespondRenewalInvitation() {
  return useApiCommand({
    request: (
      client,
      input: { invitationId: string; version: number; body: RespondRenewalInvitationBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/renewal-invitations/{invitationId}/respond', {
        params: {
          path: { invitationId: input.invitationId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: input.body,
      }),
    version: (input) => input.version,
    invalidates: [RENEWAL_INVITATIONS_KEY],
    messages: { version_conflict: RENEWAL_CHANGED_MESSAGE },
  })
}

export function usePriceIndexes(
  query: { page: number; pageSize: number },
  options: { enabled?: boolean } = {},
) {
  return useApiQuery({
    key: [...PRICE_INDEXES_KEY, query],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/renewals/price-indexes', { params: { query }, signal }),
  })
}

export function useCreatePriceIndex() {
  return useApiCommand({
    request: (client, body: CreatePriceIndexBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/renewals/price-indexes', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [PRICE_INDEXES_KEY],
    exclusive: true,
  })
}

export function useUpdatePriceIndex() {
  return useApiCommand({
    request: (
      client,
      input: { academicYear: number; version: number; body: UpdatePriceIndexBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/renewals/price-indexes/{academicYear}', {
        params: {
          path: { academicYear: input.academicYear },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    version: (input) => input.version,
    invalidates: [PRICE_INDEXES_KEY],
    messages: { version_conflict: RENEWAL_CHANGED_MESSAGE },
    exclusive: true,
  })
}
