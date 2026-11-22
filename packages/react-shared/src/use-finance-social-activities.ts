import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Sosyal etkinlik ve gönüllülük saati kancaları (`/finance/social-activities*`; DOM-FIN-160,
// ON-170). Etkinlik, saat girişi ve beyan `Idempotency-Key`; düzenleme, arşiv, onay, ret ve ters
// kayıt `If-Match` ile gider; hedef ayarı ilk kayıtta sürümsüz, sonra sürümlü. Her yazma anahtarın
// tamamını tazeler. Belge verisi her istekte denetime düştüğü için komut olarak alınır.

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

export type SocialActivityBody = JsonBody<'createSocialActivity'>
export type SocialActivityUpdateBody = JsonBody<'updateSocialActivity'>
export type SocialHourEntryBody = JsonBody<'createSocialHours'>
export type SocialHourDeclarationBody = JsonBody<'declareSocialHour'>
export type SocialSettingsBody = JsonBody<'updateSocialActivitySettings'>
export type SocialActivityRow = Ok<'listSocialActivities'>['data'][number]
export type SocialHourRow = Ok<'listSocialHours'>['data'][number]
export type SocialSettings = Ok<'getSocialActivitySettings'>['data']
export type SocialClassRow = Ok<'listSocialActivityClasses'>['data'][number]
export type SocialClass = Ok<'getSocialActivityClass'>['data']
export type SocialStudent = Ok<'getSocialActivityStudent'>['data']
export type SocialCertificate = Ok<'getSocialActivityCertificate'>['data']
export type MySocialHours = Ok<'listMySocialHours'>['data'][number]
export type DeclarableSocialActivity = Ok<'listDeclarableSocialActivities'>['data'][number]
export type SocialActivityQuery = Query<'listSocialActivities'>
export type SocialHourQuery = Query<'listSocialHours'>
export type SocialClassQuery = Query<'getSocialActivityClass'>

export const SOCIAL_ACTIVITIES_KEY = ['finance', 'social-activities'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})
const created = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })

export function useSocialActivities(query: SocialActivityQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...SOCIAL_ACTIVITIES_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/social-activities', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useSocialHours(query: SocialHourQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...SOCIAL_ACTIVITIES_KEY, 'hours', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/social-activities/hours', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useSocialActivitySettings(enabled = true) {
  return useApiQuery({
    key: [...SOCIAL_ACTIVITIES_KEY, 'settings'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/social-activities/settings', { signal }),
  })
}

export function useSocialClasses(academicYear: number, enabled = true) {
  return useApiQuery({
    key: [...SOCIAL_ACTIVITIES_KEY, 'classes', academicYear],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/social-activities/classes', {
        params: { query: { academicYear } },
        signal,
      }),
  })
}

export function useSocialClass(classId: string, query: SocialClassQuery, enabled = true) {
  return useApiQuery({
    key: [...SOCIAL_ACTIVITIES_KEY, 'class', classId, query],
    enabled: enabled && classId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/social-activities/classes/{classId}', {
        params: { path: { classId }, query },
        signal,
      }),
  })
}

export function useSocialStudent(studentId: string, academicYear: number, enabled = true) {
  return useApiQuery({
    key: [...SOCIAL_ACTIVITIES_KEY, 'student', studentId, academicYear],
    enabled: enabled && studentId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/social-activities/students/{studentId}', {
        params: { path: { studentId }, query: { academicYear } },
        signal,
      }),
  })
}

/** Öğrenci ve veli görünümü (Oğuzhan'ın kabuğundaki ekran için hazır). */
export function useMySocialHours(academicYear: number, enabled = true) {
  return useApiQuery({
    key: [...SOCIAL_ACTIVITIES_KEY, 'my', academicYear],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/social-activities/my', {
        params: { query: { academicYear } },
        signal,
      }),
  })
}

export function useDeclarableSocialActivities(
  query: Query<'listDeclarableSocialActivities'>,
  enabled = true,
) {
  return useFinanceListQuery(
    {
      key: [...SOCIAL_ACTIVITIES_KEY, 'declarable', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/social-activities/my/activities', {
          params: { query },
          signal,
        }),
    },
    { enabled },
  )
}

/** Belge verisi; her çağrı denetime düşer. */
export function useLoadSocialCertificate() {
  return useApiCommand({
    request: (client, input: { studentId: string }) =>
      client.GET('/api/v1/finance/social-activities/students/{studentId}/certificate', {
        params: { path: { studentId: input.studentId } },
      }),
    invalidates: [],
  })
}

export function useCreateSocialActivity() {
  return useApiCommand({
    request: (client, body: SocialActivityBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/social-activities', {
        params: { header: created(headers) },
        body,
      }),
    invalidates: [SOCIAL_ACTIVITIES_KEY],
    exclusive: true,
  })
}

export function useUpdateSocialActivity() {
  return useApiCommand({
    request: (
      client,
      input: { activityId: string; version: number; body: SocialActivityUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/social-activities/{activityId}', {
        params: { path: { activityId: input.activityId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [SOCIAL_ACTIVITIES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveSocialActivity() {
  return useApiCommand({
    request: (client, input: { activityId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/social-activities/{activityId}', {
        params: { path: { activityId: input.activityId }, header: versioned(headers) },
      }),
    invalidates: [SOCIAL_ACTIVITIES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useCreateSocialHours() {
  return useApiCommand({
    request: (
      client,
      input: { activityId: string; body: SocialHourEntryBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/social-activities/{activityId}/hours', {
        params: { path: { activityId: input.activityId }, header: created(headers) },
        body: input.body,
      }),
    invalidates: [SOCIAL_ACTIVITIES_KEY],
    exclusive: true,
  })
}

/** Öğrenci beyanı (Oğuzhan'ın kabuğundaki ekran için hazır). */
export function useDeclareSocialHour() {
  return useApiCommand({
    request: (client, body: SocialHourDeclarationBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/social-activities/my/hours', {
        params: { header: created(headers) },
        body,
      }),
    invalidates: [SOCIAL_ACTIVITIES_KEY],
    exclusive: true,
  })
}

export function useApproveSocialHour() {
  return useApiCommand({
    request: (client, input: { entryId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/social-activities/hours/{entryId}/approve', {
        params: { path: { entryId: input.entryId }, header: versioned(headers) },
      }),
    invalidates: [SOCIAL_ACTIVITIES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useRejectSocialHour() {
  return useApiCommand({
    request: (
      client,
      input: { entryId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/social-activities/hours/{entryId}/reject', {
        params: { path: { entryId: input.entryId }, header: versioned(headers) },
        body: { reason: input.reason },
      }),
    invalidates: [SOCIAL_ACTIVITIES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useReverseSocialHour() {
  return useApiCommand({
    request: (
      client,
      input: { entryId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/social-activities/hours/{entryId}/reverse', {
        params: { path: { entryId: input.entryId }, header: versioned(headers) },
        body: { reason: input.reason },
      }),
    invalidates: [SOCIAL_ACTIVITIES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useSaveSocialActivitySettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number; body: SocialSettingsBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/social-activities/settings', {
        params: {
          header:
            input.version === 0
              ? { 'idempotency-key': headers['idempotency-key'] }
              : versioned(headers),
        },
        body: input.body,
      }),
    invalidates: [SOCIAL_ACTIVITIES_KEY],
    version: (input) => (input.version === 0 ? null : input.version),
    messages: MESSAGES,
  })
}
