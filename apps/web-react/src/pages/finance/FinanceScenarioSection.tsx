import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { academicYearName } from '@kampus/school-core/lib/academic-years.ts'
import {
  FINANCE_SCENARIO_MAX,
  financeScenarioCsv,
  type FinanceScenario,
} from '@kampus/school-core/lib/finance-scenarios.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { useFinanceScenarioComparison } from '@kampus/react-shared/use-finance-forecasts.ts'
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
import { monthLabel } from '../dashboard/dashboard-model.ts'
import {
  cashMonthsFromParams,
  comparisonRows,
  draftsFromParams,
  draftToScenario,
  emptyDraft,
  SCENARIO_CASH_PARAM,
  SCENARIO_YEAR_PARAM,
  scenarioNotes,
  writeDrafts,
  yearFromParams,
  type ChangeUnit,
  type DraftErrors,
  type DraftField,
  type ScenarioDraft,
} from './finance-scenario-model.ts'

const BOM = '﻿'
const CASH_MONTH_OPTIONS = [3, 6, 12, 24] as const

/** Adresteki geçerli senaryolar; biri bile geçersizse karşılaştırma istenmez. */
function validScenarios(drafts: readonly ScenarioDraft[]): FinanceScenario[] | null {
  const scenarios: FinanceScenario[] = []
  for (const draft of drafts) {
    const result = draftToScenario(draft)
    if (result.scenario === null) return null
    scenarios.push(result.scenario)
  }
  return scenarios.length === 0 ? null : scenarios
}

/**
 * Gelir senaryo analizi (ON-248; DOM-FIN-067): Finans "Tahmin" sekmesinde, yalnız yönetici. Form
 * taslağı yerel durumdadır; "Karşılaştır" geçerli senaryoları adrese yazar, karşılaştırma adresten
 * okunur (senaryo saklanmaz, K-90). Hesap sunucudadır; CSV yanıttan tarayıcıda üretilir.
 */
