/**
 * Örnek veri üreticilerinin ortak yardımcıları. Platform örnek veri dosyaları
 * (`seed-structure.ts`, `seed-academic.ts`, `seed-learning.ts`, `seed-communication.ts`)
 * ve `data/seed.ts` bunları kullanır.
 */

/** Başlangıç gününe göre gün ve saat kaydırır; ISO UTC metni döner. */
export type SeedDate = (days: number, hour?: number) => string

/** Ayın `day`. günü (`offset` ay kaydırmalı), 09:00 UTC; ISO UTC metni döner. */
export type SeedMonth = (offset: number, day?: number) => string

/** Örnek veri üreticilerinin birbirine verdiği en küçük öğrenci biçimi. */
export type SeedStudentRef = { id: string; name: string; classId: string }

// Örnek veri kendi içinde tutarlıdır; aranan kayıt yoksa üretici hatalıdır ve hemen durur.
export function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Örnek veri tutarsız: ${what} bulunamadı.`)
  return value
}
