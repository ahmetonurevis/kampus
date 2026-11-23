import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { isApiError } from '@kampus/api-client/errors.ts'
import { usePayRateStaff } from '@kampus/react-shared/use-finance-pay-rates.ts'
import {
  useSeveranceEstimate,
  useSeverancePaySuggestion,
  type SeveranceEstimateResult,
  type SeverancePaySuggestionResult,
} from '@kampus/react-shared/use-finance-severance.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  BENEFIT_FORM_LABELS,
  PAY_RATE_TYPE_LABELS,
  SEVERANCE_SUGGESTION_WARNINGS,
} from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  SEVERANCE_ESTIMATE_NOTE,
  SEVERANCE_EXIT_REASON_INFO,
  SEVERANCE_EXIT_REASONS,
  severanceBreakdownRows,
  severanceFacts,
  severanceNotes,
} from '@kampus/school-core/lib/finance-severance.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
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
import { useSeverancePdf, type SeverancePdfSource } from '@/hooks/use-finance-severance-pdf.ts'
import { SEVERANCE_ESTIMATE_TITLE } from '@/lib/pdf/templates/finance-severance.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import { roleLabel } from './finance-fixed-asset-assignment-forms.ts'
import {
  severanceBody,
  severanceDefaults,
  severanceFormField,
  severanceFormSchema,
  severanceSuggestionFields,
  type SeveranceFormValues,
} from './finance-severance-form.ts'

/** Personel seçimi: ilk 100 personel ada göre (maskeli liste, denetime düşmez). */
const STAFF_PAGE_SIZE = 100

