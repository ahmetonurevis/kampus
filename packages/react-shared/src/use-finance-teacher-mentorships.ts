import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Yeni öğretmen mentorluğu kancaları (`/finance/teacher-mentorships`,
// `/finance/teacher-mentorship-settings`, `/finance/teacher-mentorship-summary`; DOM-FIN-136,
// ON-219). Yalnız yönetici (K-465). Eşleşme açılışı `Idempotency-Key`; görüşme `Idempotency-Key`
// ve eşleşmenin `If-Match` sürümü; madde, görüşme arşivi ve kapanış eşleşmenin sürümüyle yapılır.
// Eşleşme okuması sunucuda denetime düşer. Her yazma mentorluk anahtarının tamamını tazeler.

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

export type CreateMentorshipBody = JsonBody<'createTeacherMentorship'>
export type MentorshipMeetingBody = JsonBody<'addTeacherMentorshipMeeting'>
export type MentorshipSettingsBody = JsonBody<'updateTeacherMentorshipSettings'>
export type MentorshipRow = Ok<'listTeacherMentorships'>['data'][number]
export type MentorshipDetail = Ok<'getTeacherMentorship'>['data']
export type MentorshipChecklistItem = MentorshipDetail['checklistItems'][number]
export type MentorshipMeeting = MentorshipDetail['meetings'][number]
export type MentorshipSettings = Ok<'getTeacherMentorshipSettings'>['data']
export type MentorshipSummary = Ok<'getTeacherMentorshipSummary'>['data']
export type MentorshipQuery = Query<'listTeacherMentorships'>
export type MentorshipOnboardingOption =
  Ok<'listTeacherMentorshipOnboardingOptions'>['data'][number]

export const TEACHER_MENTORSHIPS_KEY = ['finance', 'teacher-mentorships'] as const
const MESSAGES = {
  version_conflict: 'Eşleşme başka biri tarafından değiştirildi. Bilgiler güncellendi.',
}

/** Eşleşme listesi; her okuma sunucuda denetime yazılır (K-465). */
export function useTeacherMentorships(query: MentorshipQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...TEACHER_MENTORSHIPS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/teacher-mentorships', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Tek eşleşme, görüşmeleri ve kontrol listesi; okuma denetime yazılır. */
export function useTeacherMentorship(mentorshipId: string, enabled = true) {
  return useApiQuery({
    key: [...TEACHER_MENTORSHIPS_KEY, 'detail', mentorshipId],
    enabled: enabled && mentorshipId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/teacher-mentorships/{mentorshipId}', {
        params: { path: { mentorshipId } },
        signal,
      }),
  })
}

export function useTeacherMentorshipSummary(enabled = true) {
  return useApiQuery({
    key: [...TEACHER_MENTORSHIPS_KEY, 'summary'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/teacher-mentorship-summary', { signal }),
  })
}

/** Bağlanabilecek işe başlama listeleri (kabul edilmiş, hesabı bağlı teklifler). */
export function useMentorshipOnboardingOptions(enabled = true) {
  return useApiQuery({
    key: [...TEACHER_MENTORSHIPS_KEY, 'onboarding-options'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/teacher-mentorship-onboarding-options', { signal }),
  })
}

export function useTeacherMentorshipSettings(enabled = true) {
  return useApiQuery({
    key: [...TEACHER_MENTORSHIPS_KEY, 'settings'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/teacher-mentorship-settings', { signal }),
  })
}

export function useUpdateTeacherMentorshipSettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number | null; body: MentorshipSettingsBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/teacher-mentorship-settings', {
        params: {
          header: {
            'idempotency-key': headers['idempotency-key'],
            ...(input.version === null ? {} : { 'if-match': requireIfMatch(headers) }),
          },
        },
        body: input.body,
      }),
    invalidates: [TEACHER_MENTORSHIPS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateTeacherMentorship() {
  return useApiCommand({
    request: (client, body: CreateMentorshipBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/teacher-mentorships', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [TEACHER_MENTORSHIPS_KEY],
    exclusive: true,
  })
}

/** Görüşme kaydı (K-464): `Idempotency-Key` ve eşleşmenin sürümü. */
export function useAddMentorshipMeeting() {
  return useApiCommand({
    request: (
      client,
      input: { mentorshipId: string; version: number; body: MentorshipMeetingBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/teacher-mentorships/{mentorshipId}/meetings', {
        params: {
          path: { mentorshipId: input.mentorshipId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [TEACHER_MENTORSHIPS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveMentorshipMeeting() {
  return useApiCommand({
    request: (
      client,
      input: { mentorshipId: string; meetingId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.POST(
        '/api/v1/finance/teacher-mentorships/{mentorshipId}/meetings/{meetingId}/archive',
        {
          params: {
            path: { mentorshipId: input.mentorshipId, meetingId: input.meetingId },
            header: {
              'idempotency-key': headers['idempotency-key'],
              'if-match': requireIfMatch(headers),
            },
          },
          body: {},
        },
      ),
    invalidates: [TEACHER_MENTORSHIPS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Madde işareti (K-465): tamamla ya da geri al; eşleşmenin sürümüyle. */
export function useSetMentorshipChecklistItem() {
  return useApiCommand({
    request: (
      client,
      input: {
        mentorshipId: string
        itemId: string
        verb: 'complete' | 'reopen'
        version: number
      },
      headers: CommandHeaders,
    ) => {
      const params = {
        path: { mentorshipId: input.mentorshipId, itemId: input.itemId },
        header: {
          'idempotency-key': headers['idempotency-key'],
          'if-match': requireIfMatch(headers),
        },
      }
      return input.verb === 'complete'
        ? client.POST(
            '/api/v1/finance/teacher-mentorships/{mentorshipId}/checklist/{itemId}/complete',
            { params, body: {} },
          )
        : client.POST(
            '/api/v1/finance/teacher-mentorships/{mentorshipId}/checklist/{itemId}/reopen',
            { params, body: {} },
          )
    },
    invalidates: [TEACHER_MENTORSHIPS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Tamamlama ya da gerekçeli erken sonlandırma (K-463). */
export function useCloseTeacherMentorship() {
  return useApiCommand({
    request: (
      client,
      input: { mentorshipId: string; version: number; closedOn: string; reason: string | null },
      headers: CommandHeaders,
    ) => {
      const params = {
        path: { mentorshipId: input.mentorshipId },
        header: {
          'idempotency-key': headers['idempotency-key'],
          'if-match': requireIfMatch(headers),
        },
      }
      return input.reason === null
        ? client.POST('/api/v1/finance/teacher-mentorships/{mentorshipId}/complete', {
            params,
            body: { closedOn: input.closedOn },
          })
        : client.POST('/api/v1/finance/teacher-mentorships/{mentorshipId}/end', {
            params,
            body: { closedOn: input.closedOn, reason: input.reason },
          })
    },
    invalidates: [TEACHER_MENTORSHIPS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
