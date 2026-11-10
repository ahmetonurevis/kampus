// Demirbaş sayım tutanağı (DOM-FIN-087; ON-237): kurum, kapsam, başlangıç ve kapanış, özet, sonra
// bulunamayanlar, yanlış konumdakiler, listede olmayanlar ve kayıtlı yerinde bulunanlar; altta
// sayımı yapan ve onaylayan imza alanları. Kişi verisi yoktur (okutan kişi yazılmaz).
import type {
  FixedAssetCount,
  FixedAssetCountItem,
} from '@kampus/react-shared/use-finance-fixed-asset-counts.ts'
import {
  FIXED_ASSET_COUNT_OUTCOME_LABELS,
  FIXED_ASSET_COUNT_STATUS_LABELS,
  fixedAssetCountOutcome,
  fixedAssetCountScanTime,
  fixedAssetCountScopeLabel,
} from '@kampus/school-core/lib/finance-fixed-asset-counts.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const FIXED_ASSET_COUNT_TITLE = 'Demirbaş sayım tutanağı'

const BADGES = { open: 'SÜRÜYOR', completed: 'TAMAMLANDI', cancelled: 'İPTAL' } as const

const when = (iso: string | null) =>
  iso === null ? '—' : `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

const place = (campusName: string | null, location: string | null) =>
  location === null ? '—' : campusName ? `${campusName} · ${location}` : location

const RECORDED_COLUMNS = [
  { header: 'Etiket', width: 34 },
  { header: 'Demirbaş', width: 64 },
  { header: 'Kayıtlı yer', width: 76 },
] as const
const MOVED_COLUMNS = [
  { header: 'Etiket', width: 30 },
  { header: 'Demirbaş', width: 44 },
  { header: 'Kayıtlı yer', width: 46 },
  { header: 'Sayılan yer', width: 54 },
] as const

/** Dosya adı: sayımın başladığı gün ve durum (kişi adı yok). */
export function fixedAssetCountFilename(count: Pick<FixedAssetCount, 'startedAt' | 'status'>) {
  return `demirbas-sayimi-${count.startedAt.slice(0, 10)}-${count.status}.pdf`
}

export function fixedAssetCountDocument(
  measurer: TextMeasurer,
  count: FixedAssetCount,
  items: readonly FixedAssetCountItem[],
  options: TemplateOptions,
): PdfDocument {
  const generatedAt = options.generatedAt ?? new Date()
  const scope = fixedAssetCountScopeLabel(count)
  const outcome = (item: FixedAssetCountItem) => fixedAssetCountOutcome(item.result, count.status)
  const doc = new DocumentLayout(measurer, {
    label: 'DEMİRBAŞ SAYIM TUTANAĞI',
    badge: BADGES[count.status],
    institution: options.institution,
    generatedAt,
    reference: `${scope} · ${count.startedAt.slice(0, 10)}`,
    footerNote: 'Kurum içi sayım belgesidir; demirbaş kayıtları tutanakla kendiliğinden değişmez.',
  })
  doc.heading(FIXED_ASSET_COUNT_TITLE, scope)
  doc.fields([
    ['Kurum', options.institution],
    ['Durum', FIXED_ASSET_COUNT_STATUS_LABELS[count.status]],
    ['Başlangıç', when(count.startedAt)],
    [
      count.status === 'cancelled' ? 'İptal' : 'Tamamlanma',
      when(count.status === 'cancelled' ? count.cancelledAt : count.completedAt),
    ],
    ...(count.note ? ([['Açıklama', count.note]] as const) : []),
  ])
  const { summary } = count
  doc.metrics([
    ['Beklenen', String(summary.expected)],
    ['Bulundu', String(summary.found)],
    ['Yanlış konumda', String(summary.misplaced)],
    [count.status === 'completed' ? 'Bulunamadı' : 'Okunmadı', String(summary.pending)],
    ['Listede yoktu', String(summary.extra)],
  ])
  const pending = items.filter((item) => item.result === 'pending')
  const moved = items.filter((item) => item.result === 'misplaced')
  const found = items.filter((item) => item.result === 'found')
  const recordedRows = (list: readonly FixedAssetCountItem[]) =>
    list.map((item) => [
      item.tagNumber,
      item.assetName,
      place(item.recordedCampusName, item.recordedLocation),
    ])
  if (pending.length > 0) {
    doc.section(
      `${count.status === 'completed' ? 'Bulunamayanlar' : 'Okunmayanlar'} (${String(pending.length)})`,
    )
    doc.table(RECORDED_COLUMNS, recordedRows(pending), true)
  }
  if (moved.length > 0) {
    doc.section(`Yanlış konumda bulunanlar (${String(moved.length)})`)
    doc.table(
      MOVED_COLUMNS,
      moved.map((item) => [
        item.inScope ? item.tagNumber : `${item.tagNumber} (listede yoktu)`,
        item.assetName,
        place(item.recordedCampusName, item.recordedLocation),
        `${place(item.observedCampusName, item.observedLocation)}${
          item.relocatedAt === null ? '' : ' · kayıt düzeltildi'
        }`,
      ]),
      true,
    )
  }
  if (found.length > 0) {
    doc.section(`${FIXED_ASSET_COUNT_OUTCOME_LABELS.found} (${String(found.length)})`)
    doc.table(
      [
        { header: 'Etiket', width: 34 },
        { header: 'Demirbaş', width: 64 },
        { header: 'Yer', width: 46 },
        { header: 'Okutma', width: 30 },
      ],
      found.map((item) => [
        item.inScope ? item.tagNumber : `${item.tagNumber} (listede yoktu)`,
        item.assetName,
        place(item.recordedCampusName, item.recordedLocation),
        fixedAssetCountScanTime(item.scannedAt),
      ]),
      true,
    )
  }
  if (items.every((item) => outcome(item) === 'pending') && items.length > 0)
    doc.paragraph('Bu sayımda henüz demirbaş okutulmadı.')
  doc.signatures('Sayımı yapan — ad soyad, imza', 'Onaylayan (kurum adına) — ad soyad, imza')
  return doc.finish()
}
