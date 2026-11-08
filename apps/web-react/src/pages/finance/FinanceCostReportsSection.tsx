import { useState } from 'react'
import { campusConsolidationCsv } from '@kampus/school-core/lib/finance-campus-consolidation.ts'
import {
  COST_ALLOCATION_KEY_LABELS,
  COST_ALLOCATION_KEYS,
  costPerStudentCsv,
  type CostAllocationKey,
} from '@kampus/school-core/lib/finance-cost-per-student.ts'
import { money, number } from '@kampus/school-core/lib/format.ts'
import { useBudgetPeriods } from '@kampus/react-shared/use-finance-budget.ts'
import {
  useFinanceCampusConsolidation,
  useFinanceCostPerStudent,
  type CampusConsolidationReport,
  type CostPerStudentReport,
} from '@kampus/react-shared/use-finance-cost-reports.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
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
import {
  centerTypeLabel,
  consolidationNotes,
  costNotes,
  defaultPeriodId,
  perStudentLabel,
  shareLabel,
  studentCountLabel,
} from './finance-cost-report-model.ts'

const BOM = '﻿'
const PERIOD_LIST = { page: 1, pageSize: 100 } as const

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

const num = 'text-right tabular-nums'
/** Hiyerarşi girintisi (en çok 4 düzey, K-73). */
const INDENT = ['', 'ps-5', 'ps-10', 'ps-15'] as const

/**
 * Öğrenci başı maliyet (ON-249) ve kampüs karşılaştırması (ON-250); DOM-FIN-065. Finans "Maliyet"
 * sekmesi, yalnız yönetici. Bütçe dönemi ve bölüşüm anahtarı iki rapor için ortaktır. Hesap
 * sunucudadır; rapor kişi verisi taşımadığı için CSV tarayıcıda yanıttan üretilir.
 */
