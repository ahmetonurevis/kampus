import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { FIXED_ASSETS_KEY } from './use-finance-fixed-assets.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Periyodik bakım planı kancaları (`/finance/maintenance-plans`; DOM-FIN-092, ON-240). Anahtar
// demirbaş anahtarının altındadır: denetimden açılan arıza talebi arıza listesini ve demirbaştaki
// "açık arıza" işaretini de değiştirir, her yazma demirbaş anahtarının tamamını tazeler. Komutlar
// `exclusive`.

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

export type CreateMaintenancePlanBody = JsonBody<'createMaintenancePlan'>
export type UpdateMaintenancePlanBody = JsonBody<'updateMaintenancePlan'>
export type MaintenanceInspectionBody = JsonBody<'recordMaintenanceInspection'>
export type CancelMaintenanceInspectionBody = JsonBody<'cancelMaintenanceInspection'>
export type MaintenancePlanRow =
  operations['listMaintenancePlans']['responses'][200]['content']['application/json']['data'][number]
export type MaintenancePlanDetail =
  operations['getMaintenancePlan']['responses'][200]['content']['application/json']['data']
export type MaintenanceInspectionRow = MaintenancePlanDetail['inspections'][number]
export type MaintenancePlanQuery = Query<'listMaintenancePlans'>

const PLANS_KEY = [...FIXED_ASSETS_KEY, 'maintenance-plans'] as const
const MESSAGES = {
  version_conflict: 'Plan başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useMaintenancePlans(query: MaintenancePlanQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...PLANS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/maintenance-plans', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useMaintenancePlan(planId: string) {
  return useApiQuery({
    key: [...PLANS_KEY, 'plan', planId],
    enabled: planId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/maintenance-plans/{planId}', {
        params: { path: { planId } },
        signal,
      }),
  })
}

/** Plan listesinin CSV'si (`Accept: text/csv`); taze oturum ister, sorgu tazelenmez. */
export function useMaintenancePlansExport() {
  return useApiCommand({
    request: (client, query: MaintenancePlanQuery) =>
      client.GET('/api/v1/finance/maintenance-plans', {
        params: { query },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}

export function useCreateMaintenancePlan() {
  return useApiCommand({
    request: (client, body: CreateMaintenancePlanBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/maintenance-plans', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    exclusive: true,
  })
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useUpdateMaintenancePlan() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; version: number; body: UpdateMaintenancePlanBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/maintenance-plans/{planId}', {
        params: { path: { planId: input.planId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveMaintenancePlan() {
  return useApiCommand({
    request: (client, input: { planId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/maintenance-plans/{planId}', {
        params: { path: { planId: input.planId }, header: versioned(headers) },
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useRecordMaintenanceInspection() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; body: MaintenanceInspectionBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/maintenance-plans/{planId}/inspections', {
        params: {
          path: { planId: input.planId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    exclusive: true,
  })
}

type InspectionTarget = { planId: string; inspectionId: string; version: number }

export function useCancelMaintenanceInspection() {
  return useApiCommand({
    request: (
      client,
      input: InspectionTarget & { body: CancelMaintenanceInspectionBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/maintenance-plans/{planId}/inspections/{inspectionId}/cancel', {
        params: {
          path: { planId: input.planId, inspectionId: input.inspectionId },
          header: versioned(headers),
        },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useOpenRequestFromInspection() {
  return useApiCommand({
    request: (client, input: InspectionTarget, headers: CommandHeaders) =>
      client.POST(
        '/api/v1/finance/maintenance-plans/{planId}/inspections/{inspectionId}/maintenance-request',
        {
          params: {
            path: { planId: input.planId, inspectionId: input.inspectionId },
            header: versioned(headers),
          },
        },
      ),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
