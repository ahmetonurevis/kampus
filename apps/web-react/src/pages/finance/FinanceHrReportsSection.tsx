import { useState } from 'react'
import {
  useHrReport,
  useHrReportExport,
  type HrReport,
} from '@kampus/react-shared/use-finance-hr-reports.ts'
import {
  HR_ROLE_GROUP_LABELS,
  hrDecimalText,
  hrHiddenText,
  hrPeriodLabel,
  hrRateText,
  hrReportFilename,
  hrReportNotes,
  SENIORITY_BAND_LABELS,
  type HrHiddenTurnover,
} from '@kampus/school-core/lib/finance-hr-reports.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useHrReportPdf } from '@/hooks/use-finance-hr-report-pdf.ts'
import {
  HR_REPORT_TITLE,
  hrCountText,
  hrTurnoverCells,
} from '@/lib/pdf/templates/finance-hr-report.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { CsvButton, PdfDialogButton } from './CorporateParts.tsx'
import { defaultHrRange, hrReportQueryOf } from './finance-hr-report-model.ts'

const num = 'text-right tabular-nums'
const TURNOVER_KEYS = ['opening', 'hires', 'exits', 'closing', 'average', 'rate'] as const

/**
 * İK raporları (DOM-FIN-117; ON-192): Finans "İK raporları" sekmesi, yalnız yönetici. Seçilen ay
 * aralığında devir oranı (kurum, rol, maliyet merkezi), dönem sonundaki kıdem dağılımı ve izin
 * kullanımı. Kişi adı yazılmaz; 5 kişiden az grup "<5" gizlenir (K-401). Her görüntüleme, CSV ve
 * PDF denetim kaydına yazılır.
 */
export function FinanceHrReportsSection() {
  const [from, setFrom] = useState(() => defaultHrRange(dayKey()).from)
  const [to, setTo] = useState(() => defaultHrRange(dayKey()).to)
  const built = hrReportQueryOf(from, to)
  const query = 'query' in built ? built.query : null
  const report = useHrReport(query ?? {}, query !== null)
  const exporter = useHrReportExport()
  const data: HrReport | undefined = query === null ? undefined : report.data?.data
  return (
    <section
      aria-labelledby="ik-raporlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-4 max-[650px]:px-4">
        <h2 id="ik-raporlari" className="text-lg font-semibold">
          İK raporları
        </h2>
        <p className="text-sm text-muted-foreground">
          Personel devir oranı, kıdem dağılımı ve izin kullanımı. Kişi adı yazılmaz; 5 kişiden az
          grup gizlenir. Her görüntüleme ve dosya denetim kaydına yazılır.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <FormField id="ik-ay-baslangic" label="Başlangıç ayı">
            {(control) => (
              <Input
                {...control}
                type="month"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            )}
          </FormField>
          <FormField id="ik-ay-bitis" label="Bitiş ayı">
            {(control) => (
              <Input
                {...control}
                type="month"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            )}
          </FormField>
          {query === null ? null : (
            <>
              <CsvButton
                label="CSV indir"
                filename={hrReportFilename(from, to, 'csv')}
                busy={exporter.isPending}
                download={() => exporter.submit(query)}
              />
              <PdfDialogButton
                label="PDF"
                accessibleName="İK raporu PDF"
                title={HR_REPORT_TITLE}
                id={query}
                usePdf={useHrReportPdf}
              />
            </>
          )}
        </div>
        {'issue' in built ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {built.issue}
          </p>
        ) : null}
      </header>
      {query !== null && report.error ? (
        <div className="px-6 pb-6 max-[650px]:px-4">
          <QueryError error={report.error} onRetry={() => void report.refetch()} />
        </div>
      ) : null}
      {query !== null && report.isPending ? (
        <p role="status" className="px-6 pb-6 text-sm text-muted-foreground">
          Rapor yükleniyor…
        </p>
      ) : null}
      {data ? <Report data={data} /> : null}
    </section>
  )
}

function TurnoverRow({ label, row, min }: { label: string; row: HrHiddenTurnover; min: number }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      {hrTurnoverCells(row, min).map((cell, index) => (
        <TableCell key={TURNOVER_KEYS[index]} className={num}>
          {cell}
        </TableCell>
      ))}
    </TableRow>
  )
}

