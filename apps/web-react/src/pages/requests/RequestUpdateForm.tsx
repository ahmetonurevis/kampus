import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { REQUEST_TEXT_MAX_LENGTH, REQUEST_UNITS } from '@kampus/school-core/lib/requests.ts'
import { useUpdateRequest } from '@kampus/react-shared/use-request-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { errorRoutes, FormActions, RootError } from '../management/FormParts.tsx'
import {
  UPDATE_REQUEST_ERROR_FIELDS,
  statusOptions,
  updateDefaults,
  updateFormSchema,
  updateRequestBody,
  type UpdateFormValues,
} from './request-forms.ts'

type Output = z.output<typeof updateFormSchema>

type Props = {
  record: CoreRecord<'requests'>
  /** Kaydın okunan sürümü (`If-Match`). */
  version: number
  /** Güncel kaydı yeniden okur; sürüm çakışmasından sonra form bununla tazelenir. */
  reload: () => Promise<{ record: CoreRecord<'requests'>; version: number } | null>
  onClose: () => void
}

/**
 * Ön büro/yönetici: durum, ilgili birim ve yanıt (Vue "Talebi güncelle"). Yalnız değişen alanlar
 * gönderilir. `If-Match` kaydın okunan sürümüdür; başka biri talebi değiştirdiyse (409
 * `version_conflict`) Türkçe uyarı çıkar, kayıt yeniden okunur ve durum/birim güncel değerlere
 * döner, yazılan yanıt korunur. Kural hataları (çözülmüş talep, geri dönüş yok) durum alanında
 * görünür; toast çıkmaz.
 */
export function RequestUpdateForm({ record, version, reload, onClose }: Props) {
  const update = useUpdateRequest()
  const form = useForm<UpdateFormValues, unknown, Output>({
    resolver: zodResolver(updateFormSchema),
    defaultValues: updateDefaults(record),
  })
  const busy = update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const result = updateRequestBody(record, values)
    if (!result.ok) {
      form.setError(result.field, { type: 'manual', message: result.message })
      form.setFocus(result.field)
      return
    }
    const outcome = await update.submit(
      { requestId: record.id, version, body: result.body },
      {
        setError: form.setError,
        // Yalnız `fieldFor`: sürüm çakışması toast olarak da söylenir (`silent` verilmez).
        fieldFor: errorRoutes(UPDATE_REQUEST_ERROR_FIELDS, true).fieldFor,
      },
    )
    if (outcome.status === 'success') {
      notify.success('Talep güncellendi.')
      // Panel açık kalır: yanıt görünür, aynı talep üzerinde devam edilebilir.
      form.reset({ ...values, reply: '' })
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') {
      // Toast sürüm çakışmasını söyler; form güncel kayda döner, yanıt metni kaybolmaz.
      const fresh = await reload()
      if (fresh) form.reset({ ...updateDefaults(fresh.record), reply: values.reply })
    }
  })

  return (
    <form
      noValidate
      aria-label="Talebi güncelle"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <FormField id="talep-durum" label="Durum" error={errors.status}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('status')}
            className="w-full"
            disabled={busy}
          >
            {statusOptions(record.status).map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="talep-birim" label="İlgili birim" error={errors.assignedTo}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('assignedTo')}
            className="w-full"
            disabled={busy}
          >
            {REQUEST_UNITS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="talep-yanit"
        label="Yanıt"
        description="Yanıt veli tarafından talepte görülür; eklendikten sonra değiştirilemez."
        error={errors.reply}
      >
        {(control) => (
          <Textarea
            {...control}
            {...form.register('reply')}
            rows={4}
            maxLength={REQUEST_TEXT_MAX_LENGTH}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onClose} submitLabel="Kaydet" />
    </form>
  )
}
