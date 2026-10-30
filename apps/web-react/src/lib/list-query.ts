// Liste arama/filtre/sıralama/sayfa hesapları; Vue `lib/list-query.js` ve DataTable ile aynı davranır.
import { dayKey } from '@kampus/school-core/lib/format.ts'

export type Row = Readonly<Record<string, unknown>> & { readonly id: string | number }
export type RangeValue = { min?: string | number | null; max?: string | number | null }
export type FilterValue = string | number | RangeValue | null | undefined
export type FilterValues = Readonly<Record<string, FilterValue>>
export type FilterField = {
  key: string
  label: string
  type?: 'select' | 'date' | 'number'
  /** Sayısal alanlarda görüntü birimi (ör. kuruş → ₺ için 100). */
  divisor?: number
  options?: ReadonlyArray<{ value: string | number; label: string }>
}
export type SortDirection = 1 | -1

const isRange = (value: FilterValue): value is RangeValue =>
  typeof value === 'object' && value !== null

const isEmpty = (value: unknown) => value === '' || value === null || value === undefined

export function hasFilter(value: FilterValue): boolean {
  return isRange(value) ? [value.min, value.max].some((v) => !isEmpty(v)) : !isEmpty(value)
}

export function isInvalidRange(field: FilterField, value: FilterValue): boolean {
  if (!isRange(value) || isEmpty(value.min) || isEmpty(value.max)) return false
  return field.type === 'number'
    ? Number(value.min) > Number(value.max)
    : String(value.min) > String(value.max)
}

export function filterRows<T extends Row>(
  rows: readonly T[],
  query: string,
  fields: readonly FilterField[],
  values: FilterValues,
  searchKeys: readonly string[],
): T[] {
  const terms = query.trim().toLocaleLowerCase('tr').split(/\s+/).filter(Boolean)
  return rows.filter((row) => {
    const haystack = searchKeys
      .map((key) => {
        const value = row[key]
        return typeof value === 'string' || typeof value === 'number' ? value : ''
      })
      .join(' ')
      .toLocaleLowerCase('tr')
    if (!terms.every((term) => haystack.includes(term))) return false
    return fields.every((field) => {
      const selected = values[field.key]
      if (!hasFilter(selected)) return true
      const value = row[field.key]
      if (isEmpty(value)) return false
      if (field.type === 'date' && isRange(selected)) {
        const day = dayKey(value as string | number)
        return (
          (isEmpty(selected.min) || day >= String(selected.min)) &&
          (isEmpty(selected.max) || day <= String(selected.max))
        )
      }
      if (field.type === 'number' && isRange(selected)) {
        const number = Number(value) / (field.divisor || 1)
        return (
          Number.isFinite(number) &&
          (isEmpty(selected.min) || number >= Number(selected.min)) &&
          (isEmpty(selected.max) || number <= Number(selected.max))
        )
      }
      return String(value) === String(selected)
    })
  })
}

/** Boş değerler sona; sayılar sayısal, diğerleri Türkçe ve doğal sırayla karşılaştırılır. */
export function sortRows<T extends Row>(
  rows: readonly T[],
  key: string,
  direction: SortDirection,
): T[] {
  if (!key) return [...rows]
  return [...rows].sort((a, b) => {
    const left = a[key]
    const right = b[key]
    if (left == null) return right == null ? 0 : 1
    if (right == null) return -1
    return (
      (typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), 'tr', { numeric: true })) * direction
    )
  })
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize)
}

export type PageItem = number | `gap-${number}`

export function pageNumbers(page: number, pages: number): PageItem[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const selected = new Set([1, pages, page - 1, page, page + 1])
  const values = [...selected].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  return values.flatMap((n, i): PageItem[] => {
    const previous = values[i - 1]
    const gap = previous === undefined ? 0 : n - previous
    return gap === 2 ? [n - 1, n] : gap > 2 ? [`gap-${n}`, n] : [n]
  })
}

const SELECT_KEYS = new Set([
  'class',
  'branch',
  'subject',
  'level',
  'grade',
  'status',
  'statusLabel',
  'risk',
  'stage',
  'source',
  'interest',
  'category',
  'assignedTo',
  'teacher',
  'type',
  'role',
  'actor',
  'permission',
  'method',
  'topic',
])
const DATE_KEYS = new Set(['date', 'dueDate', 'submittedAt', 'createdAt', 'paidAt'])
const NUMBER_KEYS = new Set([
  'score',
  'amount',
  'installment',
  'absent',
  'average',
  'performance',
  'attendanceRate',
  'homeworkRate',
  'count',
  'occupancy',
  'breaches',
  'pending',
  'slaRate',
  'students',
  'duration',
  'enrolled',
])

/** Sütun anahtarından otomatik filtre alanı üretir (Vue `columnFilters`). */
export function columnFilters(columns: ReadonlyArray<{ key: string; label: string }>) {
  return columns.flatMap(({ key, label }): FilterField[] => {
    if (SELECT_KEYS.has(key)) return [{ key, label }]
    if (DATE_KEYS.has(key)) return [{ key, label, type: 'date' }]
    if (NUMBER_KEYS.has(key))
      return [
        {
          key,
          label: key === 'amount' ? 'Tutar (₺)' : label,
          type: 'number',
          divisor: key === 'amount' ? 100 : 1,
        },
      ]
    return []
  })
}

/** Seçim filtresinin seçenekleri: verilmediyse satırlardaki benzersiz değerlerden türetilir. */
export function filterOptions(field: FilterField, rows: readonly Row[]) {
  if (field.options) return field.options
  const values = new Set<string | number>()
  for (const row of rows) {
    const value = row[field.key]
    if ((typeof value === 'string' && value !== '') || typeof value === 'number') values.add(value)
  }
  return [...values]
    .sort((a, b) => String(a).localeCompare(String(b), 'tr', { numeric: true }))
    .map((value) => ({ value, label: String(value) }))
}
