// Öğretmenin öğrenci profili (`/ogretmen/ogrenci/:id`, Vue `Academic.vue` profil görünümü): sekme
// seçimi, dönüş adresi ve bölüm satırları. Saf işlevlerdir: API kayıtları girer, ekran satırı çıkar.
// Kapsam sunucudadır (DOM-YTK-022): öğretmen yalnız ders verdiği ya da danışmanı olduğu sınıfın
// öğrencisini, kendi işinin (ödev, quiz) teslimini ve rehberlik dosyasının paylaşılan kısmını alır.
// Buradaki süzgeçler yalnız eksik veriden yanlış durum çıkarmamak içindir.
import { average } from '@kampus/school-core/lib/format.ts'
import { safeRelativePath } from '../../lib/return-path.ts'
import type { HomeworkRow, SubmissionRef } from '../learning/learning-rows.ts'
import { homeworkRow } from '../learning/learning-rows.ts'
import { ROLE_HOMEROOM, ROLE_SUBJECT } from './academic-rows.ts'

export const PROFILE_TABS = [
  'gelisim',
  'notlar',
  'devamsizlik',
  'odevler',
  'sinavlar',
  'takip',
] as const
export type ProfileTab = (typeof PROFILE_TABS)[number]

export type ProfileTabOption = { value: ProfileTab; label: string; icon: string }

/** Sekme ve açık olması gereken modüllerden biri (hiçbiri açık değilse sekme gizlenir). */
const TAB_DEFINITIONS: readonly (ProfileTabOption & { modules: readonly string[] })[] = [
  { value: 'gelisim', label: 'Akademik gelişim', icon: 'TrendingUp', modules: ['academic'] },
  { value: 'notlar', label: 'Not geçmişi', icon: 'Award', modules: ['academic'] },
  { value: 'devamsizlik', label: 'Devamsızlık', icon: 'ClipboardCheck', modules: ['academic'] },
  { value: 'odevler', label: 'Ödev durumu', icon: 'NotebookPen', modules: ['learning'] },
  {
    value: 'sinavlar',
    label: 'Quiz ve deneme',
    icon: 'ListChecks',
    modules: ['learning', 'exams'],
  },
  { value: 'takip', label: 'Hedef ve rehberlik', icon: 'Target', modules: ['goals', 'guidance'] },
]

type Modules = Readonly<Record<string, boolean | undefined>>

/** Kurumda açık modüllere göre görünen sekmeler (kapalı modülün sekmesi hiç çizilmez). */
export function profileTabs(modules: Modules): ProfileTabOption[] {
  return TAB_DEFINITIONS.filter((tab) => tab.modules.some((key) => modules[key] === true)).map(
    ({ value, label, icon }) => ({ value, label, icon }),
  )
}

/** Adresteki `?sekme=`: görünmeyen ya da bilinmeyen sekme ilk sekmeye düşer. */
export function profileTab(
  requested: string | null,
  tabs: readonly ProfileTabOption[],
): ProfileTab {
  return tabs.find((tab) => tab.value === requested)?.value ?? tabs[0]?.value ?? 'gelisim'
}

export const PROFILE_FALLBACK_PATH = '/ogretmen/siniflarim'

export const studentProfileHref = (studentId: string) =>
  `/ogretmen/ogrenci/${encodeURIComponent(studentId)}`

/** Profili açan bağlantının geçmiş durumuna yazdığı liste adresi (`state.from`). */
export type ProfileLinkState = { from: string }

/**
 * "Geri" bağlantısının hedefi: profili açan liste (sınıf özeti paneli açık hâliyle). Yalnız
 * öğretmen kabuğundaki göreli yol kabul edilir; yoksa Sınıflarım.
 */
export function profileReturnPath(state: unknown): string {
  const from =
    typeof state === 'object' && state !== null && 'from' in state
      ? safeRelativePath(state.from)
      : null
  return from?.startsWith('/ogretmen/') ? from : PROFILE_FALLBACK_PATH
}

/** Öğretmenin bu sınıftaki görevi (Vue "Sınıf danışmanı" / branş). */
export const teacherDuty = (homeroom: boolean) => (homeroom ? ROLE_HOMEROOM : ROLE_SUBJECT)

/**
 * Öğretmen öğrencinin teslimini ve quiz denemesini yalnız kendi işinde ya da sınıf danışmanıysa
 * görür (DOM-AKD-074, DOM-AKD-079). Başka öğretmenin ödevinde teslim gelmediği için durum
 * "Teslim edilmedi" görünürdü; o işler profilde listelenmez.
 */
export const readsStudentWork = (
  work: { teacherId: string },
  teacherId: string,
  homeroom: boolean,
) => homeroom || (teacherId !== '' && work.teacherId === teacherId)

type HomeworkInput = {
  id: string
  title: string
  subject: string
  dueDate: string
  description: string
  teacherId: string
}

