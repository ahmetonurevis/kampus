import { useState } from 'react'
import { useLearningOutcomeList } from '@kampus/react-shared/use-learning-outcomes.ts'
import type { OutcomeRef } from '@kampus/school-core/content/outcomes.ts'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SearchField } from '@/components/SearchField.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { GRADE_OPTIONS } from './content-pool-model.ts'
import {
  OUTCOME_COPY,
  OUTCOME_PICKER_PAGE_SIZE,
  outcomeCapacity,
  outcomePickerQuery,
  outcomePickerRows,
  type OutcomePickerRow,
} from './outcome-picker-model.ts'

type PickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Formda zaten seçili kazanımlar: satırda "Zaten seçili" olur, sınır hesabına girer. */
  selected: readonly OutcomeRef[]
  /** Formun dersi ve ilk sınıf düzeyi; süzgecin varsayılanıdır. */
  defaults: { subject: string; level: string }
  /** Ders süzgecinin seçenekleri (kurumun dersleri). */
  subjectOptions: readonly { value: string; label: string }[]
  onPick: (picked: OutcomeRef[]) => void
}

/**
 * Kazanım seçici (OG-067; DOM-KYN-011, IST-030): içerik ve soru formunda kazanım katalogdan
 * seçilir, kod elle yazılmaz. Liste sunucu sayfalıdır (`useLearningOutcomeList`); arama, ders ve
 * sınıf düzeyi süzgeci sayfayı başa alır. Arşivli kod sunucuda düştüğü için burada seçilemez.
 * Pencere her açılışta temiz başlar.
 */
export function OutcomePicker({ open, onOpenChange, ...rest }: PickerProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={OUTCOME_COPY.title}>
      {open ? <PickerBody onClose={() => onOpenChange(false)} {...rest} /> : null}
    </Modal>
  )
}

function PickerBody({
  selected,
  defaults,
  subjectOptions,
  onPick,
  onClose,
}: Omit<PickerProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [subject, setSubject] = useState(defaults.subject)
  const [level, setLevel] = useState(defaults.level)
  const [page, setPage] = useState(1)
  const [chosen, setChosen] = useState<ReadonlyMap<string, OutcomeRef>>(() => new Map())
  const search = useDebouncedValue(q)
  const list = useLearningOutcomeList(outcomePickerQuery({ q: search, subject, level, page }))
  const rows = outcomePickerRows(list.data?.data ?? [], selected)
  const total = list.data?.meta.total ?? 0
  const pages = Math.max(1, Math.ceil(total / OUTCOME_PICKER_PAGE_SIZE))
  // Veri azalınca geçersiz sayfada kalınmaz.
  const current = Math.min(page, pages)
  const full = chosen.size >= outcomeCapacity(selected)

  function toggle(row: OutcomePickerRow, on: boolean) {
    setChosen((previous) => {
      const next = new Map(previous)
      if (on) next.set(row.key, row.ref)
      else next.delete(row.key)
      return next
    })
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField
          label={OUTCOME_COPY.searchLabel}
          value={q}
          onChange={(value) => {
            setQ(value)
            setPage(1)
          }}
          className="max-w-none flex-1 basis-56"
        />
        <div className="grid min-w-[150px] gap-1.5">
          <Label htmlFor="kazanim-secici-ders" className="text-xs">
            Ders
          </Label>
          <NativeSelect
            id="kazanim-secici-ders"
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value)
              setPage(1)
            }}
          >
            <NativeSelectOption value="">Tümü</NativeSelectOption>
            {subjectOptions.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid min-w-[130px] gap-1.5">
          <Label htmlFor="kazanim-secici-duzey" className="text-xs">
            Sınıf düzeyi
          </Label>
          <NativeSelect
            id="kazanim-secici-duzey"
            value={level}
            onChange={(event) => {
              setLevel(event.target.value)
              setPage(1)
            }}
          >
            <NativeSelectOption value="">Tümü</NativeSelectOption>
            {GRADE_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={String(option.value)}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      {list.error ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Yükleniyor…
        </p>
      ) : rows.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {OUTCOME_COPY.empty}
        </p>
      ) : (
        <ul aria-label={OUTCOME_COPY.listLabel} className="grid gap-2">
          {rows.map((row, index) => {
            const id = `kazanim-secici-${String(index)}`
            const checked = chosen.has(row.key)
            const reason = row.disabledReason ?? (full && !checked ? OUTCOME_COPY.full : null)
            return (
              <li
                key={row.key}
                className="flex items-center gap-3 rounded-card border bg-surface px-3 py-2.5"
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(on) => toggle(row, on === true)}
                  disabled={reason !== null}
                  aria-describedby={`${id}-kunye`}
                />
                <div className="min-w-0 flex-1">
                  <Label htmlFor={id} className="text-sm font-medium [overflow-wrap:anywhere]">
                    {row.code} · {row.name}
                  </Label>
                  <p id={`${id}-kunye`} className="text-xs text-muted-foreground">
                    {[row.meta, reason].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Kazanım sayfaları" className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage(current - 1)}
            disabled={current <= 1}
          >
            <Icon name="ChevronLeft" size={15} aria-hidden="true" />
            Önceki
          </Button>
          <span className="text-sm text-muted-foreground">
            Sayfa {current} / {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage(current + 1)}
            disabled={current >= pages}
          >
            Sonraki
            <Icon name="ChevronRight" size={15} aria-hidden="true" />
          </Button>
        </nav>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Vazgeç
        </Button>
        <Button
          type="button"
          onClick={() => {
            onPick([...chosen.values()])
            onClose()
          }}
          disabled={chosen.size === 0}
        >
          <Icon name="Plus" size={16} aria-hidden="true" />
          Seçilenleri ekle ({chosen.size})
        </Button>
      </div>
    </div>
  )
}
