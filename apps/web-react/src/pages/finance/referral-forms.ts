import { money } from '@kampus/school-core/lib/format.ts'

// Referans hakkının ekran yardımcıları (DOM-FIN-024). Tutar sunucuda hesaplanır; burada yalnız
// tarifenin oran ya da tutarı ve seçenek metni üretilir.

type RewardValue = { percentBasisPoints: number | null; amountCents: number | null }

/** Kayıt yılı tarifesinin değeri; uygulanan tutar kullanıldığı sözleşmenin tarifesindendir. */
export function referralValueLabel({ percentBasisPoints, amountCents }: RewardValue): string {
  if (percentBasisPoints !== null)
    return `%${(percentBasisPoints / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`
  return amountCents === null ? '—' : money(amountCents)
}

/** Seçenek metni: yıl, hakkı getiren kendi öğrencisi ve değer; aday ve aday adı yoktur (KVKK). */
export function referralOptionLabel(
  reward: RewardValue & { academicYear: number; referrerStudentName: string | null },
): string {
  const owner = reward.referrerStudentName ?? 'Öğrenci'
  return `${String(reward.academicYear)} · ${owner} · ${referralValueLabel(reward)}`
}
