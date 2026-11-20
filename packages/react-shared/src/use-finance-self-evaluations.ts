import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Öz değerlendirme kancaları (`/finance/performance-periods/{periodId}/self-evaluation*`,
// `/finance/self-evaluation-templates`, `/finance/self-evaluations`; DOM-FIN-131, ON-210). Yalnız
// yönetici (K-450). Şablon ve yanıt açmak `Idempotency-Key`, düzeltme, gönderim ve geri açma
// `If-Match` ister. Yanıt ayrıntısının okunuşu sunucuda denetime düşer. Komutlar `exclusive`;
// her yazma anahtarın tamamını tazeler (özet, takip ve ayrıntı birlikte değişir).

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
type Ok<TOperation extends keyof operations> = operations[TOperation]['responses'] extends {
  200: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type SelfEvaluationTemplateBody = JsonBody<'createSelfEvaluationTemplate'>
export type CreateSelfEvaluationBody = JsonBody<'createSelfEvaluation'>
export type UpdateSelfEvaluationBody = JsonBody<'updateSelfEvaluation'>
export type SelfEvaluationOverview = Ok<'getSelfEvaluationOverview'>['data']
export type SelfEvaluationTemplate = NonNullable<SelfEvaluationOverview['template']>
export type SelfEvaluationTrackingRow = Ok<'listSelfEvaluations'>['data'][number]
export type SelfEvaluationDetail = Ok<'getSelfEvaluation'>['data']
export type SelfEvaluationTrackingQuery = Query<'listSelfEvaluations'>

export const SELF_EVALUATIONS_KEY = ['finance', 'self-evaluations'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

const ifMatchHeaders = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

/** Dönemin şablonu ve gönderen oranı. */
export function useSelfEvaluationOverview(periodId: string | null, enabled = true) {
  return useApiQuery({
    key: [...SELF_EVALUATIONS_KEY, 'overview', periodId],
    enabled: enabled && periodId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/performance-periods/{periodId}/self-evaluation', {
        params: { path: { periodId: periodId ?? '' } },
        signal,
      }),
  })
}

/** Dönemin personeli ve öz değerlendirme durumu (gönderen/göndermeyen). */
export function useSelfEvaluationTracking(
  periodId: string | null,
  query: SelfEvaluationTrackingQuery,
  enabled = true,
) {
  return useFinanceListQuery(
    {
      key: [...SELF_EVALUATIONS_KEY, 'tracking', periodId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/performance-periods/{periodId}/self-evaluations', {
          params: { path: { periodId: periodId ?? '' }, query },
          signal,
        }),
    },
    { enabled: enabled && periodId !== null },
  )
}

/** Yanıt ayrıntısı; her okuma sunucuda denetime yazılır (K-450). */
export function useSelfEvaluation(responseId: string | null, enabled = true) {
  return useApiQuery({
    key: [...SELF_EVALUATIONS_KEY, 'detail', responseId],
    enabled: enabled && responseId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/self-evaluations/{responseId}', {
        params: { path: { responseId: responseId ?? '' } },
        signal,
      }),
  })
}

export function useCreateSelfEvaluationTemplate() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; body: SelfEvaluationTemplateBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/performance-periods/{periodId}/self-evaluation-template', {
        params: {
          path: { periodId: input.periodId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [SELF_EVALUATIONS_KEY],
    exclusive: true,
  })
}

export function useUpdateSelfEvaluationTemplate() {
  return useApiCommand({
    request: (
      client,
      input: { templateId: string; version: number; body: SelfEvaluationTemplateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/self-evaluation-templates/{templateId}', {
        params: { path: { templateId: input.templateId }, header: ifMatchHeaders(headers) },
        body: input.body,
      }),
    invalidates: [SELF_EVALUATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateSelfEvaluation() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; body: CreateSelfEvaluationBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/performance-periods/{periodId}/self-evaluations', {
        params: {
          path: { periodId: input.periodId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [SELF_EVALUATIONS_KEY],
    exclusive: true,
  })
}

export function useUpdateSelfEvaluation() {
  return useApiCommand({
    request: (
      client,
      input: { responseId: string; version: number; body: UpdateSelfEvaluationBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/self-evaluations/{responseId}', {
        params: { path: { responseId: input.responseId }, header: ifMatchHeaders(headers) },
        body: input.body,
      }),
    invalidates: [SELF_EVALUATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useSubmitSelfEvaluation() {
  return useApiCommand({
    request: (client, input: { responseId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/self-evaluations/{responseId}/submit', {
        params: { path: { responseId: input.responseId }, header: ifMatchHeaders(headers) },
        body: {},
      }),
    invalidates: [SELF_EVALUATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useReopenSelfEvaluation() {
  return useApiCommand({
    request: (
      client,
      input: { responseId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/self-evaluations/{responseId}/reopen', {
        params: { path: { responseId: input.responseId }, header: ifMatchHeaders(headers) },
        body: { reason: input.reason },
      }),
    invalidates: [SELF_EVALUATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
