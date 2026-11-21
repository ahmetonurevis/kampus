import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Bordro parametresi kancaları (`/finance/payroll-parameters`; DOM-FIN-100, ON-197). Yıllık tablo
// yıla göre sorgulanır; her yazma bütün yılların tablosunu tazeler (bir set başka yılın "önceki
// yıldan süren" dönemini de değiştirir). Komutlar `exclusive`.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreatePayrollParameterSetBody = JsonBody<'createPayrollParameterSet'>
export type UpdatePayrollParameterSetBody = JsonBody<'updatePayrollParameterSet'>
export type PayrollParameterYearView =
  operations['getPayrollParameterYear']['responses'][200]['content']['application/json']['data']
export type PayrollParameterPeriodView = PayrollParameterYearView['periods'][number]

export const PAYROLL_PARAMETERS_KEY = ['finance-payroll-parameters'] as const
const MESSAGES = {
  version_conflict: 'Parametre seti başka biri tarafından değiştirildi. Tablo güncellendi.',
}

/** Yılın dönemleri; yıl değişince önceki yılın tablosu yer tutucu olmaz. */
export function usePayrollParameterYear(year: number) {
  return useFinanceListQuery(
    {
      key: [...PAYROLL_PARAMETERS_KEY, 'year', year],
      request: (client, signal) =>
        client.GET('/api/v1/finance/payroll-parameters', { params: { query: { year } }, signal }),
    },
    { keepPreviousPage: false },
  )
}

export function useCreatePayrollParameterSet() {
  return useApiCommand({
    request: (client, body: CreatePayrollParameterSetBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/payroll-parameters', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [PAYROLL_PARAMETERS_KEY],
    exclusive: true,
  })
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useUpdatePayrollParameterSet() {
  return useApiCommand({
    request: (
      client,
      input: { setId: string; version: number; body: UpdatePayrollParameterSetBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/payroll-parameters/{setId}', {
        params: { path: { setId: input.setId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [PAYROLL_PARAMETERS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchivePayrollParameterSet() {
  return useApiCommand({
    request: (client, input: { setId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/payroll-parameters/{setId}', {
        params: { path: { setId: input.setId }, header: versioned(headers) },
      }),
    invalidates: [PAYROLL_PARAMETERS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
