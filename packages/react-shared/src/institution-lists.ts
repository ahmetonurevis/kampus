import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import {
  CollectionTooLargeError,
  MAX_COLLECTION_PAGE_SIZE,
  MAX_COLLECTION_PAGES,
  MIN_SEARCH_LENGTH,
} from './collections.ts'

/**
 * Ayarlar sayfasının yönetici listeleri: kurum kullanıcıları (`GET /institution-members`) ve
 * işlem geçmişi (`GET /audit-events`). Saf yardımcılar; hook'lar `use-institution-lists.ts`'tedir.
 */

export type InstitutionMember = components['schemas']['InstitutionMember']
export type AuditEvent = components['schemas']['AuditEvent']

type MemberParams = NonNullable<operations['listInstitutionMembers']['parameters']['query']>
type AuditParams = NonNullable<operations['listAuditEvents']['parameters']['query']>

export type MemberRole = NonNullable<MemberParams['role']>
export type MemberStatus = NonNullable<MemberParams['status']>
export type MemberSort = NonNullable<MemberParams['sort']>

export interface MemberQuery {
  page?: number
  pageSize?: number
  /** Sunucu en az 2 karakter ister; daha kısası gönderilmez. */
  q?: string
  role?: MemberRole
  status?: MemberStatus
  sort?: MemberSort
}

export interface AuditQuery {
  page?: number
  pageSize?: number
  /** `YYYY-MM-DD`, Europe/Istanbul günü, dahil. */
  dateFrom?: string
  dateTo?: string
  /** ISO 8601 UTC üst sınır (hariç); sayfalı dışa aktarma bunu ilk istekte sabitler. */
  createdBefore?: string
  actorUserId?: string
  entityType?: string
}

export interface ListPage<T> {
  rows: T[]
  page: number
  pageSize: number
  total: number
}

const clampSize = (size: number) => Math.min(Math.max(1, size), MAX_COLLECTION_PAGE_SIZE)

function putPaging(params: Record<string, unknown>, query: { page?: number; pageSize?: number }) {
  if (query.page !== undefined) params.page = query.page
  if (query.pageSize !== undefined) params.pageSize = clampSize(query.pageSize)
}

/** Boş ve kısa arama gönderilmez; sunucu bilinmeyen/boş parametrede 400 verir. */
export function memberListParams(query: MemberQuery): MemberParams {
  const params: Record<string, unknown> = {}
  putPaging(params, query)
  const q = query.q?.trim() ?? ''
  if (q.length >= MIN_SEARCH_LENGTH) params.q = q.slice(0, 100)
  if (query.role) params.role = query.role
  if (query.status) params.status = query.status
  if (query.sort) params.sort = query.sort
  return params as MemberParams
}

export function auditListParams(query: AuditQuery): AuditParams {
  const params: Record<string, unknown> = {}
  putPaging(params, query)
  if (query.dateFrom) params.dateFrom = query.dateFrom
  if (query.dateTo) params.dateTo = query.dateTo
  if (query.createdBefore) params.createdBefore = query.createdBefore
  if (query.actorUserId) params.actorUserId = query.actorUserId
  if (query.entityType) params.entityType = query.entityType
  return params as AuditParams
}

function sortedParams(params: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(params).sort(([left], [right]) => left.localeCompare(right)),
  )
}

/**
 * Sorgu anahtarı parçaları. Yönetici listeleri kullanıcıya da bağlıdır: aynı tarayıcıda başka
 * kullanıcı girerse (aynı kurum) eski yöneticinin e-posta ve geçmiş verisi önbellekten okunmaz.
 * Etkin kurum `useApiQuery` tarafından başa eklenir.
 */
export function memberListKey(userId: string | null, query: MemberQuery): unknown[] {
  return ['institution-members', userId, 'list', sortedParams(memberListParams(query))]
}

