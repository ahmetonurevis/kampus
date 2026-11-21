import { strFromU8, unzipSync } from 'fflate'

/**
 * Üretilen `.xlsx` dosyasını açıp hücreleri sınar (ON-094): sonucu yazıcının kendisine sormamak için
 * ZIP ve XML doğrudan okunur. API testi ve e2e aynı okuyucuyu kullanır.
 */

export interface WorkbookCell {
  /** `s` paylaşılan metin (formül çalışmaz), `n` sayı ya da tarih seri numarası, `empty` boş. */
  type: 's' | 'n' | 'empty'
  value: string | number | null
  format: string | null
  bold: boolean
}

export interface Workbook {
  sheetName: string
  /** Sayfa XML'inde `<f>` öğesi var mı: varsa dosyada çalışan formül vardır. */
  hasFormula: boolean
  /** Adres (`A1`) → hücre. */
  cells: ReadonlyMap<string, WorkbookCell>
  rowCount: number
  /** Satırın sütun sırasıyla değerleri; boş hücre `null`. */
  row: (index: number) => (string | number | null)[]
}

const unescapeXml = (text: string) =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')

const attribute = (attributes: string, name: string) =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1]

function readStyles(xml: string): { format: string | null; bold: boolean }[] {
  const formats = new Map<string, string>()
  for (const match of xml.matchAll(/<numFmt ([^>]*)\/>/g)) {
    const id = attribute(match[1] ?? '', 'numFmtId')
    const code = attribute(match[1] ?? '', 'formatCode')
    if (id !== undefined && code !== undefined) formats.set(id, unescapeXml(code))
  }
  const fonts = [
    ...(/<fonts[^>]*>(.*?)<\/fonts>/s.exec(xml)?.[1] ?? '').matchAll(/<font>(.*?)<\/font>/gs),
  ]
  const section = /<cellXfs[^>]*>(.*?)<\/cellXfs>/s.exec(xml)?.[1] ?? ''
  return [...section.matchAll(/<xf\b([^>]*)>/g)].map((match) => {
    const id = attribute(match[1] ?? '', 'numFmtId')
    const font = Number(attribute(match[1] ?? '', 'fontId') ?? 0)
    return {
      format: id === undefined ? null : (formats.get(id) ?? null),
      bold: (fonts[font]?.[1] ?? '').includes('<b/>'),
    }
  })
}

export function readWorkbook(file: Uint8Array): Workbook {
  const entries = unzipSync(file)
  const text = (name: string) => {
    const entry = entries[name]
    return entry === undefined ? '' : strFromU8(entry)
  }
  const strings = [
    ...text('xl/sharedStrings.xml').matchAll(/<si>.*?<t[^>]*>(.*?)<\/t>.*?<\/si>/gs),
  ].map((match) => unescapeXml(match[1] ?? ''))
  const styles = readStyles(text('xl/styles.xml'))
  const sheet = text('xl/worksheets/sheet1.xml')
  const cells = new Map<string, WorkbookCell>()
  for (const match of sheet.matchAll(/<c ([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
    const attributes = match[1] ?? ''
    const address = attribute(attributes, 'r') ?? ''
    const raw = /<v>(.*?)<\/v>/s.exec(match[2] ?? '')?.[1]
    const style = styles[Number(attribute(attributes, 's') ?? 0)]
    const shared = attribute(attributes, 't') === 's'
    cells.set(address, {
      type: raw === undefined ? 'empty' : shared ? 's' : 'n',
      value: raw === undefined ? null : shared ? (strings[Number(raw)] ?? null) : Number(raw),
      format: style?.format ?? null,
      bold: style?.bold ?? false,
    })
  }
  const rowCount = [...sheet.matchAll(/<row\b/g)].length
  return {
    sheetName: unescapeXml(
      attribute(text('xl/workbook.xml').match(/<sheet [^>]*>/)?.[0] ?? '', 'name') ?? '',
    ),
    hasFormula: /<f[\s>/]/.test(sheet),
    cells,
    rowCount,
    row: (index) => {
      const values: (string | number | null)[] = []
      for (let column = 0; column < 26; column += 1) {
        const cell = cells.get(`${String.fromCharCode(65 + column)}${String(index)}`)
        if (cell === undefined) break
        values.push(cell.value)
      }
      return values
    },
  }
}

/** Excel seri numarası → gün; sayfanın çözüldüğü makinenin saat diliminden bağımsızdır. */
export function serialToDay(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10)
}
