// Cari ekstre: veri API ekstresinden gelir, bakiye burada yeniden hesaplanmaz (IST-107, DOM-FIN-054).
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  statementLineLabel,
  type StudentStatement,
} from '@kampus/school-core/lib/finance-statement.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

const COLUMNS = [
  { header: 'Tarih', width: 26 },
  { header: 'İşlem', width: 64 },
  { header: 'Borç', width: 28 },
  { header: 'Alacak', width: 28 },
  { header: 'Bakiye', width: 28 },
] as const

const amountOf = (cents: number) => (cents === 0 ? '—' : money(cents))

export function statementFilename(studentId: string): string {
  return `cari-ekstre-${studentId.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120)}.pdf`
}

export function studentStatementDocument(
  measurer: TextMeasurer,
  statement: StudentStatement,
  options: TemplateOptions & { studentName: string },
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    label: 'CARİ EKSTRE',
    badge: 'EKSTRE',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `ekstre-${statement.studentId}`,
    footerNote:
      'Belgenin oluşturulduğu andaki kayıtları gösterir; fatura veya makbuz yerine geçmez.',
  })
  doc.heading('Cari ekstre', options.studentName)
  doc.metrics([
    ['TOPLAM BORÇ', money(statement.totalCents)],
    ['ÖDENEN', money(statement.paidCents)],
    ['KALAN', money(statement.openCents)],
  ])
  if (statement.overdueCents > 0)
    doc.paragraph(
      `Gecikmiş tutar: ${money(statement.overdueCents)} (${String(statement.overdueCount)} taksit).`,
    )
  doc.section('Hesap hareketleri')
  doc.table(
    COLUMNS,
    statement.lines.map((line) => [
      dateLabel(line.date, { year: 'numeric' }),
      statementLineLabel(line),
      amountOf(line.debitCents),
      amountOf(line.creditCents),
      money(line.balanceCents),
    ]),
    true,
  )
  doc.fields([
    ['Borç toplamı', money(statement.debitTotalCents)],
    ['Alacak toplamı', money(statement.creditTotalCents)],
  ])
  if (statement.unappliedCents > 0)
    doc.paragraph(
      `Taksitlere dağıtılmayan ${money(statement.unappliedCents)} iade alacağıdır; kalan tutardan düşülmemiştir.`,
    )
  return doc.finish()
}
