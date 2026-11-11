import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { useUpdateProspectDetails } from '@kampus/react-shared/use-prospect-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Input } from '@/components/ui/input'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError, useFocusAfterSubmit } from '../management/FormParts.tsx'
import {
  editBody,
  editDefaults,
  editFormSchema,
  fieldErrors,
  type EditFormValues,
} from './prospect-forms.ts'
import { CONTACT_LABELS, prospectContactOwner } from './prospect-rows.ts'

type Prospect = CoreRecord<'prospects'>
type Output = z.output<typeof editFormSchema>
const FIELDS = ['name', 'phone', 'email', 'interest', 'guardianName'] as const

/**
 * Aday bilgisi düzeltme (DOM-KAY-003, KVKK md. 11): ad, telefon, e-posta, ilgi ve 18 yaş altında
 * veli adı sağ panelde düzeltilir (`?duzenle=bilgi`). Yalnız değişen alanlar gönderilir; mükerrer
 * ve kardeş ortak iletişimi hataları alan hatasıdır. Aşama ve ticari ileti onayı değişmez; kesin
 * kayda dönmüş adayın düzeltmesi öğrenci ve veli kaydına yansımaz.
 */
export function ProspectEditPanel({
  open,
  prospect,
  version,
  onClose,
}: {
  open: boolean
  prospect: Prospect
  version: number
  onClose: () => void
}) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Aday bilgilerini düzenle"
    >
      {open ? <EditForm prospect={prospect} version={version} onClose={onClose} /> : null}
    </SidePanel>
  )
}

function EditForm({
  prospect,
  version,
  onClose,
}: {
  prospect: Prospect
  version: number
  onClose: () => void
}) {
  const update = useUpdateProspectDetails()
  const learner = useEnrollmentLearner()
  const form = useForm<EditFormValues, unknown, Output>({
    resolver: zodResolver(editFormSchema),
    defaultValues: editDefaults(prospect),
  })
  const busy = update.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const errors = form.formState.errors
  const adult = prospect.minor === false
  const contact = CONTACT_LABELS[prospectContactOwner(prospect)]

  const onSubmit = form.handleSubmit(async (values) => {
    const result = editBody(values, prospect)
    if (!result.ok) {
      if (result.field === 'root') form.setError('root.server', { message: result.message })
      else form.setError(result.field, { type: 'manual', message: result.message })
      focusAfterSubmit(result.field)
      return
    }
    const outcome = await update.submit(
      { prospectId: prospect.id, version, body: result.body },
      { setError: fieldErrors(FIELDS, form.setError, focusAfterSubmit) },
    )
    if (outcome.status === 'success') {
      notify.success('Aday bilgileri güncellendi.')
      onClose()
    }
  })

  return (
    <form
      noValidate
      aria-label="Aday bilgilerini düzenle"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">
        Adayın talebiyle bilgisini düzeltin. Aşama ve ticari ileti onayı değişmez; kesin kayda
        dönmüş adayın düzeltmesi {learner.noun} ve veli kaydına yansımaz.
      </p>
      <FormField id="duzelt-ad" label="Ad soyad" error={errors.name}>
        {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
      </FormField>
      <FormField id="duzelt-telefon" label={contact.phone} error={errors.phone}>
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
      <FormField id="duzelt-eposta" label={`${contact.email} (isteğe bağlı)`} error={errors.email}>
        {(control) => (
          <Input {...control} {...form.register('email')} type="email" disabled={busy} />
        )}
      </FormField>
      <FormField id="duzelt-ilgi" label="İlgilendiği program" error={errors.interest}>
        {(control) => <Input {...control} {...form.register('interest')} disabled={busy} />}
      </FormField>
      {adult ? null : (
        <FormField id="duzelt-veli" label="Veli adı" error={errors.guardianName}>
          {(control) => <Input {...control} {...form.register('guardianName')} disabled={busy} />}
        </FormField>
      )}
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onClose} submitLabel="Kaydet" />
    </form>
  )
}
