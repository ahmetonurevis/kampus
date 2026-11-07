import { useMemo, useState } from 'react'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { assertFinancePeriod } from '@kampus/school-core/lib/finance-export.ts'
import { PACKAGE_KIND_LABELS } from '@kampus/school-core/lib/finance-packages.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import {
  usePackageReport,
  usePackageReportExport,
} from '@kampus/react-shared/use-finance-packages.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'

const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['studentName', 'usedHours', 'closingHours']
const BOM = '﻿'
const MONTH_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

type Row = {
  id: string
  studentName: string
  packageName: string
  soldDate: string
  openingHours: number
  soldHours: number
  usedHours: number
  refundedHours: number
  expiredHours: number
  closingHours: number
  recognizedCents: number
  closingDeferredCents: number
}

const hoursColumn = (key: keyof Row, label: string): DataColumn<Row> => ({
  key,
  label,
  cell: (row) => `${String(row[key])} saat`,
})
const COLUMNS: readonly DataColumn<Row>[] = [
  { key: 'studentName', label: 'Öğrenci' },
  { key: 'packageName', label: 'Paket' },
  {
    key: 'soldDate',
    label: 'Satış günü',
    cell: (row) => dateLabel(row.soldDate, { year: 'numeric' }),
  },
  hoursColumn('openingHours', 'Açılış kalan'),
  hoursColumn('soldHours', 'Satılan'),
  hoursColumn('usedHours', 'Kullanılan'),
  hoursColumn('refundedHours', 'İade edilen'),
  hoursColumn('expiredHours', 'Süresi dolan'),
  hoursColumn('closingHours', 'Kapanış kalan'),
  { key: 'recognizedCents', label: 'Tanınan gelir', cell: (row) => money(row.recognizedCents) },
  {
    key: 'closingDeferredCents',
    label: 'Ertelenmiş gelir',
    cell: (row) => money(row.closingDeferredCents),
  },
]

/** Dönem hatası core kuralından: istek gitmeden alan altında görünür. */
function periodError(from: string, to: string): string | null {
  if (from === '' || to === '') return 'Dönemin başlangıcını ve bitişini seçin.'
  try {
    assertFinancePeriod({ from, to })
    return null
  } catch (error) {
    if (error instanceof DomainError) return error.message
    throw error
  }
}

const monthLabel = (month: string) => MONTH_FORMAT.format(new Date(`${month}-01T00:00:00.000Z`))

/**
 * Paket saat raporu (IST-114, DOM-FIN-057; yalnız dil okulu, yalnız yönetici): dönemde satılan,
 * kullanılan, iade edilen ve süresi dolan saat; gelir kullanılan saat payıyla tanınır, kalan saat
 * ertelenmiş gelirdir. Hesap sunucudadır; toplam ve ay dökümü bütün satırlardan gelir. Dosya taze
 * oturum ister: oturum eskiyse parola sorulup yinelenir.
 */
