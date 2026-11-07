import { useMemo, useState } from 'react'
import { academicYearName } from '@kampus/school-core/lib/academic-years.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  RECONCILIATION_MISMATCH_LABELS,
  type ReconciliationMismatchReason,
} from '@kampus/school-core/lib/finance-reconciliation.ts'
import {
  useFinanceReconciliation,
  useFinanceReconciliationExport,
} from '@kampus/react-shared/use-finance-exports.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'

type Row = {
  id: string
  studentName: string
  openingCents: number
  accruedCents: number
  withdrawalAdjustmentCents: number
  collectedCents: number
  openingImportCents: number
  reversedCents: number
  refundedCents: number
  scholarshipCents: number
  discountCents: number
  closingCents: number
  differenceCents: number
  mismatchReason: ReconciliationMismatchReason | null
}

const YEARS_BACK = 5
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['studentName', 'closingCents', 'mismatchReason']
const BOM = '﻿'

const amount = (key: keyof Row, label: string): DataColumn<Row> => ({
  key,
  label,
  cell: (row) => money(row[key] as number),
})

const COLUMNS: readonly DataColumn<Row>[] = [
  { key: 'studentName', label: 'Öğrenci' },
  amount('openingCents', 'Açılış'),
  amount('accruedCents', 'Tahakkuk'),
  amount('withdrawalAdjustmentCents', 'Ayrılış düzeltmesi'),
  amount('collectedCents', 'Tahsilat'),
  amount('openingImportCents', 'Açılış aktarımı'),
  amount('reversedCents', 'İptal'),
  amount('refundedCents', 'İade'),
  amount('scholarshipCents', 'Burs'),
  amount('discountCents', 'İndirim'),
  amount('closingCents', 'Kapanış'),
  amount('differenceCents', 'Fark'),
  {
    key: 'mismatchReason',
    label: 'Denetim',
    cell: (row) =>
      row.mismatchReason === null ? (
        <StatusBadge text="Tutuyor" tone="green" />
      ) : (
        <span className="grid justify-items-start gap-1">
          <StatusBadge text="Tutmuyor" tone="red" />
          <span className="text-xs text-muted-foreground">
            {RECONCILIATION_MISMATCH_LABELS[row.mismatchReason]}
          </span>
        </span>
      ),
  },
]

/**
 * Yıl sonu mutabakatı (ON-085, IST-111; DOM-FIN-056): seçilen eğitim yılının açılış, hareket ve
 * kapanış tutarları ile toplamı tutmayan öğrenciler. Yalnız yöneticiye açılır, yalnız raporlar; yıl
 * kapatmaz. Hesap sunucudadır. Dosya taze oturum ister: oturum eskiyse parola sorulup yinelenir.
 */
