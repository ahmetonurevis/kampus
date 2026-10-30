import type { RecordData } from '../db/collections.ts'
import { findRecord, loadRecords, type StoredRecord } from '../db/records.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { moduleOfCollection, readableCollection } from './collection-access.ts'
import { assertReadable, readScope } from './read-scope.ts'

/**
 * Koleksiyon okuma servisi (geçiş köprüsü: modüller kendi kaynak uçlarına geçene kadar). Kayıtlar
 * kurum kapsamlı depodan yüklenir; core kapsamı (`scopeFor`) satırları süzüp alanları ayıkladıktan
 * sonra arama, filtre, sıralama ve sayfalama bellekte, ayıklanmış alanlar üzerinde yapılır: rolün
 * göremediği alan aramada da eşleşmez. Varsayılan sıra deponun döndürdüğü sıradır.
 * TODO(collection-sql): büyük koleksiyonlar (not, yoklama) normalleşince veya ölçüm p95 > 50 ms
 * gösterince süzme ve sayfalama SQL'e iner (veritabani.md §4).
 */

/** Eşitlik filtresi kabul edilen veri alanları (beyaz liste; bilinmeyen sorgu parametresi 400). */
export const FILTER_FIELDS = [
  'studentId',
  'classId',
  'teacherId',
  'subjectId',
  'branchId',
  'parentId',
  'examId',
  'clubId',
  'routeId',
  'quizId',
  'homeworkId',
  'videoId',
  'status',
  'stage',
  'category',
  'type',
  'grade',
] as const
export type FilterField = (typeof FILTER_FIELDS)[number]

/** Sıralama alanları. `createdAt`/`updatedAt` kayıt kolonudur; diğerleri veri alanıdır. */
export const SORT_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'name',
  'title',
  'date',
  'dueDate',
  'deadline',
  'followUp',
  'status',
  'stage',
  'grade',
  'score',
  'amount',
  'installment',
  'number',
] as const
export type SortField = (typeof SORT_FIELDS)[number]

export const ARCHIVED_MODES = ['include', 'only'] as const
export type ArchivedMode = (typeof ARCHIVED_MODES)[number]

export interface SortKey {
  field: SortField
  descending: boolean
}

export interface CollectionListQuery {
  page: number
  pageSize: number
  q?: string | undefined
  sort?: readonly SortKey[] | undefined
  archived?: ArchivedMode | undefined
  filters?: Partial<Record<FilterField, readonly string[]>> | undefined
}

/** Yanıt kaydı: üst alanlar kolondan, `record` school-core kaydının role göre görünen alanları. */
export interface CollectionItem {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  record: RecordData
}

function isSortField(value: string): value is SortField {
  return SORT_FIELDS.some((field) => field === value)
}

/** `-createdAt,name` → sıralama anahtarları. Şema biçimi doğrular; burada yalnız ayrıştırılır. */
export function parseSort(raw: string | undefined): SortKey[] {
  if (!raw) return []
  return raw.split(',').flatMap((part) => {
    const descending = part.startsWith('-')
    const field = descending ? part.slice(1) : part
    return isSortField(field) ? [{ field, descending }] : []
  })
}

/** Kapsamdan geçmiş satır ve rolün görebildiği alanları (ayıklanmış kopya). */
interface VisibleRow {
  row: StoredRecord
  record: RecordData
}

function toItem({ row, record }: VisibleRow): CollectionItem {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    record,
  }
}

/** Türkçe büyük/küçük harf ve aksan duyarsız karşılaştırma biçimi (api-tasarimi.md §3). */
export function searchKey(value: string): string {
  return value.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '')
}

function searchable(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) return value.flatMap((item) => (typeof item === 'string' ? [item] : []))
  return []
}

function matchesSearch(item: VisibleRow, needle: string): boolean {
  return Object.values(item.record).some((value) =>
    searchable(value).some((text) => searchKey(text).includes(needle)),
  )
}

function primitiveText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function matchesFilter(item: VisibleRow, field: FilterField, values: readonly string[]) {
  const value = item.record[field]
  const candidates = Array.isArray(value) ? value.map(primitiveText) : [primitiveText(value)]
  return candidates.some((text) => text !== null && values.includes(text))
}

function sortValue(item: VisibleRow, field: SortField): unknown {
  // Kolon zamanları ISO metni olarak karşılaştırılır (yanıttaki biçimle aynı sıra).
  if (field === 'id') return item.row.id
  if (field === 'createdAt') return item.row.createdAt.toISOString()
  if (field === 'updatedAt') return item.row.updatedAt.toISOString()
  return item.record[field]
}

const collator = new Intl.Collator('tr-TR', { numeric: true })

/** Sayı < metin; boş değer yöne bakmadan sonda. */
function compareValues(a: unknown, b: unknown, descending: boolean): number {
  const aEmpty = a === undefined || a === null || a === ''
  const bEmpty = b === undefined || b === null || b === ''
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1
  let result: number
  if (typeof a === 'number' && typeof b === 'number') result = a - b
  else if (typeof a === 'number') result = -1
  else if (typeof b === 'number') result = 1
  else result = collator.compare(String(a), String(b))
  return descending ? -result : result
}

function sorted(items: VisibleRow[], keys: readonly SortKey[]): VisibleRow[] {
  if (keys.length === 0) return items
  // Eşitlikte deponun sırası korunur (kararlı sıralama); aynı sorgu aynı sırayı verir.
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      for (const key of keys) {
        const result = compareValues(
          sortValue(left.item, key.field),
          sortValue(right.item, key.field),
          key.descending,
        )
        if (result !== 0) return result
      }
      return left.index - right.index
    })
    .map((entry) => entry.item)
}

export async function listCollection(
  ctx: ServiceContext,
  name: string,
  query: CollectionListQuery,
): Promise<{ items: CollectionItem[]; total: number }> {
  const collection = readableCollection(name)
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, collection)
  const rows = await loadRecords(ctx.db, ctx.institutionId, [collection], {
    includeArchived: query.archived !== undefined,
  })
  let items: VisibleRow[] = []
  for (const row of rows) {
    if (query.archived === 'only' && row.archivedAt === null) continue
    if (!scope.canRead(collection, row.data)) continue
    items.push({ row, record: scope.redact(collection, row.data) })
  }
  for (const field of FILTER_FIELDS) {
    const values = query.filters?.[field]
    if (values && values.length > 0)
      items = items.filter((item) => matchesFilter(item, field, values))
  }
  if (query.q) {
    const needle = searchKey(query.q)
    items = items.filter((item) => matchesSearch(item, needle))
  }
  items = sorted(items, query.sort ?? [])
  const start = (query.page - 1) * query.pageSize
  return { items: items.slice(start, start + query.pageSize).map(toItem), total: items.length }
}

/** Tek kayıt. Yok, arşivde, başka kurumda veya aktörün kapsamı dışında: aynı 404 (DOM-YTK-011). */
export async function getCollectionItem(
  ctx: ServiceContext,
  name: string,
  id: string,
  options: { archived?: 'include' | undefined } = {},
): Promise<CollectionItem> {
  const collection = readableCollection(name)
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, collection)
  const row = await findRecord(ctx.db, ctx.institutionId, collection, id, {
    includeArchived: options.archived === 'include',
  })
  if (!row || !scope.canRead(collection, row.data)) throw new NotFoundError()
  return toItem({ row, record: scope.redact(collection, row.data) })
}

/** `requireModule` çözücüsü: koleksiyonun core modülü; bilinmeyen koleksiyon 404. */
export function collectionModule(name: string): string | null {
  return moduleOfCollection(readableCollection(name))
}
