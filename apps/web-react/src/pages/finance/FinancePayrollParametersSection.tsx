import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import {
  useArchivePayrollParameterSet,
  useCreatePayrollParameterSet,
  usePayrollParameterYear,
  useUpdatePayrollParameterSet,
  type PayrollParameterPeriodView,
} from '@kampus/react-shared/use-finance-payroll-parameters.ts'
import {
  incomeTaxBracketRows,
  PAYROLL_PARAMETER_FIELDS,
  PAYROLL_PARAMETERS_NOTE,
  payrollDayLabel,
  payrollParameterRows,
  payrollPeriodLabel,
  payrollYearOptions,
  type PayrollParameterValues,
} from '@kampus/school-core/lib/finance-payroll-parameters.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  nextPeriodMonth,
  payrollBody,
  payrollFormDefaults,
  payrollFormPath,
  payrollFormSchema,
  type PayrollFormValues,
} from './finance-payroll-parameters-form.ts'

type Editing =
  | { mode: 'create'; values: PayrollParameterValues; month: string; title: string }
  | { mode: 'update'; period: PayrollParameterPeriodView }

const valuesOf = (period: PayrollParameterPeriodView): PayrollParameterValues =>
  Object.fromEntries(
    PAYROLL_PARAMETER_FIELDS.map((field) => [field, period[field]]),
  ) as PayrollParameterValues

/**
 * Bordro parametreleri (ON-197; DOM-FIN-100): Finans "Bordro parametreleri" sekmesi. Yönetici ve ön
 * büro yılın dönemlerini okur; kurum kopyasını yalnız yönetici ekler, düzeltir ve arşivler (K-309).
 * Platform değerleri "doğrulanmalı" işaretlidir (M-40); hesaplanan değerler saklanmaz (K-310).
 */
