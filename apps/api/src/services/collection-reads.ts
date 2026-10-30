import { dayKey } from '@kampus/school-core/lib/format.ts'
import type { Scope } from '@kampus/school-core/lib/scope.ts'

import type { CollectionName, RecordData } from '../db/collections.ts'
import {
  findRecord,
  INVOICE_STATUS_LABELS,
  loadRecordPage,
  loadRecords,
  type InvoiceStatusLabel,
  type RecordFilter,
  type SearchMatch,
  type StoredRecord,
} from '../db/records.ts'
import { NotFoundError, ValidationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { moduleOfCollection, readableCollection } from './collection-access.ts'
import {
  isJoinedField,
  joinedFieldsOf,
  JOINED_FIELDS,
  loadJoiner,
  type JoinedField,
  type JoinedValues,
  type Joiner,
} from './collection-joins.ts'
import {
  dayRange,
  invoiceStatusFilter,
  invoiceStatusOf,
  matchesRecordFilter,
} from './list-filters.ts'
import {
  assertReadable,
  readScope,
  readsWholeCollection,
  scopePrefilter,
  studentClasses,
  studentsOfClasses,
} from './read-scope.ts'

/**
 * Koleksiyon okuma servisi (geçiş köprüsü: modüller kendi kaynak uçlarına geçene kadar). Kayıtlar
 * kurum kapsamlı depodan yüklenir; core kapsamı (`scopeFor`) satırları süzüp alanları ayıkladıktan
 * sonra arama, filtre, sıralama ve sayfalama bellekte, ayıklanmış alanlar üzerinde yapılır: rolün
 * göremediği alan aramada da eşleşmez. Varsayılan sıra deponun döndürdüğü sıradır.
 *
 * Arama ve sıralama bağlı adlarda da çalışır (`collection-joins.ts`: sınıfta kampüs adı; taksit,
 * not, yoklamada öğrenci adı/numarası ve sınıf adı); bağlı kayıt da aktörün kapsamından ve
 * ayıklanmış biçiminden okunur. Taksit `status`'u türetilmiş alandır (`DERIVED_STATUS`).
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
  'invoices',
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

/**
 * Sıralama alanları. `createdAt`/`updatedAt` kayıt kolonudur; bağlı alanlar (`JOINED_FIELDS`)
 * yalnız tanımlı oldukları koleksiyonda geçerlidir (başkasında 400); diğerleri veri alanıdır.
 */
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
  ...JOINED_FIELDS,
] as const
export type SortField = (typeof SORT_FIELDS)[number]

export const ARCHIVED_MODES = ['include', 'only'] as const
export type ArchivedMode = (typeof ARCHIVED_MODES)[number]

export interface SortKey {
  field: SortField
  descending: boolean
}

/** Liste ve sayım uçlarının ortak süzgeçleri. */
export interface CollectionReadQuery {
  q?: string | undefined
  archived?: ArchivedMode | undefined
  filters?: Partial<Record<FilterField, readonly string[]>> | undefined
  /** `isActive` süzgeci; verilmezse etkin ve pasif kayıtlar birlikte döner. */
  isActive?: boolean | undefined
  /** `date` alanının Europe/Istanbul günü aralığı (`YYYY-MM-DD`, iki uç dahil). */
  dateFrom?: string | undefined
  dateTo?: string | undefined
}

