import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useActiveCourses } from '@kampus/react-shared/use-courses.ts'
import { useStockItems, useStockWarehouses } from '@kampus/react-shared/use-finance-inventory.ts'
import {
  useCancelMaterialDelivery,
  useCreateMaterialDelivery,
  useCreateMaterialSet,
  useMaterialRecipients,
  useUpdateMaterialSet,
  type MaterialSetDetail,
  type MaterialStudentRow,
} from '@kampus/react-shared/use-finance-material-sets.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { STOCK_UNIT_LABELS } from '@kampus/school-core/lib/finance-inventory.ts'
import { MATERIAL_RECIPIENT_KIND_LABELS } from '@kampus/school-core/lib/finance-material-sets.ts'
import { GUARDIAN_RELATIONSHIPS } from '@kampus/school-core/lib/guardianship.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { reasonFormSchema, type ReasonFormValues } from './finance-procurement-forms.ts'
import {
  MATERIAL_GRADE_OPTIONS,
  materialDeliveryBody,
  materialDeliveryDefaults,
  materialDeliveryFormField,
  materialDeliveryFormSchema,
  materialSetBody,
  materialSetDefaults,
  materialSetFormField,
  materialSetFormSchema,
  type MaterialDeliveryFormValues,
  type MaterialSetFormValues,
} from './finance-material-set-forms.ts'

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

// --- Set -----------------------------------------------------------------------------------------

const SET_FORM = 'materyal-seti-formu'

/**
 * Set tanımı ve düzeltmesi (DOM-FIN-080, K-208). Teslimi başlamış setin eğitim yılı ve hedefi
 * kilitlidir; kalemler bütün olarak yeniden yazılır, önceki teslimler kendi kalemlerini korur.
 */
