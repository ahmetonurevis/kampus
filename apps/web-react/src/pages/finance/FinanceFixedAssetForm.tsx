import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCreateFixedAsset,
  useFixedAssetReceiptItems,
  useUpdateFixedAsset,
  type FixedAssetDetail,
  type FixedAssetReceiptItem,
} from '@kampus/react-shared/use-finance-fixed-assets.ts'
import { useSuppliers } from '@kampus/react-shared/use-finance-procurement.ts'
import {
  DEFAULT_USEFUL_LIFE,
  DEPRECIATION_METHOD_LABELS,
  DEPRECIATION_METHODS,
  FIXED_ASSET_CATEGORIES,
  FIXED_ASSET_CATEGORY_LABELS,
  FIXED_ASSET_OPEN_STATUSES,
  FIXED_ASSET_STATUS_LABELS,
} from '@kampus/school-core/lib/finance-fixed-assets.ts'
import { dayKey, money } from '@kampus/school-core/lib/format.ts'
import { amountInputValue } from '@kampus/school-core/lib/payments.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  fixedAssetBody,
  fixedAssetChanges,
  fixedAssetDefaults,
  fixedAssetFormField,
  fixedAssetFormSchema,
  suggestedLife,
  type FixedAssetFormValues,
} from './finance-fixed-asset-forms.ts'

const FORM_ID = 'demirbas-formu'
const OPTION_PAGE = { page: 1, pageSize: 100 } as const

const receiptLabel = (item: FixedAssetReceiptItem) =>
  `${item.orderNumber} · ${item.itemName} · ${item.supplierName} (${String(
    item.acceptedQuantity - item.linkedAssetCount,
  )}/${String(item.acceptedQuantity)} adet boşta)`

/**
 * Demirbaş kaydı ve düzeltmesi (DOM-FIN-085). Etiket boş bırakılırsa sunucu `DB-<yıl>-<sıra>`
 * verir (K-185). Mal kabul kalemi seçilince tedarikçi, alım günü ve KDV hariç birim fiyat kabulden
 * önerilir; değer kullanıcıda kalır (K-187). Faydalı ömür kategorinin önerisiyle dolar; yeni kayıtta
 * kategori değişince ömre dokunulmadıysa yeni öneri yazılır (K-224, DOM-FIN-088). Düzeltmede yalnız
 * değişen alanlar gönderilir.
 */
