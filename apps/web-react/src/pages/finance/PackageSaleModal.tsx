import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useState } from 'react'
import { flushSync } from 'react-dom'
import { useForm, useWatch } from 'react-hook-form'
import { useEffectiveFeeTariff } from '@kampus/react-shared/use-fee-tariffs.ts'
import {
  useLessonPackages,
  useQuotePackageSale,
  useSellPackage,
} from '@kampus/react-shared/use-finance-packages.ts'
import { DISCOUNT_LINE_LABELS, FEE_ITEM_KIND_LABELS } from '@kampus/school-core/lib/fee-tariffs.ts'
import { PACKAGE_KIND_LABELS } from '@kampus/school-core/lib/finance-packages.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import {
  contractPaymentTermLabel,
  defaultInstallmentCount,
} from '@kampus/school-core/lib/payment-terms.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  availableDiscounts,
  availableExtras,
  installmentOptions,
  saleDefaults,
  saleFormField,
  saleFormSchema,
  saleQuoteBody,
  type SaleFormValues,
  type SaleTariff,
} from './package-forms.ts'

const FORM_ID = 'paket-satis-formu'
const TITLE = 'Paket sat'
const OPTION_PAGE_SIZE = 100
const TARIFF_PAGE_SIZE = 100

type Option = { id: string; label: string }
type Props = {
  canApproveCapException: boolean
  academicYear: number
  onClose: () => void
  onSold: (saleId: string) => void
}

/**
 * Paket satışı (yönetici ve ön büro; IST-078, K-07, DOM-DIL-050, DOM-FIN-002). Tutar girilmez: önce
 * sunucu önizlemesi gösterilir, onay aynı gövdeyi önizlenen tarifeyle yazar; tarife arada değiştiyse
 * sunucu reddeder, form yeniden açılır. Pakette burs seçeneği yoktur (K-19).
 */
