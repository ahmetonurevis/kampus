import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useArchivePayrollTaxCarryover,
  useCreatePayrollTaxCarryover,
  usePayrollCalculation,
  usePayrollCalculationExport,
  usePayrollTaxCarryovers,
  useSavePayrollRun,
  type PayrollCalcRow,
  type PayrollCalculation,
} from '@kampus/react-shared/use-finance-payroll-runs.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import {
  PAYROLL_CALC_NOTE,
  payrollCalculationFilename,
} from '@kampus/school-core/lib/finance-payroll-calc.ts'
import { payrollMonthLabel } from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { sgkRoleLabel } from '@kampus/school-core/lib/finance-sgk-preparation.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { RootError } from '../management/FormParts.tsx'
import {
  defaultPayrollMonth,
  PAYROLL_CARRYOVER_DEFAULTS,
  payrollCarryoverBody,
  payrollCarryoverField,
  payrollCarryoverFormSchema,
  payrollDetailSections,
  payrollWarningText,
  payrollWarningTone,
  validPayrollMonth,
  type PayrollCarryoverFormValues,
} from './finance-payroll-calc-forms.ts'

const BOM = '﻿'
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const momentText = (iso: string) =>
  dateLabel(iso, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * Bordro hesabı (DOM-FIN-115; ON-198): Finans "Bordro hesabı" sekmesi, yalnız yönetici. Kampüs
 * bordroyu kendisi hesaplar (ON-193, ADR 0011). Ay seçilir; satırlar canlı hesaptır, "Hesabı
 * kaydet" ayı kaydeder (kümülatif matraha girer), onaylı ayda kaydetme kapalıdır. Satır panelinde
 * hesabın ayrıntısı ve kümülatif matrah devri vardır. Her görüntüleme ve CSV denetime düşer.
 */
export function FinancePayrollCalculationSection() {
  const [monthInput, setMonthInput] = useState(() => defaultPayrollMonth(dayKey()))
  const month = validPayrollMonth(monthInput)
  const calculation = usePayrollCalculation(month)
  const exporter = usePayrollCalculationExport()
  const save = useSavePayrollRun()
  const [reauth, setReauth] = useState<{ saved: boolean } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const data = month === null ? undefined : calculation.data?.data
  const selectedRow = data?.rows.find((row) => row.membershipId === selected) ?? null

  async function download(saved: boolean) {
    if (month === null) return
    const outcome = await exporter.submit({ month, saved })
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE)
      setReauth({ saved })
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      payrollCalculationFilename(month, saved),
    )
    notify.success('Dosya indirildi.')
  }

  async function saveRun() {
    if (month === null || data === undefined) return
    const outcome = await save.submit({ month, previousRunId: data.saved?.id ?? null })
    if (outcome.status === 'success')
      notify.success(
        data.saved === null ? 'Bordro hesabı kaydedildi.' : 'Bordro yeniden hesaplandı.',
      )
  }

  return (
    <section
      aria-labelledby="bordro-hesabi"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-3 px-6 pt-6 pb-4 max-[650px]:px-4">
        <div className="grid gap-1">
          <h2 id="bordro-hesabi" className="text-lg font-semibold">
            Bordro hesabı
          </h2>
          <p className="text-sm text-muted-foreground">{PAYROLL_CALC_NOTE}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <FormField
            id="bordro-ay"
            label="Ay"
            error={month === null ? { message: 'Geçerli bir ay seçin.' } : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="month"
                value={monthInput}
                onChange={(event) => {
                  setMonthInput(event.target.value)
                  setSelected(null)
                }}
                className="w-48"
              />
            )}
          </FormField>
          <Button
            type="button"
            disabled={
              data === undefined || data.locked || data.totals.completeCount === 0 || save.isPending
            }
            aria-busy={save.isPending || undefined}
            onClick={() => void saveRun()}
          >
            <Icon name="Calculator" size={16} aria-hidden="true" />
            {data?.saved ? 'Yeniden hesapla ve kaydet' : 'Hesabı kaydet'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={month === null || exporter.isPending}
            onClick={() => void download(false)}
          >
            <Icon name="Download" size={16} aria-hidden="true" />
            CSV indir
          </Button>
          {data?.saved ? (
            <Button
              type="button"
              variant="secondary"
              disabled={exporter.isPending}
              onClick={() => void download(true)}
            >
              <Icon name="Download" size={16} aria-hidden="true" />
              Kayıtlı hesabı indir
            </Button>
          ) : null}
        </div>
      </header>
      <div className="grid gap-4 px-6 pb-6 max-[650px]:px-4">
        {month !== null && calculation.error ? (
          <QueryError error={calculation.error} onRetry={() => void calculation.refetch()} />
        ) : null}
        {month !== null && calculation.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Bordro hesaplanıyor…
          </p>
        ) : null}
        {data ? <CalculationBody data={data} onOpen={setSelected} /> : null}
      </div>
      <SidePanel
        open={selectedRow !== null}
        onOpenChange={(open) => (open ? undefined : setSelected(null))}
        title="Bordro ayrıntısı"
      >
        {selectedRow && data ? <RowPanel row={selectedRow} month={data.month} /> : null}
      </SidePanel>
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(null)}
          onDone={() => {
            const saved = reauth.saved
            setReauth(null)
            void download(saved)
          }}
        />
      ) : null}
    </section>
  )
}

