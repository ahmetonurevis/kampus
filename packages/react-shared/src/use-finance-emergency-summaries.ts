import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Acil durum özeti kancaları (`/finance/emergency-summaries/*`; DOM-FIN-155, ON-165). Açma
// `Idempotency-Key`; düzeltme, onay ve arşiv `If-Match` ile gider. Kart okumaları (sınıf, PDF,
// tam telefon) her çağrıda sunucuda öğrenci başına denetime düştüğü için sorgu önbelleğine
// alınmaz: kullanıcının açtığı anda bir kez çağrılır, tam telefon yalnız bileşen belleğinde kalır.

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

export type EmergencySummaryCreateBody = JsonBody<'createEmergencySummary'>
export type EmergencySummaryRow = Ok<'listEmergencySummaries'>['data'][number]
export type EmergencySummaryDetail = Ok<'getEmergencySummary'>['data']
export type EmergencySummaryQuery = Query<'listEmergencySummaries'>
export type EmergencyClass = Ok<'listEmergencySummaryClasses'>['data'][number]
export type EmergencyClassCards = Ok<'getEmergencyClassCards'>['data']
export type EmergencyCard = EmergencyClassCards['cards'][number]
export type EmergencyContact = EmergencyCard['contacts'][number]
export type RevealedEmergencyContact = Ok<'revealEmergencyContact'>['data']
export type EmergencyCardPurposeInput = NonNullable<Query<'getEmergencyClassCards'>['purpose']>

export const EMERGENCY_SUMMARIES_KEY = ['finance', 'emergency-summaries'] as const
const MESSAGES = {
  version_conflict: 'Özet başka biri tarafından değiştirildi. Özet güncellendi.',
}
export const EMERGENCY_CONTACT_MESSAGES = {
  rate_limited: 'Kısa sürede çok fazla telefon açtınız. Bir dakika bekleyip yeniden deneyin.',
}

export function useEmergencySummaries(query: EmergencySummaryQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...EMERGENCY_SUMMARIES_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/emergency-summaries', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useEmergencySummary(summaryId: string, enabled = true) {
  return useApiQuery({
    key: [...EMERGENCY_SUMMARIES_KEY, 'detail', summaryId],
    enabled: enabled && summaryId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/emergency-summaries/{summaryId}', {
        params: { path: { summaryId } },
        signal,
      }),
  })
}

/** Görülebilen sınıflar ve özet sayıları; sağlık bilgisi taşımaz, denetlenmez. */
export function useEmergencyClasses(enabled = true) {
  return useApiQuery({
    key: [...EMERGENCY_SUMMARIES_KEY, 'classes'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/emergency-summaries/classes', { signal }),
  })
}

/** Sınıfın kartları (ekran ya da PDF); her çağrı denetime düşer. */
export function useLoadEmergencyClassCards() {
  return useApiCommand({
    request: (client, input: { classId: string; purpose: EmergencyCardPurposeInput }) =>
      client.GET('/api/v1/finance/emergency-summaries/classes/{classId}', {
        params: { path: { classId: input.classId }, query: { purpose: input.purpose } },
      }),
    invalidates: [],
  })
}

/** Tam telefon; `Idempotency-Key` gönderilmez, her açılış ayrı denetim kaydıdır. */
export function useRevealEmergencyContact() {
  return useApiCommand({
    request: (client, input: { studentId: string; position: number }) =>
      client.POST(
        '/api/v1/finance/emergency-summaries/students/{studentId}/contacts/{position}/reveal',
        { params: { path: { studentId: input.studentId, position: input.position } } },
      ),
    invalidates: [],
    messages: EMERGENCY_CONTACT_MESSAGES,
  })
}

export function useCreateEmergencySummary() {
  return useApiCommand({
    request: (client, body: EmergencySummaryCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/emergency-summaries', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [EMERGENCY_SUMMARIES_KEY],
    exclusive: true,
  })
}

const versionedHeader = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useUpdateEmergencySummary() {
  return useApiCommand({
    request: (
      client,
      input: { summaryId: string; version: number; actionText: string },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/emergency-summaries/{summaryId}', {
        params: { path: { summaryId: input.summaryId }, header: versionedHeader(headers) },
        body: { actionText: input.actionText },
      }),
    invalidates: [EMERGENCY_SUMMARIES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useApproveEmergencySummary() {
  return useApiCommand({
    request: (client, input: { summaryId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/emergency-summaries/{summaryId}/approve', {
        params: { path: { summaryId: input.summaryId }, header: versionedHeader(headers) },
        body: {},
      }),
    invalidates: [EMERGENCY_SUMMARIES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveEmergencySummary() {
  return useApiCommand({
    request: (client, input: { summaryId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/emergency-summaries/{summaryId}', {
        params: { path: { summaryId: input.summaryId }, header: versionedHeader(headers) },
      }),
    invalidates: [EMERGENCY_SUMMARIES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
