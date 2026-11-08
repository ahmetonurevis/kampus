import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  useCreateCorporateCustomer,
  useUpdateCorporateCustomer,
  type CorporateCustomer,
} from '@kampus/react-shared/use-finance-corporate.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  customerBody,
  customerDefaults,
  customerFormField,
  customerFormSchema,
  type CustomerFormValues,
} from './corporate-forms.ts'

const CUSTOMER_FORM = 'kurumsal-musteri-formu'

/**
 * Şirket kaydı ve düzeltmesi (DOM-FIN-060). Vergi numarası kontrol hanesi tarayıcıda da denetlenir;
 * tekillik sunucudadır. Düzeltme kesilmiş toplu faturayı değiştirmez.
 */
export function CustomerFormModal({
  customer,
  onClose,
  onSaved,
}: {
  customer?: CorporateCustomer
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const create = useCreateCorporateCustomer()
  const update = useUpdateCorporateCustomer()
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: customerDefaults(customer),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = customerFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const body = customerBody(values)
    if (customer) {
      const outcome = await update.submit(
        { customerId: customer.id, version: customer.version, body },
        fields,
      )
      if (outcome.status === 'success') {
        notify.success('Şirket bilgileri güncellendi.')
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
  const title = customer ? 'Şirketi düzenle' : 'Yeni şirket'
  const text = (
    id: string,
    label: string,
    name: keyof CustomerFormValues,
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
      description="Kesilmiş toplu fatura, kesildiği anki şirket bilgisini taşır."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={CUSTOMER_FORM} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={CUSTOMER_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        {text('sirket-unvan', 'Şirket unvanı', 'name')}
        {text('sirket-vergi-no', 'Vergi numarası', 'taxNumber', {
          inputMode: 'numeric',
          description: '10 haneli VKN ya da şahıs şirketinde 11 haneli TCKN.',
        })}
        {text('sirket-vergi-dairesi', 'Vergi dairesi', 'taxOffice')}
        <div className="col-span-full">
          <FormField id="sirket-adres" label="Fatura adresi" error={errors.billingAddress}>
            {(control) => (
              <Textarea
                {...control}
                {...form.register('billingAddress')}
                rows={2}
                disabled={busy}
              />
            )}
          </FormField>
        </div>
        {text('sirket-iletisim', 'İletişim kişisi (isteğe bağlı)', 'contactName')}
        {text('sirket-eposta', 'E-posta (isteğe bağlı)', 'contactEmail', { inputMode: 'email' })}
        {text('sirket-telefon', 'Telefon (isteğe bağlı)', 'contactPhone', {
          inputMode: 'tel',
          description: '0 ile başlayan 11 hane.',
        })}
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}
