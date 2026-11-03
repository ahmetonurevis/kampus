import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { RESOURCE_MESSAGES, type ActionKind, type ResourceListQuery } from './resource-model.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { TASK_ASSIGNMENTS_KEY } from './use-task-assignments.ts'
import { TASK_ATTEMPTS_KEY } from './use-task-attempts.ts'
import { TASK_SUBMISSIONS_KEY } from './use-task-submissions.ts'

/**
 * İçerik havuzu kancaları: liste, ayrıntı ve yazma komutları (`/api/v1/resources`, api-tasarimi.md).
 * Yetki, kapsam ve görünürlük sunucudadır; burada yalnız çağrı, önbellek tazeleme ve Türkçe hata
 * metni vardır. Yazma sonrası bütün `resources` sorguları tazelenir (liste ve açık ayrıntı).
 */

export const RESOURCES_KEY = 'resources'
const INVALIDATES = [[RESOURCES_KEY]] as const
/**
 * Kaldırma içeriği kullanan quiz/alıştırma sürümlerini (`affectedContainerVersionIds`; onlar da
 * `resources` sorgularıdır) ve görevleri etkiler (DOM-KYN-051): atama ayrıntısı, deneme soruları
 * ve teslim görünümü aynı kapıdan geçer, kaldırılan içerik oralarda da kapanır.
 */
export const REMOVE_RESOURCE_INVALIDATES = [
  [RESOURCES_KEY],
  [TASK_ASSIGNMENTS_KEY],
  [TASK_ATTEMPTS_KEY],
  [TASK_SUBMISSIONS_KEY],
] as const

export type ResourceCreateBody =
  operations['createResource']['requestBody']['content']['application/json']
export type ResourceDraftPatch =
  operations['updateResourceDraft']['requestBody']['content']['application/json']
export type NewVersionBody = NonNullable<
  operations['createResourceVersion']['requestBody']
>['content']['application/json']

/**
 * Sunucu sayfalı liste; sorgu değişirken önceki sayfa ekranda kalır. `enabled: false` isteği
 * bekletir (ör. okuma etkinliği formunda yalnız kayıtlı bağ varken özet okunur).
 */
export function useResourceList(query: ResourceListQuery, options: { enabled?: boolean } = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, RESOURCES_KEY, 'list', query),
    queryFn: ({ signal }) =>
      runRequest(() => client.GET('/api/v1/resources', { params: { query }, signal })),
    enabled: institutionId !== null && (options.enabled ?? true),
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

/**
 * Tek sürüm (`GET /resources/:id/versions/:versionId`): bağlı kaydın bağlanan sürümünü okur (ör.
 * dinleme etkinliği formunda kaydın dökümü var mı; IST-045, DOM-BEC-005). Kimliklerden biri boşken
 * istek atılmaz.
 */
