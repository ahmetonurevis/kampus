import type { InvoiceStatusKey } from '@kampus/school-core/lib/format.ts'
import { INVOICE_PRESETS } from './finance-rows.ts'

type Props = {
  /** Etkin durum anahtarı; boşsa "Tüm ödemeler". */
  value: InvoiceStatusKey | ''
  onChange: (value: InvoiceStatusKey | '') => void
}

/**
 * Hazır ödeme filtreleri (Vue `Finance.vue` `quick-filters`): durum süzgecinin kısayol çipleri,
 * `aria-pressed` ile seçili olanı bildirir. Tablonun `presets` yuvasına konur; dar ekranda filtre
 * paneline taşınır.
 */
export function InvoicePresets({ value, onChange }: Props) {
  return (
    <div
      className="quick-filters flex flex-wrap gap-2 px-[22px] pb-3 max-[650px]:px-0 max-[650px]:pb-0"
      role="group"
      aria-label="Hazır ödeme filtreleri"
    >
      {INVOICE_PRESETS.map((preset) => (
        <button
          key={preset.label}
          type="button"
          aria-pressed={value === preset.value}
          onClick={() => onChange(preset.value)}
          className="filter-chip min-h-9 rounded-[20px] border bg-surface px-3 py-[7px] text-sm text-muted-foreground hover:bg-secondary aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary"
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
