import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Ders gözlem formu kancaları (`/finance/lesson-observation-templates`,
// `/finance/lesson-observations`; DOM-FIN-130, ON-206). Yazma yalnız yönetici (K-447). Form ve
// gözlem açmak `Idempotency-Key`, düzeltme, yeni sürüm, arşiv ve tamamlama `If-Match` ister.
// Gözlem okuması sunucuda denetime düşer; puanı sunucu hesaplar. Komutlar `exclusive`.

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

export type LessonObservationTemplateBody = JsonBody<'createLessonObservationTemplate'>
export type UpdateLessonObservationTemplateBody = JsonBody<'updateLessonObservationTemplate'>
export type CreateLessonObservationBody = JsonBody<'createLessonObservation'>
export type UpdateLessonObservationBody = JsonBody<'updateLessonObservation'>
export type LessonObservationTemplate =
  operations['listLessonObservationTemplates']['responses'][200]['content']['application/json']['data'][number]
export type LessonObservation =
  operations['listLessonObservations']['responses'][200]['content']['application/json']['data'][number]
export type LessonObservationDetail =
  operations['getLessonObservation']['responses'][200]['content']['application/json']['data']
export type LessonObservationTemplateQuery = Query<'listLessonObservationTemplates'>
export type LessonObservationQuery = Query<'listLessonObservations'>

export const LESSON_OBSERVATIONS_KEY = ['finance', 'lesson-observations'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useLessonObservationTemplates(
  query: LessonObservationTemplateQuery,
  enabled = true,
) {
  return useFinanceListQuery(
    {
      key: [...LESSON_OBSERVATIONS_KEY, 'templates', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/lesson-observation-templates', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Gözlem listesi; her okuma sunucuda denetime yazılır (K-447). */
export function useLessonObservations(query: LessonObservationQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...LESSON_OBSERVATIONS_KEY, 'observations', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/lesson-observations', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useCreateLessonObservationTemplate() {
  return useApiCommand({
    request: (client, body: LessonObservationTemplateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lesson-observation-templates', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [LESSON_OBSERVATIONS_KEY],
    exclusive: true,
  })
}

export function useCreateLessonObservation() {
  return useApiCommand({
    request: (client, body: CreateLessonObservationBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lesson-observations', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [LESSON_OBSERVATIONS_KEY],
    exclusive: true,
  })
}

export function useUpdateLessonObservation() {
  return useApiCommand({
    request: (
      client,
      input: { observationId: string; version: number; body: UpdateLessonObservationBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/lesson-observations/{observationId}', {
        params: {
          path: { observationId: input.observationId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [LESSON_OBSERVATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCompleteLessonObservation() {
  return useApiCommand({
    request: (client, input: { observationId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lesson-observations/{observationId}/complete', {
        params: {
          path: { observationId: input.observationId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: {},
      }),
    invalidates: [LESSON_OBSERVATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Tek gözlem ve sürümünün ölçütleri (düzenleme penceresi); okuma denetime yazılır (K-447). */
export function useLessonObservation(observationId: string | null) {
  return useFinanceListQuery(
    {
      key: [...LESSON_OBSERVATIONS_KEY, 'observation', observationId],
      request: (client, signal) =>
        client.GET('/api/v1/finance/lesson-observations/{observationId}', {
          params: { path: { observationId: observationId ?? '' } },
          signal,
        }),
    },
    { enabled: observationId !== null, keepPreviousPage: false },
  )
}

/** Kullanılmamış son sürümün düzeltmesi (K-445); kullanılmış sürüm 409 `observation_template_used`. */
export function useUpdateLessonObservationTemplate() {
  return useApiCommand({
    request: (
      client,
      input: { templateId: string; version: number; body: UpdateLessonObservationTemplateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/lesson-observation-templates/{templateId}', {
        params: {
          path: { templateId: input.templateId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [LESSON_OBSERVATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Yeni sürüm (K-445): eski sürüm ve gözlemleri değişmez. */
export function useCreateLessonObservationTemplateVersion() {
  return useApiCommand({
    request: (
      client,
      input: { templateId: string; version: number; body: LessonObservationTemplateBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/lesson-observation-templates/{templateId}/versions', {
        params: {
          path: { templateId: input.templateId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [LESSON_OBSERVATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveLessonObservationTemplate() {
  return useApiCommand({
    request: (client, input: { templateId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lesson-observation-templates/{templateId}/archive', {
        params: {
          path: { templateId: input.templateId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: {},
      }),
    invalidates: [LESSON_OBSERVATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Taslak arşivi (K-446); tamamlanan gözlem 409. */
export function useArchiveLessonObservation() {
  return useApiCommand({
    request: (client, input: { observationId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lesson-observations/{observationId}/archive', {
        params: {
          path: { observationId: input.observationId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: {},
      }),
    invalidates: [LESSON_OBSERVATIONS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
