import { useMemo } from 'react'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll, type CoreRow } from '@/hooks/use-core-collection.ts'

type Option = { id: string; name: string }

export const filterValue = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * Sınıf ve ders süzgeci seçenekleri. Sınıflar çağıranın kapsamındakilerdir (sunucu uygular);
 * dersler kurumun ders listesidir.
 */
export function useClassSubjectFilters(classes: readonly CoreRow<'classes'>[]) {
  const subjects = useCoreAll('subjects')
  return useMemo(() => {
    const classOptions: Option[] = classes
      .map((row) => ({ id: row.record.id, name: row.record.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }))
    const subjectOptions: Option[] = (subjects.data ?? [])
      .map((row) => ({ id: row.record.id, name: row.record.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    return {
      classOptions,
      subjectOptions,
      subjectName: (id: string) => subjectOptions.find((option) => option.id === id)?.name ?? id,
    }
  }, [classes, subjects.data])
}
export type ClassSubjectOptions = ReturnType<typeof useClassSubjectFilters>

type Props = {
  filters: ClassSubjectOptions
  classId: string
  subjectId: string
  onChange: (key: 'classId' | 'subjectId', value: string) => void
  /** Sınıf süzgeci yoksa (ör. materyal) gizlenir. */
  withClass?: boolean
}

const SELECT = 'min-h-9 text-sm'

export function ClassSubjectFilters({
  filters,
  classId,
  subjectId,
  onChange,
  withClass = true,
}: Props) {
  return (
    <>
      {withClass ? (
        <NativeSelect
          aria-label="Sınıf"
          value={classId}
          onChange={(event) => onChange('classId', event.target.value)}
          className={SELECT}
        >
          <NativeSelectOption value="">Tüm sınıflar</NativeSelectOption>
          {filters.classOptions.map((option) => (
            <NativeSelectOption key={option.id} value={option.id}>
              {option.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : null}
      <NativeSelect
        aria-label="Ders"
        value={subjectId}
        onChange={(event) => onChange('subjectId', event.target.value)}
        className={SELECT}
      >
        <NativeSelectOption value="">Tüm dersler</NativeSelectOption>
        {filters.subjectOptions.map((option) => (
          <NativeSelectOption key={option.id} value={option.id}>
            {option.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  )
}
