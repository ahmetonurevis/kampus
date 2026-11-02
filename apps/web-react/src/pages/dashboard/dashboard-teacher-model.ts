// Öğretmen Genel Bakışı'nın "Yanıt bekleyen sorular" sayacı ve listesinin saf hesabı. Girdi öğretmen
// soru kuyruğunun okuduğu koleksiyon yanıtıdır (`GET /collections/questions`, kapsamı sunucu
// uygular: yalnız kendisine atanan sorular; DOM-ILT-093). Durum saklanmaz, her okumada hesaplanır
// (`questionStatus`); sunucuda türetilmiş durum süzgeci yoktur, bu yüzden sayı satırlardan sayılır.
import type { CoreRow } from '@/hooks/use-core-collection.ts'
import {
  orderQuestions,
  questionRow,
  type QuestionLookups,
  type QuestionRow,
} from '../learning/question-rows.ts'

/** Kartta listelenen en çok soru sayısı (Vue ilk üç soruyu gösterir). */
export const QUESTION_LIMIT = 3

/** Dashboard'da ders ve öğretmen adı gösterilmez; boş eşleme `questionRow` için yeterlidir. */
const NO_LOOKUPS: QuestionLookups = { subjects: new Map(), teachers: new Map() }

export type OpenQuestions = {
  /** Yanıt bekleyen (yanıtsız ve geri çekilmemiş) soru sayısı. */
  total: number
  /** Süresi aşılmış olanlar (`total` içinde). */
  overdue: number
  /** En eski `QUESTION_LIMIT` soru; kuyruktaki sırayla (hedefe en yakın önce). */
  items: QuestionRow[]
}

export function openQuestions(
  rows: readonly CoreRow<'questions'>[],
  now: string,
  limit = QUESTION_LIMIT,
): OpenQuestions {
  const pending = orderQuestions(
    rows.map((row) => questionRow(row, NO_LOOKUPS, now)),
    'teacher',
  ).filter((row) => row.state === 'pending')
  return {
    total: pending.length,
    overdue: pending.filter((row) => row.overdue).length,
    items: pending.slice(0, limit),
  }
}
