import { Icon } from '@/components/Icon.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { pageCount, pageNumbers } from '@/lib/list-query.ts'
import { cn } from '@/lib/utils'

type PaginationProps = {
  total: number
  page: number
  pageSize: number
  sizes?: readonly number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  className?: string
}

const pageButton =
  'grid size-9 place-items-center rounded-xl text-sm text-muted-foreground hover:bg-secondary disabled:opacity-40'

/** Liste sayfalaması (Vue `Pagination.vue`): sonuç sayısı duyurulur, dar ekranda numaralar gizlenir. */
export function Pagination({
  total,
  page,
  pageSize,
  sizes = [8, 16, 32, 64],
  onPageChange,
  onPageSizeChange,
  className,
}: PaginationProps) {
  const pages = pageCount(total, pageSize)
  const options = [...new Set([pageSize, ...sizes])].sort((a, b) => a - b)
  const first = total ? (page - 1) * pageSize + 1 : 0
  return (
    <div
      className={cn(
        'list-pagination flex flex-wrap items-center justify-between gap-3 border-t px-[22px] py-4',
        className,
      )}
    >
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span role="status" aria-live="polite" aria-atomic="true" className="result-count">
          <strong className="font-medium text-foreground">
            {first}–{Math.min(page * pageSize, total)}
          </strong>{' '}
          <span>/ {total} kayıt</span>
        </span>
        <label className="flex items-center gap-2">
          Sayfa başına
          <NativeSelect
            size="sm"
            aria-label="Sayfa başına kayıt"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {options.map((size) => (
              <NativeSelectOption key={size} value={size}>
                {size}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      <nav className="pagination flex items-center gap-1" aria-label="Liste sayfaları">
        <button
          type="button"
          aria-label="Önceki sayfa"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className={pageButton}
        >
          <Icon name="ChevronLeft" size={17} />
        </button>
        {pageNumbers(page, pages).map((item) =>
          typeof item === 'string' ? (
            <span
              key={item}
              aria-hidden="true"
              className="px-1 text-muted-foreground max-[650px]:hidden"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              aria-label={`${item}. sayfa`}
              aria-current={item === page ? 'page' : undefined}
              onClick={() => onPageChange(item)}
              className={cn(
                'page-number max-[650px]:hidden',
                pageButton,
                item === page &&
                  'bg-primary font-semibold text-primary-foreground hover:bg-primary',
              )}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          aria-label="Sonraki sayfa"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          className={pageButton}
        >
          <Icon name="ChevronRight" size={17} />
        </button>
      </nav>
    </div>
  )
}
