import {
  EXTRA_TIME_REASONS,
  extraTimeGrantSchema,
  type ExtraTimeGrantInput,
} from '@kampus/school-core/skills/extra-time.ts'
import { extraTimeMinutesLabel } from '@kampus/react-shared/task-extra-times.ts'

/**
 * Bireysel ek süre bölümünün saf modeli (DOM-BEC-043, OG-248). Kural ve sınır core şemasındadır
 * (`extraTimeSchema`: 1–300 dakika, gerekçe kategorisi); burada form değerleri, sunucu hata yolunun
 * alana çevrilmesi ve öğrencinin göreceği "Ek süre" etiketi vardır. Gerekçe kategorisi yalnız
 * personel formunda ve geçmişinde görünür; öğrenciye ve veliye hiçbir yüzeyde dönmez.
 */

/** Verme ve değiştirme aynı formu kullanır; değiştirmede kursiyer sabittir ve gövdeye girmez. */
export const extraTimeFormSchema = extraTimeGrantSchema

/** Form değerleri: `reason` boşken `''`; seçilmeden gönderim core şemasının mesajını alır. */
export type ExtraTimeFormValues = Omit<ExtraTimeGrantInput, 'reason'> & {
  reason: ExtraTimeGrantInput['reason'] | ''
}
export type ExtraTimeFormOutput = ReturnType<typeof extraTimeFormSchema.parse>

export const EXTRA_TIME_REASON_OPTIONS = (
  Object.keys(EXTRA_TIME_REASONS) as (keyof typeof EXTRA_TIME_REASONS)[]
).map((value) => ({ value, label: EXTRA_TIME_REASONS[value].label }))

/** Verme formunun başlangıcı: kursiyer seçilmemiş, dakika boş (NaN), gerekçe seçilmemiş. */
export const defaultExtraTimeForm = (): ExtraTimeFormValues => ({
  learnerId: '',
  minutes: Number.NaN,
  reason: '',
})

/** Değiştirme formu kursiyerin güncel değeriyle açılır. */
export const extraTimeFormFor = (
  learnerId: string,
  current: { minutes: number; reason?: ExtraTimeGrantInput['reason'] | undefined },
): ExtraTimeFormValues => ({
  learnerId,
  minutes: current.minutes,
  reason: current.reason ?? '',
})

/** Sunucu hata yolunu form alanına çevirir; bilinmeyen yol form düzeyi hatadır. */
export function extraTimeFieldFor(
  path: string,
): 'minutes' | 'reason' | 'learnerId' | 'root.server' {
  const [first] = path.split('.')
  if (first === 'minutes' || first === 'reason' || first === 'learnerId') return first
  return 'root.server'
}

/** Öğrenci denemesindeki rozet: yalnız dakika; ek süre yoksa (0) etiket yoktur. */
export function attemptExtraTimeLabel(extraMinutes: number): string | null {
  return extraMinutes > 0 ? `Ek süre: ${extraTimeMinutesLabel(extraMinutes)}` : null
}
