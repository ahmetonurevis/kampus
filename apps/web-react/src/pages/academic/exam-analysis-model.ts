// Sınav Analizi ve Akademik Gelişim ekranlarının saf hesapları (Vue `Academic.vue` analiz ve
// seviye görünümü). Girdi API'nin kapsamlı okuma kayıtlarıdır; hiçbir sonuç saklanmaz, hepsi
// kayıtlardan türetilir (ortalama ve net core işlevleriyle).
import { average, dateLabel } from '@kampus/school-core/lib/format.ts'
import { subjectAverages } from '@kampus/school-core/lib/grades.ts'
import { examNet } from '@kampus/school-core/lib/school-workflows.ts'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'
import type { TrendPoint } from '../dashboard/dashboard-model.ts'
import { withSubjectNames } from './academic-rows.ts'

type Grade = CoreRecord<'grades'>
type Quiz = Pick<CoreRecord<'quizzes'>, 'id' | 'subjectId'>
type Attempt = CoreRecord<'quizAttempts'>
type Exam = CoreRecord<'mockExams'>
type MockResult = CoreRecord<'mockResults'>
type Profile = Pick<CoreRecord<'opticalProfiles'>, 'id' | 'examId' | 'revision'>
type Evaluation = CoreRecord<'opticalEvaluations'>

/** Quiz sonuçlarından gelen notlar ayrıca konu kırılımına girer; konu başlığı yerine bu etiket yazılır. */
export const QUIZ_GRADE_TOPIC = 'Kazanım testi'

/** Bütün dersler seçimi (seçici değeri). */
export const ALL_SUBJECTS = 'all'

export type TopicScore = { topic: string; score: number }
export type SubjectScore = TopicScore & { subjectId: string; count: number }

/** Ders bazında not ortalaması (puan 0–100); ders adı güncel ders kaydından. */
export function subjectScores(
  grades: readonly Pick<Grade, 'subjectId' | 'subject' | 'score'>[],
  subjects: ReadonlyMap<string, { name: string }>,
): SubjectScore[] {
  return withSubjectNames(subjectAverages([...grades]), subjects).map((item) => ({
    subjectId: item.subjectId,
    topic: item.name,
    score: item.average,
    count: item.count,
  }))
}

/**
 * Seçili dersin konu kırılımı: dersin notlarındaki konular (kazanım testi notu hariç; onun konuları
 * quiz sonuçlarından gelir) ve dersin quizlerinin konu puanları; aynı konu ortalanır.
 */
export function topicScores(
  grades: readonly Pick<Grade, 'subjectId' | 'topic' | 'score'>[],
  // Öğrenci ve velide konu yüzdeleri quizin son tarihi geçene kadar yanıtta yoktur (DOM-AKD-078).
  attempts: readonly (Pick<Attempt, 'quizId'> & Partial<Pick<Attempt, 'topicScores'>>)[],
  quizzes: readonly Quiz[],
  subjectId: string,
): TopicScore[] {
  const quizSubject = new Map(quizzes.map((quiz) => [quiz.id, quiz.subjectId]))
  const results: TopicScore[] = grades
    .filter(
      (grade) => grade.subjectId === subjectId && grade.topic && grade.topic !== QUIZ_GRADE_TOPIC,
    )
    .map((grade) => ({ topic: grade.topic ?? '', score: grade.score }))
  for (const attempt of attempts)
    if (quizSubject.get(attempt.quizId) === subjectId)
      for (const item of attempt.topicScores ?? [])
        results.push({ topic: item.topic, score: item.score })
  return [...new Set(results.map((item) => item.topic))].map((topic) => ({
    topic,
    score: average(results.filter((item) => item.topic === topic).map((item) => item.score)),
  }))
}

/** En yüksek ve en düşük puanlı alan; liste boşsa ikisi de yok. */
export function extremes(scores: readonly TopicScore[]): {
  strongest: TopicScore | undefined
  weakest: TopicScore | undefined
} {
  const ordered = [...scores].sort((a, b) => b.score - a.score)
  return { strongest: ordered[0], weakest: ordered.at(-1) }
}

/** İşletme göstergesi: 65/80 eşikleri resmî başarı eşiği değildir (DOM-AKD-024). */
export function topicHint(score: number): string {
  if (score < 65) return 'Tekrar ve ek çalışma önerilir'
  if (score >= 80) return 'Güçlü alan'
  return 'Gelişmeye devam ediyor'
}

/** Çalışma önceliği etiketi ve önerisi (Vue "Akademik hedefler" kartı). */
export function studyPriority(score: number): { label: string; advice: string; strong: boolean } {
  if (score >= 80)
    return {
      label: 'Güçlü kazanımlar',
      advice: 'Yeni nesil sorular ve projelerle ilerle.',
      strong: true,
    }
  return {
    label: score >= 65 ? 'Pekiştirme zamanı' : 'Etüt önerilir',
    advice: 'Konu özetini incele, testi çöz ve öğretmeninle değerlendir.',
    strong: false,
  }
}

/** Not eğilimi: her not tarihi için o günkü notların ortalaması, tarihe göre sıralı. */
export function gradeTrend(grades: readonly Pick<Grade, 'date' | 'score'>[]): TrendPoint[] {
  const dates = [...new Set(grades.map((grade) => grade.date ?? ''))].filter(Boolean).sort()
  return dates.map((date) => ({
    label: dateLabel(date, { day: undefined, month: 'long' }),
    value: average(grades.filter((grade) => grade.date === date).map((grade) => grade.score)),
  }))
}

