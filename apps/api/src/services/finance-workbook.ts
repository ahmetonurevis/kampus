import writeXlsxFile, { type CellObject, type SheetData } from 'write-excel-file/node'

import type { FinanceSheet, SheetCell } from '@kampus/school-core/lib/finance-sheet.ts'

/**
 * `FinanceSheet` modelini `.xlsx` dosyasına yazar (ON-094, IST-111). Dosyaya özel değildir: modeli
 * üreten her finans aktarımı kullanır. Kitaplık yalnız sunucudadır; web paketine girmez.
 */

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Excel'in metin biçimi: hücre dizgi olarak saklandığı için `=`, `+`, `-`, `@` ile başlayan değer
 * çalışmaz; biçim de `@` olduğundan hücre düzenlenip kaydedilince de formüle dönmez. CSV'deki `'`
 * kaçışı burada gerekmez, değer bozulmadan muhasebeye geçer.
 */
const TEXT_FORMAT = '@'
const AMOUNT_FORMAT = '#,##0.00'
const INTEGER_FORMAT = '0'
const DATE_FORMATS = { iso: 'yyyy-mm-dd', tr: 'dd.mm.yyyy' } as const satisfies Record<
  FinanceSheet['dateFormat'],
  string
>

const MIN_WIDTH = { text: 10, integer: 8, amount: 14, date: 12 } as const
const MAX_WIDTH = 60

function cellObject(cell: SheetCell, dateFormat: FinanceSheet['dateFormat']): CellObject {
  switch (cell.kind) {
    case 'text':
      return {
        value: cell.value === '' ? undefined : cell.value,
        type: String,
        format: TEXT_FORMAT,
      }
    case 'integer':
      return { value: cell.value, type: Number, format: INTEGER_FORMAT }
    case 'amount':
      return { value: cell.cents / 100, type: Number, format: AMOUNT_FORMAT }
    case 'date':
      // UTC gece yarısı: seri numarası sunucunun saat diliminden bağımsız olarak aynı gündür.
      return {
        value: new Date(`${cell.day}T00:00:00.000Z`),
        type: Date,
        format: DATE_FORMATS[dateFormat],
      }
    default:
      return cell satisfies never
  }
}

function columnWidth(sheet: FinanceSheet, index: number): number {
  let width = (sheet.headers[index] ?? '').length + 2
  for (const row of sheet.rows) {
    const cell = row[index]
    if (cell === undefined) continue
    width = Math.max(width, MIN_WIDTH[cell.kind], cell.kind === 'text' ? cell.value.length + 2 : 0)
  }
  return Math.min(width, MAX_WIDTH)
}

export function financeWorkbook(sheet: FinanceSheet): Promise<Buffer> {
  const header: CellObject[] = sheet.headers.map((value) => ({
    value,
    type: String,
    format: TEXT_FORMAT,
    fontWeight: 'bold',
  }))
  const data: SheetData = [
    header,
    ...sheet.rows.map((row) => row.map((cell) => cellObject(cell, sheet.dateFormat))),
  ]
  return writeXlsxFile(data, {
    sheet: sheet.name,
    columns: sheet.headers.map((_, index) => ({ width: columnWidth(sheet, index) })),
  }).toBuffer()
}