export function useResourceVersion(resourceId: string, versionId: string) {
  return useApiQuery({
    key: [RESOURCES_KEY, 'version', resourceId, versionId],
    request: (client, signal) =>
      client.GET('/api/v1/resources/{resourceId}/versions/{versionId}', {
        params: { path: { resourceId, versionId } },
        signal,
      }),
    enabled: resourceId !== '' && versionId !== '',
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

/** `PATCH …/versions/:versionId`: `If-Match` zorunludur, sürüm yoksa istek atılmaz. */
export function updateDraftRequest(
  client: KampusClient,
  { resourceId, versionId, patch }: UpdateDraftInput,
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/resources/{resourceId}/versions/{versionId}', {
    params: {
      path: { resourceId, versionId },
      header: { ...headers, 'if-match': requireIfMatch(headers) },
    },
    body: patch,
  })
}

/** Taslak düzenleme (`PATCH …/versions/:versionId`); 409'da liste ve ayrıntı tazelenir. */
export function useUpdateDraft(options: CommandOptions = {}) {
  return useApiCommand({
    request: updateDraftRequest,
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: RESOURCE_MESSAGES,
    exclusive: true,
    ...withSuccess(options),
  })
}

export interface OpenVersionInput {
  resourceId: string
  /**
   * Yeni sürümün dosya listesi (DOM-KYN-006). Verilmezse temel sürümün dosyaları yeni bağla
   * taşınır; verilirse liste onun yerine geçer.
   */
  fileIds?: NewVersionBody['fileIds']
}

/** `POST /resources/:id/versions` gövdesi: dosya listesi yalnız verildiyse gider. */
export function openVersionRequest(
  client: KampusClient,
  { resourceId, fileIds }: OpenVersionInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/resources/{resourceId}/versions', {
    params: {
      path: { resourceId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body: fileIds === undefined ? {} : { fileIds },
  })
}

/** Yayındaki sürümden yeni taslak (`POST /resources/:id/versions`). */
export function useOpenNewVersion(options: CommandOptions = {}) {
  return useApiCommand({
    request: openVersionRequest,
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

// --- Kaynak düzeyindeki komutlar: paylaşım, kopya, telif bildirimi, kaldırma (OG-217) ---------

export type ShareTargetsBody =
  operations['shareResource']['requestBody']['content']['application/json']

export interface ShareResourceInput {
  resourceId: string
  /** Kaynağın okunan `rowVersion` değeri; tutmazsa 409 `version_conflict`. */
  version: number
  targets: ShareTargetsBody
}

/** `POST /resources/:id/share` (DOM-KYN-040): hedef listesi kapsamla birlikte bütün olarak değişir. */
export function shareResourceRequest(
  client: KampusClient,
  { resourceId, targets }: ShareResourceInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/resources/{resourceId}/share', {
    params: { path: { resourceId }, header: headers },
    body: targets,
  })
}

/** Paylaşım kapsamını ve hedeflerini değiştirir (DOM-KYN-021, 031, 040). */
export function useShareResource(options: CommandOptions = {}) {
  return useApiCommand({
    request: shareResourceRequest,
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: RESOURCE_MESSAGES,
    ...withSuccess(options),
  })
}

export interface CopyResourceInput {
  resourceId: string
}

/** `POST /resources/:id/copy` (DOM-KYN-050): gövde boş, `If-Match` gönderilmez. */
export function copyResourceRequest(
  client: KampusClient,
  { resourceId }: CopyResourceInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/resources/{resourceId}/copy', {
    params: {
      path: { resourceId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body: {},
  })
}

/** Yayındaki sürümden yeni kaynak (kopya `Taslak` ve `Yalnız ben` başlar; DOM-KYN-050). */
export function useCopyResource(options: CommandOptions = {}) {
  return useApiCommand({
    request: copyResourceRequest,
    invalidates: INVALIDATES,
    messages: RESOURCE_MESSAGES,
    ...withSuccess(options),
  })
}

export interface RemoveResourceInput {
  resourceId: string
  /** Kaynağın okunan `rowVersion` değeri. */
  version: number
  /** Gerekçe (5–1000 karakter; boşsa 422 `reason_required`). */
  reason: string
}

/** `POST /resources/:id/remove` (DOM-KYN-025, 051): yalnız yönetici, gerekçeli. */
export function removeResourceRequest(
  client: KampusClient,
  { resourceId, reason }: RemoveResourceInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/resources/{resourceId}/remove', {
    params: { path: { resourceId }, header: headers },
    body: { reason },
  })
}

/** Kaynağı kaldırır: bütün sürümlerin içeriği silinir, başlık ve gerekçe kalır (DOM-KYN-051). */
export function useRemoveResource(options: CommandOptions = {}) {
  return useApiCommand({
    request: removeResourceRequest,
    invalidates: REMOVE_RESOURCE_INVALIDATES,
    version: (input) => input.version,
    messages: RESOURCE_MESSAGES,
    exclusive: true,
    ...withSuccess(options),
  })
}

export interface ReportVersionInput {
  resourceId: string
  versionId: string
  /**
   * Sürümün okunan `rowVersion` değeri; bildirilen sürüm ayrıntıdaki baş sürüm değilse bilinmez
   * ve `If-Match` gönderilmez (uçta isteğe bağlıdır).
   */
  version?: number | undefined
  reason: string
}

/** `POST …/versions/:versionId/report` (DOM-KYN-025): yayındaki sürüm incelemeye alınır. */
export function reportVersionRequest(
  client: KampusClient,
  { resourceId, versionId, reason }: ReportVersionInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/resources/{resourceId}/versions/{versionId}/report', {
    params: { path: { resourceId, versionId }, header: headers },
    body: { reason },
  })
}

/** Telif bildirimi: içerik öğrenci ve veliden düşer; yönetici yeniden yayımlar ya da kaldırır. */
export function useReportResourceVersion(options: CommandOptions = {}) {
  return useApiCommand({
    request: reportVersionRequest,
    invalidates: INVALIDATES,
    version: (input) => input.version,
    messages: RESOURCE_MESSAGES,
    exclusive: true,
    ...withSuccess(options),
  })
}