/** Ödev durumu satırları: durum core `homeworkStatus` ile, son tarihi yeni olan önce. */
export function profileHomeworkRows(
  homework: readonly HomeworkInput[],
  submissions: readonly SubmissionRef[],
  input: { studentId: string; teacherId: string; homeroom: boolean; now: Date },
): HomeworkRow[] {
  return homework
    .filter((item) => readsStudentWork(item, input.teacherId, input.homeroom))
    .map((item) => homeworkRow(item, submissions, input.studentId, input.now))
    .sort((left, right) => right.dueDate.localeCompare(left.dueDate))
}

type QuizInput = { id: string; title: string; subjectId: string; teacherId: string }
type AttemptInput = {
  id: string
  quizId: string
  studentId: string
  date: string
  score?: number
  correct?: number
  total?: number
  status?: 'started' | 'completed'
}

export type QuizResultRow = {
  id: string
  title: string
  subject: string
  date: string
  /** Süren denemede `null`; puan sunucuda cevaplardan hesaplanmıştır, burada hesaplanmaz. */
  score: number | null
  result: string
}

/** Öğrencinin quiz denemeleri: yalnız öğretmenin görebildiği quizler, yeni tarihli önce. */
export function quizResultRows(
  attempts: readonly AttemptInput[],
  quizzes: readonly QuizInput[],
  subjects: ReadonlyMap<string, { name: string }>,
  input: { studentId: string; teacherId: string; homeroom: boolean },
): QuizResultRow[] {
  const byId = new Map(quizzes.map((quiz) => [quiz.id, quiz]))
  return attempts
    .filter((attempt) => attempt.studentId === input.studentId)
    .flatMap((attempt) => {
      const quiz = byId.get(attempt.quizId)
      if (!quiz || !readsStudentWork(quiz, input.teacherId, input.homeroom)) return []
      const finished = attempt.status !== 'started' && typeof attempt.score === 'number'
      return [
        {
          id: attempt.id,
          title: quiz.title,
          subject: subjects.get(quiz.subjectId)?.name ?? '—',
          date: attempt.date,
          score: finished ? (attempt.score ?? null) : null,
          result:
            finished && attempt.correct !== undefined && attempt.total !== undefined
              ? `${attempt.correct} / ${attempt.total} doğru`
              : 'Devam ediyor',
        },
      ]
    })
    .sort((left, right) => right.date.localeCompare(left.date))
}

type GoalInput = {
  id: string
  studentId: string
  subjectId?: string
  title: string
  targetNet: number
  deadline: string
  status: string
  steps: readonly { done: boolean }[]
}

export type GoalRow = {
  id: string
  title: string
  subject: string
  targetNet: number
  deadline: string
  status: string
  steps: string
}

/** Öğrencinin hedefleri (öğretmen kendi dersinin ve genel net hedeflerini görür). */
export function goalRows(
  goals: readonly GoalInput[],
  subjects: ReadonlyMap<string, { name: string }>,
  studentId: string,
): GoalRow[] {
  return goals
    .filter((goal) => goal.studentId === studentId)
    .map((goal) => ({
      id: goal.id,
      title: goal.title,
      subject: goal.subjectId ? (subjects.get(goal.subjectId)?.name ?? '—') : 'Genel net',
      targetNet: goal.targetNet,
      deadline: goal.deadline,
      status: goal.status,
      steps: `${goal.steps.filter((step) => step.done).length} / ${goal.steps.length} adım`,
    }))
    .sort((left, right) => left.deadline.localeCompare(right.deadline))
}

type GuidanceInput = {
  id: string
  studentId: string
  title: string
  status: string
  plan: string
  sharedNote: string
  followUp: string
}

/** Rehberlik dosyasının profilde gösterilen kısmı: yalnız paylaşılan plan ve takip. */
export type GuidanceRow = {
  id: string
  title: string
  status: string
  plan: string
  sharedNote: string
  followUp: string
}

/**
 * Rehberlik dosyaları: alanlar tek tek seçilir. Rehberlik görevli öğretmene sunucu iç notu da
 * döndürür (DOM-YTK-020, DOM-ILT-040), ama profil onu hiç taşımaz; iç not yalnız Rehberlik &
 * Takip sayfasındaki dosyada okunur. Böylece sıradan öğretmene sızma ihtimali ekranda da yoktur.
 */
export function guidanceRows(cases: readonly GuidanceInput[], studentId: string): GuidanceRow[] {
  return cases
    .filter((item) => item.studentId === studentId)
    .map(({ id, title, status, plan, sharedNote, followUp }) => ({
      id,
      title,
      status,
      plan,
      sharedNote,
      followUp,
    }))
    .sort((left, right) => left.followUp.localeCompare(right.followUp))
}

/** Özet kartı: görünen notların ortalaması ve "Gelmedi" yoklama sayısı (hiçbiri saklanmaz). */
export function profileMetrics(
  grades: readonly { score: number }[] | undefined,
  attendance: readonly { status: string }[] | undefined,
) {
  return {
    average: grades && grades.length > 0 ? average(grades.map((grade) => grade.score)) : null,
    absent: attendance ? attendance.filter((entry) => entry.status === 'absent').length : null,
  }
}