export interface CollectionListQuery extends CollectionReadQuery {
  page: number
  pageSize: number
  sort?: readonly SortKey[] | undefined
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
  /** İstenen bağlı alanların değerleri (arama veya sıralama istediyse). */
  joined?: JoinedValues
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

export function matchesSearch(record: RecordData, needle: string): boolean {
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
  query: CollectionReadQuery,
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
  if (isJoinedField(field)) return item.joined?.[field]
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

/**
 * SQL arama adayının (`SearchMatch`, `db/records.ts`) bellekteki sonucun üst kümesi olduğu
 * aranan metinler: yazdırılabilir ASCII, JSON'da kaçışlanan `"` ve `\\` yok. Diğer metinler
 * yalnız bellekte aranır. Ön süzgeç her rolde kullanılır ve yalnız adayları daraltır: rolün
 * ayıklanan alanları aday metinden çıkarılır, kapsam ve son karar yine core'undur (ayıklanmış
 * kayıtta `matches`). Ayıklama alan çıkarır veya daraltır, eklemez; bu yüzden ham kayıttaki
 * aday bellekteki sonucu kapsar.
 */
export const SQL_SAFE_NEEDLE = /^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/

/**
 * Bağlı adı eşleşen kimliklerin SQL'e taşınan en fazla sayısı; aşılırsa (ör. `q=9` bütün
 * sınıfları tutar) aday süzgeci kullanılmaz, arama bellekte yapılır.
 */
const MAX_SQL_SEARCH_KEYS = 1000

/** Kapsamdan ve süzgeçlerden geçen satırlar; karar ayıklanmış kayıtta verilir. */
interface ReadResult {
  collection: CollectionName
  scope: Scope
  /** Kapsamdan geçmiş satırlar; `narrowed` ise süzgeç/arama da ham kayıtta adaydan geçmiştir. */
  rows: StoredRecord[]
  narrowed: boolean
  /** Ayıklanmış kayıtta süzgeç ve arama kararı (bağlı alanlar dahil). */
  matches: (item: VisibleRow) => boolean
  /** Bağlı alan istendiyse değerleri veren işlev. */
  joiner: Joiner | null
}

interface ReadOptions {
  /** Kapsam bilindikten sonra, süzgeçlerden önce sorgu alanlarının denetimi. */
  check?: (scope: Scope, collection: CollectionName) => void
  /** Sıralamada istenen bağlı alanlar. */
  joined?: readonly JoinedField[]
}

function invalidSort(): ValidationError {
  return new ValidationError([
    {
      path: ['sort'],
      code: 'invalid_value',
      message: 'Bu listede bu alana göre sıralama yapılamaz.',
    },
  ])
}

async function readRows(
  ctx: ServiceContext,
  name: string,
  query: CollectionReadQuery,
  options: ReadOptions = {},
): Promise<ReadResult | null> {
  const collection = readableCollection(name)
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, collection)
  const joinable = joinedFieldsOf(collection)
  if (options.joined?.some((field) => !joinable.includes(field))) throw invalidSort()
  options.check?.(scope, collection)
  const filters = await listFilters(ctx, scope, collection, query)
  if (filters === null) return null
  const needle = query.q ? searchKey(query.q) : null
  const narrowed = filters.length > 0 || needle !== null
  // Arama bağlı alanlarda da çalışır (`collection-joins.ts`).
  const joinedSearch = needle !== null && joinable.length > 0
  const wanted = new Set<JoinedField>([
    ...(options.joined ?? []),
    ...(joinedSearch ? joinable : []),
  ])
  const joiner = wanted.size > 0 ? await loadJoiner(ctx, scope, [...wanted]) : null
  const passes = (record: RecordData) =>
    filters.every((filter) => matchesRecordFilter(record, filter))
  // Bağlı adlar az sayıda farklı değerdir; arama biçimi değer başına bir kez hesaplanır.
  const keys = new Map<string, string>()
  const keyOf = (value: string) => {
    let key = keys.get(value)
    if (key === undefined) keys.set(value, (key = searchKey(value)))
    return key
  }
  const joinedMatch = (joined: JoinedValues) =>
    needle !== null && Object.values(joined).some((value) => keyOf(value).includes(needle))
  const matches = (item: VisibleRow) =>
    passes(item.record) &&
    (needle === null ||
      matchesSearch(item.record, needle) ||
      (joinedSearch && joinedMatch(item.joined ?? {})))
  const prefilter = scopePrefilter(scope, collection)
  const search = sqlSearch()
  function sqlSearch(): SearchMatch | undefined {
    if (needle === null || !SQL_SAFE_NEEDLE.test(needle)) return undefined
    const keys =
      joinedSearch && joiner ? joiner.relatedKeys((value) => keyOf(value).includes(needle)) : []
    if (keys.reduce((total, key) => total + key.values.length, 0) > MAX_SQL_SEARCH_KEYS)
      return undefined
    return { needle, exclude: scope.hiddenFields(collection), keys }
  }
  const loaded = await loadRecords(ctx.db, ctx.institutionId, [collection], {
    includeArchived: query.archived !== undefined,
    match: prefilter ? [prefilter, ...filters] : filters,
    ...(search ? { search } : {}),
  })
  // Ayıklama alan çıkarır veya daraltır, eklemez: ham kayıtta eşleşmeyen ayıklanmışta da
  // eşleşmez. Ham eşleşme yalnız adaydır; karar ayıklanmış kayıtta verilir.
  // Bağlı kimlik alanları ayıklanmaz; ham kayıttaki bağlı eşleşme de yalnız adaydır.
  const candidate = (record: RecordData) =>
    passes(record) &&
    (needle === null ||
      matchesSearch(record, needle) ||
      (joinedSearch && joiner !== null && joinedMatch(joiner.values(record))))
  const rows = loaded.filter(
    (row) =>
      (query.archived !== 'only' || row.archivedAt !== null) &&
      scope.canRead(collection, row.data) &&
      (!narrowed || candidate(row.data)),
  )
  return { collection, scope, rows, narrowed, matches, joiner }
}

/** Ayıklanmış kayıtlar; daraltılmış sorguda son karar burada verilir. */
function visibleRows({
  collection,
  scope,
  rows,
  narrowed,
  matches,
  joiner,
}: ReadResult): VisibleRow[] {
  const items = rows.map((row): VisibleRow => {
    const record = scope.redact(collection, row.data)
    // Bağlı kaydın kimliği de ayıklanmış kayıttan okunur.
    return joiner ? { row, record, joined: joiner.values(record) } : { row, record }
  })
  return narrowed ? items.filter(matches) : items
}

/**
 * Süzgeçsiz, aramasız, sıralamasız listede koleksiyonun tamamını okuyan aktör
 * (`readsWholeCollection`) için sayfa ve toplam SQL'dendir; yalnız sayfanın satırları yüklenip
 * ayıklanır. Sayfada kapsamdan geçmeyen satır çıkarsa (core kuralı değişti) loglanır ve bellek
 * yoluna dönülür (`null`).
 */
async function sqlPage(
  ctx: ServiceContext,
  name: string,
  query: CollectionListQuery,
): Promise<{ items: CollectionItem[]; total: number } | null> {
  const plain =
    !query.q &&
    (query.sort ?? []).length === 0 &&
    query.isActive === undefined &&
    query.dateFrom === undefined &&
    query.dateTo === undefined &&
    Object.values(query.filters ?? {}).every((values) => !values || values.length === 0)
  if (!plain) return null
  const collection = readableCollection(name)
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, collection)
  if (!readsWholeCollection(scope, collection)) return null
  const { rows, total } = await loadRecordPage(ctx.db, ctx.institutionId, collection, {
    archived: query.archived,
    offset: (query.page - 1) * query.pageSize,
    limit: query.pageSize,
  })
  if (!rows.every((row) => scope.canRead(collection, row.data))) {
    ctx.log.warn({ event: 'collection.sql_page_scope_mismatch', collection })
    return null
  }
  return {
    items: rows.map((row) => toItem({ row, record: scope.redact(collection, row.data) })),
    total,
  }
}

