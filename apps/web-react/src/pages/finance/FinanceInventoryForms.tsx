import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCancelStockMovement,
  useCreateStockEntry,
  useCreateStockIssue,
  useCreateStockItem,
  useCreateStockTransfer,
  useCreateStockWarehouse,
  useStockItems,
  useStockWarehouses,
  useUpdateStockItem,
  useUpdateStockWarehouse,
  type StockItemDetail,
  type StockMovementRow,
  type StockWarehouseRow,
} from '@kampus/react-shared/use-finance-inventory.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  STOCK_CATEGORIES,
  STOCK_ENTRY_REASON_LABELS,
  STOCK_ENTRY_REASONS,
  STOCK_ISSUE_REASON_LABELS,
  STOCK_ISSUE_REASONS,
  STOCK_UNIT_LABELS,
  STOCK_UNITS,
} from '@kampus/school-core/lib/finance-inventory.ts'
import { SUPPLIER_CATEGORY_LABELS } from '@kampus/school-core/lib/finance-suppliers.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { reasonFormSchema, type ReasonFormValues } from './finance-procurement-forms.ts'
import {
  MOVEMENT_KIND_LABELS,
  MOVEMENT_TYPE_VIEW,
  stockItemBody,
  stockItemDefaults,
  stockItemFormField,
  stockItemFormSchema,
  stockMovementBody,
  stockMovementDefaults,
  stockMovementFormField,
  stockMovementFormSchema,
  stockWarehouseBody,
  stockWarehouseDefaults,
  stockWarehouseFormField,
  stockWarehouseFormSchema,
  type MovementKind,
  type StockItemFormValues,
  type StockMovementFormValues,
  type StockWarehouseFormValues,
} from './finance-inventory-forms.ts'

type Option = { value: string; label: string }

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

const CATEGORY_OPTIONS = STOCK_CATEGORIES.map((value) => ({
  value,
  label: SUPPLIER_CATEGORY_LABELS[value],
}))
const UNIT_OPTIONS = STOCK_UNITS.map((value) => ({ value, label: STOCK_UNIT_LABELS[value] }))

// --- Stok kartı ----------------------------------------------------------------------------------

const ITEM_FORM = 'stok-karti-formu'

