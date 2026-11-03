import { useState } from 'react'
import { useResourceList } from '@kampus/react-shared/use-resources.ts'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SearchField } from '@/components/SearchField.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { CEFR_OPTIONS, GRADE_OPTIONS } from './content-pool-model.ts'
import {
  LINKED_KINDS,
  PICKER_PAGE_SIZE,
  pickerQuery,
  pickerRows,
  type LinkedKind,
  type LinkedSummary,
  type PickerRow,
} from './reading-activity-model.ts'

type PickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: LinkedKind
  /** Çoklu seçim (sorular) ya da tek seçim (parça). */
  multiple: boolean
  /** Formda zaten bağlı sürümler: satırda "Zaten seçili" olur. */
  selected: ReadonlySet<string>
  /** Dil okulunda sınıf düzeyi süzgeci yoktur. */
  languageSchool: boolean
  onPick: (picked: LinkedSummary[]) => void
}

/**
 * Bağlı içerik seçici (OG-984): içerik havuzundan yayındaki sürümü seçtiren iç içe pencere. Tür
 * `LINKED_KINDS`'ten gelir; okuma parçası ve soru bugün, dinleme kaydı gibi bağlar ileride aynı
 * bileşenle seçilir. Liste sunucu sayfalıdır (`useResourceList`), arama ve CEFR/sınıf düzeyi
 * süzgeci sayfayı başa alır. Pencere her açılışta temiz başlar.
 */
export function LinkedContentPicker({ open, onOpenChange, kind, ...rest }: PickerProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={LINKED_KINDS[kind].title}>
      {open ? <PickerBody kind={kind} onClose={() => onOpenChange(false)} {...rest} /> : null}
    </Modal>
  )
}

function PickerBody({
  kind,
  multiple,
  selected,
  languageSchool,
  onPick,
  onClose,
}: Omit<PickerProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const copy = LINKED_KINDS[kind]
  const [q, setQ] = useState('')
  const [cefrLevel, setCefrLevel] = useState('')
  const [gradeLevel, setGradeLevel] = useState('')
  const [page, setPage] = useState(1)
  const [chosen, setChosen] = useState<ReadonlyMap<string, LinkedSummary>>(() => new Map())
  const search = useDebouncedValue(q)
  const list = useResourceList(pickerQuery({ kind, q: search, cefrLevel, gradeLevel, page }))
  const rows = pickerRows(list.data?.data ?? [], selected)
  const total = list.data?.meta.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PICKER_PAGE_SIZE))
  // Veri azalınca geçersiz sayfada kalınmaz.
  const current = Math.min(page, pages)

  function toggle(row: PickerRow, on: boolean) {
    setChosen((previous) => {
      const next = new Map(previous)
      if (on) next.set(row.versionId, row)
      else next.delete(row.versionId)
      return next
    })
  }

  function finish(picked: LinkedSummary[]) {
    onPick(picked)
    onClose()
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField
          label={copy.searchLabel}
          value={q}
          onChange={(value) => {
            setQ(value)
            setPage(1)
          }}
          className="max-w-none flex-1 basis-56"
        />
        <div className="grid min-w-[130px] gap-1.5">
          <Label htmlFor="secici-cefr" className="text-xs">
            CEFR düzeyi
          </Label>
          <NativeSelect
            id="secici-cefr"
            value={cefrLevel}
            onChange={(event) => {
              setCefrLevel(event.target.value)
              setPage(1)
            }}
          >
            <NativeSelectOption value="">Tümü</NativeSelectOption>
            {CEFR_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {!languageSchool ? (
          <div className="grid min-w-[130px] gap-1.5">
            <Label htmlFor="secici-duzey" className="text-xs">
              Sınıf düzeyi
            </Label>
            <NativeSelect
              id="secici-duzey"
              value={gradeLevel}
              onChange={(event) => {
                setGradeLevel(event.target.value)
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
        ) : null}
      </div>

      {list.error ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Yükleniyor…
        </p>
      ) : rows.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {copy.empty}
        </p>
      ) : (
        <ul aria-label={copy.listLabel} className="grid gap-2">
          {rows.map((row) => (
            <li
              key={row.resourceId}
              className="flex flex-wrap items-center gap-3 rounded-card border bg-surface px-3 py-2.5"
            >
              {multiple ? (
                <Checkbox
                  id={`secici-${row.resourceId}`}
                  checked={chosen.has(row.versionId)}
                  onCheckedChange={(on) => toggle(row, on === true)}
                  disabled={row.disabledReason !== null}
                  aria-describedby={`secici-${row.resourceId}-kunye`}
                />
              ) : null}
              <div className="min-w-0 flex-1">
                {multiple ? (
                  <Label
                    htmlFor={`secici-${row.resourceId}`}
                    className="text-sm font-medium [overflow-wrap:anywhere]"
                  >
                    {row.title}
                  </Label>
                ) : (
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">{row.title}</p>
                )}
                <p id={`secici-${row.resourceId}-kunye`} className="text-xs text-muted-foreground">
                  {[row.meta, row.subskill, row.disabledReason].filter(Boolean).join(' · ') ||
                    'Etiket yok'}
                </p>
              </div>
              {row.subskill ? <StatusBadge text={row.subskill} /> : null}
              {!multiple ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label={`${row.title} seç`}
                  disabled={row.disabledReason !== null}
                  onClick={() => finish([row])}
                >
                  Seç
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Seçici sayfaları" className="flex items-center justify-between gap-2">
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
        {multiple ? (
          <Button
            type="button"
            onClick={() => finish([...chosen.values()])}
            disabled={chosen.size === 0}
          >
            <Icon name="Plus" size={16} aria-hidden="true" />
            Seçilenleri ekle ({chosen.size})
          </Button>
        ) : null}
      </div>
    </div>
  )
}
