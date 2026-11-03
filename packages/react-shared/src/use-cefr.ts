import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { ApiError } from '@kampus/api-client/errors.ts'

import {
  CEFR_KEY,
  completePlacementCommand,
  decidePlacementCommand,
  fetchAllPlacements,
  fetchCefrProfile,
  fetchPlacementForm,
  fetchPlacementPage,
  openPlacementCommand,
  scorePlacementCommand,
  type CefrProfile,
  type PlacementForm,
  type PlacementSessionListQuery,
} from './cefr.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Seviye tespiti ve CEFR profili kancaları (OG-054; IST-058, IST-060; DOM-DIL-010…012). Kapsam
// sunucudadır: öğrenci kendi, veli çocuğunun profilini `learner` görünümüyle (gerekçe ve kararı
// veren yok), yönetici ve grubundaki öğrenci için öğretmen `staff` görünümüyle alır.

interface Options {
  enabled?: boolean
}

/**
 * Öğrencinin CEFR profili: güncel seviyeler, tahmini seviye, tespitler ve karar çizelgesi. Yanıt
 * görünüm birleşimidir; gerekçe için `isStaffProfile` ile daraltılır.
 */
export function useCefrProfile(studentId: string, options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<CefrProfile, ApiError>({
    queryKey: institutionKey(institutionId, ...CEFR_KEY, 'profile', studentId),
    queryFn: async ({ signal }) => (await fetchCefrProfile(client, studentId, signal)).data,
    enabled: institutionId !== null && studentId !== '' && (options.enabled ?? true),
  })
}

/** Kişinin (öğrenci ya da aday) bütün tespit oturumları; yalnız yönetici ve öğretmen. */
export function usePlacementSessions(
  query: Omit<PlacementSessionListQuery, 'page' | 'pageSize'>,
  options: Options = {},
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...CEFR_KEY, 'placements', query),
    queryFn: ({ signal }) => fetchAllPlacements(client, query, signal),
    enabled: institutionId !== null && query.learnerId !== '' && (options.enabled ?? true),
  })
}

/**
 * Kişinin tespit oturumlarının tek sayfası (OG-078; seviye tespiti ekranı). Sorgu değişirken
 * önceki sayfa ekranda kalır; kişi seçilmemişken (`learnerId` boş) istek atılmaz.
 */
export function usePlacementPage(query: PlacementSessionListQuery, options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...CEFR_KEY, 'placement-page', query),
    queryFn: ({ signal }) => fetchPlacementPage(client, query, signal),
    enabled: institutionId !== null && query.learnerId !== '' && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

/** Oturumun formu: otomatik bölümlerin anahtarsız soruları (cevap girişi; OG-078). */
export function usePlacementForm(sessionId: string, options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<PlacementForm, ApiError>({
    queryKey: institutionKey(institutionId, ...CEFR_KEY, 'placement-form', sessionId),
    queryFn: async ({ signal }) => (await fetchPlacementForm(client, sessionId, signal)).data,
    enabled: institutionId !== null && sessionId !== '' && (options.enabled ?? true),
    // Form sürümü oturuma sabittir; sorular değişmez.
    staleTime: Infinity,
  })
}

/** Tek tespit oturumu: bölüm girişleri, özet ve satır sürümü. */
export function usePlacementSession(sessionId: string, options: Options = {}) {
  return useApiQuery({
    key: [...CEFR_KEY, 'placement', sessionId],
    request: (client, signal) =>
      client.GET('/api/v1/placement-sessions/{sessionId}', {
        params: { path: { sessionId } },
        signal,
      }),
    enabled: sessionId !== '' && (options.enabled ?? true),
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

/** Tespit oturumu açar (`POST /placement-sessions`, 201). */
export function useOpenPlacement(options: CommandOptions = {}) {
  return useApiCommand({ ...openPlacementCommand, ...withSuccess(options) })
}

/** Bölüm girişi: otomatik bölümde cevaplar, rubrikli bölümde kriter bantları. */
export function useScorePlacement(options: CommandOptions = {}) {
  return useApiCommand({ ...scorePlacementCommand, ...withSuccess(options) })
}

/** Süren oturumu bitirir; 90 günlük geçerlilik bitiş anından sayılır (DOM-DIL-012). */
export function useCompletePlacement(options: CommandOptions = {}) {
  return useApiCommand({ ...completePlacementCommand, ...withSuccess(options) })
}

/** Gerekçeli yerleştirme kararı; profili değiştirir (DOM-DIL-010). */
export function useDecidePlacement(options: CommandOptions = {}) {
  return useApiCommand({ ...decidePlacementCommand, ...withSuccess(options) })
}