export function PackageSaleModal({ canApproveCapException, academicYear, onClose, onSold }: Props) {
  const students = useCoreAll('students')
  const packages = useLessonPackages({ page: 1, pageSize: OPTION_PAGE_SIZE })
  const effective = useEffectiveFeeTariff({
    academicYear,
    institutionType: 'language_school',
    pageSize: TARIFF_PAGE_SIZE,
  })
  const shell = (children: React.ReactNode) => (
    <Modal open size="wide" onOpenChange={(open) => (open ? undefined : onClose())} title={TITLE}>
      {children}
    </Modal>
  )
  if (students.error)
    return shell(<QueryError error={students.error} onRetry={() => void students.refetch()} />)
  if (packages.error)
    return shell(<QueryError error={packages.error} onRetry={() => void packages.refetch()} />)
  if (effective.error)
    return shell(<QueryError error={effective.error} onRetry={effective.refetch} />)
  if (!students.data || !packages.data || effective.isPending) return shell(<SummaryLoading />)
  if (effective.tariff === null)
    return shell(
      <EmptyState
        title="Yayımlanmış ücret tarifesi yok."
        description="Bu eğitim yılı için tarife yayımlanmadan paket satılamaz."
      />,
    )
  if (packages.data.data.length === 0)
    return shell(
      <EmptyState
        title="Tanımlı paket yok."
        description="Satıştan önce yönetici paket tanımlamalıdır."
      />,
    )
  return (
    <SaleForm
      tariff={effective.tariff}
      canApproveCapException={canApproveCapException}
      students={students.data
        .filter((row) => row.record.isActive !== false)
        .map((row) => ({ id: row.id, label: row.record.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'tr'))}
      packages={packages.data.data.map((item) => ({
        id: item.id,
        label: `${item.name} · ${PACKAGE_KIND_LABELS[item.kind]}`,
      }))}
      onClose={onClose}
      onSold={onSold}
    />
  )
}

function SaleForm({
  tariff,
  canApproveCapException,
  students,
  packages,
  onClose,
  onSold,
}: Omit<Props, 'academicYear'> & { tariff: SaleTariff; students: Option[]; packages: Option[] }) {
  const quote = useQuotePackageSale()
  const sell = useSellPackage()
  const [today] = useState(() => dayKey())
  const form = useForm<SaleFormValues>({
    resolver: zodResolver(saleFormSchema),
    defaultValues: saleDefaults(today, defaultInstallmentCount(tariff.paymentTerms)),
  })
  const [preview, setPreview] = useState<{
    price: PriceView
    body: ReturnType<typeof saleQuoteBody>
    firstDueDate: string
  } | null>(null)
  const count = useWatch({ control: form.control, name: 'installmentCount' })
  const discounts = availableDiscounts(tariff, Number(count), canApproveCapException)
  const extras = availableExtras(tariff)
  const busy = quote.isPending || sell.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => node?.focus(), [])
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = saleFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }

  const onPreview = form.handleSubmit(async (values) => {
    const body = saleQuoteBody(
      values,
      discounts.map((option) => option.value),
    )
    const outcome = await quote.submit(body, fields)
    if (outcome.status === 'success')
      setPreview({ price: outcome.data.data, body, firstDueDate: values.firstDueDate })
  })

  function edit() {
    // Form yeniden görünmeden odak verilemez.
    flushSync(() => setPreview(null))
    form.setFocus('studentId')
  }

  async function confirm() {
    if (!preview) return
    const outcome = await sell.submit(
      { ...preview.body, tariffId: preview.price.tariffId, firstDueDate: preview.firstDueDate },
      fields,
    )
    if (outcome.status === 'success') {
      notify.success('Paket satışı kaydedildi. Sözleşme onay bekliyor.')
      onSold(outcome.data.data.id)
    } else if (outcome.status === 'failed') setPreview(null)
  }

  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={TITLE}
      description="Önce ücret gösterilir; onaydan önce hiçbir kayıt yazılmaz."
      footer={
        preview ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={edit}>
              Bilgileri düzenle
            </Button>
            <Button disabled={busy} aria-busy={busy || undefined} onClick={() => void confirm()}>
              Satışı onayla
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Vazgeç
            </Button>
            <Button type="submit" form={FORM_ID} disabled={busy} aria-busy={busy || undefined}>
              Ücreti göster
            </Button>
          </>
        )
      }
    >
      <form
        id={FORM_ID}
        noValidate
        hidden={preview !== null}
        aria-label={TITLE}
        onSubmit={(event) => void onPreview(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1 [&[hidden]]:hidden"
      >
        <FormField id="satis-ogrenci" label="Öğrenci" error={errors.studentId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('studentId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Öğrenci seçin</NativeSelectOption>
              {students.map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="satis-paket" label="Paket" error={errors.packageId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('packageId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Paket seçin</NativeSelectOption>
              {packages.map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="satis-taksit" label="Taksit sayısı" error={errors.installmentCount}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('installmentCount')}
              className="w-full"
              disabled={busy}
            >
              {installmentOptions(tariff.paymentTerms).map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="satis-vade" label="İlk vade" error={errors.firstDueDate}>
          {(control) => (
            <Input
              {...control}
              {...form.register('firstDueDate')}
              type="date"
              min={today}
              disabled={busy}
            />
          )}
        </FormField>
        {discounts.length > 0 ? (
          <fieldset className="grid content-start gap-2 text-sm">
            <legend className="mb-1 font-medium">İlan edilen indirimler</legend>
            {discounts.map((option) => (
              <label key={option.value} className="flex min-h-6 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  value={option.value}
                  disabled={busy}
                  {...form.register('discounts')}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        ) : null}
        {extras.length > 0 ? (
          <fieldset className="grid content-start gap-2 text-sm">
            <legend className="mb-1 font-medium">Talep edilen ek kalemler</legend>
            {extras.map((option) => (
              <label key={option.value} className="flex min-h-6 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  value={option.value}
                  disabled={busy}
                  {...form.register('extras')}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
      {preview ? (
        <SaleQuote
          price={preview.price}
          firstDueDate={preview.firstDueDate}
          studentName={students.find((item) => item.id === preview.body.studentId)?.label ?? '—'}
          packageName={packages.find((item) => item.id === preview.body.packageId)?.label ?? '—'}
          focusRef={focusHeading}
        />
      ) : null}
    </Modal>
  )
}

/** `POST /finance/package-sales/quote` yanıtının ekranda okunan alanları. */
type PriceView = {
  tariffId: string
  purchasedHours: number
  announcedHourlyCents: number
  hourlyCents: number
  announcedCents: number
  discounts: readonly { kind: string; amountCents: number }[]
  netCents: number
  extras: readonly { kind: string; amountCents: number }[]
  installments: readonly number[]
  paymentTerm: Parameters<typeof contractPaymentTermLabel>[0] | null
  expiresDate: string | null
}

function SaleQuote({
  price,
  firstDueDate,
  studentName,
  packageName,
  focusRef,
}: {
  price: PriceView
  firstDueDate: string
  studentName: string
  packageName: string
  focusRef: (node: HTMLHeadingElement | null) => void
}) {
  const line = (label: string, value: string, strong = false) => (
    <div
      key={label}
      className={`flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5 ${strong ? 'font-semibold' : ''}`}
    >
      <dt className={strong ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
  return (
    <div className="grid gap-4">
      <h3 ref={focusRef} tabIndex={-1} className="font-semibold outline-none">
        Ücret önizlemesi
      </h3>
      <dl aria-label="Ücret önizlemesi" className="divide-y text-sm">
        {line('Öğrenci', studentName)}
        {line('Paket', packageName)}
        {line('Ders saati', `${String(price.purchasedHours)} saat`)}
        {line('İlan edilen saat ücreti', money(price.announcedHourlyCents))}
        {price.hourlyCents === price.announcedHourlyCents
          ? null
          : line('Uygulanan saat ücreti', money(price.hourlyCents))}
        {line('İlan ücreti', money(price.announcedCents))}
        {price.discounts.map((item) =>
          line(
            `${DISCOUNT_LINE_LABELS[item.kind as keyof typeof DISCOUNT_LINE_LABELS] ?? 'Diğer'} indirimi`,
            `− ${money(item.amountCents)}`,
          ),
        )}
        {line('Öğrenim ücreti', money(price.netCents), true)}
        {price.extras.map((item) =>
          line(
            FEE_ITEM_KIND_LABELS[item.kind as keyof typeof FEE_ITEM_KIND_LABELS] ?? 'Ek kalem',
            money(item.amountCents),
          ),
        )}
        {price.paymentTerm
          ? line('Ödeme koşulu', contractPaymentTermLabel(price.paymentTerm))
          : null}
        {line('İlk vade', dateLabel(firstDueDate, { year: 'numeric' }))}
        {line(
          'Son kullanma',
          price.expiresDate ? dateLabel(price.expiresDate, { year: 'numeric' }) : 'Süresiz',
        )}
      </dl>
      <div>
        <h4 className="mb-1 text-sm font-medium">Öğrenim taksitleri</h4>
        <ol className="divide-y text-sm">
          {price.installments.map((amount, index) => {
            const installment = index + 1
            return (
              <li key={installment} className="flex flex-wrap justify-between gap-x-4 py-1.5">
                <span className="text-muted-foreground">{installment}. taksit</span>
                <span>{money(amount)}</span>
              </li>
            )
          })}
        </ol>
      </div>
      <p className="text-sm text-muted-foreground">
        Onaylayınca sözleşme ve taksitler açılır; sözleşme ödeyicinin onayını bekler.
      </p>
    </div>
  )
}