export function PackageReportSection() {
  const today = dayKey()
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [reauth, setReauth] = useState(false)
  const invalid = periodError(from, to)
  const list = useListState('paket-raporu', { urlPrefix: 'rapor_', resetKey: `${from}-${to}` })
  const report = usePackageReport(
    { from, to, page: list.state.page, pageSize: list.state.pageSize },
    { enabled: invalid === null },
  )
  const exporter = usePackageReportExport()
  const data = invalid === null ? report.data?.data : undefined

  const rows = useMemo(
    () =>
      data?.lines.map((line): Row => ({
        id: line.saleId,
        studentName: line.studentName ?? 'Kaydı bulunamayan öğrenci',
        packageName: `${line.packageName} (${PACKAGE_KIND_LABELS[line.kind]})`,
        soldDate: line.soldDate,
        openingHours: line.openingHours,
        soldHours: line.soldHours,
        usedHours: line.usedHours,
        refundedHours: line.refundedHours,
        expiredHours: line.expiredHours,
        closingHours: line.closingHours,
        recognizedCents: line.recognizedCents,
        closingDeferredCents: line.closingDeferredCents,
      })),
    [data],
  )

  async function download() {
    const outcome = await exporter.submit({ from, to })
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      `paket-saat-raporu-${from}-${to}.csv`,
    )
    notify.success('Dosya indirildi.')
  }

  const totals = data?.totals
  const busy = exporter.isPending
  return (
    <section
      aria-labelledby="paket-saat-raporu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2 max-[650px]:px-4">
        <h2 id="paket-saat-raporu" className="text-lg font-semibold">
          Paket saat raporu
        </h2>
        <p className="text-sm text-muted-foreground">
          Gelir, net ücretin kullanılan saat payıyla tanınır. Süresi dolan saat silinmez, gelir
          sayılmaz; ertelenmiş gelirde kalır. Elle girilen kullanılan saatin düzeltmesi giriş gününe
          yazılır.
        </p>
        <p className="mt-2 text-sm">Açılış kalan + satılan − kullanılan − iade = kapanış kalan</p>
        <div className="mt-4 grid max-w-md grid-cols-2 gap-4 max-[420px]:grid-cols-1">
          <FormField id="paket-rapor-baslangic" label="Dönem başlangıcı">
            {(control) => (
              <Input
                {...control}
                type="date"
                value={from}
                max={today}
                onChange={(event) => setFrom(event.target.value)}
              />
            )}
          </FormField>
          <FormField id="paket-rapor-bitis" label="Dönem bitişi">
            {(control) => (
              <Input
                {...control}
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            )}
          </FormField>
        </div>
        {invalid ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {invalid}
          </p>
        ) : null}
      </header>
      {totals ? (
        <div className="px-6 pt-4 max-[650px]:px-4">
          <StatGrid
            label="Dönem toplamları"
            items={[
              { label: 'Açılış kalan', value: `${String(totals.openingHours)} saat` },
              {
                label: 'Satılan',
                value: `${String(totals.soldHours)} saat`,
                note: money(totals.soldCents),
              },
              {
                label: 'Kullanılan',
                value: `${String(totals.usedHours)} saat`,
                note: `Tanınan gelir ${money(totals.recognizedCents)}`,
              },
              {
                label: 'İade edilen',
                value: `${String(totals.refundedHours)} saat`,
                note: `Net ücret payı ${money(totals.returnedCents)}`,
              },
              {
                label: 'Süresi dolan',
                value: `${String(totals.expiredHours)} saat`,
                note: 'Kapanış kalanın içindedir',
              },
              {
                label: 'Kapanış kalan',
                value: `${String(totals.closingHours)} saat`,
                note: `Ertelenmiş gelir ${money(totals.closingDeferredCents)}`,
              },
            ]}
          />
          <div className="mb-6 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <caption className="mb-2 text-left font-medium">Aylık döküm</caption>
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Ay
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Satılan
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Kullanılan
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    İade edilen
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Süresi dolan
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Tanınan gelir
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {data.months.map((month) => (
                  <tr key={month.month} className="border-t">
                    <th scope="row" className="py-2 pr-4 text-left font-medium">
                      {monthLabel(month.month)}
                    </th>
                    <td className="py-2 pr-4">{month.soldHours} saat</td>
                    <td className="py-2 pr-4">{month.usedHours} saat</td>
                    <td className="py-2 pr-4">{month.refundedHours} saat</td>
                    <td className="py-2 pr-4">{month.expiredHours} saat</td>
                    <td className="py-2">{money(month.recognizedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 px-6 pb-4 max-[650px]:px-4">
        <Button
          variant="secondary"
          disabled={busy || invalid !== null || Boolean(report.error)}
          aria-busy={busy || undefined}
          onClick={() => void download()}
        >
          <Icon name="Download" size={17} aria-hidden="true" />
          Rapor dosyası
        </Button>
        <p className="text-sm text-muted-foreground">
          Hesap kodu ve KDV dökümü üretilmez; gelir tanıma biçimine kurumun mali müşaviri karar
          verir (doğrulanmalı).
        </p>
      </div>
      <ServerDataTable
        list={list}
        rows={invalid === null ? rows : []}
        total={invalid === null ? (report.data?.meta.total ?? 0) : 0}
        sortable={NO_SORT}
        columns={COLUMNS}
        mobileColumns={MOBILE_COLUMNS}
        caption="Satış bazında paket saatleri"
        search={false}
        empty="Bu dönemde paket hareketi yok."
        loading={invalid === null && report.isPending}
        fetching={report.isFetching && !report.isPending}
        error={
          report.error && invalid === null ? (
            <QueryError error={report.error} onRetry={() => void report.refetch()} />
          ) : undefined
        }
      />
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void download()
          }}
        />
      ) : null}
    </section>
  )
}