export async function listCollection(
  ctx: ServiceContext,
  name: string,
  query: CollectionListQuery,
): Promise<{ items: CollectionItem[]; total: number }> {
  const sort = query.sort ?? []
  const page = await sqlPage(ctx, name, query)
  if (page) return page
  const result = await readRows(ctx, name, query, {
    joined: sort.flatMap((key) => (isJoinedField(key.field) ? [key.field] : [])),
  })
  if (result === null) return { items: [], total: 0 }
  const { collection, scope, rows, narrowed } = result
  const start = (query.page - 1) * query.pageSize
  if (!narrowed && sort.length === 0)
    // Arama ve sıralama yoksa yalnız istenen sayfa ayıklanır.
    return {
      items: rows
        .slice(start, start + query.pageSize)
        .map((row) => toItem({ row, record: scope.redact(collection, row.data) })),
      total: rows.length,
    }
  const items = sorted(fieldResolver(ctx, collection), visibleRows(result), sort)
  return { items: items.slice(start, start + query.pageSize).map(toItem), total: items.length }
}

/** Gruplanabilen alanlar (beyaz liste): eşitlik süzgeci alanları, `isActive` ve `level`. */
export const GROUP_FIELDS = [...FILTER_FIELDS, 'isActive', 'level'] as const
export type GroupField = (typeof GROUP_FIELDS)[number]

