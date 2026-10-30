import { Icon } from '@/components/Icon.tsx'
import { cn } from '@/lib/utils'

type SearchFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

/** Liste araması (Vue `.search-field`): odak halkası kutunun tamamında görünür. */
export function SearchField({ label, value, onChange, placeholder, className }: SearchFieldProps) {
  return (
    <label
      className={cn(
        'search-field flex w-full max-w-[300px] items-center gap-2 rounded-field border bg-surface px-[11px] text-muted-foreground focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus',
        className,
      )}
    >
      <Icon name="Search" size={17} aria-hidden="true" />
      <input
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder ?? `${label}…`}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[37px] w-full min-w-0 border-0 bg-transparent py-2 text-sm text-foreground outline-hidden placeholder:text-muted-foreground"
      />
    </label>
  )
}