function Report({ data }: { data: HrReport }) {
  const min = data.minGroupSize
  const count = (value: number | null) => hrCountText(value, min)
  const hidden = hrHiddenText(min)
  const { totals } = data.turnover
  const { leave } = data
  return (
    <div className="grid gap-6 px-6 pb-6 max-[650px]:px-4">
      <StatGrid
        label={`İK özeti, ${hrPeriodLabel(data)}`}
        items={[
          { label: 'Dönem sonu personel', value: count(totals.closing) },
          { label: 'Giriş', value: count(totals.hires) },
          { label: 'Çıkış', value: count(totals.exits) },
          {
            label: 'Devir oranı',
            value: totals.suppressed ? hidden : hrRateText(totals.turnoverBasisPoints),
          },
          { label: 'Kalan yıllık izin', value: `${count(leave.balance.balanceDays)} gün` },
          { label: 'Rapor günleri', value: `${count(leave.medical.totalDays)} gün` },
        ]}
      />
      <div className="grid gap-2">
        <h3 className="font-semibold">Personel devir oranı</h3>
        <div className="overflow-x-auto">
          <Table aria-label="Personel devir oranı">
            <TableHeader>
              <TableRow>
                <TableHead>Grup</TableHead>
                <TableHead className="text-right">Dönem başı</TableHead>
                <TableHead className="text-right">Giriş</TableHead>
                <TableHead className="text-right">Çıkış</TableHead>
                <TableHead className="text-right">Dönem sonu</TableHead>
                <TableHead className="text-right">Ortalama</TableHead>
                <TableHead className="text-right">Devir oranı</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TurnoverRow label="Kurum toplamı" row={totals} min={min} />
              {data.turnover.byRole.map((row) => (
                <TurnoverRow
                  key={row.group}
                  label={HR_ROLE_GROUP_LABELS[row.group]}
                  row={row}
                  min={min}
                />
              ))}
              {data.turnover.byCenter.map((row) => (
                <TurnoverRow
                  key={row.id ?? 'atanmamis'}
                  label={`${row.path === null ? '' : `${row.path} · `}${row.name}${row.isActive ? '' : ' (pasif)'}`}
                  row={row}
                  min={min}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="grid content-start gap-2">
          <h3 className="font-semibold">Kıdem dağılımı</h3>
          <Table aria-label="Kıdem dağılımı">
            <TableHeader>
              <TableRow>
                <TableHead>Kıdem bandı</TableHead>
                <TableHead className="text-right">Personel</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.seniority.bands.map((band) => (
                <TableRow key={band.key}>
                  <TableCell>{SENIORITY_BAND_LABELS[band.key]}</TableCell>
                  <TableCell className={num}>{count(band.count)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell>Toplam</TableCell>
                <TableCell className={num}>{count(data.seniority.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div className="grid content-start gap-2">
          <h3 className="font-semibold">İzin kullanımı</h3>
          <Table aria-label="İzin kullanımı">
            <TableHeader>
              <TableRow>
                <TableHead>İzin türü</TableHead>
                <TableHead className="text-right">Kullanılan gün</TableHead>
                <TableHead className="text-right">Kullanan</TableHead>
                <TableHead className="text-right">Kişi başı</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leave.types.map((type) => (
                <TableRow key={type.code}>
                  <TableCell>{type.label}</TableCell>
                  <TableCell className={num}>{count(type.usedDays)}</TableCell>
                  <TableCell className={num}>{count(type.staffCount)}</TableCell>
                  <TableCell className={num}>
                    {type.suppressed ? hidden : hrDecimalText(type.perStaffDays) || '—'}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell>Toplam</TableCell>
                <TableCell className={num}>{count(leave.totals.usedDays)}</TableCell>
                <TableCell className={num}>{count(leave.totals.staffCount)}</TableCell>
                <TableCell className={num}>
                  {leave.totals.suppressed
                    ? hidden
                    : hrDecimalText(leave.totals.perStaffDays) || '—'}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="text-sm text-muted-foreground">
            Kalan yıllık izin {count(leave.balance.balanceDays)} gün (
            {count(leave.balance.staffCount)} personel
            {leave.balance.missingProfileCount > 0
              ? `; ${String(leave.balance.missingProfileCount)} personelin kıdem başlangıcı yok`
              : ''}
            ). Rapor günleri yalnız toplamdır: {count(leave.medical.totalDays)} gün.
          </p>
        </div>
      </div>
      <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
        {hrReportNotes(data).map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}