/** Stok kartı ekleme ve düzeltme (DOM-FIN-077). Hareketi olan kartın birimi kilitlidir (K-182). */
export function StockItemFormModal({
  item,
  onClose,
}: {
  item?: StockItemDetail
  onClose: () => void
}) {
  const create = useCreateStockItem()
  const update = useUpdateStockItem()
  const form = useForm<StockItemFormValues>({
    resolver: zodResolver(stockItemFormSchema),
    defaultValues: stockItemDefaults(item),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = stockItemFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const body = stockItemBody(values)
    const outcome = item
      ? await update.submit({ itemId: item.id, version: item.version, body }, fields)
      : await create.submit(body, fields)
    if (outcome.status === 'success') {
      notify.success(item ? 'Stok kartı güncellendi.' : `${body.name} stok kartı eklendi.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  const title = item ? 'Stok kartını düzenle' : 'Yeni stok kartı'
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Miktar kartta girilmez; giriş, çıkış ve mal kabul hareketlerinden hesaplanır."
      footer={<Footer form={ITEM_FORM} busy={busy} onClose={onClose} label="Kaydet" />}
    >
      <form
        id={ITEM_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField id="stok-kod" label="Kod" error={errors.code}>
          {(control) => <Input {...control} {...form.register('code')} disabled={busy} />}
        </FormField>
        <FormField id="stok-ad" label="Ürün adı" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
        <FormField id="stok-kategori" label="Kategori" error={errors.category}>
          {(control) => (
            <Select
              control={control}
              register={form.register('category')}
              disabled={busy}
              options={CATEGORY_OPTIONS}
            />
          )}
        </FormField>
        <FormField
          id="stok-birim"
          label="Birim"
          error={errors.unit}
          description={item?.hasMovements ? 'Hareketi olan kartın birimi değişmez.' : undefined}
        >
          {(control) => (
            <Select
              control={control}
              register={form.register('unit')}
              disabled={busy || item?.hasMovements === true}
              options={UNIT_OPTIONS}
            />
          )}
        </FormField>
        <FormField
          id="stok-kritik"
          label="Kritik seviye (isteğe bağlı)"
          error={errors.minQuantity}
          description="Toplam miktar bu sayıya inince kart kritik görünür."
        >
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              {...form.register('minQuantity')}
              disabled={busy}
            />
          )}
        </FormField>
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

// --- Depo ----------------------------------------------------------------------------------------

const WAREHOUSE_FORM = 'depo-formu'

/** Depo ekleme ve düzeltme (DOM-FIN-077, K-180): etkin kampüse bağlı, ad tekil. */
export function StockWarehouseFormModal({
  warehouse,
  onClose,
}: {
  warehouse?: StockWarehouseRow
  onClose: () => void
}) {
  const create = useCreateStockWarehouse()
  const update = useUpdateStockWarehouse()
  const branches = useCoreAll('branches')
  const form = useForm<StockWarehouseFormValues>({
    resolver: zodResolver(stockWarehouseFormSchema),
    defaultValues: stockWarehouseDefaults(warehouse),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = stockWarehouseFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const body = stockWarehouseBody(values)
    const outcome = warehouse
      ? await update.submit({ warehouseId: warehouse.id, version: warehouse.version, body }, fields)
      : await create.submit(body, fields)
    if (outcome.status === 'success') {
      notify.success(warehouse ? 'Depo güncellendi.' : `${body.name} eklendi.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  const campuses = (branches.data ?? [])
    .filter((item) => item.record.isActive !== false)
    .map((item) => ({ value: item.record.id, label: item.record.name }))
  const title = warehouse ? 'Depoyu düzenle' : 'Yeni depo'
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Depo bir kampüse bağlıdır; stoku olan depo başka kampüse bağlanamaz."
      footer={<Footer form={WAREHOUSE_FORM} busy={busy} onClose={onClose} label="Kaydet" />}
    >
      <form
        id={WAREHOUSE_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="depo-ad" label="Depo adı" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
        <FormField id="depo-kampus" label="Kampüs" error={errors.campusId}>
          {(control) => (
            <Select
              control={control}
              register={form.register('campusId')}
              disabled={busy}
              placeholder="Kampüs seçin"
              options={campuses}
            />
          )}
        </FormField>
        <FormField id="depo-not" label="Not (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

// --- Hareket -------------------------------------------------------------------------------------

const MOVEMENT_FORM = 'stok-hareket-formu'
const ACTIVE = { page: 1, pageSize: 100, status: 'active' } as const

/**
 * Giriş, çıkış ve transfer (DOM-FIN-078). Miktarın depodaki miktarı aşmaması sunucuda denetlenir
 * (422 `stock_insufficient`, mesajda çıkılabilecek en çok miktar; K-181); hata miktar alanına düşer.
 */
export function StockMovementFormModal({
  kind,
  itemId,
  onClose,
}: {
  kind: MovementKind
  itemId?: string
  onClose: () => void
}) {
  const entry = useCreateStockEntry()
  const issue = useCreateStockIssue()
  const transfer = useCreateStockTransfer()
  const items = useStockItems(ACTIVE)
  const warehouses = useStockWarehouses(ACTIVE)
  // Başlangıç değeri açılış anında bir kez kurulur; gün bugündür (Europe/Istanbul).
  const [defaults] = useState(() => stockMovementDefaults(kind, dayKey(new Date()), itemId))
  const form = useForm<StockMovementFormValues>({
    resolver: zodResolver(stockMovementFormSchema),
    defaultValues: defaults,
  })
  const selectedItem = useWatch({ control: form.control, name: 'itemId' })
  const reason = useWatch({ control: form.control, name: 'reason' })
  // Kimyasal kartın girişi parti ve son kullanma ister (DOM-FIN-090, K-241).
  const chemical =
    kind === 'entry' &&
    items.data?.data.find((item) => item.id === selectedItem)?.isChemical === true
  const busy =
    entry.isPending || issue.isPending || transfer.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const unit = items.data?.data.find((item) => item.id === selectedItem)?.unit
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = stockMovementFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (chemical && values.lotNumber.trim() === '') {
      form.setError(
        'lotNumber',
        { type: 'required', message: 'Kimyasal girişinde parti numarasını yazın.' },
        { shouldFocus: true },
      )
      return
    }
    const planned = stockMovementBody(values, { chemical })
    const outcome =
      planned.kind === 'entry'
        ? await entry.submit(planned.body, fields)
        : planned.kind === 'issue'
          ? await issue.submit(planned.body, fields)
          : await transfer.submit(planned.body, fields)
    if (outcome.status === 'success') {
      notify.success(`${MOVEMENT_KIND_LABELS[kind]} kaydedildi.`)
      onClose()
    }
  })
  const itemOptions = (items.data?.data ?? []).map((item) => ({
    value: item.id,
    label: `${item.code} · ${item.name} (${String(item.quantity)} ${STOCK_UNIT_LABELS[item.unit]})`,
  }))
  const warehouseOptions = (warehouses.data?.data ?? []).map((warehouse) => ({
    value: warehouse.id,
    label: warehouse.campusName ? `${warehouse.name} · ${warehouse.campusName}` : warehouse.name,
  }))
  const reasons =
    kind === 'entry'
      ? STOCK_ENTRY_REASONS.map((value) => ({ value, label: STOCK_ENTRY_REASON_LABELS[value] }))
      : STOCK_ISSUE_REASONS.map((value) => ({ value, label: STOCK_ISSUE_REASON_LABELS[value] }))
  const title = MOVEMENT_KIND_LABELS[kind]
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description={
        kind === 'entry'
          ? 'Satın alınan ürün mal kabulle girer; buradan açılış, bağış ve sayım fazlası girilir.'
          : kind === 'issue'
            ? 'Çıkış depodaki miktarı aşamaz.'
            : 'Çıkış deposundan çıkış ve giriş deposuna giriş tek işlemde yazılır.'
      }
      footer={<Footer form={MOVEMENT_FORM} busy={busy} onClose={onClose} label="Kaydet" />}
    >
      <form
        id={MOVEMENT_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <div className="col-span-full">
          <FormField id="hareket-kart" label="Stok kartı" error={errors.itemId}>
            {(control) => (
              <Select
                control={control}
                register={form.register('itemId')}
                disabled={busy}
                placeholder="Stok kartı seçin"
                options={itemOptions}
              />
            )}
          </FormField>
        </div>
        <FormField
          id="hareket-depo"
          label={kind === 'transfer' ? 'Çıkış deposu' : 'Depo'}
          error={errors.warehouseId}
        >
          {(control) => (
            <Select
              control={control}
              register={form.register('warehouseId')}
              disabled={busy}
              placeholder="Depo seçin"
              options={warehouseOptions}
            />
          )}
        </FormField>
        {kind === 'transfer' ? (
          <FormField id="hareket-hedef-depo" label="Giriş deposu" error={errors.toWarehouseId}>
            {(control) => (
              <Select
                control={control}
                register={form.register('toWarehouseId')}
                disabled={busy}
                placeholder="Depo seçin"
                options={warehouseOptions}
              />
            )}
          </FormField>
        ) : (
          <FormField id="hareket-neden" label="Neden" error={errors.reason}>
            {(control) => (
              <Select
                control={control}
                register={form.register('reason')}
                disabled={busy}
                options={reasons}
              />
            )}
          </FormField>
        )}
        <FormField
          id="hareket-miktar"
          label="Miktar"
          error={errors.quantity}
          description={unit ? `Birim: ${STOCK_UNIT_LABELS[unit]}` : undefined}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              {...form.register('quantity')}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="hareket-gun" label="Hareket günü" error={errors.movementDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('movementDate')} disabled={busy} />
          )}
        </FormField>
        {chemical ? (
          <>
            <FormField id="hareket-parti" label="Parti numarası" error={errors.lotNumber}>
              {(control) => <Input {...control} {...form.register('lotNumber')} disabled={busy} />}
            </FormField>
            <FormField
              id="hareket-son-kullanma"
              label="Son kullanma tarihi"
              error={errors.expiryDate}
            >
              {(control) => (
                <Input {...control} type="date" {...form.register('expiryDate')} disabled={busy} />
              )}
            </FormField>
          </>
        ) : null}
        {kind === 'issue' ? (
          <p className="col-span-full text-sm text-muted-foreground">
            Kimyasal kartta çıkış en yakın son kullanma tarihli partiden düşer.
          </p>
        ) : null}
        <div className="col-span-full">
          <FormField
            id="hareket-not"
            label={reason === 'other' ? 'Açıklama' : 'Açıklama (isteğe bağlı)'}
            error={errors.note}
          >
            {(control) => (
              <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
            )}
          </FormField>
        </div>
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

const CANCEL_FORM = 'stok-hareket-iptal-formu'

/** Hareket iptali (yalnız yönetici, K-183): transferin iki hareketi birlikte iptal edilir. */
export function CancelStockMovementModal({
  movement,
  onClose,
}: {
  movement: StockMovementRow
  onClose: () => void
}) {
  const cancel = useCancelStockMovement()
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { movementId: movement.id, version: movement.version, reason: values.reason.trim() },
      {
        setError: (name: string, error: { type: string; message: string }) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Stok hareketi iptal edildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  const view = MOVEMENT_TYPE_VIEW[movement.type]
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Stok hareketini iptal et"
      description={`${view.label} · ${movement.itemName} · ${String(movement.quantity)} ${STOCK_UNIT_LABELS[movement.unit]}`}
      footer={<Footer form={CANCEL_FORM} busy={busy} onClose={onClose} label="İptal et" />}
    >
      <form
        id={CANCEL_FORM}
        noValidate
        aria-label="Stok hareketini iptal et"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <p className="text-sm">
          Hareket silinmez, miktar hesabından çıkar.
          {movement.transferId ? ' Transferin iki hareketi birlikte iptal edilir.' : ''}
        </p>
        <FormField
          id="stok-hareket-iptal-gerekce"
          label="İptal gerekçesi"
          error={form.formState.errors.reason}
        >
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}
