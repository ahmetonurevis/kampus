import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Bordro hesabı kancaları (`/finance/payroll-calculations`, `/finance/payroll-runs`,
// `/finance/payroll-tax-carryovers`; DOM-FIN-115, ON-198). Yalnız yönetici. Önizleme ve kayıtlı
// hesap ücret taşır: her okuma denetime düşer, CSV taze oturum ister. Anahtar ücret tanımı
// anahtarının (`PAY_RATES_KEY`) altındadır: ücret, dönem onayı ve kesinti yazıları hesabı da tazeler.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type PayrollCalculation =
  operations['getPayrollCalculation']['responses'][200]['content']['application/json']['data']
export type PayrollCalcRow = PayrollCalculation['rows'][number]
export type PayrollRun =
  operations['getPayrollRun']['responses'][200]['content']['application/json']['data']
export type PayrollTaxCarryover =
  operations['listPayrollTaxCarryovers']['responses'][200]['content']['application/json']['data'][number]
export type CreatePayrollTaxCarryoverBody = JsonBody<'createPayrollTaxCarryover'>
export type PayrollPayslips =
  operations['getPayrollPayslips']['responses'][200]['content']['application/json']['data']
export type PayrollPayslip = PayrollPayslips['payslips'][number]

/** Ücret tanımı anahtarıyla başlar (`use-finance-pay-rates.ts` `PAY_RATES_KEY`). */
export const PAYROLL_RUNS_KEY = ['finance', 'pay-rates', 'payroll-runs'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

/** Ayın canlı hesabı; ay geçersizken (`null`) istek atılmaz. */
export function usePayrollCalculation(month: string | null) {
  return useApiQuery({
    key: [...PAYROLL_RUNS_KEY, 'calculation', month],
    enabled: month !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/payroll-calculations/{month}', {
        params: { path: { month: month ?? '' } },
        signal,
      }),
  })
}

/** Ayın kayıtlı hesabı; yalnız kayıt varken (`enabled`) istenir. */
export function usePayrollRun(month: string | null, enabled: boolean) {
  return useApiQuery({
    key: [...PAYROLL_RUNS_KEY, 'run', month],
    enabled: month !== null && enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/payroll-runs/{month}', {
        params: { path: { month: month ?? '' } },
        signal,
      }),
  })
}

/** CSV (`Accept: text/csv`): `saved` kayıtlı hesabı, değilse önizlemeyi indirir. */
export function usePayrollCalculationExport() {
  return useApiCommand({
    request: (client, input: { month: string; saved: boolean }) =>
      input.saved
        ? client.GET('/api/v1/finance/payroll-runs/{month}', {
            params: { path: { month: input.month } },
            headers: { accept: 'text/csv' },
            parseAs: 'text',
          })
        : client.GET('/api/v1/finance/payroll-calculations/{month}', {
            params: { path: { month: input.month } },
            headers: { accept: 'text/csv' },
            parseAs: 'text',
          }),
    invalidates: [],
  })
}

/**
 * Ücret hesap pusulası verisi (DOM-FIN-119; ON-201): ayın kayıtlı hesabından, `membershipId` ile tek
 * pusula, yoksa bütün personel. Her çağrı PDF üretimidir: taze oturum ister (403
 * `reauthentication_required` çağıranın parola penceresine gider), denetime düşer; önbelleğe
 * alınmaz.
 */
export function usePayrollPayslips() {
  return useApiCommand({
    request: (client, input: { month: string; membershipId?: string }) =>
      client.GET('/api/v1/finance/payroll-runs/{month}/payslips', {
        params: {
          path: { month: input.month },
          query: input.membershipId === undefined ? {} : { membershipId: input.membershipId },
        },
      }),
    invalidates: [],
    messages: {
      not_found:
        'Pusula kayıtlı hesaptan üretilir; bu ay için kayıtlı hesap ya da hesapta bu personel yok.',
    },
  })
}

/** Hesabı kaydet ya da yeniden hesapla (`previousRunId`: ekrandaki kayıtlı hesap). */
export function useSavePayrollRun() {
  return useApiCommand({
    request: (
      client,
      input: { month: string; previousRunId: string | null },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/payroll-runs/{month}/calculate', {
        params: { path: { month: input.month }, header: headers },
        body: { previousRunId: input.previousRunId },
      }),
    invalidates: [PAYROLL_RUNS_KEY],
    exclusive: true,
  })
}

/** Yılın matrah devirleri. */
export function usePayrollTaxCarryovers(year: number, enabled = true) {
  return useApiQuery({
    key: [...PAYROLL_RUNS_KEY, 'carryovers', year],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/payroll-tax-carryovers', {
        params: { query: { year } },
        signal,
      }),
  })
}

export function useCreatePayrollTaxCarryover() {
  return useApiCommand({
    request: (client, body: CreatePayrollTaxCarryoverBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/payroll-tax-carryovers', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [PAYROLL_RUNS_KEY],
    exclusive: true,
  })
}

export function useArchivePayrollTaxCarryover() {
  return useApiCommand({
    request: (client, input: { carryoverId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/payroll-tax-carryovers/{carryoverId}', {
        params: {
          path: { carryoverId: input.carryoverId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
      }),
    invalidates: [PAYROLL_RUNS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
