import { dayKey } from '@kampus/school-core/lib/format.ts'
import type { Scope } from '@kampus/school-core/lib/scope.ts'

import type { CollectionName, RecordData } from '../db/collections.ts'
import {
  findRecord,
  INVOICE_STATUS_LABELS,
  loadRecords,
  type InvoiceStatusLabel,
  type RecordFilter,
  type StoredRecord,
} from '../db/records.ts'
import { NotFoundError, ValidationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { moduleOfCollection, readableCollection } from './collection-access.ts'
import {
  dayRange,
  invoiceStatusFilter,
  invoiceStatusOf,
  matchesRecordFilter,
} from './list-filters.ts'
import { assertReadable, readScope, scopePrefilter, studentsOfClasses } from './read-scope.ts'

/**
 * Koleksiyon okuma servisi (geçiş köprüsü: modüller kendi kaynak uçlarına geçene kadar). Kayıtlar
 * kurum kapsamlı depodan yüklenir; core kapsamı (`scopeFor`) satırları süzüp alanları ayıkladıktan
 * sonra arama, filtre, sıralama ve sayfalama bellekte, ayıklanmış alanlar üzerinde yapılır: rolün
 * göremediği alan aramada da eşleşmez. Varsayılan sıra deponun döndürdüğü sıradır.
 *
 * Veritabanı yalnız aday satırları döndürür: eşitlik filtreleri ve büyük kişisel koleksiyonlarda
 * kapsam kimlikleri SQL ön süzgecidir (`FieldMatch`, `scopePrefilter`); karar yine bellekte,
 * core kapsamı ve ayıklanmış alanlarla verilir.
 * TODO(collection-sql): sayfalama ve sıralama SQL'e inmedi; yönetici büyük koleksiyonu tümüyle
 * yükler (`read-scope.ts` `TODO(perf)`; veritabani.md §4).
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

/**
 * Kaydında `classId` olmayan, öğrenciye bağlı koleksiyonlar: `classId` süzgeci öğrencinin
 * güncel sınıfından (`students.classId`, kapsam kaynağı) öğrenci kimliklerine çevrilir; istemci
 * sınıfın öğrencilerini tek tek göndermez. Diğer koleksiyonlarda `classId` kaydın alanıdır.
 */
const CLASS_VIA_STUDENT: ReadonlySet<CollectionName> = new Set<CollectionName>([
  'grades',
  'absences',
  'submissions',
  'quizAttempts',
  'mockResults',
  'studentGoals',
])

/**
 * Saklanmayan, istekte türetilen alanlar: taksitin `status`'u core `invoiceStatus` ile `paidAt`,
 * vade ve isteğin saatinden (`ctx.now`) hesaplanır. Süzgeç, sıralama ve gruplama bu değeri
 * kullanır; kayıttaki aynı adlı alan yok sayılır.
 */
const DERIVED_STATUS: ReadonlySet<CollectionName> = new Set<CollectionName>(['invoices'])

function isInvoiceStatus(value: string): value is InvoiceStatusLabel {
  return INVOICE_STATUS_LABELS.some((label) => label === value)
}

/** Gün aralığı süzgecinin alanı (`dateFrom`/`dateTo`). */
export const DATE_FILTER_FIELD = 'date'

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
  /** `isActive` süzgeci; verilmezse etkin ve pasif kayıtlar birlikte döner. */
  isActive?: boolean | undefined
  /** `date` alanının Europe/Istanbul günü aralığı (`YYYY-MM-DD`, iki uç dahil). */
  dateFrom?: string | undefined
  dateTo?: string | undefined
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

function matchesSearch(record: RecordData, needle: string): boolean {
  return Object.values(record).some((value) =>
    searchable(value).some((text) => searchKey(text).includes(needle)),
  )
}

/**
 * Sorgunun süzgeçleri; `null` sonucun boş olduğunu bildirir (öğrencisiz sınıf, ayıklanan alan).
 * Rolün göremediği (ayıklanan) alana göre süzülemez: alan o rol için yoktur.
 */
async function listFilters(
  ctx: ServiceContext,
  scope: Scope,
  collection: CollectionName,
  query: CollectionListQuery,
): Promise<RecordFilter[] | null> {
  const filters: RecordFilter[] = []
  for (const field of FILTER_FIELDS) {
    const values = query.filters?.[field]
    if (!values || values.length === 0) continue
    if (field === 'classId' && CLASS_VIA_STUDENT.has(collection)) {
      const students = await studentsOfClasses(ctx, values)
      if (students.length === 0) return null
      filters.push({ field: 'studentId', values: students })
    } else if (field === 'status' && DERIVED_STATUS.has(collection)) {
      const statuses = values.filter(isInvoiceStatus)
      if (statuses.length !== values.length)
        throw new ValidationError([
          {
            path: ['status'],
            code: 'invalid_value',
            message: `Taksit durumu ${INVOICE_STATUS_LABELS.join(', ')} değerlerinden biri olmalıdır.`,
          },
        ])
      filters.push(invoiceStatusFilter(statuses, ctx.now))
    } else filters.push({ field, values })
  }
  if (query.isActive !== undefined)
    filters.push({ kind: 'active', field: 'isActive', active: query.isActive })
  const range = dayRange(DATE_FILTER_FIELD, query.dateFrom, query.dateTo)
  if (range) filters.push(range)
  const hidden = scope.hiddenFields(collection)
  const fieldOf = (filter: RecordFilter) =>
    filter.kind === 'invoiceStatus' ? ['paidAt', 'dueDate'] : [filter.field]
  return filters.some((filter) => fieldOf(filter).some((field) => hidden.includes(field)))
    ? null
    : filters
}

/** İsteğe göre alan değeri: türetilmiş alanlar (`DERIVED_STATUS`) burada hesaplanır. */
interface FieldResolver {
  collection: CollectionName
  /** İsteğin Europe/Istanbul günü (`dayKey(ctx.now)`). */
  today: string
}

function fieldResolver(ctx: ServiceContext, collection: CollectionName): FieldResolver {
  return { collection, today: dayKey(ctx.now) }
}

function recordValue(resolver: FieldResolver, record: RecordData, field: string): unknown {
  if (field === 'status' && DERIVED_STATUS.has(resolver.collection))
    return invoiceStatusOf(record, resolver.today)
  return record[field]
}

function sortValue(resolver: FieldResolver, item: VisibleRow, field: SortField): unknown {
  // Kolon zamanları ISO metni olarak karşılaştırılır (yanıttaki biçimle aynı sıra).
  if (field === 'id') return item.row.id
  if (field === 'createdAt') return item.row.createdAt.toISOString()
  if (field === 'updatedAt') return item.row.updatedAt.toISOString()
  return recordValue(resolver, item.record, field)
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

function sorted(
  resolver: FieldResolver,
  items: VisibleRow[],
  keys: readonly SortKey[],
): VisibleRow[] {
  if (keys.length === 0) return items
  // Eşitlikte deponun sırası korunur (kararlı sıralama); aynı sorgu aynı sırayı verir.
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      for (const key of keys) {
        const result = compareValues(
          sortValue(resolver, left.item, key.field),
          sortValue(resolver, right.item, key.field),
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
  const filters = await listFilters(ctx, scope, collection, query)
  if (filters === null) return { items: [], total: 0 }
  const needle = query.q ? searchKey(query.q) : null
  const narrowed = filters.length > 0 || needle !== null
  const matches = (record: RecordData) =>
    filters.every((filter) => matchesRecordFilter(record, filter)) &&
    (needle === null || matchesSearch(record, needle))
  const prefilter = scopePrefilter(scope, collection)
  const rows = await loadRecords(ctx.db, ctx.institutionId, [collection], {
    includeArchived: query.archived !== undefined,
    match: prefilter ? [prefilter, ...filters] : filters,
  })
  // Ayıklama alan çıkarır veya daraltır, eklemez: ham kayıtta eşleşmeyen ayıklanmışta da
  // eşleşmez. Ham eşleşme yalnız adaydır; karar ayıklanmış kayıtta verilir.
  const visible = rows.filter(
    (row) =>
      (query.archived !== 'only' || row.archivedAt !== null) &&
      scope.canRead(collection, row.data) &&
      (!narrowed || matches(row.data)),
  )
  const redact = (row: StoredRecord): VisibleRow => ({
    row,
    record: scope.redact(collection, row.data),
  })
  const start = (query.page - 1) * query.pageSize
  const sort = query.sort ?? []
  if (!narrowed && sort.length === 0)
    // Arama ve sıralama yoksa yalnız istenen sayfa ayıklanır.
    return {
      items: visible.slice(start, start + query.pageSize).map((row) => toItem(redact(row))),
      total: visible.length,
    }
  let items = visible.map(redact)
  if (narrowed) items = items.filter((item) => matches(item.record))
  items = sorted(fieldResolver(ctx, collection), items, sort)
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
