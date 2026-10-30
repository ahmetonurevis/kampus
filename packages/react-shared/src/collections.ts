import type { KampusClient } from '@kampus/api-client/client.ts'
import { isApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'

/**
 * Koleksiyon okuma uçları (`GET /api/v1/collections/:collection` ve `/:id`) için saf yardımcılar.
 * Hook'lar `use-collection.ts`'tedir; burası HTTP ve React olmadan test edilir.
 */

export type CollectionItem = components['schemas']['CollectionItem']
type ListQueryParams = NonNullable<operations['listCollection']['parameters']['query']>
type CountQueryParams = operations['countCollection']['parameters']['query']
export type CollectionCountGroup = components['schemas']['CollectionCountGroup']
export type CollectionCountsMeta = components['schemas']['CollectionCountsMeta']
/** Sayımda gruplanabilen alanlar (API beyaz listesi). */
export type CollectionGroupField = CountQueryParams['groupBy']
/** Sayımda toplanabilen sayısal alanlar (`amount` kuruş). */
export type CollectionSumField = NonNullable<CountQueryParams['sum']>

/** Sunucunun eşitlik filtresi kabul ettiği alanlar (API beyaz listesi; bilinmeyen alan 400). */
export type CollectionFilterField = Exclude<
  keyof ListQueryParams,
  'page' | 'pageSize' | 'q' | 'sort' | 'archived'
>
export type CollectionFilters = Partial<Record<CollectionFilterField, string | readonly string[]>>

/** Sunucunun sıralayabildiği alanlar; `-` öneki azalan (ör. `-name`). */
export type CollectionSortField =
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'name'
  | 'title'
  | 'date'
  | 'dueDate'
  | 'deadline'
  | 'followUp'
  | 'status'
  | 'stage'
  | 'grade'
  | 'score'
  | 'amount'
  | 'installment'
  | 'number'
export type CollectionSort = CollectionSortField | `-${CollectionSortField}`

export interface CollectionQuery {
  page?: number
  pageSize?: number
  /** Serbest arama; sunucu en az 2 karakter ister, daha kısası gönderilmez. */
  q?: string
  /** En çok üç alan. */
  sort?: readonly CollectionSort[]
  archived?: 'include' | 'only'
  filters?: CollectionFilters
}

/**
 * API satırı: sistem alanları üstte, core kaydı `record` içinde. API yanıt şeması kaydı
 * `Record<string, unknown>` olarak bildirir; çağıran core tipini (`State['classes'][number]`)
 * verir. Rolün göremediği alanlar sunucuda çıkarıldığı için alanlar eksik olabilir.
 * TODO(api-record-schemas): kaynak uçları tipli yanıt şeması verince tip oradan gelir.
 */
export type CollectionRow<TRecord> = Omit<CollectionItem, 'record'> & { record: TRecord }

export interface CollectionPage<TRecord> {
  rows: CollectionRow<TRecord>[]
  page: number
  pageSize: number
  total: number
}

export const MAX_COLLECTION_PAGE_SIZE = 100
export const MIN_SEARCH_LENGTH = 2
/** Tüm sayfaları çekerken üst sınır (100 × 50 = 5000 kayıt); aşılırsa hata verilir. */
export const MAX_COLLECTION_PAGES = 50

const TOO_LARGE_MESSAGE = 'Liste çok büyük olduğu için tamamı indirilemedi.'

export class CollectionTooLargeError extends Error {
  constructor() {
    super(TOO_LARGE_MESSAGE)
    this.name = 'CollectionTooLargeError'
  }
}

/** Sorguyu openapi-fetch parametrelerine çevirir; boş/kısa arama ve boş filtreler gönderilmez. */
export function collectionListParams(query: CollectionQuery): ListQueryParams {
  const params: Record<string, unknown> = {}
  if (query.page !== undefined) params.page = query.page
  if (query.pageSize !== undefined)
    params.pageSize = Math.min(Math.max(1, query.pageSize), MAX_COLLECTION_PAGE_SIZE)
  const q = query.q?.trim() ?? ''
  if (q.length >= MIN_SEARCH_LENGTH) params.q = q
  if (query.sort?.length) params.sort = query.sort.slice(0, 3).join(',')
  if (query.archived) params.archived = query.archived
  for (const [field, value] of Object.entries(query.filters ?? {})) {
    const values = (typeof value === 'string' ? [value] : (value ?? [])).filter(Boolean)
    if (values.length === 1) params[field] = values[0]
    else if (values.length > 1) params[field] = [...values]
  }
  return params as ListQueryParams
}

/**
 * Sorgu anahtarı parçası: aynı anlamdaki sorgular aynı anahtarı üretir (kısa arama yok sayılır,
 * filtre sırası önemsiz). Etkin kurum `institutionKey` ile başa eklenir.
 */
export function collectionQueryKey(collection: string, query: CollectionQuery): unknown[] {
  const params = collectionListParams(query)
  const sorted = Object.fromEntries(
    Object.entries(params).sort(([left], [right]) => left.localeCompare(right)),
  )
  return ['collections', collection, 'list', sorted]
}

/**
 * Toplu sayım sorgusu (`GET /collections/:c/counts`): liste ucunun arama ve süzgeçleri aynen
 * geçerlidir; sayfa ve sıralama yoktur. `groupBy` zorunlu, `sum` isteğe bağlıdır.
 */
export interface CollectionCountsQuery {
  groupBy: CollectionGroupField
  sum?: CollectionSumField
  q?: string
  archived?: 'include' | 'only'
  filters?: CollectionFilters
}

export interface CollectionCounts {
  /** Gruplar değere göre sıralı; `null` grubu (alan yok) sondadır. */
  groups: CollectionCountGroup[]
  total: number
  /** Yalnız `sum` istendiğinde: bütün grupların toplamı. */
  sum?: number
}

export function collectionCountsParams(query: CollectionCountsQuery): CountQueryParams {
  const { groupBy, sum, ...rest } = query
  return {
    ...collectionListParams(rest),
    groupBy,
    ...(sum ? { sum } : {}),
  } as CountQueryParams
}

export function collectionCountsKey(collection: string, query: CollectionCountsQuery): unknown[] {
  const params = collectionCountsParams(query)
  const sorted = Object.fromEntries(
    Object.entries(params).sort(([left], [right]) => left.localeCompare(right)),
  )
  return ['collections', collection, 'counts', sorted]
}

/** Grubun sayısı; grup yoksa 0. Değer metin karşılaştırılır (`true` ↔ `'true'`). */
export function countOf(counts: CollectionCounts | undefined, value: string | boolean): number {
  return groupOf(counts, value)?.count ?? 0
}

/** Grubun toplamı (`sum` istenmişse); grup yoksa 0. */
export function sumOf(counts: CollectionCounts | undefined, value: string | boolean): number {
  return groupOf(counts, value)?.sum ?? 0
}

function groupOf(counts: CollectionCounts | undefined, value: string | boolean) {
  const wanted = String(value)
  return counts?.groups.find((group) => group.value !== null && String(group.value) === wanted)
}

export async function fetchCollectionCounts(
  client: KampusClient,
  collection: string,
  query: CollectionCountsQuery,
  signal?: AbortSignal,
): Promise<CollectionCounts> {
  const body = await runRequest(() =>
    client.GET('/api/v1/collections/{collection}/counts', {
      params: { path: { collection }, query: collectionCountsParams(query) },
      ...(signal ? { signal } : {}),
    }),
  )
  return {
    groups: body.data,
    total: body.meta.total,
    ...(body.meta.sum === undefined ? {} : { sum: body.meta.sum }),
  }
}

export function collectionItemKey(collection: string, id: string): unknown[] {
  return ['collections', collection, 'item', id]
}

/** Bir koleksiyonun bütün sorguları (yazma sonrası geçersiz kılmak için önek). */
export function collectionKeyPrefix(collection: string): unknown[] {
  return ['collections', collection]
}

export async function fetchCollectionPage<TRecord>(
  client: KampusClient,
  collection: string,
  query: CollectionQuery,
  signal?: AbortSignal,
): Promise<CollectionPage<TRecord>> {
  const body = await runRequest(() =>
    client.GET('/api/v1/collections/{collection}', {
      params: { path: { collection }, query: collectionListParams(query) },
      ...(signal ? { signal } : {}),
    }),
  )
  return {
    // Kayıt tipi çağıranın verdiği core tipidir (bkz. `CollectionRow`).
    rows: body.data as CollectionRow<TRecord>[],
    page: body.meta.page,
    pageSize: body.meta.pageSize,
    total: body.meta.total,
  }
}

/**
 * Aynı filtre, arama ve sıralamayla bütün sayfaları sırayla çeker (CSV ve küçük başvuru
 * koleksiyonları için). Sayfa sayısı sınırı aşılırsa `CollectionTooLargeError`.
 */
export async function fetchAllCollectionPages<TRecord>(
  client: KampusClient,
  collection: string,
  query: Omit<CollectionQuery, 'page' | 'pageSize'>,
  signal?: AbortSignal,
  maxPages = MAX_COLLECTION_PAGES,
): Promise<CollectionRow<TRecord>[]> {
  const rows: CollectionRow<TRecord>[] = []
  for (let page = 1; ; page += 1) {
    if (page > maxPages) throw new CollectionTooLargeError()
    const result = await fetchCollectionPage<TRecord>(
      client,
      collection,
      { ...query, page, pageSize: MAX_COLLECTION_PAGE_SIZE },
      signal,
    )
    rows.push(...result.rows)
    // Boş sayfa: kayıtlar okuma sırasında silindiyse sonsuz döngüye girilmez.
    if (rows.length >= result.total || result.rows.length === 0) return rows
  }
}

export async function fetchCollectionItem<TRecord>(
  client: KampusClient,
  collection: string,
  id: string,
  signal?: AbortSignal,
): Promise<CollectionRow<TRecord>> {
  const body = await runRequest(() =>
    client.GET('/api/v1/collections/{collection}/{id}', {
      params: { path: { collection, id } },
      ...(signal ? { signal } : {}),
    }),
  )
  return body.data as CollectionRow<TRecord>
}

/** Kapalı modül yanıtı (403 `module_disabled`): ekran menüden ve doğrudan erişimden kapanır. */
export function isModuleDisabledError(error: unknown): boolean {
  return isApiError(error) && error.status === 403 && error.code === 'module_disabled'
}
