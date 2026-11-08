// Gün sonu raporu (IST-113, DOM-FIN-036): rakamlar API raporundan gelir, burada yeniden hesaplanmaz.
// Kapalı günde kapanış anının özeti yazılır; belge kurum içi özettir. O gün ödenen ayrılış iadesi
// banka satırında ayrı sütundur ve netten düşer (M-13).
import type { FinanceDayReport } from '@kampus/react-shared/use-finance-day-closings.ts'
import { receiptNumberLabel } from '@kampus/school-core/lib/finance-receipt.ts'
import { dateLabel, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import { PAYMENT_METHOD_LABELS } from '@kampus/school-core/lib/payments.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import { learnerTerm, type LearnerTerm, type LearnerTermOptions } from './finance-shared.ts'
import type { TemplateOptions } from './shared.ts'

export const DAY_CLOSING_TITLE = 'Gün sonu raporu'

const METHOD_COLUMNS = [
  { header: 'Yöntem', width: 34 },
  { header: 'Adet', width: 20 },
  { header: 'Tahsilat', width: 30 },
  { header: 'İptal', width: 30 },
  { header: 'İade', width: 30 },
  { header: 'Net', width: 30 },
] as const
/** Tahsilat / iptal / iade adedi; sütun dar olduğu için boşluksuz yazılır. */
const countsOf = (item: {
  collectedCount: number
  reversedCount: number
  refundPaidCount: number
}) => [item.collectedCount, item.reversedCount, item.refundPaidCount].join('/')
// Kayıtlı kişi sütunu kurum türüne göre adlandırılır: okulda öğrenci, dil okulu ve kursta kursiyer.
const lineColumns = (learner: LearnerTerm) =>
  [
    { header: 'Dekont', width: 24 },
    { header: learner, width: 46 },
    { header: 'Yöntem', width: 30 },
    { header: 'Referans', width: 44 },
    { header: 'Tutar', width: 30 },
  ] as const
const refundColumns = (learner: LearnerTerm) =>
  [
    { header: learner, width: 70 },
    { header: 'Kurum banka hesabı', width: 74 },
    { header: 'Tutar', width: 30 },
  ] as const
const reversalColumns = (learner: LearnerTerm) =>
  [
    { header: 'Dekont', width: 24 },
    { header: learner, width: 36 },
    { header: 'Ödeme günü', width: 26 },
    { header: 'Gerekçe', width: 58 },
    { header: 'Tutar', width: 30 },
  ] as const

const dayLabelOf = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const stampOf = (at: string) => `${dateLabel(at, { year: 'numeric' })} ${timeLabel(at)}`

/** Fark işaretiyle yazılır: artı fazla, eksi eksik. */
export function cashDifferenceLabel(cents: number): string {
  if (cents === 0) return 'Fark yok'
  return cents > 0 ? `${money(cents)} fazla` : `${money(-cents)} eksik`
}

export function dayClosingFilename(closingDate: string): string {
  return `gun-sonu-${closingDate}.pdf`
}

type Rows = readonly (readonly unknown[])[]
type Columns = Parameters<DocumentLayout['table']>[0]

/**
 * Sıkı tablo. `keepLastRow` ise son satırdan önce sayfa kırılır: son satır (başlık yeni sayfada
 * tekrarlanır) imza alanıyla aynı sayfada kalır. Tek satırlı tabloda kırma bölümün başındadır.
 */
function table(doc: DocumentLayout, columns: Columns, rows: Rows, keepLastRow: boolean) {
  if (!keepLastRow || rows.length < 2) {
    doc.table(columns, rows, true)
    return
  }
  doc.table(columns, rows.slice(0, -1), true)
  doc.newPage()
  doc.table(columns, rows.slice(-1), true)
}

/** İmza alanından önceki son bölüm. */
type Tail = 'reversals' | 'refunds' | 'closing' | 'history'

/**
 * Raporu yazar. `keepTail` ise imzadan önceki son içerik birimi (son tablo satırı, son paragraf ya
 * da tek birimli son bölüm) yeni sayfaya alınır ki imza alanı tek başına kalmasın (ON-322).
 */
function writeDayClosing(
  measurer: TextMeasurer,
  report: FinanceDayReport,
  options: TemplateOptions & LearnerTermOptions,
  keepTail: boolean,
): { document: PdfDocument; signatureAlone: boolean } {
  const { summary, closing } = report
  const learner = learnerTerm(options.institutionType)
  const tail: Tail =
    report.history.length > 0
      ? 'history'
      : closing
        ? 'closing'
        : report.refunds.length > 0
          ? 'refunds'
          : 'reversals'
  const keep = (block: Tail) => keepTail && tail === block
  const doc = new DocumentLayout(measurer, {
    label: 'GÜN SONU RAPORU',
    badge: closing ? 'KAPATILDI' : 'AÇIK GÜN',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `gun-sonu-${report.closingDate}`,
    footerNote: 'Kurum içi gün sonu özetidir; kasa defteri, makbuz veya fatura yerine geçmez.',
  })
  doc.heading(DAY_CLOSING_TITLE, dayLabelOf(report.closingDate))
  doc.metrics([
    ['TAHSİLAT', money(summary.collectedCents)],
    ['İPTAL', money(summary.reversedCents)],
    ['İADE ÖDEMESİ', money(summary.refundPaidCents)],
    ['NET', money(summary.netCents)],
  ])
  if (!closing) doc.paragraph('Bu gün henüz kapatılmadı; rakamlar kesinleşmemiştir.')

  doc.section('Ödeme yöntemine göre')
  doc.table(
    METHOD_COLUMNS,
    [
      ...summary.methods.map((item) => [
        PAYMENT_METHOD_LABELS[item.method],
        countsOf(item),
        money(item.collectedCents),
        money(item.reversedCents),
        money(item.refundPaidCents),
        money(item.netCents),
      ]),
      [
        'Toplam',
        countsOf(summary),
        money(summary.collectedCents),
        money(summary.reversedCents),
        money(summary.refundPaidCents),
        money(summary.netCents),
      ],
    ],
    true,
  )

  doc.section('Tahsilatlar')
  if (report.collected.length === 0) doc.paragraph('Bu gün tahsilat yok.')
  else
    doc.table(
      lineColumns(learner),
      report.collected.map((line) => [
        receiptNumberLabel(line),
        line.studentName ?? '—',
        PAYMENT_METHOD_LABELS[line.method],
        line.reference ?? '—',
        money(line.amountCents),
      ]),
      true,
    )

  if (keep('reversals') && report.reversed.length < 2) doc.newPage()
  doc.section('İptaller')
  if (report.reversed.length === 0) doc.paragraph('Bu gün iptal yok.')
  else
    table(
      doc,
      reversalColumns(learner),
      report.reversed.map((line) => [
        receiptNumberLabel(line),
        line.studentName ?? '—',
        dateLabel(line.paidAt, { year: 'numeric' }),
        line.reversalReason ?? '—',
        money(line.amountCents),
      ]),
      keep('reversals'),
    )

  // İade bölümü yalnız iade ödenen günde yazılır; tutarı özette ve yöntem tablosunda her gün vardır.
  if (report.refunds.length > 0) {
    if (keep('refunds') && report.refunds.length < 2) doc.newPage()
    doc.section('İade ödemeleri')
    table(
      doc,
      refundColumns(learner),
      report.refunds.map((line) => [
        line.studentName ?? '—',
        line.bankAccountLabel ?? '—',
        money(line.amountCents),
      ]),
      keep('refunds'),
    )
  }

  if (closing) {
    doc.section('Kasa sayımı')
    if (closing.cash)
      doc.fields([
        ['Açılış kasası', money(closing.cash.openingCents)],
        ['Günün net nakdi', money(report.cashNetCents)],
        ['Beklenen nakit', money(closing.cash.expectedCents)],
        ['Sayılan nakit', money(closing.cash.countedCents)],
        ['Kasa farkı', cashDifferenceLabel(closing.cash.differenceCents)],
      ])
    else doc.paragraph('Nakit tahsilat kapalı ve hareket olmadığı için kasa sayılmadı.')
    if (keep('closing')) doc.newPage()
    doc.section('Kapanış')
    doc.fields([
      ['Kapatan', closing.closedByName ?? '—'],
      ['Kapanış anı', stampOf(closing.closedAt)],
      ...(closing.note ? ([['Açıklama', closing.note]] as const) : []),
    ])
  }

  if (report.history.length > 0) {
    if (keep('history') && report.history.length < 2) doc.newPage()
    doc.section('Önceki kapanışlar')
    report.history.forEach((item, index) => {
      if (keep('history') && index > 0 && index === report.history.length - 1) doc.newPage()
      doc.paragraph(
        `${item.closedByName ?? '—'} ${stampOf(item.closedAt)} tarihinde kapattı (net ${money(item.summary.netCents)}); ${item.reopenedByName ?? '—'} ${item.reopenedAt ? stampOf(item.reopenedAt) : '—'} tarihinde yeniden açtı. Gerekçe: ${item.reopenReason ?? '—'}`,
      )
    })
  }

  const pages = doc.pages.length
  doc.signatures('Kapatan', 'Yönetici', true)
  return { document: doc.finish(), signatureAlone: doc.pages.length > pages }
}

/**
 * Gün sonu raporu; tahsilat ve iptal tablolarının kişi sütunu kurum türünü izler (DOM-KAY-012).
 * İmza alanı tek başına sayfaya düşmez (ON-322): sığmazsa son içerik birimiyle birlikte yeni
 * sayfaya geçer. Sayfa sayısı artarsa (son birim zaten sayfa başındaydı) düz yerleşim kalır.
 */
export function financeDayClosingDocument(
  measurer: TextMeasurer,
  report: FinanceDayReport,
  options: TemplateOptions & LearnerTermOptions,
): PdfDocument {
  const plain = writeDayClosing(measurer, report, options, false)
  if (!plain.signatureAlone) return plain.document
  const kept = writeDayClosing(measurer, report, options, true)
  return !kept.signatureAlone && kept.document.pages.length <= plain.document.pages.length
    ? kept.document
    : plain.document
}