function CalculationBody({
  data,
  onOpen,
}: {
  data: PayrollCalculation
  onOpen: (id: string) => void
}) {
  const { parameters, totals, saved } = data
  const stats = useMemo(
    () => [
      {
        label: 'Personel',
        value: String(totals.staffCount),
        ...(totals.incompleteCount > 0
          ? { note: `${String(totals.incompleteCount)} satır hesaplanamadı` }
          : {}),
      },
      { label: 'Brüt toplam', value: money(totals.grossCents) },
      { label: 'Ödenecek net', value: money(totals.payableCents) },
      {
        label: 'Gelir + damga vergisi',
        value: money(totals.incomeTaxPayableCents + totals.stampTaxPayableCents),
      },
      { label: 'İşveren maliyeti', value: money(totals.employerCostCents) },
    ],
    [totals],
  )
  return (
    <>
      <p className="text-sm">
        Parametre: {dayText(parameters.effectiveFrom)}{' '}
        {parameters.origin === 'institution' ? 'kurum' : 'platform'} seti, brüt asgari ücret{' '}
        {money(parameters.minimumWageGrossCents)}.
        {parameters.unverified ? ' Platform değerleri doğrulanmalı.' : ''}
        {parameters.stale ? ' Bu yıl için parametre seti yok; son bilinen set kullanıldı.' : ''}
      </p>
      <p role="status" className="text-sm">
        {data.locked ? 'Ay onaylandı (kilitli); hesap değiştirilemez. ' : ''}
        {saved === null
          ? 'Bu ayın kayıtlı hesabı yok.'
          : `Kayıtlı hesap ${String(saved.revision)}. revizyon, ${momentText(saved.calculatedAt)}${saved.calculatedByName ? ` · ${saved.calculatedByName}` : ''}; ödenecek net ${money(saved.payableTotalCents)}.`}
      </p>
      <StatGrid label={`${payrollMonthLabel(data.month)} bordro özeti`} items={stats} />
      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Bu ay ücret tanımı olan personel yok. Ücretler &quot;Ücret tanımları&quot; sekmesinde
          girilir.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption>{`${payrollMonthLabel(data.month)} bordro hesabı`}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Personel</TableHead>
                <TableHead scope="col" className="text-right">
                  Prim günü
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Brüt
                </TableHead>
                <TableHead scope="col" className="text-right">
                  SGK + işsizlik
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Vergiler
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Net
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Kesinti
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Ödenecek
                </TableHead>
                <TableHead scope="col" className="text-right">
                  İşveren maliyeti
                </TableHead>
                <TableHead scope="col">Uyarılar</TableHead>
                <TableHead scope="col">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.membershipId}>
                  <TableCell>
                    <span className="font-medium">{row.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {sgkRoleLabel(row.role)}
                      {row.active ? '' : ' · pasif'}
                      {row.complete ? '' : ' · hesaplanamadı'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.primDays}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.grossCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(row.sgkEmployeeCents + row.unemploymentEmployeeCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(row.incomeTaxPayableCents + row.stampTaxPayableCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.netCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(row.deductionCents)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(row.payableCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(row.employerCostCents)}
                  </TableCell>
                  <TableCell>
                    {row.warnings.length === 0 ? (
                      <span className="text-sm text-muted-foreground">Yok</span>
                    ) : (
                      <ul aria-label={`${row.name} uyarıları`} className="flex flex-wrap gap-1">
                        {row.warnings.map((code) => (
                          <li key={code}>
                            <StatusBadge
                              text={payrollWarningText(code)}
                              tone={payrollWarningTone(code)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`${row.name} bordro ayrıntısı`}
                      onClick={() => onOpen(row.membershipId)}
                    >
                      Ayrıntı
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}

function RowPanel({ row, month }: { row: PayrollCalcRow; month: string }) {
  const year = Number(month.slice(0, 4))
  const carryovers = usePayrollTaxCarryovers(year)
  const remove = useArchivePayrollTaxCarryover()
  const own = carryovers.data?.data.find((item) => item.membershipId === row.membershipId) ?? null
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{row.name}</h3>
        <p className="text-sm text-muted-foreground">
          {payrollMonthLabel(month)} · {row.primDays} prim günü
          {row.netTargetCents === null ? '' : ` · net tanımlı ücret ${money(row.netTargetCents)}`}
        </p>
      </div>
      {payrollDetailSections(row).map((section) => (
        <section key={section.title} aria-label={section.title} className="grid gap-1">
          <h4 className="text-sm font-semibold">{section.title}</h4>
          <dl className="grid gap-1 text-sm">
            {section.rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b py-1 last:border-b-0">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <section aria-labelledby="bordro-devir" className="grid gap-2">
        <h4 id="bordro-devir" className="text-sm font-semibold">
          {`${String(year)} kümülatif matrah devri`}
        </h4>
        <p className="text-sm text-muted-foreground">
          Yıl içinde başka işyerinden gelen personelin önceki kümülatif gelir vergisi matrahı.
          Kayıtlı hesaplar kendiliğinden değişmez; ilgili ayları yeniden hesaplayın.
        </p>
        {carryovers.error ? (
          <QueryError error={carryovers.error} onRetry={() => void carryovers.refetch()} />
        ) : null}
        {own === null ? (
          carryovers.isPending ? null : (
            <CarryoverForm membershipId={row.membershipId} year={year} />
          )
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border px-3 py-2 text-sm">
            <span>
              Devralınan matrah {money(own.incomeTaxBaseCents)}
              {own.note ? <span className="block text-muted-foreground">{own.note}</span> : null}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={remove.isPending}
              onClick={() =>
                void remove
                  .submit({ carryoverId: own.id, version: own.version })
                  .then((outcome) => {
                    if (outcome.status === 'success') notify.success('Matrah devri kaldırıldı.')
                  })
              }
            >
              Devri kaldır
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

function CarryoverForm({ membershipId, year }: { membershipId: string; year: number }) {
  const create = useCreatePayrollTaxCarryover()
  const form = useForm<PayrollCarryoverFormValues>({
    resolver: zodResolver(payrollCarryoverFormSchema),
    defaultValues: PAYROLL_CARRYOVER_DEFAULTS,
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(payrollCarryoverBody(membershipId, year, values), {
      setError: (name, error) => {
        const field = payrollCarryoverField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('Matrah devri kaydedildi.')
    form.reset(PAYROLL_CARRYOVER_DEFAULTS)
  })
  return (
    <form
      noValidate
      aria-label="Matrah devri ekle"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="bordro-devir-tutar" label="Devralınan matrah (₺)" error={errors.amount}>
        {(control) => (
          <Input
            {...control}
            inputMode="decimal"
            autoComplete="off"
            {...form.register('amount')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="bordro-devir-not" label="Kaynak notu (isteğe bağlı)" error={errors.note}>
        {(control) => <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />}
      </FormField>
      <div>
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Devri kaydet
        </Button>
      </div>
    </form>
  )
}
