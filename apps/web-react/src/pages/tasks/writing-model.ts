import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import { wordCountCheck } from '@kampus/school-core/skills/submission.ts'
import { dateTimeLabel } from './task-model.ts'

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

// --- Sürüm karşılaştırması ---------------------------------------------------------------

export type SubmissionVersion = TaskSubmissionDetail['versions'][number]

/** Yan yana gösterilen iki sürümün numarası: sol eski, sağ yeni varsayılır. */
export type ComparePair = { left: number; right: number }

/** Varsayılan karşılaştırma son iki sürümdür; tek sürüm (ya da hiç) varsa karşılaştırma yoktur. */
export function defaultComparePair(versions: readonly SubmissionVersion[]): ComparePair | null {
  const numbers = versions.map((version) => version.number).sort((a, b) => a - b)
  const right = numbers.at(-1)
  const left = numbers.at(-2)
  return left === undefined || right === undefined ? null : { left, right }
}

/**
 * Seçimi geçerli sürümlere oturtur: seçim yoksa, artık bulunmayan sürümü gösteriyorsa ya da iki
 * taraf aynıysa varsayılana döner. Yeni sürüm gelince kullanıcının geçerli seçimi korunur.
 */
export function resolveComparePair(
  versions: readonly SubmissionVersion[],
  selection: ComparePair | null,
): ComparePair | null {
  const fallback = defaultComparePair(versions)
  if (fallback === null || selection === null) return fallback
  const known = new Set(versions.map((version) => version.number))
  const valid =
    known.has(selection.left) && known.has(selection.right) && selection.left !== selection.right
  return valid ? selection : fallback
}

/**
 * Bir tarafın seçimi: diğer tarafta zaten gösterilen sürüm seçilirse taraflar yer değiştirir; böylece
 * iki sütun hiçbir zaman aynı sürümü göstermez.
 */
export function chooseCompareVersion(
  pair: ComparePair,
  side: keyof ComparePair,
  number: number,
): ComparePair {
  if (side === 'left')
    return pair.right === number ? { left: number, right: pair.left } : { ...pair, left: number }
  return pair.left === number ? { left: pair.right, right: number } : { ...pair, right: number }
}

export const findVersion = (versions: readonly SubmissionVersion[], number: number) =>
  versions.find((version) => version.number === number) ?? null

export type VersionFact = { label: string; value: string }

/**
 * Sürümün bilgi satırları: gönderim zamanı, sözcük sayısı ve bu sürüm için istenen yeniden teslim
 * turu (istenme zamanı ve son tarih, Europe/Istanbul). Geç teslim rozet olarak ayrıca çizilir.
 */
export function versionFacts(version: SubmissionVersion): VersionFact[] {
  const facts: VersionFact[] = [{ label: 'Gönderildi', value: dateTimeLabel(version.submittedAt) }]
  if (version.wordCount) facts.push({ label: 'Sözcük', value: `${version.wordCount.count}` })
  const request = version.resubmissionRequest
  if (request) {
    facts.push(
      { label: 'Yeniden teslim istendi', value: dateTimeLabel(request.requestedAt) },
      { label: 'Yeniden teslim son tarihi', value: dateTimeLabel(request.dueAt) },
    )
  }
  return facts
}

/**
 * Soldaki sürümden sağdakine sözcük farkı ("Sürüm 1 → Sürüm 2: +32 sözcük"); sözcük sayısı
 * yoksa `null`.
 */
export function wordDifference(from: SubmissionVersion, to: SubmissionVersion): string | null {
  if (!from.wordCount || !to.wordCount) return null
  const diff = to.wordCount.count - from.wordCount.count
  const change =
    diff === 0 ? 'sözcük sayısı aynı' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} sözcük`
  return `Sürüm ${from.number} → Sürüm ${to.number}: ${change}`
}

/** Sürüm için istenen yeniden teslim turunun tek satırlık metni (Europe/Istanbul). */
export const resubmissionRoundText = (
  request: NonNullable<SubmissionVersion['resubmissionRequest']>,
) =>
  `Yeniden teslim istendi: ${dateTimeLabel(request.requestedAt)} · Son tarih: ${dateTimeLabel(request.dueAt)}`

export const versionOptionLabel = (version: SubmissionVersion) =>
  `Sürüm ${version.number}${version.late ? ' (geç)' : ''}`
