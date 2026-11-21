import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Kasa ve gün sonu kancaları (`/finance/day-closings`; IST-113, DOM-FIN-036). Sorgu anahtarı tahsilat
// önekinin altındadır: tahsilat kaydı ve iptali bu raporu da kendiliğinden tazeler. Komutlar
// `exclusive`: yollu `issues` (sayım, açıklama, gerekçe) yalnız form alanında görünür.

export type FinanceDayReport =
  operations['getFinanceDayReport']['responses'][200]['content']['application/json']['data']
export type FinanceDayClosingRecord = NonNullable<FinanceDayReport['closing']>
export type CloseFinanceDayBody =
  operations['closeFinanceDay']['requestBody']['content']['application/json']

const PAYMENTS_KEY = ['payments'] as const

export const DAY_CLOSING_CHANGED_MESSAGE =
  'Kapanış başka biri tarafından değiştirildi. Güncel durum yüklendi.'

/** Günün raporu; kapalı günde özet kapanış anındaki kayıttır. */
export function useFinanceDayReport(closingDate: string) {
  return useApiQuery({
    key: [...PAYMENTS_KEY, 'day-closing', closingDate],
    request: (client, signal) =>
      client.GET('/api/v1/finance/day-closings/{closingDate}', {
        params: { path: { closingDate } },
        signal,
      }),
  })
}

/** Günü kapatır; yönetici ve ön büro. `Idempotency-Key` zorunludur. */
export function useCloseFinanceDay() {
  return useApiCommand({
    request: (client, input: { closingDate: string; body: CloseFinanceDayBody }, headers) =>
      client.POST('/api/v1/finance/day-closings/{closingDate}/close', {
        params: { path: { closingDate: input.closingDate }, header: headers },
        body: input.body,
      }),
    invalidates: [PAYMENTS_KEY],
    exclusive: true,
  })
}

/** Kapatılmış günü gerekçeyle yeniden açar; yalnız yönetici. `If-Match` kapanış sürümüdür. */
export function useReopenFinanceDay() {
  return useApiCommand({
    request: (client, input: { closingDate: string; version: number; reason: string }, headers) =>
      client.POST('/api/v1/finance/day-closings/{closingDate}/reopen', {
        params: {
          path: { closingDate: input.closingDate },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: { reason: input.reason },
      }),
    invalidates: [PAYMENTS_KEY],
    version: (input) => input.version,
    messages: { version_conflict: DAY_CLOSING_CHANGED_MESSAGE },
    exclusive: true,
  })
}
