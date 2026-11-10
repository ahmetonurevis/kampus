import { useMemo, useState } from 'react'
import {
  useFixedAssetDepreciationExport,
  useFixedAssetDepreciationReport,
  type DepreciationReport,
  type FixedAssetDetail,
} from '@kampus/react-shared/use-finance-fixed-assets.ts'
import { DEPRECIATION_REPORT_NOTE } from '@kampus/school-core/lib/finance-fixed-asset-depreciation.ts'
import {
  DEPRECIATION_METHOD_LABELS,
  FIXED_ASSET_CATEGORY_LABELS,
} from '@kampus/school-core/lib/finance-fixed-assets.ts'
import { dayKey, money, number } from '@kampus/school-core/lib/format.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { depreciationRateLabel, reportYears } from './finance-fixed-asset-forms.ts'

const BOM = '﻿'

type ScheduleRow = {
  id: string
  year: number
  openingCents: number
  depreciationCents: number
  accumulatedCents: number
  netCents: number
  disposedCents: number
}
const SCHEDULE_COLUMNS: readonly DataColumn<ScheduleRow>[] = [
  { key: 'year', label: 'Yıl', cell: (row) => String(row.year) },
  { key: 'openingCents', label: 'Dönem başı değer', cell: (row) => money(row.openingCents) },
  { key: 'depreciationCents', label: 'Ayrılan', cell: (row) => money(row.depreciationCents) },
  { key: 'accumulatedCents', label: 'Birikmiş', cell: (row) => money(row.accumulatedCents) },
  {
    key: 'netCents',
    label: 'Net değer',
    cell: (row) =>
      row.disposedCents > 0
        ? `${money(row.netCents)} (hurdaya ayrıldı, kayıttan düşer)`
        : money(row.netCents),
  },
]
const SCHEDULE_MOBILE = ['year', 'depreciationCents', 'netCents']
const SCHEDULE_NO_FILTERS = SCHEDULE_COLUMNS.map((column) => column.key)

type CategoryRow = DepreciationReport['categories'][number] & { id: string; label: string }
const CATEGORY_COLUMNS: readonly DataColumn<CategoryRow>[] = [
  { key: 'label', label: 'Kategori' },
  { key: 'assetCount', label: 'Demirbaş', cell: (row) => number(row.assetCount) },
  { key: 'openingNetCents', label: 'Dönem başı net', cell: (row) => money(row.openingNetCents) },
  { key: 'additionsCents', label: 'Yıl içi giriş', cell: (row) => money(row.additionsCents) },
  {
    key: 'depreciationCents',
    label: 'Yıl amortismanı',
    cell: (row) => money(row.depreciationCents),
  },
  { key: 'disposedCents', label: 'Hurdaya ayrılan', cell: (row) => money(row.disposedCents) },
  { key: 'accumulatedCents', label: 'Birikmiş', cell: (row) => money(row.accumulatedCents) },
  { key: 'closingNetCents', label: 'Yıl sonu net', cell: (row) => money(row.closingNetCents) },
]
const CATEGORY_MOBILE = ['label', 'depreciationCents', 'closingNetCents']
const CATEGORY_NO_FILTERS = CATEGORY_COLUMNS.map((column) => column.key)

function ReportNote() {
  return <p className="text-sm text-muted-foreground">{DEPRECIATION_REPORT_NOTE}</p>
}

/**
 * Demirbaş ayrıntısındaki amortisman ön hesabı (DOM-FIN-088): yıl, dönem başı değer, ayrılan,
 * birikmiş ve net değer. Tablo sunucudan gelir; burada hesap yapılmaz.
 */
export function FixedAssetDepreciationSchedule({ asset }: { asset: FixedAssetDetail }) {
  const rows = useMemo(
    () => asset.depreciation.rows.map((row): ScheduleRow => ({ ...row, id: String(row.year) })),
    [asset.depreciation.rows],
  )
  return (
    <section aria-labelledby="demirbas-amortisman" className="grid gap-3 border-t pt-4">
      <h3 id="demirbas-amortisman" className="text-base font-semibold">
        Amortisman ön hesabı
      </h3>
      <p className="text-sm">
        {DEPRECIATION_METHOD_LABELS[asset.depreciationMethod]} · {String(asset.usefulLifeYears)} yıl
        · yıllık oran {depreciationRateLabel(asset.depreciation.rateBasisPoints)}
      </p>
      <ReportNote />
      <DataTable
        listKey={`demirbas-amortisman-${asset.id}`}
        rows={rows}
        columns={SCHEDULE_COLUMNS}
        mobileColumns={SCHEDULE_MOBILE}
        caption="Yıllık amortisman tablosu"
        search={false}
        excludeFilters={SCHEDULE_NO_FILTERS}
        pageSize={10}
      />
    </section>
  )
}

