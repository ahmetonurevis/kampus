// CSV yazımı: Excel uyumu için `;` ayırıcı. Formül enjeksiyonuna karşı `= + - @` (baştaki
// boşluklardan sonra da) veya sekme/satır başıyla başlayan metin hücreleri `'` ile kaçılır; sayılar
// olduğu gibi yazılır. Web ve API aynı kuralı kullanır.

export const CSV_SEPARATOR = ';'
const FORMULA = /^(?:[\t\r]|\s*[=+\-@])/

export function csvCell(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  const text = value === null || value === undefined ? '' : String(value)
  const safe = FORMULA.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

/**
 * Kuruşu ondalık virgüllü tutara çevirir (`-1234,56`). Sistem üretimi sayıdır, kaçılmaz: negatif
 * tutar `'` alırsa muhasebe programı sayı olarak okuyamaz.
 */
export function csvAmount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const fraction = String(absolute % 100).padStart(2, '0')
  return `${sign}${String(Math.floor(absolute / 100))},${fraction}`
}
