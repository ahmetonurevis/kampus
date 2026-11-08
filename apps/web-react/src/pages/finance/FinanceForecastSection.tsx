import { lazy, Suspense, useState, type FormEvent } from 'react'
import { academicYearName } from '@kampus/school-core/lib/academic-years.ts'
import {
  CASH_FLOW_DEFAULT_MONTHS,
  cashFlowForecastCsv,
  MONTHLY_EXPENSE_MAX_CENTS,
  revenueForecastCsv,
} from '@kampus/school-core/lib/finance-forecast.ts'
import { money, number } from '@kampus/school-core/lib/format.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import {
  useFinanceCashFlowForecast,
  useFinanceRevenueForecast,
} from '@kampus/react-shared/use-finance-forecasts.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { monthLabel } from '../dashboard/dashboard-model.ts'
import { cashFlowNotes, percentLabel, revenueNotes, revenueRows } from './finance-forecast-model.ts'

// recharts yalnız sekme açılınca yüklenir (rota parçası bütçesi).
const TrendBars = lazy(() => import('../dashboard/TrendBars.tsx'))

const BOM = '﻿'
const MONTH_OPTIONS = [3, 6, 12, 24] as const
const dash = '—'

function downloadCsv(csv: string, filename: string) {
  saveBlob(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }), filename)
  notify.success('Dosya indirildi.')
}