/**
 * Süzgece uyan bütün kullanıcıların anahtarı (`useInstitutionMembersAll`); sayfa ve boyut
 * anahtara girmez, çünkü hepsi çekilir. Sayfalı liste önbelleğiyle çakışmaması için `all` ekli.
 */
export function memberAllKey(
  userId: string | null,
  query: Omit<MemberQuery, 'page' | 'pageSize'>,
): unknown[] {
  return [...memberListKey(userId, query), 'all']
}

export function auditListKey(userId: string | null, query: AuditQuery): unknown[] {
  return ['audit-events', userId, 'list', sortedParams(auditListParams(query))]
}

/** Yönetici listeleri için ortak önek; yazma sonrası geçersiz kılmak için. */
export const AUDIT_EVENTS_KEY_ROOT = 'audit-events'
export const INSTITUTION_MEMBERS_KEY_ROOT = 'institution-members'

export async function fetchMemberPage(
  client: KampusClient,
  query: MemberQuery,
  signal?: AbortSignal,
): Promise<ListPage<InstitutionMember>> {
  const body = await runRequest(() =>
    client.GET('/api/v1/institution-members', {
      params: { query: memberListParams(query) },
      ...(signal ? { signal } : {}),
    }),
  )
  return { rows: body.data, ...body.meta }
}

export async function fetchAuditPage(
  client: KampusClient,
  query: AuditQuery,
  signal?: AbortSignal,
): Promise<ListPage<AuditEvent>> {
  const body = await runRequest(() =>
    client.GET('/api/v1/audit-events', {
      params: { query: auditListParams(query) },
      ...(signal ? { signal } : {}),
    }),
  )
  return { rows: body.data, ...body.meta }
}

/**
 * Aynı süzgeçle bütün sayfaları sırayla çeker (CSV). Sayfa sayısı sınırı aşılırsa
 * `CollectionTooLargeError`; boş sayfa gelirse (okuma sırasında azalma) durur.
 */
export async function fetchAllPages<TQuery extends { page?: number; pageSize?: number }, TRow>(
  fetchPage: (query: TQuery, signal?: AbortSignal) => Promise<ListPage<TRow>>,
  query: Omit<TQuery, 'page' | 'pageSize'>,
  signal?: AbortSignal,
  maxPages = MAX_COLLECTION_PAGES,
): Promise<TRow[]> {
  const rows: TRow[] = []
  for (let page = 1; ; page += 1) {
    if (page > maxPages) throw new CollectionTooLargeError()
    const result = await fetchPage(
      { ...query, page, pageSize: MAX_COLLECTION_PAGE_SIZE } as TQuery,
      signal,
    )
    rows.push(...result.rows)
    if (rows.length >= result.total || result.rows.length === 0) return rows
  }
}

/**
 * Bütün işlem geçmişi (CSV). Liste en yeniden eskiye ve offset'le sayfalandığından, dışa aktarma
 * sürerken yazılan yeni denetim kaydı sayfaları kaydırıp aynı satırı iki kez getirirdi. Üst zaman
 * sınırı (`createdBefore`) ilk istekten önce bir kez sabitlenir ve bütün sayfalarda aynı gider;
 * dışa aktarma başlangıç anındaki kayıtları verir. Çağıran kendi sınırını verirse o korunur.
 * Sınır istemci saatindendir: sunucudan geri kalan saatte son birkaç saniyenin kayıtları çıkmayabilir.
 */
export function fetchAllAuditEvents(
  client: KampusClient,
  query: Omit<AuditQuery, 'page' | 'pageSize'>,
  signal?: AbortSignal,
  now: () => Date = () => new Date(),
): Promise<AuditEvent[]> {
  const createdBefore = query.createdBefore ?? now().toISOString()
  return fetchAllPages<AuditQuery, AuditEvent>(
    (pageQuery, pageSignal) => fetchAuditPage(client, pageQuery, pageSignal),
    { ...query, createdBefore },
    signal,
  )
}
