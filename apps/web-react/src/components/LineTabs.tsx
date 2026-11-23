import { Icon } from '@/components/Icon.tsx'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type LineTabOption<T extends string> = {
  value: T
  label: string
  icon?: string
  count?: number
}

type LineTabsProps<T extends string> = {
  label: string
  value: T
  options: readonly LineTabOption<T>[]
  onChange: (value: T) => void
}

/**
 * Çizgi sekmeler (Vue `LineTabs.vue`): `role="group"` içinde `aria-pressed` düğmeler. Radix
 * `type="single"` radiogroup ürettiği için `multiple` tek seçim gibi denetlenir; ok tuşuyla
 * odak değişince seçim de değişir.
 */
export function LineTabs<T extends string>({ label, value, options, onChange }: LineTabsProps<T>) {
  function select(next: string | undefined) {
    const option = options.find((item) => item.value === next)
    if (option && option.value !== value) onChange(option.value)
  }
  return (
    <ToggleGroup
      type="multiple"
      aria-label={label}
      value={[value]}
      onValueChange={(values) => select(values.find((item) => item !== value))}
      className="line-tabs flex w-full flex-wrap gap-1 border-b"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          onFocus={() => select(option.value)}
          className="relative h-auto min-h-10 rounded-none rounded-t-lg bg-transparent px-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground data-[state=on]:bg-transparent data-[state=on]:font-semibold data-[state=on]:text-primary data-[state=on]:after:absolute data-[state=on]:after:inset-x-2 data-[state=on]:after:-bottom-px data-[state=on]:after:h-0.5 data-[state=on]:after:rounded-full data-[state=on]:after:bg-primary"
        >
          {option.icon ? <Icon name={option.icon} size={16} /> : null}
          {option.label}
          {option.count == null ? null : (
            <span className="tab-count rounded-full bg-primary-soft px-1.5 text-2xs text-primary">
              {option.count}
            </span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
