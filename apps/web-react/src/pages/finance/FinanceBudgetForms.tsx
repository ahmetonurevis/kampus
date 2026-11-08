import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form'
import { useActiveCourses } from '@kampus/react-shared/use-courses.ts'
import {
  useCostCenters,
  useBudgetItems,
  useCreateBudgetItem,
  useCreateBudgetLine,
  useCreateBudgetPeriod,
  useCreateCostCenter,
  useUpdateBudgetItem,
  useUpdateBudgetLine,
  useUpdateBudgetPeriod,
  useUpdateCostCenter,
  type BudgetItem,
  type BudgetLine,
  type BudgetPeriod,
  type CostCenter,
} from '@kampus/react-shared/use-finance-budget.ts'
import { FEE_ITEM_KIND_LABELS, FEE_ITEM_KINDS } from '@kampus/school-core/lib/fee-tariffs.ts'
import { BUDGET_ITEM_KIND_LABELS } from '@kampus/school-core/lib/finance-budget.ts'
import {
  COST_CENTER_GRADE_MAX,
  COST_CENTER_GRADE_MIN,
  COST_CENTER_TYPE_LABELS,
  COST_CENTER_TYPES,
} from '@kampus/school-core/lib/finance-cost-centers.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  centerBody,
  centerDefaults,
  centerFormField,
  centerFormSchema,
  itemBody,
  itemDefaults,
  itemFormField,
  itemFormSchema,
  lineAmounts,
  lineDefaults,
  lineFormField,
  lineFormSchema,
  monthLabel,
  periodBody,
  periodDefaults,
  periodFormField,
  periodFormSchema,
  periodUpdateBody,
  type CenterFormValues,
  type ItemFormValues,
  type LineFormValues,
  type PeriodFormValues,
} from './finance-budget-forms.ts'

// Bütçe formları (DOM-FIN-062): maliyet merkezi, kalem, dönem ve satır. Alan hatası formda
// (`ApiError.issues` → `setError`), yolsuz hata toast olur; gönderim sürerken düğmeler kilitlidir.

const OPTION_PAGE = { page: 1, pageSize: 100 } as const
const GRADES = Array.from(
  { length: COST_CENTER_GRADE_MAX - COST_CENTER_GRADE_MIN + 1 },
  (_, index) => COST_CENTER_GRADE_MIN + index,
)