// --- Denemeler ------------------------------------------------------------------

export type ExamRow = {
  id: string
  title: string
  type: string
  /** ISO tarih; ekranda `dateLabel` ile. */
  date: string
  correct: number
  wrong: number
  blank: number
  net: number
  /** Sınavın bütün dersleri için sonuç var mı (eksikse net eğilime girmez). */
  complete: boolean
  /** Bu sınavda güncel optik soru analizi bulunan ders sayısı. */
  analysed: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Deneme sonuçları: yalnız öğrencinin sonucu olan denemeler, tarih sırasıyla. Net, core `examNet`
 * ile doğru/yanlış sayısından hesaplanır (yanlış cezası denemeden).
 */
export function examRows(
  exams: readonly Exam[],
  results: readonly MockResult[],
  currentIds: ReadonlySet<string>,
): ExamRow[] {
  return exams
    .flatMap((exam) => {
      const own = results.filter((result) => result.examId === exam.id)
      if (!own.length) return []
      const analysed = own.filter(
        (result) => result.evaluationId && currentIds.has(result.evaluationId),
      ).length
      return [
        {
          id: exam.id,
          title: exam.title,
          type: exam.type,
          date: exam.date,
          correct: own.reduce((sum, result) => sum + result.correct, 0),
          wrong: own.reduce((sum, result) => sum + result.wrong, 0),
          blank: own.reduce((sum, result) => sum + result.blank, 0),
          net: round2(own.reduce((sum, result) => sum + examNet(result, exam), 0)),
          complete: exam.subjectIds.every((id) => own.some((result) => result.subjectId === id)),
          analysed,
        },
      ]
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Tamamlanmış denemelerin net eğilimi (eksik dersli deneme toplamı yanıltacağı için dışarıda). */
export function netTrend(rows: readonly ExamRow[]): TrendPoint[] {
  return rows
    .filter((row) => row.complete)
    .map((row) => ({ label: dateLabel(row.date), value: row.net }))
}

/**
 * Güncel optik analizler: anahtar revizyonu profildekiyle aynı ve deneme sonucu hâlâ bu analize
 * bağlı olmalı (core `currentEvaluations` ile aynı kural). Anahtar değişince ya da sonuç elle
 * düzeltilince eski analiz gösterilmez; yeniden değerlendirme gerekir.
 */
export function currentEvaluationsOf(
  evaluations: readonly Evaluation[],
  profiles: readonly Profile[],
  results: readonly MockResult[],
): Evaluation[] {
  return evaluations.filter((evaluation) => {
    const profile = profiles.find((item) => item.id === evaluation.profileId)
    const result = results.find(
      (item) =>
        item.examId === evaluation.examId &&
        item.studentId === evaluation.studentId &&
        item.subjectId === evaluation.subjectId,
    )
    return profile?.revision === evaluation.keyRevision && result?.evaluationId === evaluation.id
  })
}

const OUTCOME_LABELS = {
  correct: 'Doğru',
  wrong: 'Yanlış',
  blank: 'Boş',
  multiple: 'Çoklu işaret',
  cancelled: 'İptal',
} as const

export type QuestionRow = {
  id: string
  subject: string
  number: number
  topic: string
  /** Öğrencinin işareti; boşsa "—". */
  response: string
  /** Doğru cevap (öğrenci kendi analizinde görür). */
  answer: string
  outcome: string
}

/** Bir analizdeki soruların tablo satırları (ders adı, soru sırası ile). */
export function questionRows(evaluation: Evaluation, subjectName: string): QuestionRow[] {
  return evaluation.questionResults.map((question) => ({
    id: `${evaluation.id}-${question.number}`,
    subject: subjectName,
    number: question.number,
    topic: question.topic,
    response: question.response ?? '—',
    answer: question.answer === '-' ? '—' : question.answer,
    outcome: OUTCOME_LABELS[question.outcome],
  }))
}

/** Kazanım başarısı yüzdesi ekranda; sorusu olmayan kazanım "—". */
export const percentText = (percent: number | null) => (percent === null ? '—' : `%${percent}`)

// --- Öğretmen görüşleri ---------------------------------------------------------

export type ReviewRow = {
  id: string
  teacher: string
  title: string
  feedback: string
  score: number | null
  /** ISO tarih. */
  date: string
}

type Submission = CoreRecord<'submissions'>
type Homework = Pick<CoreRecord<'homework'>, 'id' | 'title' | 'teacherId'>

/** Öğretmenin ödev teslimine yazdığı geri bildirimler (geri bildirimi olmayan teslim görüş değildir). */
export function homeworkReviews(
  submissions: readonly Submission[],
  homework: readonly Homework[],
  teachers: ReadonlyMap<string, { name: string }>,
): ReviewRow[] {
  const byId = new Map(homework.map((item) => [item.id, item]))
  return submissions
    .filter((submission) => submission.feedback)
    .flatMap((submission) => {
      const work = byId.get(submission.homeworkId)
      if (!work) return []
      return [
        {
          id: submission.id,
          teacher: teachers.get(work.teacherId)?.name ?? 'Öğretmen',
          title: work.title,
          feedback: submission.feedback ?? '',
          score: submission.score ?? null,
          date: submission.submittedAt ?? '',
        },
      ]
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}