function Notes({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-4 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

/**
 * Gelir ve nakit akışı tahmini (ON-246, ON-247; DOM-FIN-063): Finans "Tahmin" sekmesi, yalnız yönetici.
 * Hesap ve varsayımlar sunucudadır; ekran yanıtı tablo, grafik ve CSV olarak gösterir. Rapor kayıt
 * değiştirmez, kişi verisi taşımaz; CSV bu yüzden tarayıcıda yanıttan üretilir.
 */
export function FinanceForecastSection({
  enrollmentYear,
  institutionType,
}: {
  enrollmentYear: number
  institutionType: InstitutionType
}) {
  return (
    <>
      <RevenueForecastPanel enrollmentYear={enrollmentYear} institutionType={institutionType} />
      <CashFlowForecastPanel />
    </>
  )
}

function RevenueForecastPanel({
  enrollmentYear,
  institutionType,
}: {
  enrollmentYear: number
  institutionType: InstitutionType
}) {
  const [year, setYear] = useState(enrollmentYear)
  const report = useFinanceRevenueForecast({ year })
  const data = report.data?.data
  const rows = data ? revenueRows(data, institutionType) : []
  const discountTotal = data ? data.contracts.discountCents + data.contracts.scholarshipCents : 0
  return (
    <section
      aria-labelledby="gelir-tahmini"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2 max-[650px]:px-4">
        <h2 id="gelir-tahmini" className="text-lg font-semibold">
          Gelir tahmini
        </h2>
        <p className="text-sm text-muted-foreground">
          Kesin gelir ile aday hunisinden beklenen gelir ayrı gösterilir; tahmin taahhüt değildir.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-sm font-medium">
            Eğitim yılı
            <NativeSelect
              value={String(year)}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {[enrollmentYear - 1, enrollmentYear, enrollmentYear + 1].map((option) => (
                <NativeSelectOption key={option} value={String(option)}>
                  {academicYearName(option)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button
            variant="outline"
            disabled={!data}
            onClick={() => {
              if (data)
                downloadCsv(
                  revenueForecastCsv(data, institutionType),
                  `gelir-tahmini-${String(year)}.csv`,
                )
            }}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
        </div>
      </header>
      {report.error ? (
        <div className="px-6 pb-6 max-[650px]:px-4">
          <QueryError error={report.error} onRetry={() => void report.refetch()} />
        </div>
      ) : null}
      {report.isPending ? (
        <p role="status" className="px-6 pb-6 text-sm text-muted-foreground max-[650px]:px-4">
          Tahmin yükleniyor…
        </p>
      ) : null}
      {data ? (
        <div className="px-6 pt-4 pb-6 max-[650px]:px-4">
          <StatGrid
            label="Gelir tahmini özeti"
            items={[
              {
                label: 'Kesin gelir',
                value: money(data.committed.totalCents),
                note: `${number(data.committed.students)} kayıt · ${number(data.committed.renewalStudents)} yenileme`,
              },
              {
                label: 'Huni beklentisi',
                value: data.pipeline ? money(data.pipeline.netCents) : dash,
                note: data.pipeline
                  ? `${number(data.pipeline.prospects)} açık aday`
                  : 'Hesaplanmadı',
              },
              { label: 'Beklenen toplam', value: money(data.expectedTotalCents) },
              {
                label: 'İndirim ve burs',
                value: money(discountTotal),
                note: `Liste fiyatı ${money(data.contracts.listCents)}`,
              },
            ]}
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kalem</TableHead>
                  <TableHead className="text-right">Aday</TableHead>
                  <TableHead className="text-right">Örneklem</TableHead>
                  <TableHead className="text-right">Dönüşüm oranı</TableHead>
                  <TableHead className="text-right">Brüt</TableHead>
                  <TableHead className="text-right">İndirim ve burs</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className={row.key === 'total' ? 'font-semibold' : undefined}>
                      {row.label}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.prospects === null ? dash : number(row.prospects)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.sampleSize === null ? dash : number(row.sampleSize)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.rateBasisPoints === null ? dash : percentLabel(row.rateBasisPoints)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.grossCents === null ? dash : money(row.grossCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.discountCents === null ? dash : money(row.discountCents)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${row.key === 'total' ? 'font-semibold' : ''}`}
                    >
                      {money(row.netCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Notes items={revenueNotes(data)} />
        </div>
      ) : null}
    </section>
  )
}

function CashFlowForecastPanel() {
  const [months, setMonths] = useState<number>(CASH_FLOW_DEFAULT_MONTHS)
  const [expenseText, setExpenseText] = useState('')
  const [expenseCents, setExpenseCents] = useState<number | null>(null)
  const [expenseError, setExpenseError] = useState<string | null>(null)
  const report = useFinanceCashFlowForecast({
    months,
    ...(expenseCents === null ? {} : { monthlyExpenseCents: expenseCents }),
  })
  const data = report.data?.data

  function applyExpense(event: FormEvent) {
    event.preventDefault()
    if (expenseText.trim() === '') {
      setExpenseCents(null)
      setExpenseError(null)
      return
    }
    const cents = parseAmountInput(expenseText, {
      allowZero: true,
      maxCents: MONTHLY_EXPENSE_MAX_CENTS,
    })
    if (cents === null) {
      setExpenseError('Geçerli bir tutar girin (ör. 250.000,00).')
      return
    }
    setExpenseError(null)
    setExpenseCents(cents)
  }

  const points = data?.months.map((month) => ({
    label: monthLabel(month.month),
    value: month.netCents,
  }))
  return (
    <section
      aria-labelledby="nakit-akisi-tahmini"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2 max-[650px]:px-4">
        <h2 id="nakit-akisi-tahmini" className="text-lg font-semibold">
          Nakit akışı tahmini
        </h2>
        <p className="text-sm text-muted-foreground">
          Taksit vadelerinden aylık beklenen tahsilat, ödenecek iade ve isteğe bağlı gider.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-sm font-medium">
            Dönem
            <NativeSelect
              value={String(months)}
              onChange={(event) => setMonths(Number(event.target.value))}
            >
              {MONTH_OPTIONS.map((option) => (
                <NativeSelectOption key={option} value={String(option)}>
                  {`${String(option)} ay`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <form className="flex flex-wrap items-end gap-2" onSubmit={applyExpense} noValidate>
            <label className="grid gap-1 text-sm font-medium">
              Aylık gider tahmini (₺, isteğe bağlı)
              <Input
                inputMode="decimal"
                value={expenseText}
                onChange={(event) => setExpenseText(event.target.value)}
                aria-invalid={expenseError !== null}
                aria-describedby={expenseError ? 'aylik-gider-hata' : undefined}
                className="w-48"
              />
            </label>
            <Button type="submit" variant="outline">
              Uygula
            </Button>
          </form>
          <Button
            variant="outline"
            disabled={!data}
            onClick={() => {
              if (data) downloadCsv(cashFlowForecastCsv(data), `nakit-akisi-${data.from}.csv`)
            }}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
        </div>
        {expenseError ? (
          <p id="aylik-gider-hata" role="alert" className="mt-1 text-sm text-danger">
            {expenseError}
          </p>
        ) : null}
      </header>
      {report.error ? (
        <div className="px-6 pb-6 max-[650px]:px-4">
          <QueryError error={report.error} onRetry={() => void report.refetch()} />
        </div>
      ) : null}
      {report.isPending ? (
        <p role="status" className="px-6 pb-6 text-sm text-muted-foreground max-[650px]:px-4">
          Tahmin yükleniyor…
        </p>
      ) : null}
      {data ? (
        <div className="px-6 pt-4 pb-6 max-[650px]:px-4">
          <StatGrid
            label="Nakit akışı özeti"
            items={[
              { label: 'Planlanan tahsilat', value: money(data.totals.scheduledCents) },
              {
                label: 'Beklenen giriş',
                value: money(
                  data.totals.expectedCollectionCents + data.totals.overdueRecoveryCents,
                ),
                note: `Tahsil riski ${money(data.totals.atRiskCents)}`,
              },
              { label: 'Ödenecek iade', value: money(data.totals.refundCents) },
              {
                label: 'Net akış',
                value: money(data.totals.netCents),
                note:
                  data.totals.expenseCents === null
                    ? 'Gider verisi yok'
                    : `Gider ${money(data.totals.expenseCents)}`,
              },
            ]}
          />
          <p className="mb-2 text-sm font-medium">Aylık net akış</p>
          <Suspense
            fallback={
              <div role="status" className="h-40 text-sm text-muted-foreground">
                Grafik yükleniyor…
              </div>
            }
          >
            <TrendBars
              points={points ?? []}
              formatTick={(value) => number(Math.round(value / 100))}
            />
          </Suspense>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ay</TableHead>
                  <TableHead className="text-right">Planlanan tahsilat</TableHead>
                  <TableHead className="text-right">Beklenen tahsilat</TableHead>
                  <TableHead className="text-right">Tahsil riski</TableHead>
                  <TableHead className="text-right">Gecikmişten beklenen</TableHead>
                  <TableHead className="text-right">Ödenecek iade</TableHead>
                  <TableHead className="text-right">Gider</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Kümülatif</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.months.map((month) => (
                  <TableRow key={month.month}>
                    <TableCell>{monthLabel(month.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(month.scheduledCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(month.expectedCollectionCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(month.atRiskCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(month.overdueRecoveryCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(month.refundCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {month.expenseCents === null ? dash : money(month.expenseCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(month.netCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(month.cumulativeNetCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Notes items={cashFlowNotes(data)} />
        </div>
      ) : null}
    </section>
  )
}