export function FixedAssetFormModal({
  asset,
  onClose,
  onSaved,
}: {
  asset?: FixedAssetDetail
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const create = useCreateFixedAsset()
  const update = useUpdateFixedAsset()
  const branches = useCoreAll('branches')
  const suppliers = useSuppliers(OPTION_PAGE)
  const receiptItems = useFixedAssetReceiptItems(OPTION_PAGE)
  const form = useForm<FixedAssetFormValues>({
    resolver: zodResolver(fixedAssetFormSchema),
    defaultValues: fixedAssetDefaults(asset, dayKey()),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = fixedAssetFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const linkable = receiptItems.data?.data ?? []
  // Düzeltmede kendi kalemi dolmuş olabilir; listede yoksa kayıttaki bağ seçenek olarak kalır.
  const receiptChoices = [
    ...(asset?.receipt && !linkable.some((item) => item.receiptItemId === asset.receiptItemId)
      ? [
          {
            value: asset.receiptItemId ?? '',
            label: `${asset.receipt.orderNumber} · ${asset.receipt.itemName} (bağlı)`,
          },
        ]
      : []),
    ...linkable.map((item) => ({ value: item.receiptItemId, label: receiptLabel(item) })),
  ]
  const onReceiptChange = (receiptItemId: string) => {
    const item = linkable.find((choice) => choice.receiptItemId === receiptItemId)
    if (!item) return
    form.setValue('supplierId', item.supplierId)
    if (form.getValues('acquisitionDate') < item.receiptDate)
      form.setValue('acquisitionDate', item.receiptDate)
    if (form.getValues('value').trim() === '')
      form.setValue('value', amountInputValue(item.unitPriceCents))
    if (form.getValues('name').trim() === '') form.setValue('name', item.itemName)
  }

  const onCategoryChange = (category: string) => {
    const known = FIXED_ASSET_CATEGORIES.find((value) => value === category)
    if (!asset && known && !form.getFieldState('usefulLifeYears').isDirty)
      form.setValue('usefulLifeYears', suggestedLife(known))
  }
  const category = useWatch({ control: form.control, name: 'category' })

  const onSubmit = form.handleSubmit(async (values) => {
    if (asset) {
      const body = fixedAssetChanges(values, asset)
      if (body === null) {
        onClose()
        return
      }
      const outcome = await update.submit(
        { assetId: asset.id, version: asset.version, body },
        fields,
      )
      if (outcome.status === 'success') {
        notify.success('Demirbaş bilgileri güncellendi.')
        onClose()
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(fixedAssetBody(values), fields)
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.tagNumber} etiketiyle kaydedildi.`)
      if (onSaved) onSaved(outcome.data.data.id)
      else onClose()
    }
  })
  const title = asset ? 'Demirbaşı düzenle' : 'Yeni demirbaş'
  const text = (
    id: string,
    label: string,
    name: 'tagNumber' | 'name' | 'location' | 'value' | 'acquisitionDate' | 'usefulLifeYears',
    extra: { description?: string; inputMode?: 'decimal' | 'numeric'; type?: 'date' } = {},
  ) => (
    <FormField id={id} label={label} error={errors[name]} description={extra.description}>
      {(control) => (
        <Input
          {...control}
          {...form.register(name)}
          {...(extra.inputMode ? { inputMode: extra.inputMode } : {})}
          {...(extra.type ? { type: extra.type } : {})}
          disabled={busy}
        />
      )}
    </FormField>
  )
  const select = (
    id: string,
    label: string,
    name:
      'category' | 'campusId' | 'supplierId' | 'receiptItemId' | 'status' | 'depreciationMethod',
    choices: readonly { value: string; label: string }[],
    placeholder?: string,
    onChange?: (value: string) => void,
  ) => {
    const registered = form.register(name)
    return (
      <FormField id={id} label={label} error={errors[name]}>
        {(control) => (
          <NativeSelect
            {...control}
            {...registered}
            onChange={(event) => {
              void registered.onChange(event)
              onChange?.(event.target.value)
            }}
            className="w-full"
            disabled={busy}
          >
            {placeholder === undefined ? null : (
              <NativeSelectOption value="">{placeholder}</NativeSelectOption>
            )}
            {choices.map((choice) => (
              <NativeSelectOption key={choice.value} value={choice.value}>
                {choice.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
    )
  }
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Her kayıt bir adettir; hurdaya ayırma ayrıntı panelindedir."
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
        {select(
          'demirbas-kabul',
          'Mal kabul kalemi (isteğe bağlı)',
          'receiptItemId',
          receiptChoices,
          'Mal kabule bağlama',
          onReceiptChange,
        )}
        {text('demirbas-etiket', 'Etiket numarası', 'tagNumber', {
          description: 'Boş bırakılırsa DB-yıl-sıra biçiminde sıradaki numara verilir.',
        })}
        {text('demirbas-ad', 'Ad', 'name')}
        {select(
          'demirbas-kategori',
          'Kategori',
          'category',
          FIXED_ASSET_CATEGORIES.map((value) => ({
            value,
            label: FIXED_ASSET_CATEGORY_LABELS[value],
          })),
          undefined,
          onCategoryChange,
        )}
        {select(
          'demirbas-kampus',
          'Kampüs (isteğe bağlı)',
          'campusId',
          (branches.data ?? []).map((item) => ({ value: item.record.id, label: item.record.name })),
          'Kampüs seçilmedi',
        )}
        {text('demirbas-konum', 'Konum', 'location', {
          description: 'Oda ya da yer, ör. 2. kat fen laboratuvarı.',
        })}
        {text('demirbas-deger', 'Alım değeri (₺, KDV hariç)', 'value', {
          inputMode: 'decimal',
          description: 'Ör. 12.500,00',
        })}
        {text('demirbas-tarih', 'Alım günü', 'acquisitionDate', { type: 'date' })}
        {select(
          'demirbas-tedarikci',
          'Tedarikçi (isteğe bağlı)',
          'supplierId',
          (suppliers.data?.data ?? []).map((item) => ({
            value: item.id,
            label: item.isActive ? item.name : `${item.name} (pasif)`,
          })),
          'Tedarikçi seçilmedi',
        )}
        {select(
          'demirbas-durum',
          'Durum',
          'status',
          FIXED_ASSET_OPEN_STATUSES.map((value) => ({
            value,
            label: FIXED_ASSET_STATUS_LABELS[value],
          })),
        )}
        {text('demirbas-omur', 'Faydalı ömür (yıl)', 'usefulLifeYears', {
          inputMode: 'numeric',
          description: `Bu kategori için öneri ${String(DEFAULT_USEFUL_LIFE[category])} yıl (VUK listesi; mali müşavirce doğrulanmalı).`,
        })}
        {select(
          'demirbas-yontem',
          'Amortisman yöntemi',
          'depreciationMethod',
          DEPRECIATION_METHODS.map((value) => ({
            value,
            label: DEPRECIATION_METHOD_LABELS[value],
          })),
        )}
        {asset?.receipt ? (
          <p className="col-span-full text-sm text-muted-foreground">
            Bağlı kabulde sipariş birim fiyatı {money(asset.receipt.unitPriceCents)} (KDV hariç).
          </p>
        ) : null}
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}
