import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import type { CommandHeaders } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { RESOURCE_MESSAGES, type ActionKind, type ResourceListQuery } from './resource-model.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * İçerik havuzu kancaları: liste, ayrıntı ve yazma komutları (`/api/v1/resources`, api-tasarimi.md).
 * Yetki, kapsam ve görünürlük sunucudadır; burada yalnız çağrı, önbellek tazeleme ve Türkçe hata
 * metni vardır. Yazma sonrası bütün `resources` sorguları tazelenir (liste ve açık ayrıntı).
 */

export const RESOURCES_KEY = 'resources'
const INVALIDATES = [[RESOURCES_KEY]] as const

export type ResourceCreateBody =
  operations['createResource']['requestBody']['content']['application/json']
export type ResourceDraftPatch =
  operations['updateResourceDraft']['requestBody']['content']['application/json']

/** Sunucu sayfalı liste; sorgu değişirken önceki sayfa ekranda kalır. */
export function useResourceList(query: ResourceListQuery) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, RESOURCES_KEY, 'list', query),
    queryFn: ({ signal }) =>
      runRequest(() => client.GET('/api/v1/resources', { params: { query }, signal })),
    enabled: institutionId !== null,
    placeholderData: keepPreviousData,
  })
}

/** Tek kaynak (ayrıntı paneli); `id` boşken istek atılmaz. */
export function useResourceDetail(resourceId: string) {
  return useApiQuery({
    key: [RESOURCES_KEY, 'detail', resourceId],
    request: (client, signal) =>
      client.GET('/api/v1/resources/{resourceId}', {
        params: { path: { resourceId } },
        signal,
      }),
    enabled: resourceId !== '',
  })
}

export type ResourceListError = ApiError

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

/** Yeni kaynak ve ilk taslak (`POST /resources`). */
export function useCreateResource(options: CommandOptions = {}) {
  return useApiCommand({
    request: (client, body: ResourceCreateBody, headers) =>
      client.POST('/api/v1/resources', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: INVALIDATES,
    messages: RESOURCE_MESSAGES,
    exclusive: true,
    ...withSuccess(options),
  })
}

export interface UpdateDraftInput {
  resourceId: string
  versionId: string
  /** Sürümün okunan `rowVersion` değeri (`If-Match` zorunlu). */
  version: number
  patch: ResourceDraftPatch
}

/** Taslak düzenleme (`PATCH …/versions/:versionId`); 409'da liste ve ayrıntı tazelenir. */
export function useUpdateDraft(options: CommandOptions = {}) {
  return useApiCommand({
    request: (client, { resourceId, versionId, patch }: UpdateDraftInput, headers) =>
      client.PATCH('/api/v1/resources/{resourceId}/versions/{versionId}', {
        params: { path: { resourceId, versionId }, header: headers },
        body: patch,
      }),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: RESOURCE_MESSAGES,
    exclusive: true,
    ...withSuccess(options),
  })
}

/** Yayındaki sürümden yeni taslak (`POST /resources/:id/versions`). */
export function useOpenNewVersion(options: CommandOptions = {}) {
  return useApiCommand({
    request: (client, { resourceId }: { resourceId: string }, headers) =>
      client.POST('/api/v1/resources/{resourceId}/versions', {
        params: {
          path: { resourceId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: {},
      }),
    invalidates: INVALIDATES,
    messages: RESOURCE_MESSAGES,
    ...withSuccess(options),
  })
}

export interface TransitionInput {
  action: ActionKind
  resourceId: string
  versionId: string
  /** Sürümün okunan `rowVersion` değeri; tutmazsa 409 `version_conflict`. */
  version: number
  /** Yalnız `reject` için zorunlu (5–1000 karakter). */
  reason?: string
}

function postTransition(client: KampusClient, input: TransitionInput, headers: CommandHeaders) {
  const params = {
    path: { resourceId: input.resourceId, versionId: input.versionId },
    header: headers,
  }
  switch (input.action) {
    case 'submit':
      return client.POST('/api/v1/resources/{resourceId}/versions/{versionId}/submit', {
        params,
        body: {},
      })
    case 'publish':
      return client.POST('/api/v1/resources/{resourceId}/versions/{versionId}/publish', {
        params,
        body: {},
      })
    case 'withdraw':
      return client.POST('/api/v1/resources/{resourceId}/versions/{versionId}/withdraw', {
        params,
        body: {},
      })
    case 'approve':
      return client.POST('/api/v1/resources/{resourceId}/versions/{versionId}/approve', {
        params,
        body: {},
      })
    case 'reject':
      return client.POST('/api/v1/resources/{resourceId}/versions/{versionId}/reject', {
        params,
        body: { reason: input.reason ?? '' },
      })
    case 'reopen':
      return client.POST('/api/v1/resources/{resourceId}/versions/{versionId}/reopen', {
        params,
        body: {},
      })
    case 'archive':
      return client.POST('/api/v1/resources/{resourceId}/versions/{versionId}/archive', {
        params,
        body: {},
      })
    default:
      return input.action satisfies never
  }
}

/** Sürüm durum geçişi (gönder, yayımla, geri çek, onayla, reddet, taslağa döndür, arşivle). */
export function useResourceTransition(options: CommandOptions = {}) {
  return useApiCommand({
    request: (client, input: TransitionInput, headers) => postTransition(client, input, headers),
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: RESOURCE_MESSAGES,
    exclusive: true,
    ...withSuccess(options),
  })
}
