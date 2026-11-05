import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { useUpdateParentDetails } from '@kampus/react-shared/registration-records.ts'
import { FormField } from '@/components/FormField.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError, useFocusAfterSubmit } from '../management/FormParts.tsx'
import {
  PARENT_EDIT_FIELDS,
  parentEditBody,
  parentEditDefaults,
  parentEditFormSchema,
  type ParentEditFormValues,
} from './parent-edit-form.ts'
import { fieldErrors } from './prospect-forms.ts'

type Output = z.output<typeof parentEditFormSchema>
type Parent = { id: string; name: string; phone?: string | undefined; email?: string | undefined }

/**
 * Veli bilgisini düzelt (ON-117, DOM-KAY-012; KVKK md. 11): kesin kayıttaki veli kaydının adı,
 * telefonu ve e-postası sağ panelde düzeltilir. Yakınlık, velayet ve ödeyici bağı burada değişmez;
 * veli hesabının giriş e-postası ayrıdır.
 */
export function ParentEditPanel({
  open,
  parent,
  version,
  onClose,
}: {
  open: boolean
  parent: Parent
  version: number
  onClose: () => void
}) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Veli bilgisini düzelt"
    >
      {open ? <ParentEditForm parent={parent} version={version} onClose={onClose} /> : null}
    </SidePanel>
  )
}

function ParentEditForm({
  parent,
  version,
  onClose,
}: {
  parent: Parent
  version: number
  onClose: () => void
}) {
  const update = useUpdateParentDetails()
  const defaults = parentEditDefaults(parent)
  const form = useForm<ParentEditFormValues, unknown, Output>({
    resolver: zodResolver(parentEditFormSchema),
    defaultValues: defaults,
  })
  const busy = update.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const body = parentEditBody(values, defaults)
    if (body === null) {
      form.setError('root.server', { message: 'Veli bilgisinde değişiklik yok.' })
      return
    }
    const outcome = await update.submit(
      { parentId: parent.id, version, body },
      { setError: fieldErrors(PARENT_EDIT_FIELDS, form.setError, focusAfterSubmit) },
    )
    if (outcome.status === 'success') {
      notify.success('Veli bilgisi güncellendi.')
      onClose()
    }
  })

  return (
    <form
      noValidate
      aria-label="Veli bilgisini düzelt"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">
        Velinin talebiyle bilgisini düzeltin. Yakınlık, velayet ve ödeyici bilgisi değişmez; veli
        hesabının giriş e-postası ayrıdır.
      </p>
      <FormField id="veli-duzelt-ad" label="Ad soyad" error={errors.name}>
        {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
      </FormField>
      <FormField id="veli-duzelt-telefon" label="Telefon" error={errors.phone}>
        {(control) => (
          <Input
            {...control}
            {...form.register('phone')}
            type="tel"
            inputMode="tel"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="veli-duzelt-eposta" label="E-posta (isteğe bağlı)" error={errors.email}>
        {(control) => (
          <Input {...control} {...form.register('email')} type="email" disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onClose} submitLabel="Kaydet" />
    </form>
  )
}
