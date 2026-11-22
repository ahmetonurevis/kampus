import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Öğretmen geri bildirim anketi kancaları (`/finance/teacher-feedback-…`; DOM-FIN-159, ON-213).
// Yönetim, sonuç ve eğilim kancaları yalnız yöneticiye; "sonuçlarım" öğretmene; `assigned` ve
// yanıt kancası öğrenci ve veliye açıktır. Taslak ve yanıt `Idempotency-Key`; düzeltme, yayım,
// kaldırma ve kapatma `If-Match` ister. Tek yanıt hiçbir uçtan dönmez; sonucun okunuşu sunucuda
// denetime düşer (K-532, K-533).

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

export type TeacherFeedbackCreateBody = JsonBody<'createTeacherFeedbackSurvey'>
export type TeacherFeedbackUpdateBody = JsonBody<'updateTeacherFeedbackSurvey'>
export type TeacherFeedbackAnswersBody = JsonBody<'respondTeacherFeedbackSurvey'>
export type TeacherFeedbackRow = Ok<'listTeacherFeedbackSurveys'>['data'][number]
export type TeacherFeedbackListQuery = Query<'listTeacherFeedbackSurveys'>
export type TeacherFeedbackDetail = Ok<'getTeacherFeedbackSurvey'>['data']
export type TeacherFeedbackResultsView = Ok<'getTeacherFeedbackResults'>['data']
export type TeacherFeedbackTeacherView = TeacherFeedbackResultsView['teachers'][number]
export type TeacherFeedbackTrendView = Ok<'getTeacherFeedbackTrend'>['data']
export type MyTeacherFeedbackResults = Ok<'listMyTeacherFeedbackResults'>['data']
export type AssignedTeacherFeedback = Ok<'listAssignedTeacherFeedbackSurveys'>['data'][number]

export const TEACHER_FEEDBACK_KEY = ['finance', 'teacher-feedback'] as const
const MESSAGES = {
  version_conflict: 'Anket başka biri tarafından değiştirildi. Liste güncellendi.',
}

const ifMatchHeaders = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})
const keyHeader = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })

export function useTeacherFeedbackSurveys(query: TeacherFeedbackListQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...TEACHER_FEEDBACK_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/teacher-feedback-surveys', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useTeacherFeedbackSurvey(surveyId: string | null) {
  return useApiQuery({
    key: [...TEACHER_FEEDBACK_KEY, 'detail', surveyId],
    enabled: surveyId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/teacher-feedback-surveys/{surveyId}', {
        params: { path: { surveyId: surveyId ?? '' } },
        signal,
      }),
  })
}

/** Öğretmen başına sonuç; her okuma sunucuda denetime yazılır (K-532). */
export function useTeacherFeedbackResults(surveyId: string | null) {
  return useApiQuery({
    key: [...TEACHER_FEEDBACK_KEY, 'results', surveyId],
    enabled: surveyId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/teacher-feedback-surveys/{surveyId}/results', {
        params: { path: { surveyId: surveyId ?? '' } },
        signal,
      }),
  })
}

/** Bir öğretmenin dönemler arası eğilimi (yönetici; K-532). */
export function useTeacherFeedbackTrend(teacherId: string | null) {
  return useApiQuery({
    key: [...TEACHER_FEEDBACK_KEY, 'trend', teacherId],
    enabled: teacherId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/teacher-feedback-results/trend', {
        params: { query: { teacherId: teacherId ?? '' } },
        signal,
      }),
  })
}

/** Öğretmenin kendi sonuçları ve eğilimi (K-532). */
export function useMyTeacherFeedbackResults(enabled = true) {
  return useApiQuery({
    key: [...TEACHER_FEEDBACK_KEY, 'mine'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/teacher-feedback-results/mine', { signal }),
  })
}

/** Öğrenci ya da velinin değerlendireceği öğretmenler (K-533). */
export function useAssignedTeacherFeedback(enabled = true) {
  return useApiQuery({
    key: [...TEACHER_FEEDBACK_KEY, 'assigned'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/teacher-feedback-surveys/assigned', { signal }),
  })
}

export function useCreateTeacherFeedbackSurvey() {
  return useApiCommand({
    request: (client, body: TeacherFeedbackCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/teacher-feedback-surveys', {
        params: { header: keyHeader(headers) },
        body,
      }),
    invalidates: [TEACHER_FEEDBACK_KEY],
    exclusive: true,
  })
}

export function useUpdateTeacherFeedbackSurvey() {
  return useApiCommand({
    request: (
      client,
      input: { surveyId: string; version: number; body: TeacherFeedbackUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/teacher-feedback-surveys/{surveyId}', {
        params: { path: { surveyId: input.surveyId }, header: ifMatchHeaders(headers) },
        body: input.body,
      }),
    invalidates: [TEACHER_FEEDBACK_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

type VersionedInput = { surveyId: string; version: number }

export function usePublishTeacherFeedbackSurvey() {
  return useApiCommand({
    request: (client, input: VersionedInput, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/teacher-feedback-surveys/{surveyId}/publish', {
        params: { path: { surveyId: input.surveyId }, header: ifMatchHeaders(headers) },
      }),
    invalidates: [TEACHER_FEEDBACK_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCloseTeacherFeedbackSurvey() {
  return useApiCommand({
    request: (client, input: VersionedInput, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/teacher-feedback-surveys/{surveyId}/close', {
        params: { path: { surveyId: input.surveyId }, header: ifMatchHeaders(headers) },
      }),
    invalidates: [TEACHER_FEEDBACK_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveTeacherFeedbackSurvey() {
  return useApiCommand({
    request: (client, input: VersionedInput, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/teacher-feedback-surveys/{surveyId}', {
        params: { path: { surveyId: input.surveyId }, header: ifMatchHeaders(headers) },
      }),
    invalidates: [TEACHER_FEEDBACK_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Öğrenci ya da velinin bir öğretmen için yanıtı (K-533): cevaplar geri dönmez. */
export function useRespondTeacherFeedback() {
  return useApiCommand({
    request: (
      client,
      input: { surveyId: string; body: TeacherFeedbackAnswersBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/teacher-feedback-surveys/{surveyId}/responses', {
        params: { path: { surveyId: input.surveyId }, header: keyHeader(headers) },
        body: input.body,
      }),
    invalidates: [TEACHER_FEEDBACK_KEY],
    exclusive: true,
  })
}
