// Öğrenme okuma ekranlarının (ödev, teslim durumu, materyal, quiz) satır ve özet hesapları
// (Vue `Learning.vue`). Saf işlevlerdir: API satırları girer (sınıf adı satırın `joined`
// alanındandır), tablo satırı ve özet çıkar. Ödev durumu ve quiz puanı core'dan gelir (`homeworkStatus`, `gradeQuiz`); burada
// yeniden yazılmaz ve saklanmaz.
import { gradeQuiz } from '@kampus/school-core/lib/domain.ts'
import { average, homeworkStatus } from '@kampus/school-core/lib/format.ts'
import type { Homework, HomeworkListItem } from '@kampus/react-shared/homework.ts'
import type { CoreRecord, CoreRow } from '@/hooks/use-core-collection.ts'
import type { CollectionListConfig } from '../../lib/collection-list.ts'

type Submission = CoreRecord<'submissions'>
type Quiz = CoreRecord<'quizzes'>
type Attempt = CoreRecord<'quizAttempts'>
type Material = CoreRecord<'materials'>
type BankQuestion = CoreRecord<'bank'>
type Student = CoreRecord<'students'>

/** Sunucunun sıralayabildiği ve süzebildiği alanlar (api-tasarimi.md §3 beyaz liste). */
export const QUIZ_LIST = {
  sortFields: { title: 'title' },
  filterFields: { classId: 'classId', subjectId: 'subjectId' },
  defaultSort: ['title', 'id'],
} satisfies CollectionListConfig

/**
 * TODO(api-filter-level): materyalin düzey (`level`) alanı sunucuda süzülemez; öğretmen listesi
 * ders filtresi ve başlık aramasıyla yetinir.
 */
export const MATERIAL_LIST = {
  sortFields: { title: 'title' },
  filterFields: { subjectId: 'subjectId' },
  defaultSort: ['title', 'id'],
} satisfies CollectionListConfig

