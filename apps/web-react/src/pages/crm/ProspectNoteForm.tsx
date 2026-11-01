import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { useAddProspectNote } from '@kampus/react-shared/use-prospect-commands.ts'
import {
  PROSPECT_NOTE_MAX_LENGTH,
  PROSPECT_NOTE_NOTICE,
} from '@kampus/school-core/lib/prospects.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { fieldErrors, noteBody, noteFormSchema, type NoteFormValues } from './prospect-forms.ts'

type Output = z.output<typeof noteFormSchema>

/**
 * Görüşme notu ekleme (DOM-KAY-032): not yalnız eklenir, düzenlenmez ve silinmez; yazar adı
 * sunucuda oturumdan alınır. Form özel nitelikli veri uyarısını (`PROSPECT_NOTE_NOTICE`) gösterir.
 * Kapalı (kayıtlı veya vazgeçmiş) adaya not eklenmez; vazgeçen adayla yeni temas önce adayı yeniden açar.
 */
export function ProspectNoteForm({
  prospectId,
  version,
  open,
}: {
  prospectId: string
  version: number
  open: boolean
}) {
  const add = useAddProspectNote()
  const form = useForm<NoteFormValues, unknown, Output>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: { text: '' },
  })
  const busy = add.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  if (!open)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Kapalı adaya not eklenmez. Vazgeçen adayla yeni temas için önce adayı yeniden açın.
      </p>
    )

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await add.submit(
      { prospectId, version, body: noteBody(values) },
      { setError: fieldErrors(['text'], form.setError) },
    )
    if (outcome.status === 'success') {
      notify.success('Not eklendi.')
      form.reset({ text: '' })
    }
  })

  return (
    <form
      noValidate
      aria-label="Görüşme notu ekle"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-4"
    >
      <FormField
        id="aday-not"
        label="Görüşme notu"
        description={PROSPECT_NOTE_NOTICE}
        error={errors.text}
      >
        {(control) => (
          <Textarea
            {...control}
            {...form.register('text')}
            rows={3}
            maxLength={PROSPECT_NOTE_MAX_LENGTH}
            placeholder="Görüşmenin önemli noktalarını yazın…"
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          <Icon name="Plus" size={16} aria-hidden="true" />
          Notu kaydet
        </Button>
      </div>
    </form>
  )
}
