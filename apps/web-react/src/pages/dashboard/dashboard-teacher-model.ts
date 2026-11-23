// Öğretmen Genel Bakışı'nın "Yanıt bekleyen sorular" sayacı ve listesinin saf gösterim hesabı.
// Girdi özet yanıtının `questions` bölümüdür (`GET /dashboard`): sayı, süre aşımı ve en eski üç
// soru sunucuda `questions?answered=false&withdrawn=false` okumasından hesaplanır (kapsam yalnız
// öğretmene atanan sorular, DOM-ILT-093; süre core `questionResponse`). Burada yalnız metin türer.
import type { components } from '@kampus/api-client/schema.d.ts'
import { number } from '@kampus/school-core/lib/format.ts'

export type OpenQuestions = components['schemas']['DashboardOpenQuestions']

/** Sayacın notu: süresi aşılan soru varsa sayısı, yoksa sakin metin. */
export function openQuestionsNote(questions: OpenQuestions | null | undefined): string {
  const overdue = questions?.overdue ?? 0
  return overdue > 0
    ? `${number(overdue)} sorunun yanıt süresi aşıldı`
    : 'Yanıt süresi aşılan soru yok'
}