/**
 * Amortisman ön hesabı raporu (DOM-FIN-088; ON-238). Yalnız yönetici (K-189). Yıl seçilir; kurum
 * toplamı ve kategori kırılımı sunucuda hesaplanır. CSV demirbaş satırlarını da taşır, denetime
 * düşer (K-227). Yönetim raporudur, resmî defter yerine geçmez (IST-142).
 */
export function FinanceFixedAssetDepreciationSection() {
  const thisYear = Number(dayKey().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const report = useFixedAssetDepreciationReport(year)
  const exporter = useFixedAssetDepreciationExport()
  const data = report.data?.data
  const years = reportYears(data?.firstYear ?? null, thisYear, year)

  async function download() {
    const outcome = await exporter.submit(year)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      `amortisman-on-hesabi-${String(year)}.csv`,
    )
    notify.success('Dosya indirildi.')
  }

  return (
    <section
      aria-labelledby="amortisman-raporu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-4 max-[650px]:px-4">
        <h2 id="amortisman-raporu" className="text-lg font-semibold">
          Amortisman ön hesabı
        </h2>
        <ReportNote />
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-sm font-medium">
            Hesap yılı
            <NativeSelect
              value={String(year)}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {years.map((option) => (
                <NativeSelectOption key={option} value={String(option)}>
                  {String(option)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button
            variant="outline"
            disabled={!data || exporter.isPending}
            aria-busy={exporter.isPending || undefined}
            onClick={() => void download()}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Alım yılı tam yıl sayılır; hurdaya ayrılan demirbaşın kalan değeri ayrıldığı yıl düşer.
        </p>
      </header>
      <div className="px-6 pb-6 max-[650px]:px-4">
        {report.error ? (
          <QueryError error={report.error} onRetry={() => void report.refetch()} />
        ) : null}
        {report.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Rapor yükleniyor…
          </p>
        ) : null}
        {data ? <ReportBody data={data} /> : null}
      </div>
    </section>
  )
}

function ReportBody({ data }: { data: DepreciationReport }) {
  const { totals } = data
  const rows = useMemo(
    () =>
      data.categories.map((row): CategoryRow => ({
        ...row,
        id: row.category,
        label: FIXED_ASSET_CATEGORY_LABELS[row.category],
      })),
    [data.categories],
  )
  return (
    <>
      <StatGrid
        label="Amortisman özeti"
        items={[
          {
            label: 'Demirbaş',
            value: number(totals.assetCount),
            ...(totals.disposedCount > 0
              ? { note: `${number(totals.disposedCount)} tanesi bu yıl hurdaya ayrıldı` }
              : {}),
          },
          { label: 'Dönem başı net değer', value: money(totals.openingNetCents) },
          { label: 'Yıl içi giriş', value: money(totals.additionsCents) },
          { label: 'Yıl amortismanı', value: money(totals.depreciationCents) },
          { label: 'Hurdaya ayrılan net değer', value: money(totals.disposedCents) },
          {
            label: 'Yıl sonu net değer',
            value: money(totals.closingNetCents),
            note: `Alım değeri ${money(totals.costCents)}, birikmiş ${money(totals.accumulatedCents)}`,
          },
        ]}
      />
      <DataTable
        listKey={`amortisman-kategori-${String(data.year)}`}
        rows={rows}
        columns={CATEGORY_COLUMNS}
        mobileColumns={CATEGORY_MOBILE}
        caption={`${String(data.year)} amortismanı, kategoriye göre`}
        search={false}
        excludeFilters={CATEGORY_NO_FILTERS}
        pageSize={10}
        empty="Bu yıl kayıtta demirbaş yok."
      />
    </>
  )
}
