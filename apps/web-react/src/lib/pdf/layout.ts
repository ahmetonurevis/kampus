// PDF sayfa yerleşimi: saf TypeScript. Yerleşim jsPDF'e dokunmaz; sayfa başına çizim komutları
// (`PdfOp`) üretir, jsPDF çizimi `render.ts`'tedir (tembel yüklenir). Böylece sayfa kırma, tablo
// başlığı tekrarı ve sayfa numarası hesapları Node'da, yazı tipi ölçüsü sahte bir ölçerle test edilir.
// Bütün konumlar milimetredir. Bloklar çizmeden önce yüksekliklerini ayırır.
import { dateLabel } from '@kampus/school-core/lib/format.ts'

export type Rgb = readonly [number, number, number]

/** `#RRGGBB` → [r, g, b]; marka renkleri tek yerde hex olarak yazılır. */
export function rgb(hex: string): Rgb {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Geçersiz renk: ${hex}`)
  const channel = (start: number) => Number.parseInt(hex.slice(start, start + 2), 16)
  return [channel(1), channel(3), channel(5)]
}

export const COLORS = {
  ink: rgb('#232F44'),
  muted: rgb('#637183'),
  line: rgb('#DCE2EA'),
  tableHead: rgb('#EFF2F7'),
  sapphire: rgb('#1E3A8A'),
  sapphireSoft: rgb('#EDF2FF'),
  orange: rgb('#F97316'),
  orangeSoft: rgb('#FFF1E7'),
  orangeInk: rgb('#9A3412'),
} as const

/** A4 dikey sayfa ölçüleri (mm). `bottom` içerik alt sınırıdır; altında altbilgi vardır. */
export const PAGE = {
  width: 210,
  height: 297,
  left: 18,
  contentWidth: 174,
  right: 192,
  bottom: 266,
} as const

export type PdfOp =
  | {
      kind: 'text'
      text: string
      x: number
      y: number
      size: number
      color: Rgb
      align: 'left' | 'right'
    }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; radius: number; fill: Rgb }
  | { kind: 'line'; x: number; y: number; width: number; color: Rgb; thickness: number }

export type PdfPage = { ops: PdfOp[] }

export type PdfMetadata = { title: string; author: string; subject: string; creator: string }

export type PdfDocument = { pages: PdfPage[]; metadata: PdfMetadata }

/** Yazı tipi ölçüsü: satır kaydırma ve metin genişliği (mm). jsPDF veya sahte ölçer sağlar. */
export interface TextMeasurer {
  wrap(text: string, width: number, size: number): string[]
  width(text: string, size: number): number
}

export type LayoutMeta = {
  /** Belge başlığı etiketi (ör. "TAHSİLAT DEKONTU"). */
  label: string
  /** Sağ üstteki rozet metni (belge türü kısa adı). */
  badge: string
  institution: string
  generatedAt: Date | string
  /** Belge numarası; her sayfa altbilgisinde yazılır. */
  reference: string
  /** Altbilgideki sorumluluk notu. */
  footerNote: string
}

export const date = (value: Date | string | null | undefined) =>
  dateLabel(value, { year: 'numeric' })

/** Sütun kalıbı: genişlikler mm, toplamı içerik genişliğidir. */
export type TableColumn = { header: string; width: number }

const FIELD_COLUMN_WIDTH = 80
const FIELD_COLUMN_STEP = 91

export class DocumentLayout {
  readonly pages: PdfPage[] = []
  /** Sonraki bloğun üst konumu (mm). */
  y = 0
  private readonly measurer: TextMeasurer
  private readonly meta: LayoutMeta
  private page: PdfPage

  constructor(measurer: TextMeasurer, meta: LayoutMeta) {
    this.measurer = measurer
    this.meta = meta
    this.page = { ops: [] }
    this.pages.push(this.page)
    this.header(true)
  }

  text(
    value: unknown,
    x: number,
    y: number,
    size = 10,
    color: Rgb = COLORS.ink,
    align: 'left' | 'right' = 'left',
  ) {
    this.page.ops.push({ kind: 'text', text: String(value ?? '—'), x, y, size, color, align })
  }

  wrap(value: unknown, width: number = PAGE.contentWidth, size = 10): string[] {
    return this.measurer.wrap(String(value ?? '—'), width, size)
  }

  rule(y: number, x: number = PAGE.left, width: number = PAGE.contentWidth) {
    this.page.ops.push({
      kind: 'line',
      x,
      y,
      width,
      color: COLORS.line,
      thickness: 0.3,
    })
  }

  box(x: number, y: number, width: number, height: number, fill: Rgb, radius = 0) {
    this.page.ops.push({ kind: 'rect', x, y, width, height, radius, fill })
  }

  /** Yeni sayfa açar ve devam başlığını çizer. */
  newPage() {
    this.page = { ops: [] }
    this.pages.push(this.page)
    this.header(false)
  }

  private header(first: boolean) {
    const { sapphire, orange, orangeSoft, orangeInk, muted } = COLORS
    this.box(0, 0, PAGE.width, 3, sapphire)
    this.box(174, 0, 36, 3, orange)
    const logoSize = first ? 23 : 18
    this.text('kampüs', PAGE.left, 19, logoSize, sapphire)
    this.text('.', PAGE.left + this.measurer.width('kampüs', logoSize), 19, logoSize, orange)
    this.text(this.meta.institution.toLocaleUpperCase('tr-TR'), PAGE.left, 26, 8, muted)
    this.box(151, 10, 41, 9, orangeSoft, 2)
    this.text(this.meta.badge, 188, 16, 8, orangeInk, 'right')
    this.text(date(this.meta.generatedAt), PAGE.right, 23, 8, muted, 'right')
    this.rule(32)
    if (first) {
      this.y = 43
      this.text(this.meta.label, PAGE.left, this.y, 10, sapphire)
      this.y += 8
    } else {
      this.text(`${this.meta.label} · Devam`, PAGE.left, 41, 8, muted)
      this.y = 51
    }
  }

  /** `height` sığmıyorsa yeni sayfa açar; açtıysa `true` döner. */
  ensure(height: number): boolean {
    if (this.y + height > PAGE.bottom) {
      this.newPage()
      return true
    }
    return false
  }

  heading(title: string, subtitle?: string) {
    for (const part of this.wrap(title, PAGE.contentWidth, 20)) {
      this.ensure(10)
      this.text(part, PAGE.left, this.y + 4, 20)
      this.y += 9
    }
    this.y += 2
    if (subtitle) this.paragraph(subtitle, 9, COLORS.muted)
    this.y += 3
  }

  /** Paragraf: son iki satır tek başına yeni sayfaya düşmez (dul/yetim satır yok). */
  paragraph(value: unknown, size = 10, color: Rgb = COLORS.ink) {
    const lines = this.wrap(value, PAGE.contentWidth, size)
    this.ensure(Math.min(lines.length, 3) * 5.7)
    lines.forEach((part, index) => {
      if (lines.length - index === 2) this.ensure(11.4)
      this.ensure(6)
      this.text(part, PAGE.left, this.y + 4, size, color)
      this.y += 5.7
    })
    this.y += 3
  }

  section(title: string) {
    this.ensure(24)
    this.y += 3
    this.text(title, PAGE.left, this.y + 4, 11, COLORS.sapphire)
    this.rule(this.y + 7)
    this.y += 13
  }

  /** Etiket/değer çiftleri; iki sütun, satır yüksekliği en uzun değere göre. */
  fields(pairs: readonly (readonly [string, unknown])[]) {
    for (let i = 0; i < pairs.length; i += 2) {
      const row = pairs.slice(i, i + 2)
      const wrapped = row.map(([, value]) => this.wrap(value, FIELD_COLUMN_WIDTH, 10))
      const height = 11 + Math.max(...wrapped.map((lines) => lines.length)) * 5
      this.ensure(height)
      row.forEach(([label], column) => {
        const x = PAGE.left + column * FIELD_COLUMN_STEP
        this.text(label, x, this.y + 3, 8, COLORS.muted)
        wrapped[column]?.forEach((line, index) => this.text(line, x, this.y + 10 + index * 5))
      })
      this.y += height
    }
  }

  highlight(label: string, amount: string, detail?: string) {
    this.ensure(37)
    const { sapphire, sapphireSoft, orange } = COLORS
    this.box(PAGE.left, this.y, PAGE.contentWidth, 31, sapphireSoft, 3)
    this.box(PAGE.left, this.y + 6, 1.5, 19, orange, 0.75)
    this.text(label, 24, this.y + 9, 9, sapphire)
    this.text(amount, 24, this.y + 22, 23, sapphire)
    if (detail) this.text(detail, 186, this.y + 22, 9, sapphire, 'right')
    this.y += 38
  }

  /** Birkaç kısa göstergeyi tek bantta yan yana yazar (toplam, tahsil edilen, kalan gibi). */
  metrics(items: readonly (readonly [label: string, value: string])[]) {
    this.ensure(27)
    const { sapphire, sapphireSoft, orange } = COLORS
    const step = (PAGE.contentWidth - 6) / Math.max(items.length, 1)
    this.box(PAGE.left, this.y, PAGE.contentWidth, 22, sapphireSoft, 3)
    this.box(PAGE.left, this.y + 5, 1.5, 12, orange, 0.75)
    items.forEach(([label, value], index) => {
      this.text(label, 24 + index * step, this.y + 7, 7, sapphire)
      this.text(value, 24 + index * step, this.y + 16, 13, sapphire)
    })
    this.y += 27
  }

  /** Tablo: sayfa değişince başlık satırı yeni sayfada yeniden çizilir. */
  table(columns: readonly TableColumn[], rows: readonly (readonly unknown[])[], compact = false) {
    const drawHeader = () => {
      this.box(PAGE.left, this.y, PAGE.contentWidth, 11, COLORS.tableHead, 2)
      let x = PAGE.left
      for (const column of columns) {
        this.text(column.header, x + 3, this.y + 7, 8, COLORS.muted)
        x += column.width
      }
      this.y += 11
    }
    this.ensure(25)
    drawHeader()
    for (const row of rows) {
      const cells = columns.map((column, index) => this.wrap(row[index], column.width - 6, 9))
      const height = Math.max(
        compact ? 9 : 12,
        Math.max(...cells.map((cell) => cell.length)) * 4.5 + (compact ? 4.5 : 6),
      )
      if (this.ensure(height)) drawHeader()
      let x = PAGE.left
      cells.forEach((cell, index) => {
        cell.forEach((line, lineIndex) => this.text(line, x + 3, this.y + 7 + lineIndex * 5, 9))
        x += columns[index]?.width ?? 0
      })
      this.y += height
      this.rule(this.y)
    }
    this.y += 7
  }

  /** Çizgili yazı alanı (çözüm ve not alanları). */
  writingArea(title: string, rows = 6) {
    this.ensure(22 + rows * 8)
    this.section(title)
    for (let index = 0; index < rows; index++) {
      this.rule(this.y + 7)
      this.y += 8
    }
    this.y += 6
  }

  signatures(left: string, right: string, compact = false) {
    const size = compact ? 8 : 9
    const labels = [this.wrap(left, 76, size), this.wrap(right, 83, size)]
    const height = Math.max(...labels.map((lines) => lines.length)) * 4 + (compact ? 16 : 33)
    this.ensure(height)
    labels.forEach((lines, column) =>
      lines.forEach((line, index) =>
        this.text(
          line,
          PAGE.left + column * FIELD_COLUMN_STEP,
          this.y + 4 + index * 4,
          size,
          COLORS.muted,
        ),
      ),
    )
    this.rule(this.y + height - 3, PAGE.left, 76)
    this.rule(this.y + height - 3, 109, 83)
    this.y += height + 3
  }

  /** Altbilgiyi (sorumluluk notu, sayfa "n / toplam", belge no) her sayfaya yazar. */
  finish(): PdfDocument {
    const count = this.pages.length
    this.pages.forEach((page, index) => {
      this.page = page
      this.rule(276)
      this.text(this.meta.footerNote, PAGE.left, 282, 7, COLORS.muted)
      this.text(`${index + 1} / ${count}`, PAGE.right, 282, 8, COLORS.muted, 'right')
      const [reference] = this.wrap(`Belge no: ${this.meta.reference}`, PAGE.contentWidth, 7)
      this.text(reference, PAGE.left, 287, 7, COLORS.muted)
    })
    return {
      pages: this.pages,
      metadata: {
        title: this.meta.label,
        author: this.meta.institution,
        subject: 'Kampüs belgesi',
        creator: 'Kampüs',
      },
    }
  }
}
