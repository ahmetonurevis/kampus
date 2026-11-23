import { strToU8, zipSync } from 'fflate'

/** Denetim haneleri doğru T.C. kimlik numarası üretir (`isValidTurkishId`); değer rastgele değildir. */
export function turkishId(seed: number): string {
  const nine = String(100_000_000 + seed)
  const digits = [...nine].map(Number)
  const at = (index: number) => digits[index] ?? 0
  const odd = at(0) + at(2) + at(4) + at(6) + at(8)
  const even = at(1) + at(3) + at(5) + at(7)
  const tenth = (((odd * 7 - even) % 10) + 10) % 10
  const eleventh = (digits.reduce((sum, digit) => sum + digit, 0) + tenth) % 10
  return `${nine}${tenth}${eleventh}`
}

export const base64 = (text: string | Uint8Array) => Buffer.from(text).toString('base64')

type Cell = string | number | { date: string } | null

const excelSerial = (day: string) =>
  (Date.parse(`${day}T00:00:00.000Z`) - Date.UTC(1899, 11, 30)) / 86_400_000

function column(index: number): string {
  return String.fromCharCode(65 + index)
}

function cellXml(cell: Cell, row: number, index: number): string {
  const ref = `${column(index)}${row}`
  if (cell === null) return ''
  if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`
  if (typeof cell === 'string')
    return `<c r="${ref}" t="inlineStr"><is><t>${cell.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c>`
  return `<c r="${ref}" s="1"><v>${excelSerial(cell.date)}</v></c>`
}

/** En küçük geçerli `.xlsx`: tek sayfa, satır içi metin, sayı ve gün biçimli tarih hücresi. */
export function xlsxFile(rows: readonly (readonly Cell[])[]): Uint8Array {
  const sheet = rows
    .map(
      (cells, rowIndex) =>
        `<row r="${rowIndex + 1}">${cells.map((cell, index) => cellXml(cell, rowIndex + 1, index)).join('')}</row>`,
    )
    .join('')
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sayfa1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    'xl/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
    ),
  })
}
