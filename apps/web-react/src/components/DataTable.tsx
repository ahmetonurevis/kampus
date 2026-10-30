import { useImperativeHandle, useMemo, type MouseEvent, type ReactNode, type Ref } from 'react'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { Icon } from '@/components/Icon.tsx'
import { ListFilters } from '@/components/ListFilters.tsx'
import { Pagination } from '@/components/Pagination.tsx'
import { SearchField } from '@/components/SearchField.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useListState } from '@/hooks/use-list-state.ts'
import { useListView } from '@/hooks/use-list-view.ts'
import { useMediaQuery } from '@/hooks/use-media-query.ts'
import { pageCount, type FilterField, type Row } from '@/lib/list-query.ts'
import {
  ACTIONS_KEY,
  emptyListView,
  listNarrowed,
  mobileColumnSplit,
  tableFields,
  tableSearchKeys,
  type ListColumn,
} from '@/lib/list-view.ts'
import { cn } from '@/lib/utils'

export type DataColumn<T extends Row> = ListColumn & {
  /** Hücre içeriği; verilmezse değer, boşsa "—". */
  cell?: (row: T) => ReactNode
}

export type DataTableHandle<T extends Row> = {
  /** Filtrelenmiş ve sıralanmış tüm sonuç (CSV için; yalnız görünen sayfa değil). */
  filteredRows: () => T[]
  reset: () => void
}

/** Liste durumu denetleyicisi (`useListState` çıktısı); sunucu tablosunda sayfa sahibi tutar. */
export type ListController = ReturnType<typeof useListState>

/** İstemci ve sunucu tablolarının ortak görünüm seçenekleri. */
type TableOptions<T extends Row> = {
  columns: readonly DataColumn<T>[]
  /** Dar ekran kartında temel bilgi olarak gösterilecek sütunlar (yoksa ilk üçü). */
  mobileColumns?: readonly string[]
  search?: boolean
  /** Liste gerçekten boşken metin (arama/filtre yokken); varsayılan "Henüz kayıt yok.". */
  empty?: string
  /** Arama veya filtre sonucu boşken metin. */
  emptyFiltered?: string
  externalActive?: boolean
  externalLabel?: string
  /** Araç çubuğundaki dış filtre kontrolleri (dar ekranda filtre paneline taşınır). */
  toolbar?: ReactNode
  /** Hazır filtre çipleri (dar ekranda filtre paneline taşınır). */
  presets?: ReactNode
  onReset?: () => void
  /** Ekran okuyucu tablo başlığı. */
  caption?: string
  /** Satıra tıklanınca (bağlantı/düğme dışındaki alan); klavye için satırda ayrıca düğme olmalı. */
  onRowClick?: (row: T) => void
}

type DataTableProps<T extends Row> = TableOptions<T> & {
  listKey: string
  rows: readonly T[]
  pageSize?: number
  filters?: readonly FilterField[]
  excludeFilters?: readonly string[]
  /** Dış filtre anahtarı; değişince sayfa ve kaydırma sıfırlanır. */
  filterKey?: string
  searchKeys?: readonly string[]
  urlPrefix?: string
  ref?: Ref<DataTableHandle<T>>
}

type ServerDataTableProps<T extends Row> = TableOptions<T> & {
  list: ListController
  /** Sunucunun döndürdüğü geçerli sayfa; ilk yüklemede `undefined`. */
  rows: readonly T[] | undefined
  /** Filtre uygulanmış toplam kayıt (`meta.total`). */
  total: number
  /** Sunucunun sıralayabildiği sütunlar; diğer başlıklar düğme değildir. */
  sortable: readonly string[]
  /** Filtre paneli alanları; seçenekleri (`options`) verilmelidir, değerler sunucuya gider. */
  filters?: readonly FilterField[]
  /** İlk yükleme: satır yokken durum metni gösterilir. */
  loading?: boolean
  /** Önceki sayfa ekrandayken yenisi yükleniyor. */
  fetching?: boolean
  /** Hata içeriği (Türkçe mesaj ve yeniden dene); verilirse satırların yerine çizilir. */
  error?: ReactNode
}

const features = tableFeatures({})
const MOBILE = '(max-width: 650px)'
const NO_FILTERS: readonly FilterField[] = []
const NO_KEYS: readonly string[] = []
const NO_ROWS: readonly never[] = []
const DEFAULT_SEARCH_KEYS = ['phone', 'email'] as const
const INTERACTIVE = 'a, button, input, select, textarea, summary, label'

const display = (value: unknown): ReactNode =>
  value === null || value === undefined || value === '' ? '—' : String(value)

function renderCell<T extends Row>(column: DataColumn<T>, row: T): ReactNode {
  return column.cell ? column.cell(row) : display(row[column.key])
}