export function FinancePayrollParametersSection({ canManage }: { canManage: boolean }) {
  const [currentYear] = useState(() => Number(dayKey().slice(0, 4)))
  const [year, setYear] = useState(currentYear)
  const table = usePayrollParameterYear(year)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [archiving, setArchiving] = useState<PayrollParameterPeriodView | null>(null)
  const data = table.data?.data
  const periods = data?.periods ?? []
  const years = payrollYearOptions(data?.availableYears ?? [], currentYear)
  const last = periods.at(-1)

  return (
    <section
      aria-labelledby="bordro-parametreleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2 max-[650px]:px-4">
        <div>
          <h2 id="bordro-parametreleri" className="text-lg font-semibold">
            Bordro parametreleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Asgari ücret, gelir vergisi dilimleri, SGK ve işsizlik payları, damga vergisi,
            istisnalar ve kıdem tavanı; yürürlük tarihli dönemler.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-medium" htmlFor="bordro-yil">
            Yıl
            <NativeSelect
              id="bordro-yil"
              value={String(year)}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {years.map((item) => (
                <NativeSelectOption key={item} value={String(item)}>
                  {item}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {canManage && last ? (
            <Button
              variant="secondary"
              onClick={() =>
                setEditing({
                  mode: 'create',
                  values: valuesOf(last),
                  month: nextPeriodMonth(year, last.periodStart),
                  title: 'Yeni dönem ekle',
                })
              }
            >
              <Icon name="Plus" size={17} aria-hidden="true" />
              Yeni dönem
            </Button>
          ) : null}
        </div>
      </header>
      <div className="grid gap-6 px-6 pb-6 max-[650px]:px-4">
        <p role="note" className="rounded-lg border p-3 text-sm">
          {PAYROLL_PARAMETERS_NOTE}
        </p>
        {table.error ? (
          <QueryError error={table.error} onRetry={() => void table.refetch()} />
        ) : table.isPending ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {year} yılı için bordro parametresi tanımlı değil.
          </p>
        ) : (
          periods.map((period) => (
            <PeriodBlock
              key={`${period.id}-${period.periodStart}`}
              period={period}
              canManage={canManage}
              onCopy={() =>
                setEditing({
                  mode: 'create',
                  values: valuesOf(period),
                  month: period.effectiveFrom.slice(0, 7),
                  title: 'Kurum kopyası oluştur',
                })
              }
              onEdit={() => setEditing({ mode: 'update', period })}
              onArchive={() => setArchiving(period)}
            />
          ))
        )}
      </div>
      {editing ? <PayrollSetModal editing={editing} onClose={() => setEditing(null)} /> : null}
      {archiving ? <ArchiveModal period={archiving} onClose={() => setArchiving(null)} /> : null}
    </section>
  )
}

function PeriodBlock({
  period,
  canManage,
  onCopy,
  onEdit,
  onArchive,
}: {
  period: PayrollParameterPeriodView
  canManage: boolean
  onCopy: () => void
  onEdit: () => void
  onArchive: () => void
}) {
  const label = payrollPeriodLabel(period)
  const headingId = `bordro-donem-${period.periodStart}`
  const rows = payrollParameterRows({
    values: valuesOf(period),
    derived: period.derived,
    unverifiedFields: period.unverifiedFields,
  })
  return (
    <section aria-labelledby={headingId} className="grid gap-3 border-t pt-4 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h3 id={headingId} className="font-semibold">
            {label}
          </h3>
          <div className="flex flex-wrap gap-2">
            <StatusBadge
              text={period.origin === 'platform' ? 'Platform varsayılanı' : 'Kurum değeri'}
              tone={period.origin === 'platform' ? 'gray' : 'purple'}
            />
            {period.carriedOver ? (
              <StatusBadge
                text={`${payrollDayLabel(period.effectiveFrom)} setinden sürüyor`}
                tone="amber"
              />
            ) : null}
          </div>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {period.origin === 'platform' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={onCopy}
                aria-label={`${label} kurum kopyası`}
              >
                Kurum kopyası oluştur
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onEdit}
                  aria-label={`${label} düzelt`}
                >
                  Düzelt
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onArchive}
                  aria-label={`${label} arşivle`}
                >
                  Arşivle
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Table>
          <TableCaption className="sr-only">{`${label} parametreleri`}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Parametre</TableHead>
              <TableHead scope="col">Değer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableHead scope="row" className="font-normal">
                  {row.label}
                  {row.derived ? (
                    <span className="block text-xs text-muted-foreground">Hesaplanır</span>
                  ) : null}
                </TableHead>
                <TableCell>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {row.value}
                    {row.unverified ? <StatusBadge text="Doğrulanmalı" tone="amber" /> : null}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="grid content-start gap-3">
          <Table>
            <TableCaption className="sr-only">{`${label} gelir vergisi dilimleri`}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Yıllık matrah</TableHead>
                <TableHead scope="col">
                  Oran
                  {period.unverifiedFields.includes('incomeTaxBrackets') ? (
                    <StatusBadge text="Doğrulanmalı" tone="amber" className="ml-2" />
                  ) : null}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incomeTaxBracketRows(period.incomeTaxBrackets).map(([range, rate]) => (
                <TableRow key={range}>
                  <TableCell>{range}</TableCell>
                  <TableCell>{rate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-sm text-muted-foreground">Kaynak: {period.source}</p>
        </div>
      </div>
    </section>
  )
}

const FORM_ID = 'bordro-parametre-formu'
const PERCENT_FIELDS = [
  ['sgkEmployee', 'SGK işçi payı (%)'],
  ['sgkEmployer', 'SGK işveren payı (%)'],
  ['sgkIncentive', 'İşveren prim indirimi (puan)'],
  ['unemploymentEmployee', 'İşsizlik işçi payı (%)'],
  ['unemploymentEmployer', 'İşsizlik işveren payı (%)'],
  ['floorMultiplier', 'SGK taban çarpanı (kat)'],
  ['ceilingMultiplier', 'SGK tavan çarpanı (kat)'],
  ['stampTax', 'Damga vergisi (binde)'],
] as const

function PayrollSetModal({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const create = useCreatePayrollParameterSet()
  const update = useUpdatePayrollParameterSet()
  const isUpdate = editing.mode === 'update'
  const form = useForm<PayrollFormValues>({
    resolver: zodResolver(payrollFormSchema),
    defaultValues:
      editing.mode === 'update'
        ? payrollFormDefaults(valuesOf(editing.period))
        : payrollFormDefaults(editing.values, editing.month),
  })
  const brackets = useFieldArray({ control: form.control, name: 'brackets' })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const target = payrollFormPath(name)
      if (target === null) form.setError('root.server', error)
      // Yol `payrollFormPath`'ten gelir; form alanlarından biridir.
      else form.setError(target as 'source', error, { shouldFocus: true })
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const body = payrollBody(values)
    const outcome =
      editing.mode === 'update'
        ? await update.submit(
            { setId: editing.period.id, version: editing.period.version ?? 0, body },
            fields,
          )
        : await create.submit(body, fields)
    if (outcome.status === 'success') {
      notify.success(isUpdate ? 'Parametre seti düzeltildi.' : 'Parametre seti kaydedildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  const bracketError = errors.brackets?.root?.message ?? errors.brackets?.message
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={isUpdate ? 'Parametre setini düzelt' : editing.title}
      description="Kurumun değeri aynı başlangıçlı platform değerinin yerini alır; arşivlenince platform değeri geri gelir."
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
        aria-label="Bordro parametre seti"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="bordro-ay"
            label="Yürürlük ayı"
            description="Set seçilen ayın ilk gününden itibaren geçerlidir."
            error={errors.effectiveMonth}
          >
            {(control) => (
              <Input
                {...control}
                type="month"
                {...form.register('effectiveMonth')}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField
            id="bordro-asgari"
            label="Brüt asgari ücret (₺)"
            error={errors.minimumWageGross}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                autoComplete="off"
                {...form.register('minimumWageGross')}
                disabled={busy}
              />
            )}
          </FormField>
          {PERCENT_FIELDS.map(([name, label]) => (
            <FormField key={name} id={`bordro-${name}`} label={label} error={errors[name]}>
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  autoComplete="off"
                  {...form.register(name)}
                  disabled={busy}
                />
              )}
            </FormField>
          ))}
          <FormField
            id="bordro-gv-istisna"
            label="Asgari ücret gelir vergisi istisnası"
            error={errors.incomeTaxExempt}
          >
            {(control) => (
              <NativeSelect {...control} {...form.register('incomeTaxExempt')} disabled={busy}>
                <NativeSelectOption value="yes">Uygulanır</NativeSelectOption>
                <NativeSelectOption value="no">Uygulanmaz</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="bordro-dv-istisna"
            label="Asgari ücret damga vergisi istisnası"
            error={errors.stampTaxExempt}
          >
            {(control) => (
              <NativeSelect {...control} {...form.register('stampTaxExempt')} disabled={busy}>
                <NativeSelectOption value="yes">Uygulanır</NativeSelectOption>
                <NativeSelectOption value="no">Uygulanmaz</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="bordro-kidem"
            label="Kıdem tazminatı tavanı (₺)"
            error={errors.severanceCeiling}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                autoComplete="off"
                {...form.register('severanceCeiling')}
                disabled={busy}
              />
            )}
          </FormField>
        </div>
        <fieldset className="grid gap-3">
          <legend className="text-sm font-medium">Gelir vergisi dilimleri</legend>
          <p className="text-sm text-muted-foreground">
            İlk dilim 0 ₺'den başlar; alt sınırlar ve oranlar artan sırada olmalıdır.
          </p>
          {brackets.fields.map((field, index) => (
            <div key={field.id} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <FormField
                id={`bordro-dilim-${String(index)}-alt`}
                label={`${String(index + 1)}. dilim alt sınırı (₺)`}
                error={errors.brackets?.[index]?.lowerBound}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    autoComplete="off"
                    {...form.register(`brackets.${index}.lowerBound`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField
                id={`bordro-dilim-${String(index)}-oran`}
                label={`${String(index + 1)}. dilim oranı (%)`}
                error={errors.brackets?.[index]?.rate}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    autoComplete="off"
                    {...form.register(`brackets.${index}.rate`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <Button
                type="button"
                variant="secondary"
                onClick={() => brackets.remove(index)}
                disabled={busy || brackets.fields.length <= 1}
                aria-label={`${String(index + 1)}. dilimi kaldır`}
              >
                <Icon name="Trash2" size={17} aria-hidden="true" />
              </Button>
            </div>
          ))}
          {bracketError ? (
            <p role="alert" className="text-sm text-danger">
              {bracketError}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => brackets.append({ lowerBound: '', rate: '' })}
              disabled={busy || brackets.fields.length >= 10}
            >
              <Icon name="Plus" size={17} aria-hidden="true" />
              Dilim ekle
            </Button>
          </div>
        </fieldset>
        <FormField
          id="bordro-kaynak"
          label="Kaynak"
          description="Resmî Gazete, GİB tarifesi, SGK duyurusu ya da mali müşavir yazısı."
          error={errors.source}
        >
          {(control) => <Input {...control} {...form.register('source')} disabled={busy} />}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

function ArchiveModal({
  period,
  onClose,
}: {
  period: PayrollParameterPeriodView
  onClose: () => void
}) {
  const archive = useArchivePayrollParameterSet()
  async function confirm() {
    const outcome = await archive.submit({ setId: period.id, version: period.version ?? 0 })
    if (outcome.status === 'success') {
      notify.success('Parametre seti arşivlendi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Parametre setini arşivle"
      description="Arşivlenen kurum seti hesaba girmez; aynı başlangıçlı platform değeri varsa yeniden geçerli olur."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={archive.isPending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={archive.isPending}
            aria-busy={archive.isPending || undefined}
          >
            Arşivle
          </Button>
        </>
      }
    >
      <p className="text-sm">{`${payrollDayLabel(period.effectiveFrom)} başlangıçlı set`}</p>
    </Modal>
  )
}
