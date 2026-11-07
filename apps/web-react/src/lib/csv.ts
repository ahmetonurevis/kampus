// CSV dışa aktarma (Vue `exportCsv`): Excel uyumu için `;` ayırıcı, CRLF satır sonu ve UTF-8
// BOM. Formül enjeksiyonuna karşı `= + - @` (baştaki boşluklardan sonra da) veya sekme/satır
// başıyla başlayan metin hücreleri `'` ile kaçılır; sayılar olduğu gibi yazılır.
import { CSV_SEPARATOR, csvCell } from '@kampus/school-core/lib/csv.ts'

import type { ListColumn } from './list-view.ts'

export { CSV_SEPARATOR, csvCell }

/** Başlık satırı + verilen sırayla tüm satırlar; BOM içermez (indirirken eklenir). */
export function toCsv(
  columns: readonly ListColumn[],
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
): string {
  return [
    columns.map((column) => csvCell(column.label)).join(CSV_SEPARATOR),
    ...rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(CSV_SEPARATOR)),
  ].join('\r\n')
}

/** Dosya adı güvenli karakterlere indirgenir; uzantı eklenir. */
export function csvFilename(name: string): string {
  const safe =
    name
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim()
      .slice(0, 120) || 'rapor'
  return safe.endsWith('.csv') ? safe : `${safe}.csv`
}
