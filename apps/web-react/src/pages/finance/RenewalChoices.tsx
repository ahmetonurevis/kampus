import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

/** Tarifedeki indirim ve ek hizmet seçimi; tek öğrenci ve toplu yenileme formu ortak kullanır. */
export function ChoiceFieldset({
  legend,
  hint,
  idPrefix,
  options,
  selected,
  onChange,
  disabled,
}: {
  legend: string
  hint: string
  idPrefix: string
  options: readonly { value: string; label: string }[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  disabled: boolean
}) {
  if (options.length === 0) return null
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-sm text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((option) => {
          const id = `${idPrefix}-${option.value}`
          return (
            <div key={option.value} className="flex items-center gap-2.5">
              <Checkbox
                id={id}
                checked={selected.includes(option.value)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...selected, option.value]
                      : selected.filter((value) => value !== option.value),
                  )
                }
              />
              <Label htmlFor={id} className="font-normal">
                {option.label}
              </Label>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
