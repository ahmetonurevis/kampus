import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Çok kaynaklı geri bildirim kancaları (`/finance/performance-periods/{periodId}/staff-feedback*`,
// `/finance/staff-feedback-templates`, `/finance/staff-feedback-assignments`,
// `/finance/staff-feedback-settings`; DOM-FIN-134, ON-212). Yalnız yönetici. Şablon ve atama
// açmak `Idempotency-Key`, düzeltme, kaldırma, yanıt girişi, geri alma ve eşik `If-Match` ister.
// Tek meslektaş yanıtı hiçbir uçtan dönmez; toplu sonucun okunuşu sunucuda denetime düşer
// (K-459). Komutlar `exclusive`; her yazma anahtarın tamamını tazeler.

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

export type StaffFeedbackTemplateBody = JsonBody<'createStaffFeedbackTemplate'>
export type CreateStaffFeedbackAssignmentBody = JsonBody<'createStaffFeedbackAssignment'>
export type StaffFeedbackResponseBody = JsonBody<'recordStaffFeedbackResponse'>
export type StaffFeedbackOverview = Ok<'getStaffFeedbackOverview'>['data']
export type StaffFeedbackTemplate = NonNullable<StaffFeedbackOverview['template']>
export type StaffFeedbackSubjectRow = Ok<'listStaffFeedbackSubjects'>['data'][number]
export type StaffFeedbackSubjectQuery = Query<'listStaffFeedbackSubjects'>
export type StaffFeedbackAssignmentRow = Ok<'listStaffFeedbackAssignments'>['data'][number]
export type StaffFeedbackAssignmentQuery = Query<'listStaffFeedbackAssignments'>
export type StaffFeedbackResultView = Ok<'getStaffFeedbackResult'>['data']
export type StaffFeedbackSettingsView = Ok<'getStaffFeedbackSettings'>['data']

export const STAFF_FEEDBACK_KEY = ['finance', 'staff-feedback'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

const ifMatchHeaders = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

/** Dönemin şablonu, atanan/yanıtlanan oranı ve anonimlik eşiği. */
export function useStaffFeedbackOverview(periodId: string | null, enabled = true) {
  return useApiQuery({
    key: [...STAFF_FEEDBACK_KEY, 'overview', periodId],
    enabled: enabled && periodId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/performance-periods/{periodId}/staff-feedback', {
        params: { path: { periodId: periodId ?? '' } },
        signal,
      }),
  })
}

/** Dönemin değerlendirilenleri ve atanan/yanıtlanan sayıları. */
export function useStaffFeedbackSubjects(
  periodId: string | null,
  query: StaffFeedbackSubjectQuery,
  enabled = true,
) {
  return useFinanceListQuery(
    {
      key: [...STAFF_FEEDBACK_KEY, 'subjects', periodId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/performance-periods/{periodId}/staff-feedback-subjects', {
          params: { path: { periodId: periodId ?? '' }, query },
          signal,
        }),
    },
    { enabled: enabled && periodId !== null },
  )
}

/** Dönemin değerlendiren atamaları (cevapsız). */
export function useStaffFeedbackAssignments(
  periodId: string | null,
  query: StaffFeedbackAssignmentQuery,
  enabled = true,
) {
  return useFinanceListQuery(
    {
      key: [...STAFF_FEEDBACK_KEY, 'assignments', periodId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/performance-periods/{periodId}/staff-feedback-assignments', {
          params: { path: { periodId: periodId ?? '' }, query },
          signal,
        }),
    },
    { enabled: enabled && periodId !== null },
  )
}

/** Değerlendirilenin toplu sonucu; her okuma sunucuda denetime yazılır (K-459). */
export function useStaffFeedbackResult(
  periodId: string | null,
  membershipId: string | null,
  enabled = true,
) {
  return useApiQuery({
    key: [...STAFF_FEEDBACK_KEY, 'result', periodId, membershipId],
    enabled: enabled && periodId !== null && membershipId !== null,
    request: (client, signal) =>
      client.GET(
        '/api/v1/finance/performance-periods/{periodId}/staff-feedback-results/{membershipId}',
        {
          params: { path: { periodId: periodId ?? '', membershipId: membershipId ?? '' } },
          signal,
        },
      ),
  })
}

export function useStaffFeedbackSettings(enabled = true) {
  return useApiQuery({
    key: [...STAFF_FEEDBACK_KEY, 'settings'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/staff-feedback-settings', { signal }),
  })
}

export function useSetStaffFeedbackSettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number; peerAnonymityThreshold: number },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/staff-feedback-settings', {
        params: { header: ifMatchHeaders(headers) },
        body: { peerAnonymityThreshold: input.peerAnonymityThreshold },
      }),
    invalidates: [STAFF_FEEDBACK_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateStaffFeedbackTemplate() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; body: StaffFeedbackTemplateBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/performance-periods/{periodId}/staff-feedback-template', {
        params: {
          path: { periodId: input.periodId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [STAFF_FEEDBACK_KEY],
    exclusive: true,
  })
}

export function useUpdateStaffFeedbackTemplate() {
  return useApiCommand({
    request: (
      client,
      input: { templateId: string; version: number; body: StaffFeedbackTemplateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/staff-feedback-templates/{templateId}', {
        params: { path: { templateId: input.templateId }, header: ifMatchHeaders(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_FEEDBACK_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateStaffFeedbackAssignment() {
  return useApiCommand({
    request: (
      client,
      input: { periodId: string; body: CreateStaffFeedbackAssignmentBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/performance-periods/{periodId}/staff-feedback-assignments', {
        params: {
          path: { periodId: input.periodId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [STAFF_FEEDBACK_KEY],
    exclusive: true,
  })
}

export function useRemoveStaffFeedbackAssignment() {
  return useApiCommand({
    request: (client, input: { assignmentId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/staff-feedback-assignments/{assignmentId}', {
        params: { path: { assignmentId: input.assignmentId }, header: ifMatchHeaders(headers) },
      }),
    invalidates: [STAFF_FEEDBACK_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useRecordStaffFeedbackResponse() {
  return useApiCommand({
    request: (
      client,
      input: { assignmentId: string; version: number; body: StaffFeedbackResponseBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/staff-feedback-assignments/{assignmentId}/response', {
        params: { path: { assignmentId: input.assignmentId }, header: ifMatchHeaders(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_FEEDBACK_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useWithdrawStaffFeedbackResponse() {
  return useApiCommand({
    request: (
      client,
      input: { assignmentId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/staff-feedback-assignments/{assignmentId}/withdraw', {
        params: { path: { assignmentId: input.assignmentId }, header: ifMatchHeaders(headers) },
        body: { reason: input.reason },
      }),
    invalidates: [STAFF_FEEDBACK_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