const dayText = (day: string) =>
  dateLabel(`${day}T09:00:00.000Z`, { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Kıdem ve ihbar hesaplayıcı (ON-205, ON-341; DOM-FIN-094): Finans "Kıdem/ihbar hesaplayıcı"
 * sekmesi, yalnız yönetici (K-272). Personel seçilirse çıkış günündeki ücret tanımı öneri olarak
 * forma dolar, kullanıcı değiştirebilir (K-345); tavan ve vergi oranları kurumun bordro
 * parametresindendir (K-344). Hesap saklanmaz; form, öneri ve sonuç yalnız bu ekranın durumundadır,
 * adrese yazılmaz (K-273).
 */
export function FinanceSeveranceSection() {
  const estimate = useSeveranceEstimate()
  const [result, setResult] = useState<SeverancePdfSource | null>(null)
  const form = useForm<SeveranceFormValues>({
    resolver: zodResolver(severanceFormSchema),
    defaultValues: severanceDefaults(dayKey()),
  })
  const errors = form.formState.errors
  const busy = estimate.isPending || form.formState.isSubmitting
  const membershipId = useWatch({ control: form.control, name: 'membershipId' })
  const endDate = useWatch({ control: form.control, name: 'endDate' })
  const suggestionDay = daySchema.safeParse(endDate).success ? endDate : ''
  const suggestion = useSeverancePaySuggestion(membershipId, suggestionDay)

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { data } = await estimate.mutateAsync(severanceBody(values))
      setResult({ calculationId: crypto.randomUUID(), estimate: data })
    } catch (error) {
      setResult(null)
      if (isApiError(error) && error.issues.length > 0) {
        for (const issue of error.issues) {
          const field = severanceFormField(issue.path.join('.'))
          if (field) form.setError(field, { message: issue.message }, { shouldFocus: true })
          else form.setError('root.server', { message: issue.message })
        }
        return
      }
      notify.error(
        isApiError(error) ? error.message : 'Hesap yapılamadı. Lütfen yeniden deneyin.',
        error,
      )
    }
  })

  return (
    <section
      aria-labelledby="kidem-ihbar"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="kidem-ihbar" className="text-lg font-semibold">
          Kıdem/ihbar hesaplayıcı
        </h2>
        <p className="text-sm text-muted-foreground">
          Ayrılan çalışanın kıdem ve ihbar tazminatını tahmin edin. Personel seçerseniz çıkış
          günündeki ücret tanımı öneri olarak dolar; tavan ve vergi oranları kurumun bordro
          parametrelerinden alınır. Girdiler ve sonuç kaydedilmez.
        </p>
      </header>
      <div className="grid gap-6 px-6 pb-6">
        <p role="note" className="rounded-lg border p-3 text-sm">
          {SEVERANCE_ESTIMATE_NOTE}
        </p>
        <form
          noValidate
          aria-label="Kıdem ve ihbar hesabı"
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(event) => void onSubmit(event)}
        >
          <StaffPicker form={form} disabled={busy} />
          <SuggestionStatus
            selected={membershipId !== ''}
            dayMissing={suggestionDay === ''}
            loading={suggestion.isFetching}
            failed={suggestion.isError}
            data={suggestion.data?.data}
            form={form}
          />
          <FormField id="kidem-giris" label="İşe giriş günü" error={errors.startDate}>
            {(control) => (
              <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
            )}
          </FormField>
          <FormField id="kidem-cikis" label="Çıkış günü" error={errors.endDate}>
            {(control) => (
              <Input {...control} type="date" {...form.register('endDate')} disabled={busy} />
            )}
          </FormField>
          <FormField
            id="kidem-brut"
            label="Son aylık brüt ücret (₺)"
            error={errors.grossWage}
            description="Örnek: 45.000,00"
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                autoComplete="off"
                {...form.register('grossWage')}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField
            id="kidem-yan"
            label="Düzenli yan ödemeler (₺/ay, isteğe bağlı)"
            error={errors.regularBenefits}
            description="Yol, yemek, düzenli prim gibi aylık ödemelerin toplamı; giydirilmiş ücrete eklenir."
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                autoComplete="off"
                {...form.register('regularBenefits')}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField id="kidem-neden" label="Çıkış nedeni" error={errors.exitReason}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('exitReason')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Seçin</NativeSelectOption>
                {SEVERANCE_EXIT_REASONS.map((reason) => (
                  <NativeSelectOption key={reason} value={reason}>
                    {SEVERANCE_EXIT_REASON_INFO[reason].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="kidem-matrah"
            label="Kümülatif gelir vergisi matrahı (₺, isteğe bağlı)"
            error={errors.cumulativeTaxBase}
            description="Çıkış yılında bordroya girmiş matrah; boşsa ihbarda ilk dilim oranı kullanılır."
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                autoComplete="off"
                {...form.register('cumulativeTaxBase')}
                disabled={busy}
              />
            )}
          </FormField>
          <label className="flex min-h-11 items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              className="size-4"
              {...form.register('noticeGiven')}
              disabled={busy}
            />
            İhbar süresi verildi (ya da çalışılarak geçti)
          </label>
          <div className="md:col-span-2">
            <RootError message={errors.root?.server?.message} />
            <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
              Hesapla
            </Button>
          </div>
        </form>
        {result ? <SeveranceResult source={result} /> : null}
      </div>
    </section>
  )
}

