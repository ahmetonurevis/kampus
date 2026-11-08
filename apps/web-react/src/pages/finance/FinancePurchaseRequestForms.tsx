import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import {
  useCreatePurchaseRequest,
  usePurchaseRequestOptions,
  useTransitionPurchaseRequest,
  useUpdatePurchaseRequest,
  type PurchaseRequestDetail,
} from '@kampus/react-shared/use-finance-procurement.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  PURCHASE_ITEMS_MAX,
  PURCHASE_UNIT_LABELS,
  PURCHASE_UNITS,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  EMPTY_ITEM,
  formTotalCents,
  noteFormSchema,
  reasonFormSchema,
  requestBody,
  requestDefaults,
  requestFormField,
  requestFormSchema,
  type ReasonFormValues,
  type RequestFormValues,
} from './finance-procurement-forms.ts'

const REQUEST_FORM = 'satin-alma-talebi-formu'
const REASON_FORM = 'satin-alma-karar-formu'
const PERIOD_STATUS = { draft: 'taslak', open: 'açık', closed: 'kapalı' } as const

/**
 * Satın alma talebi formu (DOM-FIN-071): birim, bütçe dönemi, gider kalemi, isteğe bağlı tedarikçi,
 * gerekçe ve kalemler. Seçenekler `GET /finance/purchase-requests/options`'tan gelir (ön büro bütçe
 * uçlarını okumaz). Tahmini toplam formda anlık hesaplanır; sunucu aynı hesabı yapar.
 */