/** Bir sınıfın aktif öğrencileri, ad sırasıyla (Türkçe). */
export function activeRoster(students: readonly CoreRow<'students'>[]): Student[] {
  return students
    .map((row) => row.record)
    .filter((student) => student.isActive !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
}

/** `Ödev durumu` etiketleri core `homeworkStatus` çıktısıdır. */
export type HomeworkStatus = ReturnType<typeof homeworkStatus>

export type SubmissionRef = Pick<Submission, 'homeworkId' | 'studentId'> & {
  /** Teslim kaydı kimliği; verilirse özet satırı değerlendirme formuna bağlanır. */
  id?: string
  score?: number | null
  /** Geç teslim işareti (`/homework` teslimi); eski kayıtlarda yok. */
  late?: boolean
}

/** Öğrencinin kendi (veya velinin seçili çocuğunun) ödev satırı: durum core'dan. */
export type HomeworkRow = {
  id: string
  title: string
  subject: string
  dueDate: string
  status: HomeworkStatus
  /** Değerlendirilmişse not; aksi halde `null`. */
  score: number | null
  description: string
}

export function homeworkRow(
  homework: Pick<Homework, 'id' | 'title' | 'subject' | 'dueDate' | 'description'>,
  submissions: readonly SubmissionRef[],
  studentId: string,
  now: Date,
): HomeworkRow {
  const submission = submissions.find(
    (entry) => entry.homeworkId === homework.id && entry.studentId === studentId,
  )
  return {
    id: homework.id,
    title: homework.title,
    subject: homework.subject,
    dueDate: homework.dueDate,
    status: homeworkStatus(homework, submissions, studentId, now),
    score: submission?.score ?? null,
    description: homework.description,
  }
}

/** Öğretmen ve yönetici listesi satırı (`/homework`): teslim sayıları sunucudan. */
export type TeacherHomeworkRow = {
  id: string
  version: number
  title: string
  subject: string
  classId: string
  className: string
  teacherId: string
  dueDate: string
  /** `open` son teslim gelmedi, `closed` geçti (sunucu türetir). */
  status: HomeworkListItem['status']
  /** Okuyanın görebildiği teslim sayısı (başka dersin öğretmeninde 0; DOM-AKD-074). */
  delivered: number
  graded: number
  /** Sınıfın aktif öğrenci sayısı. */
  total: number
}

export function teacherHomeworkRow(
  item: HomeworkListItem,
  context: { className: string | undefined; total: number },
): TeacherHomeworkRow {
  return {
    id: item.id,
    version: item.version,
    title: item.title,
    subject: item.subject,
    classId: item.classId,
    className: context.className ?? '—',
    teacherId: item.teacherId,
    dueDate: item.dueDate,
    status: item.status,
    delivered: item.submissionCounts.submitted,
    graded: item.submissionCounts.graded,
    total: context.total,
  }
}

export type DeliveryEntry = {
  studentId: string
  name: string
  status: HomeworkStatus
  /** Öğrencinin teslimi yoksa `null`. */
  submissionId: string | null
  /** Teslim son teslimden sonra mı yapıldı (sunucunun teslim anındaki kararı). */
  late: boolean
}

export type DeliverySummary = {
  /** Sınıfın aktif öğrenci sayısı. */
  total: number
  /** Teslim eden (değerlendirilmiş olanlar dahil). */
  delivered: number
  /** Teslim edip değerlendirilen. */
  evaluated: number
  /** Teslim etmeyen ve son tarihi geçmiş. */
  late: number
  /** Teslim etmeyen ve süresi sürüyor. */
  pending: number
  students: readonly DeliveryEntry[]
}

/**
 * Teslim durumu özeti. Her öğrencinin durumu core `homeworkStatus`'tan gelir; `roster` ödevin
 * sınıfının aktif öğrencileridir (ödev başka sınıfın teslimini içermez).
 */
export function deliverySummary(
  homework: Pick<Homework, 'id' | 'classId' | 'dueDate'>,
  submissions: readonly SubmissionRef[],
  roster: readonly Student[],
  now: Date,
): DeliverySummary {
  const own = submissions.filter((entry) => entry.homeworkId === homework.id)
  const students = roster.map((student): DeliveryEntry => {
    const entry = own.find((item) => item.studentId === student.id)
    return {
      studentId: student.id,
      name: student.name,
      status: homeworkStatus(homework, own, student.id, now),
      submissionId: entry?.id ?? null,
      late: entry?.late ?? false,
    }
  })
  const count = (status: HomeworkStatus) =>
    students.filter((entry) => entry.status === status).length
  const evaluated = count('Değerlendirildi')
  return {
    total: students.length,
    delivered: evaluated + count('Teslim edildi'),
    evaluated,
    late: count('Gecikmiş'),
    pending: count('Bekliyor'),
    students,
  }
}

export type MaterialRow = {
  id: string
  title: string
  subject: string
  level: string
  type: string
  fileName: string
}

export function materialRow(item: CoreRow<'materials'>): MaterialRow {
  const material: Material = item.record
  return {
    id: material.id,
    title: material.title,
    subject: material.subject,
    level: material.level,
    type: material.type,
    fileName: material.fileName,
  }
}

/** Quiz sonucu: doğru sayısı, soru sayısı ve yüzde puan. */
export type QuizResult = { correct: number; total: number; score: number }

function hasAnswerKey(quiz: Pick<Quiz, 'questionIds'>, bank: readonly BankQuestion[]): boolean {
  const known = new Set(bank.map((question) => question.id))
  return quiz.questionIds.length > 0 && quiz.questionIds.every((id) => known.has(id))
}

/**
 * Denemenin sonucu. Soru bankası okunabiliyorsa (öğretmen, yönetici) puan cevaplardan core
 * `gradeQuiz` ile yeniden hesaplanır; cevap anahtarı öğrenci ve veliye açılmadığından onlarda
 * core'un gönderim anında hesaplayıp yazdığı sonuç gösterilir.
 * TODO(api-quiz-grading): öğrenci/veli için puanın cevaplardan sunucuda hesaplanıp döndürülmesi.
 */
export function attemptResult(
  attempt: Pick<Attempt, 'answers' | 'correct' | 'total' | 'score'>,
  quiz: Pick<Quiz, 'questionIds'>,
  bank: readonly BankQuestion[] | null,
): QuizResult {
  // Anahtar eksikse (soru bankası başka derse ait) gradeQuiz fırlatır; saklı sonuca düşülür.
  if (bank && hasAnswerKey(quiz, bank)) {
    const { correct, total, score } = gradeQuiz(quiz, bank, attempt.answers, true)
    return { correct, total, score }
  }
  return { correct: attempt.correct, total: attempt.total, score: attempt.score }
}

export type TeacherQuizRow = {
  id: string
  title: string
  subject: string
  className: string
  questions: number
  duration: number
  /** Çözen öğrenci sayısı. */
  solved: number
  /** Sınıf ortalaması (yüzde); çözen yoksa `null`. */
  average: number | null
}

export function teacherQuizRow(
  item: CoreRow<'quizzes'>,
  attempts: readonly CoreRecord<'quizAttempts'>[],
  bank: readonly BankQuestion[],
): TeacherQuizRow {
  const quiz = item.record
  const own = attempts.filter((attempt) => attempt.quizId === quiz.id)
  const scores = own.map((attempt) => attemptResult(attempt, quiz, bank).score)
  return {
    id: quiz.id,
    title: quiz.title,
    subject: quiz.subject,
    className: item.joined?.className ?? '—',
    questions: quiz.questionIds.length,
    duration: quiz.duration,
    solved: own.length,
    average: scores.length ? average(scores) : null,
  }
}

/** Öğrenci/veli quiz satırı: çözülme durumu ve sonuç. */
export type StudentQuizRow = {
  id: string
  title: string
  subject: string
  questions: number
  duration: number
  completion: 'Çözüldü' | 'Henüz çözülmedi'
  /** Çözüldüyse yüzde puan; aksi halde `null`. */
  score: number | null
  correct: number | null
  date: string | null
}

export function studentQuizRow(
  item: CoreRow<'quizzes'>,
  attempts: readonly CoreRecord<'quizAttempts'>[],
  studentId: string,
): StudentQuizRow {
  const quiz = item.record
  const attempt = attempts.find(
    (entry) => entry.quizId === quiz.id && entry.studentId === studentId,
  )
  const result = attempt ? attemptResult(attempt, quiz, null) : null
  return {
    id: quiz.id,
    title: quiz.title,
    subject: quiz.subject,
    questions: quiz.questionIds.length,
    duration: quiz.duration,
    completion: attempt ? 'Çözüldü' : 'Henüz çözülmedi',
    score: result?.score ?? null,
    correct: result?.correct ?? null,
    date: attempt?.date ?? null,
  }
}

/** Birden çok kaydın benzersiz kimlikleri (sunucu süzgecine dizi olarak gider). */
export function uniqueValues(values: Iterable<string>): string[] {
  return [...new Set(values)]
}
