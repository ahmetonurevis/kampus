/**
 * Finans dosyalarının Excel modeli (ON-094, IST-111): hücrenin metin mi, tutar mı, gün mü olduğuna
 * core karar verir, dosyayı yalnız API yazar; yazma kitaplığı web ve mobil paketine girmez. Yeni bir
 * finans dosyası (ör. yıl sonu mutabakatı) aynı modeli üretip aynı yazıcıyı kullanır.
 */

export type SheetCell =
  /** Her zaman metin hücresi: `=` ile başlayan ad formül olarak çalışmaz, baştaki sıfır düşmez. */
  | { kind: 'text'; value: string }
  | { kind: 'integer'; value: number }
  /** Kuruş; dosyada `#,##0.00` biçimli sayı hücresidir. */
  | { kind: 'amount'; cents: number }
  /** Europe/Istanbul günü (`YYYY-MM-DD`); dosyaya saatsiz yazılır, açılan makinede kaymaz. */
  | { kind: 'date'; day: string }

export interface FinanceSheet {
  name: string
  dateFormat: 'iso' | 'tr'
  headers: readonly string[]
  rows: readonly (readonly SheetCell[])[]
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Gün biçiminde olmayan değer metin kalır; dosya bozulmaz, satır kaybolmaz. */
export function dateSheetCell(value: string): SheetCell {
  return DAY.test(value) ? { kind: 'date', day: value } : { kind: 'text', value }
}
