import { money } from '@kampus/school-core/lib/format.ts'

// Referans hakkının ekran yardımcısı (DOM-FIN-024). Değer kesin kayıtta sabitlenir (K-14); uygulanan
// tutar tavanı aşan kısım düşülerek sunucuda çıkar.

/**
 * Seçenek metni: yıl, hakkı getiren kendi öğrencisi ve hakkın değeri; aday ve aday adı yoktur (KVKK).
 * Adı okunamayan hak sahibi kurum türünün terimiyle yazılır (`learner`; DOM-KAY-012).
 */
export function referralOptionLabel(
  reward: {
    academicYear: number
    referrerStudentName: string | null
    amountCents: number
  },
  learner = 'Öğrenci',
): string {
  const owner = reward.referrerStudentName ?? learner
  return `${String(reward.academicYear)} · ${owner} · ${money(reward.amountCents)}`
}
