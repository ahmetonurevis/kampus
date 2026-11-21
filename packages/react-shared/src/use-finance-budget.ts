import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Maliyet merkezi, bütçe kalemi, bütçe dönemi ve satır kancaları (`/finance/cost-centers`,
// `/finance/budget-items`, `/finance/budget-periods`; DOM-FIN-062, ON-241, ON-242). Yalnız yönetici.
// Komutlar `exclusive`: alan hatası formda, yolsuz hata tek toast. Her yazma bütçe anahtarının
// tamamını tazeler: satır dönemin toplamını, merkez ve kalem satır adlarını değiştirir.

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

export type CreateCostCenterBody = JsonBody<'createCostCenter'>
export type UpdateCostCenterBody = JsonBody<'updateCostCenter'>
export type CreateBudgetItemBody = JsonBody<'createBudgetItem'>
export type UpdateBudgetItemBody = JsonBody<'updateBudgetItem'>
export type CreateBudgetPeriodBody = JsonBody<'createBudgetPeriod'>
export type UpdateBudgetPeriodBody = JsonBody<'updateBudgetPeriod'>
export type CreateBudgetLineBody = JsonBody<'createBudgetLine'>
export type UpdateBudgetLineBody = JsonBody<'updateBudgetLine'>
export type CostCenter =
  operations['listCostCenters']['responses'][200]['content']['application/json']['data'][number]
export type BudgetItem =
  operations['listBudgetItems']['responses'][200]['content']['application/json']['data'][number]
export type BudgetPeriod =
  operations['getBudgetPeriod']['responses'][200]['content']['application/json']['data']
export type BudgetLine =
  operations['listBudgetLines']['responses'][200]['content']['application/json']['data'][number]
export type CostCenterQuery = Query<'listCostCenters'>
export type BudgetItemQuery = Query<'listBudgetItems'>
export type BudgetPeriodQuery = Query<'listBudgetPeriods'>
export type BudgetLineQuery = Query<'listBudgetLines'>

export const BUDGET_CHANGED_MESSAGE = 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'
export const BUDGET_KEY = ['finance-budget'] as const
const MESSAGES = { version_conflict: BUDGET_CHANGED_MESSAGE }
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

// --- Maliyet merkezi -----------------------------------------------------------------------------

export function useCostCenters(query: CostCenterQuery) {
  return useFinanceListQuery({
    key: [...BUDGET_KEY, 'cost-centers', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/cost-centers', { params: { query }, signal }),
  })
}

export function useCreateCostCenter() {
  return useApiCommand({
    request: (client, body: CreateCostCenterBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/cost-centers', { params: { header: keyOnly(headers) }, body }),
    invalidates: [BUDGET_KEY],
    exclusive: true,
  })
}

export function useUpdateCostCenter() {
  return useApiCommand({
    request: (
      client,
      input: { costCenterId: string; version: number; body: UpdateCostCenterBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/cost-centers/{costCenterId}', {
        params: { path: { costCenterId: input.costCenterId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [BUDGET_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

// --- Kalem ---------------------------------------------------------------------------------------

export function useBudgetItems(query: BudgetItemQuery) {
  return useFinanceListQuery({
    key: [...BUDGET_KEY, 'items', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/budget-items', { params: { query }, signal }),
  })
}

export function useCreateBudgetItem() {
  return useApiCommand({
    request: (client, body: CreateBudgetItemBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/budget-items', { params: { header: keyOnly(headers) }, body }),
    invalidates: [BUDGET_KEY],
    exclusive: true,
  })
}

export function useUpdateBudgetItem() {
  return useApiCommand({
    request: (
      client,
      input: { itemId: string; version: number; body: UpdateBudgetItemBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/budget-items/{itemId}', {
        params: { path: { itemId: input.itemId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [BUDGET_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

// --- Dönem ---------------------------------------------------------------------------------------

export function useBudgetPeriods(query: BudgetPeriodQuery) {
  return useFinanceListQuery({
    key: [...BUDGET_KEY, 'periods', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/budget-periods', { params: { query }, signal }),
  })
}

export function useBudgetPeriod(periodId: string) {
  return useApiQuery({
    key: [...BUDGET_KEY, 'period', periodId],
    enabled: periodId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/budget-periods/{periodId}', {
        params: { path: { periodId } },
        signal,
      }),
  })
}

export function useCreateBudgetPeriod() {
  return useApiCommand({
    request: (client, body: CreateBudgetPeriodBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/budget-periods', { params: { header: keyOnly(headers) }, body }),
    invalidates: [BUDGET_KEY],
    exclusive: true,
  })
}

export function useUpdateBudgetPeriod() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; version: number; body: UpdateBudgetPeriodBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/budget-periods/{periodId}', {
        params: { path: { periodId: input.periodId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [BUDGET_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Taslağı açar ya da açık dönemi kapatır (yalnız yönetici; K-61). */
export function useChangeBudgetPeriodStatus() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; version: number; action: 'open' | 'close' },
      headers: CommandHeaders,
    ) => {
      const params = { path: { periodId: input.periodId }, header: versioned(headers) }
      return input.action === 'open'
        ? client.POST('/api/v1/finance/budget-periods/{periodId}/open', { params })
        : client.POST('/api/v1/finance/budget-periods/{periodId}/close', { params })
    },
    invalidates: [BUDGET_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

// --- Satır ---------------------------------------------------------------------------------------

export function useBudgetLines(periodId: string, query: BudgetLineQuery) {
  return useFinanceListQuery(
    {
      key: [...BUDGET_KEY, 'lines', periodId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/budget-periods/{periodId}/lines', {
          params: { path: { periodId }, query },
          signal,
        }),
    },
    { enabled: periodId !== '' },
  )
}

export function useCreateBudgetLine() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; body: CreateBudgetLineBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/budget-periods/{periodId}/lines', {
        params: { path: { periodId: input.periodId }, header: keyOnly(headers) },
        body: input.body,
      }),
    invalidates: [BUDGET_KEY],
    exclusive: true,
  })
}

export function useUpdateBudgetLine() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; lineId: string; version: number; body: UpdateBudgetLineBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/budget-periods/{periodId}/lines/{lineId}', {
        params: {
          path: { periodId: input.periodId, lineId: input.lineId },
          header: versioned(headers),
        },
        body: input.body,
      }),
    invalidates: [BUDGET_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useRemoveBudgetLine() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; lineId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.DELETE('/api/v1/finance/budget-periods/{periodId}/lines/{lineId}', {
        params: {
          path: { periodId: input.periodId, lineId: input.lineId },
          header: versioned(headers),
        },
      }),
    invalidates: [BUDGET_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
