import { useState } from 'react'
import { useStockItems } from '@kampus/react-shared/use-finance-inventory.ts'
import { STOCK_UNIT_LABELS } from '@kampus/school-core/lib/finance-inventory.ts'
import type { ControlProps } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { stockItemLabel, type RequestStockItem } from './finance-procurement-forms.ts'

const PAGE_SIZE = 20

/**
 * Talep kalemine stok kartı seçimi (ON-339, K-221): kurumun etkin kartlarında kod ve adla sunucu
 * araması (en az 2 karakter; boşken ilk 20 kart, koda göre). Seçim kartın kimliğini, gösterim adını
 * ve birimini verir; "Bağı kaldır" kalemi serbest metne döndürür. Liste yalnız açıkken okunur.
 */
export function StockItemPicker({
  control,
  value,
  disabled,
  onChange,
}: {
  control: ControlProps
  value: RequestStockItem | null
  disabled: boolean
  onChange: (next: RequestStockItem | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search).trim()
  const cards = useStockItems(
    { page: 1, pageSize: PAGE_SIZE, status: 'active', ...(term.length >= 2 ? { q: term } : {}) },
    open,
  )
  const choose = (next: RequestStockItem | null) => {
    onChange(next)
    setOpen(false)
    setSearch('')
  }
  const rows = cards.data?.data ?? []
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          {...control}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="min-h-11 w-full justify-between font-normal"
        >
          <span className={value ? 'truncate' : 'truncate text-muted-foreground'}>
            {value ? value.label : 'Stok kartı yok'}
          </span>
          <Icon name="ChevronDown" size={16} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Kod ya da ad ara"
            aria-label="Stok kartı ara"
          />
          <CommandList aria-label="Etkin stok kartları">
            {cards.isPending ? (
              <p role="status" className="py-6 text-center text-sm text-muted-foreground">
                Kartlar yükleniyor…
              </p>
            ) : cards.error ? (
              <p role="alert" className="py-6 text-center text-sm text-destructive">
                Stok kartları alınamadı; yeniden deneyin.
              </p>
            ) : (
              <CommandEmpty>Eşleşen etkin stok kartı yok.</CommandEmpty>
            )}
            {value ? (
              <CommandItem value="bagi-kaldir" onSelect={() => choose(null)}>
                <Icon name="X" size={16} aria-hidden="true" />
                Bağı kaldır
              </CommandItem>
            ) : null}
            {rows.map((card) => (
              <CommandItem
                key={card.id}
                value={card.id}
                onSelect={() =>
                  choose({ id: card.id, label: stockItemLabel(card), unit: card.unit })
                }
              >
                <span className="truncate">{`${card.code} · ${card.name}`}</span>
                <span className="ml-auto text-muted-foreground">
                  {STOCK_UNIT_LABELS[card.unit]}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
