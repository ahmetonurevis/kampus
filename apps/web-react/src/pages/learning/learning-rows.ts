// Öğrenme okuma ekranlarının (ödev, teslim durumu, materyal, quiz) satır ve özet hesapları
// (Vue `Learning.vue`). Saf işlevlerdir: API satırları girer (sınıf adı satırın `joined`
// alanındandır), tablo satırı ve özet çıkar. Ödev durumu core'dan (`homeworkStatus`), quiz puanı
// sunucunun cevaplardan hesapladığı sonuçtan (`attempts[].result`, DOM-AKD-078) gelir; burada
// yeniden hesaplanmaz ve saklanmaz.
import { CEFR_LEVELS, GRADE_LEVEL_RANGE } from '@kampus/school-core/content/taxonomy.ts'
import { homeworkStatus } from '@kampus/school-core/lib/format.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import type { Homework, HomeworkListItem } from '@kampus/react-shared/homework.ts'
import { attemptOf, type QuizListItem } from '@kampus/react-shared/quizzes.ts'
import type { CoreRecord, CoreRow } from '@/hooks/use-core-collection.ts'
import type { CollectionListConfig } from '../../lib/collection-list.ts'
import { attemptPhase, canStartQuiz, QUIZ_PHASE_TEXT, type AttemptPhase } from './quiz-forms.ts'

type Submission = CoreRecord<'submissions'>
type Material = CoreRecord<'materials'>
type Student = CoreRecord<'students'>

/** Öğretmen materyal listesi: ders ve düzey süzgeçleri ile başlık sırası sunucuda uygulanır (IST-035). */
export const MATERIAL_LIST = {
  sortFields: { title: 'title' },
  filterFields: { subjectId: 'subjectId', level: 'level' },
  defaultSort: ['title', 'id'],
} satisfies CollectionListConfig

/**
 * Düzey süzgeci seçenekleri (sunucunun kabul ettiği değerler): okulda ve kursta `N. Sınıf`, dil
 * okulunda CEFR seviyesi. Materyalin `level` alanı bu biçimlerde saklanır. Kursun program düzeyi
 * (YKS TYT, KPSS GY-GK) ADR 0008 adım 2'dedir; o zamana kadar okul biçimi geçerlidir.
 */
export function materialLevelOptions(type: InstitutionType): string[] {
  if (type === 'language_school') return Object.keys(CEFR_LEVELS)
  const { min, max } = GRADE_LEVEL_RANGE
  return Array.from({ length: max - min + 1 }, (_, index) => `${min + index}. Sınıf`)
}

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

/** Öğretmen ve yönetici quiz listesi satırı (`/quizzes`): çözen ve ortalama sunucu özetinden. */
export type TeacherQuizRow = {
  id: string
  version: number
  title: string
  subject: string
  classId: string
  className: string
  teacherId: string
  questions: number
  duration: number
  /** Son tarih; `null` süresiz açık. */
  dueDate: string | null
  status: QuizListItem['status']
  /** Sonuçlanmış deneme sayısı (DOM-AKD-079). */
  solved: number
  /** Süresi işleyen deneme sayısı. */
  inProgress: number
  /** Deneme başlatılmış mı: sorular değişmez, quiz arşivlenmez (DOM-AKD-076). */
  started: boolean
  /** Sunucunun cevaplardan hesapladığı ortalama (yüzde); çözen yoksa `null`. */
  average: number | null
}

export function teacherQuizRow(
  item: QuizListItem,
  context: { className: string | undefined },
): TeacherQuizRow {
  const statistics = item.statistics
  return {
    id: item.id,
    version: item.version,
    title: item.title,
    subject: item.subject,
    classId: item.classId,
    className: context.className ?? '—',
    teacherId: item.teacherId,
    questions: item.questionCount,
    duration: item.duration,
    dueDate: item.dueDate,
    status: item.status,
    solved: statistics?.scored ?? 0,
    inProgress: statistics?.inProgress ?? 0,
    started: (statistics?.started ?? 0) > 0,
    average: statistics?.average ?? null,
  }
}

/** Öğrenci/veli quiz satırı (`/quizzes`): seçili öğrencinin deneme durumu ve sunucu sonucu. */
export type StudentQuizRow = {
  id: string
  title: string
  subject: string
  questions: number
  duration: number
  /** Son tarih; `null` süresiz açık. */
  dueDate: string | null
  status: QuizListItem['status']
  phase: AttemptPhase
  completion: (typeof QUIZ_PHASE_TEXT)[AttemptPhase]
  /** Sonuçlandıysa sunucunun cevaplardan hesapladığı yüzde puan; aksi halde `null`. */
  score: number | null
  correct: number | null
  total: number | null
  /** Öğrenci başlatabilir: quiz açık ve denemesi yok (DOM-AKD-077). */
  startable: boolean
}

/**
 * Satır yalnız seçili öğrencinin denemesinden kurulur: velinin iki çocuğu aynı sınıfta olabilir,
 * yanıt ikisinin denemesini de taşır (DOM-AKD-079).
 */
export function studentQuizRow(item: QuizListItem, studentId: string): StudentQuizRow {
  const attempt = attemptOf(item, studentId)
  const phase = attemptPhase(attempt)
  const result = attempt?.result ?? null
  return {
    id: item.id,
    title: item.title,
    subject: item.subject,
    questions: item.questionCount,
    duration: item.duration,
    dueDate: item.dueDate,
    status: item.status,
    phase,
    completion: QUIZ_PHASE_TEXT[phase],
    score: result?.score ?? null,
    correct: result?.correctCount ?? null,
    total: result?.total ?? null,
    startable: canStartQuiz(item, attempt),
  }
}

/** Birden çok kaydın benzersiz kimlikleri (sunucu süzgecine dizi olarak gider). */
export function uniqueValues(values: Iterable<string>): string[] {
  return [...new Set(values)]
}
