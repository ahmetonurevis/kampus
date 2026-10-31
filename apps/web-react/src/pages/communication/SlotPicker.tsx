import { cn } from '@/lib/utils'
import type { SlotGroup } from './appointment-forms.ts'

type Props = {
  groups: readonly SlotGroup[]
  /** Seçili saat; listede olmayan ya da dolu saat seçili sayılmaz. */
  value: string
  onChange: (slotId: string) => void
  disabled: boolean
  /** Alan hatası kimliği (`aria-describedby`). */
  describedBy: string | undefined
  invalid: boolean
}

/**
 * Alınabilir saatler (DOM-ILT-105): gün başlığı altında radyo listesi. "Dolu" saat seçilemez; nedeni
 * gösterilmez ve tahmin edilmez, çünkü başka velinin gizli görüşmesi ya da öğrencinin kendi dersi
 * aynı "Dolu"dur. Radyo düğmeleri tek `name` altında ok tuşlarıyla gezilir (tarayıcı davranışı).
 */
export function SlotPicker({ groups, value, onChange, disabled, describedBy, invalid }: Props) {
  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <div key={group.day} role="group" aria-label={group.label} className="grid gap-2">
          <p className="text-sm font-medium">{group.label}</p>
          <ul className="grid gap-2">
            {group.slots.map((slot) => {
              const id = `randevu-saat-${slot.id}`
              const checked = slot.available && value === slot.id
              return (
                <li key={slot.id}>
                  <label
                    htmlFor={id}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-start gap-3 rounded-card border px-3.5 py-2.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                      checked && 'border-primary bg-primary-soft',
                      !slot.available && 'cursor-not-allowed bg-surface-soft text-muted-foreground',
                    )}
                  >
                    <input
                      id={id}
                      type="radio"
                      name="randevu-saat"
                      value={slot.id}
                      checked={checked}
                      disabled={disabled || !slot.available}
                      aria-invalid={invalid || undefined}
                      aria-describedby={describedBy}
                      onChange={() => onChange(slot.id)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="font-medium">
                        {slot.time}
                        {slot.available ? null : (
                          <span className="ml-2 rounded-sm border px-1.5 py-0.5 text-2xs font-medium">
                            Dolu
                          </span>
                        )}
                      </span>
                      <span className="[overflow-wrap:anywhere]">
                        {[slot.teacher, slot.subjects, slot.campus].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
