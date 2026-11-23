import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import {
  useCreateSupplier,
  useUpdateSupplier,
  type SupplierDetail,
} from '@kampus/react-shared/use-finance-procurement.ts'
import {
  SUPPLIER_CATEGORIES,
  SUPPLIER_CATEGORY_LABELS,
  SUPPLIER_DOCUMENTS_MAX,
  SUPPLIER_TYPE_LABELS,
  SUPPLIER_TYPES,
} from '@kampus/school-core/lib/finance-suppliers.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  supplierBody,
  supplierDefaults,
  supplierFormField,
  supplierFormSchema,
  type SupplierFormValues,
} from './finance-procurement-forms.ts'

const FORM_ID = 'tedarikci-formu'

/**
 * Tedarikçi kaydı ve düzeltmesi (DOM-FIN-070). Vergi numarası türe göre (VKN ya da TCKN) ve IBAN
 * tarayıcıda da denetlenir; tekillik sunucudadır. Belgeler ad, son geçerlilik günü ve nottur, dosya
 * yüklenmez (K-127). Düzeltmede tür ve vergi numarası birlikte gönderilir.
 */
export function SupplierFormModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier?: SupplierDetail
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const create = useCreateSupplier()
  const update = useUpdateSupplier()
  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: supplierDefaults(supplier),
  })
  const documents = useFieldArray({ control: form.control, name: 'documents' })
  const type = useWatch({ control: form.control, name: 'type' })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const documentField = /^documents\.(\d+)\.(name|expiryDate|note)$/.exec(name)
      if (documentField)
        form.setError(
          `documents.${Number(documentField[1])}.${documentField[2] as 'name' | 'expiryDate' | 'note'}`,
          error,
          { shouldFocus: true },
        )
      else {
        const field = supplierFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      }
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const body = supplierBody(values)
    if (supplier) {
      const outcome = await update.submit(
        { supplierId: supplier.id, version: supplier.version, body },
        fields,
      )
      if (outcome.status === 'success') {
        notify.success('Tedarikçi bilgileri güncellendi.')
        onClose()
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(body, fields)
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.name} eklendi.`)
      if (onSaved) onSaved(outcome.data.data.id)
      else onClose()
    }
  })
  const title = supplier ? 'Tedarikçiyi düzenle' : 'Yeni tedarikçi'
  const text = (
    id: string,
    label: string,
    name:
      'name' | 'taxNumber' | 'taxOffice' | 'contactName' | 'contactPhone' | 'contactEmail' | 'iban',
    extra: { inputMode?: 'numeric' | 'email' | 'tel'; description?: string } = {},
  ) => (
    <FormField id={id} label={label} error={errors[name]} description={extra.description}>
      {(control) => (
        <Input
          {...control}
          {...form.register(name)}
          {...(extra.inputMode ? { inputMode: extra.inputMode } : {})}
          disabled={busy}
        />
      )}
    </FormField>
  )
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Şahıs tedarikçinin kimlik numarası ve IBAN'ı listede maskeli gösterilir."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={FORM_ID} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        {text('tedarikci-unvan', 'Unvan', 'name')}
        <FormField id="tedarikci-tur" label="Tür" error={errors.type}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('type')}
              className="w-full"
              disabled={busy}
            >
              {SUPPLIER_TYPES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {SUPPLIER_TYPE_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {text('tedarikci-vergi-no', 'Vergi numarası', 'taxNumber', {
          inputMode: 'numeric',
          description:
            type === 'individual'
              ? 'Şahısta 11 haneli T.C. kimlik numarası.'
              : 'Şirkette 10 haneli vergi kimlik numarası (VKN).',
        })}
        {text('tedarikci-vergi-dairesi', 'Vergi dairesi', 'taxOffice')}
        <fieldset
          className="col-span-full grid gap-2"
          aria-describedby={errors.categories ? 'tedarikci-kategori-hata' : undefined}
        >
          <legend className="mb-2 text-sm font-medium">Kategori</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SUPPLIER_CATEGORIES.map((value) => (
              <label key={value} className="inline-flex min-h-6 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  value={value}
                  className="size-4 accent-primary"
                  disabled={busy}
                  {...form.register('categories')}
                />
                {SUPPLIER_CATEGORY_LABELS[value]}
              </label>
            ))}
          </div>
          {errors.categories?.message ? (
            <p id="tedarikci-kategori-hata" role="alert" className="text-sm text-destructive">
              {errors.categories.message}
            </p>
          ) : null}
        </fieldset>
        {text('tedarikci-yetkili', 'Yetkili (isteğe bağlı)', 'contactName')}
        {text('tedarikci-telefon', 'Telefon (isteğe bağlı)', 'contactPhone', {
          inputMode: 'tel',
          description: '0 ile başlayan 11 hane.',
        })}
        {text('tedarikci-eposta', 'E-posta (isteğe bağlı)', 'contactEmail', { inputMode: 'email' })}
        {text('tedarikci-iban', 'IBAN (isteğe bağlı)', 'iban', {
          description: 'TR ile başlayan 26 karakter; boşluk bırakılabilir.',
        })}
        <div className="col-span-full">
          <FormField id="tedarikci-adres" label="Adres (isteğe bağlı)" error={errors.address}>
            {(control) => (
              <Textarea {...control} {...form.register('address')} rows={2} disabled={busy} />
            )}
          </FormField>
        </div>
        <fieldset className="col-span-full grid gap-3">
          <legend className="mb-2 text-sm font-medium">Belgeler</legend>
          {documents.fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Vergi levhası, imza sirküleri gibi belgelerin adını ve son geçerlilik gününü ekleyin.
            </p>
          ) : null}
          {documents.fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-[2fr_1fr_2fr_auto] items-start gap-3 max-[650px]:grid-cols-1"
            >
              <FormField
                id={`tedarikci-belge-${String(index)}-ad`}
                label={`${String(index + 1)}. belge adı`}
                error={errors.documents?.[index]?.name}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`documents.${index}.name`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField
                id={`tedarikci-belge-${String(index)}-tarih`}
                label="Son geçerlilik"
                error={errors.documents?.[index]?.expiryDate}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    {...form.register(`documents.${index}.expiryDate`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField
                id={`tedarikci-belge-${String(index)}-not`}
                label="Not"
                error={errors.documents?.[index]?.note}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`documents.${index}.note`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-7 max-[650px]:mt-0"
                aria-label={`${String(index + 1)}. belgeyi kaldır`}
                disabled={busy}
                onClick={() => documents.remove(index)}
              >
                <Icon name="Trash2" size={17} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || documents.fields.length >= SUPPLIER_DOCUMENTS_MAX}
              onClick={() => documents.append({ name: '', expiryDate: '', note: '' })}
            >
              <Icon name="Plus" size={16} aria-hidden="true" />
              Belge ekle
            </Button>
          </div>
        </fieldset>
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}
