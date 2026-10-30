import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

type Option<T extends string | number> = { value: T; label: string }

type CheckGroupProps<T extends string | number> = {
  legend: string
  options: readonly Option<T>[]
  value: readonly T[]
  onChange: (value: T[]) => void
  disabled?: boolean
  error?: string | undefined
  hint?: string | undefined
}

/**
 * Çoklu seçim grubu: `fieldset` + `legend` ile ekran okuyucuya grup adı verir, her seçenek kendi
 * etiketiyle bağlıdır. Hedef kitle seçimi (kampüs, düzey, sınıf, alıcı rolü) bunu kullanır.
 */
export function CheckGroup<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  disabled = false,
  error,
  hint,
}: CheckGroupProps<T>) {
  const id = useId()
  const errorId = error ? `${id}-hata` : undefined
  const hintId = hint ? `${id}-ipucu` : undefined
  function toggle(item: T, checked: boolean) {
    onChange(checked ? [...value, item] : value.filter((current) => current !== item))
  }
  return (
    <fieldset
      className="grid min-w-0 gap-2"
      aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
    >
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const optionId = `${id}-${String(option.value)}`
          return (
            <Label
              key={String(option.value)}
              htmlFor={optionId}
              className="min-h-9 cursor-pointer rounded-xl border bg-surface px-3 py-1.5 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft"
            >
              <Checkbox
                id={optionId}
                checked={value.includes(option.value)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(option.value, checked === true)}
              />
              {option.label}
            </Label>
          )
        })}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}
