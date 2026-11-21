import { useId, type ReactNode } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  filterOptions,
  isInvalidRange,
  type FilterField,
  type FilterValue,
  type FilterValues,
  type RangeValue,
  type Row,
} from '@/lib/list-query.ts'
import { activeFields, filterSelectionLabel } from '@/lib/list-view.ts'
import { cn } from '@/lib/utils'

export const INVALID_RANGE = 'Başlangıç değeri bitişten büyük olamaz.'

type ListFiltersProps = {
  fields: readonly FilterField[]
  rows: readonly Row[]
  values: FilterValues
  onChange: (values: FilterValues) => void
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  /** Liste dışında (sekme, durum seçimi) uygulanmış filtre var mı. */
  externalActive?: boolean
  externalLabel?: string
  /** Dış filtreleri temizler. */
  onReset?: () => void
  /** Özet satırının sağındaki ek kontroller (sıralama, temizle). */
  actions?: ReactNode
  /** Panelde alanlardan önce gösterilen kontroller (dar ekranda hazır filtreler, sıralama). */
  beforeFields?: ReactNode
}

const chip =
  'filter-chip inline-flex max-w-full min-h-9 items-center gap-[7px] rounded-[20px] border bg-surface-soft px-[11px] py-[7px] text-left text-sm text-foreground [overflow-wrap:anywhere] hover:bg-secondary max-[640px]:min-h-11'
const control = 'min-h-[42px] w-full bg-surface text-sm max-[640px]:min-h-11'

/**
 * Açılır filtre paneli (Vue `ListFilters.vue`): etkin filtreler çip olarak kaldırılabilir,
 * aralık alanları geçersiz aralığı alan mesajıyla bildirir.
 */
export function ListFilters({
  fields,
  rows,
  values,
  onChange,
  expanded,
  onExpandedChange,
  externalActive = false,
  externalLabel = 'Seçili filtreler',
  onReset,
  actions,
  beforeFields,
}: ListFiltersProps) {
  const id = useId()
  const active = activeFields(fields, values)
  const activeCount = active.length + Number(externalActive)
  if (!fields.length && !beforeFields && !actions) return null

  const update = (key: string, value: FilterValue) => onChange({ ...values, [key]: value })
  const range = (key: string, boundary: keyof RangeValue, value: string) => {
    const current = values[key]
    const base = current !== null && typeof current === 'object' ? current : {}
    update(key, { ...base, [boundary]: value })
  }
  const rangeValue = (key: string, boundary: keyof RangeValue) => {
    const current = values[key]
    return current !== null && typeof current === 'object' ? (current[boundary] ?? '') : ''
  }

  return (
    <Collapsible
      open={expanded}
      onOpenChange={onExpandedChange}
      className="list-filters px-[22px] pb-4 max-[640px]:px-4"
    >
      <div className="filter-summary flex flex-wrap items-center gap-2.5">
        <CollapsibleTrigger
          className={cn(
            'filter-toggle inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-medium text-secondary-foreground hover:bg-secondary-hover max-[640px]:min-h-11',
            activeCount > 0 && 'is-active bg-primary-soft text-primary',
          )}
        >
          <Icon name="Filter" size={16} aria-hidden="true" />
          Filtreler
          {activeCount > 0 ? (
            <span className="filter-count min-w-[19px] rounded-[20px] bg-primary px-[5px] py-0.5 text-xs text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
          <Icon
            name="ChevronDown"
            size={15}
            aria-hidden="true"
            className={cn(
              'transition-transform motion-reduce:transition-none',
              expanded && 'rotate-180',
            )}
          />
        </CollapsibleTrigger>
        {activeCount > 0 ? (
          <div
            className="filter-chips flex min-w-0 flex-wrap gap-[7px]"
            aria-label="Aktif filtreler"
            role="group"
          >
            {externalActive ? (
              <button
                type="button"
                className={chip}
                aria-label="Ek filtreleri kaldır"
                onClick={onReset}
              >
                {externalLabel}
                <Icon name="X" size={13} aria-hidden="true" />
              </button>
            ) : null}
            {active.map((field) => (
              <button
                key={field.key}
                type="button"
                className={chip}
                aria-label={`${field.label} filtresini kaldır`}
                onClick={() => update(field.key, '')}
              >
                {field.label}: {filterSelectionLabel(field, values[field.key], rows)}
                <Icon name="X" size={13} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}
        {activeCount > 0 ? (
          <button
            type="button"
            className="filter-clear ml-auto min-h-9 text-sm font-medium text-primary hover:underline max-[640px]:ml-0 max-[640px]:min-h-11"
            onClick={() => {
              onChange({})
              onReset?.()
            }}
          >
            Filtreleri temizle
          </button>
        ) : null}
        {actions ? (
          <div className="filter-extra ml-auto flex max-w-full flex-wrap items-center gap-3 max-[640px]:ml-0">
            {actions}
          </div>
        ) : null}
      </div>
      <CollapsibleContent className="filter-panel mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(min(265px,100%),1fr))] gap-4 rounded-card border bg-surface-soft p-[18px] max-[640px]:gap-[13px] max-[640px]:p-[13px]">
        {beforeFields}
        {fields.map((field) => {
          if (field.type === 'date' || field.type === 'number') {
            const invalid = isInvalidRange(field, values[field.key])
            const errorId = `${id}-${field.key}-error`
            const date = field.type === 'date'
            return (
              <fieldset key={field.key} className="filter-control m-0 min-w-0 border-0 p-0">
                <legend className="pb-[7px] text-sm font-medium text-muted-foreground">
                  {field.label}
                </legend>
                <div className="filter-range flex items-center gap-[7px]">
                  {(['min', 'max'] as const).map((boundary, index) => (
                    <span key={boundary} className="contents">
                      {index === 1 ? <span aria-hidden="true">–</span> : null}
                      <Input
                        type={field.type}
                        step={date ? undefined : 'any'}
                        aria-label={`${field.label} ${
                          date
                            ? boundary === 'min'
                              ? 'başlangıç'
                              : 'bitiş'
                            : boundary === 'min'
                              ? 'en az'
                              : 'en çok'
                        }`}
                        placeholder={date ? undefined : boundary === 'min' ? 'En az' : 'En çok'}
                        value={rangeValue(field.key, boundary)}
                        aria-invalid={invalid || undefined}
                        aria-describedby={invalid ? errorId : undefined}
                        onChange={(event) => range(field.key, boundary, event.target.value)}
                        className={cn(control, 'w-0 flex-1 px-[9px]')}
                      />
                    </span>
                  ))}
                </div>
                {invalid ? (
                  <small id={errorId} className="mt-1.5 block text-xs text-danger">
                    {INVALID_RANGE}
                  </small>
                ) : null}
              </fieldset>
            )
          }
          return (
            <label
              key={field.key}
              className="filter-control grid min-w-0 gap-[7px] text-sm font-medium text-muted-foreground [&>[data-slot=native-select-wrapper]]:w-full"
            >
              {field.label}
              <NativeSelect
                aria-label={field.label}
                value={String(values[field.key] ?? '')}
                onChange={(event) => update(field.key, event.target.value)}
                className={control}
              >
                <NativeSelectOption value="">Tümü</NativeSelectOption>
                {filterOptions(field, rows).map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )
        })}
      </CollapsibleContent>
    </Collapsible>
  )
}
