import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import type { CommandHeaders, CommandMessages } from './commands.ts'
import { fetchAllPages, type ListPage } from './institution-lists.ts'

/**
 * Seviye tespiti ve CEFR profili uçlarının (`/placement-sessions`, `/students/:id/cefr-profile`;
 * OG-054, IST-058, IST-060; DOM-DIL-010…012, DOM-BEC-034) saf yardımcıları: istek kurucular,
 * Türkçe hata metinleri ve sorgu anahtarı. Kancalar `use-cefr.ts`'tedir. Uçlar yalnız dil
 * okulunda vardır (okulda 404). Tespit yazmaları satır sürümünü `If-Match` yerine gövdede
 * (`version`) taşır; `Idempotency-Key` her eylemde gönderilir.
 */

/** Profil yanıtı görünüm birleşimidir: `staff` (yönetici, öğretmen) ve `learner` (öğrenci, veli). */
export type CefrProfile = components['schemas']['CefrProfile']
export type CefrProfileStaff = components['schemas']['CefrProfileStaff']
/** Öğrenci ve veli görünümü: zaman çizelgesinde gerekçe ve kararı veren yoktur. */
export type CefrProfileLearner = components['schemas']['CefrProfileLearner']
export type CefrTimelineEntry = CefrProfile['timeline'][number]

export type PlacementSession =
  operations['getPlacementSession']['responses'][200]['content']['application/json']['data']
/** Liste satırı: oturum ve geçerliliği; bölümler ve öneri yalnız tek oturum okumasında. */
export type PlacementSessionRow =
  operations['listPlacementSessions']['responses'][200]['content']['application/json']['data'][number]
export type PlacementSessionListQuery = operations['listPlacementSessions']['parameters']['query']

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type OpenPlacementBody = JsonBody<'openPlacementSession'>
export type ScorePlacementBody = JsonBody<'scorePlacementSection'>
export type DecidePlacementBody = JsonBody<'decidePlacement'>

/** Sorgu anahtarının kökü; tespit yazması profili ve oturum listesini birlikte tazeler. */
export const CEFR_KEY = ['cefr'] as const
export const CEFR_INVALIDATES = [CEFR_KEY] as const

export const PLACEMENT_CHANGED_MESSAGE =
  'Seviye tespiti bu arada değişti. Güncel hâli yüklendi; kontrol edip yeniden deneyin.'

/** Koda özgü Türkçe metinler; listede olmayan kodda sunucunun Türkçe mesajı gösterilir. */
export const CEFR_MESSAGES = {
  version_conflict: PLACEMENT_CHANGED_MESSAGE,
  not_found: 'Seviye tespiti bulunamadı. Liste güncellendi.',
  placement_not_found: 'Seviye tespiti bulunamadı. Liste güncellendi.',
  placement_learner_not_found: 'Öğrenci ya da aday kaydı bulunamadı.',
  placement_form_not_found: 'Tespit formu bulunamadı.',
  placement_form_invalid: 'Seçilen kaynak seviye tespiti formu olarak kullanılamaz.',
  placement_form_repeated: 'İkinci tespit farklı bir formla yapılır. Başka bir form seçin.',
  placement_in_progress: 'Bu kişinin süren bir seviye tespiti var. Önce onu bitirin.',
  placement_limit_reached: 'Bu kişi için en çok iki seviye tespiti yapılır.',
  placement_completed: 'Seviye tespiti bitmiş; bu bölüm artık girilemez.',
  placement_incomplete: 'Karar vermek için önce seviye tespitini bitirin.',
  placement_preliminary: 'Uzaktan yapılan ön tespitle yerleştirme kararı verilmez.',
  placement_expired: 'Tespit sonucunun 90 günlük geçerliliği doldu; yeni tespit gerekir.',
  placement_production_missing: 'Karar için yazma ve konuşma bölümleri puanlanmış olmalı.',
  placement_already_decided: 'Bu seviye tespiti için karar verilmiş.',
  placement_section_scored: 'Bu bölüm daha önce girildi.',
  placement_section_empty: 'Formda bu bölüme ait soru yok.',
  placement_section_mismatch: 'Bölüm sonucu formla uyuşmuyor. Sayfayı yenileyip yeniden deneyin.',
  placement_section_duplicate: 'Bölüm sonucu tekrar ediyor. Sayfayı yenileyip yeniden deneyin.',
  placement_evidence_mismatch: 'Tespit kanıtları güncel değil. Sayfayı yenileyip yeniden deneyin.',
  placement_rubric_skill_mismatch: 'Seçilen rubrik bu bölümün becerisi için değil.',
  rubric_version_unpublished: 'Rubrik sürümü yayımlanmamış; yayımlanan bir sürüm seçin.',
  progression_pending: 'Bu kayıt için onay bekleyen bir kur sonu kararı var.',
} as const satisfies CommandMessages

