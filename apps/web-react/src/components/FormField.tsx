import type { ReactNode } from 'react'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'

export type ControlProps = {
  id: string
  'aria-invalid': boolean
  'aria-describedby': string | undefined
}

type FormFieldProps = {
  id: string
  label: string
  /** react-hook-form `formState.errors.<alan>` (veya `ApiError.issues` → `setError`). */
  error?: { message?: string } | undefined
  description?: string
  children: (control: ControlProps) => ReactNode
}

/**
 * Etiket, açıklama ve Türkçe alan hatasını kontrolle bağlar: `aria-invalid` ve
 * `aria-describedby` her zaman doğru öğeyi gösterir. Kontrol `register` ya da `Controller` ile verilir.
 */
export function FormField({ id, label, error, description, children }: FormFieldProps) {
  const descriptionId = description ? `${id}-aciklama` : undefined
  const errorId = error?.message ? `${id}-hata` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <Field data-invalid={Boolean(errorId)} className="gap-2">
      <FieldLabel htmlFor={id} className="text-sm font-medium">
        {label}
      </FieldLabel>
      {children({ id, 'aria-invalid': Boolean(errorId), 'aria-describedby': describedBy })}
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      <FieldError id={errorId} errors={error ? [error] : undefined} />
    </Field>
  )
}
