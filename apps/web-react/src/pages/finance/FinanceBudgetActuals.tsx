import { useId, useMemo, useState } from 'react'
import {
  useBudgetActuals,
  type BudgetActualBasis,
} from '@kampus/react-shared/use-finance-budget-actuals.ts'
import {
  BUDGET_ACTUAL_BASES,
  BUDGET_ACTUAL_BASIS_LABELS,
  budgetActualsCsv,
} from '@kampus/school-core/lib/finance-budget-actuals.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
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
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading, SummaryMetrics } from '../management/SummaryParts.tsx'
import { actualsNotes, actualsTableRows, PERIOD_TOTAL } from './finance-budget-actuals-model.ts'
import { monthLabel } from './finance-budget-forms.ts'
import { percentLabel } from './finance-forecast-model.ts'

const BOM = '﻿'
const dash = '—'

/**
 * Bütçe dönemi panelinin "Gerçekleşen" görünümü (ON-244; DOM-FIN-066): kalem × merkez satırlarında
 * seçilen ayın ya da dönemin planı, gerçekleşeni, farkı ve gerçekleşme oranı. Hesap sunucudadır;
 * CSV kişi verisi taşımadığı için tarayıcıda yanıttan üretilir.
 */
export function FinanceBudgetActuals({
  periodId,
  periodName,
}: {
  periodId: string
  periodName: string
}) {
  const [basis, setBasis] = useState<BudgetActualBasis>('accrual')
  const [view, setView] = useState(PERIOD_TOTAL)
  const report = useBudgetActuals(periodId, basis)
  const data = report.data?.data
  const rows = useMemo(() => (data ? actualsTableRows(data, view) : []), [data, view])
  const basisId = useId()
  const viewId = useId()

  return (
    <section aria-labelledby="butce-gerceklesen" className="grid gap-3">
      <h3 id="butce-gerceklesen" className="text-md font-semibold">
        Bütçe–gerçekleşen
      </h3>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1 text-sm font-medium">
          <label htmlFor={basisId}>Esas</label>
          <NativeSelect
            id={basisId}
            value={basis}
            onChange={(event) => {
              const next = BUDGET_ACTUAL_BASES.find((value) => value === event.target.value)
              if (next) setBasis(next)
            }}
          >
            {BUDGET_ACTUAL_BASES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {BUDGET_ACTUAL_BASIS_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1 text-sm font-medium">
          <label htmlFor={viewId}>Ay</label>
          <NativeSelect id={viewId} value={view} onChange={(event) => setView(event.target.value)}>
            <NativeSelectOption value={PERIOD_TOTAL}>Dönem toplamı</NativeSelectOption>
            {(data?.months ?? []).map((month) => (
              <NativeSelectOption key={month} value={month}>
                {monthLabel(month)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button
          variant="outline"
          disabled={!data}
          onClick={() => {
            if (!data) return
            saveBlob(
              new Blob([BOM, budgetActualsCsv(data)], { type: 'text/csv;charset=utf-8' }),
              `butce-gerceklesen-${periodName.replace(/[^\p{L}\p{N}]+/gu, '-')}-${basis === 'accrual' ? 'tahakkuk' : 'tahsilat'}.csv`,
            )
            notify.success('Dosya indirildi.')
          }}
        >
          <Icon name="Download" size={17} aria-hidden="true" />
          CSV indir
        </Button>
      </div>
      {report.error ? (
        <QueryError error={report.error} onRetry={() => void report.refetch()} />
      ) : null}
      {report.isPending ? <SummaryLoading /> : null}
      {data ? (
        <>
          <SummaryMetrics
            items={[
              {
                label: 'Gelir: plan / gerçekleşen',
                value: `${money(data.totals.income.plannedCents)} / ${
                  data.totals.income.actualCents === null
                    ? dash
                    : money(data.totals.income.actualCents)
                }`,
              },
              {
                label: 'Gelir gerçekleşme',
                value:
                  data.totals.income.realizationBasisPoints === null
                    ? dash
                    : percentLabel(data.totals.income.realizationBasisPoints),
              },
              {
                label: 'Eşlenmemiş gelir',
                value:
                  data.totals.income.unmatchedCents === null
                    ? dash
                    : money(data.totals.income.unmatchedCents),
              },
              {
                label: 'Gider gerçekleşen',
                value:
                  data.totals.expense.actualCents === null
                    ? 'Veri yok'
                    : money(data.totals.expense.actualCents),
              },
            ]}
          />
          <div className="overflow-x-auto">
            <Table>
              <TableCaption className="sr-only">
                {`Bütçe–gerçekleşen, ${view === PERIOD_TOTAL ? 'dönem toplamı' : monthLabel(view)}`}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Kalem</TableHead>
                  <TableHead>Maliyet merkezi</TableHead>
                  <TableHead className="text-right">Plan</TableHead>
                  <TableHead className="text-right">Gerçekleşen</TableHead>
                  <TableHead className="text-right">Fark</TableHead>
                  <TableHead className="text-right">Gerçekleşme</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Bu dönemde satır ya da gerçekleşen yok.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>
                        <span className="block">{row.item}</span>
                        <span className="block text-xs text-muted-foreground">
                          {row.note === '' ? row.kind : `${row.kind} · ${row.note}`}
                        </span>
                      </TableCell>
                      <TableCell>{row.center}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.planned}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.actual}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.variance}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.realization}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
            {actualsNotes(data).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