/** Sunucu alan hatasını forma, eşleşmeyeni kök hataya yazar. */
function serverErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  field: (name: string) => Path<T> | undefined,
) {
  return {
    setError: (name: string, error: { type: string; message: string }) => {
      const target = field(name)
      if (target) form.setError(target, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
}

function FormModal({
  id,
  title,
  description,
  busy,
  onClose,
  children,
}: {
  id: string
  title: string
  description?: string
  busy: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      {...(description ? { description } : {})}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={id} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}

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
  options: readonly { value: string; label: string }[]
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

// --- Maliyet merkezi -----------------------------------------------------------------------------

const CENTER_FORM = 'maliyet-merkezi-formu'

export function CostCenterFormModal({
  center,
  institutionType,
  onClose,
}: {
  center?: CostCenter
  institutionType: string
  onClose: () => void
}) {
  const create = useCreateCostCenter()
  const update = useUpdateCostCenter()
  const centers = useCostCenters({ ...OPTION_PAGE, status: 'active' })
  const branches = useCoreAll('branches')
  const language = institutionType === 'language_school'
  const courses = useActiveCourses({ enabled: language })
  const form = useForm<CenterFormValues>({
    resolver: zodResolver(centerFormSchema),
    defaultValues: centerDefaults(center),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const type = useWatch({ control: form.control, name: 'type' })
  const fields = serverErrors(form, centerFormField)
  const onSubmit = form.handleSubmit(async (values) => {
    const body = centerBody(values)
    if (center) {
      const changes = {
        code: body.code,
        name: body.name,
        parentId: body.parentId,
        campusId: body.campusId,
        gradeLevel: body.gradeLevel,
        courseId: body.courseId,
      }
      const outcome = await update.submit(
        { costCenterId: center.id, version: center.version, body: changes },
        fields,
      )
      if (outcome.status === 'success') {
        notify.success('Maliyet merkezi güncellendi.')
        onClose()
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(body, fields)
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.name} eklendi.`)
      onClose()
    }
  })
  const parents = (centers.data?.data ?? []).filter((item) => item.id !== center?.id)
  const title = center ? 'Maliyet merkezini düzenle' : 'Yeni maliyet merkezi'
  return (
    <FormModal
      id={CENTER_FORM}
      title={title}
      description="Kampüs merkezi kampüse bağlanır; program okulda sınıf düzeyine, dil okulunda kura bağlanabilir."
      busy={busy}
      onClose={onClose}
    >
      <form
        id={CENTER_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField
          id="merkez-kod"
          label="Kod"
          error={errors.code}
          description="Harf, rakam, nokta, alt çizgi ve tire."
        >
          {(control) => <Input {...control} {...form.register('code')} disabled={busy} />}
        </FormField>
        <FormField id="merkez-ad" label="Ad" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
        <FormField
          id="merkez-tur"
          label="Tür"
          error={errors.type}
          {...(center ? { description: 'Tür sonradan değişmez.' } : {})}
        >
          {(control) => (
            <Select
              control={control}
              register={form.register('type')}
              disabled={busy || center !== undefined}
              options={COST_CENTER_TYPES.map((value) => ({
                value,
                label: COST_CENTER_TYPE_LABELS[value],
              }))}
            />
          )}
        </FormField>
        <FormField id="merkez-ust" label="Üst merkez (isteğe bağlı)" error={errors.parentId}>
          {(control) => (
            <Select
              control={control}
              register={form.register('parentId')}
              disabled={busy}
              placeholder="Üst merkez yok"
              options={parents.map((item) => ({
                value: item.id,
                label: `${item.path} · ${item.name}`,
              }))}
            />
          )}
        </FormField>
        {type === 'campus' ? (
          <FormField id="merkez-kampus" label="Kampüs" error={errors.campusId}>
            {(control) => (
              <Select
                control={control}
                register={form.register('campusId')}
                disabled={busy}
                placeholder="Kampüs seçin"
                options={(branches.data ?? []).map((item) => ({
                  value: item.record.id,
                  label: item.record.name,
                }))}
              />
            )}
          </FormField>
        ) : null}
        {type === 'program' && !language ? (
          <FormField
            id="merkez-duzey"
            label="Sınıf düzeyi (isteğe bağlı)"
            error={errors.gradeLevel}
          >
            {(control) => (
              <Select
                control={control}
                register={form.register('gradeLevel')}
                disabled={busy}
                placeholder="Düzey yok (kademe ya da grup)"
                options={GRADES.map((grade) => ({
                  value: String(grade),
                  label: `${grade}. sınıf`,
                }))}
              />
            )}
          </FormField>
        ) : null}
        {type === 'program' && language ? (
          <FormField id="merkez-kur" label="Kur (isteğe bağlı)" error={errors.courseId}>
            {(control) => (
              <Select
                control={control}
                register={form.register('courseId')}
                disabled={busy}
                placeholder="Kur yok (program grubu)"
                options={(courses.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
              />
            )}
          </FormField>
        ) : null}
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </FormModal>
  )
}

// --- Kalem ---------------------------------------------------------------------------------------

const ITEM_FORM = 'butce-kalemi-formu'

export function BudgetItemFormModal({ item, onClose }: { item?: BudgetItem; onClose: () => void }) {
  const create = useCreateBudgetItem()
  const update = useUpdateBudgetItem()
  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: itemDefaults(item),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const kind = useWatch({ control: form.control, name: 'kind' })
  const fields = serverErrors(form, itemFormField)
  const onSubmit = form.handleSubmit(async (values) => {
    const body = itemBody(values)
    if (item) {
      const outcome = await update.submit({ itemId: item.id, version: item.version, body }, fields)
      if (outcome.status === 'success') {
        notify.success('Bütçe kalemi güncellendi.')
        onClose()
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(body, fields)
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.name} eklendi.`)
      onClose()
    }
  })
  const title = item ? 'Bütçe kalemini düzenle' : 'Yeni bütçe kalemi'
  return (
    <FormModal
      id={ITEM_FORM}
      title={title}
      description="Gelir kalemi bir ücret türüne eşlenirse gerçekleşen tahsilat o kaleme yazılır."
      busy={busy}
      onClose={onClose}
    >
      <form
        id={ITEM_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField id="kalem-kod" label="Kod" error={errors.code}>
          {(control) => <Input {...control} {...form.register('code')} disabled={busy} />}
        </FormField>
        <FormField id="kalem-ad" label="Ad" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
        <FormField id="kalem-tur" label="Tür" error={errors.kind}>
          {(control) => (
            <Select
              control={control}
              register={form.register('kind')}
              disabled={busy}
              options={(['income', 'expense'] as const).map((value) => ({
                value,
                label: BUDGET_ITEM_KIND_LABELS[value],
              }))}
            />
          )}
        </FormField>
        {kind === 'income' ? (
          <FormField id="kalem-ucret" label="Ücret türü (isteğe bağlı)" error={errors.feeKind}>
            {(control) => (
              <Select
                control={control}
                register={form.register('feeKind')}
                disabled={busy}
                placeholder="Eşleme yok"
                options={FEE_ITEM_KINDS.map((value) => ({
                  value,
                  label: FEE_ITEM_KIND_LABELS[value],
                }))}
              />
            )}
          </FormField>
        ) : null}
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </FormModal>
  )
}

// --- Dönem ---------------------------------------------------------------------------------------

const PERIOD_FORM = 'butce-donemi-formu'

export function BudgetPeriodFormModal({
  period,
  academicYear,
  onClose,
  onSaved,
}: {
  period?: BudgetPeriod
  academicYear: number
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const create = useCreateBudgetPeriod()
  const update = useUpdateBudgetPeriod()
  const form = useForm<PeriodFormValues>({
    resolver: zodResolver(periodFormSchema),
    defaultValues: periodDefaults(academicYear, period),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const mode = useWatch({ control: form.control, name: 'mode' })
  const datesLocked = period !== undefined && period.status !== 'draft'
  const fields = serverErrors(form, periodFormField)
  const onSubmit = form.handleSubmit(async (values) => {
    if (period) {
      const body = periodUpdateBody(values, period)
      if (Object.keys(body).length === 0) {
        onClose()
        return
      }
      const outcome = await update.submit(
        { periodId: period.id, version: period.version, body },
        fields,
      )
      if (outcome.status === 'success') {
        notify.success('Bütçe dönemi güncellendi.')
        onClose()
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(periodBody(values), fields)
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.name} taslak olarak açıldı.`)
      if (onSaved) onSaved(outcome.data.data.id)
      else onClose()
    }
  })
  const years = Array.from({ length: 4 }, (_, index) => academicYear - 1 + index)
  const title = period ? 'Bütçe dönemini düzenle' : 'Yeni bütçe dönemi'
  return (
    <FormModal
      id={PERIOD_FORM}
      title={title}
      description={
        datesLocked
          ? 'Açık dönemin yalnız adı değişir; günler taslakta düzenlenir.'
          : 'Eğitim yılı seçilirse günler yılın kaydından kopyalanır.'
      }
      busy={busy}
      onClose={onClose}
    >
      <form
        id={PERIOD_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <div className="col-span-full">
          <FormField id="donem-ad" label="Dönem adı" error={errors.name}>
            {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
          </FormField>
        </div>
        <FormField id="donem-tur" label="Dönem aralığı">
          {(control) => (
            <Select
              control={control}
              register={form.register('mode')}
              disabled={busy || datesLocked}
              options={[
                { value: 'year', label: 'Eğitim yılı' },
                { value: 'range', label: 'Tarih aralığı' },
              ]}
            />
          )}
        </FormField>
        {mode === 'year' ? (
          <FormField id="donem-yil" label="Eğitim yılı" error={errors.academicYear}>
            {(control) => (
              <Select
                control={control}
                register={form.register('academicYear')}
                disabled={busy || datesLocked}
                options={years.map((year) => ({
                  value: String(year),
                  label: `${year}–${year + 1}`,
                }))}
              />
            )}
          </FormField>
        ) : (
          <>
            <FormField id="donem-baslangic" label="Başlangıç günü" error={errors.startDate}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  {...form.register('startDate')}
                  disabled={busy || datesLocked}
                />
              )}
            </FormField>
            <FormField id="donem-bitis" label="Bitiş günü" error={errors.endDate}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  {...form.register('endDate')}
                  disabled={busy || datesLocked}
                />
              )}
            </FormField>
          </>
        )}
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </FormModal>
  )
}

// --- Satır ---------------------------------------------------------------------------------------

const LINE_FORM = 'butce-satiri-formu'

export function BudgetLineFormModal({
  period,
  line,
  onClose,
}: {
  period: BudgetPeriod
  line?: BudgetLine
  onClose: () => void
}) {
  const create = useCreateBudgetLine()
  const update = useUpdateBudgetLine()
  const centers = useCostCenters({ ...OPTION_PAGE, status: 'active' })
  const items = useBudgetItems({ ...OPTION_PAGE, status: 'active' })
  const form = useForm<LineFormValues>({
    resolver: zodResolver(lineFormSchema),
    defaultValues: lineDefaults(period.months, line),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const distribution = useWatch({ control: form.control, name: 'distribution' })
  const fields = serverErrors(form, lineFormField)
  const onSubmit = form.handleSubmit(async (values) => {
    const amounts = lineAmounts(values, period.months.length)
    if (line) {
      const outcome = await update.submit(
        { periodId: period.id, lineId: line.id, version: line.version, body: amounts },
        fields,
      )
      if (outcome.status === 'success') {
        notify.success('Bütçe satırı güncellendi.')
        onClose()
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(
      {
        periodId: period.id,
        body: { costCenterId: values.costCenterId, itemId: values.itemId, ...amounts },
      },
      fields,
    )
    if (outcome.status === 'success') {
      notify.success('Bütçe satırı eklendi.')
      onClose()
    }
  })
  const title = line ? 'Bütçe satırını düzenle' : 'Bütçe satırı ekle'
  return (
    <FormModal
      id={LINE_FORM}
      title={title}
      description="Tutar kuruşuyla girilir; aylık dağılım isteğe bağlıdır ve toplamı tutara eşittir."
      busy={busy}
      onClose={onClose}
    >
      <form
        id={LINE_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField id="satir-merkez" label="Maliyet merkezi" error={errors.costCenterId}>
          {(control) => (
            <Select
              control={control}
              register={form.register('costCenterId')}
              disabled={busy || line !== undefined}
              placeholder="Merkez seçin"
              options={
                line
                  ? [
                      {
                        value: line.costCenterId,
                        label: `${line.costCenterCode} · ${line.costCenterName}`,
                      },
                    ]
                  : (centers.data?.data ?? []).map((item) => ({
                      value: item.id,
                      label: `${item.path} · ${item.name}`,
                    }))
              }
            />
          )}
        </FormField>
        <FormField id="satir-kalem" label="Bütçe kalemi" error={errors.itemId}>
          {(control) => (
            <Select
              control={control}
              register={form.register('itemId')}
              disabled={busy || line !== undefined}
              placeholder="Kalem seçin"
              options={
                line
                  ? [{ value: line.itemId, label: `${line.itemCode} · ${line.itemName}` }]
                  : (items.data?.data ?? []).map((item) => ({
                      value: item.id,
                      label: `${item.code} · ${item.name} (${BUDGET_ITEM_KIND_LABELS[item.kind]})`,
                    }))
              }
            />
          )}
        </FormField>
        <FormField id="satir-tutar" label="Planlanan tutar (₺)" error={errors.amount}>
          {(control) => (
            <Input {...control} inputMode="decimal" {...form.register('amount')} disabled={busy} />
          )}
        </FormField>
        <FormField id="satir-dagilim" label="Aylık dağılım">
          {(control) => (
            <Select
              control={control}
              register={form.register('distribution')}
              disabled={busy}
              options={[
                { value: 'none', label: 'Dağılım yok' },
                { value: 'even', label: 'Aylara eşit böl' },
                { value: 'manual', label: 'Ay ay gir' },
              ]}
            />
          )}
        </FormField>
        {distribution === 'manual' ? (
          <fieldset className="col-span-full grid grid-cols-3 gap-3 max-[650px]:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Aylık tutarlar (₺)</legend>
            {period.months.map((month, index) => (
              <FormField
                key={month}
                id={`satir-ay-${month}`}
                label={monthLabel(month)}
                error={errors.monthly?.[index]}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    {...form.register(`monthly.${index}`)}
                    disabled={busy}
                  />
                )}
              </FormField>
            ))}
          </fieldset>
        ) : null}
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </FormModal>
  )
}
