import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import {
  REQUEST_CATEGORIES,
  REQUEST_TEXT_MAX_LENGTH,
  REQUEST_TITLE_MAX_LENGTH,
  openRequestSchema,
} from '@kampus/school-core/lib/requests.ts'
import { useOpenRequest } from '@kampus/react-shared/use-request-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
import { ChildrenGate, ChildSelectField, type ChildOption } from './ChildSelectField.tsx'
import { focusFirstError, openRequestDefaults, type OpenRequestValues } from './request-forms.ts'

type Output = z.output<typeof openRequestSchema>

/** `?talep-form=` değeri: yeni talep. */
export const NEW_REQUEST = 'yeni'

/**
 * Yeni talep (veli, Vue "Yeni talep" formu): kısa form sağ panelde açılır. Talep `Yeni`
 * durumunda ön büroya düşer (DOM-ILT-080); mükerrer gönderim `Idempotency-Key` ile önlenir.
 * Pasif öğrenci için hata öğrenci alanının altında görünür.
 */
export function RequestFormPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Yeni talep"
    >
      {open ? (
        <ChildrenGate>
          {(options, defaultId) => (
            <RequestForm options={options} defaultId={defaultId} onClose={onClose} />
          )}
        </ChildrenGate>
      ) : null}
    </SidePanel>
  )
}

function RequestForm({
  options,
  defaultId,
  onClose,
}: {
  options: readonly ChildOption[]
  defaultId: string
  onClose: () => void
}) {
  const open = useOpenRequest()
  const form = useForm<OpenRequestValues, unknown, Output>({
    resolver: zodResolver(openRequestSchema),
    defaultValues: openRequestDefaults(defaultId),
  })
  const busy = open.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await open.submit(values, { setError: focusFirstError(form.setError) })
    if (outcome.status === 'success') {
      notify.success('Talebiniz ön büroya iletildi.')
      onClose()
    }
  })

  return (
    <form
      noValidate
      aria-label="Yeni talep"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">Bu formdaki tüm alanlar zorunludur.</p>
      <ChildSelectField
        id="talep-ogrenci"
        options={options}
        error={errors.studentId}
        selectProps={{ ...form.register('studentId'), disabled: busy }}
      />
      <FormField id="talep-tur" label="Bildirim türü" error={errors.category}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('category')}
            className="w-full"
            disabled={busy}
          >
            {REQUEST_CATEGORIES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="talep-konu" label="Konu" error={errors.title}>
        {(control) => (
          <Input
            {...control}
            {...form.register('title')}
            maxLength={REQUEST_TITLE_MAX_LENGTH}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="talep-aciklama" label="Açıklama" error={errors.text}>
        {(control) => (
          <Textarea
            {...control}
            {...form.register('text')}
            rows={6}
            maxLength={REQUEST_TEXT_MAX_LENGTH}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onClose} submitLabel="Talebi gönder" icon="ArrowRight" />
    </form>
  )
}
