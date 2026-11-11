// Kimyasal envanter raporu (DOM-FIN-090; ON-234): kurum, rapor günü, özet ve depo başına parti
// tablosu (kod, kimyasal, CAS, piktogram kodları, sinyal kelimesi, parti, son kullanma, miktar).
// Piktogramlar metin kodu olarak yazılır (K-243); kişi verisi yoktur. Altta düzenleyen ve onaylayan
// imza alanları.
import type { ChemicalInventoryRow } from '@kampus/react-shared/use-finance-chemicals.ts'
import {
  CHEMICAL_EXPIRY_STATUS_LABELS,
  CHEMICAL_SIGNAL_WORD_LABELS,
  lotLabel,
  pictogramsText,
} from '@kampus/school-core/lib/finance-chemicals.ts'
import { STOCK_UNIT_LABELS } from '@kampus/school-core/lib/finance-inventory.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const CHEMICAL_INVENTORY_TITLE = 'Kimyasal envanter raporu'

const COLUMNS = [
  { header: 'Kod', width: 18 },
  { header: 'Kimyasal', width: 36 },
  { header: 'CAS', width: 20 },
  { header: 'Piktogram', width: 24 },
  { header: 'Sinyal', width: 14 },
  { header: 'Parti', width: 22 },
  { header: 'Son kullanma', width: 24 },
  { header: 'Miktar', width: 16 },
] as const

const day = (value: string) => dateLabel(`${value}T09:00:00.000Z`, { year: 'numeric' })

/** Dosya adı: rapor günü ve varsa depo süzgeci (kişi adı yok). */
export function chemicalInventoryFilename(generatedAt: Date, filtered: boolean) {
  return `kimyasal-envanter-${dayKey(generatedAt)}${filtered ? '-depo' : ''}.pdf`
}

export function chemicalInventoryDocument(
  measurer: TextMeasurer,
  rows: readonly ChemicalInventoryRow[],
  options: TemplateOptions & { scope: string },
): PdfDocument {
  const generatedAt = options.generatedAt ?? new Date()
  const doc = new DocumentLayout(measurer, {
    label: 'KİMYASAL ENVANTER',
    badge: 'ENVANTER',
    institution: options.institution,
    generatedAt,
    reference: `${options.scope} · ${dayKey(generatedAt)}`,
    footerNote: 'Kurum içi envanter dökümüdür; güvenlik bilgi formunun ve etiketin yerine geçmez.',
  })
  doc.heading(CHEMICAL_INVENTORY_TITLE, options.scope)
  const lots = rows.flatMap((row) => row.lots)
  doc.fields([
    ['Kurum', options.institution],
    ['Kapsam', options.scope],
    ['Rapor günü', dateLabel(generatedAt, { year: 'numeric' })],
  ])
  doc.metrics([
    ['Kimyasal × depo', String(rows.length)],
    ['Parti', String(lots.length)],
    ['Süresi geçen', String(lots.filter((lot) => lot.status === 'expired').length)],
    ['30 gün içinde', String(lots.filter((lot) => lot.status === 'expiring').length)],
    ['GBF eksik', String(rows.filter((row) => !row.hasSds).length)],
  ])
  if (rows.length === 0) {
    doc.paragraph('Stokta kimyasal yok.')
  }
  const warehouses = new Map<string, ChemicalInventoryRow[]>()
  for (const row of rows) {
    const list = warehouses.get(row.warehouseId) ?? []
    list.push(row)
    warehouses.set(row.warehouseId, list)
  }
  for (const list of warehouses.values()) {
    const first = list[0]
    if (first === undefined) continue
    doc.section(
      first.campusName ? `${first.warehouseName} · ${first.campusName}` : first.warehouseName,
    )
    doc.table(
      COLUMNS,
      list.flatMap((row) =>
        row.lots.map((lot) => [
          row.code,
          row.storageClass ? `${row.name} (${row.storageClass})` : row.name,
          row.casNumber ?? '—',
          pictogramsText(row.hazardPictograms),
          row.signalWord === null ? '—' : CHEMICAL_SIGNAL_WORD_LABELS[row.signalWord],
          lotLabel(lot),
          lot.expiryDate === null
            ? '—'
            : lot.status === 'ok'
              ? day(lot.expiryDate)
              : `${day(lot.expiryDate)} ${CHEMICAL_EXPIRY_STATUS_LABELS[lot.status].toLocaleLowerCase('tr')}`,
          `${String(lot.quantity)} ${STOCK_UNIT_LABELS[row.unit]}`,
        ]),
      ),
      true,
    )
  }
  doc.signatures('Düzenleyen — ad soyad, imza', 'Onaylayan (kurum adına) — ad soyad, imza')
  return doc.finish()
}