/** Personel seçimi (isteğe bağlı): kurumun etkin ve ayrılmış personeli, ada göre. */
function StaffPicker({
  form,
  disabled,
}: {
  form: UseFormReturn<SeveranceFormValues>
  disabled: boolean
}) {
  const staff = usePayRateStaff({ page: 1, pageSize: STAFF_PAGE_SIZE })
  const rows = staff.data?.data ?? []
  const total = staff.data?.meta.total ?? 0
  return (
    <FormField
      id="kidem-personel"
      label="Personel (isteğe bağlı)"
      error={form.formState.errors.membershipId}
      description={
        total > STAFF_PAGE_SIZE
          ? `İlk ${String(STAFF_PAGE_SIZE)} personel listelenir; diğerleri için ücreti elle girin.`
          : 'Seçerseniz çıkış günündeki ücret tanımı öneri olarak dolar.'
      }
    >
      {(control) => (
        <NativeSelect
          {...control}
          {...form.register('membershipId')}
          className="w-full"
          disabled={disabled || staff.isPending}
        >
          <NativeSelectOption value="">Seçilmedi (ücreti elle gireceğim)</NativeSelectOption>
          {rows.map((row) => (
            <NativeSelectOption key={row.membershipId} value={row.membershipId}>
              {`${row.name} · ${roleLabel(row.role)}${row.active ? '' : ' (ayrıldı)'}`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}

/**
 * Öneri durumu ve forma doldurma (K-345). Yeni öneri geldiğinde (personel ya da çıkış günü
 * değişince) ücret alanları bir kez dolar; kullanıcının sonraki değişikliği ezilmez.
 */
function SuggestionStatus({
  selected,
  dayMissing,
  loading,
  failed,
  data,
  form,
}: {
  selected: boolean
  dayMissing: boolean
  loading: boolean
  failed: boolean
  data: SeverancePaySuggestionResult | undefined
  form: UseFormReturn<SeveranceFormValues>
}) {
  useEffect(() => {
    if (!selected || data === undefined) return
    const fields = severanceSuggestionFields(data)
    if (fields === null) return
    form.setValue('grossWage', fields.grossWage, { shouldDirty: true, shouldValidate: true })
    form.setValue('regularBenefits', fields.regularBenefits, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }, [data, form, selected])

  if (!selected) return null
  const message = dayMissing
    ? 'Öneri için çıkış gününü girin.'
    : loading
      ? 'Ücret önerisi okunuyor…'
      : failed
        ? 'Ücret önerisi okunamadı; ücreti elle girin.'
        : data === undefined
          ? null
          : suggestionText(data)
  if (message === null) return null
  const warning = data !== undefined && data.status !== 'suggested' && !loading
  return (
    <p
      role="status"
      aria-label="Ücret önerisi"
      className={`rounded-lg border p-3 text-sm md:col-span-2 ${warning || failed ? 'border-destructive' : ''}`}
    >
      {message}
    </p>
  )
}

function suggestionText(data: SeverancePaySuggestionResult): string {
  const warning = SEVERANCE_SUGGESTION_WARNINGS[data.status]
  if (warning !== null) return warning
  const wage = data.wage
  const included = data.benefits.filter((item) => item.included)
  const excluded = data.benefits.filter((item) => !item.included)
  const parts = [
    `Öneri dolduruldu: ${wage === null ? '' : PAY_RATE_TYPE_LABELS[wage.rateType]} ${money(data.grossWageCents ?? 0)}${wage === null ? '' : ` (${dayText(wage.startDate)} başlangıçlı tanım)`}`,
    included.length === 0
      ? 'nakdi yan hak yok'
      : `nakdi yan haklar ${money(data.regularBenefitsCents ?? 0)} (${included.map((item) => PAY_RATE_TYPE_LABELS[item.rateType]).join(', ')})`,
    ...(excluded.length === 0
      ? []
      : [
          `${excluded.map((item) => PAY_RATE_TYPE_LABELS[item.rateType]).join(', ')} ${BENEFIT_FORM_LABELS.in_kind.toLocaleLowerCase('tr-TR')} olduğu için hariç`,
        ]),
  ]
  return `${parts.join('; ')}. Tutarları değiştirebilirsiniz.`
}

const BREAKDOWN_COLUMNS = ['Kıdem', 'İhbar', 'Toplam'] as const

function SeveranceResult({ source }: { source: SeverancePdfSource }) {
  const estimate: SeveranceEstimateResult = source.estimate
  const notes = severanceNotes(estimate)
  return (
    <section aria-labelledby="kidem-sonuc" className="grid gap-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="kidem-sonuc" className="text-base font-semibold">
          Tahmini sonuç
        </h3>
        <PdfDialogButton
          label="PDF"
          accessibleName="Kıdem ve ihbar tahmini PDF"
          title={SEVERANCE_ESTIMATE_TITLE}
          id={source}
          usePdf={useSeverancePdf}
        />
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        {severanceFacts(estimate).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="[overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto">
        <Table>
          <TableCaption>Kıdem ve ihbar dökümü</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Kalem</TableHead>
              <TableHead scope="col" className="text-right">
                Kıdem
              </TableHead>
              <TableHead scope="col" className="text-right">
                İhbar
              </TableHead>
              <TableHead scope="col" className="text-right">
                Toplam
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {severanceBreakdownRows(estimate).map(([label, ...values]) => (
              <TableRow key={label}>
                <TableHead scope="row" className="font-medium">
                  {label}
                </TableHead>
                {BREAKDOWN_COLUMNS.map((column, index) => (
                  <TableCell key={column} className="text-right tabular-nums">
                    {values[index]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {notes.length > 0 ? (
        <ul aria-label="Hesap notları" className="grid list-disc gap-1 pl-5 text-sm">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
