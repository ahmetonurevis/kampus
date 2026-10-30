// Liste görünümünün saf hesapları: DataTable ve CollectionList aynı sonuç kümesini (CSV dahil)
// buradan alır. Vue `DataTable.vue`, `CollectionList.vue` ve `ListFilters.vue` davranışını taşır.
import {
  columnFilters,
  filterOptions,
  filterRows,
  hasFilter,
  pageCount,
  pageSlice,
  sortRows,
  type FilterField,
  type FilterValue,
  type FilterValues,
  type Row,
  type SortDirection,
} from './list-query.ts'
import { effectivePage, type ListState } from './list-state.ts'

export type ListColumn = { key: string; label: string }

/** İşlem sütunu; aranmaz, sıralanmaz, masaüstünde sağa sabitlenir. */
export const ACTIONS_KEY = 'actions'

/**
 * Tablo filtre alanları: sütunlardan türetilenler (hariç tutulanlar çıkarılır) ve açıkça
 * verilenler. Aynı anahtar bir kez yer alır; açık tanım türetileni ezer, sıra korunur.
 */
export function tableFields(
  columns: readonly ListColumn[],
  filters: readonly FilterField[] = [],
  exclude: readonly string[] = [],
): FilterField[] {
  const fields = new Map<string, FilterField>()
  for (const field of columnFilters(columns))
    if (!exclude.includes(field.key)) fields.set(field.key, field)
  for (const field of filters) fields.set(field.key, field)
  return [...fields.values()]
}

/** Aranan alanlar: işlem dışı sütunlar ve ek arama anahtarları (tekrarsız). */
export function tableSearchKeys(columns: readonly ListColumn[], extra: readonly string[] = []) {
  return [...new Set([...columns.filter((c) => c.key !== ACTIONS_KEY).map((c) => c.key), ...extra])]
}

/**
 * Dar ekran kartı: ilk işlem dışı sütun başlık, `mobileColumns` (yoksa sonraki üç sütun) temel
 * bilgiler, kalanlar "Diğer bilgiler" içinde.
 */
export function mobileColumnSplit<C extends ListColumn>(
  columns: readonly C[],
  mobileColumns: readonly string[] = [],
) {
  const data = columns.filter((column) => column.key !== ACTIONS_KEY)
  const [title, ...rest] = data
  const main = mobileColumns.length
    ? rest.filter((column) => mobileColumns.includes(column.key))
    : rest.slice(0, 3)
  return { title, main, details: rest.filter((column) => !main.includes(column)) }
}

export type SortOption = {
  value: string
  label: string
  key: string
  direction?: SortDirection
}

/** Kart listesi hazır sıralaması (Vue CollectionList): seçili değilse veri sırası korunur. */
export function orderRows<T extends Row>(
  rows: readonly T[],
  options: readonly SortOption[],
  ordering: string,
): T[] {
  const order = options.find((option) => option.value === ordering)
  if (!order) return [...rows]
  const text = (row: T) => {
    const value = row[order.key]
    return value === null || value === undefined || value === '' ? '' : String(value)
  }
  return [...rows].sort(
    (a, b) => text(a).localeCompare(text(b), 'tr', { numeric: true }) * (order.direction ?? 1),
  )
}

export type ListView<T> = {
  /** Filtrelenmiş ve sıralanmış tüm sonuç; CSV bunu kullanır. */
  rows: T[]
  total: number
  pageCount: number
  /** Geçerli aralığa çekilmiş sayfa. */
  page: number
  visible: T[]
}

type ListViewConfig<T extends Row> = {
  fields: readonly FilterField[]
  searchKeys: readonly string[]
  /** Verilmezse tablo sıralaması (`sortKey`/`sortDirection`) uygulanır. */
  sort?: (rows: T[], state: ListState) => T[]
}

export function listView<T extends Row>(
  rows: readonly T[],
  state: ListState,
  { fields, searchKeys, sort }: ListViewConfig<T>,
): ListView<T> {
  const filtered = filterRows(rows, state.query, fields, state.filters, searchKeys)
  const sorted = sort
    ? sort(filtered, state)
    : sortRows(filtered, state.sortKey, state.sortDirection)
  const pages = pageCount(sorted.length, state.pageSize)
  const page = effectivePage(state, pages)
  return {
    rows: sorted,
    total: sorted.length,
    pageCount: pages,
    page,
    visible: pageSlice(sorted, page, state.pageSize),
  }
}

/** Etkin filtre alanları (çip olarak gösterilir). */
export function activeFields(fields: readonly FilterField[], values: FilterValues) {
  return fields.filter((field) => hasFilter(values[field.key]))
}

/** Çip metni: tarih aralığı "başlangıç → bitiş", sayı "en az – en çok", seçim etiketi. */
export function filterSelectionLabel(
  field: FilterField,
  value: FilterValue,
  rows: readonly Row[],
): string {
  if (value !== null && typeof value === 'object') {
    if (field.type === 'date')
      return `${value.min || 'Başlangıç yok'} → ${value.max || 'Bitiş yok'}`
    return `${value.min ?? ''} – ${value.max ?? ''}`
  }
  const option = filterOptions(field, rows).find((item) => String(item.value) === String(value))
  return option?.label ?? String(value ?? '')
}

/** Hazır filtre seçili mi: değerler birebir aynıysa (anahtar sırası önemsiz). */
export function presetActive(values: FilterValues, preset: FilterValues): boolean {
  const keys = (object: FilterValues) => Object.keys(object).filter((key) => hasFilter(object[key]))
  const own = keys(values)
  const wanted = keys(preset)
  return (
    own.length === wanted.length &&
    wanted.every((key) => JSON.stringify(values[key]) === JSON.stringify(preset[key]))
  )
}
