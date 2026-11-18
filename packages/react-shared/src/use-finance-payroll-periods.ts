import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { PAY_RATES_KEY } from './use-finance-pay-rates.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Bordro onayı ve dönem kilidi kancaları (`/finance/payroll-periods`, `/finance/payroll-adjustments`;
// DOM-FIN-108, ON-200). Bütün yazmalar `Idempotency-Key` taşır. Onay ve yeniden açma kilidi
// değiştirdiği için ücret tanımı ve bordro parametresi anahtarlarını da tazeler. Komutlar `exclusive`.

export type PayrollPeriodYear =
  operations['listPayrollPeriods']['responses'][200]['content']['application/json']['data']
export type PayrollPeriodMonth = PayrollPeriodYear['months'][number]
export type PayrollAdjustment =
  operations['listPayrollAdjustments']['responses'][200]['content']['application/json']['data'][number]
export type CreatePayrollAdjustmentBody = NonNullable<
  operations['createPayrollAdjustment']['requestBody']
>['content']['application/json']

export const PAYROLL_PERIODS_KEY = ['finance', 'payroll-periods'] as const
const PAYROLL_PARAMETERS_KEY = ['finance', 'payroll-parameters'] as const
const INVALIDATES = [PAYROLL_PERIODS_KEY, PAY_RATES_KEY, PAYROLL_PARAMETERS_KEY]
const MESSAGES = {
  version_conflict: 'Bordro dönemi başka biri tarafından değiştirildi. Liste güncellendi.',
}

/** Yılın ayları; `lockedMonths` kurumun bütün kilitli aylarıdır. */
export function usePayrollPeriodYear(year: number | undefined, enabled = true) {
  return useApiQuery({
    key: [...PAYROLL_PERIODS_KEY, 'year', year ?? 'current'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/payroll-periods', {
        params: { query: year === undefined ? {} : { year } },
        signal,
      }),
  })
}

/** Ayın düzeltme kayıtları (tutar içerir; her okuma denetime düşer). */
export function usePayrollAdjustments(
  month: string,
  query: { page: number; pageSize: number },
  enabled = true,
) {
  return useFinanceListQuery(
    {
      key: [...PAYROLL_PERIODS_KEY, 'adjustments', month, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/payroll-periods/{month}/adjustments', {
          params: { path: { month }, query },
          signal,
        }),
    },
    { enabled: enabled && month !== '' },
  )
}

export function useApprovePayrollPeriod() {
  return useApiCommand({
    request: (client, input: { month: string; inputsHash: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/payroll-periods/{month}/approve', {
        params: { path: { month: input.month }, header: headers },
        body: { inputsHash: input.inputsHash },
      }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useReopenPayrollPeriod() {
  return useApiCommand({
    request: (
      client,
      input: { month: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/payroll-periods/{month}/reopen', {
        params: {
          path: { month: input.month },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: { reason: input.reason },
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreatePayrollAdjustment() {
  return useApiCommand({
    request: (
      client,
      input: { month: string; body: CreatePayrollAdjustmentBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/payroll-periods/{month}/adjustments', {
        params: { path: { month: input.month }, header: headers },
        body: input.body,
      }),
    invalidates: [PAYROLL_PERIODS_KEY],
    exclusive: true,
  })
}

export function useCancelPayrollAdjustment() {
  return useApiCommand({
    request: (
      client,
      input: { adjustmentId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/payroll-adjustments/{adjustmentId}/cancel', {
        params: {
          path: { adjustmentId: input.adjustmentId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: { reason: input.reason },
      }),
    invalidates: [PAYROLL_PERIODS_KEY],
    version: (input) => input.version,
    messages: { version_conflict: 'Düzeltme kaydı başka biri tarafından değiştirildi.' },
    exclusive: true,
  })
}
