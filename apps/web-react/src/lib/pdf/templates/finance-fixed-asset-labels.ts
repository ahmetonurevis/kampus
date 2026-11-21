// Demirbaş etiket sayfası (DOM-FIN-087; ON-237): A4 üzerinde 3 × 8 etiket (70 × 37 mm, piyasadaki
// 24'lü yapışkan etiket kâğıdıyla aynı ızgara, kenar boşluğu yok). Her etikette karekod, etiket
// numarası, demirbaş adı ve kurum adı vardır. Karekod yalnız etiket numarasını taşır (K-233; kişi
// verisi yok); okuyucu klavye gibi yazar ve sayım ekranındaki kod alanına düşer. Sayfa başlığı ve
// altbilgi çizilmez: etiket kâğıdında boşluk yoktur. Kesim için soluk kılavuz çizgileri vardır.
import type { QrModules } from '../layout.ts'
import { COLORS, PAGE, rgb, type PdfDocument, type PdfPage, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const FIXED_ASSET_LABELS_TITLE = 'Demirbaş etiketleri'

export const LABEL_GRID = { columns: 3, rows: 8, width: 70, height: PAGE.height / 8 } as const
export const LABELS_PER_PAGE = LABEL_GRID.columns * LABEL_GRID.rows
const QR_SIZE = 27
const PADDING = 3
const TEXT_X = PADDING + QR_SIZE + 2
const TEXT_WIDTH = LABEL_GRID.width - TEXT_X - PADDING
const WHITE = rgb('#FFFFFF')
/** Karekodun sessiz bölgesi (modül sayısı); okuyucunun kodu ayırt etmesi için gerekir. */
const QUIET_ZONE = 4

export type FixedAssetLabel = { tagNumber: string; name: string; qr: QrModules }

/** Karekod: koyu modüller satır satır birleşik dikdörtgenler; görüntü gömülmez, PDF vektör kalır. */
function drawQr(page: PdfPage, matrix: QrModules, x: number, y: number, size: number) {
  const cell = size / (matrix.size + QUIET_ZONE * 2)
  page.ops.push({ kind: 'rect', x, y, width: size, height: size, radius: 0, fill: WHITE })
  matrix.dark.forEach((row, rowIndex) => {
    let start = -1
    for (let column = 0; column <= row.length; column++) {
      const dark = row[column] === true
      if (dark && start < 0) start = column
      if (!dark && start >= 0) {
        page.ops.push({
          kind: 'rect',
          x: x + (QUIET_ZONE + start) * cell,
          y: y + (QUIET_ZONE + rowIndex) * cell,
          width: (column - start) * cell,
          height: cell,
          radius: 0,
          fill: COLORS.ink,
        })
        start = -1
      }
    }
  })
}

function drawGuides(page: PdfPage) {
  for (let column = 1; column < LABEL_GRID.columns; column++)
    for (let row = 0; row < LABEL_GRID.rows; row++) {
      // Dikey kılavuz kısa çizgilerle (ince dikdörtgen) çizilir; çizim komutu yalnız yatay çizgi bilir.
      page.ops.push({
        kind: 'rect',
        x: column * LABEL_GRID.width - 0.05,
        y: row * LABEL_GRID.height + 2,
        width: 0.1,
        height: LABEL_GRID.height - 4,
        radius: 0,
        fill: COLORS.line,
      })
    }
  for (let row = 1; row < LABEL_GRID.rows; row++)
    page.ops.push({
      kind: 'line',
      x: 0,
      y: row * LABEL_GRID.height,
      width: PAGE.width,
      color: COLORS.line,
      thickness: 0.1,
    })
}

/** Metni verilen satır sayısına sığdırır; taşan son satır "…" ile biter. */
function clamp(measurer: TextMeasurer, text: string, width: number, size: number, lines: number) {
  const wrapped = measurer.wrap(text, width, size)
  if (wrapped.length <= lines) return wrapped
  const kept = wrapped.slice(0, lines)
  let last = kept[lines - 1] ?? ''
  while (last.length > 1 && measurer.width(`${last}…`, size) > width) last = last.slice(0, -1)
  kept[lines - 1] = `${last.trimEnd()}…`
  return kept
}

function drawLabel(
  page: PdfPage,
  measurer: TextMeasurer,
  label: FixedAssetLabel,
  institution: string,
  index: number,
) {
  const x = (index % LABEL_GRID.columns) * LABEL_GRID.width
  const y = Math.floor(index / LABEL_GRID.columns) * LABEL_GRID.height
  const text = (value: string, dx: number, dy: number, size: number, color = COLORS.ink) =>
    page.ops.push({ kind: 'text', text: value, x: x + dx, y: y + dy, size, color, align: 'left' })
  drawQr(page, label.qr, x + PADDING, y + (LABEL_GRID.height - QR_SIZE) / 2, QR_SIZE)
  let line = 10
  for (const part of clamp(measurer, label.tagNumber, TEXT_WIDTH, 10, 2)) {
    text(part, TEXT_X, line, 10, COLORS.sapphire)
    line += 4.5
  }
  line += 1
  for (const part of clamp(measurer, label.name, TEXT_WIDTH, 7, 3)) {
    text(part, TEXT_X, line, 7)
    line += 3.4
  }
  const [owner] = clamp(measurer, institution, TEXT_WIDTH, 6, 1)
  text(owner ?? '', TEXT_X, LABEL_GRID.height - 4.5, 6, COLORS.muted)
}

/**
 * Etiket sayfası: etiketler verilen sırayla soldan sağa, yukarıdan aşağıya dizilir; 24'ü aşınca yeni
 * sayfa açılır. Boş liste çizilmez.
 */
export function fixedAssetLabelsDocument(
  measurer: TextMeasurer,
  labels: readonly FixedAssetLabel[],
  options: TemplateOptions,
): PdfDocument {
  if (labels.length === 0) throw new Error('Etiket sayfasında en az bir demirbaş olmalıdır.')
  const pages: PdfPage[] = []
  labels.forEach((label, index) => {
    const slot = index % LABELS_PER_PAGE
    if (slot === 0) {
      const page: PdfPage = { ops: [] }
      drawGuides(page)
      pages.push(page)
    }
    const page = pages.at(-1)
    if (page) drawLabel(page, measurer, label, options.institution, slot)
  })
  return {
    pages,
    metadata: {
      title: 'DEMİRBAŞ ETİKETLERİ',
      author: options.institution,
      subject: 'Kampüs belgesi',
      creator: 'Kampüs',
    },
  }
}

/** Dosya adı: tek etikette etiket numarası, çoklu etikette adet ve gün (kişi adı yok). */
export function fixedAssetLabelsFilename(
  labels: readonly Pick<FixedAssetLabel, 'tagNumber'>[],
  generatedAt: Date,
): string {
  const [only] = labels
  if (labels.length === 1 && only)
    return `demirbas-etiketi-${only.tagNumber.replaceAll('/', '-')}.pdf`
  return `demirbas-etiketleri-${String(labels.length)}-${generatedAt.toISOString().slice(0, 10)}.pdf`
}
