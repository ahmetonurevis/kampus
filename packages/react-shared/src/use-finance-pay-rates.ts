import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Personel ücret tanımı kancaları (`/finance/pay-rates`, `/finance/pay-rate-staff`; DOM-FIN-099,
// ON-194). Ücret kişisel veridir (K-306): liste varsayılan maskelidir, tutarlı okuma denetime düşer
// (K-307). Her yazma ücret anahtarının tamamını tazeler. Komutlar `exclusive`.

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

export type CreatePayRateBody = JsonBody<'createPayRate'>
export type StaffPayRates =
  operations['getStaffPayRates']['responses'][200]['content']['application/json']['data']
export type PayRate = StaffPayRates['rates'][number]
export type PayRateStaffRow =
  operations['listPayRateStaff']['responses'][200]['content']['application/json']['data'][number]
export type PayRateStaffQuery = Query<'listPayRateStaff'>

export const PAY_RATES_KEY = ['finance', 'pay-rates'] as const
const MESSAGES = {
  version_conflict: 'Ücret tanımı başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function usePayRateStaff(query: PayRateStaffQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...PAY_RATES_KEY, 'staff', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/pay-rate-staff', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Personelin ücret geçmişi ve `date` gününde geçerli tanımları (her okuma denetime düşer). */
export function useStaffPayRates(membershipId: string, date: string | undefined, enabled = true) {
  return useApiQuery({
    key: [...PAY_RATES_KEY, 'detail', membershipId, date ?? ''],
    enabled: enabled && membershipId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/pay-rate-staff/{membershipId}', {
        params: { path: { membershipId }, query: date === undefined ? {} : { date } },
        signal,
      }),
  })
}

export function useCreatePayRate() {
  return useApiCommand({
    request: (client, body: CreatePayRateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/pay-rates', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [PAY_RATES_KEY],
    exclusive: true,
  })
}

export function useEndPayRate() {
  return useApiCommand({
    request: (
      client,
      input: { rateId: string; version: number; endDate: string | null },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/pay-rates/{rateId}/end', {
        params: {
          path: { rateId: input.rateId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { endDate: input.endDate },
      }),
    invalidates: [PAY_RATES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCancelPayRate() {
  return useApiCommand({
    request: (
      client,
      input: { rateId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/pay-rates/{rateId}/cancel', {
        params: {
          path: { rateId: input.rateId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { reason: input.reason },
      }),
    invalidates: [PAY_RATES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
