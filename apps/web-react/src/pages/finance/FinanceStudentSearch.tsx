import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'

/**
 * Öğrenci seçimi (servis ataması ve kulüp üyeliği; DOM-FIN-142): ad ya da numarayla arama (en az
 * 2 karakter), ilk 5 sonuç. Seçilen öğrenci adıyla görünür ve kaldırılabilir. Etkinlik ve kurum
 * denetimi sunucudadır.
 */
export function FinanceStudentSearch({
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  label: string
  value: string
  onChange: (studentId: string) => void
  error?: string | undefined
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState('')
  const search = useDebouncedValue(query).trim()
  const students = useCoreList(
    'students',
    { q: search, pageSize: 5 },
    { enabled: search.length >= 2 },
  )
  const id = useId()
  if (value !== '')
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{`Öğrenci: ${picked}`}</span>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={disabled}
          onClick={() => onChange('')}
        >
          Öğrenciyi değiştir
        </Button>
      </div>
    )
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={query}
        placeholder="Ad ya da numara (en az 2 karakter)"
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {search.length >= 2 ? (
        <ul aria-label="Öğrenci arama sonuçları" className="grid gap-1">
          {(students.data?.rows ?? []).map(({ record }) => (
            <li key={record.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => {
                  setPicked(record.name)
                  setQuery('')
                  onChange(record.id)
                }}
              >
                {record.name}
              </Button>
            </li>
          ))}
          {students.isSuccess && students.data.rows.length === 0 ? (
            <li className="text-sm text-muted-foreground">Öğrenci bulunamadı.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