export function FinanceReconciliationSection({ academicYear }: { academicYear: number }) {
  const [year, setYear] = useState(academicYear)
  const [onlyMismatches, setOnlyMismatches] = useState(false)
  const [reauth, setReauth] = useState(false)
  const list = useListState('mutabakat', {
    urlPrefix: 'mutabakat-',
    resetKey: `${String(year)}-${String(onlyMismatches)}`,
  })
  const report = useFinanceReconciliation({
    year,
    status: onlyMismatches ? 'mismatch' : 'all',
    page: list.state.page,
    pageSize: list.state.pageSize,
  })
  const exporter = useFinanceReconciliationExport()
  const data = report.data?.data

  const rows = useMemo(
    () =>
      data?.rows.map((row): Row => ({
        id: row.studentId,
        studentName: row.studentName || 'Kaydı bulunamayan öğrenci',
        openingCents: row.openingCents,
        accruedCents: row.accruedCents,
        withdrawalAdjustmentCents: row.withdrawalAdjustmentCents,
        collectedCents: row.collectedCents,
        openingImportCents: row.openingImportCents,
        reversedCents: row.reversedCents,
        refundedCents: row.refundedCents,
        scholarshipCents: row.scholarshipCents,
        discountCents: row.discountCents,
        closingCents: row.closingCents,
        differenceCents: row.differenceCents,
        mismatchReason: row.mismatchReason,
      })),
    [data],
  )

  async function download() {
    const outcome = await exporter.submit({ year })
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      `mutabakat-${String(year)}.csv`,
    )
    notify.success('Dosya indirildi.')
  }

  const totals = data?.totals
  const busy = exporter.isPending
  return (
    <section
      aria-labelledby="yil-sonu-mutabakati"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2 max-[650px]:px-4">
        <h2 id="yil-sonu-mutabakati" className="text-lg font-semibold">
          Yıl sonu mutabakatı
        </h2>
        <p className="text-sm text-muted-foreground">
          Yalnız rapordur; yılı kapatmaz, kayıt değiştirmez.
          {data
            ? ` Dönem: ${dateLabel(data.from, { year: 'numeric' })} – ${dateLabel(data.to, { year: 'numeric' })}.`
            : ''}
        </p>
        <p className="mt-2 text-sm">
          Açılış + tahakkuk − ayrılış düzeltmesi − tahsilat − açılış aktarımı + iptal + iade =
          kapanış
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Burs ve indirim taksitlerden zaten düşüldüğü için formüle girmez. Eksi bakiye kurumun
          öğrenciye borcudur (avans, dağıtılmayan tahsilat ya da ödenmemiş iade). Açılış aktarımı
          dosyadan aktarılan geçmiş ödemedir; borcu kapatır, tahsilat değildir, kasayı değiştirmez.
        </p>
        <div className="mt-4 grid max-w-md grid-cols-2 gap-4 max-[420px]:grid-cols-1">
          <label className="grid gap-1 text-sm font-medium">
            Eğitim yılı
            <NativeSelect
              value={String(year)}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {Array.from({ length: YEARS_BACK }, (_, index) => academicYear - index).map(
                (option) => (
                  <NativeSelectOption key={option} value={String(option)}>
                    {academicYearName(option)}
                  </NativeSelectOption>
                ),
              )}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Gösterilecek öğrenciler
            <NativeSelect
              value={onlyMismatches ? 'mismatch' : 'all'}
              onChange={(event) => setOnlyMismatches(event.target.value === 'mismatch')}
            >
              <NativeSelectOption value="all">Tümü</NativeSelectOption>
              <NativeSelectOption value="mismatch">Yalnız tutmayanlar</NativeSelectOption>
            </NativeSelect>
          </label>
        </div>
      </header>
      {totals && data ? (
        <div className="px-6 pt-4 max-[650px]:px-4">
          <p
            role="status"
            className={
              data.mismatchCount === 0 ? 'mb-4 text-sm' : 'mb-4 text-sm font-medium text-danger'
            }
          >
            {data.mismatchCount === 0
              ? `${String(data.studentCount)} öğrencinin toplamı tutuyor.`
              : `${String(data.studentCount)} öğrenciden ${String(data.mismatchCount)} tanesinin toplamı tutmuyor.`}
          </p>
          <StatGrid
            label="Mutabakat toplamları"
            items={[
              { label: 'Açılış', value: money(totals.openingCents) },
              { label: 'Tahakkuk', value: money(totals.accruedCents) },
              {
                label: 'Ayrılış düzeltmesi',
                value: money(totals.withdrawalAdjustmentCents),
              },
              { label: 'Tahsilat', value: money(totals.collectedCents) },
              {
                label: 'Açılış aktarımı',
                value: money(totals.openingImportCents),
                note: 'Tahsilat değildir',
              },
              { label: 'Tahsilat iptali', value: money(totals.reversedCents) },
              { label: 'Ödenen iade', value: money(totals.refundedCents) },
              { label: 'Burs', value: money(totals.scholarshipCents), note: 'Formüle girmez' },
              { label: 'İndirim', value: money(totals.discountCents), note: 'Formüle girmez' },
              {
                label: 'Kapanış',
                value: money(totals.closingCents),
                note: `Açık borç ${money(totals.openDebtCents)} · Alacak ${money(totals.creditCents)}`,
              },
            ]}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 px-6 pb-4 max-[650px]:px-4">
        <Button
          variant="secondary"
          disabled={busy || Boolean(report.error)}
          aria-busy={busy || undefined}
          onClick={() => void download()}
        >
          <Icon name="Download" size={17} aria-hidden="true" />
          Mutabakat dosyası
        </Button>
        <p className="text-sm text-muted-foreground">
          Hesap kodu ve KDV dökümü üretilmez; kurumun mali müşaviri karar verir (doğrulanmalı).
          Hesap kodu gerekiyorsa &quot;Dosya sütunları&quot; ile sabit sütun eklenir.
        </p>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={report.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={COLUMNS}
        mobileColumns={MOBILE_COLUMNS}
        caption="Öğrenci bazında mutabakat"
        empty={onlyMismatches ? 'Toplamı tutmayan öğrenci yok.' : 'Bu yılda finans hareketi yok.'}
        loading={report.isPending}
        fetching={report.isFetching && !report.isPending}
        error={
          report.error ? (
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
