import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Ücret tarifesi kancaları (`/fee-tariffs`; ADR 0006 karar 8, DOM-FIN-002, -004, -006). Komutlar
// `exclusive`: alan hatası formda görünür, yolsuz hata tek toast olur.

// Dosya yükleme uçları `multipart/form-data` gövdesi taşır; JSON gövdesi koşulla seçilir.
type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateFeeTariffBody = JsonBody<'createFeeTariff'>
export type UpdateFeeTariffBody = JsonBody<'updateFeeTariff'>
export type PublishFeeTariffBody = JsonBody<'publishFeeTariff'>

export const FEE_TARIFF_CHANGED_MESSAGE =
  'Tarife başka biri tarafından değiştirildi. Liste güncellendi.'

const FEE_TARIFFS_KEY = ['fee-tariffs'] as const
const MESSAGES = { version_conflict: FEE_TARIFF_CHANGED_MESSAGE }

export function useFeeTariffs(query: { page: number; pageSize: number; academicYear?: number }) {
  return useApiQuery({
    key: [...FEE_TARIFFS_KEY, query],
    request: (client, signal) => client.GET('/api/v1/fee-tariffs', { params: { query }, signal }),
  })
}

export function useCreateFeeTariff() {
  return useApiCommand({
    request: (client, body: CreateFeeTariffBody, headers) =>
      client.POST('/api/v1/fee-tariffs', { params: { header: headers }, body }),
    invalidates: [FEE_TARIFFS_KEY],
    exclusive: true,
  })
}

export function useUpdateFeeTariff() {
  return useApiCommand({
    request: (
      client,
      input: { tariffId: string; version: number; body: UpdateFeeTariffBody },
      headers,
    ) =>
      client.PATCH('/api/v1/fee-tariffs/{tariffId}', {
        params: {
          path: { tariffId: input.tariffId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: input.body,
      }),
    invalidates: [FEE_TARIFFS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function usePublishFeeTariff() {
  return useApiCommand({
    request: (
      client,
      input: { tariffId: string; version: number; body: PublishFeeTariffBody },
      headers,
    ) =>
      client.POST('/api/v1/fee-tariffs/{tariffId}/publish', {
        params: {
          path: { tariffId: input.tariffId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: input.body,
      }),
    invalidates: [FEE_TARIFFS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
