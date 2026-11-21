import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Personel memnuniyet anketi kancaları (`/finance/staff-surveys…`; DOM-FIN-143, ON-191). Yönetim
// kancaları yalnız yöneticiye, `assigned` ve yanıt kancası bütün personele açıktır. Taslak, yeni
// sürüm ve yanıt `Idempotency-Key`; düzeltme, yayım ve kaldırma `If-Match` ister. Tek yanıt
// hiçbir uçtan dönmez; sonucun okunuşu sunucuda denetime düşer (K-485, K-486).

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

export type StaffSurveyCreateBody = JsonBody<'createStaffSurvey'>
export type StaffSurveyUpdateBody = JsonBody<'updateStaffSurvey'>
export type StaffSurveyAnswersBody = JsonBody<'respondStaffSurvey'>
export type StaffSurveyRow = Ok<'listStaffSurveys'>['data'][number]
export type StaffSurveyListQuery = Query<'listStaffSurveys'>
export type StaffSurveyDetail = Ok<'getStaffSurvey'>['data']
export type StaffSurveyResultView = Ok<'getStaffSurveyResult'>['data']
export type AssignedStaffSurvey = Ok<'listAssignedStaffSurveys'>['data'][number]

export const STAFF_SURVEYS_KEY = ['finance', 'staff-surveys'] as const
const MESSAGES = {
  version_conflict: 'Anket başka biri tarafından değiştirildi. Liste güncellendi.',
}

const ifMatchHeaders = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})
const keyHeader = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })

export function useStaffSurveys(query: StaffSurveyListQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_SURVEYS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/staff-surveys', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useStaffSurvey(surveyId: string | null) {
  return useApiQuery({
    key: [...STAFF_SURVEYS_KEY, 'detail', surveyId],
    enabled: surveyId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/staff-surveys/{surveyId}', {
        params: { path: { surveyId: surveyId ?? '' } },
        signal,
      }),
  })
}

/** Toplu sonuç; her okuma sunucuda denetime yazılır (K-486). `unit`: birim, `none` ya da hepsi. */
export function useStaffSurveyResult(surveyId: string | null, unit: string | null) {
  return useApiQuery({
    key: [...STAFF_SURVEYS_KEY, 'result', surveyId, unit],
    enabled: surveyId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/staff-surveys/{surveyId}/results', {
        params: { path: { surveyId: surveyId ?? '' }, query: unit === null ? {} : { unit } },
        signal,
      }),
  })
}

/** Oturumdaki personelin yanıtlayacağı anketler (K-485). */
export function useAssignedStaffSurveys(enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_SURVEYS_KEY, 'assigned'],
      request: (client, signal) =>
        client.GET('/api/v1/finance/staff-surveys/assigned', {
          params: { query: { page: 1, pageSize: 50 } },
          signal,
        }),
    },
    { enabled },
  )
}

export function useCreateStaffSurvey() {
  return useApiCommand({
    request: (client, body: StaffSurveyCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-surveys', {
        params: { header: keyHeader(headers) },
        body,
      }),
    invalidates: [STAFF_SURVEYS_KEY],
    exclusive: true,
  })
}

export function useUpdateStaffSurvey() {
  return useApiCommand({
    request: (
      client,
      input: { surveyId: string; version: number; body: StaffSurveyUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/staff-surveys/{surveyId}', {
        params: { path: { surveyId: input.surveyId }, header: ifMatchHeaders(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_SURVEYS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function usePublishStaffSurvey() {
  return useApiCommand({
    request: (client, input: { surveyId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-surveys/{surveyId}/publish', {
        params: { path: { surveyId: input.surveyId }, header: ifMatchHeaders(headers) },
      }),
    invalidates: [STAFF_SURVEYS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveStaffSurvey() {
  return useApiCommand({
    request: (client, input: { surveyId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/staff-surveys/{surveyId}', {
        params: { path: { surveyId: input.surveyId }, header: ifMatchHeaders(headers) },
      }),
    invalidates: [STAFF_SURVEYS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCopyStaffSurvey() {
  return useApiCommand({
    request: (client, input: { surveyId: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-surveys/{surveyId}/copy', {
        params: { path: { surveyId: input.surveyId }, header: keyHeader(headers) },
      }),
    invalidates: [STAFF_SURVEYS_KEY],
    exclusive: true,
  })
}

/** Personelin kendi yanıtı (K-485): yanıt bir kez gönderilir, cevaplar geri dönmez. */
export function useRespondStaffSurvey() {
  return useApiCommand({
    request: (
      client,
      input: { surveyId: string; body: StaffSurveyAnswersBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/staff-surveys/{surveyId}/responses', {
        params: { path: { surveyId: input.surveyId }, header: keyHeader(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_SURVEYS_KEY],
    exclusive: true,
  })
}
