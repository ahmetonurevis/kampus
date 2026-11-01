import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Rubrik kütüphanesi kancaları (`/api/v1/rubrics`; ADR 0004 karar 7, DOM-BEC-020, 022, IST-048):
 * liste, ayrıntı, oluşturma, yeni sürüm, taslak düzenleme, yayım ve arşiv. Yetki (sahip veya
 * yönetici), kurum türü ve sürüm kuralları sunucudadır; burada çağrı, önbellek tazeleme ve Türkçe
 * hata metni vardır. Düzenleme, yayım ve arşiv `If-Match` ister: okunan `rowVersion` yoksa istek
 * atılmaz (`requireIfMatch`). Her yazma kullanıcı eylemi başına `Idempotency-Key` taşır.
 */

export const RUBRICS_KEY = 'rubrics'
export const RUBRIC_INVALIDATES = [[RUBRICS_KEY]] as const

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type RubricListQuery = NonNullable<operations['listRubrics']['parameters']['query']>
export type RubricBody = JsonBody<'createRubric'>
export type RubricDraftPatch = JsonBody<'updateRubricDraft'>
export type RubricListItem = components['schemas']['RubricListItem']
export type RubricDetail = components['schemas']['RubricDetail']
export type RubricVersion = components['schemas']['RubricVersion']

/** Rubrik bu arada başkası tarafından değiştirildi (`If-Match` tutmadı): güncel hâli yüklenir. */
export const RUBRIC_CHANGED_MESSAGE =
  'Rubrik siz bakarken başkası tarafından değiştirildi. Güncel hâli yüklendi; yeniden deneyin.'

export const RUBRIC_MESSAGES = {
  version_conflict: RUBRIC_CHANGED_MESSAGE,
  rubric_version_immutable:
    'Yayımlanmış veya görevde kullanılmış rubrik sürümü değiştirilemez; yeni sürüm açın.',
  open_rubric_version_exists: 'Bu rubriğin üzerinde çalışılan bir taslağı zaten var.',
  rubric_version_exists: RUBRIC_CHANGED_MESSAGE,
  published_rubric_version_exists: RUBRIC_CHANGED_MESSAGE,
  rubric_version_not_published: 'Yalnız yayındaki rubrik sürümü arşivlenebilir.',
  not_found: 'Rubrik bulunamadı.',
} as const satisfies CommandMessages

/** Sunucu sayfalı liste; sorgu değişirken önceki sayfa ekranda kalır. */
export function useRubrics(query: RubricListQuery) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, RUBRICS_KEY, 'list', query),
    queryFn: ({ signal }) =>
      runRequest(() => client.GET('/api/v1/rubrics', { params: { query }, signal })),
    enabled: institutionId !== null,
    placeholderData: keepPreviousData,
  })
}

/** Rubrik ve bütün sürümleri; `rubricId` boşken istek atılmaz. */
export function useRubricDetail(rubricId: string) {
  return useApiQuery({
    key: [RUBRICS_KEY, 'detail', rubricId],
    request: (client, signal) =>
      client.GET('/api/v1/rubrics/{rubricId}', { params: { path: { rubricId } }, signal }),
    enabled: rubricId !== '',
  })
}

/** Oluşturma uçları `If-Match` kabul etmez (sunucu 400 `if_match_not_supported`). */
const unversioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
})

/** Sürümlü uçlar: okunan sürüm yoksa istek atılmaz. */
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function createRubricRequest(
  client: KampusClient,
  body: RubricBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/rubrics', { params: { header: unversioned(headers) }, body })
}

export interface CreateRubricVersionInput {
  rubricId: string
  body: RubricBody
}

export function createRubricVersionRequest(
  client: KampusClient,
  { rubricId, body }: CreateRubricVersionInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/rubrics/{rubricId}/versions', {
    params: { path: { rubricId }, header: unversioned(headers) },
    body,
  })
}

/** Sürüme yönelik komutların ortak girdisi; `version` sürümün okunan `rowVersion`'ıdır. */
export interface RubricVersionTarget {
  rubricId: string
  versionId: string
  version: number
}

export interface UpdateRubricDraftInput extends RubricVersionTarget {
  patch: RubricDraftPatch
}

export function updateRubricDraftRequest(
  client: KampusClient,
  { rubricId, versionId, patch }: UpdateRubricDraftInput,
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/rubrics/{rubricId}/versions/{versionId}', {
    params: { path: { rubricId, versionId }, header: versioned(headers) },
    body: patch,
  })
}

export function publishRubricRequest(
  client: KampusClient,
  { rubricId, versionId }: RubricVersionTarget,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/rubrics/{rubricId}/versions/{versionId}/publish', {
    params: { path: { rubricId, versionId }, header: versioned(headers) },
    body: {},
  })
}

export function archiveRubricRequest(
  client: KampusClient,
  { rubricId, versionId }: RubricVersionTarget,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/rubrics/{rubricId}/versions/{versionId}/archive', {
    params: { path: { rubricId, versionId }, header: versioned(headers) },
    body: {},
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}
const versionOf = (input: RubricVersionTarget) => input.version

/** Yeni rubrik ve ilk taslak (`POST /rubrics`, 201); form alanı hataları alana yazılır. */
export function useCreateRubric(options: CommandOptions = {}) {
  return useApiCommand({
    request: createRubricRequest,
    invalidates: RUBRIC_INVALIDATES,
    messages: RUBRIC_MESSAGES,
    exclusive: true,
    ...withSuccess(options),
  })
}

/** Yeni taslak sürüm (`POST /rubrics/:id/versions`, 201); açık taslak varken 409. */
export function useCreateRubricVersion(options: CommandOptions = {}) {
  return useApiCommand({
    request: createRubricVersionRequest,
    invalidates: RUBRIC_INVALIDATES,
    messages: RUBRIC_MESSAGES,
    exclusive: true,
    ...withSuccess(options),
  })
}

/** Taslak düzenleme (`PATCH …/versions/:versionId`, `If-Match` zorunlu); 409'da tazelenir. */
export function useUpdateRubricDraft(options: CommandOptions = {}) {
  return useApiCommand({
    request: updateRubricDraftRequest,
    version: versionOf,
    invalidates: RUBRIC_INVALIDATES,
    messages: RUBRIC_MESSAGES,
    exclusive: true,
    ...withSuccess(options),
  })
}

/** Yayım ve arşiv komutlarının ortak ayarı: yollu `issues` alana gider, çakışma tek toast (çift tıklamada yersiz 409 yok). */
const sharedPublishing = {
  version: versionOf,
  invalidates: RUBRIC_INVALIDATES,
  messages: RUBRIC_MESSAGES,
  exclusive: true,
} as const
export const publishRubricCommand = { request: publishRubricRequest, ...sharedPublishing }
export const archiveRubricCommand = { request: archiveRubricRequest, ...sharedPublishing }

/** Taslağı yayımlar; önceki yayındaki sürüm sunucuda aynı işlemde arşivlenir (DOM-BEC-022). */
export function usePublishRubric(options: CommandOptions = {}) {
  return useApiCommand({ ...publishRubricCommand, ...withSuccess(options) })
}

/** Yayındaki sürümü arşivler; sabitlendiği görevlerde puanlanmaya devam eder (DOM-BEC-022). */
export function useArchiveRubric(options: CommandOptions = {}) {
  return useApiCommand({ ...archiveRubricCommand, ...withSuccess(options) })
}
