import { useId, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type PickableStudent = { id: string; name: string; className: string }

const MIN_QUERY = 2
const MAX_RESULTS = 8

const fold = (value: string) => value.toLocaleLowerCase('tr').normalize('NFC')

type Props = {
  students: readonly PickableStudent[]
  /** Seçilebilir listede olmayan seçili öğrencilerin adları (kayıtlı hedef). */
  names?: ReadonlyMap<string, string>
  value: readonly string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  error?: string | undefined
}

/**
 * Sınıf dışında tek tek öğrenci seçimi: ada göre arama (en az 2 karakter), sonuçlardan ekleme ve
 * seçilenleri tek tek kaldırma. Binlerce öğrenciyi seçenek listesi olarak çizmez.
 */
export function StudentTargetPicker({
  students,
  names,
  value,
  onChange,
  disabled = false,
  error,
}: Props) {
  const id = useId()
  const [query, setQuery] = useState('')
  const byId = useMemo(() => new Map(students.map((student) => [student.id, student])), [students])
  const needle = fold(query.trim())
  const results = useMemo(
    () =>
      needle.length < MIN_QUERY
        ? []
        : students
            .filter((student) => !value.includes(student.id) && fold(student.name).includes(needle))
            .slice(0, MAX_RESULTS),
    [needle, students, value],
  )
  return (
    <fieldset className="grid min-w-0 gap-2" aria-describedby={error ? `${id}-hata` : undefined}>
      <legend className="mb-1 text-sm font-medium">Tek tek öğrenciler</legend>
      <p className="text-xs text-muted-foreground">
        İsteğe bağlı: sınıf dışından ya da sınıfın yalnız bir kısmı için öğrenci ekleyin.
      </p>
      {value.length ? (
        <ul aria-label="Seçilen öğrenciler" className="flex flex-wrap gap-2">
          {value.map((studentId) => {
            const student = byId.get(studentId)
            const name = student?.name ?? names?.get(studentId) ?? 'Öğrenci'
            return (
              <li
                key={studentId}
                className="flex min-h-9 items-center gap-1 rounded-xl border bg-primary-soft py-1 pr-1 pl-3 text-sm"
              >
                {name}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  aria-label={`${name} öğrencisini kaldır`}
                  onClick={() => onChange(value.filter((item) => item !== studentId))}
                >
                  <Icon name="X" size={14} aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
      <Label htmlFor={`${id}-ara`} className="text-xs text-muted-foreground">
        Öğrenci ara
      </Label>
      <Input
        id={`${id}-ara`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={disabled}
        autoComplete="off"
        placeholder="Ad yazın (en az 2 harf)"
      />
      {needle.length >= MIN_QUERY ? (
        results.length ? (
          <ul aria-label="Arama sonuçları" className="grid gap-1">
            {results.map((student) => (
              <li key={student.id}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  className="w-full justify-start"
                  aria-label={`${student.name} öğrencisini ekle`}
                  onClick={() => {
                    onChange([...value, student.id])
                    setQuery('')
                  }}
                >
                  <Icon name="Plus" size={14} aria-hidden="true" />
                  {student.name}
                  {student.className ? (
                    <span className="text-muted-foreground"> · {student.className}</span>
                  ) : null}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="text-xs text-muted-foreground">
            Eşleşen öğrenci yok.
          </p>
        )
      ) : null}
      {error ? (
        <p id={`${id}-hata`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}
