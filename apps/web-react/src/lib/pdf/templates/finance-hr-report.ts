// İK raporu (DOM-FIN-117; ON-192): devir oranı, kıdem dağılımı ve izin kullanımı. Veri
// `purpose=pdf` ile okunan rapor yanıtıdır (okuma denetime düşer, K-401); burada yeniden
// hesaplanmaz. Kişi adı yoktur; küçük grup "<5" yazılır.
import type { HrReport } from '@kampus/react-shared/use-finance-hr-reports.ts'
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
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const HR_REPORT_TITLE = 'İK raporu'

const TURNOVER_COLUMNS = [
  { header: 'Grup', width: 50 },
  { header: 'Dönem başı', width: 20 },
  { header: 'Giriş', width: 16 },
  { header: 'Çıkış', width: 16 },
  { header: 'Dönem sonu', width: 20 },
  { header: 'Ortalama', width: 22 },
  { header: 'Devir oranı', width: 30 },
] as const
const SENIORITY_COLUMNS = [
  { header: 'Kıdem bandı', width: 120 },
  { header: 'Personel', width: 54 },
] as const
const LEAVE_COLUMNS = [
  { header: 'İzin türü', width: 70 },
  { header: 'Kullanılan gün', width: 34 },
  { header: 'Kullanan personel', width: 36 },
  { header: 'Kişi başı gün', width: 34 },
] as const

export const hrReportPdfFilename = (report: Pick<HrReport, 'from' | 'to'>) =>
  hrReportFilename(report.from, report.to, 'pdf')

/** Gizli hücre "<5", sayı olduğu gibi. */
export const hrCountText = (value: number | null, minGroupSize: number) =>
  value === null ? hrHiddenText(minGroupSize) : String(value)

/** Devir satırının hücreleri (ekran ve PDF aynı metni kullanır). */
export function hrTurnoverCells(row: HrHiddenTurnover, minGroupSize: number): string[] {
  if (row.suppressed) return Array.from({ length: 6 }, () => hrHiddenText(minGroupSize))
  return [
    String(row.opening),
    String(row.hires),
    String(row.exits),
    String(row.closing),
    hrDecimalText(row.averageHeadcount),
    hrRateText(row.turnoverBasisPoints),
  ]
}

export function hrReportDocument(
  measurer: TextMeasurer,
  report: HrReport,
  options: TemplateOptions,
): PdfDocument {
  const min = report.minGroupSize
  const count = (value: number | null) => hrCountText(value, min)
  const doc = new DocumentLayout(measurer, {
    label: 'İK RAPORU',
    badge: 'KİŞİ ADI YOK',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: hrReportPdfFilename(report).replace(/\.pdf$/, ''),
    footerNote: `Kurum içi özettir; ${String(min)} kişiden az grup gizlenir.`,
  })
  const { totals } = report.turnover
  doc.heading(HR_REPORT_TITLE, hrPeriodLabel(report))
  doc.metrics([
    ['DÖNEM SONU PERSONEL', count(totals.closing)],
    ['GİRİŞ', count(totals.hires)],
    ['ÇIKIŞ', count(totals.exits)],
    ['DEVİR ORANI', totals.suppressed ? hrHiddenText(min) : hrRateText(totals.turnoverBasisPoints)],
  ])

  doc.section('Personel devir oranı')
  doc.table(
    TURNOVER_COLUMNS,
    [
      ['Kurum toplamı', ...hrTurnoverCells(totals, min)],
      ...report.turnover.byRole.map((row) => [
        HR_ROLE_GROUP_LABELS[row.group],
        ...hrTurnoverCells(row, min),
      ]),
      ...report.turnover.byCenter.map((row) => [
        row.path === null ? row.name : `${row.path} · ${row.name}`,
        ...hrTurnoverCells(row, min),
      ]),
    ],
    true,
  )

  doc.section('Kıdem dağılımı')
  doc.table(
    SENIORITY_COLUMNS,
    [
      ...report.seniority.bands.map((band) => [SENIORITY_BAND_LABELS[band.key], count(band.count)]),
      ['Toplam', count(report.seniority.total)],
    ],
    true,
  )

  const { leave } = report
  doc.section('İzin kullanımı')
  doc.table(
    LEAVE_COLUMNS,
    [
      ...leave.types.map((type) => [
        type.label,
        count(type.usedDays),
        count(type.staffCount),
        type.suppressed ? hrHiddenText(min) : hrDecimalText(type.perStaffDays) || '—',
      ]),
      [
        'Toplam',
        count(leave.totals.usedDays),
        count(leave.totals.staffCount),
        leave.totals.suppressed
          ? hrHiddenText(min)
          : hrDecimalText(leave.totals.perStaffDays) || '—',
      ],
    ],
    true,
  )
  doc.fields([
    ['Kalan yıllık izin bakiyesi', `${count(leave.balance.balanceDays)} gün`],
    ['Bakiyesi hesaplanan personel', count(leave.balance.staffCount)],
    ['Rapor günleri (toplam)', `${count(leave.medical.totalDays)} gün`],
  ])

  doc.section('Notlar')
  for (const note of hrReportNotes(report)) doc.paragraph(note, 9)
  return doc.finish()
}
