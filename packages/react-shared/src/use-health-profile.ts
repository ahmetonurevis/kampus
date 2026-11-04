import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { KampusClient } from '@kampus/api-client/client.ts'

import { HEALTH_PROFILE_MESSAGES, type HealthProfilePatchBody } from './health-profile-model.ts'
import { healthProfileKey, institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Sağlık ve acil bilgi kancaları (OG-090; DOM-ILT-035). Okuma düzeyi (`full` ya da `emergency`) ve
 * erişim kararı sunucudadır: 403/404 çağırana `ApiError` olarak gelir (bölüm gizlenir). Her
 * başarılı okuma sunucuda denetim kaydına yazılır. Güncelleme kısmidir ve `version` ile iyimser
 * kilitlidir: tutmazsa 409 `version_conflict` olur, kanca güncel profili yeniden yükler ve
 * kullanıcıya Türkçe söyler.
 *
 * Her okuma bir denetim satırıdır ve erişim ihtiyaç bazlıdır (DOM-YTK-052, DOM-ILT-035): bölüm
 * sayfa açılışında okumaz; kullanıcı "göster" deyince okur (`useHealthProfileReveal`), "gizle"
 * deyince, öğrenci değişince ya da ekran kapanınca veri bellekten atılır (`gcTime: 0`). Pencere
 * odağı ya da yeniden bağlanma otomatik okuma başlatmaz; kayıttan sonra yanıt görünümü günceller
 * (ek okuma yok).
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

/** Okuma ilkesi: tek okuma, otomatik yeniden okuma yok, izleyen kalmayınca bellekte tutma yok. */
export const HEALTH_PROFILE_QUERY_POLICY = {
  gcTime: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const

export function useHealthProfile(studentId: string, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: healthProfileKey(studentId),
    request: (client, signal) => healthProfileRequest(client, studentId, signal),
    ...HEALTH_PROFILE_QUERY_POLICY,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

/** Öğrencinin sağlık verisini sorgu önbelleğinden atar (gizle). */
export function forgetHealthProfile(
  queryClient: QueryClient,
  institutionId: string | null,
  studentId: string,
): void {
  queryClient.removeQueries({
    queryKey: institutionKey(institutionId, ...healthProfileKey(studentId)),
  })
}

/**
 * İsteğe bağlı sağlık bölümü: kapalı başlar, `show` ile okur, `hide` ile veriyi atar. Seçili
 * öğrenci değişince yeniden kapanır (önceki öğrencinin verisi izleyicisiz kalır ve atılır).
 */
export function useHealthProfileReveal(studentId: string) {
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()
  const [revealedFor, setRevealedFor] = useState<string | null>(null)
  // Öğrenci değişti: işaret eski öğrenciye ait; çizim sırasında sıfırlanır (A → B → A açık dönmez).
  if (revealedFor !== null && revealedFor !== studentId) setRevealedFor(null)
  const revealed = revealedFor === studentId
  const query = useHealthProfile(studentId, { enabled: revealed })
  return {
    revealed,
    query,
    show: () => setRevealedFor(studentId),
    hide: () => {
      setRevealedFor(null)
      forgetHealthProfile(queryClient, institutionId, studentId)
    },
  }
}

export function useUpdateHealthProfile(
  studentId: string,
  options: { onSuccess?: () => void } = {},
) {
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()
  return useApiCommand({
    request: (client, body: HealthProfilePatchBody) =>
      patchHealthProfileRequest(client, studentId, body),
    // 409'da güncel hâl okunur; başarıda PATCH yanıtı görünümü günceller, ek okuma (denetim satırı) yok.
    invalidates: [healthProfileKey(studentId)],
    invalidateOnSuccess: false,
    messages: HEALTH_PROFILE_MESSAGES,
    // Yollu doğrulama maddeleri (`allergies.0.name`) alanın altında görünür, ayrıca toast yok.
    exclusive: true,
    onSuccess: (data) => {
      queryClient.setQueryData(institutionKey(institutionId, ...healthProfileKey(studentId)), data)
      options.onSuccess?.()
    },
  })
}