export function MaterialSetFormModal({
  set,
  academicYear,
  institutionType,
  onClose,
}: {
  set?: MaterialSetDetail
  academicYear: number
  institutionType: string
  onClose: () => void
}) {
  const create = useCreateMaterialSet()
  const update = useUpdateMaterialSet()
  const language = institutionType === 'language_school'
  const items = useStockItems(ACTIVE)
  const courses = useActiveCourses({ enabled: language })
  const form = useForm<MaterialSetFormValues>({
    resolver: zodResolver(materialSetFormSchema),
    defaultValues: materialSetDefaults(academicYear, set),
  })
  const lines = useFieldArray({ control: form.control, name: 'items' })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const locked = set?.hasDeliveries === true
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = materialSetFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const body = materialSetBody(values, institutionType)
    const outcome = set
      ? await update.submit(
          {
            setId: set.id,
            version: set.version,
            body: locked ? { name: body.name, items: body.items } : body,
          },
          fields,
        )
      : await create.submit(body, fields)
    if (outcome.status === 'success') {
      notify.success(set ? 'Materyal seti güncellendi.' : `${body.name} tanımlandı.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  // Pasifleşmiş kart düzeltmede seçili kalabilsin diye setteki kartlar da seçenektir.
  const itemOptions = [
    ...(items.data?.data ?? []).map((item) => ({
      value: item.id,
      label: `${item.code} · ${item.name} (${STOCK_UNIT_LABELS[item.unit]})`,
    })),
    ...(set?.items ?? [])
      .filter((line) => !(items.data?.data ?? []).some((item) => item.id === line.stockItemId))
      .map((line) => ({ value: line.stockItemId, label: `${line.code} · ${line.name} (pasif)` })),
  ]
  const targetOptions = language
    ? (courses.data ?? []).map((course) => ({ value: course.id, label: course.name }))
    : MATERIAL_GRADE_OPTIONS
  const title = set ? 'Materyal setini düzenle' : 'Yeni materyal seti'
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Set öğrenci başına verilen stok kartlarından oluşur; teslim seçilen depodan stok çıkışı yazar."
      footer={<Footer form={SET_FORM} busy={busy} onClose={onClose} label="Kaydet" />}
    >
      <form
        id={SET_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <div className="col-span-full">
          <FormField id="materyal-seti-ad" label="Set adı" error={errors.name}>
            {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
          </FormField>
        </div>
        <FormField
          id="materyal-seti-yil"
          label="Eğitim yılı"
          error={errors.academicYear}
          description={
            locked ? 'Teslimi başlamış setin yılı değişmez.' : 'Başladığı yıl: 2026 → 2026–2027.'
          }
        >
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              {...form.register('academicYear')}
              disabled={busy || locked}
            />
          )}
        </FormField>
        <FormField
          id="materyal-seti-hedef"
          label={language ? 'Kur (isteğe bağlı)' : 'Sınıf düzeyi (isteğe bağlı)'}
          error={errors.target}
          description={locked ? 'Teslimi başlamış setin hedefi değişmez.' : undefined}
        >
          {(control) => (
            <Select
              control={control}
              register={form.register('target')}
              disabled={busy || locked}
              placeholder="Bütün öğrenciler"
              options={targetOptions}
            />
          )}
        </FormField>
        <fieldset className="col-span-full grid gap-3">
          <legend className="mb-1 text-sm font-medium">Kalemler</legend>
          {lines.fields.map((line, index) => (
            <div
              key={line.id}
              className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-3 max-[650px]:grid-cols-[minmax(0,1fr)_6rem_auto]"
            >
              <FormField
                id={`materyal-seti-kalem-${String(index)}`}
                label={`${String(index + 1)}. kalem stok kartı`}
                error={errors.items?.[index]?.stockItemId}
              >
                {(control) => (
                  <Select
                    control={control}
                    register={form.register(`items.${index}.stockItemId`)}
                    disabled={busy}
                    placeholder="Stok kartı seçin"
                    options={itemOptions}
                  />
                )}
              </FormField>
              <FormField
                id={`materyal-seti-adet-${String(index)}`}
                label={`${String(index + 1)}. kalem adedi`}
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
          ))}
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

// --- Teslim --------------------------------------------------------------------------------------

const DELIVERY_FORM = 'materyal-teslim-formu'

/**
 * Öğrenciye set teslimi (DOM-FIN-080, K-206): teslim alan, gün, depo ve kâğıt imza işareti. Stok
 * yetmezse sunucu iletisi depo alanında görünür; pencere açık kalır.
 */
export function MaterialDeliveryModal({
  setId,
  setName,
  student,
  onClose,
}: {
  setId: string
  setName: string
  student: Pick<MaterialStudentRow, 'studentId' | 'studentName'>
  onClose: () => void
}) {
  const deliver = useCreateMaterialDelivery()
  const warehouses = useStockWarehouses(ACTIVE)
  const recipients = useMaterialRecipients(student.studentId)
  const [defaults] = useState(() => materialDeliveryDefaults(dayKey(new Date())))
  const form = useForm<MaterialDeliveryFormValues>({
    resolver: zodResolver(materialDeliveryFormSchema),
    defaultValues: defaults,
  })
  const kind = useWatch({ control: form.control, name: 'recipientKind' })
  const busy = deliver.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await deliver.submit(
      { setId, body: materialDeliveryBody(student.studentId, values) },
      {
        setError: (name: string, error: { type: string; message: string }) => {
          const field = materialDeliveryFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${setName} ${student.studentName} için teslim edildi.`)
      onClose()
    }
  })
  const warehouseOptions = (warehouses.data?.data ?? []).map((warehouse) => ({
    value: warehouse.id,
    label: warehouse.campusName ? `${warehouse.name} · ${warehouse.campusName}` : warehouse.name,
  }))
  const guardianOptions = (recipients.data?.data ?? []).map((guardian) => ({
    value: guardian.id,
    label: `${guardian.name} (${GUARDIAN_RELATIONSHIPS[guardian.relationship].label})`,
  }))
  const title = 'Seti teslim et'
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description={`${setName} · ${student.studentName}. Teslim, setin kalemleri kadar depodan çıkış yazar.`}
      footer={<Footer form={DELIVERY_FORM} busy={busy} onClose={onClose} label="Teslim et" />}
    >
      <form
        id={DELIVERY_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField id="teslim-depo" label="Depo" error={errors.warehouseId}>
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
        <FormField id="teslim-gun" label="Teslim günü" error={errors.deliveryDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('deliveryDate')} disabled={busy} />
          )}
        </FormField>
        <FormField id="teslim-alan-tur" label="Teslim alan" error={errors.recipientKind}>
          {(control) => (
            <Select
              control={control}
              register={form.register('recipientKind')}
              disabled={busy}
              options={Object.entries(MATERIAL_RECIPIENT_KIND_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          )}
        </FormField>
        {kind === 'guardian' ? (
          <FormField
            id="teslim-veli"
            label="Veli"
            error={errors.guardianId}
            description={
              recipients.data && guardianOptions.length === 0
                ? 'Öğrencinin teslim alabilecek kayıtlı velisi yok; adı yazarak teslim edin.'
                : undefined
            }
          >
            {(control) => (
              <Select
                control={control}
                register={form.register('guardianId')}
                disabled={busy}
                placeholder="Veli seçin"
                options={guardianOptions}
              />
            )}
          </FormField>
        ) : null}
        {kind === 'other' ? (
          <FormField id="teslim-ad" label="Teslim alanın adı" error={errors.recipientName}>
            {(control) => (
              <Input {...control} {...form.register('recipientName')} disabled={busy} />
            )}
          </FormField>
        ) : null}
        <label className="col-span-full flex min-h-6 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            disabled={busy}
            {...form.register('signatureReceived')}
          />
          Kâğıt teslim tutanağında imza alındı
        </label>
        <div className="col-span-full">
          <FormField id="teslim-not" label="Açıklama (isteğe bağlı)" error={errors.note}>
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

const CANCEL_FORM = 'materyal-teslim-iptal-formu'

/** Teslim iptali (yalnız yönetici, K-209): stok çıkışları da iptal edilir. */
export function CancelMaterialDeliveryModal({
  delivery,
  studentName,
  onClose,
}: {
  delivery: { id: string; version: number }
  studentName: string
  onClose: () => void
}) {
  const cancel = useCancelMaterialDelivery()
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { deliveryId: delivery.id, version: delivery.version, reason: values.reason.trim() },
      {
        setError: (name: string, error: { type: string; message: string }) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Teslim iptal edildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Teslimi iptal et"
      description={studentName}
      footer={<Footer form={CANCEL_FORM} busy={busy} onClose={onClose} label="İptal et" />}
    >
      <form
        id={CANCEL_FORM}
        noValidate
        aria-label="Teslimi iptal et"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-3"
      >
        <p className="text-sm">
          Teslim silinmez; stok çıkışları iptal edilir ve set öğrenciye yeniden teslim edilebilir.
        </p>
        <FormField
          id="materyal-teslim-iptal-gerekce"
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
