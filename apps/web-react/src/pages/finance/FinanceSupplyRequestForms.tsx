import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useStockWarehouses } from '@kampus/react-shared/use-finance-inventory.ts'
import { usePurchaseRequestOptions } from '@kampus/react-shared/use-finance-procurement.ts'
import {
  useConvertSupplyRequest,
  useCreateSupplyRequest,
  useFulfillSupplyRequest,
  useSupplyStockCards,
  useTransitionSupplyRequest,
  type SupplyRequestDetail,
} from '@kampus/react-shared/use-finance-supply-requests.ts'
import { STOCK_UNIT_LABELS } from '@kampus/school-core/lib/finance-inventory.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
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
  noteFormSchema,
  reasonFormSchema,
  type ReasonFormValues,
} from './finance-procurement-forms.ts'
import {
  convertBody,
  convertDefaults,
  convertFormField,
  convertFormSchema,
  defaultWarehouse,
  fulfillBody,
  fulfillFormField,
  fulfillFormSchema,
  stockIn,
  suggestedLines,
  supplyRequestBody,
  supplyRequestDefaults,
  supplyRequestFormField,
  supplyRequestFormSchema,
  type ConvertFormValues,
  type FulfillFormValues,
  type SupplyRequestFormValues,
} from './finance-supply-request-forms.ts'

type Option = { value: string; label: string }
const ACTIVE = { page: 1, pageSize: 100, status: 'active' } as const

