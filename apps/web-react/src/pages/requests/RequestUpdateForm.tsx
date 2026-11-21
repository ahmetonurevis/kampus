import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { REQUEST_TEXT_MAX_LENGTH } from '@kampus/school-core/lib/requests.ts'
import { useUpdateRequest } from '@kampus/react-shared/use-request-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
import {
  focusFirstError,
  statusOptions,
  unitOptions,
  updateDefaults,
  updateFormSchema,
  updateRequestBody,
  type UpdateFormValues,
} from './request-forms.ts'

type Output = z.output<typeof updateFormSchema>
type Request = CoreRecord<'requests'>
/** Formun kurulduğu (ya da son tazelendiği) andaki kayıt ve sürümü. */
type Base = { record: Request; version: number }

type Props = {
  /** Sorgudaki güncel kayıt ve sürüm; formun kendi tabanı değil, yalnız tazelenme sinyalidir. */
  record: Request
  version: number
  /** Güncel kaydı yeniden okur; gönderim sonrası form bununla tazelenir. */
  reload: () => Promise<Base | null>
  onClose: () => void
}

/**
 * Ön büro/yönetici: durum, ilgili birim ve yanıt (Vue "Talebi güncelle"). Yalnız değişen alanlar
 * gönderilir. Fark hesabı ve `If-Match` yalnız formun kurulduğu andaki `{kayıt, sürüm}` çiftinden
 * yapılır (`base`): sorgu arkadan yeni sürüm getirse bile form eski değerleri eski sürümle gönderir
 * ve sunucu 409 verir; böylece başkasının değişikliği sessizce geri alınmaz. Kullanıcı formu
 * kirletmediyse form yeni kayda sessizce geçer. 409'da Türkçe toast çıkar, kayıt yeniden okunur,
 * durum/birim güncel değerlere döner ve yazılan yanıt korunur. Kural hataları (çözülmüş talep)
 * durum alanının altında görünür; toast çıkmaz.
 */
export function RequestUpdateForm({ record, version, reload, onClose }: Props) {
  const update = useUpdateRequest()
  const [base, setBase] = useState<Base>({ record, version })
  const form = useForm<UpdateFormValues, unknown, Output>({
    resolver: zodResolver(updateFormSchema),
    defaultValues: updateDefaults(base.record),
  })
  const busy = update.isPending || form.formState.isSubmitting
  const dirty = form.formState.isDirty
  const errors = form.formState.errors

  // Sorgu arkadan yeni sürüm getirdiyse ve kullanıcı forma dokunmadıysa taban sessizce yenilenir
  // (render sırasında kendi state'inin ayarlanması); kirli form eski tabanda kalır, gönderimde 409 alır.
  if (version !== base.version && !dirty) setBase({ record, version })

  // Taban değişince (sessiz yenileme, gönderim sonrası, çakışma sonrası) form tabana döner; kullanıcının
  // yazdığı yanıt korunur.
  useEffect(() => {
    const reply = form.getValues('reply')
    form.reset(updateDefaults(base.record))
    if (reply !== '') form.setValue('reply', reply, { shouldDirty: true })
  }, [base, form])

  const onSubmit = form.handleSubmit(async (values) => {
    const result = updateRequestBody(base.record, values)
    if (!result.ok) {
      form.setError(
        result.field,
        { type: 'manual', message: result.message },
        { shouldFocus: true },
      )
      return
    }
    const outcome = await update.submit(
      { requestId: base.record.id, version: base.version, body: result.body },
      { setError: focusFirstError(form.setError) },
    )
    if (outcome.status === 'success') {
      notify.success('Talep güncellendi.')
      // Panel açık kalır: yeni kayıt ve sürüm taban olur, yanıt alanı temizlenir.
      form.setValue('reply', '')
      const fresh = await reload()
      if (fresh) setBase(fresh)
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') {
      // Toast sürüm çakışmasını söyler; form güncel kayda döner, yanıt metni kaybolmaz.
      const fresh = await reload()
      if (fresh) setBase(fresh)
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
            {statusOptions(base.record.status).map((value) => (
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
            {unitOptions(base.record.assignedTo).map((value) => (
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
