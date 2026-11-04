import type { KampusClient } from '@kampus/api-client/client.ts'

import { HEALTH_PROFILE_MESSAGES, type HealthProfilePatchBody } from './health-profile-model.ts'
import { healthProfileKey } from './query-keys.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Sağlık ve acil bilgi kancaları (OG-090; DOM-ILT-035). Okuma düzeyi (`full` ya da `emergency`) ve
 * erişim kararı sunucudadır: 403/404 çağırana `ApiError` olarak gelir (bölüm gizlenir). Her
 * başarılı okuma sunucuda denetim kaydına yazılır. Güncelleme kısmidir ve `version` ile iyimser
 * kilitlidir: tutmazsa 409 `version_conflict` olur, kanca güncel profili yeniden yükler ve
 * kullanıcıya Türkçe söyler.
 */

export function healthProfileRequest(
  client: KampusClient,
  studentId: string,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/students/{studentId}/health-profile', {
    params: { path: { studentId } },
    ...(signal ? { signal } : {}),
  })
}

/** PATCH gövdesinde `version` vardır; `If-Match` kullanılmaz. */
export function patchHealthProfileRequest(
  client: KampusClient,
  studentId: string,
  body: HealthProfilePatchBody,
) {
  return client.PATCH('/api/v1/students/{studentId}/health-profile', {
    params: { path: { studentId } },
    body,
  })
}

export function useHealthProfile(studentId: string, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: healthProfileKey(studentId),
    request: (client, signal) => healthProfileRequest(client, studentId, signal),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

export function useUpdateHealthProfile(
  studentId: string,
  options: { onSuccess?: () => void } = {},
) {
  return useApiCommand({
    request: (client, body: HealthProfilePatchBody) =>
      patchHealthProfileRequest(client, studentId, body),
    invalidates: [healthProfileKey(studentId)],
    messages: HEALTH_PROFILE_MESSAGES,
    // Yollu doğrulama maddeleri (`allergies.0.name`) alanın altında görünür, ayrıca toast yok.
    exclusive: true,
    onSuccess: () => options.onSuccess?.(),
  })
}
