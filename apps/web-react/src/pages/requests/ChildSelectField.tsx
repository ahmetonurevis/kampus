import { use, type ReactNode } from 'react'
import type { FieldError } from 'react-hook-form'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'

export type ChildOption = { id: string; name: string }

/**
 * Velinin bağlı çocukları (sunucu kapsamlı `students` okuması; pasif kayıt seçilmez, yeni bildirim
 * açılamaz, DOM-YTK-025). Formlar çocuklar yüklenmeden çizilmez: seçili değer geçerli bir
 * seçenek olsun diye. Başlangıçta seçili çocuk sayfadaki çocuktur.
 */
export function ChildrenGate({
  children,
}: {
  children: (options: ChildOption[], defaultId: string) => ReactNode
}) {
  const viewChild = use(ViewScopeContext)
  const students = useCoreAll('students')
  if (students.error)
    return <QueryError error={students.error} onRetry={() => void students.refetch()} />
  if (!students.data) return <SummaryLoading />
  const options = students.data
    .filter((row) => row.record.isActive !== false)
    .map((row) => ({ id: row.id, name: row.record.name }))
  if (options.length === 0)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Hesabınıza bağlı etkin öğrenci bulunamadı.
      </p>
    )
  const defaultId = options.some((option) => option.id === viewChild)
    ? viewChild
    : (options[0]?.id ?? '')
  return <>{children(options, defaultId)}</>
}

type SelectProps = Omit<React.ComponentProps<typeof NativeSelect>, 'children'>

/** "Öğrenci" alanı; react-hook-form `register` çıktısı `selectProps` ile verilir. */
export function ChildSelectField({
  id,
  options,
  error,
  selectProps,
}: {
  id: string
  options: readonly ChildOption[]
  error: FieldError | undefined
  selectProps: SelectProps
}) {
  return (
    <FormField id={id} label="Öğrenci" error={error}>
      {(control) => (
        <NativeSelect {...control} {...selectProps} className="w-full">
          {options.map((option) => (
            <NativeSelectOption key={option.id} value={option.id}>
              {option.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}
