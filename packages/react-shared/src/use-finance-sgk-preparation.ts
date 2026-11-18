import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// SGK bildirge hazırlık listesi kancaları (`/finance/sgk-preparation`, `/finance/sgk-missing-days`,
// `/finance/sgk-employment-dates`; DOM-FIN-107, ON-203). Yalnız yönetici. Liste ücret taşır: her
// okuma denetime düşer, CSV taze oturum ister (K-355). Ücret tanımı yazıları da listeyi etkiler;
// anahtar ücret anahtarının altındadır, ücret yazıları listeyi de tazeler.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type SgkPreparation =
  operations['getFinanceSgkPreparation']['responses'][200]['content']['application/json']['data']
export type SgkPreparationRow = SgkPreparation['rows'][number]
export type SgkMissingDayEntry = SgkPreparationRow['missingDayEntries'][number]
export type SgkEmploymentDates = NonNullable<SgkPreparationRow['employmentDates']>
export type CreateSgkMissingDayBody = JsonBody<'createSgkMissingDay'>
export type CreateSgkEmploymentDatesBody = JsonBody<'createSgkEmploymentDates'>

/** Ücret tanımı anahtarıyla başlar (`use-finance-pay-rates.ts` `PAY_RATES_KEY`). */
export const SGK_PREPARATION_KEY = ['finance', 'pay-rates', 'sgk-preparation'] as const
const MESSAGES = {
  version_conflict: 'Satır başka biri tarafından değiştirildi. Liste güncellendi.',
}

/** Ayın listesi; ay geçersizken (`null`) istek atılmaz. */
export function useSgkPreparation(month: string | null) {
  return useApiQuery({
    key: [...SGK_PREPARATION_KEY, month],
    enabled: month !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/sgk-preparation', {
        params: { query: { month: month ?? '' } },
        signal,
      }),
  })
}

/** CSV (`Accept: text/csv`); taze oturum ister, denetime düşer. */
export function useSgkPreparationExport() {
  return useApiCommand({
    request: (client, month: string) =>
      client.GET('/api/v1/finance/sgk-preparation', {
        params: { query: { month } },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}

export function useCreateSgkMissingDay() {
  return useApiCommand({
    request: (client, body: CreateSgkMissingDayBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/sgk-missing-days', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [SGK_PREPARATION_KEY],
    exclusive: true,
  })
}

export function useArchiveSgkMissingDay() {
  return useApiCommand({
    request: (client, input: { entryId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/sgk-missing-days/{entryId}', {
        params: {
          path: { entryId: input.entryId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
      }),
    invalidates: [SGK_PREPARATION_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateSgkEmploymentDates() {
  return useApiCommand({
    request: (client, body: CreateSgkEmploymentDatesBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/sgk-employment-dates', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [SGK_PREPARATION_KEY],
    exclusive: true,
  })
}

export function useArchiveSgkEmploymentDates() {
  return useApiCommand({
    request: (client, input: { entryId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/sgk-employment-dates/{entryId}', {
        params: {
          path: { entryId: input.entryId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
      }),
    invalidates: [SGK_PREPARATION_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