/**
 * Kayıt tablosu (Vue `DataTable.vue`). Satır/sütun modeli TanStack Table'dan; arama, filtre,
 * Türkçe sıralama ve sayfa `useListState` + `list-view` ile (CSV aynı sonucu kullanır).
 * Masaüstünde başlık ve işlem sütunu sabit, ≤ 650 px'te kart + "Diğer bilgiler".
 */
export function DataTable<T extends Row>({
  listKey,
  rows,
  columns,
  pageSize = 8,
  filters = NO_FILTERS,
  excludeFilters = NO_KEYS,
  filterKey = '',
  searchKeys = DEFAULT_SEARCH_KEYS,
  urlPrefix,
  ref,
  ...options
}: DataTableProps<T>) {
  const list = useListState(listKey, { pageSize, urlPrefix, resetKey: filterKey })
  const config = useMemo(
    () => ({
      fields: tableFields(columns, filters, excludeFilters),
      searchKeys: tableSearchKeys(columns, searchKeys),
    }),
    [columns, filters, excludeFilters, searchKeys],
  )
  const view = useListView(rows, list.state, list.dispatch, config)

  useImperativeHandle(ref, () => ({
    filteredRows: () => view.rows,
    reset: () => {
      list.dispatch({ type: 'clear' })
      options.onReset?.()
    },
  }))

  return (
    <TableView
      {...options}
      list={list}
      columns={columns}
      visible={view.visible}
      total={view.total}
      page={view.page}
      fields={config.fields}
      filterRows={rows}
      sortable="all"
    />
  )
}

/**
 * Sunucu sayfalı kayıt tablosu: arama, filtre, sıralama ve sayfa sunucuda uygulanır; liste
 * durumu çağırandadır (sorgu anahtarını o kurar, bkz. `kod-yazim.md` §4 "Sunucu verili liste").
 * Görünüm ve davranış `DataTable` ile aynıdır. Veri azalıp sayfa geçersiz kalırsa son geçerli
 * sayfaya çekilir; yüklenirken eski sayfa ekranda kalır.
 */
export function ServerDataTable<T extends Row>({
  list,
  rows,
  total,
  sortable,
  filters = NO_FILTERS,
  ...options
}: ServerDataTableProps<T>) {
  const pages = pageCount(total, list.state.pageSize)
  if (total > 0 && list.state.page > pages) list.dispatch({ type: 'clamp', pageCount: pages })
  return (
    <TableView
      {...options}
      list={list}
      visible={rows ?? NO_ROWS}
      total={total}
      page={Math.min(list.state.page, Math.max(1, pages))}
      fields={filters}
      filterRows={NO_ROWS}
      sortable={sortable}
    />
  )
}

type TableViewProps<T extends Row> = TableOptions<T> & {
  list: ListController
  visible: readonly T[]
  total: number
  page: number
  fields: readonly FilterField[]
  /** Filtre seçeneklerinin türetildiği satırlar (istemci tablosu). */
  filterRows: readonly Row[]
  sortable: readonly string[] | 'all'
  loading?: boolean
  fetching?: boolean
  error?: ReactNode
}

