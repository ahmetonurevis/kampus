import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { LEAVE_CALENDAR_KEY } from './use-finance-leave-calendar.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Okul etkinlik takvimi kancaları (`/finance/school-calendar*`; DOM-FIN-163, ON-090). Etkinlik
// ekleme `Idempotency-Key`; düzenleme, yayım ve iptal `If-Match` ile gider. Tatil izin takviminde de
// görünür (K-545): her yazma takvim anahtarıyla birlikte izin takvimini de tazeler.

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

export type SchoolEventCreateBody = JsonBody<'createSchoolEvent'>
export type SchoolEventUpdateBody = JsonBody<'updateSchoolEvent'>
export type SchoolEventCancelBody = JsonBody<'cancelSchoolEvent'>
export type SchoolCalendarQuery = Query<'getSchoolCalendar'>
export type SchoolEventListQuery = Query<'listSchoolEvents'>
export type SchoolCalendar = Ok<'getSchoolCalendar'>['data']
export type SchoolEvent = SchoolCalendar['events'][number]
export type SchoolCalendarLink = SchoolCalendar['links'][number]
export type MySchoolCalendar = Ok<'getMySchoolCalendar'>['data']
export type SchoolCalendarRange = Query<'exportSchoolCalendarIcal'>

export const SCHOOL_CALENDAR_KEY = ['finance', 'school-calendar'] as const
const INVALIDATES = [SCHOOL_CALENDAR_KEY, LEAVE_CALENDAR_KEY]
const MESSAGES = {
  version_conflict: 'Etkinlik başka biri tarafından değiştirildi. Takvim güncellendi.',
}
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

/** Ay ve hafta görünümü (yönetici ve ön büro); `null` sorgu kapalı. */
export function useSchoolCalendar(query: SchoolCalendarQuery | null) {
  return useApiQuery({
    key: [...SCHOOL_CALENDAR_KEY, 'range', query],
    enabled: query !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/school-calendar', {
        params: { query: query ?? { from: '', to: '' } },
        signal,
      }),
  })
}

/** Liste görünümü (yönetici ve ön büro): sayfalı. */
export function useSchoolEvents(query: SchoolEventListQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...SCHOOL_CALENDAR_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/school-calendar/events', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Öğretmen, veli ve öğrencinin kendi takvimi; `null` sorgu kapalı. */
export function useMySchoolCalendar(query: SchoolCalendarRange | null) {
  return useApiQuery({
    key: [...SCHOOL_CALENDAR_KEY, 'my', query],
    enabled: query !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/school-calendar/my', {
        params: { query: query ?? { from: '', to: '' } },
        signal,
      }),
  })
}

/** iCal dosyasını metin olarak alır; yazma değildir, sorgu tazelenmez. Hata mesajı toast olur. */
export function useSchoolCalendarIcal() {
  return useApiCommand({
    request: (client, query: SchoolCalendarRange) =>
      client.GET('/api/v1/finance/school-calendar/ical', { params: { query }, parseAs: 'text' }),
    invalidates: [],
  })
}

export function useCreateSchoolEvent() {
  return useApiCommand({
    request: (client, body: SchoolEventCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/school-calendar/events', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useUpdateSchoolEvent() {
  return useApiCommand({
    request: (
      client,
      input: { eventId: string; version: number; body: SchoolEventUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/school-calendar/events/{eventId}', {
        params: { path: { eventId: input.eventId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function usePublishSchoolEvent() {
  return useApiCommand({
    request: (client, input: { eventId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/school-calendar/events/{eventId}/publish', {
        params: { path: { eventId: input.eventId }, header: versioned(headers) },
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCancelSchoolEvent() {
  return useApiCommand({
    request: (
      client,
      input: { eventId: string; version: number; body: SchoolEventCancelBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/school-calendar/events/{eventId}/cancel', {
        params: { path: { eventId: input.eventId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