/** Grup başına toplanabilen sayısal alanlar (beyaz liste; para alanı kuruş). */
export const SUM_FIELDS = [
  'amount',
  'capacity',
  'score',
  'progress',
  'attendanceRate',
  'homeworkRate',
] as const
export type SumField = (typeof SUM_FIELDS)[number]

export interface CollectionCountQuery extends CollectionReadQuery {
  groupBy: GroupField
  sum?: SumField | undefined
}

/** Grup değeri: kaydın skaler değeri; dizi, nesne veya eksik değer `null` grubudur. */
export type GroupValue = string | number | boolean | null

export interface CountGroup {
  value: GroupValue
  count: number
  /** Yalnız `sum` istendiğinde: gruptaki sonlu sayı değerlerinin toplamı. */
  sum?: number
}

function groupValue(value: unknown): GroupValue {
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function hiddenFieldError(field: 'groupBy' | 'sum'): ValidationError {
  return new ValidationError([
    {
      path: [field],
      code: 'invalid_value',
      message: field === 'groupBy' ? 'Bu alana göre gruplama yapılamaz.' : 'Bu alan toplanamaz.',
    },
  ])
}

/**
 * Toplu sayım (`GET /collections/:c/counts`): liste ucuyla aynı kapsam, süzgeç ve arama; sonuç
 * grup başına sayı ve istenirse toplam. Rolün göremediği (ayıklanan) alanla gruplama veya toplama
 * 400'dür: alan o rol için yoktur. Değer ayıklanmış kayıttan okunur; taksit `status`'u türetilir,
 * `isActive` alanı olmayan kayıt etkindir, kaydında sınıf olmayan öğrenci koleksiyonlarında
 * `classId` öğrencinin güncel sınıfıdır (süzgeçle aynı). Gruplar değere göre sıralıdır, `null` sonda.
 */
export async function countCollection(
  ctx: ServiceContext,
  name: string,
  query: CollectionCountQuery,
): Promise<{ groups: CountGroup[]; total: number; sum?: number }> {
  const result = await readRows(ctx, name, query, {
    check(scope, collection) {
      const hidden = scope.hiddenFields(collection)
      if (hidden.includes(query.groupBy)) throw hiddenFieldError('groupBy')
      if (query.sum && hidden.includes(query.sum)) throw hiddenFieldError('sum')
    },
  })
  const withSum = query.sum !== undefined
  if (result === null) return { groups: [], total: 0, ...(withSum ? { sum: 0 } : {}) }
  const { collection } = result
  const resolver = fieldResolver(ctx, collection)
  const classOf =
    query.groupBy === 'classId' && CLASS_VIA_STUDENT.has(collection)
      ? await studentClasses(ctx)
      : null
  const valueOf = (record: RecordData): GroupValue => {
    if (classOf) {
      const student = record.studentId
      return typeof student === 'string' ? (classOf.get(student) ?? null) : null
    }
    if (query.groupBy === 'isActive') return record.isActive !== false
    return groupValue(recordValue(resolver, record, query.groupBy))
  }
  const groups = new Map<string, CountGroup>()
  let total = 0
  let sum = 0
  for (const { record } of visibleRows(result)) {
    const value = valueOf(record)
    const key = JSON.stringify(value)
    const group = groups.get(key) ?? { value, count: 0, ...(withSum ? { sum: 0 } : {}) }
    group.count += 1
    total += 1
    if (query.sum) {
      const amount = record[query.sum]
      if (typeof amount === 'number' && Number.isFinite(amount)) {
        group.sum = (group.sum ?? 0) + amount
        sum += amount
      }
    }
    groups.set(key, group)
  }
  return {
    groups: [...groups.values()].sort((a, b) => compareValues(a.value, b.value, false)),
    total,
    ...(withSum ? { sum } : {}),
  }
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
