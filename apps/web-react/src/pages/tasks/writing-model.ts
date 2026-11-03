import { wordCountCheck } from '@kampus/school-core/skills/submission.ts'

/**
 * Yazma görevinin saf sunum kuralları (IST-047; DOM-BEC-040, 044, 046): editörün canlı sözcük
 * sayısı ve öğretmenin iki sürümü yan yana karşılaştırması. Sözcük sayısı sunucunun kullandığı
 * çekirdek fonksiyonla (`wordCountCheck`) hesaplanır; sınır dışı metin uyarıdır, engel değildir.
 */

export type WritingLimits = { minWords: number | null; maxWords: number | null }

/** Beklenen sözcük aralığının metni; sınır yoksa `null`. */
export function wordLimitText({ minWords, maxWords }: WritingLimits): string | null {
  if (minWords !== null && maxWords !== null) return `${minWords}–${maxWords} sözcük`
  if (minWords !== null) return `en az ${minWords} sözcük`
  if (maxWords !== null) return `en çok ${maxWords} sözcük`
  return null
}

/** Sınır dışı metnin uyarısı: engel değildir (DOM-BEC-046). */
export const WORD_LIMIT_WARNING =
  'Sözcük sayınız beklenen aralığın dışında. Yine de gönderebilirsiniz; öğretmeniniz görür.'

export type LiveWordCount = {
  count: number
  /** Ekranda sürekli görünen sayaç ("142 sözcük · beklenen: 150–250 sözcük"). */
  label: string
  /** Sınır dışındaysa uyarı; boş metinde uyarı yoktur. */
  warning: string | null
}

/** Editörün canlı sayacı: yazarken her değişiklikte yeniden hesaplanır, saklanmaz. */
export function liveWordCount(body: string, limits: WritingLimits): LiveWordCount {
  const check = wordCountCheck(body, limits)
  const limit = wordLimitText(limits)
  return {
    count: check.count,
    label: `${check.count} sözcük${limit ? ` · beklenen: ${limit}` : ''}`,
    warning: body.trim() === '' || check.status === 'ok' ? null : WORD_LIMIT_WARNING,
  }
}

/** Son teslimle aynı metin yeni sürüm sayılmaz: öğrenci önce metni düzenler. */
export const SAME_AS_LAST_VERSION_MESSAGE =
  'Bu metin son teslim ettiğinizle aynı. Yeni sürüm göndermek için metninizi düzenleyin.'

export const sameAsLastVersion = (body: string, lastBody: string | null | undefined) =>
  typeof lastBody === 'string' && lastBody.trim() !== '' && body.trim() === lastBody.trim()
