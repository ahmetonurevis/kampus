import { ITEM_CHECK_LIMIT } from '@kampus/school-core/skills/practice.ts'
import type { TaskAttemptItemFeedback } from '@kampus/react-shared/use-task-attempts.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/**
 * Alıştırmada madde kontrolünün ekran modeli (OG-085; IST-056, DOM-BEC-047). Hak, kilit ve anahtar
 * sunucudadır; burada yalnız gösterim metni ve düğmenin açıklığı hesaplanır. `feedback` alıştırmada
 * dizi, değerlendirmede ve velide `null`'dur: `null` ise kontrol düğmesi hiç çizilmez.
 */

export type ItemFeedback = TaskAttemptItemFeedback

/** Son kontrol yanıtının geri bildirimi ve onu üreten denemenin satır sürümü. */
export type CheckedFeedback = { rowVersion: number; feedback: readonly ItemFeedback[] | null }

/**
 * Ekranda gösterilecek geri bildirim. Kontrol yanıtı, tazelenen deneme ayrıntısı gelene kadar
 * doğrudur; ayrıntı aynı ya da daha yeni sürümdeyse (sorgu yenilendi, başka sekme kontrol etti)
 * sunucudaki `feedback` kazanır ve yerel durum eskimiş sayılır.
 */
export function shownFeedback(
  attempt: { rowVersion: number; feedback: readonly ItemFeedback[] | null },
  checked: CheckedFeedback | null,
): readonly ItemFeedback[] | null {
  return checked !== null && checked.rowVersion > attempt.rowVersion
    ? (checked.feedback ?? attempt.feedback)
    : attempt.feedback
}

export function feedbackFor(
  feedback: readonly ItemFeedback[] | null,
  questionVersionId: string,
): ItemFeedback | null {
  return feedback?.find((entry) => entry.questionVersionId === questionVersionId) ?? null
}

export type CheckView = {
  /** Kontrol düğmesi açık mı. */
  canCheck: boolean
  /** Kilitli madde: cevap değişmez, girdi kapalı. */
  locked: boolean
  /** Kalan hak metni (her zaman görünür). */
  remainingText: string
  /** Son kontrolün sonucu; kontrol edilmemiş maddede `null`. */
  result: { tone: BadgeTone; label: string; detail: string } | null
}

const remainingOf = (remaining: number) =>
  remaining === 0 ? 'Kontrol hakkı kalmadı' : `Kontrol hakkı: ${remaining} / ${ITEM_CHECK_LIMIT}`

function partsText(entry: ItemFeedback): string {
  return entry.parts > 1 ? ` ${entry.parts} maddeden ${entry.correctParts} tanesi doğru.` : ''
}

export function checkView(input: {
  entry: ItemFeedback | null
  answered: boolean
  timeOver: boolean
}): CheckView {
  const { entry } = input
  if (entry === null)
    return {
      canCheck: input.answered && !input.timeOver,
      locked: false,
      remainingText: remainingOf(ITEM_CHECK_LIMIT),
      result: null,
    }
  const result = entry.correct
    ? { tone: 'green' as const, label: 'Doğru', detail: 'Cevabınız doğru; bu soru kilitlendi.' }
    : entry.locked
      ? {
          tone: 'red' as const,
          label: 'Yanlış',
          detail: `Kontrol hakkınız bitti; cevap kilitlendi.${partsText(entry)}`,
        }
      : {
          tone: 'amber' as const,
          label: 'Yanlış',
          detail: `Cevabınızı değiştirip yeniden kontrol edebilirsiniz.${partsText(entry)}`,
        }
  return {
    canCheck: !entry.locked && input.answered && !input.timeOver,
    locked: entry.locked,
    remainingText: remainingOf(entry.remaining),
    result,
  }
}
