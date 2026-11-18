import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'
import { PAY_RATES_KEY } from './use-finance-pay-rates.ts'

// Personel maliyeti kancaları (`/finance/staff-costs`, `/finance/staff-cost-staff`,
// `/finance/staff-cost-allocations`; DOM-FIN-104, ON-204). Yalnız yönetici. Rapor ücret içerir:
// her okuma ve CSV denetime düşer (K-334). Anahtar ücret anahtarıyla başlar: ücret tanımı ya da
// atama değişince rapor da tazelenir. Komutlar `exclusive`.

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

export type CreateStaffCostAllocationBody = JsonBody<'createStaffCostAllocation'>
export type StaffCostReport =
  operations['getFinanceStaffCosts']['responses'][200]['content']['application/json']['data']
export type StaffCostQuery = Query<'getFinanceStaffCosts'>
export type StaffCostStaffRow =
  operations['listStaffCostStaff']['responses'][200]['content']['application/json']['data'][number]
export type StaffCostStaffQuery = Query<'listStaffCostStaff'>
export type StaffCostAllocations =
  operations['getStaffCostAllocations']['responses'][200]['content']['application/json']['data']
export type StaffCostAllocation = StaffCostAllocations['allocations'][number]

export const STAFF_COSTS_KEY = [...PAY_RATES_KEY, 'staff-costs'] as const
const MESSAGES = {
  version_conflict: 'Atama başka biri tarafından değiştirildi. Liste güncellendi.',
}

/** Tahmini personel maliyeti raporu (her okuma denetime düşer). */
export function useStaffCosts(query: StaffCostQuery, enabled = true) {
  return useApiQuery({
    key: [...STAFF_COSTS_KEY, 'report', query],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/staff-costs', { params: { query }, signal }),
  })
}

/** Raporun CSV'si (`Accept: text/csv`); taze oturum ister, denetime düşer, sorgu tazelenmez. */
export function useStaffCostsExport() {
  return useApiCommand({
    request: (client, query: StaffCostQuery) =>
      client.GET('/api/v1/finance/staff-costs', {
        params: { query },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}

export function useStaffCostStaff(query: StaffCostStaffQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_COSTS_KEY, 'staff', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/staff-cost-staff', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useStaffCostAllocations(membershipId: string, enabled = true) {
  return useApiQuery({
    key: [...STAFF_COSTS_KEY, 'detail', membershipId],
    enabled: enabled && membershipId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/staff-cost-staff/{membershipId}', {
        params: { path: { membershipId } },
        signal,
      }),
  })
}

export function useCreateStaffCostAllocation() {
  return useApiCommand({
    request: (client, body: CreateStaffCostAllocationBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-cost-allocations', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_COSTS_KEY],
    exclusive: true,
  })
}

export function useCancelStaffCostAllocation() {
  return useApiCommand({
    request: (
      client,
      input: { allocationId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/staff-cost-allocations/{allocationId}/cancel', {
        params: {
          path: { allocationId: input.allocationId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { reason: input.reason },
      }),
    invalidates: [STAFF_COSTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
