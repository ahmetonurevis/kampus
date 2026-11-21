import { useCallback, useMemo, type ReactNode } from 'react'
import { EmptyState } from '@/components/EmptyState.tsx'
import { ListFilters } from '@/components/ListFilters.tsx'
import { Pagination } from '@/components/Pagination.tsx'
import { SearchField } from '@/components/SearchField.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useListState } from '@/hooks/use-list-state.ts'
import { useListView } from '@/hooks/use-list-view.ts'
import type { FilterField, FilterValues, Row } from '@/lib/list-query.ts'
import type { ListState } from '@/lib/list-state.ts'
import { listNarrowed, orderRows, presetActive, type SortOption } from '@/lib/list-view.ts'
import { cn } from '@/lib/utils'

export type ListPreset = { label: string; values: FilterValues }

const DEFAULT_SEARCH_KEYS = ['title', 'text', 'description', 'subject', 'name'] as const
const NO_FILTERS: readonly FilterField[] = []
const NO_PRESETS: readonly ListPreset[] = []
const NO_SORT: readonly SortOption[] = []

type CollectionListProps<T extends Row> = {
  /** Liste anahtarı; çocuk/sekme kapsamı da anahtara yazılır (her kapsamın kendi durumu var). */
  listKey: string
  rows: readonly T[]
  children: (items: T[]) => ReactNode
  filters?: readonly FilterField[]
  presets?: readonly ListPreset[]
  sortOptions?: readonly SortOption[]
  /** Verilirse arama alanı gösterilir; erişilebilir ad ve yer tutucu olur. */
  searchLabel?: string
  searchKeys?: readonly string[]
  pageSize?: number
  externalActive?: boolean
  /** Dış filtre anahtarı; değişince sayfa başa döner. */
  filterKey?: string
  onReset?: () => void
  /** Kartları saran ızgara sınıfı. */
  className?: string
  urlPrefix?: string
}

/** Kart listesi (Vue `CollectionList.vue`): hazır filtre, arama, filtre paneli, sıralama, sayfa. */
export function CollectionList<T extends Row>({
  listKey,
  rows,
  children,
  filters = NO_FILTERS,
  presets = NO_PRESETS,
  sortOptions = NO_SORT,
  searchLabel = '',
  searchKeys = DEFAULT_SEARCH_KEYS,
  pageSize = 6,
  externalActive = false,
  filterKey = '',
  onReset,
  className = 'grid gap-4 md:grid-cols-2 xl:grid-cols-3',
  urlPrefix,
}: CollectionListProps<T>) {
  const { state, dispatch } = useListState(listKey, { pageSize, urlPrefix, resetKey: filterKey })
  const sort = useCallback(
    (items: T[], current: ListState) => orderRows(items, sortOptions, current.ordering),
    [sortOptions],
  )
  const config = useMemo(() => ({ fields: filters, searchKeys, sort }), [filters, searchKeys, sort])
  const view = useListView(rows, state, dispatch, config)
  const hasQuery = listNarrowed(state, externalActive)

  function reset() {
    dispatch({ type: 'clear' })
    onReset?.()
  }

  const clearButton = hasQuery ? (
    <button
      type="button"
      onClick={reset}
      className="min-h-9 text-sm font-medium text-primary hover:underline max-[640px]:min-h-11"
    >
      Aramayı ve filtreleri temizle
    </button>
  ) : null

  return (
    <section className="collection-list" aria-label="Kayıt listesi">
      {presets.length ? (
        <div
          className="quick-filters mb-4 flex flex-wrap gap-2"
          role="group"
          aria-label="Hazır filtreler"
        >
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-pressed={presetActive(state.filters, preset.values)}
              onClick={() => dispatch({ type: 'filters', filters: preset.values })}
              className="filter-chip min-h-9 rounded-[20px] border bg-surface px-3 py-[7px] text-sm text-muted-foreground hover:bg-secondary aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary"
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}
      {searchLabel ? (
        <div className="collection-toolbar mb-4 flex items-center justify-between gap-[15px] max-[640px]:flex-col max-[640px]:items-stretch">
          <SearchField
            label={searchLabel}
            value={state.query}
            onChange={(query) => dispatch({ type: 'query', query })}
            className="max-[640px]:max-w-none"
          />
          {clearButton}
        </div>
      ) : null}
      <ListFilters
        fields={filters}
        rows={rows}
        values={state.filters}
        onChange={(values) => dispatch({ type: 'filters', filters: values })}
        expanded={state.expanded}
        onExpandedChange={(expanded) => dispatch({ type: 'expanded', expanded })}
        onReset={onReset}
        actions={
          sortOptions.length || (!searchLabel && hasQuery) ? (
            <>
              {sortOptions.length ? (
                <NativeSelect
                  aria-label="Liste sıralaması"
                  value={state.ordering}
                  onChange={(event) => dispatch({ type: 'ordering', ordering: event.target.value })}
                  className="min-h-9 text-sm max-[640px]:min-h-11"
                >
                  <NativeSelectOption value="">Varsayılan sıralama</NativeSelectOption>
                  {sortOptions.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : null}
              {!searchLabel ? clearButton : null}
            </>
          ) : undefined
        }
      />
      {view.visible.length ? (
        <div className={cn('pt-4', className)}>{children(view.visible)}</div>
      ) : (
        <div className="mt-4">
          <EmptyState
            icon="Search"
            title={hasQuery ? 'Uygun kayıt bulunamadı.' : 'Henüz kayıt yok.'}
            description={
              hasQuery ? 'Aramayı veya filtreleri değiştirerek yeniden deneyin.' : undefined
            }
          />
        </div>
      )}
      <Pagination
        className="border-t-0 px-0"
        total={view.total}
        page={view.page}
        pageSize={state.pageSize}
        sizes={[6, 12, 24]}
        onPageChange={(page) => dispatch({ type: 'page', page })}
        onPageSizeChange={(size) => dispatch({ type: 'pageSize', pageSize: size })}
      />
    </section>
  )
}
