// Stok sayımı fark raporu (DOM-FIN-081; ON-231): depo, kampüs, sayım zamanları, durum, sayılan
// kalemlerde sistem (anlık görüntü), sayım sırasındaki hareket, beklenen, sayılan, fark ve fark
// tutarı; sayılmayan kalemler ayrı tabloda (değişmez, K-230) ve sayım tutanağı imzaları. Rakamlar
// API yanıtından gelir, burada yeniden hesaplanmaz. Açık sayımın raporu "TASLAK" işaretlidir.
import type { StockCountDetail } from '@kampus/react-shared/use-finance-stock-counts.ts'
import { STOCK_UNIT_LABELS } from '@kampus/school-core/lib/finance-inventory.ts'
import { STOCK_COUNT_STATUS_LABELS } from '@kampus/school-core/lib/finance-stock-counts.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { COLORS, DocumentLayout, PAGE, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const STOCK_COUNT_REPORT_TITLE = 'Stok sayımı fark raporu'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const timeText = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
const signed = (value: number) => (value > 0 ? `+${String(value)}` : String(value))
const signedMoney = (cents: number | null) =>
  cents === null ? '—' : cents > 0 ? `+${money(cents)}` : money(cents)

const COUNTED_COLUMNS = [
  { header: 'Ürün', width: 52 },
  { header: 'Sistem', width: 20 },
  { header: 'Hareket', width: 18 },
  { header: 'Beklenen', width: 20 },
  { header: 'Sayılan', width: 18 },
  { header: 'Fark', width: 16 },
  { header: 'Fark tutarı', width: 30 },
] as const
const UNCOUNTED_COLUMNS = [
  { header: 'Ürün', width: 134 },
  { header: 'Sistem', width: 40 },
] as const

/** Belge numarası: sayımın başlangıç günü (Europe/Istanbul) ve kimliğin ilk sekiz hanesi; ayrı sayaç yok. */
export const stockCountReference = (count: Pick<StockCountDetail, 'id' | 'startedAt'>) =>
  `SAY-${dayKey(count.startedAt).replaceAll('-', '')}-${count.id.slice(0, 8).toUpperCase()}`

export const stockCountFilename = (count: Pick<StockCountDetail, 'id' | 'startedAt'>) =>
  `stok-sayimi-${stockCountReference(count)}.pdf`

const itemText = (row: { itemCode: string; itemName: string }) =>
  `${row.itemCode} · ${row.itemName}`

function statusFields(count: StockCountDetail): [string, string][] {
  if (count.status === 'completed')
    return [
      ['Tamamlayan', `${count.completedByName ?? '—'} · ${timeText(count.completedAt ?? '')}`],
      ['Düzeltme günü', count.adjustmentDate ? dayText(count.adjustmentDate) : '—'],
    ]
  if (count.status === 'cancelled')
    return [
      ['İptal eden', `${count.cancelledByName ?? '—'} · ${timeText(count.cancelledAt ?? '')}`],
      ['İptal gerekçesi', count.cancelReason ?? '—'],
    ]
  return []
}

function draftBand(doc: DocumentLayout, count: StockCountDetail) {
  const text =
    count.status === 'open'
      ? 'Sayım sürüyor; rakamlar rapor alındığı andaki değerlerdir, stok henüz düzeltilmedi.'
      : 'Sayım iptal edildi; stok düzeltilmedi.'
  doc.ensure(16)
  doc.box(PAGE.left, doc.y, PAGE.contentWidth, 11, COLORS.orangeSoft, 3)
  doc.text(
    count.status === 'open' ? 'TASLAK' : 'İPTAL EDİLDİ',
    PAGE.left + 5,
    doc.y + 7.5,
    12,
    COLORS.orangeInk,
  )
  doc.text(text, PAGE.right - 5, doc.y + 7, 8, COLORS.orangeInk, 'right')
  doc.y += 16
}

/** Fark raporu PDF'i: sayım bilgileri, özet, sayılan ve sayılmayan kalemler, imzalar. */
export function stockCountDocument(
  measurer: TextMeasurer,
  count: StockCountDetail,
  options: TemplateOptions,
): PdfDocument {
  const reference = stockCountReference(count)
  const doc = new DocumentLayout(measurer, {
    label: 'STOK SAYIMI',
    badge:
      count.status === 'completed' ? 'TAMAMLANDI' : count.status === 'open' ? 'TASLAK' : 'İPTAL',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference,
    footerNote:
      'Kurum içi sayım tutanağıdır. Birim maliyet son alış fiyatıdır (KDV hariç); stok değerlemesi değildir.',
  })
  doc.heading(STOCK_COUNT_REPORT_TITLE, reference)
  if (count.status !== 'completed') draftBand(doc, count)
  doc.fields([
    ['Kurum', options.institution],
    [
      'Depo',
      count.campusName ? `${count.warehouseName} · ${count.campusName}` : count.warehouseName,
    ],
    ['Durum', STOCK_COUNT_STATUS_LABELS[count.status]],
    ['Başlatan', `${count.startedByName ?? '—'} · ${timeText(count.startedAt)}`],
    ...statusFields(count),
    ...(count.note ? ([['Not', count.note]] satisfies [string, string][]) : []),
  ])
  const { totals } = count
  doc.metrics([
    ['SAYILAN KALEM', String(totals.countedItems)],
    ['FARKLI KALEM', String(totals.differenceItems)],
    ['NET FARK TUTARI', signedMoney(totals.netCents)],
  ])
  doc.section('Sayılan kalemler')
  if (count.counted.length === 0) doc.paragraph('Hiç kalem sayılmadı.', 9)
  else
    doc.table(
      COUNTED_COLUMNS,
      [
        ...count.counted.map((row) => {
          const unit = STOCK_UNIT_LABELS[row.unit]
          return [
            itemText(row),
            `${String(row.systemQuantity)} ${unit}`,
            row.movementQuantity === 0 ? '—' : signed(row.movementQuantity),
            String(row.expectedQuantity),
            String(row.countedQuantity),
            row.difference === 0 ? '0' : signed(row.difference),
            row.difference === 0 ? '' : signedMoney(row.differenceCents),
          ]
        }),
        ['Toplam', '', '', '', '', '', signedMoney(totals.netCents)],
      ],
      true,
    )
  doc.paragraph(
    `Fark = sayılan − beklenen; beklenen, anlık görüntüye sayım başladıktan sonra kart sayılana kadar yazılan hareketlerin eklenmesidir. Fazla tutarı ${money(totals.surplusCents)}, eksik tutarı ${money(totals.shortageCents)}${totals.unpricedDifferenceItems > 0 ? `; ${String(totals.unpricedDifferenceItems)} farklı kalemin birim maliyeti bilinmediği için tutara girmedi` : ''}.`,
    8,
  )
  if (count.uncounted.length > 0) {
    doc.section('Sayılmayan kalemler')
    doc.table(
      UNCOUNTED_COLUMNS,
      count.uncounted.map((row) => [
        itemText(row),
        `${String(row.systemQuantity)} ${STOCK_UNIT_LABELS[row.unit]}`,
      ]),
    )
    doc.paragraph('Sayılmayan kalemlerin miktarı değişmez; sıfıra çekilmez.', 8)
  }
  doc.signatures('Sayımı yapan', 'Depo sorumlusu', true)
  return doc.finish()
}
