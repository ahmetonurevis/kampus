// Öğrenci ve veli Genel Bakışı'nın "Bugünkü ders programı" ve "Son quiz sonucu" kartlarının saf
// hesapları. Girdi haftalık programın ve quiz listesinin kullandığı uç yanıtlarıdır (`/lessons`,
// `/quizzes`); hiçbir değer burada uydurulmaz: puan sunucunun cevaplardan hesapladığı sonuçtur
// (DOM-AKD-078), iptal ders günlük programda görünmez (DOM-YTK-068).
import { attemptOf, type QuizListItem } from '@kampus/react-shared/quizzes.ts'
import type { AcademicLookups } from '../academic/academic-rows.ts'
import { scheduleByDay, scheduleLesson, type Lesson } from '../academic/schedule-model.ts'

export type TodayLesson = {
  id: string
  /** Başlangıç saati (Europe/Istanbul, "09:30"). */
  time: string
  /** ISO an; `<time dateTime>` için. */
  date: string
  title: string
  /** Öğretmen (yedek atanmışsa "Yedek: …") ve derslik. */
  detail: string
  duration: number
}

/**
 * Bugünün (Europe/Istanbul günü, `today`) dersleri saat sırasıyla. Haftalık programla aynı satır
 * görünümü (`scheduleLesson`) ve gün gruplaması (`scheduleByDay`) kullanılır: iptal edilen ders
 * ve başka günün dersi girmez. Gün sınırı UTC değil İstanbul günüdür; 23:30 UTC'deki ders
 * ertesi gün 02:30'dur.
 */
export function todayLessons(
  lessons: readonly Lesson[],
  lookups: Pick<AcademicLookups, 'classes' | 'teachers' | 'subjects'>,
  today: string,
): TodayLesson[] {
  const rows = lessons.map((lesson) => scheduleLesson(lesson, lookups, 'student'))
  return (scheduleByDay(rows, [today]).get(today) ?? []).map((row) => ({
    id: row.id,
    time: row.time,
    date: row.date,
    title: row.title,
    detail: [row.substitute || row.teacher, `Derslik ${row.room}`].filter(Boolean).join(' · '),
    duration: row.duration,
  }))
}

export type LatestQuizResult = {
  quizId: string
  title: string
  subject: string
  /** Sunucunun cevaplardan hesapladığı 0–100 puan. */
  score: number
  correctCount: number
  total: number
  /** Gönderim anı (ISO); yoksa süre bitişi ya da başlangıç. */
  at: string | null
}

const instant = (value: string | null | undefined) => {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(time) ? null : time
}

/**
 * Seçili öğrencinin en son tamamlanan quiz denemesi: yalnız `completed` ve sonucu olan deneme,
 * en yeni gönderim önce. Süresi dolup boş sayılan (`expired`) ve süre işleyen deneme "tamamlanan"
 * değildir. Veli için `studentId` seçili çocuktur (aynı sınıftaki kardeşin denemesi sayılmaz,
 * DOM-AKD-079). Eşit anda liste sırası korunur; anı olmayan deneme en sona kalır.
 */
export function latestQuizResult(
  quizzes: readonly QuizListItem[],
  studentId: string,
): LatestQuizResult | null {
  let best: { result: LatestQuizResult; time: number } | null = null
  for (const quiz of quizzes) {
    const attempt = attemptOf(quiz, studentId)
    if (attempt?.status !== 'completed' || !attempt.result) continue
    const at = attempt.submittedAt ?? attempt.expiresAt ?? attempt.startedAt ?? null
    const time = instant(at) ?? Number.NEGATIVE_INFINITY
    if (best && time <= best.time) continue
    best = {
      time,
      result: {
        quizId: quiz.id,
        title: quiz.title,
        subject: quiz.subject,
        score: attempt.result.score,
        correctCount: attempt.result.correctCount,
        total: attempt.result.total,
        at,
      },
    }
  }
  return best?.result ?? null
}