/** Ekrandaki oturum eskidi (sürüm çakıştı, oturum yok oldu): profil ve liste tazelenir. */
export const placementStale = (error: ApiError) =>
  error.status === 404 || (error.status === 409 && error.code === 'version_conflict')

/** Profil `staff` görünümünde mi (gerekçe ve kararı veren yalnız orada). */
export function isStaffProfile(profile: CefrProfile): profile is CefrProfileStaff {
  return profile.view === 'staff'
}

/** Tespit oturumuna yazmanın hedefi; `version` okunan satır sürümüdür ve gövdede gider. */
export interface PlacementTarget {
  sessionId: string
  version: number
}

const keyOnly = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
})

export function fetchCefrProfile(client: KampusClient, studentId: string, signal?: AbortSignal) {
  return runRequest(() =>
    client.GET('/api/v1/students/{studentId}/cefr-profile', {
      params: { path: { studentId } },
      ...(signal ? { signal } : {}),
    }),
  )
}

export async function fetchPlacementPage(
  client: KampusClient,
  query: PlacementSessionListQuery,
  signal?: AbortSignal,
): Promise<ListPage<PlacementSessionRow>> {
  const body = await runRequest(() =>
    client.GET('/api/v1/placement-sessions', {
      params: { query },
      ...(signal ? { signal } : {}),
    }),
  )
  return { rows: body.data, ...body.meta }
}

/** Kişinin bütün tespit oturumları (sayfa sayfa). */
export function fetchAllPlacements(
  client: KampusClient,
  query: Omit<PlacementSessionListQuery, 'page' | 'pageSize'>,
  signal?: AbortSignal,
): Promise<PlacementSessionRow[]> {
  return fetchAllPages<PlacementSessionListQuery, PlacementSessionRow>(
    (pageQuery, pageSignal) => fetchPlacementPage(client, pageQuery, pageSignal),
    query,
    signal,
  )
}

export function openPlacementRequest(
  client: KampusClient,
  body: OpenPlacementBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/placement-sessions', {
    params: { header: keyOnly(headers) },
    body,
  })
}

export function scorePlacementRequest(
  client: KampusClient,
  input: { sessionId: string; body: ScorePlacementBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/placement-sessions/{sessionId}/score', {
    params: { path: { sessionId: input.sessionId }, header: keyOnly(headers) },
    body: input.body,
  })
}

export function completePlacementRequest(
  client: KampusClient,
  input: PlacementTarget,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/placement-sessions/{sessionId}/complete', {
    params: { path: { sessionId: input.sessionId }, header: keyOnly(headers) },
    body: { version: input.version },
  })
}

export function decidePlacementRequest(
  client: KampusClient,
  input: { sessionId: string; body: DecidePlacementBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/placement-sessions/{sessionId}/decide', {
    params: { path: { sessionId: input.sessionId }, header: keyOnly(headers) },
    body: input.body,
  })
}

const placementCommand = {
  invalidates: CEFR_INVALIDATES,
  refreshOn: placementStale,
  messages: CEFR_MESSAGES,
} as const

export const openPlacementCommand = {
  request: openPlacementRequest,
  invalidates: CEFR_INVALIDATES,
  messages: CEFR_MESSAGES,
} as const
export const scorePlacementCommand = {
  ...placementCommand,
  request: scorePlacementRequest,
} as const
export const completePlacementCommand = {
  ...placementCommand,
  request: completePlacementRequest,
} as const
export const decidePlacementCommand = {
  ...placementCommand,
  request: decidePlacementRequest,
} as const