export function FinanceScenarioSection({ enrollmentYear }: { enrollmentYear: number }) {
  const [params, setParams] = useSearchParams()
  const years = [enrollmentYear - 1, enrollmentYear, enrollmentYear + 1]
  const applied = draftsFromParams(params)
  const year = yearFromParams(params, years) ?? enrollmentYear
  const cashMonths = cashMonthsFromParams(params)
  const [drafts, setDrafts] = useState<ScenarioDraft[]>(() =>
    applied.length > 0 ? applied : [emptyDraft(0, crypto.randomUUID())],
  )
  const [errors, setErrors] = useState<DraftErrors[]>([])

  // Sorgu anahtarı gövdeyi yapısal karşılaştırır; her çizimde yeniden üretmek yeni istek atmaz.
  const scenarios = validScenarios(applied)
  const report = useFinanceScenarioComparison(
    scenarios === null
      ? null
      : {
          year,
          scenarios,
          ...(cashMonths === null ? {} : { cashFlowMonths: cashMonths }),
        },
  )
  const data = scenarios === null ? undefined : report.data?.data
  const names = applied.map((draft) => draft.name)
  const columns = applied.map((draft) => ({ id: draft.id, name: draft.name }))

  function update(index: number, patch: Partial<ScenarioDraft>) {
    setDrafts((current) =>
      current.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)),
    )
  }

  function compare(event: FormEvent) {
    event.preventDefault()
    const results = drafts.map(draftToScenario)
    setErrors(results.map((result) => result.errors ?? {}))
    if (results.some((result) => result.errors !== null)) {
      notify.error('Senaryo değerlerini düzeltin.')
      return
    }
    setParams((current) => writeDrafts(current, drafts), { replace: true })
  }

  function setParam(name: string, value: string | null) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === null) next.delete(name)
        else next.set(name, value)
        return next
      },
      { replace: true },
    )
  }

  function download() {
    if (!data) return
    saveBlob(
      new Blob([BOM, financeScenarioCsv(data, names)], { type: 'text/csv;charset=utf-8' }),
      `gelir-senaryolari-${String(data.year)}.csv`,
    )
    notify.success('Dosya indirildi.')
  }

  const fieldError = (index: number, field: DraftField) => errors[index]?.[field]
  const errorId = (index: number, field: DraftField) => `senaryo-${String(index)}-${field}-hata`
  const invalidProps = (index: number, field: DraftField) => {
    const message = fieldError(index, field)
    return {
      'aria-invalid': message !== undefined,
      'aria-describedby': message === undefined ? undefined : errorId(index, field),
    }
  }
  const errorText = (index: number, field: DraftField) => {
    const message = fieldError(index, field)
    return message === undefined ? null : (
      <p id={errorId(index, field)} className="mt-1 text-sm text-danger">
        {message}
      </p>
    )
  }
  const unitSelect = (
    index: number,
    label: string,
    value: ChangeUnit,
    field: keyof ScenarioDraft,
  ) => (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(event) => update(index, { [field]: event.target.value as ChangeUnit })}
    >
      <NativeSelectOption value="percent">%</NativeSelectOption>
      <NativeSelectOption value="count">öğrenci</NativeSelectOption>
    </NativeSelect>
  )

  return (
    <section
      aria-labelledby="senaryo-analizi"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2 max-[650px]:px-4">
        <h2 id="senaryo-analizi" className="text-lg font-semibold">
          Senaryo analizi
        </h2>
        <p className="text-sm text-muted-foreground">
          Öğrenci sayısı, fiyat ve indirim-burs oranı değişiminin gelire etkisini temel tahminle
          karşılaştırın. Senaryolar kaydedilmez; adres paylaşılarak açılabilir.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-sm font-medium">
            Senaryo yılı
            <NativeSelect
              value={String(year)}
              onChange={(event) =>
                setParam(
                  SCENARIO_YEAR_PARAM,
                  Number(event.target.value) === enrollmentYear ? null : event.target.value,
                )
              }
            >
              {years.map((option) => (
                <NativeSelectOption key={option} value={String(option)}>
                  {academicYearName(option)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Nakit akışına etkisi
            <NativeSelect
              value={cashMonths === null ? '' : String(cashMonths)}
              onChange={(event) =>
                setParam(SCENARIO_CASH_PARAM, event.target.value === '' ? null : event.target.value)
              }
            >
              <NativeSelectOption value="">Gösterme</NativeSelectOption>
              {CASH_MONTH_OPTIONS.map((option) => (
                <NativeSelectOption key={option} value={String(option)}>
                  {`${String(option)} ay`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button variant="outline" disabled={!data} onClick={download}>
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
        </div>
      </header>
      <form className="px-6 pt-4 pb-2 max-[650px]:px-4" onSubmit={compare} noValidate>
        <div className="overflow-x-auto">
          <Table aria-label="Senaryo parametreleri">
            <TableHeader>
              <TableRow>
                <TableHead>Ad</TableHead>
                <TableHead>Yeni kayıt değişimi</TableHead>
                <TableHead>Yenileme değişimi</TableHead>
                <TableHead>Fiyat değişimi (%)</TableHead>
                <TableHead>İndirim ve burs (puan)</TableHead>
                <TableHead>Mevcut sözleşmelere uygula</TableHead>
                <TableHead>
                  <span className="sr-only">İşlem</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((draft, index) => {
                const label = `Senaryo ${String(index + 1)}`
                return (
                  <TableRow key={draft.id}>
                    <TableCell className="align-top">
                      <Input
                        aria-label={`${label} adı`}
                        value={draft.name}
                        onChange={(event) => update(index, { name: event.target.value })}
                        className="w-40"
                        {...invalidProps(index, 'name')}
                      />
                      {errorText(index, 'name')}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex gap-2">
                        <Input
                          aria-label={`${label} yeni kayıt değişimi`}
                          inputMode="decimal"
                          placeholder="0"
                          value={draft.newValue}
                          onChange={(event) => update(index, { newValue: event.target.value })}
                          className="w-24"
                          {...invalidProps(index, 'newValue')}
                        />
                        {unitSelect(index, `${label} yeni kayıt birimi`, draft.newUnit, 'newUnit')}
                      </div>
                      {errorText(index, 'newValue')}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex gap-2">
                        <Input
                          aria-label={`${label} yenileme değişimi`}
                          inputMode="decimal"
                          placeholder="0"
                          value={draft.renewalValue}
                          onChange={(event) => update(index, { renewalValue: event.target.value })}
                          className="w-24"
                          {...invalidProps(index, 'renewalValue')}
                        />
                        {unitSelect(
                          index,
                          `${label} yenileme birimi`,
                          draft.renewalUnit,
                          'renewalUnit',
                        )}
                      </div>
                      {errorText(index, 'renewalValue')}
                    </TableCell>
                    <TableCell className="align-top">
                      <Input
                        aria-label={`${label} fiyat değişimi (%)`}
                        inputMode="decimal"
                        placeholder="0"
                        value={draft.price}
                        onChange={(event) => update(index, { price: event.target.value })}
                        className="w-24"
                        {...invalidProps(index, 'price')}
                      />
                      {errorText(index, 'price')}
                    </TableCell>
                    <TableCell className="align-top">
                      <Input
                        aria-label={`${label} indirim ve burs değişimi (puan)`}
                        inputMode="decimal"
                        placeholder="0"
                        value={draft.discount}
                        onChange={(event) => update(index, { discount: event.target.value })}
                        className="w-24"
                        {...invalidProps(index, 'discount')}
                      />
                      {errorText(index, 'discount')}
                    </TableCell>
                    <TableCell className="align-top">
                      <input
                        type="checkbox"
                        aria-label={`${label} mevcut sözleşmelere uygula`}
                        checked={draft.applyToExisting}
                        onChange={(event) =>
                          update(index, { applyToExisting: event.target.checked })
                        }
                        className="size-5"
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={drafts.length === 1}
                        onClick={() => {
                          setDrafts((current) => current.filter((_, at) => at !== index))
                          setErrors((current) => current.filter((_, at) => at !== index))
                        }}
                      >
                        <Icon name="Trash2" size={16} aria-hidden="true" />
                        <span className="sr-only">{`${label} kaldır`}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="submit">Karşılaştır</Button>
          <Button
            type="button"
            variant="outline"
            disabled={drafts.length >= FINANCE_SCENARIO_MAX}
            onClick={() =>
              setDrafts((current) => [...current, emptyDraft(current.length, crypto.randomUUID())])
            }
          >
            Senaryo ekle
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Öğrenci değişimi yüzde ya da öğrenci sayısıdır; eksi azalıştır. En çok{' '}
          {String(FINANCE_SCENARIO_MAX)} senaryo.
        </p>
      </form>
      {scenarios !== null && report.error ? (
        <div className="px-6 pb-6 max-[650px]:px-4">
          <QueryError error={report.error} onRetry={() => void report.refetch()} />
        </div>
      ) : null}
      {scenarios !== null && report.isPending ? (
        <p role="status" className="px-6 pb-6 text-sm text-muted-foreground max-[650px]:px-4">
          Senaryolar hesaplanıyor…
        </p>
      ) : null}
      {scenarios === null ? (
        <p className="px-6 pb-6 text-sm text-muted-foreground max-[650px]:px-4">
          {"Değerleri girip Karşılaştır'a basın; boş alan değişim yok demektir."}
        </p>
      ) : null}
      {data ? (
        <div className="px-6 pt-2 pb-6 max-[650px]:px-4">
          <div className="overflow-x-auto">
            <Table aria-label="Senaryo karşılaştırması">
              <TableHeader>
                <TableRow>
                  <TableHead>Ölçüt</TableHead>
                  <TableHead className="text-right">Temel</TableHead>
                  {columns.map((column) => (
                    <TableHead key={column.id} className="text-right">
                      {column.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisonRows(
                  data,
                  columns.map((column) => column.id),
                ).map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className={row.emphasis ? 'font-semibold' : undefined}>
                      {row.label}
                    </TableCell>
                    {row.cells.map((cell) => (
                      <TableCell
                        key={cell.key}
                        className={`text-right tabular-nums ${row.emphasis ? 'font-semibold' : ''}`}
                      >
                        {cell.text}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data.cashFlow ? (
            <div className="mt-6 overflow-x-auto">
              <Table aria-label="Senaryoların nakit akışı">
                <TableHeader>
                  <TableRow>
                    <TableHead>Ay</TableHead>
                    <TableHead className="text-right">Temel net</TableHead>
                    {columns.map((column) => (
                      <TableHead key={column.id} className="text-right">
                        {`${column.name} net`}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.cashFlow.baseline.map((month, monthIndex) => (
                    <TableRow key={month.month}>
                      <TableCell>{monthLabel(month.month)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(month.netCents)}
                      </TableCell>
                      {columns.map((column, index) => (
                        <TableCell key={column.id} className="text-right tabular-nums">
                          {money(
                            data.cashFlow?.scenarios[index]?.months[monthIndex]?.netCents ?? 0,
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold">Dönem farkı</TableCell>
                    <TableCell className="text-right tabular-nums">{money(0)}</TableCell>
                    {columns.map((column, index) => (
                      <TableCell key={column.id} className="text-right font-semibold tabular-nums">
                        {money(data.cashFlow?.scenarios[index]?.totalChangeCents ?? 0)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : null}
          <ul className="mt-4 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
            {scenarioNotes(data, names).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