function Select({
  control,
  register,
  disabled,
  placeholder,
  options,
}: {
  control: object
  register: object
  disabled: boolean
  placeholder?: string
  options: readonly Option[]
}) {
  return (
    <NativeSelect {...control} {...register} className="w-full" disabled={disabled}>
      {placeholder === undefined ? null : (
        <NativeSelectOption value="">{placeholder}</NativeSelectOption>
      )}
      {options.map((option) => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}

function Footer({
  form,
  busy,
  onClose,
  label,
}: {
  form: string
  busy: boolean
  onClose: () => void
  label: string
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Vazgeç
      </Button>
      <Button type="submit" form={form} disabled={busy} aria-busy={busy || undefined}>
        {label}
      </Button>
    </>
  )
}

const unitLabel = (unit: keyof typeof STOCK_UNIT_LABELS) => STOCK_UNIT_LABELS[unit]

// --- Yeni talep ----------------------------------------------------------------------------------

const REQUEST_FORM = 'sarf-talebi-formu'

/**
 * Personelin kendi adına sarf talebi (DOM-FIN-091): istenen gün, gerekçe ve etkin stok
 * kartlarından kalemler. Öğretmen ekranı aynı kancaları kullanır (Oğuzhan'ın alanı).
 */
export function SupplyRequestFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const create = useCreateSupplyRequest()
  const cards = useSupplyStockCards({ page: 1, pageSize: 100 })
  const [defaults] = useState(() => supplyRequestDefaults(dayKey(new Date())))
  const form = useForm<SupplyRequestFormValues>({
    resolver: zodResolver(supplyRequestFormSchema),
    defaultValues: defaults,
  })
  const lines = useFieldArray({ control: form.control, name: 'items' })
  const selected = useWatch({ control: form.control, name: 'items' })
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const cardRows = cards.data?.data ?? []
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(supplyRequestBody(values), {
      setError: (name: string, error: { type: string; message: string }) => {
        const field = supplyRequestFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.number} onaya gönderildi.`)
      onSaved(outcome.data.data.id)
    }
  })
  const title = 'Yeni sarf talebi'
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Talep sizin adınıza açılır ve yöneticinin onayına gider; onaydan sonra depodan karşılanır."
      footer={<Footer form={REQUEST_FORM} busy={busy} onClose={onClose} label="Talebi gönder" />}
    >
      <form
        id={REQUEST_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField id="sarf-istenen-gun" label="İstenen gün" error={errors.neededDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('neededDate')} disabled={busy} />
          )}
        </FormField>
        <div className="col-span-full">
          <FormField id="sarf-gerekce" label="Gerekçe" error={errors.justification}>
            {(control) => (
              <Textarea {...control} {...form.register('justification')} rows={2} disabled={busy} />
            )}
          </FormField>
        </div>
        <fieldset className="col-span-full grid gap-3">
          <legend className="mb-1 text-sm font-medium">Kalemler</legend>
          {lines.fields.map((line, index) => {
            const card = cardRows.find((row) => row.id === selected[index]?.stockItemId)
            return (
              <div
                key={line.id}
                className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-3 max-[650px]:grid-cols-[minmax(0,1fr)_6rem_auto]"
              >
                <FormField
                  id={`sarf-kalem-${String(index)}`}
                  label={`${String(index + 1)}. kalem stok kartı`}
                  error={errors.items?.[index]?.stockItemId}
                >
                  {(control) => (
                    <Select
                      control={control}
                      register={form.register(`items.${index}.stockItemId`)}
                      disabled={busy}
                      placeholder="Stok kartı seçin"
                      options={cardRows.map((row) => ({
                        value: row.id,
                        label: `${row.code} · ${row.name} (${unitLabel(row.unit)})`,
                      }))}
                    />
                  )}
                </FormField>
                <FormField
                  id={`sarf-miktar-${String(index)}`}
                  label={`${String(index + 1)}. kalem miktarı`}
                  error={errors.items?.[index]?.quantity}
                  description={card ? unitLabel(card.unit) : undefined}
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
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`${String(index + 1)}. kalemi çıkar`}
                  disabled={busy || lines.fields.length === 1}
                  onClick={() => lines.remove(index)}
                >
                  <Icon name="Trash2" size={16} aria-hidden="true" />
                </Button>
              </div>
            )
          })}
          <RootError message={errors.items?.root?.message ?? errors.items?.message} />
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => lines.append({ stockItemId: '', quantity: '1' })}
            >
              <Icon name="Plus" size={16} aria-hidden="true" />
              Kalem ekle
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

// --- Onay, ret, iptal ----------------------------------------------------------------------------

const DECISION_FORM = 'sarf-karar-formu'
const DECISION_TEXT = {
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

/** Onay (isteğe bağlı not), ret ve iptal (zorunlu gerekçe). */
export function SupplyDecisionModal({
  request,
  action,
  onClose,
}: {
  request: SupplyRequestDetail
  action: 'approve' | 'reject' | 'cancel'
  onClose: () => void
}) {
  const transition = useTransitionSupplyRequest()
  const copy = DECISION_TEXT[action]
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
      description={`${request.number} · ${request.requestedByName ?? '—'}`}
      footer={<Footer form={DECISION_FORM} busy={busy} onClose={onClose} label={copy.button} />}
    >
      <form
        id={DECISION_FORM}
        noValidate
        aria-label={copy.title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <FormField id="sarf-karar-gerekce" label={copy.label} error={form.formState.errors.reason}>
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

// --- Karşılama -----------------------------------------------------------------------------------

const FULFILL_FORM = 'sarf-karsilama-formu'

/**
 * Depodan karşılama (K-245): depo seçilince her kalem için kalan ile depodaki miktarın küçüğü
 * önerilir; kullanıcı düzeltebilir, boş bırakılan kalem çıkmaz. "Kalanıyla kapat" kısmi karşılanmış
 * talebi açıklamayla kapatır.
 */
export function SupplyFulfillModal({
  request,
  onClose,
}: {
  request: SupplyRequestDetail
  onClose: () => void
}) {
  const warehouses = useStockWarehouses(ACTIVE)
  // Seçili depo, seçenekler gelmeden kurulursa yerel seçim kutusu boş kalır; form listeyle açılır.
  if (!warehouses.data)
    return (
      <Modal
        open
        onOpenChange={(next) => (next ? undefined : onClose())}
        title="Depodan karşıla"
        description={request.number}
      >
        {warehouses.error ? (
          <QueryError error={warehouses.error} onRetry={() => void warehouses.refetch()} />
        ) : (
          <SummaryLoading />
        )}
      </Modal>
    )
  return <FulfillForm request={request} warehouses={warehouses.data.data} onClose={onClose} />
}

function FulfillForm({
  request,
  warehouses,
  onClose,
}: {
  request: SupplyRequestDetail
  warehouses: readonly { id: string; name: string; campusName: string | null }[]
  onClose: () => void
}) {
  const fulfill = useFulfillSupplyRequest()
  const [defaults] = useState<FulfillFormValues>(() => {
    const warehouseId = defaultWarehouse(request.items)
    return {
      warehouseId,
      movementDate: dayKey(new Date()),
      lines: suggestedLines(request.items, warehouseId),
      close: false,
      closeNote: '',
    }
  })
  const form = useForm<FulfillFormValues>({
    resolver: zodResolver(fulfillFormSchema),
    defaultValues: defaults,
  })
  const warehouseId = useWatch({ control: form.control, name: 'warehouseId' })
  const close = useWatch({ control: form.control, name: 'close' })
  const busy = fulfill.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const open = request.items.filter((item) => item.remainingQuantity > 0)
  const warehouseField = form.register('warehouseId')
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await fulfill.submit(
      { requestId: request.id, version: request.version, body: fulfillBody(values) },
      {
        setError: (name: string, error: { type: string; message: string }) => {
          const field = fulfillFormField(name, values)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      const status = outcome.data.data.status
      notify.success(
        status === 'fulfilled'
          ? `${request.number} karşılandı.`
          : `${request.number} kısmen karşılandı; kalan bekliyor.`,
      )
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  const title = 'Depodan karşıla'
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={title}
      description={`${request.number}. Karşılama seçilen depodan stok çıkışı yazar.`}
      footer={<Footer form={FULFILL_FORM} busy={busy} onClose={onClose} label="Karşıla" />}
    >
      <form
        id={FULFILL_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField id="sarf-depo" label="Depo" error={errors.warehouseId}>
          {(control) => (
            <Select
              control={control}
              register={{
                ...warehouseField,
                onChange: async (event: { target: { value: string } }) => {
                  await warehouseField.onChange(event)
                  form.setValue('lines', suggestedLines(request.items, event.target.value))
                },
              }}
              disabled={busy}
              placeholder="Depo seçin"
              options={warehouses.map((warehouse) => ({
                value: warehouse.id,
                label: warehouse.campusName
                  ? `${warehouse.name} · ${warehouse.campusName}`
                  : warehouse.name,
              }))}
            />
          )}
        </FormField>
        <FormField id="sarf-cikis-gunu" label="Çıkış günü" error={errors.movementDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('movementDate')} disabled={busy} />
          )}
        </FormField>
        <fieldset className="col-span-full grid gap-3">
          <legend className="mb-1 text-sm font-medium">Çıkılacak miktarlar</legend>
          {open.map((item, index) => (
            <FormField
              key={item.id}
              id={`sarf-cikis-${String(index)}`}
              label={`${item.stockItem.name} miktarı`}
              error={errors.lines?.[index]?.quantity}
              description={`Kalan ${String(item.remainingQuantity)} ${unitLabel(item.unit)} · depoda ${String(stockIn(item, warehouseId))}`}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  {...form.register(`lines.${index}.quantity`)}
                  disabled={busy}
                />
              )}
            </FormField>
          ))}
          <RootError message={errors.lines?.root?.message ?? errors.lines?.message} />
        </fieldset>
        <label className="col-span-full flex min-h-6 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" disabled={busy} {...form.register('close')} />
          Talebi kalanıyla kapat (kısmi karşılama)
        </label>
        {close ? (
          <div className="col-span-full">
            <FormField id="sarf-kapatma-notu" label="Kapatma açıklaması" error={errors.closeNote}>
              {(control) => (
                <Textarea {...control} {...form.register('closeNote')} rows={2} disabled={busy} />
              )}
            </FormField>
          </div>
        ) : null}
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

// --- Satın almaya dönüştürme ---------------------------------------------------------------------

const CONVERT_FORM = 'sarf-donusturme-formu'

/**
 * Kalanı satın alma talebine dönüştürme (K-246): birim, dönem, gider kalemi, tedarikçi ve kalan
 * kalemlerin tahmini birim fiyatı (son alış fiyatıyla önerilir). Taslak satın alma talebi açılır;
 * bütçe denetimi satın alma talebinin gönderiminde işler.
 */
export function SupplyConvertModal({
  request,
  onClose,
  onConverted,
}: {
  request: SupplyRequestDetail
  onClose: () => void
  onConverted: (purchaseNumber: string) => void
}) {
  const convert = useConvertSupplyRequest()
  const options = usePurchaseRequestOptions()
  const [defaults] = useState(() => convertDefaults(request))
  const form = useForm<ConvertFormValues>({
    resolver: zodResolver(convertFormSchema),
    defaultValues: defaults,
  })
  const busy = convert.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const data = options.data?.data
  const open = request.items.filter((item) => item.remainingQuantity > 0)
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await convert.submit(
      { requestId: request.id, version: request.version, body: convertBody(values) },
      {
        setError: (name: string, error: { type: string; message: string }) => {
          const field = convertFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      const number = outcome.data.data.purchaseRequest?.number ?? ''
      notify.success(`Kalan ${number} numaralı taslak satın alma talebine dönüştürüldü.`)
      onConverted(number)
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  const title = 'Satın alma talebine dönüştür'
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={title}
      description={`${request.number}. Karşılanmamış kalan, stok kartı bağıyla taslak satın alma talebi olur.`}
      footer={<Footer form={CONVERT_FORM} busy={busy} onClose={onClose} label="Dönüştür" />}
    >
      <form
        id={CONVERT_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField id="sarf-birim" label="Talep eden birim" error={errors.costCenterId}>
          {(control) => (
            <Select
              control={control}
              register={form.register('costCenterId')}
              disabled={busy}
              placeholder="Birim seçin"
              options={(data?.costCenters ?? []).map((row) => ({
                value: row.id,
                label: `${row.code} · ${row.name}`,
              }))}
            />
          )}
        </FormField>
        <FormField id="sarf-donem" label="Bütçe dönemi" error={errors.periodId}>
          {(control) => (
            <Select
              control={control}
              register={form.register('periodId')}
              disabled={busy}
              placeholder="Dönem seçin"
              options={(data?.periods ?? []).map((row) => ({ value: row.id, label: row.name }))}
            />
          )}
        </FormField>
        <FormField id="sarf-gider-kalemi" label="Gider kalemi" error={errors.budgetItemId}>
          {(control) => (
            <Select
              control={control}
              register={form.register('budgetItemId')}
              disabled={busy}
              placeholder="Gider kalemi seçin"
              options={(data?.budgetItems ?? []).map((row) => ({
                value: row.id,
                label: `${row.code} · ${row.name}`,
              }))}
            />
          )}
        </FormField>
        <FormField id="sarf-tedarikci" label="Tedarikçi (isteğe bağlı)" error={errors.supplierId}>
          {(control) => (
            <Select
              control={control}
              register={form.register('supplierId')}
              disabled={busy}
              placeholder="Tedarikçi yok"
              options={(data?.suppliers ?? []).map((row) => ({ value: row.id, label: row.name }))}
            />
          )}
        </FormField>
        <fieldset className="col-span-full grid gap-3">
          <legend className="mb-1 text-sm font-medium">Tahmini birim fiyatlar</legend>
          {open.map((item, index) => (
            <FormField
              key={item.id}
              id={`sarf-fiyat-${String(index)}`}
              label={`${item.stockItem.name} birim fiyatı`}
              error={errors.prices?.[index]?.price}
              description={`${String(item.remainingQuantity)} ${unitLabel(item.unit)}${item.lastPriceCents === null ? '' : ' · son alış fiyatı önerildi'}`}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  placeholder="1.234,56"
                  {...form.register(`prices.${index}.price`)}
                  disabled={busy}
                />
              )}
            </FormField>
          ))}
          <RootError message={errors.prices?.root?.message ?? errors.prices?.message} />
        </fieldset>
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}