function TableView<T extends Row>({
  list,
  visible,
  total,
  page,
  columns,
  mobileColumns = NO_KEYS,
  search = true,
  empty,
  emptyFiltered,
  fields,
  filterRows,
  externalActive = false,
  externalLabel = 'Seçili filtreler',
  toolbar,
  presets,
  onReset,
  caption = 'Kayıtlar',
  onRowClick,
  sortable,
  loading = false,
  fetching = false,
  error,
}: TableViewProps<T>) {
  const mobile = useMediaQuery(MOBILE)
  const { state, dispatch, attachScrollRegion, onScroll } = list
  const hasQuery = listNarrowed(state, externalActive)
  const emptyView = emptyListView(state, externalActive, { empty, emptyFiltered })
  const canSort = (key: string) =>
    key !== ACTIONS_KEY && (sortable === 'all' || sortable.includes(key))

  function reset() {
    dispatch({ type: 'clear' })
    onReset?.()
  }

  function rowClick(event: MouseEvent<HTMLElement>, row: T) {
    if (!onRowClick) return
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return
    onRowClick(row)
  }

  const tableColumns = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>()
    return helper.columns(
      columns.map((column) =>
        helper.display({
          id: column.key,
          header: column.label,
          cell: ({ row }) => renderCell(column, row.original),
        }),
      ),
    )
  }, [columns])
  const table = useTable({
    features,
    columns: tableColumns,
    data: visible as T[],
    getRowId: (row) => String(row.id),
  })

  const split = mobileColumnSplit(columns, mobileColumns)
  const actions = columns.find((column) => column.key === ACTIONS_KEY)
  const sortColumns = columns.filter((column) => canSort(column.key))
  const sortLabel = columns.find((column) => column.key === state.sortKey)?.label

  // Hata > ilk yükleme > boş sonuç; satır varsa bunların hiçbiri çizilmez.
  const placeholder = error ? (
    <div role="alert" className="table-error p-[45px] text-center">
      {error}
    </div>
  ) : loading ? (
    <p role="status" className="table-loading p-[45px] text-center text-base text-muted-foreground">
      Kayıtlar yükleniyor…
    </p>
  ) : (
    <div className="empty-cell flex flex-col items-center gap-2.5 p-[45px] text-center text-muted-foreground">
      <Icon name="Search" size={28} aria-hidden="true" />
      <p className="text-base">{emptyView.text}</p>
      {emptyView.showClear ? (
        <Button variant="secondary" size="sm" onClick={reset}>
          Aramayı ve filtreleri temizle
        </Button>
      ) : null}
    </div>
  )
  const showRows = !error && visible.length > 0

  return (
    <div className="data-table">
      {search || (!mobile && toolbar) ? (
        <div className="table-toolbar flex flex-wrap items-center justify-between gap-[15px] px-[22px] py-[18px] max-[650px]:px-4">
          {search ? (
            <SearchField
              label="Tabloda ara"
              placeholder="Listede ara..."
              value={state.query}
              onChange={(query) => dispatch({ type: 'query', query })}
              className="max-[650px]:max-w-none max-[650px]:flex-1"
            />
          ) : null}
          {mobile && hasQuery ? (
            <button
              type="button"
              aria-label="Aramayı ve filtreleri temizle"
              onClick={reset}
              className="grid size-11 place-items-center rounded-2xl text-muted-foreground hover:bg-secondary"
            >
              <Icon name="X" size={17} aria-hidden="true" />
            </button>
          ) : null}
          {!mobile ? (
            <div className="toolbar-filters flex flex-wrap items-center gap-2.5">
              {toolbar}
              {hasQuery ? (
                <Button variant="secondary" size="sm" onClick={reset}>
                  <Icon name="X" size={15} aria-hidden="true" />
                  Aramayı ve filtreleri temizle
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {!mobile ? presets : null}
      <ListFilters
        fields={fields}
        rows={filterRows}
        values={state.filters}
        onChange={(values) => dispatch({ type: 'filters', filters: values })}
        expanded={state.expanded}
        onExpandedChange={(expanded) => dispatch({ type: 'expanded', expanded })}
        externalActive={mobile && externalActive}
        externalLabel={externalLabel}
        onReset={onReset}
        actions={
          mobile && state.sortKey ? (
            <button
              type="button"
              aria-label="Sıralamayı kaldır"
              onClick={() => dispatch({ type: 'clearSort' })}
              className="filter-chip inline-flex min-h-11 items-center gap-[7px] rounded-[20px] border bg-surface-soft px-[11px] text-sm"
            >
              <Icon
                name={state.sortDirection === 1 ? 'ArrowUp' : 'ArrowDown'}
                size={14}
                aria-hidden="true"
              />
              {sortLabel}
              <Icon name="X" size={13} aria-hidden="true" />
            </button>
          ) : undefined
        }
        beforeFields={
          mobile && (presets || toolbar || sortColumns.length) ? (
            <>
              {presets ? <div className="filter-presets">{presets}</div> : null}
              {toolbar ? <div className="filter-external-controls">{toolbar}</div> : null}
              {sortColumns.length ? (
                <label className="mobile-sort flex items-center gap-3 text-sm text-muted-foreground [&>[data-slot=native-select-wrapper]]:min-w-0 [&>[data-slot=native-select-wrapper]]:flex-1">
                  Sıralama
                  <NativeSelect
                    aria-label="Kayıt sıralaması"
                    value={state.sortKey ? `${state.sortKey}:${state.sortDirection}` : ''}
                    onChange={(event) => {
                      const [key = '', direction] = event.target.value.split(':')
                      if (!key) dispatch({ type: 'clearSort' })
                      else
                        dispatch({ type: 'setSort', key, direction: direction === '-1' ? -1 : 1 })
                    }}
                    className="min-h-11 w-full bg-surface text-sm"
                  >
                    <NativeSelectOption value="">Varsayılan sıralama</NativeSelectOption>
                    {sortColumns.map((column) => [
                      <NativeSelectOption key={`${column.key}:1`} value={`${column.key}:1`}>
                        {column.label} · Artan
                      </NativeSelectOption>,
                      <NativeSelectOption key={`${column.key}:-1`} value={`${column.key}:-1`}>
                        {column.label} · Azalan
                      </NativeSelectOption>,
                    ])}
                  </NativeSelect>
                </label>
              ) : null}
            </>
          ) : undefined
        }
      />
      {!mobile ? (
        <div
          ref={attachScrollRegion}
          onScroll={onScroll}
          tabIndex={0}
          role="region"
          aria-label="Kayıt tablosu; tüm kayıt ve sütunlar için kaydırın"
          aria-busy={fetching || loading || undefined}
          className={cn(
            'table-scroll max-h-[max(360px,calc(100dvh-260px))] w-full overflow-auto [scrollbar-width:thin] focus-visible:-outline-offset-3',
            fetching && 'opacity-70 transition-opacity motion-reduce:transition-none',
          )}
        >
          <table className="w-full border-separate border-spacing-0 text-left whitespace-nowrap">
            <caption className="sr-only">{caption}</caption>
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => {
                    const key = header.column.id
                    const sorted = state.sortKey === key
                    const isActions = key === ACTIONS_KEY
                    const sortableHeader = canSort(key)
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={
                          !sortableHeader
                            ? undefined
                            : sorted
                              ? state.sortDirection === 1
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                        }
                        className={cn(
                          'sticky top-0 z-[1] border-y bg-surface-soft px-5 py-3 text-sm font-medium tracking-[0.2px] text-muted-foreground',
                          isActions &&
                            'sticky-actions right-0 z-[3] min-w-[140px] shadow-[inset_1px_0_0_var(--border)]',
                        )}
                      >
                        {!sortableHeader ? (
                          <span>
                            <table.FlexRender header={header} />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => dispatch({ type: 'sort', key })}
                            className="table-sort flex items-center gap-2 rounded-md hover:text-foreground"
                          >
                            <table.FlexRender header={header} />
                            <Icon
                              name={
                                sorted
                                  ? state.sortDirection === 1
                                    ? 'ArrowUp'
                                    : 'ArrowDown'
                                  : 'ArrowUpDown'
                              }
                              size={12}
                              aria-hidden="true"
                              className={sorted ? undefined : 'opacity-50'}
                            />
                          </button>
                        )}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {showRows
                ? table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className={cn('group', onRowClick && 'cursor-pointer')}
                      onClick={onRowClick ? (event) => rowClick(event, row.original) : undefined}
                    >
                      {row.getAllCells().map((cell) => (
                        <td
                          key={cell.id}
                          className={cn(
                            'border-b bg-surface px-5 py-[15px] text-sm text-foreground group-last:border-b-0 group-hover:bg-surface-soft',
                            cell.column.id === ACTIONS_KEY &&
                              'sticky-actions sticky right-0 z-[2] min-w-[140px] shadow-[inset_1px_0_0_var(--border)]',
                          )}
                        >
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                    </tr>
                  ))
                : null}
              {showRows ? null : (
                <tr>
                  <td colSpan={columns.length} className="bg-surface">
                    {placeholder}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className={cn('mobile-records px-4 pb-4', fetching && 'opacity-70')}
          aria-busy={fetching || loading || undefined}
        >
          {showRows
            ? visible.map((row) => (
                <article
                  key={row.id}
                  aria-label={split.title ? String(row[split.title.key] || 'Kayıt') : 'Kayıt'}
                  className="mobile-record my-3 rounded-[20px] border bg-surface p-[17px]"
                >
                  {split.title ? (
                    <header className="text-md font-semibold [overflow-wrap:anywhere]">
                      {renderCell(split.title, row)}
                    </header>
                  ) : null}
                  <RecordFields columns={split.main} row={row} />
                  {split.details.length ? (
                    <details className="record-details mt-4 border-t pt-3">
                      <summary className="min-h-8 cursor-pointer text-sm text-primary">
                        Diğer bilgiler
                      </summary>
                      <RecordFields columns={split.details} row={row} />
                    </details>
                  ) : null}
                  {actions?.cell ? (
                    <footer className="record-actions mt-[15px] border-t pt-[15px] [&_:is(a,button)]:min-h-11">
                      {actions.cell(row)}
                    </footer>
                  ) : null}
                </article>
              ))
            : placeholder}
        </div>
      )}
      <Pagination
        total={total}
        page={page}
        pageSize={state.pageSize}
        onPageChange={(next) => dispatch({ type: 'page', page: next })}
        onPageSizeChange={(size) => dispatch({ type: 'pageSize', pageSize: size })}
      />
    </div>
  )
}

function RecordFields<T extends Row>({
  columns,
  row,
}: {
  columns: readonly DataColumn<T>[]
  row: T
}) {
  return (
    <dl className="record-fields mt-[18px] grid grid-cols-2 gap-x-4 gap-y-3.5">
      {columns.map((column) => (
        <div key={column.key} className="min-w-0">
          <dt className="mb-[5px] text-sm text-muted-foreground">{column.label}</dt>
          <dd className="m-0 text-sm [overflow-wrap:anywhere]">{renderCell(column, row)}</dd>
        </div>
      ))}
    </dl>
  )
}