export function PurchaseRequestFormModal({
  request,
  onClose,
  onSaved,
}: {
  request?: PurchaseRequestDetail
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const options = usePurchaseRequestOptions()
  const title = request ? `${request.number} talebini düzenle` : 'Yeni satın alma talebi'
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Talep taslak olarak kaydedilir; onaya göndermek için ayrıntıdan gönderin."
    >
      {options.error ? (
        <QueryError error={options.error} onRetry={() => void options.refetch()} />
      ) : options.data ? (
        <RequestForm
          title={title}
          request={request}
          options={options.data.data}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : (
        <SummaryLoading />
      )}
    </Modal>
  )
}

type Options = NonNullable<ReturnType<typeof usePurchaseRequestOptions>['data']>['data']

function RequestForm({
  title,
  request,
  options,
  onClose,
  onSaved,
}: {
  title: string
  request: PurchaseRequestDetail | undefined
  options: Options
  onClose: () => void
  onSaved: ((id: string) => void) | undefined
}) {
  const create = useCreatePurchaseRequest()
  const update = useUpdatePurchaseRequest()
  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestFormSchema),
    defaultValues: requestDefaults(request),
  })
  const items = useFieldArray({ control: form.control, name: 'items' })
  const watched = useWatch({ control: form.control, name: 'items' })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = requestFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const body = requestBody(values)
    if (request) {
      const outcome = await update.submit(
        { requestId: request.id, version: request.version, body },
        fields,
      )
      if (outcome.status === 'success') {
        notify.success(`${request.number} güncellendi.`)
        onClose()
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(body, fields)
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.number} taslak olarak kaydedildi.`)
      if (onSaved) onSaved(outcome.data.data.id)
      else onClose()
    }
  })
  const select = (
    id: string,
    label: string,
    name: 'costCenterId' | 'periodId' | 'budgetItemId' | 'supplierId',
    choices: readonly { value: string; label: string }[],
    placeholder: string,
  ) => (
    <FormField id={id} label={label} error={errors[name]}>
      {(control) => (
        <NativeSelect {...control} {...form.register(name)} className="w-full" disabled={busy}>
          <NativeSelectOption value="">{placeholder}</NativeSelectOption>
          {choices.map((choice) => (
            <NativeSelectOption key={choice.value} value={choice.value}>
              {choice.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
  const missing =
    options.costCenters.length === 0 ||
    options.budgetItems.length === 0 ||
    options.periods.length === 0
  return (
    <form
      id={REQUEST_FORM}
      noValidate
      aria-label={title}
      onSubmit={(event) => void onSubmit(event)}
      className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
    >
      {missing ? (
        <p role="status" className="col-span-full text-sm text-muted-foreground">
          Talep için etkin bir maliyet merkezi, gider kalemi ve açık ya da taslak bütçe dönemi
          gerekir; bunları yönetici Bütçe sekmesinden tanımlar.
        </p>
      ) : null}
      {select(
        'talep-birim',
        'Talep eden birim',
        'costCenterId',
        options.costCenters.map((item) => ({
          value: item.id,
          label: `${item.code} · ${item.name}`,
        })),
        'Birim seçin',
      )}
      {select(
        'talep-donem',
        'Bütçe dönemi',
        'periodId',
        options.periods.map((item) => ({
          value: item.id,
          label: `${item.name} (${PERIOD_STATUS[item.status]})`,
        })),
        'Dönem seçin',
      )}
      {select(
        'talep-kalem',
        'Gider kalemi',
        'budgetItemId',
        options.budgetItems.map((item) => ({
          value: item.id,
          label: `${item.code} · ${item.name}`,
        })),
        'Kalem seçin',
      )}
      {select(
        'talep-tedarikci',
        'Önerilen tedarikçi (isteğe bağlı)',
        'supplierId',
        options.suppliers.map((item) => ({ value: item.id, label: item.name })),
        'Tedarikçi önerme',
      )}
      <div className="col-span-full">
        <FormField id="talep-gerekce" label="Gerekçe" error={errors.justification}>
          {(control) => (
            <Textarea {...control} {...form.register('justification')} rows={3} disabled={busy} />
          )}
        </FormField>
      </div>
      <fieldset className="col-span-full grid gap-3">
        <legend className="mb-2 text-sm font-medium">Kalemler</legend>
        {items.fields.map((field, index) => (
          <div
            key={field.id}
            className="grid grid-cols-[3fr_1fr_1fr_1.5fr_auto] items-start gap-3 max-[650px]:grid-cols-2"
          >
            <FormField
              id={`talep-kalem-${String(index)}-ad`}
              label={`${String(index + 1)}. kalem adı`}
              error={errors.items?.[index]?.name}
            >
              {(control) => (
                <Input {...control} {...form.register(`items.${index}.name`)} disabled={busy} />
              )}
            </FormField>
            <FormField
              id={`talep-kalem-${String(index)}-miktar`}
              label="Miktar"
              error={errors.items?.[index]?.quantity}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  {...form.register(`items.${index}.quantity`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField
              id={`talep-kalem-${String(index)}-birim`}
              label="Birim"
              error={errors.items?.[index]?.unit}
            >
              {(control) => (
                <NativeSelect
                  {...control}
                  {...form.register(`items.${index}.unit`)}
                  className="w-full"
                  disabled={busy}
                >
                  {PURCHASE_UNITS.map((unit) => (
                    <NativeSelectOption key={unit} value={unit}>
                      {PURCHASE_UNIT_LABELS[unit]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField
              id={`talep-kalem-${String(index)}-fiyat`}
              label="Tahmini birim fiyat (₺)"
              error={errors.items?.[index]?.price}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  {...form.register(`items.${index}.price`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-7"
              aria-label={`${String(index + 1)}. kalemi kaldır`}
              disabled={busy || items.fields.length === 1}
              onClick={() => items.remove(index)}
            >
              <Icon name="Trash2" size={17} aria-hidden="true" />
            </Button>
          </div>
        ))}
        {errors.items?.message ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.items.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || items.fields.length >= PURCHASE_ITEMS_MAX}
            onClick={() => items.append({ ...EMPTY_ITEM })}
          >
            <Icon name="Plus" size={16} aria-hidden="true" />
            Kalem ekle
          </Button>
          <p className="text-sm font-semibold" aria-live="polite">
            Tahmini toplam:{' '}
            <span className="tabular-nums">{money(formTotalCents(watched ?? []))}</span>
          </p>
        </div>
      </fieldset>
      <div className="col-span-full empty:hidden">
        <RootError message={errors.root?.server?.message} />
      </div>
      <div className="col-span-full flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={busy || missing} aria-busy={busy || undefined}>
          Taslağı kaydet
        </Button>
      </div>
    </form>
  )
}

const REASON_TEXT = {
  approve: {
    title: 'Talebi onayla',
    label: 'Onay notu (isteğe bağlı)',
    button: 'Onayla',
    done: 'onaylandı',
  },
  reject: { title: 'Talebi reddet', label: 'Ret gerekçesi', button: 'Reddet', done: 'reddedildi' },
  cancel: {
    title: 'Talebi iptal et',
    label: 'İptal gerekçesi',
    button: 'İptal et',
    done: 'iptal edildi',
  },
} as const

/** Onay (isteğe bağlı not), ret ve iptal (zorunlu gerekçe) penceresi. */
export function ReasonModal({
  request,
  action,
  onClose,
}: {
  request: PurchaseRequestDetail
  action: 'approve' | 'reject' | 'cancel'
  onClose: () => void
}) {
  const transition = useTransitionPurchaseRequest()
  const copy = REASON_TEXT[action]
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(action === 'approve' ? noteFormSchema : reasonFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = transition.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const text = (values.reason ?? '').trim()
    const outcome = await transition.submit(
      {
        requestId: request.id,
        version: request.version,
        action,
        ...(action === 'approve' ? { note: text === '' ? null : text } : { reason: text }),
      },
      {
        setError: (_name: string, error: { type: string; message: string }) =>
          form.setError('reason', error, { shouldFocus: true }),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${request.number} ${copy.done}.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={copy.title}
      description={`${request.number} · ${money(request.totalCents)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={REASON_FORM} disabled={busy} aria-busy={busy || undefined}>
            {copy.button}
          </Button>
        </>
      }
    >
      <form
        id={REASON_FORM}
        noValidate
        aria-label={copy.title}
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="talep-karar-gerekce" label={copy.label} error={form.formState.errors.reason}>
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
          )}
        </FormField>
      </form>
    </Modal>
  )
}
