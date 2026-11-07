import { money } from '@kampus/school-core/lib/format.ts'

// Referans hakkının ekran yardımcısı (DOM-FIN-024). Değer kesin kayıtta sabitlenir (K-14); uygulanan
// tutar tavanı aşan kısım düşülerek sunucuda çıkar.

/** Seçenek metni: yıl, hakkı getiren kendi öğrencisi ve hakkın değeri; aday ve aday adı yoktur (KVKK). */
export function referralOptionLabel(reward: {
  academicYear: number
  referrerStudentName: string | null
  amountCents: number
}): string {
  const owner = reward.referrerStudentName ?? 'Öğrenci'
  return `${String(reward.academicYear)} · ${owner} · ${money(reward.amountCents)}`
}