export function FinanceCostReportsSection() {
  const periods = useBudgetPeriods(PERIOD_LIST)
  const [chosen, setChosen] = useState<string | null>(null)
  const [key, setKey] = useState<CostAllocationKey>('students')
  const list = periods.data?.data
  const periodId = chosen ?? defaultPeriodId(list)
  const query = periodId === null ? null : { periodId, key }
  return (
    <section
      aria-labelledby="maliyet-raporlari"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-4 max-[650px]:px-4">
        <h2 id="maliyet-raporlari" className="text-lg font-semibold">
          Maliyet ve kampüs karşılaştırması
        </h2>
        <p className="text-sm text-muted-foreground">
          Bütçe giderinin merkez ve öğrenci başına düşen payı ile kampüslerin gelir ve gider
          karşılaştırması.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-sm font-medium">
            Bütçe dönemi
            <NativeSelect
              value={periodId ?? ''}
              disabled={!list || list.length === 0}
              onChange={(event) => setChosen(event.target.value)}
            >
              {(list ?? []).map((period) => (
                <NativeSelectOption key={period.id} value={period.id}>
                  {period.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Ortak gider bölüşümü
            <NativeSelect
              value={key}
              onChange={(event) => setKey(event.target.value as CostAllocationKey)}
            >
              {COST_ALLOCATION_KEYS.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {COST_ALLOCATION_KEY_LABELS[option]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </div>
      </header>
      {periods.error ? (
        <div className="px-6 pb-6 max-[650px]:px-4">
          <QueryError error={periods.error} onRetry={() => void periods.refetch()} />
        </div>
      ) : null}
      {list && list.length === 0 ? (
        <p className="px-6 pb-6 text-sm text-muted-foreground max-[650px]:px-4">
          Önce "Bütçe" sekmesinde bir bütçe dönemi ve gider satırları ekleyin.
        </p>
      ) : null}
      {query ? (
        <>
          <CostPerStudentPanel query={query} />
          <CampusConsolidationPanel query={query} />
        </>
      ) : null}
    </section>
  )
}

type ReportQuery = { periodId: string; key: CostAllocationKey }

function ReportState({
  report,
}: {
  report: { error: unknown; isPending: boolean; refetch: () => unknown }
}) {
  if (report.error)
    return (
      <QueryError
        error={report.error as Error}
        onRetry={() => {
          void report.refetch()
        }}
      />
    )
  if (report.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Rapor yükleniyor…
      </p>
    )
  return null
}

function CostPerStudentPanel({ query }: { query: ReportQuery }) {
  const report = useFinanceCostPerStudent(query)
  const data: CostPerStudentReport | undefined = report.data?.data
  return (
    <section className="border-t px-6 pt-5 pb-6 max-[650px]:px-4" aria-labelledby="ogrenci-basi">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="ogrenci-basi" className="text-base font-semibold">
          Öğrenci başı maliyet
        </h3>
        <Button
          variant="outline"
          disabled={!data}
          onClick={() => {
            if (data)
              downloadCsv(
                costPerStudentCsv(data),
                `ogrenci-basi-maliyet-${data.period.startDate}.csv`,
              )
          }}
        >
          <Icon name="Download" size={17} aria-hidden="true" />
          CSV indir
        </Button>
      </div>
      <div className="mt-3">
        <ReportState report={report} />
      </div>
      {data ? (
        <>
          <StatGrid
            label="Öğrenci başı maliyet özeti"
            items={[
              { label: 'Toplam gider', value: money(data.totals.expenseCents) },
              { label: 'Öğrenci', value: number(data.totals.studentCount) },
              {
                label: 'Kurum geneli öğrenci başı',
                value: perStudentLabel(data.totals.perStudentCents, data.totals.suppressed),
              },
              {
                label: 'Paylaştırılamayan',
                value: money(data.totals.unallocatedCents),
              },
            ]}
          />
          {data.centers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Bu kurumda maliyet merkezi yok; "Bütçe" sekmesinden ekleyin.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Merkez</TableHead>
                    <TableHead>Tür</TableHead>
                    <TableHead className="text-right">Doğrudan gider</TableHead>
                    <TableHead className="text-right">Ortak giderden pay</TableHead>
                    <TableHead className="text-right">Toplam maliyet</TableHead>
                    <TableHead className="text-right">Öğrenci</TableHead>
                    <TableHead className="text-right">Öğrenci başı</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.centers.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <span className={`grid ${INDENT[Math.min(row.depth, 4) - 1] ?? ''}`}>
                          <span className="font-medium">{row.name}</span>
                          <span className="text-xs text-muted-foreground">{row.path}</span>
                        </span>
                      </TableCell>
                      <TableCell>{centerTypeLabel(row.type, row.shared)}</TableCell>
                      <TableCell className={num}>{money(row.directCents)}</TableCell>
                      <TableCell className={num}>
                        {row.shared ? '—' : money(row.sharedInCents)}
                      </TableCell>
                      <TableCell className={num}>{money(row.totalCents)}</TableCell>
                      <TableCell className={num}>{studentCountLabel(row.studentCount)}</TableCell>
                      <TableCell className={num}>
                        {perStudentLabel(row.perStudentCents, row.suppressed)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Notes items={costNotes(data)} />
        </>
      ) : null}
    </section>
  )
}

function CampusConsolidationPanel({ query }: { query: ReportQuery }) {
  const report = useFinanceCampusConsolidation(query)
  const data: CampusConsolidationReport | undefined = report.data?.data
  const totals = data?.totals
  return (
    <section
      className="border-t px-6 pt-5 pb-6 max-[650px]:px-4"
      aria-labelledby="kampus-karsilastirma"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="kampus-karsilastirma" className="text-base font-semibold">
          Kampüs karşılaştırması
        </h3>
        <Button
          variant="outline"
          disabled={!data}
          onClick={() => {
            if (data)
              downloadCsv(campusConsolidationCsv(data), `kampus-karsilastirmasi-${data.from}.csv`)
          }}
        >
          <Icon name="Download" size={17} aria-hidden="true" />
          CSV indir
        </Button>
      </div>
      <div className="mt-3">
        <ReportState report={report} />
      </div>
      {data && totals ? (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kampüs</TableHead>
                  <TableHead className="text-right">Öğrenci</TableHead>
                  <TableHead className="text-right">Tahakkuk</TableHead>
                  <TableHead className="text-right">Tahsilat</TableHead>
                  <TableHead className="text-right">İptal</TableHead>
                  <TableHead className="text-right">İade</TableHead>
                  <TableHead className="text-right">Net tahsilat</TableHead>
                  <TableHead className="text-right">Bütçe gideri</TableHead>
                  <TableHead className="text-right">Öğrenci başı tahakkuk</TableHead>
                  <TableHead className="text-right">Öğrenci başı gider</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.campuses.map((row) => (
                  <TableRow key={row.campusId ?? 'kampussuz'}>
                    <TableCell>
                      <span className="grid">
                        <span className="font-medium">{row.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {`Öğrenci ${shareLabel(row.studentShareBasisPoints)} · tahakkuk ${shareLabel(row.accruedShareBasisPoints)}`}
                          {row.campusId !== null && !row.hasCostCenter
                            ? ' · maliyet merkezi yok'
                            : ''}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className={num}>{number(row.studentCount)}</TableCell>
                    <TableCell className={num}>{money(row.accruedCents)}</TableCell>
                    <TableCell className={num}>{money(row.collectedCents)}</TableCell>
                    <TableCell className={num}>{money(row.reversedCents)}</TableCell>
                    <TableCell className={num}>{money(row.refundedCents)}</TableCell>
                    <TableCell className={num}>{money(row.netCollectedCents)}</TableCell>
                    <TableCell className={num}>{money(row.budgetExpenseCents)}</TableCell>
                    <TableCell className={num}>
                      {perStudentLabel(row.accruedPerStudentCents, row.suppressed)}
                    </TableCell>
                    <TableCell className={num}>
                      {perStudentLabel(row.budgetExpensePerStudentCents, row.suppressed)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Kampüsler toplamı</TableCell>
                  <TableCell className={num}>{number(totals.studentCount)}</TableCell>
                  <TableCell className={num}>{money(totals.accruedCents)}</TableCell>
                  <TableCell className={num}>{money(totals.collectedCents)}</TableCell>
                  <TableCell className={num}>{money(totals.reversedCents)}</TableCell>
                  <TableCell className={num}>{money(totals.refundedCents)}</TableCell>
                  <TableCell className={num}>{money(totals.netCollectedCents)}</TableCell>
                  <TableCell className={num}>{money(totals.budgetExpenseCents)}</TableCell>
                  <TableCell className={num}>
                    {perStudentLabel(totals.accruedPerStudentCents, totals.suppressed)}
                  </TableCell>
                  <TableCell className={num}>
                    {perStudentLabel(totals.budgetExpensePerStudentCents, totals.suppressed)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <Notes items={consolidationNotes(data)} />
        </>
      ) : null}
    </section>
  )
}
