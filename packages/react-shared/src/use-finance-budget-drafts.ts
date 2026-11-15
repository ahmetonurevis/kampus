import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { BUDGET_KEY } from './use-finance-budget.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Bütçe taslağı kancaları (`/finance/budget-drafts`, `/finance/budget-draft-options`; DOM-FIN-093,
// ON-243). Anahtar bütçe anahtarının altındadır: onay bütçe satırlarını ve dönem toplamlarını da
// değiştirir, her yazma bütçe anahtarının tamamını tazeler. Komutlar `exclusive`.

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

export type CreateBudgetDraftBody = JsonBody<'createBudgetDraft'>
export type BudgetDraftLinesBody = JsonBody<'updateBudgetDraftLines'>
export type BudgetDraftNoteBody = JsonBody<'submitBudgetDraft'>
export type BudgetDraftReasonBody = JsonBody<'rejectBudgetDraft'>
export type BudgetOwnerBody = JsonBody<'setBudgetOwner'>
export type BudgetDraftRow =
  operations['listBudgetDrafts']['responses'][200]['content']['application/json']['data'][number]
export type BudgetDraftDetail =
  operations['getBudgetDraft']['responses'][200]['content']['application/json']['data']
export type BudgetDraftComparisonData =
  operations['getBudgetDraftComparison']['responses'][200]['content']['application/json']['data']
export type BudgetDraftOptions =
  operations['getBudgetDraftOptions']['responses'][200]['content']['application/json']['data']
export type BudgetDraftQuery = Query<'listBudgetDrafts'>

const DRAFTS_KEY = [...BUDGET_KEY, 'drafts'] as const
const MESSAGES = { version_conflict: 'Taslak başka biri tarafından değiştirildi. Güncellendi.' }
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useBudgetDraftOptions() {
  return useApiQuery({
    key: [...DRAFTS_KEY, 'options'],
    request: (client, signal) => client.GET('/api/v1/finance/budget-draft-options', { signal }),
  })
}

export function useBudgetDrafts(query: BudgetDraftQuery) {
  return useFinanceListQuery({
    key: [...DRAFTS_KEY, 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/budget-drafts', { params: { query }, signal }),
  })
}

export function useBudgetDraft(draftId: string) {
  return useApiQuery({
    key: [...DRAFTS_KEY, 'draft', draftId],
    enabled: draftId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/budget-drafts/{draftId}', {
        params: { path: { draftId } },
        signal,
      }),
  })
}

export function useBudgetDraftComparison(draftId: string) {
  return useApiQuery({
    key: [...DRAFTS_KEY, 'comparison', draftId],
    enabled: draftId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/budget-drafts/{draftId}/comparison', {
        params: { path: { draftId } },
        signal,
      }),
  })
}

export function useCreateBudgetDraft() {
  return useApiCommand({
    request: (client, body: CreateBudgetDraftBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/budget-drafts', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [BUDGET_KEY],
    exclusive: true,
  })
}

export function useSetBudgetOwner() {
  return useApiCommand({
    request: (
      client,
      input: { costCenterId: string; body: BudgetOwnerBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/cost-centers/{costCenterId}/budget-owner', {
        params: {
          path: { costCenterId: input.costCenterId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [BUDGET_KEY],
    exclusive: true,
  })
}

type Versioned<TBody> = { draftId: string; version: number; body: TBody }

export function useUpdateBudgetDraftLines() {
  return useApiCommand({
    request: (client, input: Versioned<BudgetDraftLinesBody>, headers: CommandHeaders) =>
      client.PATCH('/api/v1/finance/budget-drafts/{draftId}', {
        params: { path: { draftId: input.draftId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [BUDGET_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export type BudgetDraftVerb = 'submit' | 'approve' | 'request-revision' | 'reject' | 'reopen'

/** Durum geçişi; not ya da gerekçe gövdesi geçişe göre (sunucu şeması denetler). */
export function useBudgetDraftTransition() {
  return useApiCommand({
    request: (
      client,
      input: Versioned<BudgetDraftNoteBody | BudgetDraftReasonBody> & { verb: BudgetDraftVerb },
      headers: CommandHeaders,
    ) => {
      const params = { path: { draftId: input.draftId }, header: versioned(headers) }
      const note = input.body as BudgetDraftNoteBody
      const reason = input.body as BudgetDraftReasonBody
      switch (input.verb) {
        case 'submit':
          return client.POST('/api/v1/finance/budget-drafts/{draftId}/submit', {
            params,
            body: note,
          })
        case 'approve':
          return client.POST('/api/v1/finance/budget-drafts/{draftId}/approve', {
            params,
            body: note,
          })
        case 'reopen':
          return client.POST('/api/v1/finance/budget-drafts/{draftId}/reopen', {
            params,
            body: note,
          })
        case 'request-revision':
          return client.POST('/api/v1/finance/budget-drafts/{draftId}/request-revision', {
            params,
            body: reason,
          })
        case 'reject':
          return client.POST('/api/v1/finance/budget-drafts/{draftId}/reject', {
            params,
            body: reason,
          })
        default:
          return input.verb satisfies never
      }
    },
    invalidates: [BUDGET_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
