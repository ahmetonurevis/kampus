import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { isApiError } from '@kampus/api-client/errors.ts'
import {
  useSeveranceEstimate,
  type SeveranceEstimateResult,
} from '@kampus/react-shared/use-finance-severance.ts'
import {
  SEVERANCE_ESTIMATE_NOTE,
  SEVERANCE_EXIT_REASON_INFO,
  SEVERANCE_EXIT_REASONS,
  severanceBreakdownRows,
  severanceFacts,
  severanceNotes,
} from '@kampus/school-core/lib/finance-severance.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
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
import {
  severanceBody,
  severanceDefaults,
  severanceFormField,
  severanceFormSchema,
  type SeveranceFormValues,
} from './finance-severance-form.ts'

/**
 * Kıdem ve ihbar hesaplayıcı (ON-205; DOM-FIN-094): Finans "Kıdem/ihbar hesaplayıcı" sekmesi, yalnız
 * yönetici (K-272). Girdiler elle yazılır; hesap sunucudadır ama hiçbir şey saklanmaz, form ve
 * sonuç yalnız bu ekranın durumundadır, adrese ve önbelleğe yazılmaz (K-273).
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
          Ayrılan çalışanın kıdem ve ihbar tazminatını elle girilen ücretle tahmin edin. Girdiler ve
          sonuç kaydedilmez.
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
